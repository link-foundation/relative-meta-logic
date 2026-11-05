import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FoundationPackages } from '../src/rml-foundation-packages.mjs';

const read = file => readFileSync(new URL(`../../test-corpus/foundation-packages/${file}`, import.meta.url), 'utf8');
const manifests = [
  { name: 'sample-logic', version: '1', source: read('version-one.lino') },
  { name: 'sample-logic', version: '2', source: read('version-two.lino') },
];
const selection = version => ({ name: 'sample-logic', version, instance: 'study' });
const direct = () => FoundationPackages.fromPackages(manifests, { executionBasis: 'direct-structural' });
const query = ['accepted', 'rules'];

const consumer = (name, version, dependency) => ({
  name, version,
  imports: [{ name: 'sample-logic', version: dependency }],
  source: `(linked-program theory)
(linked-fact theory seed (judgement (input rules)))
(linked-foundation ${name} (version ${version})
  (depends-on sample-logic (version ${dependency})) (cycle-policy inductive))
(linked-instance study (theory theory) (foundation ${name} (version ${version})))`,
});

describe('independently scoped named foundation packages', () => {
  it('loads repeated local programs rules and instances in concurrent versions without renaming terms', () => {
    const loaded = direct();
    const first = loaded.ask(selection('1'), query);
    const second = loaded.ask(selection('2'), query);
    assert.equal(first.result.status, 'proved');
    assert.equal(second.result.status, 'refuted');
    assert.deepEqual(first.result.normalized, query);
    assert.deepEqual(second.result.normalized, query);
    assert.equal(first.result.instance, 'study');
    assert.equal(second.result.theory.name, 'theory');
    assert.deepEqual(first.result.foundation, { name: 'sample-logic', version: '1' });
    assert.deepEqual(second.result.foundation, { name: 'sample-logic', version: '2' });
    const origin = first.programs.find(item => item.address === first.result.proof.program);
    assert.deepEqual([origin.name, origin.version, origin.program], ['sample-logic', '1', 'rules']);
    const opposite = second.programs.find(item => item.address === second.result.refutation.proof.program);
    assert.deepEqual([opposite.name, opposite.version, opposite.program], ['sample-logic', '2', 'rules']);
    assert.notEqual(origin.address, opposite.address);
  });

  it('pins imported foundations explicitly and keeps dependency versions isolated', () => {
    const packages = [...manifests, consumer('dependent', '1', '1'), consumer('dependent', '2', '2')];
    const loaded = FoundationPackages.loadPackages(packages, { executionBasis: 'direct-structural' });
    assert.equal(loaded.ask({ name: 'dependent', version: '1', instance: 'study' }, query).result.status, 'proved');
    assert.equal(loaded.ask({ name: 'dependent', version: '2', instance: 'study' }, query).result.status, 'refuted');
    const imported = consumer('dependent', '1', '1');
    assert.throws(() => FoundationPackages.fromPackages([...manifests, { ...imported, imports: [] }]), /undeclared foundation import/);
    assert.throws(() => FoundationPackages.fromPackages([...manifests, { ...imported, source: imported.source.replace('(depends-on sample-logic (version 1))', '(depends-on sample-logic)') }]), /explicit version/);
  });

  it('imports same-named programs from two versions only through explicit distinct aliases', () => {
    const source = `(linked-program rules (uses old) (uses new))
(linked-program theory)
(linked-fact theory seed (judgement (input rules)))
(linked-program proof)
(linked-rewrite proof contrary (from (refutation-of (accepted ?x))) (to (rejected ?x)))
(linked-foundation compare (version 1) (inference rules) (proof proof) (cycle-policy inductive))
(linked-instance study (theory theory) (foundation compare (version 1)))`;
    const item = { name: 'compare', version: '1', source, imports: [
      { name: 'sample-logic', version: '1', program: 'rules', alias: 'old' },
      { name: 'sample-logic', version: '2', program: 'rules', alias: 'new' },
    ] };
    const loaded = FoundationPackages.fromPackages([...manifests, item], { executionBasis: 'direct-structural' });
    assert.equal(loaded.ask({ name: 'compare', version: '1', instance: 'study' }, query).result.status, 'contradictory');
    assert.throws(() => FoundationPackages.fromPackages([...manifests, { ...item, imports: [{ ...item.imports[0], alias: 'rules' }] }]), /collides/);
    assert.throws(() => FoundationPackages.fromPackages([...manifests, { ...item, imports: item.imports.map(entry => ({ ...entry, alias: 'old' })) }]), /collides/);
    assert.throws(() => FoundationPackages.fromPackages([...manifests, { ...item, imports: [] }]), /declared or imported/);
  });

  it('scopes assumption revision and rule mutation without crossing package versions', () => {
    const loaded = direct();
    const fact = ['accepted', 'extra'];
    const first = loaded.ask(selection('1'), fact, { assumptions: [fact] });
    const second = loaded.ask(selection('2'), fact, { assumptions: [fact] });
    const revision = loaded.revise([first, second], selection('1'), { replaceAssumption: [fact, ['accepted', 'other']] });
    assert.equal(revision.revisions[0].after.result.status, 'unknown');
    assert.equal(revision.revisions[1].action, 'kept');
    assert.equal(revision.revisions[1].after.result.status, 'proved');
    assert.deepEqual(revision.revisions[1].after.result.assumptions, [fact]);
    const derived = [loaded.ask(selection('1'), query), loaded.ask(selection('2'), query)];
    const changed = loaded.revise(derived, selection('1'), { replaceRule: ['linked-inference', 'rules', 'step', ['premise', ['input', '?x']], ['conclusion', ['different', '?x']]] });
    assert.equal(changed.revisions[0].after.result.status, 'unknown');
    assert.equal(changed.revisions[1].action, 'kept');
    assert.equal(changed.revisions[1].after.result.status, 'refuted');
  });

  it('rejects duplicate mismatched and missing package identities rather than guessing', () => {
    assert.throws(() => FoundationPackages.fromPackages([manifests[0], manifests[0]]), /duplicate package/);
    assert.throws(() => FoundationPackages.fromPackages([{ ...manifests[0], version: '2' }]), /matching linked-foundation/);
    const dependent = consumer('dependent', '1', '3');
    assert.throws(() => FoundationPackages.fromPackages([...manifests, dependent]), /unloaded package/);
    assert.throws(() => direct().ask({ name: 'sample-logic', version: '1', instance: 'absent' }, query), /no instance/);
    const loaded = direct();
    const foreign = direct().ask(selection('1'), query);
    assert.throws(() => loaded.revise([foreign], selection('1'), { removeRule: ['rules', 'step'] }), /returned by this package workspace/);
    const malformed = { ...manifests[0], source: manifests[0].source.replace('(cycle-policy inductive)', '(cycle-policy)') };
    assert.throws(() => FoundationPackages.fromPackages([malformed]), /cycle policy/);
  });

  it('executes both independent package versions on the default closed S/K public path', () => {
    const loaded = FoundationPackages.fromPackages(manifests);
    assert.equal(loaded.ask(selection('1'), query).result.status, 'proved');
    assert.equal(loaded.ask(selection('2'), query).result.status, 'refuted');
    const execution = loaded.execute(selection('1'), ['refutation-of', query]);
    assert.deepEqual(execution.result.output, ['rejected', 'rules']);
    assert.deepEqual(execution.result.assumptions, []);
    assert.equal(execution.result.theory.name, 'theory');
  });
});
