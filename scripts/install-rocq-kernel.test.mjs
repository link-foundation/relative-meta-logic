import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const installer = fileURLToPath(new URL('./install-rocq-kernel.sh', import.meta.url));
function probe(t, overrides = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'rml-rocq-install-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const log = join(bin, 'operations');
  writeFileSync(join(bin, 'opam'), `#!/bin/sh
printf 'opam %s\\n' "$*" >> "$RML_INSTALL_LOG"
case "$1" in
  pin) if [ "$2" = list ]; then printf '%s\\n' "\${RML_INSTALL_PINS:-}"; fi ;;
  install) exit "\${RML_INSTALL_STATUS:-0}" ;;
  env) printf ':\\n' ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(bin, 'rocq'), `#!/bin/sh
printf 'rocq %s\\n' "$*" >> "$RML_INSTALL_LOG"
printf '%s\\n' "$RML_INSTALL_VERSION"
`, { mode: 0o755 });
  const result = spawnSync('bash', [installer], { encoding: 'utf8', env: {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, RML_INSTALL_LOG: log,
    RML_INSTALL_VERSION: 'The Rocq Prover, version 9.3.0', ...overrides,
  } });
  return { ...result, operations: readFileSync(log, 'utf8') };
}

test('the bootstrap installs exact stable core and library packages before checking the oracle', { skip: process.platform === 'win32' }, t => {
  const result = probe(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.operations, /opam update --yes\n/);
  assert.match(result.operations, /opam install --yes --jobs=2 rocq-runtime\.9\.3\.0 rocq-core\.9\.3\.0 coq-core\.9\.3\.0 rocq-stdlib\.9\.2\.0\n/);
  assert.ok(result.operations.indexOf('opam install') < result.operations.indexOf('rocq --version'));
  assert.match(result.stdout, /version 9\.3\.0/);
});

test('only replaced compiler-package pins are removed from the disposable image', { skip: process.platform === 'win32' }, t => {
  const result = probe(t, { RML_INSTALL_PINS: 'rocq-runtime\nrocq-core\nunrelated-package' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.operations, /opam pin remove --yes --no-action rocq-runtime\n/);
  assert.match(result.operations, /opam pin remove --yes --no-action rocq-core\n/);
  assert.doesNotMatch(result.operations, /opam pin remove .*unrelated-package/);
  assert.ok(result.operations.indexOf('opam pin remove') < result.operations.indexOf('opam install'));
});

test('a stale release-candidate image cannot masquerade as the installed stable oracle', { skip: process.platform === 'win32' }, t => {
  const result = probe(t, { RML_INSTALL_VERSION: 'The Rocq Prover, version 9.3+rc1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be stable Rocq 9\.3\.0/);
  assert.doesNotMatch(result.operations, /opam list/);
});

test('package installation failure cannot fall back to the bootstrap compiler', { skip: process.platform === 'win32' }, t => {
  const result = probe(t, { RML_INSTALL_STATUS: '42' });
  assert.equal(result.status, 42);
  assert.doesNotMatch(result.operations, /rocq --version|opam list/);
});
