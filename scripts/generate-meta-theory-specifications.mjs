#!/usr/bin/env node
/**
 * Execute the source specifications of types, graphs and relational algebra
 * natively, produce a certificate for every theorem they state, check each
 * with the trusted checker, and record forged derivations the checker must
 * reject. Writes test-corpus/meta-theory-specifications/cases.json and
 * certificates.json; `--check` compares instead of writing. JavaScript tests
 * and the hand-written Rust mirrors read the same files.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SPEC_PROGRAMS, buildSpecCandidate, checkSpecCertificate, checkSpecDerivation, produceSpecCertificate, specEvaluate,
  specRegistries, specTheorems,
} from '../js/src/rml-spec-certificates.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
export const CASES_PATH = 'test-corpus/meta-theory-specifications/cases.json';
export const CERTIFICATES_PATH = 'test-corpus/meta-theory-specifications/certificates.json';
const sha256 = text => createHash('sha256').update(text).digest('hex');

export function specificationSources() {
  return {
    specs: Object.fromEntries(Object.entries(SPEC_PROGRAMS).map(([program, path]) => [program, read(path)])),
    universal: read('lib/meta-theory/universal.lino'),
    verifier: read('lib/meta-theory/proof-verifier.lino'),
    natural: read('lib/meta-theory/proof-verifier-natural.lino'),
  };
}

const list = (items, cons, nil) => items.reduceRight((tail, item) => [cons, item, tail], nil);
const gr = items => list(items, 'gr-cons', 'gr-nil');
const ra = items => list(items, 'ra-cons', 'ra-nil');
const tuple = fields => ra(Object.entries(fields).map(([attribute, value]) => ['ra-field', attribute, value]));
const relation = (schema, rows) => ['ra-relation', ra(schema), ra(rows.map(tuple))];
const named = name => ['ra-named', name];
const DAG = ['gr-named', 'dag'];
const CYCLE = ['gr-named', 'cycle'];
const DAG_EDGES = gr([['gr-edge', 'a', 'b'], ['gr-edge', 'a', 'c'], ['gr-edge', 'b', 'd'], ['gr-edge', 'c', 'd'], ['gr-edge', 'd', 'e']]);
const PREFIXED = gr(['a-b', 'a-c', 'a-d', 'a-e', 'b-c', 'b-d', 'b-e', 'c-d', 'c-e', 'd-e'].map(pair => ['gr-edge', ...pair.split('-')]));
const error = reason => ['ra-error', reason];

/**
 * Native requests. `operator` names the operation exercised, `polarity`
 * whether the case shows acceptance or rejection, and `expect` (when present)
 * is the hand-written value the generator insists on.
 */
export const SPECIFICATION_REQUESTS = [
  // Types: formation, contexts, algorithmic typing, substitution, evaluation.
  ['type-specification', 'is-type-product', 'ty-is-type', 'positive', ['ty-is-type', ['ty-product', 'ty-nat', ['ty-arrow', 'ty-bool', 'ty-unit']]], 'ty-yes'],
  ['type-specification', 'context-invalid-type', 'ty-context-ok', 'negative', ['ty-context-ok', ['ty-extend', 'x', 'ty-bogus', 'ty-empty']], 'ty-no'],
  ['type-specification', 'lookup-shadowing', 'ty-lookup', 'positive',
    ['ty-lookup', ['ty-extend', 'x', 'ty-nat', ['ty-extend', 'x', 'ty-bool', 'ty-empty']], 'x'], ['ty-ok', 'ty-nat']],
  ['type-specification', 'infer-twice', 'ty-infer', 'positive', ['ty-infer', 'ty-empty', ['ty-term', 'twice']],
    ['ty-ok', ['ty-arrow', ['ty-arrow', 'ty-nat', 'ty-nat'], ['ty-arrow', 'ty-nat', 'ty-nat']]]],
  ['type-specification', 'infer-swap', 'ty-infer', 'positive', ['ty-infer', 'ty-empty', ['ty-term', 'swap']], ['ty-ok', ['ty-product', 'ty-bool', 'ty-nat']]],
  ['type-specification', 'infer-conditional', 'ty-infer', 'positive', ['ty-infer', 'ty-empty', ['ty-term', 'conditional']],
    ['ty-ok', ['ty-product', 'ty-unit', 'ty-nat']]],
  ['type-specification', 'infer-in-context', 'ty-infer', 'positive',
    ['ty-infer', ['ty-extend', 'f', ['ty-arrow', 'ty-nat', 'ty-bool'], 'ty-empty'], ['tm-app', ['tm-var', 'f'], 'tm-zero']], ['ty-ok', 'ty-bool']],
  ['type-specification', 'ill-typed-not-a-function', 'ty-infer', 'negative', ['ty-infer', 'ty-empty', ['tm-app', 'tm-zero', 'tm-true']],
    ['ty-error', 'not-a-function']],
  ['type-specification', 'ill-typed-argument', 'ty-infer', 'negative',
    ['ty-infer', 'ty-empty', ['tm-app', ['tm-lam', 'x', 'ty-nat', ['tm-succ', ['tm-var', 'x']]], 'tm-true']], ['ty-error', 'argument-mismatch']],
  ['type-specification', 'ill-typed-unbound', 'ty-infer', 'negative', ['ty-infer', 'ty-empty', ['tm-var', 'y']], ['ty-error', 'unbound-variable']],
  ['type-specification', 'ill-typed-branches', 'ty-infer', 'negative', ['ty-infer', 'ty-empty', ['tm-if', 'tm-true', 'tm-zero', 'tm-unit']],
    ['ty-error', 'branch-mismatch']],
  ['type-specification', 'ill-typed-condition', 'ty-infer', 'negative', ['ty-infer', 'ty-empty', ['tm-if', 'tm-zero', 'tm-zero', 'tm-zero']],
    ['ty-error', 'expected-bool']],
  ['type-specification', 'ill-typed-projection', 'ty-infer', 'negative', ['ty-infer', 'ty-empty', ['tm-fst', 'tm-zero']], ['ty-error', 'not-a-pair']],
  ['type-specification', 'ill-typed-successor', 'ty-infer', 'negative', ['ty-infer', 'ty-empty', ['tm-succ', 'tm-true']], ['ty-error', 'expected-nat']],
  ['type-specification', 'ill-typed-annotation', 'ty-infer', 'negative', ['ty-infer', 'ty-empty', ['tm-lam', 'x', 'ty-bogus', ['tm-var', 'x']]],
    ['ty-error', 'invalid-type']],
  ['type-specification', 'check-twice-successor', 'ty-check', 'positive', ['ty-check', 'ty-empty', ['ty-term', 'twice-successor'], 'ty-nat'], 'ty-yes'],
  ['type-specification', 'check-wrong-type', 'ty-check', 'negative', ['ty-check', 'ty-empty', ['ty-term', 'twice-successor'], 'ty-bool'], 'ty-no'],
  ['type-specification', 'value-pair', 'ty-value-p', 'positive', ['ty-value-p', ['tm-pair', 'tm-zero', ['tm-succ', 'tm-zero']]], 'ty-yes'],
  ['type-specification', 'value-application', 'ty-value-p', 'negative', ['ty-value-p', ['tm-app', ['tm-var', 'f'], 'tm-zero']], 'ty-no'],
  ['type-specification', 'subst-pair', 'ty-subst', 'positive', ['ty-subst', 'x', 'tm-zero', ['tm-pair', ['tm-var', 'x'], ['tm-var', 'y']]],
    ['ty-subst-done', ['tm-pair', 'tm-zero', ['tm-var', 'y']]]],
  ['type-specification', 'subst-shadowed', 'ty-subst', 'positive', ['ty-subst', 'x', 'tm-zero', ['tm-lam', 'x', 'ty-nat', ['tm-var', 'x']]],
    ['ty-subst-done', ['tm-lam', 'x', 'ty-nat', ['tm-var', 'x']]]],
  ['type-specification', 'step-swap', 'ty-step', 'positive', ['ty-step', ['ty-term', 'swap']],
    ['ty-stepped', ['tm-pair', ['tm-snd', ['tm-pair', 'tm-zero', 'tm-true']], ['tm-fst', ['tm-pair', 'tm-zero', 'tm-true']]]]],
  ['type-specification', 'eval-twice-successor', 'ty-eval', 'positive', ['ty-eval', ['ty-term', 'twice-successor']],
    ['ty-value', ['tm-succ', ['tm-succ', 'tm-zero']]]],
  ['type-specification', 'eval-conditional', 'ty-eval', 'positive', ['ty-eval', ['ty-term', 'conditional']], ['ty-value', ['tm-pair', 'tm-unit', 'tm-zero']]],
  ['type-specification', 'eval-stuck', 'ty-eval', 'negative', ['ty-eval', ['tm-app', 'tm-zero', 'tm-true']], ['ty-stuck-at', ['tm-app', 'tm-zero', 'tm-true']]],

  // Graphs: structure, adjacency, closure, reachability, paths, acyclicity.
  ['graph-specification', 'well-formed-dag', 'gr-well-formed', 'positive', ['gr-well-formed', DAG], 'gr-yes'],
  ['graph-specification', 'malformed-edge', 'gr-well-formed', 'negative',
    ['gr-well-formed', ['gr-graph', gr(['a']), gr([['gr-edge', 'a', 'z']])]], 'gr-no'],
  ['graph-specification', 'has-vertex', 'gr-has-vertex', 'positive', ['gr-has-vertex', DAG, 'e'], 'gr-yes'],
  ['graph-specification', 'missing-vertex', 'gr-has-vertex', 'negative', ['gr-has-vertex', DAG, 'z'], 'gr-no'],
  ['graph-specification', 'has-edge', 'gr-has-edge', 'positive', ['gr-has-edge', DAG, 'a', 'b'], 'gr-yes'],
  ['graph-specification', 'reverse-edge', 'gr-has-edge', 'negative', ['gr-has-edge', DAG, 'b', 'a'], 'gr-no'],
  ['graph-specification', 'successors', 'gr-successors', 'positive', ['gr-successors', DAG, 'a'], gr(['b', 'c'])],
  ['graph-specification', 'adjacency', 'gr-adjacency', 'positive', ['gr-adjacency', DAG], null],
  ['graph-specification', 'step-from-empty', 'gr-step', 'positive', ['gr-step', DAG, 'gr-nil'], null],
  ['graph-specification', 'closure-dag', 'gr-closure', 'positive', ['gr-closure', DAG], null],
  ['graph-specification', 'closure-cycle', 'gr-closure', 'positive', ['gr-closure', CYCLE], null],
  ['graph-specification', 'reachable', 'gr-reachable', 'positive', ['gr-reachable', DAG, 'a', 'e'], 'gr-yes'],
  ['graph-specification', 'unreachable', 'gr-reachable', 'negative', ['gr-reachable', DAG, 'e', 'a'], 'gr-no'],
  ['graph-specification', 'reachable-loop', 'gr-reachable', 'positive', ['gr-reachable', CYCLE, 'a', 'a'], 'gr-yes'],
  ['graph-specification', 'acyclic-dag', 'gr-acyclic', 'positive', ['gr-acyclic', DAG], 'gr-yes'],
  ['graph-specification', 'cyclic-graph-rejected', 'gr-acyclic', 'negative', ['gr-acyclic', CYCLE], 'gr-no'],
  ['graph-specification', 'path', 'gr-is-path', 'positive', ['gr-is-path', DAG, gr(['a', 'b', 'd', 'e'])], 'gr-yes'],
  ['graph-specification', 'not-a-path', 'gr-is-path', 'negative', ['gr-is-path', DAG, gr(['a', 'd'])], 'gr-no'],
  ['graph-specification', 'path-ends', 'gr-path-ends', 'positive', ['gr-path-ends', gr(['a', 'c', 'd', 'e'])], ['gr-ends', 'a', 'e']],
  ['graph-specification', 'closure-is-fixed', 'gr-is-fixed-point', 'positive', ['gr-closure-is-fixed', DAG], 'gr-yes'],
  ['graph-specification', 'edges-not-fixed', 'gr-is-fixed-point', 'negative', ['gr-is-fixed-point', DAG, DAG_EDGES], 'gr-no'],
  ['graph-specification', 'prefixed-point', 'gr-is-prefixed-point', 'positive', ['gr-is-prefixed-point', DAG, PREFIXED], 'gr-yes'],
  ['graph-specification', 'edges-not-prefixed', 'gr-is-prefixed-point', 'negative', ['gr-is-prefixed-point', DAG, DAG_EDGES], 'gr-no'],
  ['graph-specification', 'closure-below-prefixed', 'gr-subset', 'positive', ['gr-closure-within', DAG, PREFIXED], 'gr-yes'],
  ['graph-specification', 'closure-not-below-edges', 'gr-subset', 'negative', ['gr-closure-within', DAG, DAG_EDGES], 'gr-no'],

  // Relational algebra: the six operators, their errors and set equality.
  ['relational-algebra-specification', 'named', 'ra-named', 'positive', ['ra-eval', named('employees')], null],
  ['relational-algebra-specification', 'select', 'ra-select', 'positive', ['ra-eval', ['ra-select', ['ra-p-eq', 'dept', 'd1'], named('employees')]], null],
  ['relational-algebra-specification', 'select-compound', 'ra-select', 'positive',
    ['ra-eval', ['ra-select', ['ra-p-or', ['ra-p-eq', 'dept', 'd2'], ['ra-p-and', ['ra-p-eq', 'name', 'dave'], ['ra-p-not', ['ra-p-same', 'name', 'dept']]]],
      named('employees')]], null],
  ['relational-algebra-specification', 'project', 'ra-project', 'positive', ['ra-eval', ['ra-project', ra(['dept']), named('employees')]], null],
  ['relational-algebra-specification', 'join', 'ra-join', 'positive', ['ra-eval', ['ra-join', named('employees'), named('departments')]], null],
  ['relational-algebra-specification', 'join-without-shared-attributes', 'ra-join', 'positive',
    ['ra-eval', ['ra-join', named('managers'), named('cities')]], null],
  ['relational-algebra-specification', 'union', 'ra-union', 'positive', ['ra-eval', ['ra-union', named('employees'), named('contractors')]], null],
  ['relational-algebra-specification', 'difference', 'ra-difference', 'positive', ['ra-eval', ['ra-difference', named('employees'), named('contractors')]], null],
  ['relational-algebra-specification', 'rename', 'ra-rename', 'positive', ['ra-eval', ['ra-rename', 'dept', 'division', named('managers')]], null],
  ['relational-algebra-specification', 'literal', 'ra-relation', 'positive',
    ['ra-eval', relation(['name'], [{ name: 'zoe' }, { name: 'yan' }])], ['ra-ok', relation(['name'], [{ name: 'zoe' }, { name: 'yan' }])]],
  ['relational-algebra-specification', 'schema-mismatched-union', 'ra-union', 'negative',
    ['ra-eval', ['ra-union', named('employees'), named('departments')]], error('schema-mismatch')],
  ['relational-algebra-specification', 'schema-mismatched-difference', 'ra-difference', 'negative',
    ['ra-eval', ['ra-difference', named('departments'), named('cities')]], error('schema-mismatch')],
  ['relational-algebra-specification', 'project-unknown-attribute', 'ra-project', 'negative',
    ['ra-eval', ['ra-project', ra(['salary']), named('employees')]], error('unknown-attribute')],
  ['relational-algebra-specification', 'select-unknown-attribute', 'ra-select', 'negative',
    ['ra-eval', ['ra-select', ['ra-p-eq', 'salary', 'high'], named('employees')]], error('unknown-attribute')],
  ['relational-algebra-specification', 'rename-clash', 'ra-rename', 'negative', ['ra-eval', ['ra-rename', 'name', 'dept', named('employees')]],
    error('attribute-clash')],
  ['relational-algebra-specification', 'rename-unknown-attribute', 'ra-rename', 'negative',
    ['ra-eval', ['ra-rename', 'salary', 'pay', named('employees')]], error('unknown-attribute')],
  ['relational-algebra-specification', 'unknown-relation', 'ra-named', 'negative', ['ra-eval', named('payroll')], error('unknown-relation')],
  ['relational-algebra-specification', 'error-propagates-through-join', 'ra-join', 'negative',
    ['ra-eval', ['ra-join', named('employees'), named('payroll')]], error('unknown-relation')],
  ['relational-algebra-specification', 'malformed-literal', 'ra-relation', 'negative',
    ['ra-eval', relation(['name', 'dept'], [{ name: 'zoe' }])], error('malformed-relation')],
  ['relational-algebra-specification', 'unknown-expression', 'ra-eval', 'negative', ['ra-eval', ['ra-product', named('employees'), named('cities')]],
    error('unknown-expression')],
  ['relational-algebra-specification', 'same-relation-reordered', 'ra-same-relation', 'positive',
    ['ra-same-relation', relation(['a', 'b'], [{ a: '1', b: '2' }, { a: '3', b: '4' }]),
      ['ra-relation', ra(['b', 'a']), ra([tuple({ b: '4', a: '3' }), tuple({ b: '2', a: '1' })])]], 'ra-yes'],
  ['relational-algebra-specification', 'same-relation-different', 'ra-same-relation', 'negative',
    ['ra-same-relation', relation(['a'], [{ a: '1' }]), relation(['a'], [{ a: '1' }, { a: '2' }])], 'ra-no'],
  ['relational-algebra-specification', 'law-instance', 'ra-law-instance', 'positive', ['spec-theorem', 'select-distributes-over-union'], null],
].map(([program, id, operator, polarity, request, expect]) => ({ program, id, operator, polarity, request, ...(expect === null ? {} : { expect }) }));

/** Replace every occurrence of a whole subterm, also inside fact records. */
export function replaceTerm(term, from, to) {
  if (JSON.stringify(term) === JSON.stringify(from)) return to;
  if (Array.isArray(term)) return term.map(item => replaceTerm(item, from, to));
  if (term && typeof term === 'object') {
    return Object.fromEntries(Object.entries(term).map(([key, value]) => [key, replaceTerm(value, from, to)]));
  }
  return term;
}

/** Forged derivations the checker must reject, built from honest ones. */
function forgedDerivations(registries) {
  const evaluate = (program, request) => specEvaluate(registries, program, request).term;
  const dag = evaluate('graph-specification', DAG);
  const cycle = evaluate('graph-specification', CYCLE);
  const forged = [];
  const derive = (program, goal) => buildSpecCandidate(registries, program, goal, ['spec', program, 'forged']);

  // An ill-typed term: the derivation of succ zero : nat with zero replaced by true in every conclusion.
  const honestTyping = derive('type-specification', ['has-type', 'ty-empty', ['tm-succ', 'tm-zero'], 'ty-nat']);
  const [proof, context, , root, nodes, dependencies] = honestTyping.candidate;
  const illTyped = ['has-type', 'ty-empty', ['tm-succ', 'tm-true'], 'ty-nat'];
  forged.push({ name: 'ill-typed-successor', program: 'type-specification', identity: ['spec', 'type-specification', 'forged'],
    goal: illTyped, facts: honestTyping.facts,
    candidate: [proof, context, illTyped, root, replaceTerm(nodes, 'tm-zero', 'tm-true'), dependencies] });

  // A cyclic graph claimed acyclic: the DAG's derivation moved to the cycle, with the recorded fact kept.
  const honestDag = derive('graph-specification', ['gr-dag', dag]);
  forged.push({ name: 'cyclic-graph-claimed-acyclic', program: 'graph-specification', identity: ['spec', 'graph-specification', 'forged'],
    goal: ['gr-dag', cycle], facts: replaceTerm(honestDag.facts, dag, cycle), candidate: replaceTerm(honestDag.candidate, dag, cycle) });
  // The same claim with the honest fact value: the acyclicity premise no longer matches the rule.
  const honestFacts = replaceTerm(honestDag.facts, dag, cycle).map(fact => ({ ...fact, value: evaluate('graph-specification', fact.expression) }));
  const honestCandidate = replaceTerm(replaceTerm(honestDag.candidate, dag, cycle),
    ['evaluates', ['spec-call', 'gr-acyclic', cycle], 'gr-yes'], ['evaluates', ['spec-call', 'gr-acyclic', cycle], 'gr-no']);
  forged.push({ name: 'cyclic-graph-with-executed-fact', program: 'graph-specification', identity: ['spec', 'graph-specification', 'forged'],
    goal: ['gr-dag', cycle], facts: honestFacts, candidate: honestCandidate });

  // A non-reachable pair: the derivation of a reaches b with the edge reversed.
  const honestReach = derive('graph-specification', ['gr-reach', dag, 'a', 'b']);
  forged.push({ name: 'unreachable-pair', program: 'graph-specification', identity: ['spec', 'graph-specification', 'forged'],
    goal: ['gr-reach', dag, 'b', 'a'], facts: honestReach.facts.map(fact => ({ ...fact, expression: [fact.expression[0], dag, 'b', 'a'] })),
    candidate: replaceTerm(replaceTerm(honestReach.candidate, ['spec-call', 'gr-has-edge', dag, 'a', 'b'], ['spec-call', 'gr-has-edge', dag, 'b', 'a']),
      ['gr-reach', dag, 'a', 'b'], ['gr-reach', dag, 'b', 'a']) });

  // A schema-mismatched union claimed commutative: the honest law instance with managers replaced by departments.
  const goal = ['ra-equal-relations', ['ra-union', named('employees'), named('managers')], ['ra-union', named('managers'), named('employees')]];
  const honestUnion = derive('relational-algebra-specification', goal);
  forged.push({ name: 'schema-mismatched-union', program: 'relational-algebra-specification',
    identity: ['spec', 'relational-algebra-specification', 'forged'], goal: replaceTerm(goal, named('managers'), named('departments')),
    facts: replaceTerm(honestUnion.facts, named('managers'), named('departments')),
    candidate: replaceTerm(honestUnion.candidate, named('managers'), named('departments')) });
  return forged;
}

/**
 * Resolve (ty-term NAME) placeholders to the named term the specification
 * defines, so that the recorded request is the literal term.
 */
function resolveNamedTerms(registries, term) {
  if (typeof term === 'string') return term;
  if (term[0] === 'ty-term') {
    const resolved = specEvaluate(registries, 'type-specification', term).term;
    if (resolved[0] !== 'ty-named') throw new Error(`unknown named term ${term[1]}`);
    return resolved[1];
  }
  return term.map(item => resolveNamedTerms(registries, item));
}

export function specificationArtifacts(sources = specificationSources()) {
  const registries = specRegistries(sources);
  const cases = SPECIFICATION_REQUESTS.map(original => {
    const request = { ...original, request: resolveNamedTerms(registries, original.request) };
    const { term, steps } = specEvaluate(registries, request.program, request.request);
    if (request.expect !== undefined && JSON.stringify(term) !== JSON.stringify(request.expect)) {
      throw new Error(`${request.id}: expected ${JSON.stringify(request.expect)}, got ${JSON.stringify(term)}`);
    }
    const { expect, ...rest } = request;
    void expect;
    return { ...rest, expected: term, steps };
  });
  const certificates = [];
  const theorems = {};
  for (const program of Object.keys(SPEC_PROGRAMS)) {
    theorems[program] = specTheorems(registries, program);
    for (const theorem of theorems[program]) {
      const produced = produceSpecCertificate(registries, program, theorem);
      if (produced.status !== 'produced') throw new Error(`${program}.${theorem}: ${produced.status} ${produced.reason ?? ''}`);
      const checked = checkSpecCertificate(registries, produced.certificate);
      if (!checked.accepted) throw new Error(`${program}.${theorem}: produced certificate is rejected: ${checked.problems.join('; ')}`);
      certificates.push({ program, theorem, verifierSteps: checked.steps, certificate: produced.certificate });
    }
  }
  const forged = forgedDerivations(registries);
  for (const item of forged) {
    const checked = checkSpecDerivation(registries, item.program, item);
    if (checked.accepted) throw new Error(`forged derivation ${item.name} is accepted`);
    item.rejection = checked.problems[0].startsWith('fact:') ? 'fact' : 'verifier';
  }
  const hashes = Object.fromEntries(Object.entries(sources.specs).map(([program, source]) => [program, sha256(source)]));
  return {
    cases: { schema: 'rml-meta-theory-specification-cases/v1', specificationHashes: hashes, cases },
    certificates: {
      schema: 'rml-meta-theory-specification-certificates/v1',
      specificationHashes: hashes,
      verifierHash: sha256(sources.verifier),
      naturalVerifierHash: sha256(sources.natural),
      theorems,
      certificates,
      forged,
    },
  };
}

/** JSON indented for the first `depth` levels and compact below them. */
export function shallowJson(value, depth, indent = '') {
  if (depth === 0 || value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  const entries = Array.isArray(value)
    ? value.map(item => `${inner}${shallowJson(item, depth - 1, inner)}`)
    : Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${shallowJson(item, depth - 1, inner)}`);
  if (entries.length === 0) return Array.isArray(value) ? '[]' : '{}';
  return Array.isArray(value) ? `[\n${entries.join(',\n')}\n${indent}]` : `{\n${entries.join(',\n')}\n${indent}}`;
}

/** The text of both fixtures: cases indented, certificates one per line. */
export function fixtureTexts(artifacts) {
  return {
    [CASES_PATH]: `${JSON.stringify(artifacts.cases, null, 2)}\n`,
    [CERTIFICATES_PATH]: `${shallowJson(artifacts.certificates, 3)}\n`,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const artifacts = specificationArtifacts();
  for (const [path, text] of Object.entries(fixtureTexts(artifacts))) {
    if (check) {
      if (read(path) !== text) throw new Error(`stale ${path}; run node scripts/generate-meta-theory-specifications.mjs`);
    } else {
      mkdirSync(resolve(root, dirname(path)), { recursive: true });
      writeFileSync(resolve(root, path), text);
    }
  }
  console.log(`${artifacts.cases.cases.length} cases, ${artifacts.certificates.certificates.length} certificates, ` +
    `${artifacts.certificates.forged.length} forged derivations rejected`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
