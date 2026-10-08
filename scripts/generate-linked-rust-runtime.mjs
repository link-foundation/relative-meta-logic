#!/usr/bin/env node
/** Structured Rust AST authority through Syn, never a whole-source token box. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeLinkedValues, decodeLinkedValues } from './linked-runtime-graph.mjs';
import { discoverExecutableInventory, isRustImplementationPath } from './linked-executable-inventory.mjs';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const archiveRelativePath = 'lib/linked-runtime/rust-implementation.links.json.gz';
export const manifestRelativePath = 'lib/linked-runtime/rust-manifest.json';
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const key = value => JSON.stringify(canonical(value));

function rustToolSources(root) {
  const paths = ['scripts/linked-runtime-rust/Cargo.toml', 'scripts/linked-runtime-rust/Cargo.lock'];
  const visit = directory => {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new TypeError(`Rust tool source refuses symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) paths.push(path);
    }
  };
  visit('scripts/linked-runtime-rust/vendor');
  return paths.sort().map(path => ({ path, sha256: digest(readFileSync(resolve(root, path))) }));
}

export function rustAstTool(mode, input, helper) {
  if (typeof helper !== 'string' || !helper) throw new TypeError('explicit Rust AST helper executable required');
  const result = spawnSync(helper, [mode], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`Rust AST ${mode} failed: ${result.error?.message ?? result.stderr}`);
  return mode === 'emit' ? result.stdout : canonical(JSON.parse(result.stdout));
}

export function rustImplementationInventory(root = repositoryRoot) {
  return discoverExecutableInventory(root, { entrypointLanguages: ['rust'] }).rust;
}

export function captureRustImplementation(helper, root = repositoryRoot) {
  const modules = {};
  for (const path of rustImplementationInventory(root)) {
    const syntax = rustAstTool('parse', readFileSync(resolve(root, path), 'utf8'), helper);
    const generated = rustAstTool('emit', JSON.stringify(syntax), helper);
    if (key(rustAstTool('parse', generated, helper)) !== key(syntax)) throw new Error(`structured Rust generation changed the AST: ${path}`);
    modules[path] = syntax;
  }
  return encodeLinkedValues({ format: 'syn-rust-ast/v1', modules });
}

export function rustImplementationModules(archive) {
  const value = decodeLinkedValues(archive);
  if (value?.format !== 'syn-rust-ast/v1' || !value.modules || Object.keys(value).sort().join(',') !== 'format,modules') throw new TypeError('invalid Rust implementation root');
  const paths = Object.keys(value.modules);
  if (!paths.length || paths.some(path => !isRustImplementationPath(path))) throw new TypeError('invalid Rust implementation module path');
  return value.modules;
}

export function compileLinkedRustImplementation(archive, helper) {
  return Object.fromEntries(Object.entries(rustImplementationModules(archive)).map(([path, syntax]) => [path, rustAstTool('emit', JSON.stringify(syntax), helper)]));
}

export function emitLinkedRustImplementation(archive, destination, helper) {
  const files = compileLinkedRustImplementation(archive, helper);
  for (const [path, source] of Object.entries(files)) {
    const target = resolve(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return { modules: Object.keys(files).length, artifacts: Object.fromEntries(Object.entries(files).map(([path, source]) => [path, digest(source)])) };
}

export function checkLinkedRustImplementation(archive, helper, root = repositoryRoot) {
  const modules = rustImplementationModules(archive);
  if (key(Object.keys(modules).sort()) !== key(rustImplementationInventory(root))) throw new Error('linked Rust inventory differs from owned runtime');
  const generated = compileLinkedRustImplementation(archive, helper);
  const entries = [];
  for (const [path, syntax] of Object.entries(modules)) {
    const source = readFileSync(resolve(root, path), 'utf8');
    if (key(rustAstTool('parse', source, helper)) !== key(syntax)) throw new Error(`host Rust mirror differs from authoritative linked AST: ${path}`);
    if (key(rustAstTool('parse', generated[path], helper)) !== key(syntax)) throw new Error(`generated Rust artifact differs from authoritative linked AST: ${path}`);
    entries.push({ path, sourceSha256: digest(source), astSha256: digest(key(syntax)), generatedSha256: digest(generated[path]), ...rustAstTool('audit', JSON.stringify(syntax), helper) });
  }
  return { schema: 'rml-linked-rust-implementation-check/v1', moduleCount: entries.length, linkCount: archive.links.length, sourceArtifactConsistency: true, compiledFromStructuredLinks: true,
    fullImplementationClosure: false, modules: entries,
    residualTrust: ['ordered addressed-Link codec and archive validation', 'Syn 3.0.6 AST schema, Syn-serde codec, Syn/Quote generic Rust generator', 'Rust macro expansion and generic library implementations', 'rustc, LLVM target-machine lowering, operating system and physical processor'],
    macroRepresentation: 'nested Group/Ident/Punct/Literal TokenTrees inside structured syntax; macro expansion remains in rustc',
    remainingScope: ['source-to-compiled-target preservation beyond the declared parser, term and proof-receipt observations', 'minimal bootstrap and independently comparable foundations'] };
}

export function saveLinkedRustImplementation(archive, helper, root = repositoryRoot) {
  const report = checkLinkedRustImplementation(archive, helper, root);
  const bytes = gzipSync(`${JSON.stringify(archive)}\n`, { level: 9 });
  const manifest = { ...report, schema: 'rml-linked-rust-implementation-manifest/v1', archiveBytes: bytes.length, archiveSha256: digest(bytes), toolLockSha256: digest(readFileSync(resolve(root, 'scripts/linked-runtime-rust/Cargo.lock'))), toolSources: rustToolSources(root) };
  mkdirSync(dirname(resolve(root, archiveRelativePath)), { recursive: true });
  writeFileSync(resolve(root, archiveRelativePath), bytes);
  writeFileSync(resolve(root, manifestRelativePath), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readLinkedRustImplementation(root = repositoryRoot) {
  const bytes = readFileSync(resolve(root, archiveRelativePath));
  const manifest = JSON.parse(readFileSync(resolve(root, manifestRelativePath), 'utf8'));
  if (manifest.schema !== 'rml-linked-rust-implementation-manifest/v1' || digest(bytes) !== manifest.archiveSha256) throw new Error('linked Rust implementation artifact hash mismatch');
  if (key(rustToolSources(root)) !== key(manifest.toolSources)) throw new Error('linked Rust generic tool sources differ from their pinned manifest');
  const archive = JSON.parse(gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }));
  const modules = rustImplementationModules(archive);
  if (key(Object.keys(modules).sort()) !== key(manifest.modules.map(item => item.path))) throw new Error('linked Rust implementation manifest inventory mismatch');
  for (const item of manifest.modules) if (digest(key(modules[item.path])) !== item.astSha256) throw new Error(`linked Rust implementation AST hash mismatch: ${item.path}`);
  return archive;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, helper, destination] = process.argv.slice(2);
  if (mode === '--capture' && helper && !destination) console.log(JSON.stringify(saveLinkedRustImplementation(captureRustImplementation(helper), helper), null, 2));
  else if (mode === '--check' && helper && !destination) console.log(JSON.stringify(checkLinkedRustImplementation(readLinkedRustImplementation(), helper), null, 2));
  else if (mode === '--emit' && helper && destination) console.log(JSON.stringify(emitLinkedRustImplementation(readLinkedRustImplementation(), resolve(destination), helper), null, 2));
  else throw new Error('Usage: node scripts/generate-linked-rust-runtime.mjs --capture HELPER | --check HELPER | --emit HELPER DIRECTORY');
}
