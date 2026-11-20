// Find the smallest contraction budget under which each closed S/K kernel
// call of a reduction and of a saturation succeeds.  The budget applies to
// each kernel call separately, so a large goal can spend it while the
// saturation of a small program does not.
//
// Usage: node experiments/contraction-budget-per-call.mjs [width]
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';

const width = Number(process.argv[2] ?? 40);
const goalTerm = ['row', ...Array.from({ length: width }, () => 'item')];
const source = [
  '(linked-program counter)',
  '(linked-fact counter zero (judgement (count z)))',
  '(linked-inference counter next (premise (count ?n)) (conclusion (seen ?n)))',
].join('\n');

function succeeds(maxContractions, run) {
  const registry = LinkedProgramRegistry.fromRml(source, { maxContractions });
  try {
    run(registry);
    return true;
  } catch (error) {
    if (error.reductionFailure !== 'contraction-limit') throw error;
    return false;
  }
}

function smallestBudget(run) {
  let low = 1;
  let high = 1;
  while (!succeeds(high, run)) high *= 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (succeeds(middle, run)) high = middle; else low = middle + 1;
  }
  return high;
}

const reduction = smallestBudget(registry => registry.reduce('counter', ['count', ['s', 'z']]));
const bigReduction = smallestBudget(registry => registry.reduce('counter', goalTerm));
const saturation = smallestBudget(registry => registry.search('counter', []));
console.log(JSON.stringify({ width, reduction, bigReduction, saturation }));
for (const budget of [saturation, bigReduction - 1]) {
  const registry = LinkedProgramRegistry.fromRml(source, { maxContractions: budget });
  try {
    const search = registry.search('counter', [goalTerm, ['seen', 'z']]);
    console.log(budget, JSON.stringify({
      ended: search.ended,
      goals: search.goals.map(entry => [entry.normalization, entry.detail, entry.proof?.rule ?? null]),
    }));
  } catch (error) {
    console.log(budget, 'threw', error.reductionFailure, error.message);
  }
}
