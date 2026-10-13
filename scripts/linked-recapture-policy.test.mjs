import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

// Source migration builds the Rust syntax helper, which contributors never compile
// locally; the hosted recapture workflow produces a reviewable patch instead.
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/linked-recapture.yml');

test('the hosted recapture workflow runs the source migration and uploads a reviewable patch', () => {
  assert.match(workflow, /branches: \['recapture\/\*\*'\]/);
  assert.match(workflow, /run: node scripts\/update-linked-implementation\.mjs/);
  assert.match(workflow, /git diff --cached --binary > \.rml-cache\/evidence\/recapture\/linked-recapture\.patch/);
  assert.match(workflow, /uses: actions\/upload-artifact@/);
  assert.match(read('docs/LINKED_IMPLEMENTATION.md'), /Contributors do not compile Rust locally/);
});

test('the hosted recapture workflow cannot commit, push or run on pull requests', () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /git (?:commit|push)\b/);
  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
});
