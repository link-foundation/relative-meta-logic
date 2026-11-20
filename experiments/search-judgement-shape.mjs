// Compare derived judgement shapes across execution bases.
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';
import { combinatorCreateProofState, combinatorInferOnce } from '../js/src/rml-combinator-kernel.mjs';

const source = `
(linked-program t)
(linked-rewrite t double (from (double ?x)) (to (pair ?x ?x)))
(linked-fact t base (judgement (seed a)))
(linked-inference t grow (premise (seed ?x)) (conclusion (holds (double ?x))))
`;
const registry = LinkedProgramRegistry.fromRml(source);
let state = combinatorCreateProofState(registry.programs, 't', []);
const next = combinatorInferOnce(state);
console.log('s-k derivation.judgement', JSON.stringify(next.derivation.judgement));
console.log('s-k proof.judgement', JSON.stringify(next.derivation.proof.judgement));
console.log('s-k prove', JSON.stringify(registry.prove('t', ['holds', ['double', 'a']])));
const direct = LinkedProgramRegistry.fromRml(source, { executionBasis: 'direct-structural' });
console.log('direct prove', JSON.stringify(direct.prove('t', ['holds', ['double', 'a']])));
