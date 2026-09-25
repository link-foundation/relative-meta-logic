// Probe: which program shapes the S/K import resolver can find.
//
// An earlier probe wrote every source on one line and every case failed
// with "cannot find linked-program". Links notation reads one line as one
// link, so `(a)(b)` on one line is a single anonymous link whose head is not
// a form name and the registry loads nothing. With one top-level form per
// line every shape resolves, and S/K and direct execution agree.
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';

const graph = name => [
  `(linked-program ${name})`,
  `(linked-fact ${name} ab (judgement (edge a b)))`,
  `(linked-inference ${name} base (premise (edge ?x ?y)) (conclusion (path ?x ?y)))`,
];
const cases = {
  'single-letter names with rebind': [...graph('g'), '(linked-program h (uses g (rebind a q)))'],
  'single-letter names without rebind': [...graph('g'), '(linked-program h (uses g))'],
  'longer names with rebind': [...graph('graph'), '(linked-program rebound (uses graph (rebind a q)))'],
  'double-dash name': [...graph('graph'), '(linked-program lawn--guarded (uses graph (rebind a q)))'],
};

const oneLine = LinkedProgramRegistry.fromRml(cases['single-letter names with rebind'].join(''));
console.log('all forms on one line loads', JSON.stringify(oneLine.names()));

for (const [label, lines] of Object.entries(cases)) {
  const outcomes = [];
  for (const executionBasis of ['s-k', 'direct-structural']) {
    const registry = LinkedProgramRegistry.fromRml(lines.join('\n'), { executionBasis });
    const last = registry.names().find(name => !['g', 'graph'].includes(name));
    try {
      const result = registry.search(last, [['path', 'q', 'c']], { facts: [['edge', 'b', 'c']] });
      outcomes.push(`${executionBasis}: ${result.ended}, derived ${result.derived.length}`);
    } catch (error) {
      outcomes.push(`${executionBasis}: error ${error.message}`);
    }
  }
  console.log(label, '->', outcomes.join('; '));
}
