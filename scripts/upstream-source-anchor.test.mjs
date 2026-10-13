import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyUpstreamSourceArchive } from './upstream-source-archive.mjs';

const archive = fileURLToPath(new URL('../lib/meta-theory/upstream-0.0.3-source/', import.meta.url));
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

test('complete archived directories match independently pinned upstream Git trees', () => {
  assert.equal(verifyUpstreamSourceArchive().files, 22);
});

for (const relative of [
  'drafts/0.0.3/src/lean/MetaDefinitions.lean',
  'drafts/0.0.3/src/rocq/NetworkEquivalence.v',
  'drafts/0.0.3/src/lean/lakefile.lean',
  'drafts/0.0.3/src/lean/lean-toolchain',
  'drafts/0.0.3/src/rocq/_CoqProject',
  'LICENSE',
]) {
  test(`rejects changed upstream bytes despite reauthored manifest hashes: ${relative}`, context => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-source-anchor-'));
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.cpSync(archive, root, { recursive: true });
    fs.appendFileSync(path.join(root, relative), '\nchanged source bytes\n');
    const bytes = fs.readFileSync(path.join(root, relative));
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = manifest.files.find(file => file.path === relative);
    entry.bytes = bytes.length;
    entry.sha256 = hash('sha256', bytes);
    entry.gitBlob = hash('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => verifyUpstreamSourceArchive(root), /pinned upstream Git (tree|blob)/);
  });
}

test('manifest ordering does not change the independently checked Git tree', context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-source-anchor-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(archive, root, { recursive: true });
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files.reverse();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(verifyUpstreamSourceArchive(root).files, 22);
});
