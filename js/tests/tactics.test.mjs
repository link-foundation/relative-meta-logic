// Tests for the link-based tactic engine (issue #55).
// Tactics are ordinary LiNo links that transform an explicit proof state.
// Mirrored by `rust/tests/tactics_tests.rs` so JS and Rust stay aligned.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  goalToTptp,
  keyOf,
  parseAtpStatus,
  parseOne,
  runTactics,
  rewrite,
  simplify,
  tokenizeOne,
} from '../src/rml-links.mjs';

function link(src) {
  return parseOne(tokenizeOne(src));
}

function state(...goals) {
  return { goals: goals.map(goal => link(goal)) };
}

function goalKeys(proofState) {
  return proofState.goals.map(goal => keyOf(goal.goal));
}

function mockAtpArgs(source) {
  return ['-e', source];
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-smt-js-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFakeSolver(dir, source) {
  const solverPath = path.join(dir, 'fake-solver.mjs');
  fs.writeFileSync(solverPath, source);
  return solverPath;
}

describe('runTactics applies link tactics to proof states', () => {
  it('closes an equality goal with (by reflexivity)', () => {
    const out = runTactics(state('(a = a)'), [link('(by reflexivity)')]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), ['(by reflexivity)']);
  });

  it('parses tactic text before applying links', () => {
    const out = runTactics(state('(a = a)'), '(reflexivity)');

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), ['(reflexivity)']);
  });

  it('rejects tactic text that is not LiNo instead of running part of it', () => {
    assert.throws(
      () => runTactics(state('(a = a)'), '(reflexivity) (symmetry'),
      { name: 'LinoParseError', message: 'LiNo parse failure: unexpected end of input' },
    );
  });

  it('transforms equality goals with symmetry and transitivity', () => {
    const out = runTactics(state('(a = c)'), [
      link('(symmetry)'),
      link('(transitivity b)'),
    ]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(goalKeys(out.state), ['(c = b)', '(b = a)']);
    assert.deepStrictEqual(out.state.proof.map(keyOf), [
      '(symmetry)',
      '(transitivity b)',
    ]);
  });

  it('introduces Pi binders into the current proof context', () => {
    const introduced = runTactics(state('(Pi (Natural n) (n = n))'), [
      link('(introduce k)'),
    ]);

    assert.deepStrictEqual(introduced.diagnostics, []);
    assert.deepStrictEqual(goalKeys(introduced.state), ['(k = k)']);
    assert.deepStrictEqual(
      introduced.state.goals[0].context.map(keyOf),
      ['(k of Natural)'],
    );

    const closed = runTactics(introduced.state, [link('(by reflexivity)')]);
    assert.deepStrictEqual(closed.diagnostics, []);
    assert.deepStrictEqual(closed.state.goals, []);
  });

  it('adds assumptions with suppose and closes them with exact', () => {
    const supposed = runTactics(state('(p = q)'), [
      link('(suppose (p = q))'),
    ]);

    assert.deepStrictEqual(supposed.diagnostics, []);
    assert.deepStrictEqual(goalKeys(supposed.state), ['(p = q)']);
    assert.deepStrictEqual(
      supposed.state.goals[0].context.map(keyOf),
      ['(p = q)'],
    );

    const closed = runTactics(supposed.state, [link('(exact (p = q))')]);
    assert.deepStrictEqual(closed.diagnostics, []);
    assert.deepStrictEqual(closed.state.goals, []);
  });

  it('rewrites the current goal using an equality link', () => {
    const out = runTactics(state('((f a) = (f a))'), [
      link('(rewrite (a = b) in goal)'),
      link('(by reflexivity)'),
    ]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), [
      '(rewrite (a = b) in goal)',
      '(by reflexivity)',
    ]);
  });

  it('rewrites in the requested direction', () => {
    assert.strictEqual(
      keyOf(rewrite(link('(b = b)'), link('(a = b)'), { direction: 'backward' })),
      '(a = a)',
    );

    const out = runTactics(state('(b = b)'), [
      link('(rewrite <- (a = b) in goal)'),
      link('(by reflexivity)'),
    ]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
  });

  it('rewrites only the selected occurrence', () => {
    const out = runTactics(state('((pair a a) = (pair b a))'), [
      link('(rewrite (a = b) in goal at 2)'),
    ]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(goalKeys(out.state), ['((pair a b) = (pair b a))']);
  });

  it('simplifies the current goal with configured rewrite rules', () => {
    assert.strictEqual(
      keyOf(simplify(link('((f a) = (f a))'), [link('(a = b)')])),
      '((f b) = (f b))',
    );

    const out = runTactics(
      state('((f a) = (f a))'),
      [link('(simplify in goal)'), link('(by reflexivity)')],
      { rewriteRules: [link('(a = b)')] },
    );

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
  });

  it('stops simplification when the termination guard is reached', () => {
    assert.throws(
      () => simplify(
        link('(a = a)'),
        [link('(a = b)'), link('(b = a)')],
        { maxSteps: 3 },
      ),
      /termination guard/i,
    );
  });

  it('runs per-case tactic links during induction', () => {
    const out = runTactics(state('(n = n)'), [
      link(
        '(induction n (case zero (by reflexivity)) (case (succ m) (by reflexivity)))',
      ),
    ]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.strictEqual(
      keyOf(out.state.proof[0]),
      '(induction n (case zero (by reflexivity)) (case (succ m) (by reflexivity)))',
    );
  });

  it('reports a structured diagnostic with the current goal when a tactic fails', () => {
    const out = runTactics(state('(a = b)'), [link('(by reflexivity)')]);

    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E039');
    assert.match(out.diagnostics[0].message, /current goal: \(a = b\)/);
    assert.deepStrictEqual(goalKeys(out.state), ['(a = b)']);
  });

  it('exports first-order goals and context to TPTP fof problems', () => {
    const tptp = goalToTptp({
      goal: link('(P a)'),
      context: [
        link('(forall (Thing x) (P x))'),
        link('(a of Thing)'),
      ],
    });

    assert.match(tptp, /fof\(rml_context_1, axiom, \(!\[X\] : \(p\(X\)\)\)\)\./);
    assert.match(tptp, /fof\(rml_context_2, axiom, \(thing\(a\)\)\)\./);
    assert.match(tptp, /fof\(rml_goal, conjecture, \(p\(a\)\)\)\./);
  });

  it('parses SZS statuses from ATP output', () => {
    assert.deepStrictEqual(
      parseAtpStatus('% SZS status Theorem for rml_goal\n'),
      { status: 'Theorem', kind: 'proved' },
    );
    assert.deepStrictEqual(
      parseAtpStatus('% SZS status Unknown for rml_goal\n'),
      { status: 'Unknown', kind: 'unknown' },
    );
  });

  it('closes the current goal with a configured ATP proving status', () => {
    const out = runTactics(
      state('(P a)'),
      [link('(by atp)')],
      {
        atp: {
          path: process.execPath,
          args: mockAtpArgs(`
            process.stdin.resume();
            process.stdin.on('end', () => console.log('% SZS status Theorem for rml_goal'));
          `),
          name: 'mock-atp',
          timeoutMs: 1000,
        },
      },
    );

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), ['(by atp-trusted mock-atp)']);
  });

  it('reports ATP failure modes without closing the goal', () => {
    const unconfigured = runTactics(state('(P a)'), [link('(by atp)')]);
    assert.strictEqual(unconfigured.diagnostics.length, 1);
    assert.match(unconfigured.diagnostics[0].message, /ATP path is not configured/);
    assert.deepStrictEqual(goalKeys(unconfigured.state), ['(P a)']);

    const unknown = runTactics(
      state('(P a)'),
      [link('(by atp)')],
      {
        atp: {
          path: process.execPath,
          args: mockAtpArgs(`
            process.stdin.resume();
            process.stdin.on('end', () => console.log('% SZS status Unknown for rml_goal'));
          `),
          name: 'mock-atp',
          timeoutMs: 1000,
        },
      },
    );
    assert.strictEqual(unknown.diagnostics.length, 1);
    assert.match(unknown.diagnostics[0].message, /ATP returned Unknown/);
    assert.deepStrictEqual(goalKeys(unknown.state), ['(P a)']);

    const timedOut = runTactics(
      state('(P a)'),
      [link('(by atp)')],
      {
        atp: {
          path: process.execPath,
          args: mockAtpArgs('setTimeout(() => {}, 1000);'),
          name: 'mock-atp',
          timeoutMs: 1,
        },
      },
    );
    assert.strictEqual(timedOut.diagnostics.length, 1);
    assert.match(timedOut.diagnostics[0].message, /ATP timed out/);
    assert.deepStrictEqual(goalKeys(timedOut.state), ['(P a)']);
  });

  it('closes a goal with (by smt) when the configured solver returns unsat', () => withTempDir((dir) => {
    const capturePath = path.join(dir, 'input.smt2');
    const solverPath = writeFakeSolver(dir, `
      import fs from 'node:fs';
      const input = fs.readFileSync(0, 'utf8');
      fs.writeFileSync(process.argv[2], input);
      console.log('unsat');
    `);

    const out = runTactics(state('(a = a)'), [link('(by smt)')], {
      smtSolver: process.execPath,
      smtSolverArgs: [solverPath, capturePath],
      smtTimeoutMs: 1000,
    });

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), [
      `(by smt-trusted ${path.basename(process.execPath)})`,
    ]);

    const smtLib = fs.readFileSync(capturePath, 'utf8');
    assert.match(smtLib, /\(declare-const \|a\| Real\)/);
    assert.match(smtLib, /\(assert \(not \(= \|a\| \|a\|\)\)\)/);
    assert.match(smtLib, /\(check-sat\)/);
  }));

  it('reports unknown from the SMT solver without closing the goal', () => withTempDir((dir) => {
    const solverPath = writeFakeSolver(dir, "console.log('unknown');\n");

    const out = runTactics(state('(a = a)'), [link('(by smt)')], {
      smtSolver: process.execPath,
      smtSolverArgs: [solverPath],
      smtTimeoutMs: 1000,
    });

    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E039');
    assert.match(out.diagnostics[0].message, /returned unknown/);
    assert.deepStrictEqual(goalKeys(out.state), ['(a = a)']);
  }));

  it('reports SMT solver timeouts without closing the goal', () => withTempDir((dir) => {
    const solverPath = writeFakeSolver(dir, 'setTimeout(() => {}, 2000);\n');

    const out = runTactics(state('(a = a)'), [link('(by smt)')], {
      smtSolver: process.execPath,
      smtSolverArgs: [solverPath],
      smtTimeoutMs: 20,
    });

    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E039');
    assert.match(out.diagnostics[0].message, /timed out/);
    assert.deepStrictEqual(goalKeys(out.state), ['(a = a)']);
  }));
});
