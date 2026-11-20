// Find, for a few foundation questions, the smallest contraction budget of
// the closed S/K kernel that lets each stage of `ask` finish.  Each kernel
// call has its own budget, so a growing budget moves the stopping stage from
// the signature check through the assumptions and the goal to the
// derivation, and at last lets the question finish.
//
//   node experiments/foundation-contraction-stages.mjs

import { readFileSync } from 'node:fs';
import { FoundationWorkspace } from '../js/src/rml-foundation-workspace.mjs';

const packages = readFileSync(
  new URL('../lib/foundations/packages.lino', import.meta.url),
  'utf8',
);
const contradiction = [['holds', 'rain'], ['holds', ['not', 'rain']]];
const questions = [
  ['lawn-in-classical-logic', ['holds', 'wet-lawn'], []],
  ['lawn-in-minimal-logic', ['holds', 'wet-lawn'], []],
  ['lawn-in-minimal-logic', ['holds', 'frost'], contradiction],
  ['productive-stream-examples', ['stream', 'ones'], []],
  ['productive-stream-examples', ['stream', '?stream'], []],
];
const order = ['signature', 'assumption', 'goal', 'refutation', 'derivation', 'hypothesis'];

function stageOf(instance, query, assumptions, maxContractions) {
  const workspace = FoundationWorkspace.fromRml(packages, { maxContractions });
  const result = workspace.ask(instance, query, { assumptions });
  if (result.reason !== 'contraction-limit') {
    return { rank: order.length, label: `${result.status}/${result.reason}` };
  }
  const label = result.detail.slice(0, result.detail.indexOf(':'));
  return { rank: order.indexOf(label.split(' ')[0]), label };
}

// The smallest budget whose stopping stage ranks above `rank`.
function threshold(instance, query, assumptions, rank, ceiling) {
  let low = 1;
  let high = ceiling;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (stageOf(instance, query, assumptions, middle).rank > rank) high = middle;
    else low = middle + 1;
  }
  return high;
}

const ceiling = 8_000_000;
for (const [instance, query, assumptions] of questions) {
  console.log(instance, JSON.stringify(query), `assumptions: ${assumptions.length}`);
  let budget = 1;
  let stage = stageOf(instance, query, assumptions, budget);
  console.log(`  from ${budget}: ${stage.label}`);
  while (stage.rank < order.length) {
    if (stageOf(instance, query, assumptions, ceiling).rank <= stage.rank) {
      console.log(`  still ${stage.label} at ${ceiling}`);
      break;
    }
    budget = threshold(instance, query, assumptions, stage.rank, ceiling);
    stage = stageOf(instance, query, assumptions, budget);
    console.log(`  from ${budget}: ${stage.label}`);
  }
}
