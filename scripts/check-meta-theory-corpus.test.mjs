import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractFormalCorpus,
  extractFormalDeclarations,
  tokenTexts,
} from './check-meta-theory-corpus.mjs';

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

    assert.deepStrictEqual(extractFormalDeclarations(root).map(declaration => ({
      language: declaration.language,
      module: declaration.module,
      kind: declaration.kind,
      symbol: declaration.symbol,
      proofStatus: declaration.proofStatus,
    })), [
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

  it('extracts complete linked syntax, judgements, bodies, proofs, and dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'rml-semantic-corpus-'));
    const lean = join(root, 'drafts', '0.0.3', 'src', 'lean');
    const rocq = join(root, 'drafts', '0.0.3', 'src', 'rocq');
    mkdirSync(lean, { recursive: true });
    mkdirSync(rocq, { recursive: true });
    writeFileSync(join(lean, 'Example.lean'), `
def value : Nat := 1
def countdown : Nat → Nat
  | 0 => value
  | n + 1 => countdown n
theorem complete : countdown 0 = value := by rfl
theorem incomplete : value = 1 := by sorry
`);
    writeFileSync(join(rocq, 'Example.v'), `
Definition value : nat := 1.
Fixpoint countdown (n : nat) : nat :=
  match n with O => value | S previous => countdown previous end.
Theorem complete : countdown O = value.
Proof. reflexivity. Qed.
Lemma incomplete : value = 1.
Proof. Admitted.
`);

    const corpus = extractFormalCorpus(root);
    assert.strictEqual(corpus.modules.length, 2);
    assert.ok(corpus.modules.every(module => module.tokens.length > 0));

    const leanValue = corpus.declaration('lean', 'Example', 'value');
    assert.deepStrictEqual(tokenTexts(leanValue.signature), [':', 'Nat']);
    assert.deepStrictEqual(tokenTexts(leanValue.body), ['1']);
    assert.deepStrictEqual(tokenTexts(leanValue.proof), []);
    assert.deepStrictEqual(leanValue.dependencies, []);

    const leanRecursive = corpus.declaration('lean', 'Example', 'countdown');
    assert.strictEqual(leanRecursive.recursive, true);
    assert.deepStrictEqual(tokenTexts(leanRecursive.signature), [':', 'Nat', '→', 'Nat']);
    assert.ok(tokenTexts(leanRecursive.body).includes('=>'));
    assert.deepStrictEqual(leanRecursive.dependencies, [
      'rml.formal.lean.Example.countdown',
      'rml.formal.lean.Example.value',
    ]);

    const leanTheorem = corpus.declaration('lean', 'Example', 'complete');
    assert.deepStrictEqual(
      tokenTexts(leanTheorem.signature),
      [':', 'countdown', '0', '=', 'value'],
    );
    assert.deepStrictEqual(tokenTexts(leanTheorem.proof), ['by', 'rfl']);
    assert.deepStrictEqual(leanTheorem.dependencies, [
      'rml.formal.lean.Example.countdown',
      'rml.formal.lean.Example.value',
    ]);

    const rocqTheorem = corpus.declaration('rocq', 'Example', 'complete');
    assert.deepStrictEqual(
      tokenTexts(rocqTheorem.signature),
      [':', 'countdown', 'O', '=', 'value'],
    );
    assert.deepStrictEqual(
      tokenTexts(rocqTheorem.proof),
      ['Proof', '.', 'reflexivity', '.', 'Qed', '.'],
    );
    assert.deepStrictEqual(rocqTheorem.dependencies, [
      'rml.formal.rocq.Example.countdown',
      'rml.formal.rocq.Example.value',
    ]);

    for (const language of ['lean', 'rocq']) {
      const incomplete = corpus.declaration(language, 'Example', 'incomplete');
      assert.strictEqual(incomplete.proofStatus, 'admitted');
      assert.ok(incomplete.signature.length > 0);
      assert.ok(incomplete.proof.length > 0);
      assert.ok(incomplete.syntax.length > incomplete.signature.length);
    }
  });
});
