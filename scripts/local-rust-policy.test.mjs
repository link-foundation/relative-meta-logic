import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertLocalRustAllowed, cargoCompiles, localRustRefusal } from './local-rust-policy.mjs';
import { executeIssue183Check, sha256 } from './issue-183-requirements.mjs';

const local = { PATH: process.env.PATH };

test('Rust compilation is allowed on hosted CI and with the explicit local override', () => {
  assert.equal(localRustRefusal({ CI: 'true' }), null);
  assert.equal(localRustRefusal({ GITHUB_ACTIONS: 'true' }), null);
  assert.equal(localRustRefusal({ RML_ALLOW_LOCAL_RUST: '1' }), null);
  assert.doesNotThrow(() => assertLocalRustAllowed({ CI: 'true' }));
  for (const args of [['build'], ['test', '--locked'], ['+stable', 'check'], ['--locked', 'clippy'], ['run']]) assert.equal(cargoCompiles(args), true, args.join(' '));
  for (const args of [['fmt', '--check'], ['fetch', '--locked'], ['metadata'], ['--version'], []]) assert.equal(cargoCompiles(args), false, args.join(' '));
});

test('a local run refuses every repository path that would compile Rust', () => {
  for (const env of [local, { CI: 'false' }, { RML_ALLOW_LOCAL_RUST: 'yes' }]) {
    assert.match(localRustRefusal(env), /Rust is compiled only in CI/);
    assert.throws(() => assertLocalRustAllowed(env), /Rust is compiled only in CI/);
  }
  // The cargo wrapper exits before any cargo process starts, while formatting stays available.
  const wrapper = fileURLToPath(new URL('./cargo.mjs', import.meta.url));
  const refused = spawnSync(process.execPath, [wrapper, 'build'], { env: local, encoding: 'utf8' });
  assert.equal(refused.status, 97);
  assert.match(refused.stderr, /refused: Rust is compiled only in CI/);
  // The cache wrapper refuses a direct Cargo build before it takes a lease or starts a process.
  const cached = spawnSync(process.execPath, [fileURLToPath(new URL('./run-with-cache.mjs', import.meta.url)), '--', 'cargo', 'test', '--locked'], { env: local, encoding: 'utf8' });
  assert.equal(cached.status, 97);
  assert.match(cached.stderr, /run-with-cache: refused: Rust is compiled only in CI/);
  // The acceptance gate's native producer records a refusal for a real Rust test target instead of compiling.
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pin = (file, role) => ({ path: file, role, sha256: sha256(fs.readFileSync(new URL(`../${file}`, import.meta.url))) });
  const check = {
    id: 'lino-frontend-native', kind: 'cargo-test', testTarget: 'lino_frontend_tests', testFiles: ['rust/tests/lino_frontend_tests.rs'],
    files: [pin('rust/Cargo.toml', 'fixture'), pin('rust/Cargo.lock', 'configuration'), pin('rust/src/lib.rs', 'implementation'), pin('rust/tests/lino_frontend_tests.rs', 'test-and-fixture')],
    assertions: [{ file: 'rust/tests/lino_frontend_tests.rs', name: 'positive', polarity: 'positive' }, { file: 'rust/tests/lino_frontend_tests.rs', name: 'negative', polarity: 'negative' }],
  };
  const saved = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS, RML_ALLOW_LOCAL_RUST: process.env.RML_ALLOW_LOCAL_RUST };
  for (const name of Object.keys(saved)) delete process.env[name];
  try {
    const evidence = executeIssue183Check(root, check);
    assert.equal(evidence.passed, false);
    assert.equal(evidence.exitCode, null);
    assert.match(evidence.error, new RegExp(`^${check.id} native execution refused: Rust is compiled only in CI`));
  } finally {
    for (const [name, value] of Object.entries(saved)) if (value !== undefined) process.env[name] = value;
  }
});
