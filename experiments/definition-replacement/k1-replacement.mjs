// Replace one linked definition of the K1 meta-interpreter at a time and run
// the same request through the same, unchanged host runtime.
//
// Run from the repository root: node experiments/definition-replacement/k1-replacement.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LinkedProgramRegistry } from '../../js/src/rml-linked-program.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(here, '..', '..', 'lib', 'meta-theory', 'universal.lino'),
  'utf8',
);

function replaceRule(text, name, replacement) {
  const header = `(linked-rewrite links-meta-foundation ${name}\n`;
  const start = text.indexOf(header);
  if (start < 0) throw new Error(`no rule ${name}`);
  const end = text.indexOf('\n\n', start);
  return `${text.slice(0, start)}${header}${replacement}${text.slice(end)}`;
}

const replacements = {
  matching: ['match-repeated-variable', `  (from
    (match-variable (binding-found ?previous) ?name ?candidate ?bindings))
  (to (match-ok ?bindings)))`],
  substitution: ['substitute-pair', `  (from
    (meta-substitute (pair ?left ?right) ?bindings))
  (to
    (pair
      (meta-substitute ?right ?bindings)
      (meta-substitute ?left ?bindings))))`],
  selection: ['select-next-object-rule', `  (from
    (select-meta-rewrite rewrite-miss ?remaining-rules ?candidate))
  (to ?candidate))`],
  verification: ['verify-object-result', `  (from (meta-verify ?result ?result))
  (to (verified ?result)))`],
};

const rules = (...items) => items.reduceRight(
  (tail, item) => ['rules', item, tail],
  ['no-rules'],
);
const requests = {
  matching: ['meta-rewrite', rules(['rewrite',
    ['pair', ['meta-variable', 'x'], ['meta-variable', 'x']],
    ['atom', 'same'],
  ]), ['pair', ['atom', 'a'], ['atom', 'b']]],
  substitution: ['meta-rewrite', rules(['rewrite',
    ['pair', ['atom', 'identity'], ['meta-variable', 'argument']],
    ['pair', ['meta-variable', 'argument'], ['atom', 'done']],
  ]), ['pair', ['atom', 'identity'], ['atom', 'a']]],
  selection: ['meta-rewrite', rules(
    ['rewrite', ['atom', 'other'], ['atom', 'first']],
    ['rewrite', ['atom', 'a'], ['atom', 'second']],
  ), ['atom', 'a']],
  verification: ['meta-verify', ['atom', 'a'], ['meta-rewrite', rules(['rewrite',
    ['pair', ['atom', 'identity'], ['meta-variable', 'argument']],
    ['meta-variable', 'argument'],
  ]), ['pair', ['atom', 'identity'], ['atom', 'a']]]],
};

const encode = (term, variables = false) => {
  if (!Array.isArray(term)) {
    if (variables && term.startsWith('?')) return ['meta-variable', term.slice(1)];
    return ['atom', term];
  }
  return term.reduceRight(
    (tail, item) => ['pair', encode(item, variables), tail],
    ['atom', 'nil'],
  );
};
const directRequest = ['meta-match', ['atom', 'same'], ['atom', 'same'], ['no-bindings']];
const selfRequest = ['meta-apply', ['rewrite',
  encode(['meta-match', ['atom', '?value'], ['atom', '?value'], '?bindings'], true),
  encode(['match-ok', '?bindings'], true),
], encode(directRequest)];

function run(text, request) {
  const programs = LinkedProgramRegistry.fromRml(text);
  const result = programs.reduce('links-meta-foundation', request);
  return {
    term: result.term,
    rules: [...new Set(result.trace.map(step => step.rule))],
    operations: programs.runtimeSemanticTrace().observedOperations,
  };
}

for (const [mechanism, [rule, body]] of Object.entries(replacements)) {
  const before = run(source, requests[mechanism]);
  const after = run(replaceRule(source, rule, body), requests[mechanism]);
  console.log(`${mechanism} (${rule})`);
  console.log(`  D : ${JSON.stringify(before.term)}`);
  console.log(`  D': ${JSON.stringify(after.term)}`);
  console.log(`  D' fired ${rule}: ${after.rules.includes(rule)}`);
  console.log(`  host operations D=${JSON.stringify(before.operations)} D'=${JSON.stringify(after.operations)}`);
}

const primeSubstitution = replaceRule(source, ...replacements.substitution);
for (const [label, text] of [['D', source], ["D'", primeSubstitution]]) {
  const direct = run(text, directRequest);
  const self = run(text, selfRequest);
  console.log(`self-interpretation under ${label}`);
  console.log(`  direct: ${JSON.stringify(direct.term)}`);
  console.log(`  self  : ${JSON.stringify(self.term)}`);
  console.log(`  agrees with direct: ${JSON.stringify(self.term) === JSON.stringify(['rewrite-result', encode(direct.term)])}`);
}
