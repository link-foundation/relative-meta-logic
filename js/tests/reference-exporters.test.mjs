import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exportLean, leanIdent } from '../src/lean-export.mjs';
import { exportRocq } from '../src/rml-rocq.mjs';
import { emitLinoTerm, exportIsabelle } from '../src/rml-links.mjs';
import { referenceExportFixtures } from '../../scripts/reference-export-fixtures.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('../../test-corpus/lino-frontend/reference-literals.json', import.meta.url)));
test('Lean and Rocq namespaces are injective for every Unicode label and reserved-looking spelling', () => {
  const labels = [...new Set([...fixture.labels,...fixture.exportNames])].filter(x => x !== 'Type' && x !== 'Prop');
  const expected = labels.map(label => 'rml_ref_' + Buffer.from(label, 'utf8').toString('hex'));
  assert.equal(new Set(expected).size, labels.length);
  for (const [index,label] of labels.entries()) {
    const s = emitLinoTerm(label);
    const source = `(Carrier: (Type 0) Carrier)\n(${s}: Carrier ${s})\n(choose: lambda (Carrier ${s}) ${s})`;
    const lean = exportLean(source);
    assert.deepEqual(lean.diagnostics, []);
    assert.ok(lean.source.includes(`axiom ${expected[index]} : rml_ref_43617272696572`));
    assert.ok(exportRocq(source).includes(`Parameter ${expected[index]} : rml_ref_43617272696572.`));
    assert.equal(leanIdent(label), expected[index]);
    assert.ok(lean.source.includes(`:= fun ${expected[index]} => ${expected[index]}`));
  }
  assert.throws(() => leanIdent('\ud800'), /well-formed Unicode/);
});
test('exporters reject builtin rebinding instead of silently changing reference meaning', () => {
  for (const name of ['Type','Prop']) {
    for (const source of [`(${name}: (Type 0) ${name})`, `(inductive ${name} (constructor item))`, `(inductive Other (constructor ${name}))`]) {
      assert.ok(exportLean(source).diagnostics.length > 0);
      assert.throws(() => exportRocq(source));
      if (!source.startsWith(`(${name}:`)) assert.throws(() => exportIsabelle(source));
    }
  }
});
test('compiler smoke artifacts exercise exact locals, global retention and false-capture controls', () => {
  const fixtures = referenceExportFixtures();
  assert.ok(fixtures.mappings.length >= 39);
  for (const mapping of fixtures.mappings) {
    assert.match(mapping.lean, /^rml_ref_[0-9a-f]*$/);
    assert.match(mapping.localIsabelle, /^v_ref_[0-9a-f]*$/);
    assert.ok(fixtures.Isabelle.positive.includes(`%${mapping.localIsabelle}.`));
  }
  for (const language of ['Lean','Rocq','Isabelle']) {
    assert.ok(fixtures[language].positive.length > 100);
    assert.notEqual(fixtures[language].positive, fixtures[language].negative);
  }
});

test('Lean marks axiom-dependent definitions while respecting local shadowing and transitive dependencies', () => {
  const source = '(Carrier: (Type 0) Carrier)\n(sentinel: Carrier sentinel)\n(keep: lambda (Carrier x) sentinel)\n(forward: lambda (Carrier x) (apply keep x))\n(shadow: lambda (Carrier sentinel) sentinel)';
  const result = exportLean(source);
  assert.deepEqual(result.diagnostics, []);
  for (const name of ['keep', 'forward']) assert.ok(result.source.includes(`noncomputable def ${leanIdent(name)} :`));
  assert.ok(result.source.split('\n').some(line => line.startsWith(`def ${leanIdent('shadow')} :`)));
});
