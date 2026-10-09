import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const sourceDir = path.join(repoRoot, 'js', 'src');
const targetDir = path.join(extensionRoot, 'server');

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Cannot find RML JavaScript sources at ${sourceDir}`);
}

if (fs.lstatSync(targetDir, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Staged server output may not be a symlink');
fs.mkdirSync(targetDir, { recursive: true });
let producer;
if (process.env.RML_CACHE_LEASE && process.env.RML_CACHE_PRODUCTION) {
  producer = await import('../../scripts/build-cache.mjs');
  const cache = producer.context(repoRoot);
  if (!producer.inheritedLease(cache)) throw new Error('Staged server output requires a verified producer lease');
  producer.cleanup(cache, { full: true, onlyRoots: ['vscode/server'] });
}

let copied = 0;
for (const entry of fs.readdirSync(sourceDir)) {
  if (!entry.endsWith('.mjs')) continue;
  const output = path.join(targetDir, entry);
  const bytes = fs.readFileSync(path.join(sourceDir, entry));
  if (fs.existsSync(output) && fs.lstatSync(output).isFile() && fs.readFileSync(output).equals(bytes)) continue;
  if (producer) producer.writeProducedFile(`vscode/server/${entry}`, bytes);
  else fs.copyFileSync(path.join(sourceDir, entry), output, fs.constants.COPYFILE_EXCL);
  copied += 1;
}

console.log(`Copied ${copied} RML language server source files to ${path.relative(extensionRoot, targetDir)}.`);
