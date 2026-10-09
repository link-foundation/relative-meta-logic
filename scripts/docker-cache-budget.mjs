#!/usr/bin/env node
/** Exact-resource Docker accounting. Logical sizes include shared layers and are
 * deliberately conservative; these are not physical allocation/reclaim figures. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ownerLabel = 'org.link-foundation.rml.owner';
const runLabel = 'org.link-foundation.rml.run';
const immutableImage = /^sha256:[0-9a-f]{64}$/;
const resourceName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}$/;
export function byteCount(value, description) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`${description}: exact non-negative integer bytes required`);
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes)) throw new Error(`${description}: byte count exceeds safe integer range`);
  return bytes;
}
const add = (a, b) => byteCount(a + b, 'Aggregate Docker size');
function command(run, args) {
  return run('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 32 * 1024 * 1024 }).trim();
}
function inspect(run, args, { missing = false } = {}) {
  let source;
  try { source = command(run, [...args, '--format', '{{json .}}']); }
  catch (error) {
    // An unavailable daemon, permission error or unsupported CLI is NOT absence.
    if (missing && /(?:No such (?:image|volume|object|container)|no such (?:image|volume|object|container))/i.test(String(error.stderr ?? ''))) return null;
    throw new Error(`Docker accounting failed (${args.join(' ')}): ${String(error.stderr ?? error.message).trim()}`);
  }
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected one object');
    return parsed;
  }
  catch { throw new Error(`Docker accounting requires JSON (${args.join(' ')})`); }
}
function validateManifest(root, record) {
  if (record.kind === 'docker-container') {
    if (record.version !== 1 || record.root !== fs.realpathSync(root) || !resourceName.test(record.name) ||
        typeof record.owner !== 'string' || !record.owner || typeof record.run !== 'string' || !record.run ||
        typeof record.cidfile !== 'string' || !record.cidfile || !['running', 'cleaning'].includes(record.phase)) throw new Error('Invalid or foreign Docker container ownership/accounting manifest');
    cidfilePath(root, record.cidfile);
    return;
  }
  if (record.version !== 1 || record.kind !== 'buildx' || record.root !== fs.realpathSync(root) ||
      !resourceName.test(record.builder) || record.container !== `buildx_buildkit_${record.builder}0` || record.volume !== `${record.container}_state` ||
      typeof record.owner !== 'string' || !record.owner || typeof record.run !== 'string' || !record.run ||
      !Array.isArray(record.images) || record.images.some(id => !immutableImage.test(id)) || new Set(record.images).size !== record.images.length ||
      !['provisioning', 'ready', 'cleaning'].includes(record.phase) ||
      (record.phase === 'ready' && (typeof record.containerId !== 'string' || !record.containerId || typeof record.builderEndpoint !== 'string' || !record.builderEndpoint)) ||
      (record.phase === 'provisioning' && record.images.length)) throw new Error('Invalid or foreign Docker ownership/accounting manifest');
}
function cidfilePath(root, relative) {
  if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid Docker CID path');
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() || (stat?.isFile() && stat.nlink !== 1)) throw new Error('Unsafe Docker CID path');
  }
  return current;
}
function ownedLabels(record, labels, target) {
  if (labels?.[ownerLabel] !== record.owner || labels?.[runLabel] !== record.run) throw new Error(`Docker ownership mismatch: ${target}`);
}
export function verifyDockerBuilder(record, { run = execFileSync } = {}) {
  // Buildx inspect does not support --format. Verify the narrowly documented
  // identity fields and fail closed if the single-node format is unsupported.
  const source = command(run, ['buildx', 'inspect', record.builder]);
  const names = [...source.matchAll(/^Name:\s*(\S+)\s*$/gm)].map(match => match[1]);
  const endpoints = [...source.matchAll(/^Endpoint:\s*(\S+)\s*$/gm)].map(match => match[1]);
  if (names.length !== 2 || names[0] !== record.builder || names[1] !== `${record.builder}0` ||
      !/^Driver:\s*docker-container\s*$/m.test(source) || endpoints.length !== 1 ||
      (record.builderEndpoint && record.builderEndpoint !== endpoints[0])) throw new Error('Docker builder node, driver or endpoint identity changed');
  return endpoints[0];
}
export function measureDockerResource(record, { run = execFileSync } = {}) {
  // No build is submitted during bootstrap. The shared BuildKit runtime image
  // is not an owned cache; an empty newly created builder has no cache records.
  if (record.phase === 'provisioning') return { bytes: 0, builderBytes: 0, imageBytes: 0, phase: record.phase };
  if (record.phase === 'cleaning') return { bytes: byteCount(record.upperBoundBytes, 'Docker teardown upper bound'), phase: record.phase };
  verifyDockerBuilder(record, { run });
  const volume = inspect(run, ['volume', 'inspect', record.volume]);
  if (volume.Name !== record.volume) throw new Error('Docker state volume identity changed');
  ownedLabels(record, volume.Labels, record.volume);
  const container = inspect(run, ['inspect', '--type', 'container', record.container]);
  if (container.Id !== record.containerId || !Array.isArray(container.Mounts) ||
      container.Mounts.filter(m => m.Destination === '/var/lib/buildkit').length !== 1 ||
      !container.Mounts.some(m => m.Destination === '/var/lib/buildkit' && m.Name === record.volume && m.Type === 'volume')) throw new Error('Docker builder container identity or state mount changed');
  let records;
  try { records = command(run, ['buildx', 'du', '--builder', record.builder, '--format=json']).split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { throw new Error(`BuildKit exact-byte accounting unavailable: ${error.message}`); }
  const ids = new Set();
  let builderBytes = 0;
  for (const entry of records) {
    if (typeof entry.ID !== 'string' || !entry.ID || ids.has(entry.ID)) throw new Error('Invalid or duplicate BuildKit cache record');
    ids.add(entry.ID);
    builderBytes = add(builderBytes, byteCount(entry.Size, 'BuildKit record size'));
  }
  let imageBytes = 0;
  for (const imageId of record.images) {
    const image = inspect(run, ['image', 'inspect', imageId]);
    if (image.Id !== imageId) throw new Error('Docker image identity changed');
    ownedLabels(record, image.Config?.Labels, imageId);
    imageBytes = add(imageBytes, byteCount(image.Size, 'Docker image size'));
  }
  return { bytes: add(builderBytes, imageBytes), builderBytes, imageBytes, phase: record.phase };
}
export function measureDockerContainer(record, { run = execFileSync } = {}) {
  if (record.phase === 'cleaning') return { bytes: byteCount(record.upperBoundBytes, 'Docker teardown upper bound'), phase: record.phase };
  const file = cidfilePath(record.root, record.cidfile);
  const id = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
  if (id !== null && !/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid immutable Docker container ID');
  const container = inspect(run, ['container', 'inspect', id ?? record.name, '--size'], { missing: true });
  if (!container) {
    if (id) throw new Error('Previously recorded Docker container disappeared before teardown');
    return { bytes: 0, containerBytes: 0, phase: 'not-created' };
  }
  if (!id || container.Id !== id || container.Name !== `/${record.name}`) throw new Error('Docker container immutable identity or name changed');
  ownedLabels(record, container.Config?.Labels, id);
  const bytes = byteCount(container.SizeRw, 'Docker container writable-layer size');
  return { bytes, containerBytes: bytes, phase: record.phase };
}
const measureResource = (record, options) => record.kind === 'docker-container' ? measureDockerContainer(record, options) : measureDockerResource(record, options);
export function measureDockerCaches(root, { run = execFileSync, excludeLease } = {}) {
  const directory = path.join(root, '.rml-cache', 'evidence');
  if (fs.lstatSync(path.join(root, '.rml-cache'), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Docker accounting directory may not be a symlink');
  if (!fs.existsSync(directory)) return { bytes: 0, resources: [] };
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Docker accounting directory may not be a symlink');
  const resources = [];
  let bytes = 0;
  for (const name of fs.readdirSync(directory).filter(name => /^external-lease-.*\.json$/.test(name)).sort()) {
    const file = path.join(directory, name);
    if (file === excludeLease) continue;
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue; // Completed helper removed its lease before inspection.
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe Docker accounting lease');
    let source;
    try { source = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const record = JSON.parse(source);
    if (!['buildx', 'docker-container'].includes(record.kind)) throw new Error('Unsupported external-resource cache accounting lease');
    validateManifest(root, record);
    let measured;
    try { measured = measureResource(record, { run }); }
    catch (error) {
      // Publication/removal is atomic. A completed teardown may invalidate the
      // snapshot between reads; only a changed, validated manifest permits retry.
      const next = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (next === source) throw error;
      if (next === null) continue;
      const updated = JSON.parse(next);
      validateManifest(root, updated);
      measured = measureResource(updated, { run });
    }
    bytes = add(bytes, measured.bytes);
    resources.push({ kind: record.kind, name: record.builder ?? record.name, ...measured });
  }
  return { bytes, resources };
}
function safeWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = fs.lstatSync(file, { throwIfNoEntry: false });
  if (previous && (!previous.isFile() || previous.nlink !== 1)) throw new Error('Unsafe Docker report or lease path');
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, file);
}
async function localState(root) {
  const { context, localCacheBytes, policy } = await import('./build-cache.mjs');
  const c = context(root);
  return { localBytes: localCacheBytes(c), budgetBytes: byteCount(process.env.RML_CACHE_BUDGET_BYTES ?? policy.budgetBytes, 'RML_CACHE_BUDGET_BYTES') };
}
async function main() {
  const [action, lease, ...args] = process.argv.slice(2);
  const root = fs.realpathSync(process.cwd());
  for (const relative of ['.rml-cache', '.rml-cache/evidence', '.rml-cache/reports', '.rml-cache/containers']) {
    if (fs.lstatSync(path.join(root, relative), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Unsafe Docker accounting path: ${relative}`);
  }
  if (!lease || path.resolve(lease) !== path.join(root, '.rml-cache', 'evidence', path.basename(lease)) || !/^external-lease-rml-[\w.-]+\.json$/.test(path.basename(lease))) throw new Error('Invalid Docker lease path');
  if (action === 'container-init') {
    const [owner, run, name, cidfile] = args;
    const record = { version: 1, kind: 'docker-container', root, owner, run, name, cidfile: path.relative(root, path.resolve(cidfile)).split(path.sep).join('/'), phase: 'running' };
    validateManifest(root, record);
    if (fs.existsSync(lease)) throw new Error('Refusing existing Docker container lease');
    safeWrite(lease, record);
    return;
  }
  if (action === 'init') {
    const [owner, run, builder, configPath] = args;
    const record = { version: 1, kind: 'buildx', root, owner, run, builder, container: `buildx_buildkit_${builder}0`, volume: `buildx_buildkit_${builder}0_state`, images: [], phase: 'provisioning' };
    validateManifest(root, record);
    const local = await localState(root);
    if (local.localBytes >= local.budgetBytes) throw new Error('Aggregate cache budget leaves no space for a Docker build');
    if (fs.existsSync(lease)) throw new Error('Refusing existing Docker ownership lease');
    safeWrite(lease, record);
    const template = fs.readFileSync(path.join(root, 'docker', 'buildkitd.toml'), 'utf8');
    const { context, validatePath, roots } = await import('./build-cache.mjs');
    const c = context(root);
    const relative = path.relative(root, path.resolve(configPath ?? ''));
    const config = validatePath(c, relative);
    if (!roots(c).some(item => relative.split(path.sep).join('/').startsWith(`${item.path}/`))) throw new Error('Docker configuration must be inside a registered generated root');
    fs.writeFileSync(config, template.replaceAll('__RML_CACHE_BUDGET_BYTES__', String(local.budgetBytes - local.localBytes)), { flag: 'wx' });
    return;
  }
  const record = JSON.parse(fs.readFileSync(lease, 'utf8'));
  validateManifest(root, record);
  const reportFile = path.join(root, '.rml-cache', 'reports', `docker-budget-${record.builder ?? record.name}.json`);
  if (action === 'ready') {
    record.builderEndpoint = verifyDockerBuilder(record);
    record.phase = 'ready'; record.containerId = args[0]; validateManifest(root, record); safeWrite(lease, record); return;
  }
  if (action === 'verify-builder') { verifyDockerBuilder(record); return; }
  if (action === 'image') {
    if (!immutableImage.test(args[0])) throw new Error('Invalid immutable Docker image ID');
    if (!record.images.includes(args[0])) record.images.push(args[0]);
    safeWrite(lease, record); return;
  }
  if (action === 'check' || action === 'observe' || action === 'begin-cleanup') {
    const local = await localState(root);
    let external;
    let accountingError;
    try { external = measureDockerCaches(root); } catch (error) { accountingError = error.message; }
    const before = accountingError ? null : add(local.localBytes, external.bytes);
    const report = { version: 1, metric: 'conservative-logical-bytes-including-shared-layers', resourceKind: record.kind, name: record.builder ?? record.name, ...local, dockerBytes: external?.bytes ?? null, beforeBytes: before, afterBytes: null, reclaimedBytes: null, budgetSatisfied: before !== null && before <= local.budgetBytes, timestamp: new Date().toISOString(), ...(accountingError ? { accountingError } : {}) };
    if (action === 'begin-cleanup') {
      safeWrite(reportFile, report);
      if (!accountingError) {
        record.upperBoundBytes = measureResource(record).bytes;
        record.phase = 'cleaning'; safeWrite(lease, record);
      }
    }
    if (accountingError) throw new Error(accountingError);
    console.log(`docker-cache: local=${local.localBytes} docker=${external.bytes} total=${before} budget=${local.budgetBytes} bytes`);
    if (action === 'check' && !report.budgetSatisfied) throw new Error('Aggregate local + Docker cache budget exceeded');
    return;
  }
  if (action === 'finish') {
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    let gone = true;
    if (record.kind === 'docker-container') {
      if (inspect(execFileSync, ['container', 'inspect', record.name], { missing: true })) gone = false;
      const file = cidfilePath(root, record.cidfile);
      if (fs.existsSync(file)) {
        const id = fs.readFileSync(file, 'utf8').trim();
        if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid immutable Docker container ID at teardown');
        if (inspect(execFileSync, ['container', 'inspect', id], { missing: true })) gone = false;
      }
    } else {
      for (const image of record.images) if (inspect(execFileSync, ['image', 'inspect', image], { missing: true })) gone = false;
      if (inspect(execFileSync, ['volume', 'inspect', record.volume], { missing: true })) gone = false;
      if (inspect(execFileSync, ['inspect', '--type', 'container', record.container], { missing: true })) gone = false;
      if (record.containerId && inspect(execFileSync, ['inspect', '--type', 'container', record.containerId], { missing: true })) gone = false;
    }
    const local = await localState(root);
    report.cleanupExitCode = Number(args[0]);
    const remaining = gone ? measureDockerCaches(root, { excludeLease: path.resolve(lease) }) : null;
    report.afterBytes = gone ? add(local.localBytes, remaining.bytes) : null;
    report.reclaimedBytes = report.beforeBytes !== null && gone ? report.beforeBytes - report.afterBytes : null;
    report.budgetSatisfied = gone && report.afterBytes <= local.budgetBytes;
    report.resourcesRemoved = gone;
    report.remainingDockerBytes = remaining?.bytes ?? null;
    // These helpers require the outer wrapper. Its postflight owns safe local
    // capture/eviction and the final budget failure; active output may exceed
    // the retention budget before its last consumer has finished.
    report.localCleanupRequired = gone && local.localBytes > local.budgetBytes;
    report.finalBudgetEnforcement = 'outer-wrapper-postflight';
    safeWrite(reportFile, report);
    console.log(`docker-cache: before=${report.beforeBytes ?? 'unknown'} after=${report.afterBytes ?? 'unknown'} reclaimed=${report.reclaimedBytes ?? 'unknown'} budget=${local.budgetBytes} bytes`);
    if (!gone) throw new Error('Owned Docker resources remain; external lease preserved');
    return;
  }
  throw new Error(`Unknown Docker budget operation: ${action}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`docker-cache: ${error.message}`); process.exitCode = 1; });
