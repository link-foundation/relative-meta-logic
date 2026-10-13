import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Link, Parser, encodeReferenceLiteral, decodeReferenceLiteral } from 'links-notation';
import { parseLinoLinkDocument, LinoParseError } from '../src/rml-lino-frontend.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('../../test-corpus/lino-frontend/reference-literals.json', import.meta.url)));
test('released reference literals preserve exact leaf and named-link values', () => {
  for (const label of fixture.labels) {
    const literal = encodeReferenceLiteral(label);
    assert.equal(decodeReferenceLiteral(literal), label);
    for (const spelling of [literal, Link.escapeReference(label)]) {
      const [value] = parseLinoLinkDocument(`(head ${spelling} tail)`);
      assert.equal(value.link.values[1].id, label);
      const [named] = parseLinoLinkDocument(`(${spelling}: tail)`);
      assert.equal(named.link.id, label);
      assert.deepEqual(parseLinoLinkDocument(value.form.text)[0].link, value.link);
      assert.equal(new Parser().parse(`(head ${spelling} tail)`)[0].values[1].id, label);
    }
  }
});
test('malformed reserved literals produce a located E006, including invalid UTF-8', () => {
  for (const literal of fixture.invalid) {
    assert.throws(() => decodeReferenceLiteral(literal));
    assert.throws(() => parseLinoLinkDocument(`(a ${literal})`), error => error instanceof LinoParseError && error.code === 'E006' && error.line === 1 && error.col === 4);
  }
  assert.throws(() => parseLinoLinkDocument('(\ud800)'), /well-formed Unicode/);
});
test('decoded private-use references cannot alias internal group or quote placeholders', () => {
  for (const label of fixture.labels.filter(label => label.startsWith('\ue000'))) {
    const [result] = parseLinoLinkDocument(`(${encodeReferenceLiteral(label)} (a (b c)))`);
    assert.equal(result.link.values[0].id, label);
    assert.equal(result.link.values[1].values[0].id, 'a');
  }
});

import { Env, evaluate, parseOne, tokenizeOne, emitLinoTerm, keyOf, matchProofPattern, runTactics } from '../src/rml-links.mjs';
import { checkProgram, isOk } from '../src/check.mjs';
import { parseRmlToMetaLanguage, reconstructRmlFromMetaLanguage, rmlStructureOnly, serializeRmlStructure, deserializeRmlStructure, emitRmlFromStructure } from '../src/rml-meta-language.mjs';
import { DoubletSequenceStore } from '../src/rml-theory-network.mjs';
import { FoundationWorkspace } from '../src/rml-foundation-workspace.mjs';
import os from 'node:os';
import path from 'node:path';
test('semantic lexer and lossless emitter retain every exact reference inside an AST', () => {
  for (const label of fixture.labels) {
    const ast = ['head', label, [label, 'tail']];
    assert.deepEqual(parseOne(tokenizeOne(emitLinoTerm(ast))), ast);
    assert.deepEqual(parseOne(tokenizeOne(`(head ${encodeReferenceLiteral(label)} tail)`)), ['head', label, 'tail']);
  }
  assert.equal(keyOf('(a b)'), keyOf(['a', 'b']));
  assert.notEqual(emitLinoTerm('(a b)'), emitLinoTerm(['a', 'b']));
  assert.deepEqual(parseOne(tokenizeOne('((and: avg) # comment)')), [['and:', 'avg']]);
  assert.throws(() => parseOne(tokenizeOne('(a b')), /expected/);
  for (const literal of fixture.invalid) assert.throws(() => tokenizeOne(`(head ${literal})`), LinoParseError);
});
test('evaluation and independent proof replay preserve quoted, literal and colon-ending references', () => {
  for (const label of fixture.labels) {
    const spelling = encodeReferenceLiteral(label);
    const source = `(? (${spelling} = ${spelling}))`;
    const out = evaluate(source, { withProofs: true });
    assert.deepEqual(out.diagnostics, [], JSON.stringify(label));
    assert.deepEqual(out.results, [1], JSON.stringify(label));
    assert.deepEqual(out.provenance, ['structural-equality']);
    assert.ok(isOk(checkProgram(source, out.proofs.map(emitLinoTerm).join('\n'))), JSON.stringify(label));
  }
});
test('probability assignments and checker authorization distinguish atoms from display-colliding lists', () => {
  const source = "(('(a b)' = '(a b)') has probability 0.25)\n(? ((a b) = (a b)))\n(? ('(a b)' = '(a b)'))";
  const out = evaluate(source, { withProofs: true });
  assert.deepEqual(out.results, [1, 0.25]);
  assert.deepEqual(out.provenance, ['structural-equality', 'assigned-equality']);
  assert.ok(isOk(checkProgram(source, out.proofs.map(emitLinoTerm).join('\n'))));
  const forged = out.proofs.map(proof => structuredClone(proof));
  forged[0][1] = 'assigned-equality';
  assert.equal(isOk(checkProgram(source, forged.map(emitLinoTerm).join('\n'))), false);
  assert.equal(matchProofPattern(['?x', '?x'], ['(a b)', ['a', 'b']], {}), false);
  assert.equal(matchProofPattern(['?x', '?x'], [['a b'], ['a', 'b']], {}), false);
});
test('mixed-provider RML network transports exact source and source-free structures', () => {
  for (const label of fixture.labels) {
    const source = `(head ${encodeReferenceLiteral(label)} tail)\n`;
    const network = parseRmlToMetaLanguage(source);
    assert.equal(reconstructRmlFromMetaLanguage(network), source);
    const restored = deserializeRmlStructure(serializeRmlStructure(rmlStructureOnly(network)));
    const canonical = emitRmlFromStructure(restored);
    assert.deepEqual(parseOne(tokenizeOne(canonical)), ['head', label, 'tail']);
  }
});
test('foundation observations and revisions retain distinct assumptions with the same display', () => {
  const workspace = FoundationWorkspace.fromRml('(linked-program facts)\n(linked-foundation identity (version 1) (signature (holds ?x)) (cycle-policy inductive))\n(linked-instance example (theory facts) (foundation identity))', { executionBasis: 'direct-structural' });
  const a = ['holds', '(a b)']; const b = ['holds', ['a', 'b']];
  const results = [workspace.ask('example', a, { assumptions: [a, b] }), workspace.ask('example', b, { assumptions: [a, b] })];
  assert.deepEqual(results.map(r => r.status), ['proved', 'proved']);
  const revised = workspace.revise(results, { replaceAssumption: [a, ['holds', 'changed']] });
  assert.deepEqual(revised.revisions.map(r => r.after.status), ['unknown', 'proved']);
  const answers = workspace.ask('example', ['holds', '?x'], { assumptions: [a, b] });
  assert.equal(answers.answers.length, 2);
});
test('addressed scalar references reject invalid Unicode atomically without restricting composite emptiness', () => {
  for (const bad of ['\ud800', '\udfff']) {
    const store = new DoubletSequenceStore();
    for (const args of [[bad, 'a', 'b'], ['x', bad, 'b'], ['x', 'a', bad]]) {
      assert.throws(() => store.define(...args), /well-formed Unicode/);
      assert.deepEqual(store.entries(), []);
    }
    for (const method of ['encodeSequence', 'encodeReferenceSequence', 'encodeOrderedSet', 'encodeReferenceOrderedSet', 'encodeSet', 'encodeReferenceSet']) {
      assert.throws(() => store[method](['valid', bad], 'sequence'), /well-formed Unicode/);
      assert.deepEqual(store.entries(), []);
    }
  }
  const store = new DoubletSequenceStore();
  assert.throws(() => store.define('', 'a', 'b'), /non-empty reference/);
  assert.deepEqual(store.decodeReferenceSequence(store.encodeReferenceSequence([])), []);
  const head = store.encodeReferenceSequence(['�', '😀', '\0'], 'unicode');
  assert.deepEqual(store.decodeReferenceSequence(head), ['�', '😀', '\0']);
});
test('SMT transport assigns injective legal ASCII symbols to atoms and compounds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-reference-smt-'));
  try {
    const capture = path.join(directory, 'input.smt2'); const solver = path.join(directory, 'solver.mjs');
    fs.writeFileSync(solver, "import fs from 'node:fs';fs.writeFileSync(process.argv[2],fs.readFileSync(0,'utf8'));console.log('unknown');");
    const nodes = ['(a b)', ['a', 'b'], 'a b', 'a_b', '|', '\\', '\0', 'rml_hex_61'];
    const goal = ['and', ...nodes.map(node => [node, '=', node])];
    runTactics({ goals: [goal] }, [['by', 'smt']], { smtSolver: process.execPath, smtSolverArgs: [solver, capture], smtTimeoutMs: 1000 });
    const source = fs.readFileSync(capture, 'utf8');
    const declarations = [...source.matchAll(/\(declare-const \|([A-Za-z_][A-Za-z0-9_]*)\| Real\)/g)].map(match => match[1]);
    assert.equal(new Set(declarations).size, nodes.length);
    assert.equal(declarations.length, nodes.length);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('lossless emitter rejects cyclic or overdeep arrays and preserves shared input identity', () => {
  const cyclic = ['cycle']; cyclic.push(cyclic);
  assert.throws(() => emitLinoTerm(cyclic), /cyclic array/);
  assert.equal(cyclic[1], cyclic);
  const env = new Env(); env.setExprProb(['a', '=', 'a'], 0.5);
  const assignments = [...env.assign];
  assert.throws(() => env.setExprProb(cyclic, 1), /cyclic array/);
  assert.deepEqual([...env.assign], assignments);
  let deep = 'leaf'; for (let i = 0; i < 65; i++) deep = [deep];
  assert.throws(() => emitLinoTerm(deep), /nesting limit/);
  const shared = ['a b', 'tail']; const dag = [shared, shared];
  assert.deepEqual(parseOne(tokenizeOne(emitLinoTerm(dag))), [['a b','tail'],['a b','tail']]);
  assert.equal(dag[0], shared); assert.equal(dag[1], shared);
});
