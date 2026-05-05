// Experiment: verify polymorphic identity, apply, and compose type-check
// after extending parseBinding to accept list-typed parameter types.

import { Env, evalNode, synth, check, keyOf } from '../js/src/rml-links.mjs';

const env = new Env();
evalNode(['Type:', 'Type', 'Type'], env);
evalNode(['Natural:', 'Type', 'Natural'], env);
evalNode(['zero:', 'Natural', 'zero'], env);

console.log('--- polymorphic identity ---');

// (identity: forall A (Pi (A x) A))
// expanded: (Pi (Type A) (Pi (A x) A))
const idType = ['forall', 'A', ['Pi', ['A', 'x'], 'A']];
const idValue = ['lambda', ['Type', 'A'], ['lambda', ['A', 'x'], 'x']];

const r1 = check(idValue, idType, env);
console.log('check polyId:', JSON.stringify(r1));

// Synthesize the type of the polymorphic identity value
const r1s = synth(idValue, env);
console.log('synth polyId type =', keyOf(r1s.type));
console.log('synth polyId diags =', JSON.stringify(r1s.diagnostics));

// Apply at Natural: (apply identity Natural) :: (Pi (Natural x) Natural)
evalNode(['polyId:', idType], env);
evalNode(['polyId:', 'lambda', ['Type', 'A'], ['lambda', ['A', 'x'], 'x']], env);

const instType = synth(['apply', 'polyId', 'Natural'], env);
console.log('apply polyId Natural ::', keyOf(instType.type), 'diags=', JSON.stringify(instType.diagnostics));

console.log('\n--- polymorphic apply ---');

// (poly-apply: forall A (forall B (Pi ((Pi (A x) B) f) (Pi (A x) B))))
// At surface: take type A, type B, function f: A->B, and return f itself? Real apply takes f and x and returns (apply f x).
// Standard polymorphic apply :: forall A. forall B. (A -> B) -> A -> B
//   = forall A. forall B. (Pi (A x) B) -> (A x) -> B
//   = forall A (forall B (Pi ((Pi (A x) B) f) (Pi (A x) B)))
const applyType = ['forall', 'A', ['forall', 'B',
  ['Pi', [['Pi', ['A', 'x'], 'B'], 'f'],
    ['Pi', ['A', 'x'], 'B']]]];

const applyValue = ['lambda', ['Type', 'A'],
  ['lambda', ['Type', 'B'],
    ['lambda', [['Pi', ['A', 'x'], 'B'], 'f'],
      ['lambda', ['A', 'x'], ['apply', 'f', 'x']]]]];

const r2 = check(applyValue, applyType, env);
console.log('check polyApply:', JSON.stringify(r2));

console.log('\n--- polymorphic compose ---');

// compose :: forall A. forall B. forall C. (B -> C) -> (A -> B) -> (A -> C)
const composeType = ['forall', 'A', ['forall', 'B', ['forall', 'C',
  ['Pi', [['Pi', ['B', 'y'], 'C'], 'g'],
    ['Pi', [['Pi', ['A', 'x'], 'B'], 'f'],
      ['Pi', ['A', 'x'], 'C']]]]]];

const composeValue = ['lambda', ['Type', 'A'],
  ['lambda', ['Type', 'B'],
    ['lambda', ['Type', 'C'],
      ['lambda', [['Pi', ['B', 'y'], 'C'], 'g'],
        ['lambda', [['Pi', ['A', 'x'], 'B'], 'f'],
          ['lambda', ['A', 'x'], ['apply', 'g', ['apply', 'f', 'x']]]]]]]];

const r3 = check(composeValue, composeType, env);
console.log('check polyCompose:', JSON.stringify(r3));
