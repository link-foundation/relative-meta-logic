#!/usr/bin/env node
/** Run a complete build/test/package/benchmark/acceptance operation under one lease. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { context, register, roots, validatePath, inventory, capture, beginProduction, resumeProduction, recordProductionOptions, reportProductionFailure, productionFailure, isolatedOutput, finishProduction, lock, inheritedLease, cleanup, printReport, lowDisk, writeState, assertNoUnleasedBuilders } from './build-cache.mjs';
import { bootstrap } from './bootstrap.mjs';

function options(argv) {
  const options = { caches: [], retain: [], archive: [], command: [], sourceMigration: false };
  let category = 'rust';
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--') { options.command = argv.slice(i + 1); break; }
    if (['--cache', '--class', '--retain', '--archive', '--isolate-output'].includes(value) && !argv[i + 1]) throw new Error(`Missing ${value} value`);
    if (value === '--source-migration') options.sourceMigration = true;
    else if (value === '--class') { category = argv[++i]; if (options.caches.length) options.caches.at(-1).class = category; }
    else if (value === '--cache') options.caches.push({ path: argv[++i], class: category });
    else if (value === '--isolate-output') options.isolateOutput = argv[++i];
    else if (value === '--retain') options.retain.push(argv[++i]);
    else if (value === '--archive') options.archive.push(argv[++i]);
    else throw new Error(`Unknown wrapper argument ${value}; put the command after --`);
  }
  if (!options.command.length) throw new Error('Usage: node scripts/run-with-cache.mjs [--cache path --class category] [--retain path] [--archive path] [--isolate-output root] [--source-migration] -- command args...');
  return options;
}
function signalTree(child, signal) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
}
function nestedWrapper(command) {
  const wrapper = fileURLToPath(import.meta.url);
  return command.slice(0, 2).some(argument => path.resolve(argument) === wrapper);
}
function operationCaches(c, opts) {
  const caches = [...opts.caches];
  // A directly invoked wrapper owns its command arguments and placeholders.
  // Resolving them here would give its compiler the outer scratch directory.
  if (!nestedWrapper(opts.command)) {
    const targetFlag = opts.command.indexOf('--target-dir');
    const targetArg = opts.command.find(a => a.startsWith('--target-dir='))?.slice('--target-dir='.length);
    const target = targetArg ?? (targetFlag >= 0 ? opts.command[targetFlag + 1] : process.env.CARGO_TARGET_DIR);
    if (target && !opts.isolateOutput && !target.includes('{output}')) {
      caches.push({ path: path.relative(c.root, path.resolve(process.cwd(), target)).split(path.sep).join('/'), class: 'rust' });
    }
  }
  if (opts.isolateOutput) caches.push({ path: opts.isolateOutput, class: opts.caches.find(item => item.path === opts.isolateOutput)?.class ?? 'rust' });
  return caches;
}
function operationCommand(opts, outputDirectory) {
  if (nestedWrapper(opts.command)) return opts.command;
  const targetFlag = opts.command.indexOf('--target-dir');
  return opts.command.map((argument, index) => opts.isolateOutput && index === targetFlag + 1 && targetFlag >= 0 ? outputDirectory : opts.isolateOutput && argument.startsWith('--target-dir=') ? `--target-dir=${outputDirectory}` : argument.replaceAll('{output}', outputDirectory));
}
function archiveOutputs(c, opts, evidence, id, outputDirectory) {
  for (const requested of opts.archive) {
    if (requested.includes('{output}') && requested !== '{output}' && !requested.startsWith('{output}/')) throw new Error('Archive output placeholder must start the path');
    const relative = requested.replaceAll('{output}', path.relative(c.root, outputDirectory).split(path.sep).join('/'));
    const full = validatePath(c, relative);
    if (fs.existsSync(full)) fs.cpSync(full, path.join(evidence, id, relative), { recursive: true, dereference: false, errorOnExist: true });
  }
}
async function executeNested(c, opts, checkAuthority) {
  // Only the outer wrapper captures ownership and cleans up. Nested/sibling
  // wrappers contribute atomic receipts to that same production session.
  resumeProduction(c);
  recordProductionOptions(c, { caches: operationCaches(c, opts), retain: opts.retain });
  const outputDirectory = opts.isolateOutput
    ? isolatedOutput(c, opts.isolateOutput, opts.caches.find(item => item.path === opts.isolateOutput)?.class ?? 'rust')
    : process.env.RML_CACHE_OUTPUT_DIR;
  if (!outputDirectory) throw new Error('Inherited producer output directory is unavailable');
  const command = operationCommand(opts, outputDirectory);
  const env = { ...process.env, RML_CACHE_OUTPUT_DIR: outputDirectory, ...(opts.isolateOutput ? { CARGO_TARGET_DIR: outputDirectory } : {}) };
  const evidence = path.join(c.root, '.rml-cache', 'evidence');
  const id = `${Date.now()}-${process.pid}`;
  let status;
  let sourceValidationFailed = false;
  let archiveFailed = false;
  try {
    status = await execute(command, env);
    if (opts.sourceMigration && status === 0) {
      try { await checkAuthority(); }
      catch (error) { sourceValidationFailed = true; console.error(`build-cache: source migration did not produce a consistent linked implementation: ${error.message}`); }
    }
    fs.writeFileSync(path.join(evidence, `${id}.json`), JSON.stringify({ command, nested: true, ...(opts.isolateOutput ? { isolatedOutput: path.relative(c.root, outputDirectory) } : {}), exitCode: status || (sourceValidationFailed ? 2 : 0), ...(opts.sourceMigration ? { commandExitCode: status, sourceMigration: true, sourceValidationPassed: status === 0 && !sourceValidationFailed } : {}), timestamp: new Date().toISOString() }, null, 2), { flag: 'wx' });
    archiveOutputs(c, opts, evidence, id, outputDirectory);
  } catch (error) {
    status ??= error.commandExitCode;
    if (status === undefined) throw error;
    archiveFailed = true;
    try { reportProductionFailure(c, error.message); }
    catch (failure) { console.error(`build-cache: cannot record nested evidence failure: ${failure.message}`); }
    console.error(`build-cache: evidence archive failed; cache retained: ${error.message}`);
  }
  return status || (archiveFailed || sourceValidationFailed ? 2 : 0);
}
export async function execute(command, env, log, onSpawn, checkResources, onResourceLimit) {
  // Node clamps overflowing timer delays to 1 ms. Reject those values before a
  // child starts, rather than silently changing the monitor or signal grace.
  const grace = Number(env.RML_CACHE_SIGNAL_GRACE_MS ?? 15000);
  const interval = Number(env.RML_CACHE_RESOURCE_INTERVAL_MS ?? 1000);
  if (!Number.isInteger(grace) || grace < 0 || grace > 2147483647) throw new Error('RML_CACHE_SIGNAL_GRACE_MS must be an integer from 0 to 2147483647');
  if (!Number.isInteger(interval) || interval < 1 || interval > 2147483647) throw new Error('RML_CACHE_RESOURCE_INTERVAL_MS must be an integer from 1 to 2147483647');
  const [name, ...args] = command;
  const child = spawn(name, args, { env, detached: process.platform !== 'win32', stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' && /^(npm|npx)(\.cmd)?$/.test(name) });
  let interrupted;
  let force;
  let monitor;
  let failure;
  let resourceFailure;
  let exited = false;
  let spawnFailed = false;
  const rememberFailure = error => { failure ??= error instanceof Error ? error : new Error(String(error)); };
  const report = message => {
    try { console.error(message); } catch (error) { rememberFailure(error); }
  };
  const kill = signal => {
    if (!child.pid) return;
    try { signalTree(child, signal); } catch (error) { rememberFailure(error); }
  };
  const stop = signal => {
    if (exited || child.exitCode !== null || child.signalCode !== null) return;
    interrupted ??= signal;
    kill(signal);
    force ??= setTimeout(() => kill('SIGKILL'), grace);
  };
  const fail = error => { rememberFailure(error); stop('SIGTERM'); };
  // Install completion listeners before ownership recording or any other
  // callback can fail. Always drain the pipes and await close before cleanup.
  const completion = new Promise(resolve => {
    child.once('error', error => { spawnFailed = true; report(error.message); });
    child.once('exit', () => {
      exited = true;
      clearInterval(monitor);
      clearTimeout(force);
      // A finished shell may leave grandchildren holding its output pipes open.
      // Kill the owned POSIX group now, before waiting for those pipes to close.
      if (process.platform !== 'win32') kill('SIGKILL');
    });
    child.once('close', (status, signal) => resolve(spawnFailed ? 127 : status ?? 128 + (os.constants.signals[signal] ?? 1)));
  });
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => stop(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const outputHandlers = [];
  let pendingOutput = 0;
  let outputDrained;
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    // Output destinations can emit an asynchronous EPIPE as well as throw.
    // Neither may abandon the detached build or bypass its lease cleanup.
    output.on('error', fail);
    outputHandlers.push([output, fail]);
    stream.on('error', fail);
    stream.on('data', data => {
      if (failure) return; // Continue draining after the first output failure.
      let settled = false;
      const written = error => {
        if (settled) return;
        settled = true;
        if (error) fail(error);
        if (--pendingOutput === 0) outputDrained?.();
      };
      pendingOutput++;
      try { output.write(data, written); }
      catch (error) { written(error); }
      if (!failure && log !== undefined) {
        try {
          for (let offset = 0; offset < data.length;) {
            const bytes = fs.writeSync(log, data, offset, data.length - offset);
            if (bytes <= 0) throw new Error('Evidence log write made no progress');
            offset += bytes;
          }
        } catch (error) { fail(error); }
      }
    });
  }
  try {
    if (child.pid) {
      try { onSpawn?.(child.pid); }
      catch (error) {
        rememberFailure(error);
        // Ownership recording may fail on a full filesystem. Stop this group
        // immediately; it must never escape the wrapper's lease lifecycle.
        kill('SIGKILL');
      }
    }
    if (checkResources && !failure) monitor = setInterval(() => {
      if (resourceFailure !== undefined || interrupted || exited || child.exitCode !== null || child.signalCode !== null) return;
      try { checkResources(); }
      catch (error) {
        resourceFailure = error instanceof Error ? error.message : String(error);
        // Stop before invoking reporting callbacks, which may themselves fail.
        stop('SIGTERM');
        try { onResourceLimit?.(resourceFailure); } catch (cause) { rememberFailure(cause); }
        report(`build-cache: stopping active command: ${resourceFailure}`);
      }
    }, interval);
    const result = await completion;
    if (pendingOutput) await new Promise(resolve => { outputDrained = resolve; });
    // Writable callbacks run before their error events. Keep the handlers until
    // the corresponding next-tick error notifications have also been delivered.
    await new Promise(resolve => setImmediate(resolve));
    const status = interrupted ? 128 + (os.constants.signals[interrupted] ?? 1) : result;
    if (failure) {
      throw Object.assign(new Error(failure.message, { cause: failure }), { commandExitCode: status || 1 });
    }
    return status;
  } finally {
    clearInterval(monitor);
    clearTimeout(force);
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    for (const [output, handler] of outputHandlers) output.removeListener('error', handler);
  }
}
async function main() {
  const opts = options(process.argv.slice(2));
  const c = context();
  const authorityGuard = path.join(c.root, 'scripts/check-linked-implementation.mjs');
  const checkAuthority = async () => {
    if (!fs.existsSync(authorityGuard)) {
      if (opts.sourceMigration) throw new Error('Source migration requires the linked implementation guard');
      return;
    }
    const { checkCurrentLinkedImplementation } = await import(new URL('./check-linked-implementation.mjs', import.meta.url));
    checkCurrentLinkedImplementation(c.root);
  };
  if (!opts.sourceMigration) await checkAuthority();
  else if (!fs.existsSync(authorityGuard)) throw new Error('Source migration requires the linked implementation guard');
  if (inheritedLease(c)) {
    process.exitCode = await executeNested(c, opts, checkAuthority);
    return;
  }
  bootstrap(c.root);
  const lease = await lock(c);
  let status;
  let baseline;
  let log;
  let archiveFailed = false;
  let cleanupFailed = false;
  let sourceValidationFailed = false;
  let resourceLimit;
  try {
    assertNoUnleasedBuilders(c);
    for (const item of operationCaches(c, opts)) register(c, item.path, item.class);
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
    const producerEnv = beginProduction(c, lease);
    recordProductionOptions(c, { caches: operationCaches(c, opts), retain: opts.retain });
    const evidence = path.join(c.root, '.rml-cache', 'evidence');
    fs.mkdirSync(evidence, { recursive: true });
    const id = `${Date.now()}-${process.pid}`;
    log = fs.openSync(path.join(evidence, `${id}.log`), 'wx');
    const jobs = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
    const temporary = isolatedOutput(c, '.rml-cache/scratch');
    const outputDirectory = opts.isolateOutput ? isolatedOutput(c, opts.isolateOutput, opts.caches.find(item => item.path === opts.isolateOutput)?.class ?? 'rust') : temporary;
    const command = operationCommand(opts, outputDirectory);
    const env = { CARGO_BUILD_JOBS: String(jobs), RUST_TEST_THREADS: String(jobs), CARGO_INCREMENTAL: '0', SCCACHE_CACHE_SIZE: '512M', ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, ...producerEnv, RML_CACHE_OUTPUT_DIR: outputDirectory, ...(opts.isolateOutput ? { CARGO_TARGET_DIR: outputDirectory } : {}), RML_CACHE_LEASE: lease.token };
    status = await execute(command, env, log, pid => lease.child(pid), () => lowDisk(c), reason => { resourceLimit = reason; });
    if (opts.sourceMigration && status === 0) {
      try { await checkAuthority(); }
      catch (error) { sourceValidationFailed = true; console.error(`build-cache: source migration did not produce a consistent linked implementation: ${error.message}`); }
    }
    fs.writeFileSync(path.join(evidence, `${id}.json`), JSON.stringify({ command, ...(opts.isolateOutput ? { isolatedOutput: path.relative(c.root, outputDirectory) } : {}), exitCode: status || (sourceValidationFailed ? 2 : 0), ...(resourceLimit ? { resourceLimit } : {}), ...(opts.sourceMigration ? { commandExitCode: status, sourceMigration: true, sourceValidationPassed: status === 0 && !sourceValidationFailed } : {}), timestamp: new Date().toISOString() }, null, 2));
    archiveOutputs(c, opts, evidence, id, outputDirectory);
  } catch (error) {
    // Execution failures are reported only after the owned child has stopped.
    // Keep its failure status and retain outputs when evidence could not be saved.
    status ??= error.commandExitCode;
    if (status === undefined) throw error;
    archiveFailed = true;
    console.error(`build-cache: evidence archive failed; cache retained: ${error.message}`);
  } finally {
    if (log !== undefined) {
      try { fs.closeSync(log); }
      catch (error) { archiveFailed = true; console.error(`build-cache: cannot close evidence log: ${error.message}`); }
    }
    try {
      if (baseline) {
        assertNoUnleasedBuilders(c);
        capture(c, baseline);
        if (productionFailure(c) !== null) archiveFailed = true;
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
      try { finishProduction(c); } catch (error) { cleanupFailed = true; console.error(`build-cache: cannot finish producer receipts: ${error.message}`); }
      try { lease.release(); } catch (error) { cleanupFailed = true; console.error(`build-cache: cannot release lease: ${error.message}`); }
    }
  }
  process.exitCode = status || (cleanupFailed || archiveFailed || sourceValidationFailed ? 2 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`run-with-cache: ${error.message}`); process.exitCode = 1; });
