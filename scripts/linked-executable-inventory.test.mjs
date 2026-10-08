import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { after, test } from 'node:test';
import { discoverExecutableInventory, assertJavaScriptDependencyClosure } from './linked-executable-inventory.mjs';
import { checkCurrentLinkedImplementation } from './check-linked-implementation.mjs';
import { readLinkedImplementation, emitLinkedImplementation, implementationModules, parseJavaScriptAst, repositoryRoot } from './generate-linked-runtime.mjs';
import { readImplementationConfiguration, emitImplementationConfiguration } from './linked-implementation-configuration.mjs';
import { decodeLinkedValues, encodeLinkedValues } from './linked-runtime-graph.mjs';
import { LspClient } from '../vscode/test/lsp-client.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'rml-executable-authority-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const archive = readLinkedImplementation(), configuration = readImplementationConfiguration();
const sha = value => createHash('sha256').update(value).digest('hex');
let serial = 0;
function write(root, path, text) { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
function prepare(source = archive) {
  const root = join(scratch, `runtime-${serial++}`); emitLinkedImplementation(source, root); emitImplementationConfiguration(configuration, root);
  for (const pkg of ['js', 'vscode']) symlinkSync(join(repositoryRoot, pkg, 'node_modules'), join(root, pkg, 'node_modules'), 'dir');
  mkdirSync(join(root, 'js/vendor'), { recursive: true }); symlinkSync(join(repositoryRoot, 'js/vendor/meta-language'), join(root, 'js/vendor/meta-language'), 'dir');
  return root;
}
function invoke(root, command, args) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); return result.stdout;
}
function replace(module, predicate, edit) {
  let count = 0;
  function visit(value) { if (!value || typeof value !== 'object') return; if (predicate(value)) { edit(value); count += 1; } for (const child of Object.values(value)) visit(child); }
  visit(module); return count;
}

test('discovery covers maintained editor, browser, examples and Rust targets with explicit provider/evidence roles', () => {
  const inventory = discoverExecutableInventory(repositoryRoot), modules = implementationModules(archive);
  for (const path of ['vscode/src/extension.js', 'vscode/src/server.js', 'vscode/scripts/copy-server.mjs', 'docs/playground/app.mjs', 'docs/playground/rml-playground-runtime.mjs', 'examples/meta-theory-network.mjs', 'experiments/definition-replacement/k1-replacement.mjs']) assert.ok(inventory.javascript.includes(path) && Object.hasOwn(modules, path), path);
  assert.ok(inventory.rust.includes('rust/examples/cst_roundtrip_demo.rs'));
  assert.ok(inventory.providers.includes('docker/run-owned.sh'));
  assert.ok(inventory.evidence.includes('vscode/test/lsp-client.mjs'));
  assert.ok(inventory.configuration.includes('vscode/package-lock.json'));
  assert.ok(inventory.entrypoints.some(e => e.from === 'vscode/package.json' && e.target === 'vscode/src/extension.js'));
  assert.ok(inventory.entrypoints.some(e => e.from === 'docs/playground/index.html' && e.target === 'docs/playground/app.mjs'));
  assert.ok(inventory.entrypoints.some(e => e.role.startsWith('cargo-')));
  assertJavaScriptDependencyClosure(modules, repositoryRoot);
});

test('a new executable outside legacy source roots changes the complete inventory and cannot hide in an unsupported language', () => {
  const root = join(scratch, 'outside-roots'); mkdirSync(root);
  write(root, 'new-product/start.mjs', 'export const decision = true;\n');
  write(root, 'new-product/package.json', JSON.stringify({ main: './start.mjs' }));
  assert.deepEqual(discoverExecutableInventory(root).javascript, ['new-product/start.mjs']);
  write(root, 'unregistered/parser.py', 'print("host-only semantic rule")\n');
  assert.throws(() => discoverExecutableInventory(root), /unclassified maintained executable.*parser\.py/);
});

test('Rust source modules cannot hide implementation behind a test-like filename', () => {
  const root = join(scratch, 'rust-source-names'); mkdirSync(root);
  write(root, 'crate/Cargo.toml', '[package]\nname="source-names"\nversion="0.1.0"\nedition="2021"\n');
  write(root, 'crate/src/lib.rs', 'mod semantic_tests; pub use semantic_tests::decision;\n');
  write(root, 'crate/src/semantic_tests.rs', 'pub fn decision() -> bool { true }\n');
  write(root, 'crate/tests/independent.rs', '#[test] fn independent() {}\n');
  const inventory = discoverExecutableInventory(root);
  assert.deepEqual(inventory.rust, ['crate/src/lib.rs', 'crate/src/semantic_tests.rs']);
  assert.ok(inventory.evidence.includes('crate/tests/independent.rs'));
});

test('public entrypoints and static imports cannot point into unrepresented evidence or escape the repository', () => {
  const root = join(scratch, 'entrypoint-negative'); mkdirSync(root);
  write(root, 'app/start.mjs', 'export const value = 1;\n'); write(root, 'test/hidden.mjs', 'export const value = 2;\n');
  write(root, 'app/package.json', JSON.stringify({ main: '../test/hidden.mjs' }));
  assert.throws(() => discoverExecutableInventory(root), /public entrypoint is not represented/);
  write(root, 'app/package.json', JSON.stringify({ main: '../../outside.mjs' }));
  assert.throws(() => discoverExecutableInventory(root), /escaping public entrypoint/);
  write(root, 'app/package.json', JSON.stringify({ main: './start.mjs' }));
  assert.throws(() => assertJavaScriptDependencyClosure({ 'app/start.mjs': { type: 'ImportDeclaration', source: { type: 'StringLiteral', value: '../test/hidden.mjs' } } }, root), /imports unrepresented/);
  write(root, 'ui/index.html', '<script>runUnrepresentedDecision()</script>');
  assert.throws(() => discoverExecutableInventory(root), /inline browser code/);
});

test('the ordinary current-tree guard rejects a new outside-root executable and an unrepresented public entrypoint', () => {
  const root = prepare();
  // Rust source mirrors are checking inputs here; execution tests below consume
  // only reconstructed JavaScript. No Rust host file is executed by this test.
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'lib/linked-runtime/rust-manifest.json')));
  for (const item of manifest.modules) { mkdirSync(dirname(join(root, item.path)), { recursive: true }); cpSync(join(repositoryRoot, item.path), join(root, item.path)); }
  for (const name of ['manifest.json', 'implementation.links.json.gz', 'rust-manifest.json', 'rust-implementation.links.json.gz', 'configuration-manifest.json', 'configuration.links.json.gz']) {
    mkdirSync(join(root, 'lib/linked-runtime'), { recursive: true }); cpSync(join(repositoryRoot, 'lib/linked-runtime', name), join(root, 'lib/linked-runtime', name));
  }
  assert.equal(checkCurrentLinkedImplementation(root).currentTreeConsistent, true);
  write(root, 'new-product/hidden-decision.mjs', 'export const accepted = true;\n');
  assert.throws(() => checkCurrentLinkedImplementation(root), /owned implementation inventory differs/);
  rmSync(join(root, 'new-product'), { recursive: true });
  const packagePath = join(root, 'vscode/package.json'), pkg = JSON.parse(readFileSync(packagePath));
  pkg.main = './test/hidden.mjs'; writeFileSync(packagePath, JSON.stringify(pkg)); write(root, 'vscode/test/hidden.mjs', 'export const activate = () => {};\n');
  assert.throws(() => checkCurrentLinkedImplementation(root), /public entrypoint is not represented/);
  pkg.main = './src/extension.js'; pkg.type = 'module'; writeFileSync(packagePath, JSON.stringify(pkg));
  assert.throws(() => checkCurrentLinkedImplementation(root), /syntax mode differs from package loader/);
});

test('source-free generated VS Code packaging, existing editor/LSP tests and playground tests execute', () => {
  const root = prepare();
  assert.equal(existsSync(join(root, 'js/tests/lsp.test.mjs')), false, 'runtime sources came from graphs, not a checkout copy');
  cpSync(join(repositoryRoot, 'vscode/test'), join(root, 'vscode/test'), { recursive: true });
  mkdirSync(join(root, 'js/tests'), { recursive: true }); cpSync(join(repositoryRoot, 'js/tests/lsp.test.mjs'), join(root, 'js/tests/lsp.test.mjs'));
  cpSync(join(repositoryRoot, 'scripts/playground.test.mjs'), join(root, 'scripts/playground.test.mjs'));
  invoke(root, process.execPath, ['vscode/scripts/copy-server.mjs']);
  assert.equal(readFileSync(join(root, 'vscode/server/rml-lsp.mjs'), 'utf8'), readFileSync(join(root, 'js/src/rml-lsp.mjs'), 'utf8'));
  const editor = invoke(join(root, 'vscode'), process.execPath, ['--test', '--test-reporter=tap', 'test/manifest.test.mjs', 'test/server-resolution.test.mjs']);
  const lsp = invoke(join(root, 'js'), process.execPath, ['--test', '--test-reporter=tap', 'tests/lsp.test.mjs']);
  invoke(root, process.execPath, ['scripts/build-playground.mjs']);
  assert.deepEqual(parseJavaScriptAst(readFileSync(join(root, 'docs/playground/rml-playground-runtime.mjs'), 'utf8')), implementationModules(archive)['docs/playground/rml-playground-runtime.mjs'], 'rebuilt browser artifact retains its authoritative syntax');
  const browser = invoke(root, process.execPath, ['--test', '--test-reporter=tap', 'scripts/playground.test.mjs']);
  for (const output of [editor, lsp, browser]) { assert.match(output, /(?:#|ℹ) fail 0/); assert.doesNotMatch(output, /# SKIP/); }
  console.log(JSON.stringify({ sourceFreeEditorTests: Number(editor.match(/(?:#|ℹ) pass (\d+)/)?.[1]), sourceFreeLspTests: Number(lsp.match(/(?:#|ℹ) pass (\d+)/)?.[1]), sourceFreePlaygroundTests: Number(browser.match(/(?:#|ℹ) pass (\d+)/)?.[1]) }));
});

function activateGeneratedExtension(root) {
  const records = [], require = createRequire(join(root, 'vscode/package.json'));
  const platform = { workspace: { getConfiguration: () => ({}), createFileSystemWatcher: pattern => ({ pattern }) } };
  class LanguageClient { constructor(...args) { records.push({ args }); } start() { records.at(-1).started = true; } stop() { records.at(-1).stopped = true; } }
  const module = { exports: {} };
  new Script(readFileSync(join(root, 'vscode/src/extension.js'), 'utf8')).runInNewContext({ module, exports: module.exports, require: name => name === 'vscode' ? platform : name === 'vscode-languageclient/node' ? { LanguageClient } : require(name === './server' ? './src/server.js' : name) });
  module.exports.activate({ extensionPath: join(root, 'vscode') }); module.exports.deactivate(); return records[0];
}

test('replacing editor-selection Links changes actual generated extension activation on unchanged host capabilities', () => {
  const base = prepare(), value = decodeLinkedValues(archive);
  assert.equal(replace(value.modules['vscode/src/server.js'], n => n.type === 'ObjectProperty' && n.key.name === 'language' && n.value.value === 'lino', n => { n.value.value = 'plaintext'; }), 2);
  const changed = prepare(encodeLinkedValues(value));
  const a = activateGeneratedExtension(base), b = activateGeneratedExtension(changed);
  assert.equal(a.started && a.stopped && b.started && b.stopped, true);
  assert.deepEqual(Array.from(a.args[3].documentSelector, x => x.language), ['lino', 'lino']);
  assert.deepEqual(Array.from(b.args[3].documentSelector, x => x.language), ['plaintext', 'plaintext']);
});

test('replacing a diagnostic decision in Link AST changes a real source-free LSP response', async () => {
  const before = sha(readFileSync(join(repositoryRoot, 'scripts/linked-runtime-codegen.mjs')));
  const value = decodeLinkedValues(archive);
  assert.equal(replace(value.modules['js/src/rml-lsp.mjs'], n => n.type === 'ObjectProperty' && n.key.name === 'severity' && n.value.type === 'ConditionalExpression', n => { n.value = { type: 'NumericLiteral', value: 2 }; }), 1);
  const roots = [prepare(), prepare(encodeLinkedValues(value))], levels = [];
  for (const root of roots) {
    const require = createRequire(join(root, 'vscode/package.json'));
    const server = require('./src/server.js').resolveServerCommand(join(root, 'vscode'), {});
    const client = new LspClient(server.command, server.args, server.options);
    try {
      assert.ifError((await client.request('initialize', { processId: process.pid, capabilities: {} })).error);
      const uri = 'file:///workspace/linked-editor-decision.lino';
      client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'lino', version: 1, text: '(=: missing_op identity)\n' } });
      const message = await client.waitForNotification('textDocument/publishDiagnostics', p => p.uri === uri && p.diagnostics.length === 1);
      assert.equal(message.params.diagnostics[0].code, 'E001'); levels.push(message.params.diagnostics[0].severity);
      await client.request('shutdown', null); client.notify('exit', null);
    } finally { await client.close(); }
  }
  assert.deepEqual(levels, [1, 2]);
  assert.equal(sha(readFileSync(join(repositoryRoot, 'scripts/linked-runtime-codegen.mjs'))), before);
});
