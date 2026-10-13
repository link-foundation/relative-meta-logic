import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONCEPT_RECORDS, LinkNetwork, conceptCorrespondence, conceptRecord } from '#meta-language';
import {
  CERTIFIED_VOCABULARY, CONCEPT_SPACE_SCHEMA, RML_CONCEPT_RECORDS, certifiedConceptSpace, checkConceptSpace, conceptOf,
  conceptSpaceJson, conceptSpaceNetwork, termCorrespondence,
} from '../src/rml-concept-space.mjs';
import { CERTIFIED_AUTHORITY, PRESERVATION_DIMENSIONS } from '../src/rml-certified-translation.mjs';
import { LOWERING_KINDS } from '../src/rml-surface-lowering.mjs';
import { GENERATED_DIRECTORY } from '../../scripts/generate-certified-translations.mjs';

const generated = path => readFileSync(join(GENERATED_DIRECTORY, path), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const kinds = problems => [...new Set(problems.map(problem => problem.kind))].sort();
const recordOf = (space, id) => space.records.find(record => record.id === id);

describe('the certified concept space consumes the meta-language concept records', () => {
  it('binds every certificate term to exactly one concept and passes the exact-match discipline', () => {
    const space = certifiedConceptSpace();
    assert.equal(space.schema, CONCEPT_SPACE_SCHEMA);
    assert.deepEqual(checkConceptSpace(space), []);
    assert.equal(space.upstream.records, CONCEPT_RECORDS.length);
    assert.deepEqual(CERTIFIED_VOCABULARY.preservation, [...PRESERVATION_DIMENSIONS]);
    assert.deepEqual(CERTIFIED_VOCABULARY.authority, CERTIFIED_AUTHORITY.map(([grant]) => grant));
    assert.deepEqual(CERTIFIED_VOCABULARY.lowering, Object.keys(LOWERING_KINDS));
    const total = Object.values(CERTIFIED_VOCABULARY).reduce((sum, terms) => sum + terms.length, 0);
    assert.equal(space.bindings.length, total);
    for (const binding of space.bindings) {
      if (binding.origin === 'upstream') assert.equal(conceptRecord(binding.concept)?.id, binding.concept, binding.concept);
      else assert.equal(conceptRecord(binding.concept), undefined, binding.concept);
    }
    assert.deepEqual(conceptOf('construct-kind', 'function'), { concept: 'function', origin: 'upstream' });
    assert.deepEqual(conceptOf('preservation', 'effects'), { concept: 'program.effects', origin: 'upstream' });
    assert.deepEqual(conceptOf('lowering-syntax', 'rocq-record'), { concept: 'grammar.record-command', origin: 'upstream' });
    assert.deepEqual(conceptOf('lowering', 'rocq-record'), { concept: 'rml.lowering.record-type', origin: 'rml' });
    assert.equal(conceptOf('construct-kind', 'Function'), undefined, 'a near miss binds nothing');
  });
  it('the committed concept space and its link network are fresh and round-trip through meta-language', () => {
    assert.equal(generated('concept-space.json'), conceptSpaceJson());
    const lino = generated('concept-space.lino');
    assert.equal(lino, conceptSpaceNetwork().toLino());
    assert.equal(LinkNetwork.fromLino(lino).toLino(), lino);
    const network = LinkNetwork.fromLino(lino);
    for (const record of [...RML_CONCEPT_RECORDS.slice(0, 3), conceptRecord('function')]) assert.ok(network.findTerm(record.id), record.id);
  });
  it('decides correspondence between lowering kinds through meta-language conceptCorrespondence', () => {
    const shared = termCorrespondence('lowering', 'rust-struct', 'lean-structure');
    assert.equal(shared.relation, 'shared');
    assert.equal(shared.shared, 'rml.lowering.record-type');
    assert.equal(termCorrespondence('lowering', 'rocq-record', 'rust-tuple-struct').shared, 'rml.lowering.record-type');
    assert.equal(termCorrespondence('lowering-syntax', 'lean-instantiation', 'rocq-instantiation').shared, 'grammar.function-application');
    assert.equal(termCorrespondence('lowering', 'rust-struct', 'rust-field-read').relation, 'distinct');
    assert.equal(termCorrespondence('lowering-syntax', 'rust-struct', 'lean-structure').relation, 'distinct', 'the native constructs differ even where the meaning is shared');
    assert.equal(termCorrespondence('lowering', 'Rust-struct', 'lean-structure').relation, 'unknown');
    assert.equal(termCorrespondence('construct-kind', 'theorem', 'theorem', 'obligation-kind').shared, 'rml.certified.theorem');
    const records = certifiedConceptSpace().records;
    assert.equal(conceptCorrespondence({ source: 'rml:construct-kind', name: 'function' }, { source: 'Rust', name: 'fn' }, { records }).shared, 'function',
      'a certificate function and a Rust fn share the meta-language concept');
  });
  it('rejects inexact, altered, ambiguous, unbound, duplicated, foreign and mismatched concept spaces', () => {
    const base = certifiedConceptSpace();
    const inexact = clone(base);
    recordOf(inexact, 'function').id = 'Function';
    assert.ok(kinds(checkConceptSpace(inexact)).includes('inexact-upstream-concept'));
    const altered = clone(base);
    recordOf(altered, 'program.effects').definition = 'Anything a program does.';
    assert.ok(kinds(checkConceptSpace(altered)).includes('altered-upstream-concept'));
    const ambiguous = clone(base);
    recordOf(ambiguous, 'rml.certified.data-type').sourceAliases.push({ source: 'Rust', name: 'struct' });
    assert.ok(kinds(checkConceptSpace(ambiguous)).includes('ambiguous-spelling'));
    const unbound = clone(base);
    const termination = recordOf(unbound, 'rml.certified.termination');
    termination.sourceAliases = termination.sourceAliases.filter(alias => !alias.source.startsWith('rml:'));
    assert.deepEqual(kinds(checkConceptSpace(unbound)), ['bindings-mismatch', 'unbound-term', 'unused-concept']);
    const twice = clone(base);
    recordOf(twice, 'rml.certified.trusted-step').sourceAliases.push({ source: 'rml:obligation-kind', name: 'termination' });
    assert.ok(kinds(checkConceptSpace(twice)).includes('ambiguous-term'));
    const foreign = clone(base);
    const item = recordOf(foreign, 'grammar.structure-item');
    item.sourceAliases = item.sourceAliases.filter(alias => alias.name !== 'rust-struct');
    recordOf(foreign, 'grammar.structure').sourceAliases.push({ source: 'rml:lowering-syntax', name: 'rust-struct' });
    assert.ok(kinds(checkConceptSpace(foreign)).includes('foreign-syntax'));
    const unknown = clone(base);
    recordOf(unknown, 'rml.certified.trusted-step').sourceAliases.push({ source: 'rml:obligation-kind', name: 'axiom' });
    assert.ok(kinds(checkConceptSpace(unknown)).includes('unknown-term'));
    const shadowing = clone(base);
    shadowing.records.push({ ...clone(recordOf(base, 'rml.certified.trusted-step')), id: 'rml.certified.trusted-step' });
    assert.ok(kinds(checkConceptSpace(shadowing)).includes('duplicate-concept'));
    const relabelled = clone(base);
    relabelled.bindings.find(binding => binding.term === 'function').origin = 'rml';
    assert.deepEqual(kinds(checkConceptSpace(relabelled)), ['origin-mismatch']);
  });
});
