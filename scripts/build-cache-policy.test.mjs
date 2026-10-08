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
  assert.match(docs, /run-with-cache\.mjs --retain _site --/);
  assert.ok(docs.indexOf('actions/upload-pages-artifact@') < docs.indexOf('run: node scripts/build-cache.mjs --full'));
  const parityStep = steps(jobs(read('.github/workflows/parity.yml'))[0]).find(s => s.includes('cargo build'));
  assert.match(parityStep, /run-with-cache\.mjs/);
  assert.match(parityStep, /node scripts\/check-corpus-parity\.mjs/);
});

test('formal jobs preserve the pinned checkout and own only disposable proof-build copies', () => {
  const formal = read('.github/workflows/formal-corpus.yml');
  assert.equal((formal.match(/path: upstream-meta-theory/g) ?? []).length, 3);
  for (const language of ['lean', 'rocq']) {
    assert.ok(formal.includes(`--cache .rml-cache/${language} --class ${language}`));
    assert.ok(formal.includes(`cp -R upstream-meta-theory/drafts/0.0.3/src/${language}/.`));
  }
  assert.doesNotMatch(formal, /sudo chown -R \S+ \.(?:\s|$)/);
  assert.doesNotMatch(formal, /rm -rf.*upstream-meta-theory/);
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
  assert.match(read('docker/buildkitd.toml'), /maxUsedSpace = "2GB"/);
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
    if (!s.volume) stop(1);
    if (!args.includes('--format')) stop(0,s.volume);
    if (format().includes('.owner')) stop(0, process.env.MOCK_VOLUME_MISMATCH ? 'someone-else' : s.owner);
    if (format().includes('.run')) stop(0,s.run);
  }
  if (args[1] === 'rm') { delete s.volume; stop(); }
}
if (args[0] === 'buildx') {
  if (args[1] === 'create') { s.builder=value('--name'); s.node=value('--node'); stop(); }
  if (args[1] === 'inspect') {
    if (!s.builder) stop(1);
    if (process.env.MOCK_BOOTSTRAP_FAIL) stop(9);
    s.container='owned-container-id'; stop();
  }
  if (args[1] === 'rm') { delete s.builder; delete s.container; delete s.volume; stop(); }
  if (args[1] === 'build') {
    if (process.env.MOCK_BUILD_FAIL) stop(17);
    const id='sha256:'+String(Object.keys(s.images).length+1).repeat(64);
    s.images[id]=true;
    fs.writeFileSync(value('--iidfile'),id);
    stop();
  }
}
if (args[0] === 'inspect') {
  if (!s.container) stop(1);
  if (format() === '{{.Id}}') stop(0,s.container);
  stop(0,s.volume);
}
if (args[0] === 'image') {
  if (args[1] === 'inspect') {
    if (format().includes('.owner')) stop(0,process.env.MOCK_IMAGE_MISMATCH ? 'someone-else' : s.owner);
    stop(0,s.run);
  }
  if (args[1] === 'rm') { delete s.images[args[2]]; stop(); }
}
if (args[0] === 'container') {
  if (args[1] === 'inspect') {
    if (!s.containers?.[args[2]]) stop(1);
    if (format() === '{{.Id}}') stop(0,args[2]);
    if (format().includes('.owner')) stop(0,process.env.MOCK_CONTAINER_MISMATCH ? 'someone-else' : s.containers[args[2]].owner);
    stop(0,s.containers[args[2]].run);
  }
  if (args[1] === 'stop' || args[1] === 'wait') stop(process.env.MOCK_CONTAINER_STOP_FAIL ? 27 : 0);
  if (args[1] === 'rm') { delete s.containers[args[2]]; stop(); }
}
if (args[0] === 'run') {
  const cid='c'.repeat(64);
  s.containers ??= {};
  s.containers[cid]={owner:value('--label').split('=').slice(1).join('='),run:args[args.lastIndexOf('--label')+1].split('=').slice(1).join('=')};
  fs.writeFileSync(value('--cidfile'),cid);
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
    copyFileSync(join(root, 'docker/ci-build.sh'), join(fixture, 'docker/ci-build.sh'));
    copyFileSync(join(root, 'docker/run-owned.sh'), join(fixture, 'docker/run-owned.sh'));
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
      env: { ...process.env, PATH: `${join(fixture, 'bin')}:${process.env.PATH}`, MOCK_DOCKER_PROGRAM: join(fixture, 'bin/fake-docker.cjs'), MOCK_DOCKER_STATE: state, ...env },
      encoding: 'utf8', timeout: 20000,
    });
    assert.ifError(result.error);
    return { ...result, state: JSON.parse(readFileSync(state, 'utf8')), externalLeases: readdirSync(join(fixture, '.rml-cache/evidence')).filter(p => p.startsWith('external-lease-')) };
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
