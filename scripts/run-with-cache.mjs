#!/usr/bin/env node
/** Run a complete build/test/package/benchmark/acceptance operation under one lease. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { context, register, roots, validatePath, inventory, capture, lock, inheritedLease, cleanup, printReport, lowDisk, writeState, assertNoUnleasedBuilders } from './build-cache.mjs';
import { bootstrap } from './bootstrap.mjs';

function options(argv) {
  const options = { caches: [], retain: [], archive: [], command: [] };
  let category = 'rust';
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--') { options.command = argv.slice(i + 1); break; }
    if (['--cache', '--class', '--retain', '--archive'].includes(value) && !argv[i + 1]) throw new Error(`Missing ${value} value`);
    if (value === '--class') { category = argv[++i]; if (options.caches.length) options.caches.at(-1).class = category; }
    else if (value === '--cache') options.caches.push({ path: argv[++i], class: category });
    else if (value === '--retain') options.retain.push(argv[++i]);
    else if (value === '--archive') options.archive.push(argv[++i]);
    else throw new Error(`Unknown wrapper argument ${value}; put the command after --`);
  }
  if (!options.command.length) throw new Error('Usage: node scripts/run-with-cache.mjs [--cache path --class category] [--retain path] [--archive path] -- command args...');
  return options;
}
function signalTree(child, signal) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
}
async function execute(command, env, log, onSpawn) {
  const [name, ...args] = command;
  const child = spawn(name, args, { env, detached: process.platform !== 'win32', stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' && /^(npm|npx)(\.cmd)?$/.test(name) });
  if (child.pid) onSpawn?.(child.pid);
  let interrupted;
  let force;
  const grace = Number(process.env.RML_CACHE_SIGNAL_GRACE_MS ?? 15000);
  if (!Number.isFinite(grace) || grace < 0) throw new Error('RML_CACHE_SIGNAL_GRACE_MS must be non-negative');
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => {
    interrupted ??= signal;
    signalTree(child, signal);
    force ??= setTimeout(() => signalTree(child, 'SIGKILL'), grace);
  }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', data => { output.write(data); if (log) fs.writeSync(log, data); });
  const result = await new Promise(resolve => { child.once('error', error => { console.error(error.message); resolve(127); }); child.once('close', (status, signal) => resolve(status ?? 128 + (os.constants.signals[signal] ?? 1))); });
  // A shell may exit while grandchildren remain alive. Terminate the entire owned
  // process group before inspecting or deleting any generated output.
  if (child.pid) signalTree(child, 'SIGKILL');
  if (force) clearTimeout(force);
  for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  return interrupted ? 128 + (os.constants.signals[interrupted] ?? 1) : result;
}
async function main() {
  const opts = options(process.argv.slice(2));
  const c = context();
  if (inheritedLease(c)) {
    // The outer operation owns both lifecycle and cleanup, including all nested npm scripts.
    process.exitCode = await execute(opts.command, process.env);
    return;
  }
  bootstrap(c.root);
  const lease = await lock(c);
  let status;
  let baseline;
  let log;
  let archiveFailed = false;
  let cleanupFailed = false;
  try {
    assertNoUnleasedBuilders(c);
    for (const item of opts.caches) register(c, item.path, item.class);
    const targetFlag = opts.command.indexOf('--target-dir');
    const targetArg = opts.command.find(a => a.startsWith('--target-dir='))?.slice('--target-dir='.length);
    const target = targetArg ?? (targetFlag >= 0 ? opts.command[targetFlag + 1] : process.env.CARGO_TARGET_DIR);
    if (target) {
      const absolute = path.resolve(process.cwd(), target);
      register(c, path.relative(c.root, absolute).split(path.sep).join('/'), 'rust');
    }
    for (const keep of opts.retain) {
      validatePath(c, keep);
      if (!roots(c).some(r => r.path === keep)) throw new Error(`Only registered roots may be retained: ${keep}`);
    }
    c.registry.retained = [...new Set([...(c.registry.retained ?? []), ...opts.retain])];
    writeState(c);
    const preflight = cleanup(c);
    printReport(preflight);
    if (!preflight.budgetSatisfied) throw new Error('Aggregate cache budget exceeded by protected or retained data; command not started');
    lowDisk(c);
    baseline = inventory(c);
    const evidence = path.join(c.root, '.rml-cache', 'evidence');
    fs.mkdirSync(evidence, { recursive: true });
    const id = `${Date.now()}-${process.pid}`;
    log = fs.openSync(path.join(evidence, `${id}.log`), 'wx');
    const jobs = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
    const temporary = path.join(c.root, '.rml-cache', 'scratch', id);
    fs.mkdirSync(temporary, { recursive: true });
    const env = { CARGO_BUILD_JOBS: String(jobs), RUST_TEST_THREADS: String(jobs), CARGO_INCREMENTAL: '0', SCCACHE_CACHE_SIZE: '512M', ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, RML_CACHE_LEASE: lease.token };
    status = await execute(opts.command, env, log, pid => lease.child(pid));
    fs.writeFileSync(path.join(evidence, `${id}.json`), JSON.stringify({ command: opts.command, exitCode: status, timestamp: new Date().toISOString() }, null, 2));
    for (const relative of opts.archive) {
      const full = validatePath(c, relative);
      if (fs.existsSync(full)) fs.cpSync(full, path.join(evidence, id, relative), { recursive: true, dereference: false, errorOnExist: true });
    }
  } catch (error) {
    if (status === undefined) throw error;
    archiveFailed = true;
    console.error(`build-cache: evidence archive failed; cache retained: ${error.message}`);
  } finally {
    if (log !== undefined) fs.closeSync(log);
    try {
      if (baseline) {
        assertNoUnleasedBuilders(c);
        capture(c, baseline);
        if (!archiveFailed) {
          const postflight = cleanup(c);
          printReport(postflight);
          if (!postflight.budgetSatisfied) cleanupFailed = true;
        }
      }
    } catch (error) {
      // Never convert a failed test into a passing cleanup result or mask its status.
      cleanupFailed = true;
      console.error(`build-cache: CLEANUP FAILED: ${error.message}`);
      try { fs.writeFileSync(path.join(c.state, 'cleanup-failure.txt'), `${error.stack}\n`); } catch { /* Preserve the build's status even on a full/read-only filesystem. */ }
    } finally {
      try { lease.release(); } catch (error) { cleanupFailed = true; console.error(`build-cache: cannot release lease: ${error.message}`); }
    }
  }
  process.exitCode = status || (cleanupFailed || archiveFailed ? 2 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`run-with-cache: ${error.message}`); process.exitCode = 1; });
