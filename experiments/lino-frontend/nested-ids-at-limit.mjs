// Read indented ids nested as deep as the nesting limit allows, and one level
// deeper, with the JS front end (issue #183). Run from the repository root:
//
//   node experiments/lino-frontend/nested-ids-at-limit.mjs
import { MAX_LINO_NESTING_DEPTH, parseLinoDocument } from '../../js/src/rml-lino-frontend.mjs';

// `count` indented ids `a:`, each one space deeper than the one before it,
// and the value `b` one space deeper than the last of them.
function nestedIds(count) {
  const lines = Array.from({ length: count }, (_, level) => `${' '.repeat(level)}a:`);
  lines.push(`${' '.repeat(count)}b`);
  return lines.join('\n');
}

for (const count of [MAX_LINO_NESTING_DEPTH - 1, MAX_LINO_NESTING_DEPTH, MAX_LINO_NESTING_DEPTH + 1]) {
  try {
    const forms = parseLinoDocument(nestedIds(count));
    const text = forms.map(form => form.text).join(' ');
    console.log(`${count} ids: ${forms.length} form(s) at ${forms[0].line}:${forms[0].col}, ` +
      `${(text.match(/a:/g) || []).length} ids, ${text.length} characters, ends ${JSON.stringify(text.slice(-12))}`);
  } catch (error) {
    console.log(`${count} ids: ${error.message} at ${error.line}:${error.col} (length ${error.length})`);
  }
}
