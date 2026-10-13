#!/usr/bin/env node
// Regenerate (--write) or freshness-check (--check, default) the four-language construct inventory.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  INVENTORY_PATH, buildLanguageConstructInventory, renderLanguageConstructInventory,
} from '../js/src/rml-language-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const inventory = buildLanguageConstructInventory();
const rendered = renderLanguageConstructInventory(inventory);
const problems = inventory.languages.flatMap(language => [
  ...language.unclassified.map(rule => `${language.language}: unclassified construct ${rule}`),
  ...language.deadPatterns.map(axis => `${language.language}: ${axis} pattern matches no construct`),
  ...language.unexpectedAcceptance.map(name => `${language.language}: corpus acceptance changed for ${name}`),
]);
if (process.argv.includes('--write')) writeFileSync(`${root}${INVENTORY_PATH}`, rendered);
else if (readFileSync(`${root}${INVENTORY_PATH}`, 'utf8') !== rendered) problems.push(`${INVENTORY_PATH} is stale; run node scripts/language-construct-inventory.mjs --write`);
for (const language of inventory.languages) {
  console.log(`${language.language}: ${language.rules} rules, ${language.observable} observable, ${language.exercised} exercised, ${language.refusedPrograms.length} refused programs`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
