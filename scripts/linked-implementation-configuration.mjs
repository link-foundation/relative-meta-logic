/** Build configuration, directly linked libraries and generic providers are data.
 * JavaScript and Rust executable sources use the separate structured AST graphs.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { encodeLinkedValues, decodeLinkedValues } from './linked-runtime-graph.mjs';
import { discoverExecutableInventory, isGenericExecutableProvider, safeImplementationPath, isJavaScriptImplementationPath, isRustImplementationPath } from './linked-executable-inventory.mjs';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const archivePath = 'lib/linked-runtime/configuration.links.json.gz';
const manifestPath = 'lib/linked-runtime/configuration-manifest.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const configurationFile = path => /^(js\/(package(?:-lock)?\.json|vendor\/meta-language-provenance\.json)|rust\/(?:[A-Za-z0-9_-]+\/)*Cargo\.(toml|lock)|scripts\/linked-runtime-rust\/Cargo\.(toml|lock)|scripts\/cache-policy\.json|\.gitmodules|rust-toolchain(?:\.toml)?)$/.test(path);
const libraryFile = path => !isJavaScriptImplementationPath(path) && !isRustImplementationPath(path) && path.startsWith('lib/') && (!path.startsWith('lib/linked-runtime/') || path.endsWith('.lino'));
const providerFile = path => /^scripts\/[A-Za-z0-9_/-]+\.ps1$/.test(path) || path.startsWith('scripts/linked-runtime-rust/vendor/') || (path.startsWith('.github/candidates/') && (!path.endsWith('.mjs') || path.endsWith('.test.mjs')));
const workflowFile = path => /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(path);
const allowed = path => safeImplementationPath(path) && ((!isJavaScriptImplementationPath(path) && !isRustImplementationPath(path)) || providerFile(path) || isGenericExecutableProvider(path));

export function implementationConfigurationInventory(root = repositoryRoot) {
  const discovered = discoverExecutableInventory(root);
  const paths = new Set([...discovered.configuration, ...discovered.providers]);
  function visit(directory, accept) {
    if (!existsSync(resolve(root, directory))) return;
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new TypeError(`configuration inventory refuses symlink: ${path}`);
      if (entry.isDirectory() && !['target', '.git', '.rml-cache', 'node_modules'].includes(entry.name)) visit(path, accept);
      else if (entry.isFile() && accept(path)) paths.add(path);
    }
  }
  for (const path of ['js/package.json', 'js/package-lock.json', 'js/vendor/meta-language-provenance.json', '.gitmodules', 'rust-toolchain', 'rust-toolchain.toml', 'scripts/cache-policy.json', 'scripts/linked-runtime-rust/Cargo.toml', 'scripts/linked-runtime-rust/Cargo.lock']) if (existsSync(resolve(root, path))) paths.add(path);
  visit('rust', configurationFile);
  visit('lib', libraryFile);
  visit('scripts', providerFile);
  visit('.github/candidates', providerFile);
  visit('.github/workflows', workflowFile);
  return [...paths].sort();
}

function providersFromFiles(files) {
  const providers = [];
  const npmLocks = Object.entries(files).filter(([path]) => /(?:^|\/)package-lock\.json$/.test(path));
  if (!npmLocks.some(([path]) => path === 'js/package-lock.json')) throw new TypeError('npm lock inventory required');
  for (const [lockPath, lock] of npmLocks) {
    if (lock.format !== 'json' || !lock.value.packages) throw new TypeError(`npm lock inventory required: ${lockPath}`);
    for (const [path, item] of Object.entries(lock.value.packages)) if (path) {
      if (typeof item.version !== 'string') throw new TypeError(`unversioned npm provider: ${lockPath} ${path}`);
      providers.push({ family: 'npm', lock: lockPath, path, version: item.version, resolved: item.resolved ?? null, integrity: item.integrity ?? null });
    }
  }
  for (const [path, file] of Object.entries(files)) if (path.endsWith('/Cargo.lock')) {
    const blocks = file.value.split(/(?:^|\n)\[\[package\]\]\r?\n/).slice(1);
    if (!blocks.length) throw new TypeError(`Cargo package inventory missing: ${path}`);
    for (const block of blocks) {
      const field = name => block.match(new RegExp(`^${name} = "([^"\\n]+)"`, 'm'))?.[1];
      const name = field('name'), version = field('version');
      if (!name || !version) throw new TypeError(`malformed Cargo package inventory: ${path}`);
      providers.push({ family: 'cargo', lock: path, name, version, source: field('source') ?? 'local-path', checksum: field('checksum') ?? null });
    }
  }
  for (const path of Object.keys(files).filter(path => providerFile(path) || /(?:\.sh|\.ps1)$/.test(path) || path.startsWith('docker/Dockerfile') || path === '.githooks/pre-commit')) providers.push({ family: 'pinned-generic-source', path });
  return providers;
}

export function captureImplementationConfiguration(root = repositoryRoot) {
  const files = {};
  for (const path of implementationConfigurationInventory(root)) {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(resolve(root, path)));
    files[path] = path.endsWith('.json') ? { format: 'json', value: JSON.parse(text) } : { format: 'text', value: text };
  }
  return encodeLinkedValues({ format: 'rml-build-configuration/v1', files, providers: providersFromFiles(files) });
}

export function implementationConfigurationFiles(archive) {
  const value = decodeLinkedValues(archive);
  if (value?.format !== 'rml-build-configuration/v1' || Object.keys(value).sort().join(',') !== 'files,format,providers' || !value.files || !Object.keys(value.files).length) throw new TypeError('invalid linked configuration archive');
  const files = {};
  for (const [path, record] of Object.entries(value.files)) {
    if (!allowed(path) || Object.keys(record).sort().join(',') !== 'format,value' || !['text', 'json'].includes(record.format) || (record.format === 'text' && typeof record.value !== 'string')) throw new TypeError(`invalid linked configuration file: ${path}`);
    files[path] = record.format === 'json' ? `${JSON.stringify(record.value, null, 2)}\n` : record.value;
  }
  if (!isDeepStrictEqual(providersFromFiles(value.files), value.providers)) throw new TypeError('configuration provider inventory differs from declared dependency locks');
  return files;
}

export function emitImplementationConfiguration(archive, destination) {
  const files = implementationConfigurationFiles(archive);
  for (const [path, text] of Object.entries(files)) { const target = resolve(destination, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); }
  return Object.keys(files).length;
}

export function saveImplementationConfiguration(archive, root = repositoryRoot) {
  const files = implementationConfigurationFiles(archive);
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(implementationConfigurationInventory(root))) throw new TypeError('configuration inventory differs from current tree');
  const bytes = gzipSync(`${JSON.stringify(archive)}\n`, { level: 9 });
  const manifest = { schema: 'rml-linked-configuration-manifest/v1', archiveSha256: hash(bytes), archiveBytes: bytes.length, linkCount: archive.links.length,
    providerScope: 'declared npm/Cargo dependency closures, vendored syntax adapter, and owned generic OS metadata helpers',
    externalExecutionBoundary: ['Node/V8, Cargo/rustc/LLVM and PowerShell generic language/tool semantics', 'operating-system services and physical hardware', 'explicit user-selected input programs and external tools'],
    files: Object.entries(files).map(([path, text]) => ({ path, sourceSha256: hash(readFileSync(resolve(root, path))), generatedSha256: hash(text) })) };
  mkdirSync(dirname(resolve(root, archivePath)), { recursive: true });
  writeFileSync(resolve(root, archivePath), bytes);
  writeFileSync(resolve(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readImplementationConfiguration(root = repositoryRoot) {
  const bytes = readFileSync(resolve(root, archivePath));
  const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'));
  if (manifest.schema !== 'rml-linked-configuration-manifest/v1' || hash(bytes) !== manifest.archiveSha256) throw new TypeError('linked configuration artifact hash mismatch');
  const archive = JSON.parse(gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }));
  const files = implementationConfigurationFiles(archive);
  if (JSON.stringify(Object.keys(files)) !== JSON.stringify(manifest.files.map(item => item.path))) throw new TypeError('linked configuration manifest inventory mismatch');
  for (const item of manifest.files) if (hash(files[item.path]) !== item.generatedSha256) throw new TypeError(`linked configuration generated hash mismatch: ${item.path}`);
  return archive;
}

export function checkImplementationConfiguration(root = repositoryRoot) {
  const archive = readImplementationConfiguration(root);
  const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'));
  if (JSON.stringify(implementationConfigurationInventory(root)) !== JSON.stringify(manifest.files.map(item => item.path))) throw new TypeError('current configuration/provider inventory differs from linked archive');
  for (const item of manifest.files) if (![item.sourceSha256, item.generatedSha256].includes(hash(readFileSync(resolve(root, item.path))))) throw new TypeError(`configuration/provider differs from linked source: ${item.path}`);
  return { files: manifest.files.length, providers: decodeLinkedValues(archive).providers.length, currentTreeConsistent: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode] = process.argv.slice(2);
  if (mode === '--capture' && process.argv.length === 3) console.log(JSON.stringify(saveImplementationConfiguration(captureImplementationConfiguration()), null, 2));
  else if (mode === '--check' && process.argv.length === 3) console.log(JSON.stringify(checkImplementationConfiguration(), null, 2));
  else throw new Error('Usage: node scripts/linked-implementation-configuration.mjs --capture | --check');
}
