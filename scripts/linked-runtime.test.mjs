import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { encodeLinkedValues, decodeLinkedValues } from './linked-runtime-graph.mjs';
import { generateJavaScript } from './linked-runtime-codegen.mjs';
import { compileLinkedImplementation, emitLinkedImplementation, implementationModules, readLinkedImplementation, repositoryRoot, checkLinkedImplementation, parseJavaScriptAst } from './generate-linked-runtime.mjs';
import { readImplementationConfiguration, emitImplementationConfiguration } from './linked-implementation-configuration.mjs';

const archive = readLinkedImplementation();
const configuration = readImplementationConfiguration();
const manifest = JSON.parse(readFileSync(new URL('../lib/linked-runtime/manifest.json', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'rml-linked-runtime-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const sha256 = text => createHash('sha256').update(text).digest('hex');

function prepare(name, source = archive) {
  const destination = join(scratch, name);
  const result = emitLinkedImplementation(source, destination);
  // The implementation files have already been generated from Links. Only
  // generic dependencies and source-language test inputs come from outside.
  emitImplementationConfiguration(configuration, destination);
  symlinkSync(join(repositoryRoot, 'js/node_modules'), join(destination, 'js/node_modules'), 'dir');
  mkdirSync(join(destination, 'js/vendor'), { recursive: true });
  symlinkSync(join(repositoryRoot, 'js/vendor/meta-language'), join(destination, 'js/vendor/meta-language'), 'dir');
  return { destination, result, load: path => import(pathToFileURL(join(destination, path)).href) };
}

function visit(value, predicate, replace) {
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object' && predicate(child)) { value[key] = replace(child); count += 1; }
    else count += visit(child, predicate, replace);
  }
  return count;
}

function changedModule(path, predicate, replace, expected = 1) {
  const value = decodeLinkedValues(archive);
  assert.equal(visit(value.modules[path], predicate, replace), expected, 'mutation identifies exact AST locations');
  return encodeLinkedValues(value);
}

test('linked implementation manifest pins structured ASTs and generated artifacts for the complete snapshot inventory', () => {
  const modules = implementationModules(archive), compiled = compileLinkedImplementation(archive);
  assert.equal(Object.keys(modules).length, manifest.moduleCount);
  assert.ok(manifest.modules.filter(item => item.path.startsWith('js/src/')).length >= 32);
  assert.equal(archive.links.length, manifest.linkCount);
  for (const item of manifest.modules) {
    assert.equal(sha256(JSON.stringify(modules[item.path])), item.astSha256, item.path);
    assert.equal(sha256(compiled[item.path]), item.generatedSha256, item.path);
  }
  assert.equal(manifest.fullImplementationClosure, false);
  assert.ok(manifest.residualTrust.some(value => value.includes('V8')));
  assert.ok(manifest.remainingScope.includes('source-to-compiled-target preservation beyond the declared parser, term and proof-receipt observations'));
  assert.ok(manifest.remainingScope.includes('minimal bootstrap and independently comparable foundations'));
});

test('Babel 8 BigInt literals preserve exact values through structured Links and generation', () => {
  const source = 'export const values = [0n, 0xffffffffffffffffffffn, -9007199254740993123456789n];';
  const ast = parseJavaScriptAst(source);
  const decoded = decodeLinkedValues(encodeLinkedValues(ast));
  assert.deepEqual(decoded, ast);
  assert.deepEqual(parseJavaScriptAst(generateJavaScript(decoded)), ast);
  assert.match(JSON.stringify(ast), /9007199254740993123456789/);
});

test('graph serialization stores only Links and preserves values including Unicode, negative zero, and prototype-like keys', () => {
  const value = JSON.parse('{"__proto__":{"x":1},"constructor":"ordinary","values":[null,true,false,"",[],{},"😀\\ud800"]}');
  value.minusZero = -0;
  const encoded = encodeLinkedValues(value);
  assert.ok(encoded.links.every(references => references.every(Number.isSafeInteger)));
  assert.deepEqual(decodeLinkedValues(JSON.parse(JSON.stringify(encoded))), value);
  assert.equal(Object.getPrototypeOf(decodeLinkedValues(encoded)), Object.prototype);
});

test('graph restoration refuses missing, cyclic, malformed and exponentially expanding syntax', () => {
  const sample = encodeLinkedValues({ type: 'Identifier', name: 'x' });
  for (const ref of [sample.links.length, sample.root, -1]) {
    const corrupt = structuredClone(sample); corrupt.links[sample.root].push(ref);
    assert.throws(() => decodeLinkedValues(corrupt), /references/);
  }
  const anchors = structuredClone(sample); anchors.links[1] = [];
  assert.throws(() => decodeLinkedValues(anchors), /anchor mismatch/);
  const shape = structuredClone(sample); shape.links[shape.root][1] = 1;
  assert.throws(() => decodeLinkedValues(shape), /delimiter/);
  let shared = 'leaf';
  for (let index = 0; index < 15; index += 1) shared = [shared, shared];
  const expansion = encodeLinkedValues(shared);
  assert.throws(() => decodeLinkedValues(expansion, { maxExpandedNodes: 64 }), /expansion budget/);
  assert.throws(() => generateJavaScript({ type: 'FutureUnsupportedSyntax' }), /unsupported/);
  const cycle = { type: 'File' }; cycle.program = cycle;
  assert.throws(() => generateJavaScript(cycle), /cyclic/);
});

test('source-free generation executes the real LiNo parser, formal terms, proof verifier and K0 compiler', async () => {
  const runtime = prepare('baseline');
  assert.equal(existsSync(join(runtime.destination, 'lib/linked-runtime')), false, 'source archive is supplied in memory; no source tree is copied');
  const parser = await runtime.load('js/src/rml-lino-frontend.mjs');
  assert.equal(parser.parseLinoDocument('(a (b c))').length, 1);
  const formal = await runtime.load('js/src/rml-formal-semantics.mjs');
  assert.deepEqual(formal.formalNatural(2), ['fs-successor', ['fs-successor', ['fs-zero']]]);
  const { LinkedProgramRegistry } = await runtime.load('js/src/rml-linked-program.mjs');
  const { verifyLinkedProof, replayLinkedProof } = await runtime.load('js/src/rml-linked-proof.mjs');
  const universal = readFileSync(join(runtime.destination, 'lib/meta-theory/universal.lino'), 'utf8');
  const verifier = readFileSync(join(runtime.destination, 'lib/meta-theory/proof-verifier.lino'), 'utf8');
  const registry = LinkedProgramRegistry.fromRml(`${universal}\n${verifier}`, { executionBasis: 'direct-structural' });
  const cases = JSON.parse(readFileSync(join(repositoryRoot, 'test-corpus/linked-proof/cases.json')));
  for (const sample of cases) {
    const receipt = verifyLinkedProof(registry, sample.context, sample.goal, sample.candidate);
    assert.equal(receipt.accepted, sample.accepted, sample.name);
    assert.equal(replayLinkedProof(registry, sample.context, sample.goal, receipt).matches, true, sample.name);
  }
  const compiler = await runtime.load('scripts/combinator-source.mjs');
  const source = readFileSync(join(runtime.destination, 'lib/meta-theory/fixed-point-source.lino'), 'utf8');
  assert.equal(compiler.serializeCombinatorSource(source), readFileSync(join(runtime.destination, 'lib/meta-theory/fixed-point.ski'), 'utf8'));
});

test('replacing parser and elaboration AST Links changes behavior on the unchanged generator and runtime substrate', async () => {
  const parserArchive = changedModule('js/src/rml-lino-frontend.mjs', node => node.type === 'VariableDeclarator' && node.id.name === 'MAX_LINO_NESTING_DEPTH', node => ({ ...node, init: { type: 'NumericLiteral', value: 2 } }));
  const parser = await prepare('changed-parser', parserArchive).load('js/src/rml-lino-frontend.mjs');
  assert.equal(parser.MAX_LINO_NESTING_DEPTH, 2);
  assert.throws(() => parser.parseLinoDocument('(a (b (c d)))'), /nest/i);
  const termsArchive = changedModule('js/src/rml-formal-semantics.mjs', node => node.type === 'StringLiteral' && node.value === 'fs-successor', node => ({ ...node, value: 'changed-successor' }), 2);
  const formal = await prepare('changed-elaboration', termsArchive).load('js/src/rml-formal-semantics.mjs');
  assert.deepEqual(formal.formalNatural(2), ['changed-successor', ['changed-successor', ['fs-zero']]]);
});

test('replacing verifier and bracket compiler AST Links changes semantic decisions without callbacks', async () => {
  const proofArchive = changedModule('js/src/rml-linked-proof.mjs', node => node.type === 'ObjectProperty' && node.key.name === 'accepted' && node.value.type === 'LogicalExpression', node => ({ ...node, value: { type: 'BooleanLiteral', value: false } }));
  const runtime = prepare('changed-verifier', proofArchive);
  const proof = await runtime.load('js/src/rml-linked-proof.mjs');
  const { LinkedProgramRegistry } = await runtime.load('js/src/rml-linked-program.mjs');
  const program = ['universal.lino', 'proof-verifier.lino'].map(name => readFileSync(join(runtime.destination, 'lib/meta-theory', name), 'utf8')).join('\n');
  const registry = LinkedProgramRegistry.fromRml(program, { executionBasis: 'direct-structural' });
  const sample = JSON.parse(readFileSync(join(repositoryRoot, 'test-corpus/linked-proof/cases.json')))[0];
  const receipt = proof.verifyLinkedProof(registry, sample.context, sample.goal, sample.candidate);
  assert.equal(receipt.result[0], 'proof-accepted', 'the real linked verifier executed');
  assert.equal(receipt.accepted, false, 'the replaced implementation definition changed the verdict');
  const compilerArchive = changedModule('scripts/combinator-source.mjs', node => node.type === 'VariableDeclarator' && node.id.name === 'K', node => ({ ...node, init: { type: 'StringLiteral', value: 'S' } }));
  const compiler = await prepare('changed-compiler', compilerArchive).load('scripts/combinator-source.mjs');
  const source = '(bootstrap-source rml.bootstrap.fixed-point (schema rml-lambda-link-dag-v1) (representation addressed-doublet-network) (upstream-model network-duplet-function) (node-count 2) (root-count 1))\n(bootstrap-source-node n0 (variable x))\n(bootstrap-source-node n1 (lambda x n0))\n(bootstrap-source-root identity n1)\n';
  assert.deepEqual(compiler.compileCombinatorSource(source).roots.identity, [['S', 'S'], 'S']);
});

test('the archive generates its own codec and generator and reaches an exact second-generation fixed point', async () => {
  const runtime = prepare('self-generation');
  const generatedCodec = await runtime.load('scripts/linked-runtime-graph.mjs');
  const generatedGenerator = await runtime.load('scripts/linked-runtime-codegen.mjs');
  const restored = generatedCodec.decodeLinkedValues(JSON.parse(JSON.stringify(archive)));
  assert.deepEqual(generatedCodec.encodeLinkedValues(restored), archive);
  for (const item of manifest.modules) assert.equal(sha256(generatedGenerator.generateJavaScript(restored.modules[item.path])), item.generatedSha256, item.path);
  const generatorArchive = changedModule('scripts/linked-runtime-codegen.mjs', node => node.type === 'StringLiteral' && node.value === 'true', node => ({ ...node, value: 'false' }));
  const changedRuntime = prepare('changed-generator', generatorArchive);
  const changedGenerator = await changedRuntime.load('scripts/linked-runtime-codegen.mjs');
  assert.equal(changedGenerator.generateJavaScript({ type: 'BooleanLiteral', value: true }), 'false');
  assert.equal(generateJavaScript({ type: 'BooleanLiteral', value: true }), 'true');
  // Exercise code-generation replacement on the real proof replay API. Its
  // equality routine's final true now compiles to false, with unchanged input
  // proof rules, unchanged source AST, and unchanged Node execution machinery.
  writeFileSync(join(changedRuntime.destination, 'js/src/rml-linked-proof.mjs'), changedGenerator.generateJavaScript(restored.modules['js/src/rml-linked-proof.mjs']));
  const { LinkedProgramRegistry } = await changedRuntime.load('js/src/rml-linked-program.mjs');
  const proof = await changedRuntime.load('js/src/rml-linked-proof.mjs');
  const program = ['universal.lino', 'proof-verifier.lino'].map(name => readFileSync(join(changedRuntime.destination, 'lib/meta-theory', name), 'utf8')).join('\n');
  const registry = LinkedProgramRegistry.fromRml(program, { executionBasis: 'direct-structural' });
  const sample = JSON.parse(readFileSync(join(repositoryRoot, 'test-corpus/linked-proof/cases.json')))[0];
  const receipt = proof.verifyLinkedProof(registry, sample.context, sample.goal, sample.candidate);
  assert.equal(receipt.accepted, true);
  assert.equal(proof.replayLinkedProof(registry, sample.context, sample.goal, receipt).matches, false);
});

test('consistency rejects omitted modules and host-only semantic edits instead of silently capturing them', () => {
  const incomplete = decodeLinkedValues(archive); delete incomplete.modules['js/src/rml-lino-frontend.mjs'];
  assert.throws(() => checkLinkedImplementation(encodeLinkedValues(incomplete)), /inventory differs/);
  // A coherent mirror reconstructed from the pinned graph is enough to check
  // semantic consistency; original host source buffers are not consulted.
  const runtime = prepare('consistency');
  assert.equal(checkLinkedImplementation(archive, runtime.destination).sourceArtifactConsistency, true);
  writeFileSync(join(runtime.destination, 'js/src/rml-lino-frontend.mjs'), 'export const MAX_LINO_NESTING_DEPTH = 1;\n');
  assert.throws(() => checkLinkedImplementation(archive, runtime.destination), /host mirror differs/);
});
