// Print the entry test-corpus/lino-frontend/cases.json would hold for each
// source, as the JavaScript front end reads it (issue #183). Run from the
// repository root with names and sources in pairs, each source a JSON string:
//
//   node experiments/lino-frontend/case-entry.mjs 'a comment on the last line' '"(a)\n# end"'
//
// Review each entry before adding it to the cases; both test suites then check
// that the other runtime reads the source the same way.
import { parseLinoDocument, prepareLinoSource } from '../../js/src/rml-lino-frontend.mjs';

const pairs = process.argv.slice(2);
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error('Usage: case-entry.mjs <name> <JSON source> [<name> <JSON source> ...]');
  process.exit(2);
}

// JSON with every character outside printable ASCII escaped, as in the cases.
function text(value) {
  return JSON.stringify(value).replace(
    /[\u{7f}-\u{10ffff}]/gu,
    character => character.split('').map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
  );
}

function errorOf(error) {
  return { message: error.message, line: error.line, col: error.col, length: error.length };
}

// The [line, column, text, value] of every reference that starts with a quote.
function quotesOf({ source, quotes }) {
  return quotes.map(({ start, end, value }) => {
    const before = source.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    return [before.split('\n').length, [...before.slice(lineStart)].length + 1, source.slice(start, end), value];
  });
}

function entry(name, source) {
  const lines = ['    {', `      "name": ${text(name)},`, `      "source": ${text(source)},`];
  try {
    const forms = parseLinoDocument(source);
    if (forms.length === 0) {
      lines.push('      "forms": [],');
    } else {
      lines.push('      "forms": [');
      lines.push(forms.map(form => `        ${text({ text: form.text, line: form.line, col: form.col, length: form.length })}`).join(',\n'));
      lines.push('      ],');
    }
  } catch (error) {
    lines.push(`      "error": ${text(errorOf(error))},`);
  }
  try {
    const prepared = prepareLinoSource(source);
    lines.push(`      "prepared": ${text(prepared.prepared)},`);
    lines.push(`      "lines": ${JSON.stringify(prepared.lines.map(line => [line.line, line.col]))},`);
    lines.push(`      "quotes": ${text(quotesOf(prepared))}`);
  } catch {
    // The prepare step fails with the error above, so the entry ends there.
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
  }
  lines.push('    }');
  return lines.join('\n');
}

const entries = [];
for (let index = 0; index < pairs.length; index += 2) {
  entries.push(entry(pairs[index], JSON.parse(pairs[index + 1])));
}
console.log(entries.join(',\n'));
