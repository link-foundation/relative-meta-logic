import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FoundationWorkspace } from '../src/rml-foundation-workspace.mjs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { TypedLinkNetwork } from '../src/rml-theory-network.mjs';
import { TypedSemanticArchive } from '../src/rml-semantic-archive.mjs';
import {
  SEMANTIC_CLOSURE_CATEGORIES,
  SemanticClosureBuilder,
  closureHash,
  projectSemanticClosure,
  reconstructSemanticClosure,
  validateSemanticClosure,
  validateUniverseContract,
} from '../src/rml-semantic-closure.mjs';

const read = name => readFileSync(new URL(`../../test-corpus/semantic-archive/${name}`, import.meta.url), 'utf8');
const programsSource = read('closure-programs.lino');
const foundationsSource = read('closure-foundations.lino');
const universeSource = read('universe-soundness-contracts.lino');
const expected = JSON.parse(read('closure-expected.json'));
const INPUT = ['length', ['cons', 'a', ['cons', 'b', 'nil']]];

function hostObjects(executionBasis = 'direct-structural', ontology = TypedLinkNetwork.withDefaultOntology()) {
  const workspace = FoundationWorkspace.fromRml(`${programsSource}\n${foundationsSource}`, { executionBasis });
  const registry = LinkedProgramRegistry.fromRml(programsSource, { executionBasis });
  const foundations = [workspace.describe('closure-logic', '1')];
  const judgements = [
    workspace.ask('closure-study', ['publishable', 'specimen']),
    workspace.ask('closure-study', ['publishable', 'extra'], { assumptions: [['input', 'extra']] }),
    workspace.ask('closure-study', ['accepted', '?x']),
  ];
  const values = [{ program: 'closure-computation', input: INPUT, result: registry.reduce('closure-computation', INPUT) }];
  return { ontology, registry, foundations, judgements, values };
}
const project = objects => projectSemanticClosure(objects);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Test-only editing helpers over a snapshot. They recompute content addresses
// so that each mutation isolates the invariant being exercised.
function items(snapshot, address) {
  const links = new Map(snapshot.links.map(row => [row.address, row]));
  const result = [];
  for (let at = address; at !== 'rml.nil'; at = links.get(at).target) result.push(links.get(at).source);
  return result;
}
function payload(snapshot, address) {
  return snapshot.links.find(row => row.address === address).target;
}
function edit(snapshot, change) {
  const builder = new SemanticClosureBuilder(snapshot);
  change(builder);
  return builder.snapshot(['rml.closure']);
}
const ruleOf = (program, kind, name) => `rml.rule/${kind}/${new TextEncoder().encode(program).length}:${program}/${name}`;

describe('recursive semantic closure as one links network', () => {
  it('projects actual programs, rules, foundations, judgements, proofs, substitutions, values and the ontology', () => {
    const objects = hostObjects();
    const archive = project(objects);
    const bytes = archive.serialize();
    assert.equal(bytes.length, expected.closure.bytes);
    assert.equal(sha256(bytes), expected.closure.sha256);
    const report = validateSemanticClosure(archive);
    assert.equal(report.links, expected.closure.links);
    assert.equal(report.typeFacts, expected.closure.typeFacts);
    assert.deepEqual(report.categories, expected.closure.categories);
    assert.deepEqual(Object.keys(report.categories), SEMANTIC_CLOSURE_CATEGORIES);
    for (const name of SEMANTIC_CLOSURE_CATEGORIES) assert.ok(report.categories[name] > 0, name);
    // Categories are links classified by the category root, not host enums.
    assert.deepEqual(archive.doublet('rml.category/proof'), { source: 'rml.category', target: 'rml.category/proof' });
    assert.deepEqual(archive.doublet('rml.category'), { source: 'rml.category', target: 'rml.category' });
  });

  it('round trips bytes and reconstructs the host records exactly', () => {
    const objects = hostObjects();
    const bytes = project(objects).serialize();
    const restored = TypedSemanticArchive.deserialize(bytes);
    assert.deepEqual(restored.serialize(), bytes);
    const back = reconstructSemanticClosure(restored);
    const programs = [...objects.registry.programs.values()].map(program => ({
      name: program.name,
      uses: program.uses.map(use => ({ program: use.program, rebindings: [...use.rebindings] })),
      rewrites: program.rewrites, facts: program.facts, inferences: program.inferences,
    })).sort((a, b) => (a.name < b.name ? -1 : 1));
    assert.deepEqual(back.programs, programs);
    const [described] = objects.foundations;
    assert.deepEqual(back.foundations, [{
      name: described.name, version: described.version, dependsOn: described.dependsOn,
      roles: described.roles.map(role => ({ role: role.role, program: role.program })),
      signature: described.signature, cyclePolicy: described.cyclePolicy,
    }]);
    assert.deepEqual(back.judgements, objects.judgements.map(result => ({
      instance: result.instance,
      foundation: result.foundation,
      query: result.query,
      status: result.status,
      reason: result.reason,
      assumptions: result.assumptions,
      proof: result.proof ?? null,
      answers: result.answers == null ? null : result.answers.map(answer => ({
        judgement: answer.judgement, bindings: Object.entries(answer.bindings), proof: answer.proof,
      })),
    })));
    assert.deepEqual(back.values, [{ program: 'closure-computation', input: INPUT, term: ['s', ['s', 'z']], steps: 3 }]);
    assert.deepEqual(back.ontology, TypedLinkNetwork.withDefaultOntology().snapshot());
    // Reconstructed rules are executable again by an unchanged generic registry.
    const forms = [
      ...back.programs.map(program => ['linked-program', program.name, ...program.uses.map(use =>
        ['uses', use.program, ...use.rebindings.map(([from, to]) => ['rebind', from, to])])]),
      ...back.programs.flatMap(program => [
        ...program.rewrites.map(rule => ['linked-rewrite', rule.program, rule.name, ['from', rule.pattern], ['to', rule.replacement]]),
        ...program.facts.map(rule => ['linked-fact', rule.program, rule.name, ['judgement', rule.judgement]]),
        ...program.inferences.map(rule => ['linked-inference', rule.program, rule.name,
          ...rule.premises.map(premise => ['premise', premise]), ['conclusion', rule.conclusion]]),
      ]),
    ];
    const rebuilt = LinkedProgramRegistry.fromForms(forms, { executionBasis: 'direct-structural' });
    assert.deepEqual(rebuilt.reduce('closure-computation', INPUT).term, ['s', ['s', 'z']]);
    assert.equal(rebuilt.prove('closure-theory', ['publishable', 'specimen']).ok, true);
  });

  it('preserves shared identity and named cycles instead of unfolding them', () => {
    const archive = project(hostObjects());
    const back = reconstructSemanticClosure(archive);
    // One shared subproof: the ground proof and the pattern answer reuse it.
    const shared = back.judgements[0].proof.premises[0];
    assert.equal(back.judgements[2].answers[1].proof, shared);
    assert.equal(validateSemanticClosure(archive).categories.proof, 8);
    // The program lists its rules and every rule links back to its program.
    const snapshot = archive.snapshot();
    const program = 'rml.program/closure-rules';
    const rules = items(snapshot, items(snapshot, payload(snapshot, program))[2]);
    assert.deepEqual(rules, [ruleOf('closure-rules', 'inference', 'admission'), ruleOf('closure-rules', 'inference', 'publication')]);
    for (const rule of rules) assert.equal(items(snapshot, payload(snapshot, rule))[0], program);
    // The ontology self-link survives as one finite addressed doublet.
    assert.deepEqual(archive.doublet('Type'), { source: 'Type', target: 'Type' });
    // Equal subterms have one address: the conclusion of admission and the
    // premise of publication are both (accepted ?x), stored once.
    const [, , , admissionBody] = items(snapshot, payload(snapshot, rules[0]));
    const [, , , publicationBody] = items(snapshot, payload(snapshot, rules[1]));
    assert.equal(items(snapshot, admissionBody)[1], items(snapshot, items(snapshot, publicationBody)[0])[0]);
    const cons = snapshot.links.filter(row => row.address.startsWith('rml.cons/'));
    assert.equal(new Set(cons.map(row => `${row.source}\0${row.target}`)).size, cons.length);
    for (const row of cons) assert.equal(row.address, `rml.cons/${closureHash(row.source, row.target)}`);
  });

  it('produces identical bytes from both public execution bases', () => {
    const direct = project(hostObjects('direct-structural')).serialize();
    const closed = project(hostObjects('s-k')).serialize();
    assert.equal(sha256(closed), sha256(direct));
  });

  it('rejects dangling references, hidden fields and unrepresented nodes', () => {
    const snapshot = project(hostObjects()).snapshot();
    const admission = ruleOf('closure-rules', 'inference', 'admission');
    const dangling = structuredClone(snapshot);
    dangling.links = dangling.links.filter(row => row.address !== admission);
    assert.throws(() => new TypedSemanticArchive(dangling, { roots: ['rml.closure'] }), /dangling references/);
    assert.throws(() => new TypedSemanticArchive({ ...snapshot, provenance: 'host' }), /unrepresented metadata/);
    const hiddenRow = structuredClone(snapshot);
    hiddenRow.links[0].note = 'host-only';
    assert.throws(() => new TypedSemanticArchive(hiddenRow), /unrepresented metadata/);
    const stray = structuredClone(snapshot);
    stray.links.push({ address: 'hidden-note', source: 'hidden-note', target: 'hidden-note' });
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(stray, { roots: ['rml.closure'] })), /unrepresented node hidden-note/);
    const extraField = edit(snapshot, builder => {
      const fields = items(snapshot, payload(snapshot, admission));
      builder.replace(admission, 'rml.atom/rml.rule', builder.seq([...fields, builder.atom('hidden')]));
    });
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(extraField, { roots: ['rml.closure'] })), /must have 4 fields/);
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(snapshot, { roots: ['rml.ontology'] })), /single root/);
  });

  it('rejects category spoofing and missing category membership', () => {
    const snapshot = project(hostObjects()).snapshot();
    const admission = ruleOf('closure-rules', 'inference', 'admission');
    const spoofed = edit(snapshot, builder => builder.type(admission, 'proof'));
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(spoofed, { roots: ['rml.closure'] })), /category spoofing/);
    const untyped = structuredClone(snapshot);
    untyped.typeFacts = untyped.typeFacts.filter(row => !(row.subject === admission && row.type === 'rml.category/rule'));
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(untyped, { roots: ['rml.closure'] })), /missing its rule category/);
    const forged = structuredClone(snapshot);
    const fact = forged.typeFacts.find(row => row.subject === admission);
    fact.address = `rml.typed/${'0'.repeat(64)}`;
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(forged, { roots: ['rml.closure'] })), /type fact/);
  });

  it('rejects identity splitting, merging and named identity spoofing', () => {
    const snapshot = project(hostObjects()).snapshot();
    // Splitting: a second copy of a structural cell under a forged address.
    const split = structuredClone(snapshot);
    const cell = split.links.find(row => row.address.startsWith('rml.cons/') && row.target === 'rml.nil');
    const parent = split.links.find(row => row.target === cell.address);
    split.links.push({ address: `rml.cons/${'f'.repeat(64)}`, source: cell.source, target: cell.target });
    parent.target = `rml.cons/${'f'.repeat(64)}`;
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(split, { roots: ['rml.closure'] })), /content address mismatch/);
    // Merging: two declarations collapsed onto one address are rejected.
    const merged = structuredClone(snapshot);
    merged.links.push({ ...merged.links.find(row => row.address === ruleOf('closure-rules', 'inference', 'admission')), target: 'rml.nil' });
    assert.throws(() => new TypedSemanticArchive(merged, { roots: ['rml.closure'] }));
    // Spoofing: a rule whose payload names another rule.
    const admission = ruleOf('closure-rules', 'inference', 'admission');
    const renamed = edit(snapshot, builder => {
      const [program, kind, , body] = items(snapshot, payload(snapshot, admission));
      builder.replace(admission, 'rml.atom/rml.rule', builder.seq([program, kind, builder.atom('publication'), body]));
    });
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(renamed, { roots: ['rml.closure'] })), /identity mismatch for rule/);
  });

  it('rejects broken program/rule cycles in either direction', () => {
    const snapshot = project(hostObjects()).snapshot();
    const program = 'rml.program/closure-rules';
    const [name, uses, ruleList] = items(snapshot, payload(snapshot, program));
    const rules = items(snapshot, ruleList);
    const dropped = edit(snapshot, builder => builder.replace(program, 'rml.atom/rml.program',
      builder.seq([name, uses, builder.seq(rules.slice(1))])));
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(dropped, { roots: ['rml.closure'] })), /is not listed by its program/);
    const foreign = ruleOf('closure-computation', 'rewrite', 'length-empty');
    const captured = edit(snapshot, builder => builder.replace(program, 'rml.atom/rml.program',
      builder.seq([name, uses, builder.seq([...rules, foreign])])));
    assert.throws(() => validateSemanticClosure(new TypedSemanticArchive(captured, { roots: ['rml.closure'] })), /does not link back to program closure-rules/);
  });

  it('requires a selected ontology for full closure and never invents one', () => {
    const archive = project(hostObjects('direct-structural', null));
    assert.equal(archive.doublet('Type'), null);
    assert.throws(() => validateSemanticClosure(archive), /missing category ontology/);
  });
});

describe('foundation-declared universe and soundness contracts', () => {
  for (const executionBasis of ['direct-structural', 's-k']) {
    it(`checks declared policies relative to each foundation on ${executionBasis}`, () => {
      const workspace = FoundationWorkspace.fromRml(universeSource, { executionBasis });
      for (const [instance, want] of Object.entries(expected.universe)) {
        const report = validateUniverseContract(workspace, instance);
        assert.equal(report.status, want.status, instance);
        assert.equal(report.reason, want.reason, instance);
        assert.equal(report.policy, want.policy, instance);
        assert.equal(report.consistency, 'not-established', instance);
        assert.deepEqual(report.obligations.map(item => ({
          name: item.name, source: item.source, status: item.status,
          judgement: item.witness?.judgement ?? null, cycle: item.witness?.cycle ?? [],
        })), want.obligations, instance);
      }
    });
  }

  it('keeps the link-cli graph self-link representable without making it a logical judgement', () => {
    const ontology = TypedLinkNetwork.withDefaultOntology();
    assert.deepEqual(ontology.snapshot().links.find(row => row.address === 'Type'), { address: 'Type', source: 'Type', target: 'Type' });
    assert.deepEqual(ontology.snapshot().links.find(row => row.address === 'SubType'), { address: 'SubType', source: 'Type', target: 'SubType' });
    assert.deepEqual(ontology.snapshot().links.find(row => row.address === 'Value'), { address: 'Value', source: 'SubType', target: 'Value' });
    const workspace = FoundationWorkspace.fromRml(universeSource, { executionBasis: 'direct-structural' });
    assert.equal(validateUniverseContract(workspace, 'stratified-study').status, 'accepted');
    // Promoting the graph's type facts to typing judgements is an explicit,
    // caller-visible choice; under the stratified foundation it is rejected
    // with the Type:Type self-cycle as witness.
    const promoted = ontology.typeFacts().map(fact => ['has-type', fact.subject, fact.type]);
    const report = validateUniverseContract(workspace, 'stratified-study', { extraJudgements: promoted });
    assert.equal(report.status, 'violated');
    const selfTyping = report.obligations.find(item => item.name === 'no-universe-self-typing');
    assert.deepEqual(selfTyping.witness, { judgement: ['has-type', 'Type', 'Type'], cycle: ['Type', 'Type'], terms: [] });
    // The same promotion is accepted by the foundation that opts into Type:Type.
    const opted = validateUniverseContract(workspace, 'type-in-type-study', { extraJudgements: promoted });
    assert.equal(opted.status, 'accepted');
    assert.equal(opted.reason, 'accepted-relative-to-declared-type-in-type');
    assert.equal(opted.consistency, 'not-established');
    // The graph is unchanged by either validation.
    assert.deepEqual(ontology.snapshot(), TypedLinkNetwork.withDefaultOntology().snapshot());
  });

  it('changes its verdict when the linked contract changes, not when host code does', () => {
    const removed = universeSource.replace('(linked-fact cumulative-contract cumulativity (judgement (universe-cumulativity cumulative)))', '');
    assert.notEqual(removed, universeSource);
    const workspace = FoundationWorkspace.fromRml(removed, { executionBasis: 'direct-structural' });
    const report = validateUniverseContract(workspace, 'cumulative-study');
    assert.equal(report.status, 'violated');
    assert.equal(report.cumulative, false);
    const restored = FoundationWorkspace.fromRml(universeSource, { executionBasis: 'direct-structural' });
    assert.equal(validateUniverseContract(restored, 'cumulative-study').status, 'accepted');
    const bounded = validateUniverseContract(restored, 'cumulative-study', { bounds: { maxRounds: 1 } });
    assert.equal(bounded.status, 'incomplete');
  });
});
