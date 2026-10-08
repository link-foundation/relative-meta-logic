#!/usr/bin/env node
/** Repository-owned build cache policy. Never uses rm -rf, cargo clean, or global caches. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  return { bytes: s.size, hash: digest(fs.readFileSync(full)), modified: s.mtimeMs, mode: s.mode };
}
export function inventory(c) {
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
      for (const name of fs.readdirSync(full)) {
        walk(`${relative}/${name}`, category, disposable);
      }
    } else if (s.isFile()) files[relative] = { ...stamp(full), class: category, disposable: !!disposable };
    else protectedPaths.push({ path: relative, reason: 'not a regular file' });
  }
  for (const r of roots(c)) walk(r.path, r.class, r.disposable);
  return { files, protectedPaths };
}
export function capture(c, baseline) {
  if (!c.gitless) c.tracked = new Set(git(c.root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const after = inventory(c);
  for (const [relative, record] of Object.entries(after.files)) {
    const before = baseline.files[relative];
    const owned = c.registry.files[relative];
    // Existing unowned files are never adopted, even if a command overwrote them.
    // Existing owned files changed by the user before this command lose ownership.
    if (!before || (owned && owned.hash === before.hash && owned.bytes === before.bytes && owned.modified === before.modified && owned.mode === before.mode)) c.registry.files[relative] = { ...record, seen: owned && before && before.hash === record.hash && before.modified === record.modified ? owned.seen : Date.now() };
    else delete c.registry.files[relative];
  }
  for (const relative of Object.keys(c.registry.files)) if (!after.files[relative]) delete c.registry.files[relative];
  writeState(c);
}
function numberSetting(value, fallback, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a non-negative number`);
  return number;
}
export function cleanup(c, { full = false, reportOnly = false } = {}) {
  if (!c.gitless) c.tracked = new Set(git(c.root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const budget = numberSetting(process.env.RML_CACHE_BUDGET_BYTES, policy.budgetBytes, 'RML_CACHE_BUDGET_BYTES');
  const staleMs = numberSetting(process.env.RML_CACHE_STALE_HOURS, policy.staleHours, 'RML_CACHE_STALE_HOURS') * 3600000;
  const current = inventory(c);
  const entries = Object.entries(current.files);
  const before = entries.reduce((sum, [, f]) => sum + f.bytes, 0);
  let after = before;
  const protectedPaths = [...current.protectedPaths];
  const removed = [];
  const candidates = [];
  for (const [relative, record] of entries) {
    const owned = c.registry.files[relative];
    if (!owned || owned.hash !== record.hash || owned.bytes !== record.bytes || owned.modified !== record.modified || owned.mode !== record.mode) {
      protectedPaths.push({ path: relative, reason: owned ? 'modified since build (uncommitted work)' : 'predates ownership registration' });
      delete c.registry.files[relative];
      continue;
    }
    candidates.push([relative, record, owned]);
  }
  candidates.sort((a, b) => a[2].seen - b[2].seen || a[0].localeCompare(b[0]));
  for (const [relative, record, owned] of candidates) {
    // Incremental sessions and linked examples are disposable after the owned
    // process exits. Warm dependencies are retained within the budget; missing
    // files after eviction are rebuilt by Cargo's fingerprints. We do not run
    // an optional third-party sweeper with broader deletion authority.
    const disposable = record.disposable || (record.class === 'rust' && /\/(incremental|examples)\//.test(relative));
    const retained = (c.registry.retained ?? []).some(p => relative === p || relative.startsWith(`${p}/`));
    if (retained && !full) { protectedPaths.push({ path: relative, reason: 'retained until artifact handoff/full cleanup' }); continue; }
    if (!(full || disposable || Date.now() - owned.seen >= staleMs || after > budget)) continue;
    if (reportOnly) continue;
    const target = validatePath(c, relative);
    const fresh = stamp(target);
    if (!fresh || fresh.hash !== owned.hash || fresh.modified !== owned.modified || fresh.mode !== owned.mode || c.tracked.has(relative)) { protectedPaths.push({ path: relative, reason: 'changed during cleanup' }); continue; }
    fs.unlinkSync(target);
    delete c.registry.files[relative];
    removed.push(relative);
    after -= record.bytes;
    // rmdir only removes empty directories, never follows a symlink, and stops
    // before the worktree or a directory containing protected files.
    let dir = path.dirname(target);
    while (dir !== c.root) { try { fs.rmdirSync(dir); } catch { break; } dir = path.dirname(dir); }
  }
  const result = { version: 1, root: c.root, mode: full ? 'full' : 'bounded', beforeBytes: before, afterBytes: after, reclaimedBytes: before - after, budgetBytes: budget, budgetSatisfied: after <= budget, removed, protected: protectedPaths, classes: policy.classes, timestamp: new Date().toISOString() };
  if (!reportOnly) {
    if (full) c.registry.retained = [];
    writeState(c);
    const reports = path.join(c.root, '.rml-cache', 'reports');
    fs.mkdirSync(reports, { recursive: true });
    if (fs.lstatSync(path.join(reports, 'last-cleanup.json'), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Cache report may not be a symlink');
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
