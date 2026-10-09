import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { execute } from './run-with-cache.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('invalid resource or signal settings cannot start a detached child', async () => {
  for (const [key, value] of [
    ['RML_CACHE_SIGNAL_GRACE_MS', 'invalid'], ['RML_CACHE_SIGNAL_GRACE_MS', '2147483648'],
    ['RML_CACHE_RESOURCE_INTERVAL_MS', '0'], ['RML_CACHE_RESOURCE_INTERVAL_MS', '0.5'],
    ['RML_CACHE_RESOURCE_INTERVAL_MS', '2147483648'],
  ]) {
    const previous = process.env[key];
    let spawned = false;
    try {
      process.env[key] = value;
      await assert.rejects(execute([process.execPath, '-e', 'setInterval(() => {}, 1000)'], process.env,
        undefined, () => { spawned = true; }), new RegExp(key));
      assert.equal(spawned, false);
    } finally {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
  }
});

test('completed commands cancel monitoring and retain their real exit status', async () => {
  let checks = 0;
  const status = await execute([process.execPath, '-e', 'setTimeout(() => process.exit(7), 50)'],
    { ...process.env, RML_CACHE_RESOURCE_INTERVAL_MS: '10' }, undefined, undefined, () => { checks++; });
  assert.ok(checks > 0);
  assert.equal(status, 7);
  const completed = checks;
  await delay(50);
  assert.equal(checks, completed);
});

test('failure to record child ownership stops that child before returning', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-owner-record-'));
  try {
    const marker = path.join(root, 'escaped');
    await assert.rejects(execute([process.execPath, '-e',
      'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "escaped"), 100); setInterval(() => {}, 1000)', marker],
    process.env, undefined, () => { throw new Error('cannot record owner'); }), /cannot record owner/);
    await delay(150);
    assert.equal(fs.existsSync(marker), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resource reporting failures still stop the owned process and remove monitoring', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-resource-report-'));
  const ready = path.join(root, 'ready');
  let checks = 0;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, process.listenerCount(signal)]);
  try {
    await assert.rejects(execute([process.execPath, '-e',
      'require("node:fs").writeFileSync(process.argv[1], "ready"); setInterval(() => {}, 1000)', ready],
    { ...process.env, RML_CACHE_RESOURCE_INTERVAL_MS: '10', RML_CACHE_SIGNAL_GRACE_MS: '50' }, undefined, undefined,
    () => { checks++; if (fs.existsSync(ready)) throw new Error('reserve exhausted'); },
    () => { throw new Error('cannot save resource reason'); }), error => {
      assert.match(error.message, /cannot save resource reason/);
      assert.notEqual(error.commandExitCode, 0);
      return true;
    });
    const completed = checks;
    await delay(50);
    assert.equal(checks, completed);
    for (const [signal, count] of signals) assert.equal(process.listenerCount(signal), count);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('asynchronous output failure stops the child without leaking an error listener', () => {
  // Isolate stdout error injection from the test runner's own output transport.
  const program = `
    import assert from 'node:assert/strict';
    import { execute } from ${JSON.stringify(new URL('./run-with-cache.mjs', import.meta.url).href)};
    const original = process.stdout.write;
    const before = process.stdout.listenerCount('error');
    let injected = false;
    process.stdout.write = function(data, callback) {
      if (Buffer.isBuffer(data) && data.toString() === 'rml-output-probe') {
        injected = true;
        const error = new Error('simulated output EPIPE');
        process.nextTick(() => {
          callback(error);
          process.nextTick(() => process.stdout.emit('error', error));
        });
        return false;
      }
      return original.apply(this, arguments);
    };
    try {
      await assert.rejects(execute([process.execPath, '-e',
        'process.stdout.write("rml-output-probe"); setInterval(() => {}, 1000)'],
      { ...process.env, RML_CACHE_SIGNAL_GRACE_MS: '50' }), /simulated output EPIPE/);
      assert.equal(injected, true);
      assert.equal(process.stdout.listenerCount('error'), before);
    } finally { process.stdout.write = original; }
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
});

test('partial evidence writes are completed rather than silently truncating the log', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-partial-log-'));
  const file = path.join(root, 'output.log');
  const fd = fs.openSync(file, 'wx');
  const original = fs.writeSync;
  let writes = 0;
  fs.writeSync = function(target, data, offset, length) {
    if (target !== fd) return original.apply(this, arguments);
    writes++;
    return original.call(this, target, data, offset, Math.min(2, length));
  };
  try {
    assert.equal(await execute([process.execPath, '-e', 'process.stdout.write("partial-log")'], process.env, fd), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), 'partial-log');
    assert.ok(writes > 1);
  } finally {
    fs.writeSync = original;
    fs.closeSync(fd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an exited command cannot hang on a grandchild holding its output pipes', { skip: process.platform === 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-resource-descendant-'));
  const marker = path.join(root, 'escaped');
  const descendant = 'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "escaped"), 300); setInterval(() => {}, 1000)';
  const program = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, ${JSON.stringify(marker)}], { stdio: ['ignore', 1, 2] }).unref(); process.exit(7);`;
  try {
    const status = await execute([process.execPath, '-e', program], process.env);
    assert.equal(status, 7);
    await delay(350);
    assert.equal(fs.existsSync(marker), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('disk exhaustion during a build stops the owned child, records failure, and releases its lease', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-resource-watch-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    for (const file of ['run-with-cache.mjs', 'build-cache.mjs', 'docker-cache-budget.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'bootstrap.mjs', 'initialize-meta-language.mjs']) {
      fs.copyFileSync(path.join(scripts, file), path.join(root, 'scripts', file));
    }
    fs.mkdirSync(path.join(root, 'target'));
    fs.writeFileSync(path.join(root, 'target', 'user-source.txt'), 'pre-existing and protected');
    // Simulate a changing filesystem reserve without filling the real disk.
    // The production wrapper still executes its ordinary lowDisk() check.
    fs.writeFileSync(path.join(root, 'disk-probe.mjs'), `
      import fs from 'node:fs';
      const real = fs.statfsSync.bind(fs);
      fs.statfsSync = (...args) => {
        const result = real(...args);
        return { ...result, bavail: fs.existsSync('ready') ? 0 : 1024 ** 4 };
      };
    `);
    fs.writeFileSync(path.join(root, 'build.mjs'), `
      import fs from 'node:fs';
      const { writeProducedFile } = await import('./scripts/build-cache.mjs');
      writeProducedFile('target/generated.bin', 'owned output');
      process.on('SIGTERM', () => { fs.writeFileSync('terminated', 'yes'); process.exit(0); });
      fs.writeFileSync('ready', 'yes');
      setInterval(() => {}, 1000);
    `);
    const env = { ...process.env, RML_CACHE_SOURCE_ARCHIVE: '1', RML_CACHE_MIN_FREE_BYTES: '268435456', RML_CACHE_RESOURCE_INTERVAL_MS: '10', RML_CACHE_SIGNAL_GRACE_MS: '100' };
    delete env.RML_CACHE_LEASE;
    const run = spawnSync(process.execPath, ['--import', './disk-probe.mjs', 'scripts/run-with-cache.mjs', '--', process.execPath, 'build.mjs'],
      { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(run.error, undefined);
    assert.notEqual(run.status, 0, 'an interrupted child exiting zero is not a successful build');
    assert.match(run.stderr, /stopping active command: Low disk/);
    if (process.platform !== 'win32') assert.equal(fs.readFileSync(path.join(root, 'terminated'), 'utf8'), 'yes');
    const evidence = path.join(root, '.rml-cache', 'evidence');
    const receiptFile = fs.readdirSync(evidence).find(file => file.endsWith('.json'));
    assert.ok(receiptFile);
    const receipt = JSON.parse(fs.readFileSync(path.join(evidence, receiptFile), 'utf8'));
    assert.equal(receipt.exitCode, run.status);
    assert.match(receipt.resourceLimit, /Low disk: 0 bytes available/);
    assert.equal(fs.existsSync(path.join(root, '.rml-cache', 'state', 'rml-cache', 'lock')), false);
    const cleanup = spawnSync(process.execPath, ['scripts/build-cache.mjs', '--full'], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.equal(fs.existsSync(path.join(root, 'target', 'generated.bin')), false);
    assert.equal(fs.readFileSync(path.join(root, 'target', 'user-source.txt'), 'utf8'), 'pre-existing and protected');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('evidence log failures stop the build, preserve outputs, and release the lease', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-log-failure-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    for (const file of ['run-with-cache.mjs', 'build-cache.mjs', 'docker-cache-budget.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'bootstrap.mjs', 'initialize-meta-language.mjs']) {
      fs.copyFileSync(path.join(scripts, file), path.join(root, 'scripts', file));
    }
    fs.writeFileSync(path.join(root, 'log-probe.mjs'), `
      import fs from 'node:fs';
      const open = fs.openSync.bind(fs);
      const write = fs.writeSync.bind(fs);
      const close = fs.closeSync.bind(fs);
      let log;
      fs.openSync = (file, ...args) => {
        const fd = open(file, ...args);
        if (String(file).endsWith('.log')) log = fd;
        return fd;
      };
      fs.writeSync = (fd, ...args) => {
        if (fd === log) throw new Error('simulated evidence ENOSPC');
        return write(fd, ...args);
      };
      fs.closeSync = fd => {
        if (fd === log) log = undefined;
        return close(fd);
      };
    `);
    fs.writeFileSync(path.join(root, 'build.mjs'), `
      import fs from 'node:fs';
      fs.mkdirSync('target');
      const { writeProducedFile } = await import('./scripts/build-cache.mjs');
      writeProducedFile('target/generated.bin', 'owned output');
      process.on('SIGTERM', () => {});
      console.log('build output');
      setInterval(() => {}, 1000);
    `);
    const env = { ...process.env, RML_CACHE_SOURCE_ARCHIVE: '1', RML_CACHE_MIN_FREE_BYTES: '0', RML_CACHE_SIGNAL_GRACE_MS: '50' };
    delete env.RML_CACHE_LEASE;
    const run = spawnSync(process.execPath, ['--import', './log-probe.mjs', 'scripts/run-with-cache.mjs', '--', process.execPath, 'build.mjs'],
      { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(run.error, undefined);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /evidence archive failed; cache retained: simulated evidence ENOSPC/);
    assert.equal(fs.existsSync(path.join(root, '.rml-cache', 'state', 'rml-cache', 'lock')), false);
    assert.equal(fs.readFileSync(path.join(root, 'target', 'generated.bin'), 'utf8'), 'owned output');
    assert.ok(JSON.parse(fs.readFileSync(path.join(root, '.rml-cache', 'state', 'rml-cache', 'registry.json'), 'utf8')).files['target/generated.bin']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('temporary active growth above the cleanup budget is allowed, then reclaimed safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-aggregate-growth-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    for (const file of ['run-with-cache.mjs', 'build-cache.mjs', 'docker-cache-budget.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'bootstrap.mjs', 'initialize-meta-language.mjs']) fs.copyFileSync(path.join(scripts, file), path.join(root, 'scripts', file));
    fs.writeFileSync(path.join(root, 'build.mjs'), `
      import fs from 'node:fs';
      import { writeProducedFile } from './scripts/build-cache.mjs';
      writeProducedFile('target/generated', 'x'.repeat(10000));
      fs.writeFileSync('target/user', 'keep');
      setTimeout(() => { fs.writeFileSync('consumed', 'yes'); }, 100);
    `);
    const env = { ...process.env, RML_CACHE_SOURCE_ARCHIVE: '1', RML_CACHE_MIN_FREE_BYTES: '0', RML_CACHE_BUDGET_BYTES: '100', RML_CACHE_RESOURCE_INTERVAL_MS: '10', RML_CACHE_SIGNAL_GRACE_MS: '100' };
    delete env.RML_CACHE_LEASE;
    const run = spawnSync(process.execPath, ['scripts/run-with-cache.mjs', '--', process.execPath, 'build.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'consumed'), 'utf8'), 'yes');
    assert.equal(fs.existsSync(path.join(root, 'target/generated')), false);
    assert.equal(fs.readFileSync(path.join(root, 'target/user'), 'utf8'), 'keep');
    const report = JSON.parse(fs.readFileSync(path.join(root, '.rml-cache/reports/last-cleanup.json'), 'utf8'));
    assert.equal(report.reclaimedBytes, 10000);
    assert.equal(report.afterBytes, 4);
    assert.equal(report.budgetSatisfied, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
