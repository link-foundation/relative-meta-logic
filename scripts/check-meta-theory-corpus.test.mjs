import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFormalDeclarations } from './check-meta-theory-corpus.mjs';

describe('formal corpus source extractor', () => {
  it('distinguishes verified declarations from admitted proofs', () => {
    const root = mkdtempSync(join(tmpdir(), 'rml-formal-corpus-'));
    const lean = join(root, 'drafts', '0.0.3', 'src', 'lean');
    const rocq = join(root, 'drafts', '0.0.3', 'src', 'rocq');
    mkdirSync(lean, { recursive: true });
    mkdirSync(rocq, { recursive: true });
    writeFileSync(join(lean, 'Example.lean'), `
def value := 1
theorem complete : value = 1 := by rfl
theorem incomplete : value = 1 := by sorry
`);
    writeFileSync(join(rocq, 'Example.v'), `
Definition value := 1.
Theorem complete : value = 1.
Proof. reflexivity. Qed.
Lemma incomplete : value = 1.
Proof. Admitted.
`);

    assert.deepStrictEqual(extractFormalDeclarations(root), [
      {
        language: 'lean',
        module: 'Example',
        kind: 'definition',
        symbol: 'value',
        proofStatus: 'not-applicable',
      },
      {
        language: 'lean',
        module: 'Example',
        kind: 'theorem',
        symbol: 'complete',
        proofStatus: 'verified',
      },
      {
        language: 'lean',
        module: 'Example',
        kind: 'theorem',
        symbol: 'incomplete',
        proofStatus: 'admitted',
      },
      {
        language: 'rocq',
        module: 'Example',
        kind: 'definition',
        symbol: 'value',
        proofStatus: 'not-applicable',
      },
      {
        language: 'rocq',
        module: 'Example',
        kind: 'theorem',
        symbol: 'complete',
        proofStatus: 'verified',
      },
      {
        language: 'rocq',
        module: 'Example',
        kind: 'theorem',
        symbol: 'incomplete',
        proofStatus: 'admitted',
      },
    ]);
  });
});
