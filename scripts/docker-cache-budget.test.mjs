import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { byteCount, measureDockerCaches, measureDockerResource, measureDockerContainer, verifyDockerBuilder } from './docker-cache-budget.mjs';

const image = `sha256:${'a'.repeat(64)}`;
const ownerLabel = 'org.link-foundation.rml.owner';
const runLabel = 'org.link-foundation.rml.run';
const record = { version: 1, kind: 'buildx', builder: 'rml-test-1', owner: 'rml-test', run: 'run-1', container: 'buildx_buildkit_rml-test-10', containerId: 'builder-immutable-id', builderEndpoint: 'unix:///docker.sock', volume: 'buildx_buildkit_rml-test-10_state', images: [image], phase: 'ready' };
function daemon(overrides = {}) {
  const calls = [];
  const labels = { [ownerLabel]: record.owner, [runLabel]: record.run };
  const values = {
    volume: { Name: record.volume, Labels: labels },
    container: { Id: record.containerId, Mounts: [{ Type: 'volume', Name: record.volume, Destination: '/var/lib/buildkit' }] },
    du: [{ ID: 'layer-1', Size: '7', Shared: true }, { ID: 'layer-2', Size: '11', Shared: false }],
    image: { Id: image, Size: 13, Config: { Labels: labels } },
    builder: `Name: ${record.builder}\nDriver: docker-container\nNodes:\nName: ${record.builder}0\nEndpoint: ${record.builderEndpoint}`,
    ...overrides,
  };
  const run = (command, args) => {
    assert.equal(command, 'docker');
    calls.push(args);
    if (args[0] === 'volume') return JSON.stringify(values.volume);
    if (args[0] === 'inspect') return JSON.stringify(values.container);
    if (args[0] === 'image') return JSON.stringify(values.image);
    if (args[0] === 'buildx' && args[1] === 'inspect') return values.builder;
    if (args[0] === 'exec') {
      assert.deepEqual(args.slice(0, 5), ['exec', record.containerId, 'buildctl', 'du', '--format']);
      assert.match(args[5], /\.ID \.Size/);
      assert.match(args[5], /%d/);
      if (values.du instanceof Error) throw values.du;
      return Array.isArray(values.du) ? values.du.map(row => JSON.stringify(row)).join('\n') : values.du;
    }
    throw new Error(`Unexpected or mutating Docker call: ${args.join(' ')}`);
  };
  return { run, calls };
}
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-docker-accounting-'));
  const evidence = path.join(root, '.rml-cache', 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  const lease = path.join(evidence, 'external-lease-rml-test-1.json');
  const save = value => fs.writeFileSync(lease, JSON.stringify({ ...record, root: fs.realpathSync(root), ...value }));
  save({});
  try { fn({ root, lease, evidence, save }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('Docker accounting sums exact builder and image bytes conservatively without global discovery', () => {
  fixture(({ root, evidence }) => {
    fs.writeFileSync(path.join(evidence, 'unrelated.json'), JSON.stringify({ kind: 'docker-container', name: 'unrelated' }));
    const docker = daemon();
    const result = measureDockerCaches(root, docker);
    assert.equal(result.bytes, 31);
    assert.equal(result.resources[0].builderBytes, 18);
    assert.equal(result.resources[0].imageBytes, 13);
    assert.equal(docker.calls.length, 5);
    assert.ok(docker.calls.every(args => !args.some(value => /prune|system|^ls$|^rm$/.test(value))));
  });
});

test('Docker accounting does not require Docker when no owned builder is registered', () => {
  fixture(({ root, lease }) => {
    fs.unlinkSync(lease);
    assert.deepEqual(measureDockerCaches(root, { run() { throw new Error('must not execute Docker'); } }), { bytes: 0, resources: [] });
  });
});

test('Docker accounting reads exact raw bytes from only the verified immutable BuildKit container', () => {
  const docker = daemon({ du: [{ ID: 'raw-layer', Size: 829889526 }] });
  const result = measureDockerResource(record, docker);
  assert.equal(result.builderBytes, 829889526);
  assert.ok(docker.calls.some(args => args[0] === 'exec' && args[1] === record.containerId));
  assert.ok(docker.calls.every(args => !(args[0] === 'buildx' && args[1] === 'du')));
  const changed = daemon({ container: { Id: 'foreign', Mounts: [] } });
  assert.throws(() => measureDockerResource(record, changed), /identity/);
  assert.ok(changed.calls.every(args => args[0] !== 'exec'));
});

for (const [name, value] of [['human-readable size', '1.2GB'], ['negative size', -1], ['fractional size', 1.5], ['missing size', undefined], ['unsafe integer', '9007199254740992'], ['null size', null], ['boolean size', false], ['empty size', '']]) {
  test(`Docker accounting rejects ${name}`, () => {
    assert.throws(() => measureDockerResource(record, daemon({ du: [{ ID: 'layer', Size: value }] })), /exact non-negative|safe integer/);
  });
}

test('Docker accounting rejects unsupported, malformed or duplicate BuildKit records', () => {
  for (const du of [new Error('unknown flag --format'), 'not JSON', [{ ID: 'same', Size: '5' }, { ID: 'same', Size: '5' }]]) {
    assert.throws(() => measureDockerResource(record, daemon({ du })), /accounting unavailable|duplicate/);
  }
  assert.equal(measureDockerResource(record, daemon({ du: '' })).builderBytes, 0);
});

test('Docker accounting rejects image and aggregate overflow', () => {
  assert.throws(() => measureDockerResource(record, daemon({ image: { Id: image, Size: -1, Config: { Labels: { [ownerLabel]: record.owner, [runLabel]: record.run } } } })), /exact non-negative/);
  assert.throws(() => measureDockerResource(record, daemon({ du: [{ ID: 'large', Size: String(Number.MAX_SAFE_INTEGER) }] })), /safe integer/);
  assert.equal(byteCount('0', 'size'), 0);
});

test('Docker accounting rejects changed ownership, immutable IDs, and state-volume mounts', () => {
  for (const overrides of [
    { volume: { Name: record.volume, Labels: {} } },
    { volume: { Name: 'foreign-volume', Labels: {} } },
    { container: { Id: 'different', Mounts: [] } },
    { container: { Id: record.containerId, Mounts: [{ Destination: '/var/lib/buildkit', Type: 'volume', Name: 'foreign' }] } },
    { image: { Id: 'different', Size: 1, Config: { Labels: {} } } },
    { image: { Id: image, Size: 1, Config: { Labels: {} } } },
  ]) assert.throws(() => measureDockerResource(record, daemon(overrides)), /ownership mismatch|identity|mount/);
});

test('Docker builder accounting rejects changed driver, endpoint, extra nodes or unknown inspection format', () => {
  const normal = `Name: ${record.builder}\nDriver: docker-container\nNodes:\nName: ${record.builder}0\nEndpoint: ${record.builderEndpoint}`;
  for (const builder of [normal.replace('docker-container', 'remote'), normal.replace('unix:///docker.sock', 'unix:///foreign.sock'), `${normal}\nName: foreign-node\nEndpoint: remote`, '']) {
    assert.throws(() => verifyDockerBuilder(record, daemon({ builder })), /identity changed/);
  }
});

test('Docker accounting preserves foreign, malformed and symlinked resource leases by failing closed', () => {
  fixture(({ root, save, lease, evidence }) => {
    for (const override of [{ root: '/other-worktree' }, { version: 99 }, { images: ['mutable:tag'] }, { phase: 'ready', containerId: '' }, { phase: 'unknown' }]) {
      save(override);
      assert.throws(() => measureDockerCaches(root, daemon()), /Invalid or foreign/);
      assert.ok(fs.existsSync(lease));
    }
    if (process.platform !== 'win32') {
      fs.unlinkSync(lease);
      const foreign = path.join(evidence, 'foreign.json');
      fs.writeFileSync(foreign, JSON.stringify({ ...record, root }));
      fs.symlinkSync(foreign, lease);
      assert.throws(() => measureDockerCaches(root, daemon()), /Unsafe/);
      assert.ok(fs.existsSync(foreign));
    }
  });
});

test('provisioning has no workload cache and teardown retains its measured conservative upper bound', () => {
  fixture(({ root, save }) => {
    const run = () => { throw new Error('must not probe changing resources'); };
    save({ phase: 'provisioning', images: [], containerId: undefined });
    assert.equal(measureDockerCaches(root, { run }).bytes, 0);
    save({ phase: 'cleaning', upperBoundBytes: 31 });
    assert.equal(measureDockerCaches(root, { run }).bytes, 31);
    save({ phase: 'cleaning', upperBoundBytes: null });
    assert.throws(() => measureDockerCaches(root, { run }), /integer bytes/);
  });
});

function containerFixture(fn) {
  fixture(state => {
    const id = 'c'.repeat(64);
    const cidfile = '.rml-cache/scratch/container.cid';
    fs.mkdirSync(path.join(state.root, '.rml-cache/scratch'));
    fs.writeFileSync(path.join(state.root, cidfile), id);
    const containerRecord = { version: 1, kind: 'docker-container', root: fs.realpathSync(state.root), owner: record.owner, run: record.run, name: 'rml-owned-run', phase: 'running', cidfile };
    const lease = path.join(state.evidence, 'external-lease-rml-owned-run.json');
    fs.writeFileSync(lease, JSON.stringify(containerRecord));
    const container = { Id: id, Name: `/${containerRecord.name}`, SizeRw: 17, Config: { Labels: { [ownerLabel]: record.owner, [runLabel]: record.run } } };
    const fake = daemon();
    const run = (command, args) => args[0] === 'container' ? JSON.stringify(container) : fake.run(command, args);
    fn({ ...state, containerRecord, container, run, id, containerLease: lease });
  });
}

test('owned running container writable layers share the same aggregate budget', () => {
  containerFixture(({ root, run }) => {
    const measured = measureDockerCaches(root, { run });
    assert.equal(measured.bytes, 48);
    assert.equal(measured.resources.find(resource => resource.kind === 'docker-container').containerBytes, 17);
  });
});

test('unavailable writable-layer accounting and changed container identities fail closed', () => {
  containerFixture(({ containerRecord, container }) => {
    for (const changed of [{ SizeRw: undefined }, { SizeRw: -1 }, { Id: 'd'.repeat(64) }, { Name: '/foreign' }, { Config: { Labels: {} } }]) {
      assert.throws(() => measureDockerContainer(containerRecord, { run: () => JSON.stringify({ ...container, ...changed }) }), /integer bytes|identity|ownership/);
    }
  });
});

test('container startup counts zero only when Docker explicitly proves the resource is absent', () => {
  containerFixture(({ root, containerRecord, container }) => {
    fs.unlinkSync(path.join(root, containerRecord.cidfile));
    const missing = Object.assign(new Error('inspect failed'), { stderr: 'Error: No such container: rml-owned-run' });
    assert.equal(measureDockerContainer(containerRecord, { run() { throw missing; } }).bytes, 0);
    assert.throws(() => measureDockerContainer(containerRecord, { run() { throw Object.assign(new Error('inspect failed'), { stderr: 'Cannot connect to the Docker daemon' }); } }), /accounting failed/);
    assert.throws(() => measureDockerContainer(containerRecord, { run: () => JSON.stringify(container) }), /identity/);
  });
});

test('previously recorded missing container and unsafe CID paths are never counted as zero', () => {
  containerFixture(({ root, containerRecord }) => {
    assert.throws(() => measureDockerContainer(containerRecord, { run() { throw Object.assign(new Error('inspect failed'), { stderr: 'No such container' }); } }), /disappeared/);
    assert.throws(() => measureDockerContainer({ ...containerRecord, cidfile: '../foreign' }), /CID path/);
    if (process.platform !== 'win32') {
      fs.unlinkSync(path.join(root, containerRecord.cidfile));
      fs.symlinkSync(path.join(root, 'unrelated'), path.join(root, containerRecord.cidfile));
      assert.throws(() => measureDockerContainer(containerRecord), /Unsafe Docker CID/);
    }
  });
});

test('legacy or unknown external-resource leases require accounting rather than being ignored', () => {
  fixture(({ root, lease }) => {
    for (const contents of [{ kind: 'docker-container', name: 'legacy' }, { kind: 'unknown' }]) {
      fs.writeFileSync(lease, JSON.stringify(contents));
      assert.throws(() => measureDockerCaches(root, daemon()), /Invalid or foreign|Unsupported external-resource/);
      assert.ok(fs.existsSync(lease));
    }
  });
});
