import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('fresh checkout with spaces executes evaluator/exporter, meta checker and LSP CLIs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml CLI space checkout '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--local', '--no-hardlinks', '-q', source, root]);
  // Include the current working version so this regression also runs before commit.
  fs.cpSync(path.join(source, 'js/src'), path.join(root, 'js/src'), { recursive: true });
  fs.copyFileSync(path.join(source, 'scripts/lint-english.mjs'), path.join(root, 'scripts/lint-english.mjs'));
  fs.symlinkSync(path.join(source, 'js/node_modules'), path.join(root, 'js/node_modules'), 'junction');
  const run = (args, options = {}) => spawnSync(process.execPath, args, { cwd: path.join(root, 'js'), encoding: 'utf8', timeout: 15000, ...options });
  const exportFile = path.join(root, 'space export.v');
  const exported = run(['src/rml-links.mjs', 'export', 'rocq', '../examples/rocq-export.lino', '-o', exportFile]);
  assert.equal(exported.status, 0, exported.stderr);
  assert.ok(fs.readFileSync(exportFile, 'utf8').includes('Definition'));
  const meta = run(['src/rml-meta.mjs', '--help']);
  assert.equal(meta.status, 0, meta.stderr);
  assert.match(meta.stderr, /Usage: rml-meta/);
  const lint = run(['../scripts/lint-english.mjs', '--help']);
  assert.equal(lint.status, 0);
  assert.match(lint.stdout + lint.stderr, /Usage:/);
  const message = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const server = run(['src/rml-lsp.mjs'], { input: `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}` });
  assert.equal(server.status, 0, server.stderr);
  assert.match(server.stdout, /"capabilities"/);
});
