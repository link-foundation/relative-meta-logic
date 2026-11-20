import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  SPEC_PROGRAMS, buildSpecCandidate, checkSpecCertificate, checkSpecDerivation, renderLink,
  specEvaluate, specProofRules, specRegistries, specStatement, specTheorems,
} from '../src/rml-spec-certificates.mjs';
import {
  CASES_PATH, CERTIFICATES_PATH, SPECIFICATION_REQUESTS, fixtureTexts, specificationArtifacts, specificationSources,
} from '../../scripts/generate-meta-theory-specifications.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const cases = JSON.parse(read('test-corpus/meta-theory-specifications/cases.json'));
const fixture = JSON.parse(read('test-corpus/meta-theory-specifications/certificates.json'));
const sources = specificationSources();
const registries = specRegistries(sources);
const evaluate = (program, request) => specEvaluate(registries, program, request).term;
const list = (items, cons, nil) => items.reduceRight((tail, item) => [cons, item, tail], nil);
const gr = items => list(items, 'gr-cons', 'gr-nil');
const ra = items => list(items, 'ra-cons', 'ra-nil');
const certificateOf = (program, theorem) => fixture.certificates.find(item => item.program === program && item.theorem === theorem).certificate;
const TYPES = 'type-specification';
const GRAPHS = 'graph-specification';
const ALGEBRA = 'relational-algebra-specification';

/** The exact scope each specification claims; the tests below hold the sources to it. */
const SCOPE = {
  [TYPES]: {
    operators: ['ty-is-type', 'ty-context-ok', 'ty-lookup', 'ty-infer', 'ty-check', 'ty-value-p', 'ty-subst', 'ty-step', 'ty-eval'],
    theorems: ['typing-twice', 'preservation-swap', 'preservation-conditional', 'evaluation-twice-successor', 'progress-swap'],
    rules: ['t-var', 't-lam', 't-app', 't-pair', 't-fst', 't-snd', 't-zero', 't-succ', 't-iszero', 't-true', 't-false', 't-unit', 't-if',
      'preservation', 'evaluation-preservation', 'progress-step', 'progress-value'],
  },
  [GRAPHS]: {
    operators: ['gr-well-formed', 'gr-has-vertex', 'gr-has-edge', 'gr-successors', 'gr-adjacency', 'gr-step', 'gr-closure', 'gr-reachable',
      'gr-acyclic', 'gr-is-path', 'gr-path-ends', 'gr-is-fixed-point', 'gr-is-prefixed-point', 'gr-subset'],
    theorems: ['reach-transitive-dag', 'reach-transitive-cycle', 'closure-fixed-point', 'closure-least', 'path-reaches',
      'reach-agrees-with-closure', 'dag-acyclic'],
    rules: ['reach-edge', 'reach-step', 'transitive-at', 'closure-fixed', 'closure-below', 'path-reaches', 'reach-computed', 'dag'],
  },
  [ALGEBRA]: {
    operators: ['ra-relation', 'ra-named', 'ra-select', 'ra-project', 'ra-join', 'ra-union', 'ra-difference', 'ra-rename', 'ra-eval',
      'ra-same-relation', 'ra-law-instance'],
    theorems: ['union-commutative', 'union-associative', 'union-idempotent', 'join-commutative', 'join-associative', 'join-idempotent',
      'select-distributes-over-union', 'select-distributes-over-difference', 'select-cascade', 'select-commutes', 'select-pushdown-join',
      'project-distributes-over-union', 'project-cascade', 'difference-self', 'rename-inverse', 'join-distributes-over-union'],
    rules: ['extensional'],
  },
};

describe('native execution of the specifications', () => {
  test('every recorded case reproduces its value and step count', () => {
    assert.equal(cases.cases.length, SPECIFICATION_REQUESTS.length);
    for (const item of cases.cases) {
      const reduced = specEvaluate(registries, item.program, item.request);
      assert.deepEqual(reduced.term, item.expected, item.id);
      assert.equal(reduced.steps, item.steps, item.id);
    }
  });

  test('negative cases reject ill-typed terms, cyclic graphs and schema-mismatched unions', () => {
    const value = id => cases.cases.find(item => item.id === id).expected;
    assert.deepEqual(value('ill-typed-not-a-function'), ['ty-error', 'not-a-function']);
    assert.deepEqual(value('ill-typed-argument'), ['ty-error', 'argument-mismatch']);
    assert.deepEqual(value('ill-typed-branches'), ['ty-error', 'branch-mismatch']);
    assert.equal(value('cyclic-graph-rejected'), 'gr-no');
    assert.equal(value('acyclic-dag'), 'gr-yes');
    assert.deepEqual(value('schema-mismatched-union'), ['ra-error', 'schema-mismatch']);
    assert.deepEqual(value('schema-mismatched-difference'), ['ra-error', 'schema-mismatch']);
    const negatives = cases.cases.filter(item => item.polarity === 'negative');
    for (const program of Object.keys(SPEC_PROGRAMS)) {
      assert.ok(negatives.some(item => item.program === program), `${program} has negative cases`);
    }
  });

  test('the specifications state exactly the documented operators, theorems and proof rules', () => {
    for (const [program, scope] of Object.entries(SCOPE)) {
      assert.deepEqual(specTheorems(registries, program), scope.theorems, program);
      assert.deepEqual(fixture.theorems[program], scope.theorems, program);
      assert.deepEqual(specProofRules(registries, program).map(rule => rule[1]), scope.rules, program);
      const exercised = new Set(cases.cases.filter(item => item.program === program).map(item => item.operator));
      assert.deepEqual([...exercised].sort(), [...scope.operators].sort(), program);
    }
    assert.deepEqual(evaluate(ALGEBRA, ['ra-laws']), ['spec-list', ...SCOPE[ALGEBRA].theorems]);
  });
});

describe('specification certificates', () => {
  test('every theorem certificate is accepted and the generator reproduces both fixtures', { timeout: 600_000 }, () => {
    const total = Object.values(SCOPE).reduce((sum, scope) => sum + scope.theorems.length, 0);
    assert.equal(fixture.certificates.length, total);
    for (const item of fixture.certificates) {
      const checked = checkSpecCertificate(registries, item.certificate);
      assert.equal(checked.accepted, true, `${item.program}.${item.theorem}: ${checked.problems.join('; ')}`);
      assert.equal(checked.steps, item.verifierSteps, item.theorem);
    }
    const texts = fixtureTexts(specificationArtifacts(sources));
    assert.equal(texts[CASES_PATH], read(CASES_PATH));
    assert.equal(texts[CERTIFICATES_PATH], read(CERTIFICATES_PATH));
  });

  test('mutated certificates are rejected', () => {
    const original = certificateOf(ALGEBRA, 'join-associative');
    const mutate = change => {
      const copy = structuredClone(original);
      change(copy);
      return checkSpecCertificate(registries, copy);
    };
    assert.equal(checkSpecCertificate(registries, original).accepted, true);
    const value = mutate(copy => { copy.facts[2].value = 'ra-no'; });
    assert.equal(value.accepted, false);
    assert.match(value.problems[0], /^fact:3: /);
    assert.equal(mutate(copy => { copy.facts.pop(); }).accepted, false);
    assert.equal(mutate(copy => { copy.facts[0].expression = ['ra-eval', ['ra-named', 'employees']]; }).accepted, false);
    assert.equal(mutate(copy => { copy.goal = ['ra-equal-relations', 'x', 'x']; }).accepted, false);
    assert.equal(mutate(copy => { copy.theorem = 'join-commutative'; }).accepted, false);
    assert.equal(mutate(copy => { copy.theorem = 'join-is-free'; }).accepted, false);
    assert.equal(mutate(copy => { copy.schema = 'rml-spec-certificate/v0'; }).accepted, false);
    const root = mutate(copy => { copy.candidate[4].at(-1)[3] = ['ra-equal-relations', 'x', 'x']; });
    assert.equal(root.accepted, false);
    assert.deepEqual(root.problems, ['linked proof verifier rejected the derivation']);
    const typing = structuredClone(certificateOf(TYPES, 'typing-twice'));
    typing.candidate[4][0][2] = 't-true';
    assert.equal(checkSpecCertificate(registries, typing).accepted, false);
  });

  test('forged derivations recorded in the fixture are rejected for the recorded reason', () => {
    const names = fixture.forged.map(item => item.name);
    assert.deepEqual(names, ['ill-typed-successor', 'cyclic-graph-claimed-acyclic', 'cyclic-graph-with-executed-fact', 'unreachable-pair',
      'schema-mismatched-union']);
    for (const item of fixture.forged) {
      const checked = checkSpecDerivation(registries, item.program, item);
      assert.equal(checked.accepted, false, item.name);
      assert.equal(checked.problems[0].startsWith('fact:') ? 'fact' : 'verifier', item.rejection, item.name);
    }
  });
});

describe('types', () => {
  test('an ill-typed term has no derivation while its well-typed neighbour does', () => {
    const identity = ['spec', TYPES, 'test'];
    assert.throws(() => buildSpecCandidate(registries, TYPES, ['has-type', 'ty-empty', ['tm-app', 'tm-zero', 'tm-true'], 'ty-nat'], identity),
      /does not have type/);
    assert.throws(() => buildSpecCandidate(registries, TYPES, ['has-type', 'ty-empty', ['tm-succ', 'tm-true'], 'ty-nat'], identity),
      /does not have type/);
    const goal = ['has-type', ['ty-extend', 'f', ['ty-arrow', 'ty-nat', 'ty-bool'], 'ty-empty'],
      ['tm-if', ['tm-app', ['tm-var', 'f'], 'tm-zero'], ['tm-pair', 'tm-unit', 'tm-zero'], ['tm-pair', 'tm-unit', ['tm-succ', 'tm-zero']]],
      ['ty-product', 'ty-unit', 'ty-nat']];
    const derived = buildSpecCandidate(registries, TYPES, goal, identity);
    assert.equal(checkSpecDerivation(registries, TYPES, { identity, goal, ...derived }).accepted, true);
  });

  test('type preservation and progress hold for every one-step reduct of the named terms', () => {
    for (const name of ['swap', 'twice-successor', 'conditional']) {
      let [, term] = evaluate(TYPES, ['ty-term', name]);
      const type = evaluate(TYPES, ['ty-infer', 'ty-empty', term]);
      for (let step = 0; step < 20; step += 1) {
        assert.deepEqual(evaluate(TYPES, ['ty-infer', 'ty-empty', term]), type, `${name} after ${step} steps`);
        const next = evaluate(TYPES, ['ty-step', term]);
        if (next === 'ty-normal') break;
        assert.equal(next[0], 'ty-stepped', `${name} is stuck after ${step} steps`);
        const identity = ['spec', TYPES, `${name}-${step}`];
        const goal = ['ty-preserved', term, next[1], type[1]];
        const derived = buildSpecCandidate(registries, TYPES, goal, identity);
        assert.equal(checkSpecDerivation(registries, TYPES, { identity, goal, ...derived }).accepted, true, `${name} step ${step}`);
        term = next[1];
      }
      assert.equal(evaluate(TYPES, ['ty-value-p', term]), 'ty-yes', name);
    }
  });
});

describe('graphs', () => {
  test('reachability derivations exist exactly for the pairs in the computed closure', { timeout: 600_000 }, () => {
    for (const name of ['dag', 'cycle']) {
      const graph = evaluate(GRAPHS, ['gr-named', name]);
      const vertices = evaluate(GRAPHS, ['gr-vertex-list', graph]);
      const items = [];
      for (let tail = vertices; tail !== 'gr-nil'; tail = tail[2]) items.push(tail[1]);
      for (const source of items) {
        for (const target of items) {
          const goal = ['gr-reach', graph, source, target];
          const identity = ['spec', GRAPHS, `${name}-${source}-${target}`];
          const reachable = evaluate(GRAPHS, ['gr-reachable', graph, source, target]) === 'gr-yes';
          if (!reachable) {
            assert.throws(() => buildSpecCandidate(registries, GRAPHS, goal, identity), /is not reachable/, `${name} ${source} ${target}`);
            continue;
          }
          const derived = buildSpecCandidate(registries, GRAPHS, goal, identity);
          assert.equal(checkSpecDerivation(registries, GRAPHS, { identity, goal, ...derived }).accepted, true, `${name} ${source} ${target}`);
        }
      }
    }
  });

  test('the transitive closure is below every prefixed point among all relations on three vertices', { timeout: 600_000 }, () => {
    const graph = ['gr-graph', gr(['x', 'y', 'z']), gr([['gr-edge', 'x', 'y'], ['gr-edge', 'y', 'z']])];
    const pairs = [];
    for (const source of ['x', 'y', 'z']) for (const target of ['x', 'y', 'z']) pairs.push(['gr-edge', source, target]);
    const edges = [['x', 'y'], ['y', 'z']];
    let prefixed = 0;
    for (let mask = 0; mask < 1 << pairs.length; mask += 1) {
      const chosen = pairs.filter((_, index) => mask & (1 << index));
      const relation = gr(chosen);
      const has = (a, b) => chosen.some(edge => edge[1] === a && edge[2] === b);
      // Independent oracle: E ⊆ R and R ; E ⊆ R.
      const expected = edges.every(([a, b]) => has(a, b)) &&
        chosen.every(([, a, b]) => edges.every(([c, d]) => c !== b || has(a, d)));
      const native = evaluate(GRAPHS, ['gr-is-prefixed-point', graph, relation]) === 'gr-yes';
      assert.equal(native, expected, renderLink(relation));
      if (!native) continue;
      prefixed += 1;
      assert.equal(evaluate(GRAPHS, ['gr-closure-within', graph, relation]), 'gr-yes', renderLink(relation));
    }
    assert.ok(prefixed > 1);
    assert.equal(evaluate(GRAPHS, ['gr-closure-is-fixed', graph]), 'gr-yes');
    const closure = evaluate(GRAPHS, ['gr-closure', graph]);
    assert.equal(evaluate(GRAPHS, ['gr-is-prefixed-point', graph, closure]), 'gr-yes');
    assert.equal(evaluate(GRAPHS, ['gr-subset', closure, gr([...edges.map(([a, b]) => ['gr-edge', a, b]), ['gr-edge', 'x', 'z']])]), 'gr-yes');
  });

  test('a cyclic graph has no dag certificate', () => {
    const cycle = evaluate(GRAPHS, ['gr-named', 'cycle']);
    assert.throws(() => buildSpecCandidate(registries, GRAPHS, ['gr-dag', cycle], ['spec', GRAPHS, 'test']), /does not match/);
  });
});

describe('relational algebra', () => {
  const bind = entries => entries.reduceRight((rest, [name, value]) => ['ra-bind', name, value, rest], 'ra-unbound');
  const named = name => ['ra-named', name];
  const empty = ['ra-relation', ra(['name', 'dept']), 'ra-nil'];
  const sameSchema = [named('employees'), named('managers'), named('contractors'), empty];
  const mixed = [named('employees'), named('departments'), named('cities')];
  const predicates = [['ra-p-eq', 'dept', 'd1'], ['ra-p-not', ['ra-p-eq', 'name', 'alice']],
    ['ra-p-or', ['ra-p-eq', 'dept', 'd2'], ['ra-p-eq', 'name', 'dave']], 'ra-p-true'];
  const holds = (law, entries) => {
    const statement = evaluate(ALGEBRA, ['ra-law-instance', law, bind(entries)]);
    assert.equal(statement[0], 'spec-statement', law);
    const [, left, right] = statement[1];
    const values = [left, right].map(side => evaluate(ALGEBRA, ['ra-eval', side]));
    assert.ok(values.every(value => value[0] === 'ra-ok'), `${law}: ${values.map(renderLink).join(' ')}`);
    return evaluate(ALGEBRA, ['ra-same-relation', values[0][1], values[1][1]]);
  };

  test('every law holds on bounded instances beyond the certified ones', { timeout: 900_000 }, () => {
    const instances = [];
    for (const r of sameSchema) {
      instances.push(['union-idempotent', [['r', r]]], ['difference-self', [['r', r]]],
        ['rename-inverse', [['a', 'dept'], ['b', 'unit'], ['r', r]]], ['join-idempotent', [['r', r]]]);
      for (const s of sameSchema) {
        instances.push(['union-commutative', [['r', r], ['s', s]]]);
        instances.push(['project-distributes-over-union', [['l', ra(['name'])], ['r', r], ['s', s]]]);
        for (const p of predicates) {
          instances.push(['select-distributes-over-union', [['p', p], ['r', r], ['s', s]]]);
          instances.push(['select-distributes-over-difference', [['p', p], ['r', r], ['s', s]]]);
        }
        for (const t of sameSchema.slice(0, 3)) instances.push(['union-associative', [['r', r], ['s', s], ['t', t]]]);
      }
      for (const p of predicates) for (const q of predicates) {
        instances.push(['select-cascade', [['p', p], ['q', q], ['r', r]]], ['select-commutes', [['p', p], ['q', q], ['r', r]]]);
      }
    }
    for (const r of mixed) {
      for (const s of mixed) {
        instances.push(['join-commutative', [['r', r], ['s', s]]]);
        for (const t of mixed) instances.push(['join-associative', [['r', r], ['s', s], ['t', t]]]);
      }
      for (const s of sameSchema.slice(0, 3)) for (const t of sameSchema.slice(0, 3)) {
        instances.push(['join-distributes-over-union', [['r', r], ['s', s], ['t', t]]]);
      }
    }
    instances.push(['select-pushdown-join', [['p', ['ra-p-eq', 'dept', 'd3']], ['r', named('departments')], ['s', named('employees')]]],
      ['select-pushdown-join', [['p', ['ra-p-eq', 'country', 'de']], ['r', named('cities')], ['s', named('departments')]]],
      ['project-cascade', [['l', ra(['dept'])], ['k', ra(['dept', 'name'])], ['r', named('employees')]]],
      ['project-cascade', [['l', ra(['country'])], ['k', ra(['city', 'country'])], ['r', ['ra-join', named('departments'), named('cities')]]]]);
    const covered = new Set(instances.map(([law]) => law));
    assert.deepEqual([...covered].sort(), [...SCOPE[ALGEBRA].theorems].sort());
    for (const [law, entries] of instances) assert.equal(holds(law, entries), 'ra-yes', `${law} ${renderLink(bind(entries))}`);
    assert.ok(instances.length >= 300, `${instances.length} instances`);
  });

  test('false equations and violated side conditions are refuted', () => {
    // Difference is not commutative.
    const left = evaluate(ALGEBRA, ['ra-eval', ['ra-difference', named('employees'), named('contractors')]]);
    const right = evaluate(ALGEBRA, ['ra-eval', ['ra-difference', named('contractors'), named('employees')]]);
    assert.equal(evaluate(ALGEBRA, ['ra-same-relation', left[1], right[1]]), 'ra-no');
    // Pushing a selection on the right operand's attribute into the left operand is not defined.
    const pushed = evaluate(ALGEBRA, ['ra-eval', ['ra-join', ['ra-select', ['ra-p-eq', 'city', 'rome'], named('employees')], named('departments')]]);
    assert.deepEqual(pushed, ['ra-error', 'unknown-attribute']);
    // A projection cascade with an outer list outside the inner one is not defined.
    const cascade = evaluate(ALGEBRA, ['ra-eval', ['ra-project', ra(['name']), ['ra-project', ra(['dept']), named('employees')]]]);
    assert.deepEqual(cascade, ['ra-error', 'unknown-attribute']);
    // A union of mismatched schemas has no extensional certificate.
    const goal = ['ra-equal-relations', ['ra-union', named('employees'), named('departments')], ['ra-union', named('departments'), named('employees')]];
    assert.throws(() => buildSpecCandidate(registries, ALGEBRA, goal, ['spec', ALGEBRA, 'test']), /does not evaluate/);
  });

  test('a changed join definition changes the statement result and rejects the old certificate', () => {
    const source = sources.specs[ALGEBRA];
    const original = '(to (ra-merge-fields ?left-schema ?rest (ra-cons (ra-field ?attribute ?value) ?accumulator))))';
    assert.ok(source.includes(original));
    const altered = source.replace(original, '(to (ra-merge-fields ?left-schema ?rest ?accumulator)))');
    const changed = specRegistries({ ...sources, specs: { ...sources.specs, [ALGEBRA]: altered } });
    const request = ['ra-eval', ['ra-join', named('employees'), named('departments')]];
    assert.notDeepEqual(specEvaluate(changed, ALGEBRA, request).term, evaluate(ALGEBRA, request));
    const certificate = certificateOf(ALGEBRA, 'join-associative');
    const checked = checkSpecCertificate(changed, certificate);
    assert.equal(checked.accepted, false);
    assert.match(checked.problems[0], /^fact:\d+: /);
    assert.deepEqual(specStatement(changed, ALGEBRA, 'join-associative'), specStatement(registries, ALGEBRA, 'join-associative'));
  });
});
