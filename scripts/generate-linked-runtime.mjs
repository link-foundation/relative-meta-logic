#!/usr/bin/env node
/** Import once from host ASTs, then compile the independently editable Links.
 * --capture is an explicit migration/update operation. Ordinary --emit never
 * reads the original implementation, and --check cannot refresh stale Links.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeLinkedValues, decodeLinkedValues } from './linked-runtime-graph.mjs';
import { generateJavaScript } from './linked-runtime-codegen.mjs';
import { discoverExecutableInventory, javaScriptSourceType, isJavaScriptImplementationPath, assertJavaScriptDependencyClosure } from './linked-executable-inventory.mjs';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const archiveRelativePath = 'lib/linked-runtime/implementation.links.json.gz';
export const manifestRelativePath = 'lib/linked-runtime/manifest.json';
const omitted = new Set(['start', 'end', 'loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'errors']);
const sha256 = data => createHash('sha256').update(data).digest('hex');

export function implementationInventory(root = repositoryRoot) {
  return discoverExecutableInventory(root, { entrypointLanguages: ['javascript'] }).javascript;
}

/** Remove only locations, comments, original spellings and parser bookkeeping.
 * Template raw/cooked values and regex patterns are semantic fields and stay.
 * Statement blocks are normalized to the generator's explicit block form.
 */
export function normalizeJavaScriptAst(value) {
  // Babel 8 exposes BigIntLiteral.value as bigint; Links/JSON use exact decimal text.
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeJavaScriptAst);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) if (!omitted.has(key) && value[key] !== undefined) result[key] = normalizeJavaScriptAst(value[key]);
  const block = statement => statement && statement.type !== 'BlockStatement' ? { body: [statement], directives: [], type: 'BlockStatement' } : statement;
  if (result.type === 'IfStatement') { result.consequent = block(result.consequent); result.alternate = block(result.alternate); }
  if (['WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'].includes(result.type)) result.body = block(result.body);
  return result;
}

export function parseJavaScriptAst(source, root = repositoryRoot, options = {}) {
  const require = createRequire(resolve(root, 'js/package.json'));
  const { parse } = require('@babel/parser');
  return normalizeJavaScriptAst(parse(source, { sourceType: options.sourceType ?? 'module', createImportExpressions: true }));
}

export function captureImplementation(root = repositoryRoot) {
  const modules = {};
  for (const path of implementationInventory(root)) {
    const options = { sourceType: javaScriptSourceType(path, root) };
    const ast = parseJavaScriptAst(readFileSync(resolve(root, path), 'utf8'), root, options);
    const generated = generateJavaScript(ast);
    const reparsed = parseJavaScriptAst(generated, root, options);
    if (JSON.stringify(ast) !== JSON.stringify(reparsed)) throw new Error(`structured generation changed the AST: ${path}`);
    modules[path] = ast;
  }
  return encodeLinkedValues({ format: 'babel-ecmascript-ast/v1', modules });
}

export function readLinkedImplementation(root = repositoryRoot) {
  const bytes = readFileSync(resolve(root, archiveRelativePath));
  const manifest = JSON.parse(readFileSync(resolve(root, manifestRelativePath), 'utf8'));
  if (manifest.schema !== 'rml-linked-implementation-manifest/v1' || sha256(bytes) !== manifest.archiveSha256) throw new Error('linked implementation artifact hash mismatch');
  const archive = JSON.parse(gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }));
  const modules = implementationModules(archive);
  if (JSON.stringify(Object.keys(modules).sort()) !== JSON.stringify(manifest.modules.map(item => item.path))) throw new Error('linked implementation manifest inventory mismatch');
  for (const item of manifest.modules) if (sha256(JSON.stringify(modules[item.path])) !== item.astSha256) throw new Error(`linked implementation AST hash mismatch: ${item.path}`);
  return archive;
}

export function saveLinkedImplementation(archive, root = repositoryRoot) {
  const report = checkLinkedImplementation(archive, root);
  const bytes = gzipSync(`${JSON.stringify(archive)}\n`, { level: 9 });
  const modules = implementationModules(archive), generated = compileLinkedImplementation(archive);
  const manifest = { ...report, schema: 'rml-linked-implementation-manifest/v1', archiveSha256: sha256(bytes), archiveBytes: bytes.length,
    modules: Object.entries(modules).map(([path, ast]) => ({ path, sourceSha256: sha256(readFileSync(resolve(root, path))), astSha256: sha256(JSON.stringify(ast)), generatedSha256: sha256(generated[path]) })) };
  mkdirSync(dirname(resolve(root, archiveRelativePath)), { recursive: true });
  writeFileSync(resolve(root, archiveRelativePath), bytes);
  writeFileSync(resolve(root, manifestRelativePath), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function implementationModules(archive) {
  const value = decodeLinkedValues(archive);
  if (value?.format !== 'babel-ecmascript-ast/v1' || !value.modules || Object.keys(value).sort().join(',') !== 'format,modules') throw new TypeError('invalid implementation root');
  const paths = Object.keys(value.modules);
  if (!paths.length || paths.some(path => !isJavaScriptImplementationPath(path))) throw new TypeError('invalid implementation module path');
  return value.modules;
}

export function compileLinkedImplementation(archive) {
  return Object.fromEntries(Object.entries(implementationModules(archive)).map(([path, ast]) => [path, generateJavaScript(ast)]));
}

/** This operation reads no host implementation or parser; Links are authority. */
export function emitLinkedImplementation(archive, destination) {
  const files = compileLinkedImplementation(archive);
  for (const [path, source] of Object.entries(files)) {
    const file = resolve(destination, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return { modules: Object.keys(files).length, artifacts: Object.fromEntries(Object.entries(files).map(([path, source]) => [path, sha256(source)])) };
}

/** Reject omissions and stale host mirrors; never updates either side. */
export function checkLinkedImplementation(archive, root = repositoryRoot) {
  const modules = implementationModules(archive);
  if (JSON.stringify(Object.keys(modules).sort()) !== JSON.stringify(implementationInventory(root))) throw new Error('linked implementation inventory differs from owned runtime');
  const generated = compileLinkedImplementation(archive);
  const closure = assertJavaScriptDependencyClosure(modules, root);
  for (const [path, ast] of Object.entries(modules)) {
    const options = { sourceType: javaScriptSourceType(path, root) };
    const current = parseJavaScriptAst(readFileSync(resolve(root, path), 'utf8'), root, options);
    if (JSON.stringify(current) !== JSON.stringify(ast)) throw new Error(`host mirror differs from authoritative linked AST: ${path}`);
    if (JSON.stringify(parseJavaScriptAst(generated[path], root, options)) !== JSON.stringify(ast)) throw new Error(`generated artifact differs from authoritative linked AST: ${path}`);
  }
  return { schema: 'rml-linked-implementation-check/v1', moduleCount: Object.keys(modules).length, linkCount: archive.links.length, sourceArtifactConsistency: true,
    compiledFromStructuredLinks: true, fullImplementationClosure: false,
    executableInventory: { discovery: 'repository-wide executable and public-entrypoint scan', entrypoints: discoverExecutableInventory(root, { entrypointLanguages: ['javascript'] }).entrypoints, staticImportEdges: closure.dependencies.length, dynamicImportSites: closure.dynamicImports },
    residualTrust: ['ordered addressed-Link codec and archive validation', 'generic ECMAScript AST generator and source loader', 'Babel parser for migration and consistency checks only', 'ECMAScript and Node runtime semantics, standard library and external dependencies', 'V8 compiler, target-machine lowering, operating system and physical processor'],
    remainingScope: ['source-to-compiled-target preservation beyond the declared parser, term and proof-receipt observations', 'minimal bootstrap and independently comparable foundations'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, destination] = process.argv.slice(2);
  if (mode === '--capture' && !destination) {
    const archive = captureImplementation();
    console.log(JSON.stringify(saveLinkedImplementation(archive), null, 2));
  } else if (mode === '--check' && !destination) console.log(JSON.stringify(checkLinkedImplementation(readLinkedImplementation()), null, 2));
  else if (mode === '--emit' && destination) console.log(JSON.stringify(emitLinkedImplementation(readLinkedImplementation(), resolve(destination)), null, 2));
  else throw new Error('Usage: node scripts/generate-linked-runtime.mjs --capture | --check | --emit DIRECTORY');
}
