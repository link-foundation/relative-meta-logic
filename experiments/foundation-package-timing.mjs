// Measures S/K execution cost for small unary arithmetic and saturation
// workloads before choosing foundation-package witnesses.
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';

const source = `
(linked-program unary)
(linked-rewrite unary plus-zero (from (plus z ?n)) (to ?n))
(linked-rewrite unary plus-succ (from (plus (s ?m) ?n)) (to (s (plus ?m ?n))))
(linked-rewrite unary times-zero (from (times z ?n)) (to z))
(linked-rewrite unary times-succ (from (times (s ?m) ?n)) (to (plus ?n (times ?m ?n))))

(linked-program chain)
(linked-inference chain step
  (premise (at ?x))
  (premise (edge ?x ?y))
  (conclusion (at ?y)))
`;

function unary(n) {
  let term = 'z';
  for (let index = 0; index < n; index += 1) term = ['s', term];
  return term;
}

for (const basis of ['s-k', 'direct-structural']) {
  const registry = LinkedProgramRegistry.fromRml(source, { executionBasis: basis });
  for (const [left, right] of [[3, 7], [5, 10], [10, 10]]) {
    const started = performance.now();
    const result = registry.reduce('unary', ['times', unary(left), unary(right)]);
    const elapsed = performance.now() - started;
    console.log(basis, `times ${left} ${right}`, result.steps, 'steps', elapsed.toFixed(1), 'ms');
  }
  for (const length of [5, 10, 20]) {
    const facts = [['at', 'n0']];
    for (let index = 0; index < length; index += 1) {
      facts.push(['edge', `n${index}`, `n${index + 1}`]);
    }
    const started = performance.now();
    const proof = registry.prove('chain', ['at', `n${length}`], { facts });
    const elapsed = performance.now() - started;
    console.log(basis, `chain ${length}`, proof.ok, elapsed.toFixed(1), 'ms');
  }
}
