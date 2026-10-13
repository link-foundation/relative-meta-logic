import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Env, checkNode, emitLinoTerm, evalNode, evaluate, formalizeSelectedInterpretation,
  goalToTptp, keyOf, parseBinding, parseBindings, parseOne, subst, synth, synthNode, tokenizeOne } from '../src/rml-links.mjs';

const read = source => parseOne(tokenizeOne(`(${source})`))[0];
const labels = ['(a b)', 'a b', '"a"', "'a'", '~1{61}', '', '\0', '\r\n', '😀', 'é', 'label:', 'label::', 'label,', 'text#inside'];

test('typed environment distinguishes AST shape and stores independent exact type values', () => {
  const env = new Env();
  assert.equal(keyOf('(a b)'), keyOf(['a', 'b']));
  for (const label of labels) {
    env.setTypeNode(label, ['TypeOf', label]);
    assert.deepEqual(read(env.getTypeNode(label)), ['TypeOf', label]);
    assert.equal(env.getTypeNode([label]), null);
    assert.deepEqual(synthNode(label, env).type, ['TypeOf', label]);
    assert.equal(checkNode(label, ['TypeOf', [label]], env).ok, false);
    env.setTypeNode('holder', label);
    assert.deepEqual(synthNode('holder', env), { type: label, diagnostics: [] });
    assert.equal(checkNode('holder', label, env).ok, true);
    assert.equal(checkNode('holder', [label], env).ok, false);
  }
  assert.equal(env.getTypeNode(['a', 'b']), null);
  env.setTypeNode(['pair', 'a b'], '(Type 0)');
  assert.equal(env.getTypeNode(['pair', 'a', 'b']), null);
  assert.equal(synthNode(['pair', 'a b'], env).type, '(Type 0)');
  assert.equal(checkNode(['pair', 'a b'], ['Type', '0'], env).ok, false);
  const term = ['mutable', ['before']], type = ['Result', ['before']];
  env.setTypeNode(term, type);
  term[1][0] = 'after'; type[1][0] = 'after';
  assert.equal(env.getTypeNode(term), null);
  assert.deepEqual(read(env.getTypeNode(['mutable', ['before']])), ['Result', ['before']]);
});

test('legacy serialized APIs retain their source meaning without aliasing exact atoms', () => {
  const env = new Env();
  env.setType('(a b)', '(Type 0)');
  assert.equal(env.getType('(a b)'), '(Type 0)');
  assert.equal(env.getTypeNode('(a b)'), null);
  env.setTypeSource('(a b)', '(Type 0)');
  assert.equal(env.getTypeSource('(a b)'), '(Type 0)');
  assert.deepEqual(synth('(a b)', env).type, ['Type', '0']);
  assert.equal(synthNode('(a b)', env).type, null);
  assert.throws(() => env.setTypeSource('(broken', 'T'));
  env.setType('plain phrase', 'Raw type');
  assert.equal(read(env.getType('plain phrase')), 'Raw type');
});

test('source type declarations reject display-colliding mutations of terms and types', () => {
  for (const label of labels) {
    const ref = emitLinoTerm(label);
    const source = `(${ref}: (Tag ${ref}) ${ref})\n(? (${ref} of (Tag ${ref})))\n(? ((${ref}) of (Tag ${ref})))\n(? (${ref} of (Tag (${ref}))))`;
    const result = evaluate(source);
    assert.deepEqual(result.diagnostics, [], ref);
    assert.deepEqual(result.results, [1, 0, 0], ref);
  }
  const result = evaluate(`('(a b)': (Type 0) '(a b)')\n(? ('(a b)' of (Type 0)))\n(? ((a b) of (Type 0)))`);
  assert.deepEqual(result.results, [1, 0]);
});

test('lambda and Pi preserve binder, domain and body identities and restore scope', () => {
  for (const label of labels) {
    const env = new Env(), domain = '(Domain x)', original = ['Original', label];
    env.setTypeNode(label, original);
    env.setTypeNode(['a', 'b'], 'Other');
    const lambda = ['lambda', [`${label}:`, domain], label];
    const expected = ['Pi', [`${label}:`, domain], domain];
    assert.deepEqual(synthNode(lambda, env).type, expected, label);
    assert.equal(checkNode(lambda, ['Pi', [`${label}:`, ['Domain', 'x']], ['Domain', 'x']], env).ok, false);
    assert.deepEqual(read(env.getTypeNode(label)), original);
    evalNode(['fn:', ...lambda], env);
    assert.deepEqual(read(env.getTypeNode('fn')), expected);
    assert.deepEqual(read(env.getTypeNode(label)), original);
    assert.equal(env.getTypeNode(['a', 'b']), 'Other');
    evalNode(lambda, env);
    assert.deepEqual(read(env.getTypeNode(lambda)), expected);
  }
});

test('proof reports and formalization transport reconstruct exact ASTs', () => {
  for (const label of labels) {
    const env = new Env(), claim = ['holds', label];
    env.registerProofRule({ name: 'copy', premises: [claim], conclusion: claim });
    env.registerProofAssumption({ name: 'given', kind: 'axiom', judgement: claim });
    env.registerProofObject({ name: 'proof', rule: 'copy', premises: [claim], premiseRefs: ['given'], conclusion: claim });
    const snapshot = env.foundationReport(), report = env.proofReport('proof');
    assert.equal(report.verdict.ok, true);
    for (const source of [snapshot.proofRules[0].conclusion, snapshot.proofRules[0].premises[0],
      snapshot.proofAssumptions[0].judgement, snapshot.proofObjects[0].conclusion,
      report.conclusion, report.premises[0], report.dependencies[0].judgement]) assert.deepEqual(read(source), claim);
    const ast = ['?', [label, '=', label]];
    const formal = formalizeSelectedInterpretation({ text: 'exact references', interpretation: { kind: 'lino', lino: emitLinoTerm(ast) } });
    assert.equal(formal.computable, true);
    assert.deepEqual(formal.ast, ast);
    assert.deepEqual(read(formal.lino), ast);
    assert.deepEqual(evaluate(formal.lino).results, [1]);
  }
});

test('TPTP separates source symbols, terms, and bound variables', () => {
  for (const [left, right] of [['a b', 'a_b'], ['P', 'p'], ['x', 'X'], ['', '_'],
    ['😀', 'é'], ['rml_hex_50', 'P'], ['num_1', '1'], ['(a b)', ['a', 'b']], ['(a)', ['a']]]) {
    const output = goalToTptp({ goal: [left, '=', right] });
    const match = output.match(/conjecture, \((.*) = (.*)\)\)/);
    assert.ok(match, output); assert.notEqual(match[1], match[2], output);
  }
  for (const label of labels) {
    const atom = goalToTptp({ goal: ['value', 'of', label] });
    const compound = goalToTptp({ goal: ['value', 'of', [label]] });
    assert.notEqual(atom, compound);
    assert.equal(goalToTptp({ goal: [label, 'value'] }), atom);
  }
  const output = goalToTptp({ goal: ['forall', ['T', 'x'], ['exists', ['T', 'X'], ['x', '=', 'X']]] });
  assert.match(output, /!\[V_rml_hex_78\]/); assert.match(output, /\?\[X\]/);
  assert.match(output, /V_rml_hex_78 = X/);
});

test('namespace/alias resolution and nested scopes preserve exact atomic type keys', () => {
  for (const label of labels) {
    const env = new Env(); env.namespace = 'ns'; env.aliases.set('alias', 'ns');
    const original = ['Original', label]; env.setTypeNode(`ns.${label}`, original);
    assert.deepEqual(read(env.getTypeNode(label)), original);
    assert.deepEqual(read(env.getTypeNode(`alias.${label}`)), original);
    assert.equal(env.getTypeNode([label]), null);
    assert.equal(env.getTypeSource(emitLinoTerm(`alias.${label}`)), env.getTypeNode(label));
    const inner = ['lambda', [`${label}:`, 'Inner'], label];
    const outer = ['lambda', [`${label}:`, 'Outer'], inner];
    assert.deepEqual(synthNode(outer, env).type, ['Pi', ['Outer', label], ['Pi', ['Inner', label], 'Inner']]);
    assert.deepEqual(read(env.getTypeNode(label)), original);
    assert.equal(env.types.has(emitLinoTerm(label)), false);
    evalNode(['named:', 'lambda', [`${label}:`, 'Local'], label], env);
    assert.equal(env.types.has(emitLinoTerm(label)), false);
    assert.deepEqual(read(env.getTypeNode(label)), original);
  }
});

test('capture avoidance preserves arbitrary binder names and external type atoms', () => {
  for (const name of labels) {
    const binder = ['lambda', [`${name}:`, name], 'free'];
    const result = subst(binder, 'free', name);
    assert.equal(result[1][1], name, 'external type must remain unchanged');
    assert.equal(result[2], name, 'replacement must remain free');
    assert.notEqual(result[1][0], `${name}:`, 'rename binder to avoid capture');
    assert.deepEqual(read(emitLinoTerm(result)), result);
  }
});

test('inferred Pi types remain usable with punctuation names and arbitrary domain atoms', () => {
  for (const domain of [...labels, 'Carrier:', 'Carrier']) {
    for (const name of ['parameter:', 'parameter::', domain === '' ? 'empty-domain-parameter:' : '']) {
      const env = new Env();
      const lambda = ['lambda', [`${name}:`, domain], name];
      const inferred = synthNode(lambda, env);
      assert.deepEqual(inferred.diagnostics, []);
      assert.equal(checkNode(lambda, inferred.type, env).ok, true);
      env.setTypeNode('argument', domain);
      env.setTypeNode('function', inferred.type);
      assert.equal(synthNode(['apply', 'function', 'argument'], env).type, domain);
      env.setTypeNode('argument', [domain]);
      assert.equal(synthNode(['apply', 'function', 'argument'], env).type, null);
    }
  }
});

test('generated corecursor type supports application with a literal state type', () => {
  const env = new Env();
  const result = evaluate('(Natural: (Type 0) Natural)\n(coinductive Stream (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))', { env });
  assert.deepEqual(result.diagnostics, []);
  env.setTypeNode('State:', ['Type', '0']);
  const partial = ['apply', 'Stream-corec', 'State:'];
  const inferred = synthNode(partial, env);
  assert.deepEqual(inferred.diagnostics, []);
  const stepType = parseBinding(inferred.type[1]).paramType;
  assert.equal(parseBinding(stepType[1]).paramType, 'State:');
  env.setTypeNode('step', stepType);
  env.setTypeNode('seed', 'State:');
  const application = ['apply', ['apply', partial, 'step'], 'seed'];
  assert.deepEqual(synthNode(application, env), { type: 'Stream', diagnostics: [] });
  env.setTypeNode('seed', ['State:']);
  assert.equal(synthNode(application, env).type, null);
});

test('Unicode prefix type binders agree with Rust without folding exact reference names', () => {
  const cases = JSON.parse(readFileSync(new URL('../../test-corpus/lino-frontend/unicode-type-bindings.json', import.meta.url)));
  for (const [index, domain] of cases.uppercase.entries()) {
    assert.deepEqual(parseBinding([domain, cases.parameter]), { paramName: cases.parameter, paramType: domain });
    assert.deepEqual(parseBindings([domain, 'x,', domain, 'y']), [{ paramName: 'x', paramType: domain }, { paramName: 'y', paramType: domain }]);
    const lambda = ['lambda', [domain, cases.parameter], cases.parameter];
    assert.deepEqual(read(emitLinoTerm(lambda)), lambda);
    const env = new Env(), inferred = synthNode(lambda, env);
    assert.deepEqual(inferred.diagnostics, []);
    assert.equal(checkNode(lambda, inferred.type, env).ok, true);
    env.setTypeNode('function', inferred.type);
    env.setTypeNode('argument', domain);
    assert.equal(synthNode(['apply', 'function', 'argument'], env).type, domain);
    env.setTypeNode('argument', cases.lowercase[index]);
    assert.equal(synthNode(['apply', 'function', 'argument'], env).type, null);
  }
  for (const domain of cases.lowercase) {
    assert.equal(parseBinding([domain, cases.parameter]), null);
    assert.equal(parseBindings([domain, 'x,', domain, 'y']), null);
  }
  for (const domain of [...cases.uppercase, ...cases.lowercase]) {
    const binding = [`${cases.parameter}:`, domain];
    assert.deepEqual(parseBinding(binding), { paramName: cases.parameter, paramType: domain });
    const lambda = ['lambda', binding, cases.parameter], env = new Env();
    const inferred = synthNode(read(emitLinoTerm(lambda)), env);
    assert.deepEqual(inferred.diagnostics, []);
    assert.equal(checkNode(lambda, inferred.type, env).ok, true);
    assert.equal(parseBinding(inferred.type[1]).paramType, domain);
  }
});
