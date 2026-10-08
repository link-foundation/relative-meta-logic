import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NATIVE_PROOF_TOOLCHAINS, assertNativeKernelVersion, inspectProofSources } from './check-orientation-independence.mjs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const image = 'rocq/rocq-prover:9.3@sha256:c357e8864f80359db21725ea8371347a75a1cb439545b47219d7ad5683ba1782';
test('the exact maintained native proof toolchains reject stale and prerelease versions', () => {
  assert.deepEqual(NATIVE_PROOF_TOOLCHAINS, { Lean: '4.34.1', Rocq: '9.3.0' });
  assert.doesNotThrow(() => assertNativeKernelVersion('Lean', 'Lean (version 4.34.1, x86_64-unknown-linux-gnu, Release)'));
  assert.doesNotThrow(() => assertNativeKernelVersion('Rocq', 'The Rocq Prover, version 9.3.0 compiled with OCaml 5.4.1'));
  for (const version of ['4.28.0', '4.34.0', '4.34.10', '4.34.1-rc1', '4.34.1+alpha']) {
    assert.throws(() => assertNativeKernelVersion('Lean', `Lean (version ${version}, Release)`));
  }
  for (const version of ['9.1.1', '9.3', '9.3.1', '9.3.00', '9.3.0-rc1', '9.3.0+alpha']) {
    assert.throws(() => assertNativeKernelVersion('Rocq', `The Rocq Prover, version ${version}`));
  }
  assert.throws(() => assertNativeKernelVersion('JavaScript', 'version 4.34.1'));
});
test('both maintained proof workflows install exact Lean and digest-pinned Rocq', () => {
  for (const file of ['orientation-proofs.yml', 'formal-corpus.yml']) {
    const source = read(`.github/workflows/${file}`);
    assert.ok(source.includes('--default-toolchain leanprover/lean4:v4.34.1'), file);
    assert.ok(source.includes('ELAN_TOOLCHAIN: leanprover/lean4:v4.34.1'), file);
    assert.ok(source.includes(image), file);
    assert.doesNotMatch(source, /leanprover\/lean4:v4\.28\.0|rocq\/rocq-prover:9\.1\b|rocq\/rocq-prover:9\.3\.0\b/);
    assert.doesNotMatch(source, /continue-on-error|\|\| true/);
  }
});
test('the archived upstream toolchain and all general proof obligations are preserved', () => {
  assert.equal(read('lib/meta-theory/upstream-0.0.3-source/drafts/0.0.3/src/lean/lean-toolchain').trim(), 'leanprover/lean4:v4.28.0');
  assert.equal(inspectProofSources().theoremNames.length, 33);
  const workflow = read('.github/workflows/formal-corpus.yml');
  assert.ok(workflow.includes('087f4515d0652925eecc54bcade724445c3978f1'));
  assert.ok(workflow.includes('rocq --version | grep -E \\"version 9[.]3[.]0([[:space:]]|$)\\"'));
  assert.ok(workflow.includes('lake build'));
  assert.ok(workflow.includes('make -f Makefile.coq'));
});
