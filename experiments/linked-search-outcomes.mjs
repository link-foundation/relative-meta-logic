// Exercise LinkedProgramRegistry.search outcomes in every execution basis.
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';

const source = `
(linked-program graph)
(linked-fact graph ab (judgement (edge a b)))
(linked-fact graph bc (judgement (edge b c)))
(linked-inference graph base (premise (edge ?x ?y)) (conclusion (path ?x ?y)))
(linked-inference graph step (premise (edge ?x ?y)) (premise (path ?y ?z)) (conclusion (path ?x ?z)))
(linked-program counter)
(linked-fact counter zero (judgement (count z)))
(linked-inference counter next (premise (count ?n)) (conclusion (count (s ?n))))
(linked-program loops)
(linked-rewrite loops flip (from (flip ?x)) (to (flop ?x)))
(linked-rewrite loops flop (from (flop ?x)) (to (flip ?x)))
`;
for (const executionBasis of ['s-k', 'direct-structural', 'horn-relational']) {
  const registry = LinkedProgramRegistry.fromRml(source, { executionBasis });
  const show = (label, outcome) => console.log(executionBasis, label, outcome.ended,
    outcome.goals.map(goal => [goal.normalization, goal.proof?.rule ?? null]),
    outcome.derived.map(entry => JSON.stringify(entry.judgement)).join(' '), outcome.facts);
  show('found', registry.search('graph', [['path', 'a', 'c'], ['path', 'b', 'c']]));
  show('saturated', registry.search('graph', [['path', 'c', 'a']]));
  show('closure', registry.search('graph', []));
  show('inference-limit', registry.search('counter', [['count', 'never']], { maxRounds: 1, maxFacts: 3 }));
  show('fact-limit', registry.search('counter', [['count', 'never']], { maxRounds: 64, maxFacts: 3 }));
  if (executionBasis !== 'horn-relational') {
    show('rewrite-cycle', registry.search('loops', [['flip', 'a']]));
  }
}
