import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../lib/meta-theory/upstream-0.0.3-source/', import.meta.url));
const REVISION = '087f4515d0652925eecc54bcade724445c3978f1';
// Independently read from that commit's root tree
// e4397d53ace0988b067138ba22896738bc56ddac. The archive manifest is a
// transport inventory, so it cannot authorize its own replacement bytes.
const LICENSE_BLOB = 'fdddb29aa445bf3d6a5d843d6dd77e10a9f99657';
const SOURCE_TREES = [
  ['drafts/0.0.3/src/lean', '977dfc150ce95876661e15513ebf233caa3b0683'],
  ['drafts/0.0.3/src/rocq', '5aa564dd735aafc824164fbb37d97b24d658df15'],
];
const MODULES = ['MetaDefinitions', 'NetworkConversions', 'NetworkDefinitions', 'NetworkEquivalence', 'NetworkExamples', 'NetworkLemmas', 'SequenceDefinitions', 'SetDefinitions', 'SetSequenceEquivalence'];
const EXPECTED = ['LICENSE', ...MODULES.map(name => `drafts/0.0.3/src/lean/${name}.lean`), ...MODULES.map(name => `drafts/0.0.3/src/rocq/${name}.v`), 'drafts/0.0.3/src/lean/lakefile.lean', 'drafts/0.0.3/src/lean/lean-toolchain', 'drafts/0.0.3/src/rocq/_CoqProject'].sort();
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
function verifySourceTrees(blobs) {
  if (blobs.get('LICENSE') !== LICENSE_BLOB) throw new Error('archived source differs from pinned upstream Git blob: LICENSE');
  for (const [directory, expected] of SOURCE_TREES) {
    const entries = [...blobs].filter(([relative]) => relative.startsWith(`${directory}/`))
      .map(([relative, sha]) => ({ name: relative.slice(directory.length + 1), sha }));
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
    const payload = Buffer.concat(entries.map(({ name, sha }) =>
      Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(sha, 'hex')])));
    const actual = digest('sha1', Buffer.concat([Buffer.from(`tree ${payload.length}\0`), payload]));
    if (actual !== expected) throw new Error(`archived source differs from pinned upstream Git tree: ${directory}`);
  }
}
function read(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('unsafe archived source path');
  let location = path.resolve(root);
  if (fs.lstatSync(location).isSymbolicLink()) throw new Error('source archive refuses symlink roots');
  for (const part of relative.split('/')) {
    location = path.join(location, part);
    if (fs.lstatSync(location).isSymbolicLink()) throw new Error('source archive refuses symbolic-link substitution');
  }
  return fs.readFileSync(location);
}
export function verifyUpstreamSourceArchive(root = ROOT) {
  const manifest = JSON.parse(read(root, 'manifest.json'));
  if (manifest.schema !== 'rml-upstream-raw-source/v1' || manifest.repository !== 'https://github.com/link-foundation/meta-theory' || manifest.revision !== REVISION || manifest.formalModules !== 18 || manifest.projectConfigurations !== 3) throw new Error('unknown archived corpus contract');
  if (!Array.isArray(manifest.files) || JSON.stringify(manifest.files.map(file => file.path).sort()) !== JSON.stringify(EXPECTED)) throw new Error('archived corpus file inventory is incomplete or duplicated');
  const observed = [];
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('source archive refuses symbolic-link substitution');
      if (entry.isDirectory()) walk(path.join(directory, entry.name), `${relative}/`);
      else if (relative !== 'manifest.json') observed.push(relative);
    }
  };
  walk(root);
  if (JSON.stringify(observed.sort()) !== JSON.stringify(EXPECTED)) throw new Error('archived source files differ from the complete manifest');
  let totalBytes = 0;
  const blobs = new Map();
  for (const file of manifest.files) {
    const bytes = read(root, file.path);
    const gitBlob = digest('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
    if (bytes.length !== file.bytes || digest('sha256', bytes) !== file.sha256 || gitBlob !== file.gitBlob) throw new Error(`archived source bytes changed: ${file.path}`);
    blobs.set(file.path, gitBlob);
    totalBytes += bytes.length;
  }
  verifySourceTrees(blobs);
  return { revision: REVISION, files: 22, formalModules: 18, projectConfigurations: 3, totalBytes };
}
