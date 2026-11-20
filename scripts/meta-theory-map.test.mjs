import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAP_PATH, mapEvidence, metaTheoryMap, validateMetaTheoryMap } from './generate-meta-theory-map.mjs';

const text = readFileSync(new URL(`../${MAP_PATH}`, import.meta.url), 'utf8');
const map = JSON.parse(text);
const evidence = mapEvidence();
const clone = value => JSON.parse(JSON.stringify(value));
const problems = (candidate, options) => validateMetaTheoryMap(candidate, evidence, options);
const expectProblem = (candidate, pattern) => {
  const found = problems(candidate);
  assert.ok(found.some(problem => pattern.test(problem)), `${pattern} not in:\n${found.join('\n')}`);
};
const declaration = (candidate, address) => candidate.declarations.find(entry => entry.address === address);

describe('per-declaration and per-command meta-theory stage map', () => {
  it('regenerates the map byte-for-byte and re-executes every claimed stage', () => {
    assert.equal(`${JSON.stringify(metaTheoryMap(evidence), null, 2)}\n`, text);
    assert.deepEqual(problems(map, { reexecute: true }), []);
  });

  it('maps all 229 declarations and 197 commands with their stage counts', () => {
    assert.equal(map.counts.declarations, 229);
    assert.equal(map.counts.commands, 197);
    assert.equal(map.declarations.length, 229);
    assert.equal(map.commands.length, 197);
    assert.deepEqual(map.counts.nativeElaboration, { elaborated: 229 });
    assert.deepEqual(map.counts.dependencyCheck, { exact: 229 });
    assert.deepEqual(map.counts.nativeExecution, { 'ablation-witnessed': 183, 'not-witnessed': 10, 'statement-normalized': 36 });
    assert.deepEqual(map.counts.proof, { certified: 17, 'not-applicable': 193, 'outside-fragment': 19 });
    assert.deepEqual(map.counts.typedElaboration, {
      'conversion-proof-replayed': 2, 'definition-checked': 70, unresolved: 21, unsupported: 132, 'upstream-admitted': 4,
    });
    assert.deepEqual(map.counts.commandExecution, { 'imports-resolved': 93, 'scope-checked': 6, 'target-normalized': 8, value: 90 });
    const admitted = map.declarations.filter(entry => entry.admission.upstream === 'admitted').map(entry => entry.address);
    assert.equal(admitted.length, 4);
    for (const address of admitted) assert.notEqual(declaration(map, address).proof.status, 'certified');
  });

  it('rejects unmapped, unknown and duplicated declarations and commands', () => {
    const missing = clone(map);
    missing.declarations.pop();
    expectProblem(missing, /^unmapped declaration /);
    expectProblem(missing, /tokens belong to no declaration or command/);

    const unknown = clone(map);
    unknown.declarations.push({ ...clone(map.declarations[0]), address: 'rml.formal.lean.Invented.declaration' });
    expectProblem(unknown, /^unknown declaration rml\.formal\.lean\.Invented\.declaration/);

    const duplicate = clone(map);
    duplicate.commands.push(clone(map.commands[0]));
    expectProblem(duplicate, /^duplicate command /);

    const commandless = clone(map);
    const removed = commandless.commands.splice(5, 1)[0];
    expectProblem(commandless, new RegExp(`^unmapped command ${removed.id.replace(/[.#]/g, '\\$&')}`));
  });

  it('rejects partition gaps, overlaps and changed preservation fingerprints', () => {
    const shifted = clone(map);
    shifted.commands[3].tokenRange = [shifted.commands[3].tokenRange[0] + 1, shifted.commands[3].tokenRange[1] + 1];
    expectProblem(shifted, /preservation fingerprint differs/);
    expectProblem(shifted, /tokens belong to (no declaration or command|more than one item)/);

    const fingerprint = clone(map);
    fingerprint.declarations[10].preservation.tokenSha256 = '0'.repeat(64);
    expectProblem(fingerprint, /preservation fingerprint differs from the corpus/);
  });

  it('rejects stale counts', () => {
    const stale = clone(map);
    stale.counts.proof.certified += 1;
    expectProblem(stale, /^map counts are stale$/);
  });

  it('rejects claimed stages without witnesses', () => {
    const executed = clone(map);
    const unwitnessed = executed.declarations.find(entry => entry.nativeExecution.status === 'not-witnessed');
    unwitnessed.nativeExecution = { status: 'ablation-witnessed', witness: { case: 'rml.formal.lean.NetworkExamples#command-17-execution', ablation: 'stuck' } };
    expectProblem(executed, /native execution claimed without a recorded ablation witness/);

    const certified = clone(map);
    const outside = certified.declarations.find(entry => entry.proof.status === 'outside-fragment');
    outside.proof = { status: 'certified', chain: 'closed', relativeTo: [] };
    expectProblem(certified, /proof certified without a certificate/);

    const typed = clone(map);
    const unsupported = typed.declarations.find(entry => entry.typedElaboration.status === 'unsupported');
    unsupported.typedElaboration = { status: 'definition-checked', witness: 'invented-case' };
    expectProblem(typed, /typed elaboration status differs from its evidence/);
    expectProblem(typed, /typed elaboration claimed without an accepted case/);

    const command = clone(map);
    const evaluation = command.commands.find(entry => entry.execution.status === 'value');
    evaluation.execution.witness = 'rml.formal.lean.MetaDefinitions.meta_network_is_duplet_network-statement';
    expectProblem(command, /execution claimed without a value case/);
  });

  it('rejects forged evidence once the claimed witness is re-executed', () => {
    const forgedEvidence = { ...evidence, nativeCoverage: clone(evidence.nativeCoverage) };
    const target = forgedEvidence.nativeCoverage.declarations.find(entry => entry.address === 'rml.formal.lean.NetworkDefinitions.TupleOfReferencesDefault');
    const reaching = evidence.nativeCases.cases.find(item => item.value && item.closure.includes(target.address));
    target.executionWitness = { case: reaching.id, ablation: 'stuck' };
    const forgedMap = metaTheoryMap(forgedEvidence);
    assert.deepEqual(validateMetaTheoryMap(forgedMap, forgedEvidence), []);
    const found = validateMetaTheoryMap(forgedMap, forgedEvidence, { reexecute: true });
    assert.ok(found.includes(`native evidence: ${target.address}: removing its rules leaves ${reaching.id} unchanged`), found.join('\n'));
  });
});
