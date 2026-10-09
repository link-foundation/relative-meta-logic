import fs from 'node:fs';
import { exportLean, leanIdent } from '../js/src/lean-export.mjs';
import { exportRocq } from '../js/src/rml-rocq.mjs';
import { emitLinoTerm, exportIsabelle } from '../js/src/rml-links.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('../test-corpus/lino-frontend/reference-literals.json', import.meta.url)));

/** Compiler fixtures contain positive identity proofs and deliberately false capture claims. */
export function referenceExportFixtures(nativeSources = {}) {
  const labels = [...new Set([...fixture.labels, ...fixture.exportNames])].filter(label => label !== 'Type' && label !== 'Prop');
  const source = ['(Carrier: (Type 0) Carrier)', '(sentinel: Carrier sentinel)', "(choose-collision: lambda ('a b': Carrier) (lambda (a_b: Carrier) 'a b'))", ...labels.map((label, index) => {
    const spelling = emitLinoTerm(label), other = emitLinoTerm(`other-${index}`);
    return `(${spelling}: Carrier ${spelling})\n(select-${index}: lambda (Carrier ${spelling}) (lambda (${other}: Carrier) ${spelling}))\n(retain-${index}: lambda (${spelling}: Carrier) sentinel)`;
  })].join('\n') + '\n';
  const lean = exportLean(source);
  if (lean.diagnostics.length) throw new Error(JSON.stringify(lean.diagnostics));
  const rocq = nativeSources.Rocq ?? exportRocq(source);
  const isabelle = exportIsabelle(source, { theoryName: 'Reference_Exports' });
  const leanSource = nativeSources.Lean ?? lean.source;
  const c = leanIdent('Carrier'), global = leanIdent('sentinel');
  const collisionLean = `example (left right : ${c}) : ${leanIdent('choose-collision')} left right = left := rfl\n`;
  const collisionRocq = `Example collision (left right : ${c}) : ${leanIdent('choose-collision')} left right = left. Proof. reflexivity. Qed.\n`;
  const collisionIsabelle = 'lemma collision: "rml_choose_collision left right = left" by (simp add: rml_choose_collision_def)\n';
  const positiveLean = labels.map((_, index) => `example (left right : ${c}) : ${leanIdent(`select-${index}`)} left right = left := rfl\nexample (left : ${c}) : ${leanIdent(`retain-${index}`)} left = ${global} := rfl`).join('\n');
  const positiveRocq = labels.map((_, index) => `Example choose_${index} (left right : ${c}) : ${leanIdent(`select-${index}`)} left right = left. Proof. reflexivity. Qed.\nExample retain_${index} (left : ${c}) : ${leanIdent(`retain-${index}`)} left = ${global}. Proof. reflexivity. Qed.`).join('\n');
  const positiveIsabelle = labels.map((_, index) => `lemma choose_${index}: "rml_select_${index} left right = left" by (simp add: rml_select_${index}_def)\nlemma retain_${index}: "rml_retain_${index} left = rml_sentinel" by (simp add: rml_retain_${index}_def)`).join('\n');
  const globalIsabelle = [...isabelle.matchAll(/^  (rml_[A-Za-z0-9_]+) ::/gm)].map(match => match[1]);
  if (globalIsabelle.length !== labels.length + 1) throw new Error('Incomplete Isabelle reference mapping');
  const beforeEnd = isabelle.replace(/\nend\s*$/, '\n');
  return {
    source,
    mappings: labels.map((source, index) => ({ source, lean: leanIdent(source), rocq: leanIdent(source), isabelle: globalIsabelle[index + 1], localIsabelle: `v_ref_${Buffer.from(source, 'utf8').toString('hex')}`, index })),
    Lean: {
      extension: 'lean',
      positive: leanSource + '\n' + collisionLean + positiveLean + '\n',
      reboundNegative: leanSource + `\nexample (left : ${c}) : ${leanIdent('retain-0')} left = left := rfl\n`,
      negative: leanSource + `\nexample (left right : ${c}) : ${leanIdent('select-0')} left right = right := rfl\n`,
    },
    Rocq: {
      extension: 'v',
      positive: rocq + '\n' + collisionRocq + positiveRocq + '\n',
      reboundNegative: rocq + `\nExample false_rebind (left : ${c}) : ${leanIdent('retain-0')} left = left. Proof. reflexivity. Qed.\n`,
      negative: rocq + `\nExample false_capture (left right : ${c}) : ${leanIdent('select-0')} left right = right. Proof. reflexivity. Qed.\n`,
    },
    Isabelle: {
      extension: 'thy',
      positive: beforeEnd + collisionIsabelle + positiveIsabelle + '\nend\n',
      reboundNegative: beforeEnd + 'lemma false_rebind: "rml_retain_0 left = left" by (simp add: rml_retain_0_def)\nend\n',
      negative: beforeEnd + 'lemma false_capture: "rml_select_0 left right = right" by (simp add: rml_select_0_def)\nend\n',
    },
  };
}
