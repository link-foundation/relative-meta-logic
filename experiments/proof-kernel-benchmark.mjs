import { readFileSync } from 'node:fs';

import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';

const source = readFileSync(new URL('../lib/meta-theory/universal.lino', import.meta.url), 'utf8');
const programs = LinkedProgramRegistry.fromRml(source);

function benchmark(name, operation) {
  const started = performance.now();
  const result = operation();
  console.log(`${name}: ${Math.round(performance.now() - started)}ms`, result.ok);
}

benchmark('graph-theory', () => programs.prove(
  'graph-theory',
  ['reachable', 'a', 'c'],
  { facts: [['edge', 'a', 'b'], ['edge', 'b', 'c']] },
));
benchmark('relational-algebra', () => programs.prove(
  'relational-algebra',
  ['relates', ['compose', 'left', 'right'], 'a', 'c'],
  { facts: [['relates', 'left', 'a', 'b'], ['relates', 'right', 'b', 'c']] },
));
benchmark('dependent-type-theory', () => programs.prove(
  'dependent-type-theory',
  ['has-type', ['apply', ['lambda', 'Nat', ['bound', 'zero']], 'zero'], 'Nat'],
));
