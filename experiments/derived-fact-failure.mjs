// Probe: how each basis reports an input or derived fact without a normal
// form during search. Direct saturation classifies the failure; the closed
// S/K kernel normalizes facts itself and reports its own bound.
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';

const source = [
  '(linked-program loops)',
  '(linked-rewrite loops flip (from (flip ?x)) (to (flop ?x)))',
  '(linked-rewrite loops flop (from (flop ?x)) (to (flip ?x)))',
  '(linked-program spinner (uses loops))',
  '(linked-fact spinner seed (judgement (start a)))',
  '(linked-inference spinner spin (premise (start ?x)) (conclusion (flip ?x)))',
].join('\n');

for (const executionBasis of ['s-k', 'direct-structural']) {
  const registry = LinkedProgramRegistry.fromRml(source, { executionBasis });
  for (const [label, run] of [
    ['input fact', () => registry.search('loops', [], { facts: [['flip', 'a']] })],
    ['derived fact', () => registry.search('spinner', [], {})],
  ]) {
    try {
      const result = run();
      console.log(executionBasis, label, '->', result.ended);
    } catch (error) {
      console.log(executionBasis, label, '-> error', JSON.stringify(error.reductionFailure), error.message);
    }
  }
}
