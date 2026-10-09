#!/usr/bin/env node
/** Repository-owned build cache policy. Never uses rm -rf, cargo clean, or global caches. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measureDockerCaches } from './docker-cache-budget.mjs';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const policy = JSON.parse(fs.readFileSync(new URL('./cache-policy.json', import.meta.url), 'utf8'));
const slash = p => p.split(path.sep).join('/');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}
export function context(root = repository) {
  root = fs.realpathSync(root);
  for (const relative of ['.rml-cache', '.rml-cache/evidence', '.rml-cache/reports', '.rml-cache/state']) {
    const entry = fs.lstatSync(path.join(root, relative), { throwIfNoEntry: false });
    if (entry?.isSymbolicLink()) throw new Error(`Protected state path may not be a symlink: ${relative}`);
  }
  let gitDir;
  let gitless = false;
  try {
    if (fs.realpathSync(git(root, ['rev-parse', '--show-toplevel'])) !== root) throw new Error('Cache root must be the exact repository worktree');
    gitDir = fs.realpathSync(git(root, ['rev-parse', '--absolute-git-dir']));
  } catch (error) {
    if (process.env.RML_CACHE_SOURCE_ARCHIVE !== '1' || fs.existsSync(path.join(root, '.git'))) throw error;
    if (!fs.existsSync(path.join(root, 'scripts', 'cache-policy.json'))) throw new Error('Source archive has no cache policy');
    gitless = true;
    gitDir = path.join(root, '.rml-cache', 'state');
  }
  const state = path.join(gitDir, 'rml-cache');
  if (fs.existsSync(state) && fs.lstatSync(state).isSymbolicLink()) throw new Error('Cache state may not be a symlink');
  fs.mkdirSync(state, { recursive: true });
  const registryFile = path.join(state, 'registry.json');
  if (fs.lstatSync(registryFile, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Cache registry may not be a symlink');
  const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { version: 1, root, roots: [], files: {} };
  if (registry.root !== root || registry.version !== 1) throw new Error('Cache registry belongs to a different worktree or version');
  const tracked = new Set(gitless ? [] : git(root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const worktrees = (gitless ? '' : git(root, ['worktree', 'list', '--porcelain'])).split('\n').filter(s => s.startsWith('worktree ')).map(s => path.resolve(s.slice(9))).filter(p => p !== root);
  return { root, state, registryFile, registry, tracked, worktrees, gitless };
}
export function writeState(c) {
  const temp = `${c.registryFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(c.registry, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, c.registryFile);
}
/** A hostname and PID do not identify a process realm on shared filesystems. */
export function processIdentity({ platform = process.platform, host = os.hostname(), pid = process.pid, readFile = fs.readFileSync, readLink = fs.readlinkSync, run = execFileSync } = {}) {
  const identity = { platform, host, bootId: null, pidNamespace: null };
  if (platform === 'linux') {
    try {
      identity.bootId = readFile('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
      identity.pidNamespace = readLink('/proc/self/ns/pid') || null;
    } catch { /* Unknown visibility must never be treated as evidence of death. */ }
  } else if (platform === 'darwin') {
    try {
      // XNU exposes a per-boot UUID and has one host PID realm.
      const uuid = run('sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8', timeout: 10000 }).trim();
      identity.bootId = uuid || null;
      identity.pidNamespace = uuid ? 'darwin-host' : null;
    } catch { /* Preserve/defer when the host identity cannot be established. */ }
  }
  if (platform === 'win32') {
    try {
      // Bind the machine/boot to the observed process-tree root, not just its
      // hostname. A container/silo can share host hardware and boot metadata.
      // Ordinary npm/cmd/Node descendants resolve the same live root identity.
      const script = `$ErrorActionPreference='Stop';
$os=Get-CimInstance Win32_OperatingSystem;
$machine=(Get-CimInstance Win32_ComputerSystemProduct).UUID;
$processes=@(Get-CimInstance Win32_Process);
$byId=@{};foreach($p in $processes){$byId[[int]$p.ProcessId]=$p};
$cursor=${pid};$seen=@{};$root=$null;
while($byId.ContainsKey($cursor) -and -not $seen.ContainsKey($cursor)){
 $entry=$byId[$cursor];if($entry.CreationDate){$root=$entry};
 $seen[$cursor]=$true;$cursor=[int]$entry.ParentProcessId
};
if(-not $root -or -not $root.CreationDate){throw 'Cannot establish process ancestry'};
@{machineUuid=$machine;bootId=$os.LastBootUpTime.ToUniversalTime().ToString('o');rootPid=[int]$root.ProcessId;rootStarted=$root.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress`;
      const record = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 10000, windowsHide: true }));
      if (!record.machineUuid || /^0+$/.test(String(record.machineUuid).replaceAll('-', '')) || !record.bootId || !Number.isInteger(record.rootPid) || record.rootPid < 1 || !record.rootStarted) throw new Error('Incomplete Windows process identity');
      identity.bootId = record.bootId;
      identity.pidNamespace = `windows-tree:${record.machineUuid}:${record.rootPid}:${record.rootStarted}`;
    } catch { /* WMI unavailable or ambiguous visibility: preserve and defer. */ }
  }
  return identity;
}
function sameProcessRealm(owner, identity) {
  const recorded = owner?.processIdentity;
  return !!(recorded?.bootId && recorded?.pidNamespace && identity.bootId && identity.pidNamespace &&
    recorded.platform === identity.platform && recorded.host === identity.host &&
    recorded.bootId === identity.bootId && recorded.pidNamespace === identity.pidNamespace);
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
export async function lock(c, { timeout = Number(process.env.RML_CACHE_LOCK_TIMEOUT_MS ?? 60000) } = {}) {
  const dir = path.join(c.state, 'lock');
  const started = Date.now();
  const token = crypto.randomUUID();
  const identity = processIdentity();
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error('Cache lease timeout must be a non-negative number');
  while (true) {
    try {
      fs.mkdirSync(dir);
      const owner = { pid: process.pid, host: os.hostname(), processIdentity: identity, token, started: Date.now() };
      fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
      // context() can precede a long wait for another build. Read the registry
      // again only after acquiring the lease, or this owner could overwrite
      // artifacts recorded by the preceding owner with its stale snapshot.
      try {
        const current = context(c.root);
        if (current.state !== c.state) throw new Error('Cache state changed while waiting for its lease');
        c.registry = current.registry;
        c.tracked = current.tracked;
        c.worktrees = current.worktrees;
      } catch (error) {
        fs.unlinkSync(path.join(dir, 'owner.json'));
        fs.rmdirSync(dir);
        throw error;
      }
      return {
        token,
        child(pid) { owner.child = pid; fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(owner)); },
        release() { fs.unlinkSync(path.join(dir, 'owner.json')); fs.rmdirSync(dir); },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')); } catch { /* partial acquisition: fail closed */ }
      if (sameProcessRealm(owner, identity) && !alive(owner.pid) && !alive(owner.child)) {
        // A killed wrapper's descendants may still own outputs. An abandoned lease is
        // intentionally not auto-stolen; recover using bootstrap after inspecting it.
        throw new Error(`Abandoned build lease at ${dir}; verify no descendants remain before removing this lease`);
      }
      if (Date.now() - started >= timeout) {
        const visibility = sameProcessRealm(owner, identity) ? '' : ' (foreign or unknown process namespace/boot)';
        throw new Error(`Cache cleanup/build deferred: another build holds the worktree lease${visibility}`);
      }
      await sleep(100);
    }
  }
}
export function inheritedLease(c, { identity } = {}) {
  if (!process.env.RML_CACHE_LEASE) return false;
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(c.state, 'lock', 'owner.json'), 'utf8'));
    return owner.token === process.env.RML_CACHE_LEASE && sameProcessRealm(owner, identity ?? processIdentity()) && alive(owner.pid);
  } catch { return false; }
}
export function validatePath(c, relative, { registration = false } = {}) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(x => !x || x === '.' || x === '..')) throw new Error(`Unsafe cache path: ${relative}`);
  if (relative === '.git' || relative.startsWith('.git/') || relative === '.rml-cache' || ['.rml-cache/evidence', '.rml-cache/reports', '.rml-cache/state'].some(p => relative === p || relative.startsWith(`${p}/`))) throw new Error(`Protected cache path: ${relative}`);
  const full = path.join(c.root, relative);
  if (c.worktrees.some(w => full === w || full.startsWith(`${w}${path.sep}`) || w.startsWith(`${full}${path.sep}`))) throw new Error(`Cache overlaps another worktree: ${relative}`);
  let walk = c.root;
  for (const bit of relative.split('/')) {
    walk = path.join(walk, bit);
    if (fs.existsSync(walk) || fs.lstatSync(walk, { throwIfNoEntry: false })) {
      const stat = fs.lstatSync(walk);
      if (stat.isSymbolicLink()) throw new Error(`Symlink cache path is protected: ${relative}`);
      if (stat.dev !== fs.statSync(c.root).dev) throw new Error(`Cache crosses a filesystem boundary: ${relative}`);
    }
  }
  if (registration && !policy.roots.some(r => r.path === relative)) {
    if (['lib', 'docs', 'examples', 'test-corpus', 'experiments', 'scripts', '.github'].some(p => relative === p || relative.startsWith(`${p}/`)) || /(^|\/)(src|tests|test|fixtures)(\/|$)/.test(relative)) throw new Error(`Source directory cannot become a cache: ${relative}`);
    if ([...c.tracked].some(p => p === relative || p.startsWith(`${relative}/`))) throw new Error(`Custom cache contains tracked files: ${relative}`);
  }
  return full;
}
export function register(c, relative, category) {
  if (!policy.classes.includes(category)) throw new Error(`Unknown cache class: ${category}`);
  validatePath(c, relative, { registration: true });
  if (!c.registry.roots.some(r => r.path === relative) && !policy.roots.some(r => r.path === relative)) c.registry.roots.push({ path: relative, class: category });
}
export function roots(c) {
  const patterned = (policy.patterns ?? []).flatMap(pattern => {
    const parent = validatePath(c, pattern.parent);
    if (!fs.existsSync(parent)) return [];
    return fs.readdirSync(parent).filter(name => name.endsWith(pattern.suffix)).map(name => ({ path: `${pattern.parent}/${name}`, class: pattern.class }));
  });
  const result = [...policy.roots, ...c.registry.roots, ...patterned].filter((r, i, all) => all.findIndex(x => x.path === r.path) === i);
  return result.filter((r, i) => !result.some((p, j) => i !== j && r.path.startsWith(`${p.path}/`)));
}
function stamp(full) {
  const s = fs.lstatSync(full);
  if (!s.isFile()) return null;
  return { bytes: s.size, hash: digest(fs.readFileSync(full)), modified: s.mtimeMs, mode: s.mode, device: s.dev, inode: s.ino };
}
export function inventory(c, { hashes = true } = {}) {
  const files = {};
  const protectedPaths = [];
  function walk(relative, category, disposable) {
    let full;
    try { full = validatePath(c, relative); } catch (error) { protectedPaths.push({ path: relative, reason: error.message }); return; }
    const s = fs.lstatSync(full, { throwIfNoEntry: false });
    if (!s) return;
    if (c.tracked.has(relative)) { protectedPaths.push({ path: relative, reason: 'tracked' }); return; }
    if (s.isDirectory()) {
      const nestedGit = fs.lstatSync(path.join(full, '.git'), { throwIfNoEntry: false });
      if (nestedGit) {
        if (!nestedGit.isDirectory() || nestedGit.isSymbolicLink()) { protectedPaths.push({ path: relative, reason: 'nested worktree or symlink Git boundary' }); return; }
        // A nested clone is its own source boundary, even when a build created it.
        // Never infer ownership of its source/uncommitted work from parent Git.
        try {
          for (const tracked of git(full, ['ls-files', '-z']).split('\0').filter(Boolean)) c.tracked.add(`${relative}/${tracked}`);
        } catch { protectedPaths.push({ path: relative, reason: 'cannot inspect nested repository' }); return; }
        protectedPaths.push({ path: relative, reason: 'nested repository source, uncommitted files and Git metadata' });
        for (const nested of policy.roots) walk(`${relative}/${nested.path}`, nested.class, nested.disposable);
        for (const nested of c.registry.roots.filter(r => r.path.startsWith(`${relative}/`))) walk(nested.path, nested.class, nested.disposable);
        return;
      }
      let names;
      try { names = fs.readdirSync(full); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const name of names) walk(`${relative}/${name}`, category, disposable);
    } else if (s.isFile()) files[relative] = { ...(hashes ? stamp(full) : { bytes: s.size, modified: s.mtimeMs, mode: s.mode, device: s.dev, inode: s.ino }), class: category, disposable: !!disposable, recovery: relative.split('/').some(part => part.startsWith('.rml-delete-')) };
    else protectedPaths.push({ path: relative, reason: 'not a regular file' });
  }
  for (const r of roots(c)) walk(r.path, r.class, r.disposable);
  return { files, protectedPaths };
}
/** Exact content AND filesystem identity; timestamps alone never prove authorship. */
function matches(left, right) {
  return !!left && !!right && ['bytes', 'hash', 'modified', 'mode', 'device', 'inode'].every(key => left[key] === right[key]);
}
// v1 allowed reused-directory temporal adoption; never trust those old entries.
const productionProof = 'producer-v2';

/** Allocate a private receipt channel before the owned producer is started. */
export function beginProduction(c, lease) {
  const token = lease.token;
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid producer lease token');
  const directory = path.join(c.state, `production-${token}`);
  fs.mkdirSync(directory, { mode: 0o700 });
  c.production = { token, directory, roots: [] };
  return { RML_CACHE_PRODUCTION: token, RML_CACHE_ROOT: c.root };
}



function publishProducerRecord(c, name, record) {
  const temporary = path.join(c.production.directory, `${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, path.join(c.production.directory, name));
}

function mergeProductionRecords(c) {
  const records = fs.readdirSync(c.production.directory).filter(name => /^(?:options-[a-f0-9-]{36}|root-[a-f0-9]{64})\.json$/.test(name)).map(name => {
    const file = path.join(c.production.directory, name);
    if (!fs.lstatSync(file).isFile()) throw new Error('Producer metadata may not be a link');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.token !== c.production.token) throw new Error('Producer metadata belongs to a different lease');
    return record;
  });
  for (const record of records.filter(item => item.kind === 'options')) {
    for (const cache of record.caches) register(c, cache.path, cache.class);
  }
  for (const record of records) {
    if (record.kind === 'options') {
      for (const keep of record.retain) {
        validatePath(c, keep);
        if (!roots(c).some(root => root.path === keep)) throw new Error(`Only registered roots may be retained: ${keep}`);
      }
      c.registry.retained = [...new Set([...(c.registry.retained ?? []), ...record.retain])];
    } else if (record.kind === 'root') {
      const root = record.output;
      validatePath(c, root.path);
      if (path.posix.dirname(root.path) !== root.parent || !path.posix.basename(root.path).startsWith('.rml-producer-')) throw new Error('Invalid private producer directory record');
      if (!c.production.roots.some(item => item.path === root.path)) c.production.roots.push(root);
      c.registry.producers ??= [];
      if (!c.registry.producers.some(item => item.path === root.path)) c.registry.producers.push(root);
    } else throw new Error('Unknown producer metadata record');
  }
}
export function resumeProduction(c) {
  const token = process.env.RML_CACHE_PRODUCTION;
  if (!inheritedLease(c) || !token || token !== process.env.RML_CACHE_LEASE || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Producer output requires the verified active worktree lease');
  const directory = path.join(c.state, `production-${token}`);
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Producer receipt channel is unsafe');
  c.production = { token, directory, roots: [] };
  mergeProductionRecords(c);
  return c.production;
}
export function recordProductionOptions(c, { caches = [], retain = [] } = {}) {
  if (!c.production) throw new Error('Producer option registration requires a live producer');
  for (const item of caches) register(c, item.path, item.class);
  for (const keep of retain) {
    validatePath(c, keep);
    if (!roots(c).some(root => root.path === keep)) throw new Error(`Only registered roots may be retained: ${keep}`);
  }
  c.registry.retained = [...new Set([...(c.registry.retained ?? []), ...retain])];
  const record = { kind: 'options', token: c.production.token, caches, retain };
  publishProducerRecord(c, `options-${crypto.randomUUID()}.json`, record);
}


export function reportProductionFailure(c, reason) {
  if (!c.production) throw new Error('Producer failure reporting requires an active receipt channel');
  publishProducerRecord(c, `failure-${crypto.randomUUID()}.json`, { token: c.production.token, reason: String(reason) });
}
export function productionFailure(c) {
  if (!c.production) return null;
  for (const name of fs.readdirSync(c.production.directory).filter(name => /^failure-[a-f0-9-]{36}\.json$/.test(name))) {
    const file = path.join(c.production.directory, name);
    if (!fs.lstatSync(file).isFile()) throw new Error('Producer failure record may not be a link');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.token !== c.production.token) throw new Error('Producer failure belongs to a different lease');
    return String(record.reason);
  }
  return null;
}

/** Native tools receive this fresh directory explicitly; shared roots stay unowned. */
export function ownedOutputPath(c, relative, { forSeed = false } = {}) {
  validatePath(c, relative, { registration: true });
  const current = inventory(c);
  for (const candidate of [...(c.registry.producers ?? [])].reverse()) {
    if (candidate.parent !== relative || c.production?.roots.some(item => item.path === candidate.path)) continue;
    let directory;
    try { directory = validatePath(c, candidate.path); } catch { if (!forSeed) return null; continue; }
    const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isDirectory() || stat.dev !== candidate.device || stat.ino !== candidate.inode || stat.birthtimeMs !== candidate.created || stat.mode !== candidate.mode) { if (!forSeed) return null; continue; }
    const inside = name => name === candidate.path || name.startsWith(`${candidate.path}/`);
    if (current.protectedPaths.some(item => inside(item.path))) { if (!forSeed) return null; continue; }
    const files = Object.entries(current.files).filter(([name]) => inside(name));
    if (!files.every(([name, record]) => c.registry.files[name]?.proof === productionProof && matches(c.registry.files[name], record))) { if (!forSeed) return null; continue; }
    return { directory, producer: candidate, files };
  }
  return null;
}
export function isolatedOutput(c, relative, category = 'acceptance') {
  if (!c.production) throw new Error('Output isolation requires an active producer');
  register(c, relative, category);
  const parent = validatePath(c, relative);
  fs.mkdirSync(parent, { recursive: true });
  c.registry.producers ??= [];
  // Never run a producer in an exposed prior target. Seed a new generation
  // with verified bytes instead; concurrent edits keep their original path.
  const reusable = ownedOutputPath(c, relative, { forSeed: true });
  const directory = fs.mkdtempSync(path.join(parent, '.rml-producer-'));
  fs.chmodSync(directory, 0o700);
  const stat = fs.lstatSync(directory);
  const output = { parent: relative, path: slash(path.relative(c.root, directory)), device: stat.dev, inode: stat.ino, created: stat.birthtimeMs, mode: stat.mode };
  c.production.roots.push(output);
  if (reusable) {
    for (const [name, expected] of reusable.files) {
      const source = validatePath(c, name);
      const descriptor = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      let bytes, before, after;
      try {
        before = fs.fstatSync(descriptor);
        bytes = fs.readFileSync(descriptor);
        after = fs.fstatSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      const snapshot = stat => ({ bytes: stat.size, hash: digest(bytes), modified: stat.mtimeMs, mode: stat.mode, device: stat.dev, inode: stat.ino });
      if (!before.isFile() || !matches(expected, snapshot(before)) || !matches(expected, snapshot(after))) throw new Error(`Warm output changed while copying; producer deferred: ${name}`);
      const destination = path.join(directory, path.relative(reusable.directory, source));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      lowDisk(c);
      // Never hard-link generations: the next compiler must not mutate the
      // prior target's inode, which the user may still be inspecting/editing.
      fs.writeFileSync(destination, bytes, { flag: 'wx', mode: before.mode & 0o777 });
      fs.utimesSync(destination, before.atimeMs / 1000, before.mtimeMs / 1000);
    }
    output.seededFrom = reusable.producer.path;
  }
  c.registry.producers.push(output);
  publishProducerRecord(c, `root-${digest(output.path)}.json`, { kind: 'root', token: c.production.token, output });
  return directory;
}

/**
 * A cooperating producer supplies the bytes it creates, not a directory scan.
 * Exclusive creation cannot overwrite concurrent user data. Existing identical
 * registered output can be reused; replacing other output needs safe cleanup.
 */
export function writeProducedFile(relative, data, { root = process.env.RML_CACHE_ROOT ?? repository, mode = 0o666 } = {}) {
  const c = context(root);
  const { directory } = resumeProduction(c);
  const full = validatePath(c, relative);
  if (relative.split('/').some(part => part.startsWith('.rml-delete-'))) throw new Error('Recovery paths cannot receive producer ownership');
  if (!roots(c).some(item => relative === item.path || relative.startsWith(`${item.path}/`)) || c.tracked.has(relative)) throw new Error(`Not a generated output path: ${relative}`);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const expected = digest(bytes);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const receiptFile = path.join(directory, `${digest(relative)}.json`);
  let descriptor;
  try { descriptor = fs.openSync(full, 'wx', mode); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = stamp(full);
    let owned = c.registry.files[relative];
    if (fs.existsSync(receiptFile)) owned = JSON.parse(fs.readFileSync(receiptFile, 'utf8')).record;
    if (owned?.proof === productionProof && matches(owned, existing) && existing.hash === expected) return;
    throw new Error(`Refusing to replace existing or concurrently created output: ${relative}`);
  }
  let produced;
  try {
    fs.writeFileSync(descriptor, bytes);
    const written = fs.fstatSync(descriptor);
    produced = { bytes: bytes.length, hash: expected, modified: written.mtimeMs, mode: written.mode, device: written.dev, inode: written.ino, proof: productionProof };
  } finally { fs.closeSync(descriptor); }
  if (!matches(produced, stamp(full))) throw new Error(`Output changed before its producer receipt: ${relative}`);
  // Atomic receipt replacement does not follow a user-supplied link.
  const temp = path.join(directory, `${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify({ path: relative, record: produced }), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, receiptFile);
}

export function capture(c, baseline) {
  if (!c.gitless) c.tracked = new Set(git(c.root, ['ls-files', '-z']).split('\0').filter(Boolean));
  if (c.production) mergeProductionRecords(c);
  const after = inventory(c);
  const receipts = {};
  const privateRoots = [];
  if (c.production) {
    for (const name of fs.readdirSync(c.production.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const receiptPath = path.join(c.production.directory, name);
      if (!fs.lstatSync(receiptPath).isFile()) continue;
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      if (name === `${digest(receipt.path)}.json`) receipts[receipt.path] = receipt.record;
    }
    for (const root of c.production.roots) {
      const current = fs.lstatSync(validatePath(c, root.path), { throwIfNoEntry: false });
      if (current?.isDirectory() && current.dev === root.device && current.ino === root.inode && current.birthtimeMs === root.created && current.mode === root.mode) privateRoots.push(root.path);
    }
  }
  for (const [relative, record] of Object.entries(after.files)) {
    if (record.recovery) { delete c.registry.files[relative]; continue; }
    const before = baseline.files[relative];
    const owned = c.registry.files[relative];
    const unchangedOwned = owned?.proof === productionProof && matches(owned, before) && matches(before, record);
    const receipted = receipts[relative]?.proof === productionProof && matches(receipts[relative], record) && (!before || (owned?.proof === productionProof && matches(owned, before)));
    const isolated = !before && privateRoots.some(root => relative.startsWith(`${root}/`));
    if (unchangedOwned || receipted || isolated) c.registry.files[relative] = { ...record, proof: productionProof, seen: unchangedOwned ? owned.seen : Date.now() };
    else delete c.registry.files[relative];
  }
  for (const relative of Object.keys(c.registry.files)) if (!after.files[relative]) delete c.registry.files[relative];
  writeState(c);
}
export function finishProduction(c) {
  if (!c.production) return;
  // Delete only regular receipt files created for this exact lease, never a tree.
  for (const name of fs.readdirSync(c.production.directory)) {
    if (!/^(?:[a-f0-9]{64}\.json|[a-f0-9-]{36}\.tmp|(?:options|failure)-[a-f0-9-]{36}\.json|root-[a-f0-9]{64}\.json)$/.test(name)) continue;
    const file = path.join(c.production.directory, name);
    if (fs.lstatSync(file).isFile()) fs.unlinkSync(file);
  }
  try { fs.rmdirSync(c.production.directory); } catch { /* Unknown data stays protected. */ }

}

export function localCacheBytes(c) {
  if (c.production) mergeProductionRecords(c);
  else if (process.env.RML_CACHE_PRODUCTION && inheritedLease(c)) resumeProduction(c);
  return Object.values(inventory(c, { hashes: false }).files).reduce((sum, file) => sum + file.bytes, 0);
}
export function aggregateCacheBytes(c) {
  const localBytes = localCacheBytes(c);
  const external = measureDockerCaches(c.root);
  return { localBytes, externalBytes: external.bytes, totalBytes: localBytes + external.bytes, resources: external.resources };
}
export function checkAggregateBudget(c) {
  const measured = aggregateCacheBytes(c);
  const budget = numberSetting(process.env.RML_CACHE_BUDGET_BYTES, policy.budgetBytes, 'RML_CACHE_BUDGET_BYTES');
  if (measured.totalBytes > budget) throw new Error(`Aggregate cache budget exceeded: ${measured.totalBytes} bytes (${measured.localBytes} local + ${measured.externalBytes} owned Docker); ${budget} allowed`);
  return measured;
}

function numberSetting(value, fallback, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a non-negative number`);
  return number;
}

/**
 * Atomically detach the public name before inspecting/deleting its inode. An
 * editor replacement is restored exclusively, or retained with recovery data.
 * The private quarantine is in the same parent, so a substituted ancestor does
 * not provide the uniquely allocated destination. Linux additionally anchors
 * both names to an open parent descriptor, avoiding later ancestor traversal.
 */
function removeOwnedFile(c, relative, expected) {
  const original = validatePath(c, relative);
  const parent = path.dirname(original);
  const ancestry = [];
  let cursor = c.root;
  ancestry.push([cursor, fs.lstatSync(cursor)]);
  for (const bit of path.relative(c.root, parent).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, bit);
    ancestry.push([cursor, fs.lstatSync(cursor)]);
  }
  const sameAncestry = () => ancestry.every(([directory, before]) => {
    const now = fs.lstatSync(directory, { throwIfNoEntry: false });
    return now?.isDirectory() && !now.isSymbolicLink() && now.dev === before.dev && now.ino === before.ino;
  });
  let descriptor;
  let stableParent = parent;
  try {
    try {
      descriptor = fs.openSync(parent, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0));
      const opened = fs.fstatSync(descriptor);
      const expectedParent = ancestry.at(-1)[1];
      if (!opened.isDirectory() || opened.dev !== expectedParent.dev || opened.ino !== expectedParent.ino) throw new Error('Cache parent changed before deletion');
      for (const provider of ['/proc/self/fd', '/dev/fd']) {
        const alias = `${provider}/${descriptor}`;
        try {
          const anchored = fs.statSync(`${alias}/.`);
          if (anchored.isDirectory() && anchored.dev === opened.dev && anchored.ino === opened.ino) { stableParent = alias; break; }
        } catch { /* Portable fallback uses the same-parent rename transaction. */ }
      }
    } catch (error) {
      if (descriptor !== undefined) { fs.closeSync(descriptor); descriptor = undefined; }
      if (process.platform !== 'win32' || !['EISDIR', 'EINVAL', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
      // Windows may not expose directory descriptors through Node. No public
      // pathname is ever unlinked; rename still quarantines before verification.
    }
    if (!sameAncestry()) throw new Error('Cache ancestry changed before deletion');
    const source = path.join(stableParent, path.basename(original));
    const quarantine = fs.mkdtempSync(path.join(stableParent, '.rml-delete-'));
    const visibleQuarantine = path.join(parent, path.basename(quarantine));
    const moved = path.join(quarantine, 'artifact');
    const intent = path.join(quarantine, 'recovery.json');
    fs.writeFileSync(intent, JSON.stringify({ original: relative, recovery: path.join(visibleQuarantine, 'artifact'), expected }), { flag: 'wx', mode: 0o600 });
    let detached = false;
    let completed = false;
    try {
      fs.renameSync(source, moved);
      detached = true;
      const current = stamp(moved);
      if (!matches(current, expected) || !sameAncestry()) {
        // link is exclusive: never overwrite a second editor replacement that
        // appeared after detachment. A failed restore leaves recoverable bytes.
        try {
          fs.linkSync(moved, source);
          fs.unlinkSync(moved);
          detached = false;
          completed = true;
          return false;
        } catch (error) {
          throw new Error(`Cleanup deferred: changed data preserved at ${path.join(visibleQuarantine, 'artifact')}; original ${relative} could not be restored exclusively: ${error.message}`);
        }
      }
      fs.unlinkSync(moved);
      detached = false;
      completed = true;
      return true;
    } finally {
      if (!detached) {
        // Only our fresh metadata/private directory is removed; no recursive
        // walk or removal of public ancestor directories is attempted.
        try { fs.unlinkSync(intent); } catch (error) { if (completed) throw error; }
        try { fs.rmdirSync(quarantine); } catch (error) { if (completed) throw error; }
      }
    }
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

export function cleanup(c, { full = false, reportOnly = false, onlyRoots } = {}) {
  for (const relative of onlyRoots ?? []) validatePath(c, relative);
  if (!c.gitless) c.tracked = new Set(git(c.root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const budget = numberSetting(process.env.RML_CACHE_BUDGET_BYTES, policy.budgetBytes, 'RML_CACHE_BUDGET_BYTES');
  const staleMs = numberSetting(process.env.RML_CACHE_STALE_HOURS, policy.staleHours, 'RML_CACHE_STALE_HOURS') * 3600000;
  const current = inventory(c);
  const entries = Object.entries(current.files);
  const localBefore = entries.reduce((sum, [, f]) => sum + f.bytes, 0);
  const external = measureDockerCaches(c.root);
  const before = localBefore + external.bytes;
  let after = before;
  const protectedPaths = [...current.protectedPaths];
  const removed = [];
  const candidates = [];
  for (const [relative, record] of entries) {
    const owned = c.registry.files[relative];
    if (record.recovery || owned?.proof !== productionProof || !matches(owned, record)) {
      protectedPaths.push({ path: relative, reason: record.recovery ? 'recoverable concurrent edit; resolve manually' : owned?.proof === productionProof ? 'modified since build (uncommitted work)' : 'no producer ownership receipt' });
      delete c.registry.files[relative];
      continue;
    }
    candidates.push([relative, record, owned]);
  }
  candidates.sort((a, b) => a[2].seen - b[2].seen || a[0].localeCompare(b[0]));
  for (const [relative, record, owned] of candidates) {
    if (onlyRoots && !onlyRoots.some(root => relative === root || relative.startsWith(`${root}/`))) continue;
    // Incremental sessions and linked examples are disposable after the owned
    // process exits. Warm dependencies are retained within the budget; missing
    // files after eviction are rebuilt by Cargo's fingerprints. We do not run
    // an optional third-party sweeper with broader deletion authority.
    const disposable = record.disposable || (record.class === 'rust' && /\/(incremental|examples)\//.test(relative));
    const retained = (c.registry.retained ?? []).some(p => relative === p || relative.startsWith(`${p}/`));
    if (retained && !full) { protectedPaths.push({ path: relative, reason: 'retained until artifact handoff/full cleanup' }); continue; }
    if (!(full || disposable || Date.now() - owned.seen >= staleMs || after > budget)) continue;
    if (reportOnly) continue;
    if (c.tracked.has(relative)) { protectedPaths.push({ path: relative, reason: 'tracked during cleanup' }); continue; }
    let deleted;
    try { deleted = removeOwnedFile(c, relative, owned); }
    catch (error) {
      delete c.registry.files[relative];
      writeState(c);
      throw error;
    }
    delete c.registry.files[relative];
    if (!deleted) { protectedPaths.push({ path: relative, reason: 'changed during deletion; user data restored' }); continue; }
    removed.push(relative);
    after -= record.bytes;

  }
  const remaining = inventory(c, { hashes: false });
  after = Object.values(remaining.files).reduce((sum, file) => sum + file.bytes, 0) + external.bytes;
  const result = { version: 1, root: c.root, mode: full ? 'full' : 'bounded', beforeBytes: before, afterBytes: after, reclaimedBytes: before - after, budgetBytes: budget, budgetSatisfied: after <= budget, localBeforeBytes: localBefore, localAfterBytes: after - external.bytes, externalBytes: external.bytes, externalResources: external.resources, removed, protected: protectedPaths, classes: policy.classes, timestamp: new Date().toISOString() };
  if (!reportOnly) {
    c.registry.producers = (c.registry.producers ?? []).filter(producer => Object.keys(remaining.files).some(relative => relative.startsWith(`${producer.path}/`)));
    if (full) c.registry.retained = onlyRoots ? (c.registry.retained ?? []).filter(retained => !onlyRoots.some(root => retained === root || retained.startsWith(`${root}/`))) : [];
    writeState(c);
    const reports = path.join(c.root, '.rml-cache', 'reports');
    fs.mkdirSync(reports, { recursive: true });
    if (fs.lstatSync(path.join(reports, 'last-cleanup.json'), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Cache report may not be a symlink');
    if ((fs.lstatSync(path.join(reports, 'last-cleanup.json'), { throwIfNoEntry: false })?.nlink ?? 0) > 1) throw new Error('Cache report may not be a hard link');
    fs.writeFileSync(path.join(reports, 'last-cleanup.json'), `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}
export function printReport(result) {
  console.log(`build-cache: before=${result.beforeBytes} after=${result.afterBytes} reclaimed=${result.reclaimedBytes} budget=${result.budgetBytes} bytes; ${result.protected.length} protected paths; ${result.budgetSatisfied ? 'within budget' : 'BLOCKED: protected data exceeds budget'}`);
}
export function lowDisk(c) {
  const minimum = numberSetting(process.env.RML_CACHE_MIN_FREE_BYTES, policy.minimumFreeBytes, 'RML_CACHE_MIN_FREE_BYTES');
  if (!fs.statfsSync) throw new Error('Disk preflight requires Node.js 18.15+ (statfsSync)');
  const s = fs.statfsSync(c.root);
  const free = Number(s.bavail) * Number(s.bsize);
  if (free < minimum) throw new Error(`Low disk: ${free} bytes available; ${minimum} required. Use build-cache.mjs --full or free protected data manually`);
  return free;
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--output-path') {
    if (args.length !== 2) throw new Error('Usage: build-cache.mjs --output-path <registered-root>');
    const c = context();
    const lease = inheritedLease(c) ? null : await lock(c);
    try {
      const output = ownedOutputPath(c, args[1]);
      if (!output) throw new Error(`No proven private output for ${args[1]}`);
      console.log(output.directory);
    } finally { lease?.release(); }
    return;
  }
  if (args.some(a => !['--full', '--report', '--json'].includes(a))) throw new Error('Usage: node scripts/build-cache.mjs [--full] [--report] [--json]');
  const c = context();
  const lease = await lock(c);
  try {
    assertNoUnleasedBuilders(c);
    const result = cleanup(c, { full: args.includes('--full'), reportOnly: args.includes('--report') });
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2)); else printReport(result);
    if (!result.budgetSatisfied) process.exitCode = 2;
  } finally { lease.release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`build-cache: ${error.message}`); process.exitCode = 1; });

/** Conservative backstop for raw cargo/node/lake/rocq runs outside the wrapper. */
export function assertNoUnleasedBuilders(c, { platform = process.platform, run = execFileSync, readLink = fs.readlinkSync, realPath = fs.realpathSync.native, isAlive = alive } = {}) {
  const evidence = path.join(c.root, '.rml-cache', 'evidence');
  if (fs.existsSync(evidence) && fs.readdirSync(evidence).some(name => name.startsWith('external-lease-') && name.endsWith('.json'))) throw new Error('Active or unresolved external-resource lease; stop and verify owned Docker resources before cleanup');
  const queryOptions = { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  let processes;
  try {
    if (platform === 'win32') {
      // Command-line paths do not prove a process's working directory. Query its
      // actual process parameters; inaccessible live builders remain protected.
      const data = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./build-cache-windows.ps1', import.meta.url))], queryOptions);
      processes = [].concat(JSON.parse(data));
    } else {
      // Match the executable, never an argument mentioning e.g. "node". Include
      // state so zombies, which cannot write files, do not become active leases.
      processes = run('ps', ['-axo', 'pid=,ppid=,stat=,comm='], queryOptions).trim().split('\n').map(line => {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        return m && { pid: Number(m[1]), parent: Number(m[2]), state: m[3], executable: m[4] };
      }).filter(Boolean);
    }
    if (!processes.length || processes.some(p => !p || !Number.isInteger(p.pid) || !Number.isInteger(p.parent) || typeof p.executable !== 'string')) throw new Error('Invalid process inventory');
  } catch { throw new Error('Cannot inspect active builders; cleanup is disabled safely (ps/PowerShell required)'); }
  const ancestors = new Set([process.pid]);
  let cursor = process.pid;
  while (true) { const p = processes.find(p => p.pid === cursor); if (!p || ancestors.has(p.parent)) break; ancestors.add(p.parent); cursor = p.parent; }
  const builder = /^(cargo|rustc|rustdoc|node|lake|lean|rocq|coqc|coq_makefile|make|docker)(\.exe)?$/i;
  for (const p of processes) {
    if (ancestors.has(p.pid) || p.state === 'gone' || /^Z/.test(p.state ?? '')) continue;
    let executable = p.executable;
    if (platform === 'linux') {
      // Node/npm can change their process title. Prefer the kernel executable
      // link where visible, retaining the ps name as a conservative fallback.
      try { executable = readLink(`/proc/${p.pid}/exe`).replace(/ \(deleted\)$/, ''); } catch { /* cwd inspection below must still fail closed for a known builder. */ }
    }
    if (!builder.test(executable.split(/[\\/]/).at(-1))) continue;
    let cwd;
    if (platform === 'linux') {
      try { cwd = readLink(`/proc/${p.pid}/cwd`); } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
        throw new Error(`Cannot inspect active builder ${p.pid}; cleanup deferred`);
      }
    } else if (platform === 'darwin') {
      try { cwd = run('lsof', ['-a', '-p', String(p.pid), '-d', 'cwd', '-Fn'], queryOptions).split('\n').find(x => x.startsWith('n'))?.slice(1); }
      catch { /* A process can exit between ps and lsof; verify before deferring. */ }
      if (!cwd) {
        if (!isAlive(p.pid)) continue;
        try {
          const state = run('ps', ['-p', String(p.pid), '-o', 'stat='], queryOptions).trim();
          if (/^Z/.test(state)) continue;
        } catch { /* Missing/failed ps alone is not evidence of process death. */ }
        if (!isAlive(p.pid)) continue;
        throw new Error(`Cannot establish active builder ${p.pid}'s worktree; cleanup deferred`);
      }
    } else cwd = p.cwd;
    if (!cwd) throw new Error(`Unleased compiler ${p.pid} has unknown working directory; cleanup deferred${p.reason ? `: ${p.reason}` : ''}`);
    // Resolve /var versus /private/var on macOS and normalize Windows drive
    // spelling/case before comparing a cwd with the canonical repository root.
    let root = c.root;
    try { cwd = realPath(cwd); } catch {
      if (!isAlive(p.pid)) continue;
      throw new Error(`Cannot establish active builder ${p.pid}'s worktree; cleanup deferred`);
    }
    if (platform === 'win32') {
      cwd = path.win32.normalize(cwd).toLowerCase();
      root = path.win32.normalize(root).toLowerCase();
    }
    const separator = platform === 'win32' ? path.win32.sep : path.sep;
    if (cwd === root || cwd.startsWith(`${root}${separator}`)) throw new Error(`Active unleased build process ${p.pid}; cleanup deferred`);
  }
}
