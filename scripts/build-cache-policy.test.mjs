import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = p => readFileSync(join(root, p), 'utf8');
const workflows = readdirSync(join(root, '.github/workflows')).filter(p => /\.ya?ml$/.test(p));

// The workflows deliberately keep job/step keys at canonical indentation so this
// dependency-free policy check covers new jobs without pulling a YAML package.
const jobs = source => source.split(/(?=^  [\w-]+:\s*$)/m).filter(s => /actions\/checkout@/.test(s));
const steps = job => job.split(/(?=^      - (?:name|uses):)/m).slice(1);

for (const filename of workflows) {
  test(`${filename}: every checkout job bootstraps, archives and always tears down`, () => {
    for (const job of jobs(read(`.github/workflows/${filename}`))) {
      assert.match(job, /actions\/setup-node@/, 'cleanup requires Node even in Rust/formal jobs');
      assert.match(job, /node scripts\/bootstrap\.mjs/);
      const list = steps(job);
      const teardown = list.findIndex(s => /run: node scripts\/build-cache\.mjs --full/.test(s));
      assert.equal(teardown, list.length - 1, 'full cleanup must be the final job step');
      assert.match(list[teardown], /if: always\(\)/);
      const upload = list.findIndex(s => /uses: actions\/upload-artifact@/.test(s));
      assert.ok(upload >= 0 && upload < teardown, 'upload evidence before deleting generated outputs');
      assert.match(list[upload], /if: always\(\)/);
      assert.match(list[upload], /\.rml-cache\/evidence/);
      assert.match(list[upload], /include-hidden-files: true/);
      for (const step of list) {
        if (/\b(?:cargo (?:build|test|doc|bench)|lake build|rocq makefile)\b/.test(step)) {
          assert.match(step, /node (?:\.\.\/)?scripts\/run-with-cache\.mjs/, 'mutating builds must hold a cache lease');
        }
      }
    }
  });
}

test('docs and parity consume build outputs before cleanup can evict them', () => {
  const docs = read('.github/workflows/api-docs.yml');
  assert.match(docs, /run-with-cache\.mjs --isolate-output target\/api-docs --retain _site --/);
  assert.match(docs, /publish-cache-output\.mjs/);
  assert.ok(docs.indexOf('actions/upload-pages-artifact@') < docs.indexOf('run: node scripts/build-cache.mjs --full'));
  const parityStep = steps(jobs(read('.github/workflows/parity.yml'))[0]).find(s => s.includes('cargo build'));
  assert.match(parityStep, /run-with-cache\.mjs/);
  assert.match(parityStep, /node scripts\/check-corpus-parity\.mjs/);
});

test('formal jobs preserve the pinned checkout and own only disposable proof-build copies', () => {
  const formal = read('.github/workflows/formal-corpus.yml');
  assert.equal((formal.match(/path: upstream-meta-theory/g) ?? []).length, 3);
  for (const language of ['lean', 'rocq']) {
    assert.ok(formal.includes(`cp -R upstream-meta-theory/drafts/0.0.3/src/${language}/.`));
  }
  assert.match(formal, /--cache \.rml-cache\/lean --class lean --isolate-output \.rml-cache\/lean/);
  assert.match(formal, /--cache \.rml-cache\/compiler --class compiler --isolate-output \.rml-cache\/compiler/);
  assert.match(formal, /RML_REFERENCE_CORPUS="\$RML_CACHE_OUTPUT_DIR\/pinned"/);
  assert.match(formal, /cp -R upstream-meta-theory\/drafts\/0\.0\.3\/src\/rocq\/\. "\$RML_REFERENCE_CORPUS\/"/);
  assert.match(formal, /--volume "\$RML_REFERENCE_CORPUS:\/work"/);
  assert.doesNotMatch(formal, /(?:chown|chmod)[^\n]*RML_CACHE_OUTPUT_DIR/);
  assert.doesNotMatch(formal, /sudo chown -R \S+ \.(?:\s|$)/);
  assert.doesNotMatch(formal, /rm -rf.*upstream-meta-theory/);
});

test('orientation Docker jobs retain host ownership of the private producer root', () => {
  const orientation = read('.github/workflows/orientation-proofs.yml');
  assert.match(orientation, /sudo chown -R 1000:1000 "\$RML_CACHE_OUTPUT_DIR\/orientation-native"/);
  assert.match(orientation, /--volume "\$RML_CACHE_OUTPUT_DIR\/orientation-native:\/rml-native"/);
  assert.doesNotMatch(orientation, /(?:chown|chmod)[^\n]*"\$RML_CACHE_OUTPUT_DIR"/);
  assert.doesNotMatch(orientation, /(?:chown|chmod)[^\n]*\\"\$RML_CACHE_OUTPUT_DIR\\"/);
});

test('Docker lifecycle never uses global pruning, remote cache exports, or anonymous persistent target mounts', () => {
  const sources = ['.github/workflows/docker.yml', 'docker/ci-build.sh', 'docker/Dockerfile.js', 'docker/Dockerfile.rust'].map(read).join('\n');
  assert.doesNotMatch(sources, /docker\s+(?:system|builder|image|container|volume)\s+prune|docker\s+buildx\s+prune/);
  assert.doesNotMatch(sources, /cache-(?:to|from):|mode=max|--mount=type=cache/);
  const helper = read('docker/ci-build.sh');
  assert.match(helper, /--driver docker-container/);
  assert.match(helper, /docker image rm "\$image_id"/);
  assert.match(helper, /docker buildx rm "\$builder"/);
  assert.match(helper, /owned_volume/);
  assert.match(helper, /current_id == "\$container_id"/);
  assert.match(read('docker/buildkitd.toml'), /maxUsedSpace = "__RML_CACHE_BUDGET_BYTES__B"/);
  assert.doesNotMatch(read('docker/buildkitd.toml'), /2GB|256MB/);
  assert.match(helper, /budget check/);
  for (const file of ['docker/Dockerfile.js', 'docker/Dockerfile.rust']) {
    assert.match(read(file), /RML_CACHE_SOURCE_ARCHIVE=1/);
    assert.match(read(file), /RUN node \.\.\/scripts\/run-with-cache\.mjs/);
    assert.match(read(file), /node \.\.\/scripts\/build-cache\.mjs --full/);
  }
});

test('cache categories, bootstrap entry points and compact Cargo profiles remain registered', () => {
  const policy = JSON.parse(read('scripts/cache-policy.json'));
  const roots = policy.roots.map(r => r.path);
  for (const expected of ['rust/target', 'target', '_site', 'js/coverage', 'js/node_modules/.cache', 'vscode/server']) {
    assert.ok(roots.includes(expected), `missing generated root ${expected}`);
  }
  for (const category of ['scratch', 'consumers', 'parser', 'compiler', 'lean', 'rocq', 'acceptance', 'benchmark', 'containers']) {
    assert.ok(roots.includes(`.rml-cache/${category}`), `missing generated ${category} root`);
  }
  const pkg = JSON.parse(read('js/package.json'));
  assert.match(pkg.scripts.prepare, /bootstrap\.mjs/);
  for (const command of ['test', 'docs', 'build:playground']) assert.match(pkg.scripts[command], /run-with-cache\.mjs/);
  const cargo = read('rust/Cargo.toml');
  for (const profile of ['dev', 'test']) assert.match(cargo, new RegExp(`\\[profile\\.${profile}\\][\\s\\S]*?debug = 0[\\s\\S]*?incremental = false`));
});

const fakeDocker = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const path = process.env.MOCK_DOCKER_STATE;
const s = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : { calls: [], images: {} };
s.calls.push(args);
const save = () => fs.writeFileSync(path, JSON.stringify(s));
const stop = (code=0, output='') => { save(); if (output) process.stdout.write(output+'\\n'); process.exit(code); };
const missing = kind => { save(); process.stderr.write('Error: No such '+kind+'\\n'); process.exit(1); };
const value = flag => args[args.indexOf(flag)+1];
const format = () => value('--format');
if (args[0] === 'volume') {
  if (args[1] === 'create') {
    s.volume = args.at(-1);
    s.owner = value('--label').split('=').slice(1).join('=');
    s.run = args[args.lastIndexOf('--label')+1].split('=').slice(1).join('=');
    stop(0,s.volume);
  }
  if (args[1] === 'inspect') {
    if (!s.volume) missing('volume');
    if (!args.includes('--format')) stop(0,s.volume);
    if (format() === '{{json .}}') stop(0,JSON.stringify({Name:s.volume,Labels:{'org.link-foundation.rml.owner':process.env.MOCK_VOLUME_MISMATCH ? 'someone-else' : s.owner,'org.link-foundation.rml.run':s.run}}));
    if (format().includes('.owner')) stop(0, process.env.MOCK_VOLUME_MISMATCH ? 'someone-else' : s.owner);
    if (format().includes('.run')) stop(0,s.run);
  }
  if (args[1] === 'rm') { delete s.volume; stop(); }
}
if (args[0] === 'buildx') {
  if (args[1] === 'create') { s.builder=value('--name'); s.node=value('--node'); stop(); }
  if (args[1] === 'inspect') {
    if (!s.builder) stop(1);
    if (process.env.MOCK_BOOTSTRAP_FAIL && args.includes('--bootstrap')) stop(9);
    if (args.includes('--bootstrap')) s.container='owned-container-id';
    stop(0,'Name: '+s.builder+'\\nDriver: docker-container\\nNodes:\\nName: '+s.node+'\\nEndpoint: '+(s.endpointChanged ? 'unix:///foreign.sock' : 'unix:///docker.sock'));
  }
  if (args[1] === 'rm') { delete s.builder; delete s.container; delete s.volume; stop(); }
  if (args[1] === 'build') {
    if (process.env.MOCK_BUILD_FAIL) stop(17);
    if (process.env.MOCK_BUILDER_ENDPOINT_CHANGE) s.endpointChanged=true;
    const id='sha256:'+String(Object.keys(s.images).length+1).repeat(64);
    s.images[id]=true;
    fs.writeFileSync(value('--iidfile'),id);
    stop();
  }
}
if (args[0] === 'inspect') {
  if (!s.container) missing('container');
  if (format() === '{{json .}}') stop(0,JSON.stringify({Id:process.env.MOCK_BUILDER_MISMATCH ? 'foreign-container-id' : s.container,Mounts:[{Destination:'/var/lib/buildkit',Name:s.volume,Type:'volume'}]}));
  if (format() === '{{.Id}}') stop(0,s.container);
  stop(0,s.volume);
}
if (args[0] === 'image') {
  if (args[1] === 'inspect') {
    if (!s.images[args[2]]) missing('image');
    if (format() === '{{json .}}') stop(0,JSON.stringify({Id:args[2],Size:Number(process.env.MOCK_IMAGE_BYTES ?? '200'),Config:{Labels:{'org.link-foundation.rml.owner':process.env.MOCK_IMAGE_MISMATCH ? 'someone-else' : s.owner,'org.link-foundation.rml.run':s.run}}}));
    if (format().includes('.owner')) stop(0,process.env.MOCK_IMAGE_MISMATCH ? 'someone-else' : s.owner);
    stop(0,s.run);
  }
  if (args[1] === 'rm') { delete s.images[args[2]]; stop(); }
}
if (args[0] === 'container') {
  if (args[1] === 'inspect') {
    const cid=Object.keys(s.containers ?? {}).find(id => id===args[2] || s.containers[id].name===args[2]);
    if (!cid) missing('container');
    const container=s.containers[cid];
    if (format() === '{{json .}}') stop(0,JSON.stringify({Id:cid,Name:'/'+container.name,SizeRw:process.env.MOCK_CONTAINER_SIZE_UNSUPPORTED ? undefined : Number(process.env.MOCK_CONTAINER_BYTES ?? 40),Config:{Labels:{'org.link-foundation.rml.owner':process.env.MOCK_CONTAINER_MISMATCH ? 'someone-else' : container.owner,'org.link-foundation.rml.run':container.run}}}));
    if (format() === '{{.Id}}') stop(0,cid);
    if (format().includes('.owner')) stop(0,process.env.MOCK_CONTAINER_MISMATCH ? 'someone-else' : container.owner);
    stop(0,container.run);
  }
  if (args[1] === 'stop' || args[1] === 'wait') stop(process.env.MOCK_CONTAINER_STOP_FAIL ? 27 : 0);
  if (args[1] === 'rm') {
    if (process.env.MOCK_CONTAINER_RENAMED_REMAINS) s.containers[args[2]].name='unexpected-renamed-container';
    else delete s.containers[args[2]];
    stop();
  }
}
if (args[0] === 'exec') {
  if (args[1] !== s.container || args[2] !== 'buildctl' || args[3] !== 'du' || args[4] !== '--format') stop(31,'unexpected BuildKit accounting command');
  if (process.env.MOCK_ACCOUNTING_UNSUPPORTED) stop(2,'unknown flag: --format');
  if (process.env.MOCK_ACCOUNTING_MALFORMED) stop(0,'not numeric JSON');
  stop(0,JSON.stringify({ID:'owned-buildkit-record',Size:process.env.MOCK_BUILDKIT_BYTES ?? '100'}));
}
if (args[0] === 'run') {
  const cid='c'.repeat(64);
  s.containers ??= {};
  s.containers[cid]={name:value('--name'),owner:value('--label').split('=').slice(1).join('='),run:args[args.lastIndexOf('--label')+1].split('=').slice(1).join('=')};
  fs.writeFileSync(value('--cidfile'),cid);
  if (process.env.MOCK_LOCAL_BYTES) fs.writeFileSync(require('node:path').join(process.env.RML_CACHE_OUTPUT_DIR, 'owned-temporary-output'),Buffer.alloc(Number(process.env.MOCK_LOCAL_BYTES)));
  stop(process.env.MOCK_SMOKE_FAIL ? 23 : 0);
}
if (args[0] === 'compose') stop();
stop(1,'Unsupported fake Docker call: '+JSON.stringify(args));
`;

function exerciseDocker(env = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'rml-docker-policy-'));
  try {
    mkdirSync(join(fixture, 'docker'));
    mkdirSync(join(fixture, 'bin'));
    mkdirSync(join(fixture, 'scripts'));
    const privateOutput = join(fixture, '.rml-cache/scratch/private-output');
    mkdirSync(privateOutput, { recursive: true });
    copyFileSync(join(root, 'docker/ci-build.sh'), join(fixture, 'docker/ci-build.sh'));
    copyFileSync(join(root, 'docker/run-owned.sh'), join(fixture, 'docker/run-owned.sh'));
    copyFileSync(join(root, 'docker/buildkitd.toml'), join(fixture, 'docker/buildkitd.toml'));
    for (const script of ['docker-cache-budget.mjs', 'build-cache.mjs', 'cache-policy.json']) copyFileSync(join(root, 'scripts', script), join(fixture, 'scripts', script));
    writeFileSync(join(fixture, 'bin/fake-docker.cjs'), fakeDocker);
    // Generate a real Bash signal: Node's process.kill on Windows terminates a
    // native PID and cannot exercise Git Bash's POSIX signal/trap semantics.
    writeFileSync(join(fixture, 'bin/docker'), `#!/usr/bin/env bash
node "$MOCK_DOCKER_PROGRAM" "$@"
status=$?
if [[ -n \${MOCK_SIGNAL:-} && \${1:-} == run && $status == 0 ]]; then
  kill -TERM "$PPID" || exit 91
fi
exit "$status"
`, { mode: 0o755 });
    const state = join(fixture, 'docker.json');
    const result = spawnSync('bash', ['docker/ci-build.sh'], {
      cwd: fixture,
      env: { ...process.env, RML_CACHE_SOURCE_ARCHIVE: '1', RML_CACHE_OUTPUT_DIR: privateOutput, PATH: `${join(fixture, 'bin')}:${process.env.PATH}`, MOCK_DOCKER_PROGRAM: join(fixture, 'bin/fake-docker.cjs'), MOCK_DOCKER_STATE: state, ...env },
      encoding: 'utf8', timeout: 60000,
    });
    assert.ifError(result.error);
    return { ...result, state: JSON.parse(readFileSync(state, 'utf8')), externalLeases: readdirSync(join(fixture, '.rml-cache/evidence')).filter(p => p.startsWith('external-lease-')), budgetReports: readdirSync(join(fixture, '.rml-cache/reports')).filter(p => p.startsWith('docker-budget-')).map(p => JSON.parse(readFileSync(join(fixture, '.rml-cache/reports', p), 'utf8'))) };
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}

test('Docker success consumes both images and removes only owned exact resources', () => {
  const result = exerciseDocker();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.state.builder, undefined);
  assert.equal(result.state.volume, undefined);
  assert.deepEqual(result.state.images, {});
  assert.deepEqual(result.state.containers, {});
  assert.deepEqual(result.externalLeases, []);
  assert.equal(result.state.calls.filter(a => a[0] === 'container' && a[1] === 'wait').length, 2);
  assert.equal(result.state.calls.filter(a => a[0] === 'run').length, 2);
  for (const call of result.state.calls.filter(a => a[0] === 'image' && a[1] === 'rm')) assert.match(call[2], /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.budgetReports.length, 3);
  const report = result.budgetReports.find(report => report.resourceKind === 'buildx');
  assert.equal(report.dockerBytes, 500);
  assert.equal(report.beforeBytes - report.afterBytes, 500);
  assert.equal(report.reclaimedBytes, 500);
  assert.equal(report.resourcesRemoved, true);
  assert.equal(report.budgetSatisfied, true);
  assert.match(report.metric, /logical.*shared/);
  for (const containerReport of result.budgetReports.filter(report => report.resourceKind === 'docker-container')) assert.equal(containerReport.reclaimedBytes, 40);
});

for (const [name, env, status] of [
  ['failed bootstrap', { MOCK_BOOTSTRAP_FAIL: '1' }, 9],
  ['failed build', { MOCK_BUILD_FAIL: '1' }, 17],
  ['failed smoke test', { MOCK_SMOKE_FAIL: '1' }, 23],
  ['termination signal', { MOCK_SIGNAL: '1' }, 143],
]) {
  test(`Docker ${name} preserves exit status and releases its builder`, () => {
    const result = exerciseDocker(env);
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.state.builder, undefined);
    assert.equal(result.state.volume, undefined);
    assert.deepEqual(result.state.images, {});
  });
}

test('Docker mismatched image ownership fails closed without deleting it', () => {
  const result = exerciseDocker({ MOCK_IMAGE_MISMATCH: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.state.calls.filter(a => a[0] === 'image' && a[1] === 'rm').length, 0);
  assert.match(result.stderr, /without matching ownership labels/);
});

test('Docker mismatched builder-state labels fail closed without deleting it', () => {
  const result = exerciseDocker({ MOCK_VOLUME_MISMATCH: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.state.calls.filter(a => a[0] === 'buildx' && a[1] === 'rm').length, 0);
  assert.ok(result.state.volume);
});


test('Docker container ownership mismatch never stops a foreign process and retains its lease', () => {
  const result = exerciseDocker({ MOCK_CONTAINER_MISMATCH: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.state.calls.filter(a => a[0] === 'container' && a[1] === 'stop').length, 0);
  assert.ok(result.externalLeases.length > 0);
});

test('failed Docker container stop preserves the external lease instead of freeing active scratch', () => {
  const result = exerciseDocker({ MOCK_CONTAINER_STOP_FAIL: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.state.calls.filter(a => a[0] === 'container' && a[1] === 'rm').length, 0);
  assert.ok(result.externalLeases.length > 0);
});

for (const [name, env] of [
  ['unsupported exact-byte accounting', { MOCK_ACCOUNTING_UNSUPPORTED: '1' }],
  ['malformed exact-byte accounting', { MOCK_ACCOUNTING_MALFORMED: '1' }],
]) {
  test(`Docker ${name} fails before any workload and still removes exact resources`, () => {
    const result = exerciseDocker(env);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.state.calls.filter(a => a[0] === 'buildx' && a[1] === 'build').length, 0);
    assert.equal(result.state.builder, undefined);
    assert.equal(result.state.volume, undefined);
    assert.equal(result.budgetReports[0].beforeBytes, null);
    assert.equal(result.budgetReports[0].reclaimedBytes, null);
    assert.match(result.budgetReports[0].accountingError, /accounting unavailable/);
  });
}

test('Docker temporary aggregate excess is measured and then reclaimed before the final budget boundary', () => {
  // The generated config and IID files count as local bytes. Either daemon
  // class individually fits 1500 bytes; the aggregate is deliberately larger.
  const result = exerciseDocker({ RML_CACHE_BUDGET_BYTES: '1500', MOCK_BUILDKIT_BYTES: '600', MOCK_IMAGE_BYTES: '600' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.state.calls.filter(a => a[0] === 'run').length, 2);
  assert.equal(result.state.builder, undefined);
  assert.deepEqual(result.state.images, {});
  const report = result.budgetReports.find(report => report.resourceKind === 'buildx');
  assert.equal(report.budgetBytes, 1500);
  assert.equal(report.dockerBytes, 1800);
  assert.ok(report.beforeBytes > report.budgetBytes);
  assert.ok(report.afterBytes < report.budgetBytes);
  assert.equal(report.reclaimedBytes, 1800);
  assert.equal(report.budgetSatisfied, true);
  assert.equal(report.finalBudgetEnforcement, 'outer-wrapper-postflight');
});

test('Docker changed builder endpoint preserves its state and fails closed', () => {
  const result = exerciseDocker({ MOCK_BUILDER_ENDPOINT_CHANGE: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /endpoint identity changed/);
  assert.equal(result.state.calls.filter(a => a[0] === 'buildx' && a[1] === 'rm').length, 0);
  assert.ok(result.state.volume);
  assert.ok(result.externalLeases.length > 0);
});

test('Docker writable container layers consume the aggregate budget and are measured on teardown', () => {
  const result = exerciseDocker({ RML_CACHE_BUDGET_BYTES: '10000', MOCK_CONTAINER_BYTES: '20000' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.state.containers, {});
  assert.equal(result.state.builder, undefined);
  const report = result.budgetReports.find(report => report.resourceKind === 'docker-container');
  assert.ok(report.beforeBytes > report.budgetBytes);
  assert.ok(report.afterBytes < report.budgetBytes);
  assert.equal(report.reclaimedBytes, 20000);
});

test('Docker refuses already over-budget resources before the first workload', () => {
  const result = exerciseDocker({ RML_CACHE_BUDGET_BYTES: '1500', MOCK_BUILDKIT_BYTES: '2000' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Aggregate local \+ Docker cache budget exceeded/);
  assert.equal(result.state.calls.filter(a => a[0] === 'buildx' && a[1] === 'build').length, 0);
  assert.equal(result.state.builder, undefined);
});

test('Docker leaves temporary local excess to the outer wrapper and reports it truthfully', () => {
  const result = exerciseDocker({ RML_CACHE_BUDGET_BYTES: '10000', MOCK_LOCAL_BYTES: '20000' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.externalLeases, []);
  const report = result.budgetReports.find(report => report.resourceKind === 'buildx');
  assert.equal(report.resourcesRemoved, true);
  assert.equal(report.remainingDockerBytes, 0);
  assert.ok(report.afterBytes > report.budgetBytes);
  assert.equal(report.budgetSatisfied, false);
  assert.equal(report.localCleanupRequired, true);
  assert.equal(report.finalBudgetEnforcement, 'outer-wrapper-postflight');
});

test('Docker unsupported writable-layer size never claims successful accounting', () => {
  const result = exerciseDocker({ MOCK_CONTAINER_SIZE_UNSUPPORTED: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /writable-layer size/);
  assert.deepEqual(result.state.containers, {});
  const report = result.budgetReports.find(report => report.resourceKind === 'docker-container');
  assert.equal(report.beforeBytes, null);
  assert.equal(report.reclaimedBytes, null);
  assert.match(report.accountingError, /integer bytes/);
});

test('Docker final absence checks immutable container IDs as well as names', () => {
  const result = exerciseDocker({ MOCK_CONTAINER_RENAMED_REMAINS: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(Object.keys(result.state.containers).length > 0);
  assert.ok(result.externalLeases.length > 0);
  const report = result.budgetReports.find(report => report.resourceKind === 'docker-container');
  assert.equal(report.resourcesRemoved, false);
  assert.equal(report.afterBytes, null);
});
