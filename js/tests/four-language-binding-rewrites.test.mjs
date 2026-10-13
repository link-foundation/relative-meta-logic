import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeProgram } from '../src/rml-upstream-language.mjs';

// Shared with rust/tests/four_language_binding_rewrites_tests.rs. Upstream ranges are UTF-16
// offsets here and UTF-8 byte offsets in Rust; the corpus stores the runtime-independent
// one-based line, Unicode code-point column and code-point length, with CRLF counted once.
const corpus = JSON.parse(readFileSync(
  new URL('../../test-corpus/meta-language/four-language-binding-rewrites.json', import.meta.url), 'utf8'));

const location = (source, { start, end }) => {
  const lines = source.slice(0, start).split(/\r\n|\r|\n/);
  return [lines.length, [...lines.at(-1)].length + 1, [...source.slice(start, end)].length];
};

const binding = (program, name, occurrence) => {
  const found = program.bindings.filter(item => item.name === name)[occurrence];
  assert.ok(found, `binding ${name}#${occurrence}`);
  return found;
};

describe('four-language grammar-backed binding rewrites', () => {
  it('covers JavaScript, Rust, Lean and Rocq with edits and capture refusals', () => {
    const languages = new Set(corpus.cases.map(item => item.language));
    assert.deepEqual([...languages].sort(), ['JavaScript', 'Lean', 'Rocq', 'Rust']);
    for (const language of languages) {
      const cases = corpus.cases.filter(item => item.language === language);
      assert.ok(cases.some(item => item.refused), `${language} capture refusal`);
      assert.ok(cases.some(item => !item.refused), `${language} accepted edit`);
    }
  });

  for (const item of corpus.cases) {
    it(`${item.language}: ${item.name}`, () => {
      const program = analyzeProgram(item.source, item.language);
      const found = binding(program, item.binding, item.declarationOccurrence);
      assert.equal(found.kind, item.kind);
      assert.deepEqual(location(item.source, found.declaration), item.declaration);
      assert.deepEqual(found.references.map(range => location(item.source, range)), item.references);
      if (item.refused) {
        assert.throws(() => program.renameBinding(found.id, item.to), /capture/);
        return;
      }
      const output = program.renameBinding(found.id, item.to).emit();
      assert.equal(output, item.expected);
      // The edit is checked again from the emitted text: a binding with the new name is
      // declared at the same line and column and keeps exactly as many references.
      const [line, column] = item.declaration;
      const renamed = analyzeProgram(output, item.language).bindings.filter(other => {
        const [otherLine, otherColumn] = location(output, other.declaration);
        return otherLine === line && otherColumn === column;
      });
      assert.equal(renamed.length, 1);
      assert.equal(renamed[0].name, item.to);
      assert.equal(location(output, renamed[0].declaration)[2], [...item.to].length);
      assert.equal(renamed[0].references.length, item.references.length);
    });
  }

  it('refuses invalid replacement names and unknown bindings in every language', () => {
    for (const item of corpus.cases.filter(entry => !entry.refused)) {
      const program = analyzeProgram(item.source, item.language);
      const found = binding(program, item.binding, item.declarationOccurrence);
      for (const name of corpus.invalidReplacements) {
        assert.throws(() => program.renameBinding(found.id, name), /not a valid/, `${item.name}: ${JSON.stringify(name)}`);
      }
      assert.throws(() => program.renameBinding(`${found.id}-forged`, item.to), /unknown binding/);
      assert.equal(program.renameBinding(found.id, item.binding).emit(), item.source);
    }
  });
});
