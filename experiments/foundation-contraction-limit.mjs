// Reproduce the closed S/K kernel spending its contraction budget inside one
// foundation question.  Before the fix `ask` threw the kernel error after the
// default budget of 100 000 000 contractions (about 22 s) instead of
// reporting a bounded outcome.
//
//   node experiments/foundation-contraction-limit.mjs [maxContractions]

import { readFileSync } from 'node:fs';
import { FoundationWorkspace } from '../js/src/rml-foundation-workspace.mjs';

const packages = readFileSync(
  new URL('../lib/foundations/packages.lino', import.meta.url),
  'utf8',
);
const weather = [
  ['value', 'rain', ['ratio', 'three', 'four']],
  ['value', 'sprinkler', ['ratio', 'two', 'four']],
  ['value', 'dark', ['ratio', 'two', 'four']],
];
const budget = process.argv[2] === undefined ? undefined : Number(process.argv[2]);
const workspace = FoundationWorkspace.fromRml(packages, { maxContractions: budget });
const started = performance.now();
try {
  const result = workspace.ask(
    'weather-in-bounded-sum-fuzzy-logic',
    ['value', 'wet-grass', '?degree'],
    { assumptions: weather },
  );
  console.log(JSON.stringify({
    status: result.status,
    reason: result.reason,
    detail: result.detail,
    search: result.search ?? null,
  }));
} catch (error) {
  console.log(`threw: ${error.message}`);
}
console.log(`${(performance.now() - started).toFixed(0)} ms`);
