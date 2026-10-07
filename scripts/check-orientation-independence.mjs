#!/usr/bin/env node
// Native kernels check conditional theorems; they do not confer Link authority.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const corpus = new URL('../test-corpus/orientation-independence/', import.meta.url);
const sourcePaths = {
  Lean: new URL('OrientationIndependence.lean', corpus),
  Rocq: new URL('OrientationIndependence.v', corpus),
};

export function inspectProofSources(sources = Object.fromEntries(
  Object.entries(sourcePaths).map(([language, path]) => [language, readFileSync(path, 'utf8')]),
)) {
  const lean = [...sources.Lean.matchAll(/^theorem (\w+)/gm)].map(match => match[1]);
  const rocq = [...sources.Rocq.matchAll(/^Theorem (\w+)/gm)].map(match => match[1]);
  if (lean.length < 33 || JSON.stringify(lean) !== JSON.stringify(rocq)) {
    throw new Error('Lean/Rocq named theorem inventories must agree and retain all 33 obligations');
  }
  if (/\b(sorry|admit|unsafe|implemented_by|native_decide)\b|^\s*(axiom|constant|opaque|import)\b/m.test(sources.Lean) ||
      /\b(Admitted|Admit|admit|Abort|Axiom|Axioms|Parameter|Parameters|Require|Load)\b/.test(sources.Rocq)) {
    throw new Error('Proof holes, extra axioms, unsafe evaluation, and external imports are forbidden');
  }
  for (const name of lean) {
    if (!sources.Lean.includes(`#print axioms OrientationIndependence.${name}\n`) ||
        !sources.Rocq.includes(`Print Assumptions ${name}.\n`)) {
      throw new Error(`Every theorem must expose its kernel assumptions: ${name}`);
    }
  }
  return { sources, theoremNames: lean };
}

const negativeCases = [
  {
    id: 'equal-stabilizers-do-not-imply-same-orbit',
    Lean: 'example : OrbitRelated rigidAction false true := by\n  exact ⟨(), rfl⟩\n',
    Rocq: 'Example rejected_claim : OrbitRelated rigidAction false true.\nProof. exists tt. reflexivity. Qed.\n',
  },
  {
    id: 'ordered-alignment-is-not-reversal-closed',
    Lean: 'example : reversePair (false, true) = (false, true) := rfl\n',
    Rocq: 'Example rejected_claim : reversePair (false, true) = (false, true).\nProof. reflexivity. Qed.\n',
  },
  {
    id: 'noncommuting-reversal-is-not-equivariant',
    Lean: 'example : Equivariant flipInput flipFirst (fun b => reversePair (asymmetricSelector b)) := by\n  intro g b\n  rfl\n',
    Rocq: 'Example rejected_claim : Equivariant flipInput flipFirst (fun b => reversePair (asymmetricSelector b)).\nProof. intros g b. reflexivity. Qed.\n',
  },
  {
    id: 'positive-records-do-not-force-unrecorded-fact',
    Lean: 'example : Consequence (Extends (fun _ : Unit => False)) () := by\n  intro model h\n  exact h () True.intro\n',
    Rocq: 'Example rejected_claim : Consequence (Extends (fun _ : unit => False)) tt.\nProof. intros model h. apply h. exact I. Qed.\n',
  },
];

function run(command, args, directory) {
  const result = spawnSync(command, args, {
    cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  if (result.error || result.signal || result.status === null) {
    throw new Error(`${basename(command)} did not complete: ${result.error?.message ?? result.signal}`);
  }
  return { ...result, diagnostic };
}

export function checkNativeProofs(languages = ['Lean', 'Rocq']) {
  if (languages.length === 0 || languages.some(language => !['Lean', 'Rocq'].includes(language))) {
    throw new Error('Select Lean, Rocq, or both; an empty kernel check is not success');
  }
  const { sources, theoremNames } = inspectProofSources();
  const directory = mkdtempSync(join(tmpdir(), 'rml-orientation-proof-'));
  const kernels = [];
  try {
    for (const language of [...new Set(languages)]) {
      const command = language === 'Lean' ? process.env.LEAN ?? 'lean' : process.env.ROCQ ?? 'rocq';
      const versionResult = run(command, ['--version'], directory);
      if (versionResult.status !== 0) throw new Error(`${language} version probe failed: ${versionResult.diagnostic}`);
      const version = versionResult.diagnostic.split('\n')[0];
      if (!(language === 'Lean' ? /version 4\.28\.0\b/ : /version 9\.1(?:\.\d+)?\b/).test(version)) {
        throw new Error(`Unsupported kernel version for this proof contract: ${version}`);
      }
      const extension = language === 'Lean' ? 'lean' : 'v';
      const proofFile = join(directory, `OrientationIndependence.${extension}`);
      writeFileSync(proofFile, sources[language]);
      const args = path => language === 'Lean' ? [path] : ['compile', '-noglob', path];
      const proof = run(command, args(proofFile), directory);
      if (proof.status !== 0) throw new Error(`${language} theorem verification failed:\n${proof.diagnostic}`);
      const closed = language === 'Lean'
        ? [...proof.diagnostic.matchAll(/'OrientationIndependence\.(\w+)' does not depend on any axioms/g)].map(match => match[1])
        : [...proof.diagnostic.matchAll(/Closed under the global context/g)];
      if (closed.length !== theoremNames.length ||
          (language === 'Lean' && JSON.stringify(closed) !== JSON.stringify(theoremNames))) {
        throw new Error(`${language} did not certify every theorem without axioms:\n${proof.diagnostic}`);
      }
      const negatives = [];
      for (const fixture of negativeCases) {
        const negativeFile = join(directory, `Rejected_${fixture.id.replaceAll('-', '_')}.${extension}`);
        writeFileSync(negativeFile, sources[language] + '\n' +
          (language === 'Lean' ? 'open OrientationIndependence\n' : '') + fixture[language]);
        const negative = run(command, args(negativeFile), directory);
        const expected = language === 'Lean'
          ? /[Tt]ype mismatch|Tactic `rfl` failed/
          : /Unable to unify|has type [\s\S]*while it is expected to have type/;
        if (negative.status === 0 || !expected.test(negative.diagnostic)) {
          throw new Error(`${language} failed to reject ${fixture.id} for the expected proof reason:\n${negative.diagnostic}`);
        }
        negatives.push({ id: fixture.id, status: 'rejected-false-claim', exitCode: negative.status });
      }
      kernels.push({ language, version, checkedTheorems: theoremNames.length, axioms: [], negatives });
    }
    return {
      schema: 'rml:orientation-independence:1', status: 'passed-selected-kernels',
      scope: 'CONDITIONAL_UNBOUNDED_THEOREMS_NOT_INTRINSIC_LINK_AUTHORITY',
      requirementStatus: { R147: 'PARTIAL_ENDOGENOUS_CONSEQUENCE_OPEN', R148: 'PARTIAL_INTRINSIC_ORIENTATION_OPEN' },
      sourceHashes: Object.fromEntries(Object.entries(sources).map(([language, source]) => [
        `test-corpus/orientation-independence/OrientationIndependence.${language === 'Lean' ? 'lean' : 'v'}`,
        createHash('sha256').update(source).digest('hex'),
      ])),
      theoremNames, kernels,
    };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requested = process.argv.slice(2);
  const unknown = requested.filter(arg => !arg.startsWith('--languages='));
  if (unknown.length || requested.length > 1) throw new Error('Usage: check-orientation-independence.mjs [--languages=Lean,Rocq]');
  console.log(JSON.stringify(checkNativeProofs(requested.length ? requested[0].slice(12).split(',') : undefined), null, 2));
}
