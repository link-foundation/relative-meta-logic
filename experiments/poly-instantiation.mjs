// Verify type-application produces the substituted Pi type.
import { Env, evalNode, synth, keyOf } from '../js/src/rml-links.mjs';

const env = new Env();
evalNode(['Type:', 'Type', 'Type'], env);
evalNode(['Natural:', 'Type', 'Natural'], env);
evalNode(['zero:', 'Natural', 'zero'], env);

// Declare polyId with its polymorphic type
evalNode(['polyId:', ['forall', 'A', ['Pi', ['A', 'x'], 'A']]], env);

// Type-application: (apply polyId Natural) :: (Pi (Natural x) Natural)
const r = synth(['apply', 'polyId', 'Natural'], env);
console.log('apply polyId Natural ::', keyOf(r.type));
console.log('diags:', JSON.stringify(r.diagnostics));

// Then full instantiation: (apply (apply polyId Natural) zero) :: Natural
const r2 = synth(['apply', ['apply', 'polyId', 'Natural'], 'zero'], env);
console.log('apply (apply polyId Natural) zero ::', keyOf(r2.type));
console.log('diags:', JSON.stringify(r2.diagnostics));
