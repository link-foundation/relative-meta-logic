// Probe the shared LiNo front end on edge cases (run from the repository root).
import { parseLinoDocument, prepareLinoSource } from '../../js/src/rml-lino-frontend.mjs';

const cases = [
  ['singlet', '(empty)'],
  ['empty group', '()'],
  ['empty group value', '(a ())'],
  ['quoting', '("a b" c)'],
  ['hash reference', '(x #)'],
  ['comment link', '(# note here)\n(a: a is a)'],
  ['line comment', '# full line\n(a)'],
  ['inline comment', '(a) # trailing'],
  ['hash in quote', '(say ") # not a comment")'],
  ['comment line in quote', '(note "first\n# kept\nlast")\n(b)'],
  ['apostrophe word', "(it's\n  x)\n(y's z)"],
  ['leading bom', '\ufeff(a)'],
  ['inner bom', '(a \ufeff b)'],
  ['nel', '(a \u0085 b)'],
  ['nbsp only', '\u00a0'],
  ['ls', '(a\u2028b)'],
  ['blank lines', '(a)\n\n\n(b)'],
  ['crlf', '(a)\r\n(b)\r\n'],
  ['lone cr', '(a)\r(b)'],
  ['indented id', 'x:\n  y\n  z'],
  ['grandchildren', 'x:\n  y:\n    z\n(w)'],
  ['regular children', '(a)\n  b'],
  ['several forms one line', '(a) (b)'],
  ['multi-line', '(a\n  b\n  c)\n(d)'],
  ['failure emoji', '(😀 a\n(b'],
  ['failure close', 'a)'],
  ['failure mid emoji', '(a) 😀)'],
  ['depth 12 ok', '('.repeat(12) + 'a' + ')'.repeat(12)],
  ['depth over', '('.repeat(65) + 'a' + ')'.repeat(65)],
  ['indent over', Array.from({ length: 66 }, (_, i) => ' '.repeat(i) + 'a').join('\n')],
  ['whitespace only', '  \n\t\n'],
  ['quoted multi-line', '("a\nb" c)\n(d)'],
  ['id value', '(a: b c)\nd: e'],
];

for (const [name, text] of cases) {
  let out;
  try {
    const started = Date.now();
    out = JSON.stringify(parseLinoDocument(text)) + ` ${Date.now() - started}ms`;
  } catch (error) {
    out = `THROW ${error.name} ${error.code} ${error.line}:${error.col}:${error.length} ${error.message}`;
  }
  console.log(`${name}: ${out}`);
}
const deep = '('.repeat(64) + 'a' + ')'.repeat(64);
console.log('depth 64 prepares:', prepareLinoSource(deep).lines.length);
console.log(JSON.stringify(prepareLinoSource('(a\n  b) # c\n# d\n(e)')));
