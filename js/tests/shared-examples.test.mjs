// Walks the repository-root /examples folder and runs every .lino file
// through the JavaScript implementation. Asserts the output matches the
// canonical fixtures in /examples/expected.lino (Links Notation).
//
// The Rust integration tests assert against the same fixtures file, so
// any drift between the two implementations fails both test suites.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { run, parseLino, tokenizeOne, parseOne, keyOf } from '../src/rml-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, '..', '..', 'examples');

// Parse expected.lino into a Map<filename, ExpectedValue[]>.
// Each link is shaped (filename.lino: <result> <result> ...) where a numeric
// result is a bare number and a type result is the link (type <Name>).
function loadExpected() {
  const text = readFileSync(join(examplesDir, 'expected.lino'), 'utf8');
  const map = new Map();
  for (const linkStr of parseLino(text)) {
    const ast = parseOne(tokenizeOne(linkStr));
    if (!Array.isArray(ast) || ast.length < 1 || typeof ast[0] !== 'string' || !ast[0].endsWith(':')) {
      throw new Error(`expected.lino: malformed entry ${linkStr}`);
    }
    const filename = ast[0].slice(0, -1);
    const values = ast.slice(1).map((node) => {
      // Type results are stored as `(type <link>)`. The `<link>` may be a
      // bare name (e.g. `Natural`) or a structured term (e.g.
      // `(succ (succ zero))` from `(? (normal-form ...))`); both serialize
      // back through `keyOf` so the test compares against the printed form.
      if (Array.isArray(node) && node.length === 2 && node[0] === 'type') {
        return { type: typeof node[1] === 'string' ? node[1] : keyOf(node[1]) };
      }
      if (typeof node === 'string' && /^-?(\d+(\.\d+)?|\.\d+)$/.test(node)) {
        return { num: parseFloat(node) };
      }
      throw new Error(`expected.lino: unsupported result ${JSON.stringify(node)} in ${filename}`);
    });
    map.set(filename, values);
  }
  return map;
}

const expected = loadExpected();

const lineFiles = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.lino') && f !== 'expected.lino')
  .sort();

describe('shared examples (root /examples folder)', () => {
  it('every .lino file is covered by expected.lino', () => {
    const missing = lineFiles.filter((f) => !expected.has(f));
    assert.deepStrictEqual(missing, [],
      `expected.lino is missing entries for: ${missing.join(', ')}`);
  });

  it('expected.lino has no orphan entries', () => {
    const onDisk = new Set(lineFiles);
    const orphans = [...expected.keys()].filter((f) => !onDisk.has(f));
    assert.deepStrictEqual(orphans, [],
      `expected.lino references missing files: ${orphans.join(', ')}`);
  });

  for (const file of lineFiles) {
    describe(file, () => {
      const text = readFileSync(join(examplesDir, file), 'utf8');
      const results = run(text);
      const expectedResults = expected.get(file);

      it('produces the expected number of results', () => {
        assert.strictEqual(results.length, expectedResults.length,
          `expected ${expectedResults.length} results, got ${results.length}`);
      });

      for (let i = 0; i < expectedResults.length; i++) {
        const exp = expectedResults[i];
        it(`result[${i}] matches expected`, () => {
          const actual = results[i];
          if ('type' in exp) {
            assert.strictEqual(typeof actual, 'string',
              `expected type result, got numeric ${actual}`);
            assert.strictEqual(actual, exp.type);
          } else {
            assert.strictEqual(typeof actual, 'number',
              `expected numeric result, got type ${actual}`);
            const diff = Math.abs(actual - exp.num);
            assert.ok(diff < 1e-9,
              `expected ${exp.num}, got ${actual} (diff ${diff})`);
          }
        });
      }
    });
  }
});
