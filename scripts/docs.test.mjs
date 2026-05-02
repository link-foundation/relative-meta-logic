// Documentation regression tests for issue #48.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('soundness documentation', () => {
  it('is linked from the README', () => {
    const readme = read('README.md');
    assert.match(readme, /\[Soundness statement\]\(\.\/docs\/SOUNDNESS\.md\)/);
  });

  it('cross-links the C2 proof-replay checker implementations', () => {
    const doc = read('docs/SOUNDNESS.md');
    for (const expected of [
      '../js/src/check.mjs',
      '../js/src/rml-check.mjs',
      '../rust/src/check.rs',
      '../rust/src/bin/rml-check.rs',
    ]) {
      assert.match(doc, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('states the trusted aggregator family for soundness claims', () => {
    const doc = read('docs/SOUNDNESS.md');
    for (const expected of [
      'Aggregator-Relative Soundness',
      '`avg`',
      '`min`',
      '`max`',
      '`product` / `prod`',
      '`probabilistic_sum` / `ps`',
    ]) {
      assert.ok(doc.includes(expected), `missing ${expected}`);
    }
  });
});
