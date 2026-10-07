import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  analyzeProgram, constructProgram, ProgramRepresentation, translateProgram,
  decodeProgramTranslation, languageSupport, TranslationSupport,
  META_LANGUAGE_SOURCE_REVISION,
} from '../src/rml-upstream-language.mjs';
import { verifyMetaLanguageSource } from '../../scripts/verify-meta-language-source.mjs';

const corpus = JSON.parse(readFileSync(new URL('../../test-corpus/upstream-meta-language/four-language-conformance.json', import.meta.url)));
const translations = JSON.parse(readFileSync(new URL('../../test-corpus/upstream-meta-language/translation-programs.json', import.meta.url)));

test('installed upstream files and both dependency locks match the official source pin', () => {
  const result = verifyMetaLanguageSource();
  assert.equal(result.revision, META_LANGUAGE_SOURCE_REVISION);
  assert.equal(result.verifiedFiles, 235);
});

for (const fixture of corpus.languages) test(`upstream grammar, aliases, bindings and snapshots: ${fixture.name}`, () => {
  for (const language of [fixture.name, ...fixture.aliases]) {
    const program = analyzeProgram(fixture.source, language);
    assert.equal(program.network.verifyFullMatch().isClean(), true);
    assert.equal(program.emit(), fixture.source);
    assert.ok(program.sourceMappings.some(({ term }) => term === fixture.root));
    assert.ok(program.sourceMappings.length > 3);
    assert.ok(program.bindings.length > 0);
    const snapshot = JSON.parse(program.serializeSnapshot());
    assert.equal(Object.hasOwn(snapshot, 'source'), false);
    assert.equal(ProgramRepresentation.fromSnapshot(snapshot).emit(), fixture.source);
    assert.equal(languageSupport(language).typeElaboration, 'unavailable');
  }
});

for (const fixture of corpus.negativeCases) test(`upstream retains malformed syntax with diagnostics: ${fixture.language}`, () => {
  const program = analyzeProgram(fixture.source, fixture.language);
  assert.equal(program.emit(), fixture.source);
  assert.equal(program.network.verifyFullMatch().isClean(), false);
  assert.ok(program.diagnostics.length > 0);
  assert.throws(() => constructProgram(fixture.source, fixture.language), /parse cleanly/u);
});

for (const fixture of corpus.semanticPrograms) test(`upstream project and construct facts retain unavailable elaboration: ${fixture.language}`, () => {
  const program = analyzeProgram(fixture.source, fixture.language, fixture.project);
  assert.equal(program.emit(), fixture.source);
  assert.equal(program.diagnostics.length, 0);
  for (const kind of fixture.represented) {
    const fact = program.constructs.find(item => item.kind === kind);
    assert.equal(fact?.status, 'represented', kind);
    assert.ok(fact.evidence.length > 0, kind);
  }
  for (const kind of fixture.unavailable) assert.equal(program.constructs.find(item => item.kind === kind)?.status, 'unavailable', kind);
});

test('upstream binding edits preserve shadowing, literals and properties and reject capture', () => {
  for (const fixture of [...corpus.renameCases, ...corpus.bindingRenameCorpus]) {
    const program = analyzeProgram(fixture.source, fixture.language);
    const binding = program.bindings.filter(item => item.name === fixture.binding)[fixture.declarationOccurrence];
    assert.ok(binding, fixture.source);
    if (fixture.allowed === false) {
      assert.throws(() => program.renameBinding(binding.id, fixture.replacement));
      continue;
    }
    const renamed = program.renameBinding(binding.id, fixture.replacement);
    assert.equal(renamed.emit(), fixture.expected);
    if (fixture.capture) assert.throws(() => program.renameBinding(binding.id, fixture.capture), /capture|conflict/u);
    if (fixture.expectedObservation) {
      const context = {};
      runInNewContext(renamed.emit(), context);
      assert.deepEqual(JSON.parse(JSON.stringify(context.result)), fixture.expectedObservation);
    }
  }
});

test('upstream structured construction, query, replace, insert, delete, clone and move cover four languages', () => {
  for (const fixture of corpus.transformationPrograms) {
    const program = constructProgram(fixture.source, fixture.language);
    const first = { start: 0, end: fixture.first.length };
    const second = { start: fixture.first.length, end: fixture.source.length };
    assert.ok(program.querySyntax('identifier').length >= 2);
    assert.equal(program.replace(first, fixture.inserted).emit(), fixture.inserted + fixture.second);
    assert.equal(program.insert(second.end, fixture.inserted).emit(), fixture.source + fixture.inserted);
    assert.equal(program.delete(second).emit(), fixture.first);
    assert.equal(program.clone(first, second.end).emit(), fixture.source + fixture.first);
    assert.equal(program.move(second, 0).emit(), fixture.second + fixture.first);
    assert.throws(() => program.move(first, 1), /inside/u);
  }
});

test('upstream all twelve directed translations return semantic contracts for the shared output program', () => {
  let paths = 0;
  for (const [sourceLanguage, source] of Object.entries(translations.sources)) for (const targetLanguage of Object.keys(translations.sources)) {
    if (sourceLanguage === targetLanguage) continue;
    const translated = translateProgram(source, sourceLanguage, targetLanguage);
    assert.equal(translated.contract.support, TranslationSupport.SemanticTranslation, `${sourceLanguage} to ${targetLanguage}`);
    assert.ok(translated.semantics);
    assert.equal(translated.diagnostic, null);
    assert.ok(translated.code.length > 0);
    assert.equal(translated.semantics.provenance.sourceLanguage, sourceLanguage);
    paths += 1;
  }
  assert.equal(paths, 12);
});

test('upstream unsupported translation stays a reversible source envelope with no semantic claim', () => {
  for (const target of ['Rust', 'Lean', 'Rocq']) {
    const result = translateProgram(translations.unsupported, 'JavaScript', target);
    assert.equal(result.semantics, null);
    assert.ok(result.diagnostic);
    assert.equal(result.contract.support, TranslationSupport.PortableEncoding);
    assert.equal(decodeProgramTranslation(result.code, target).source, translations.unsupported);
  }
});

for (const fixture of corpus.projectPrograms) test(`upstream multi-file resolution and missing-context diagnostics: ${fixture.language}`, () => {
  const source = fixture.sources.find(file => file.path === fixture.entry).source;
  const analyze = sources => analyzeProgram(source, fixture.language, {
    root: fixture.root, entry: fixture.entry, sources,
    files: sources.map(file => file.path), dependencies: fixture.dependencies,
  });
  const program = analyze(fixture.sources);
  assert.equal(program.diagnostics.length, 0);
  assert.deepEqual(program.projectModules.map(({ request, module, start, end }) => ({ request, module, text: source.slice(start, end) })), fixture.modules);
  assert.ok(program.projectReferences.length > 0);
  for (const [kind, expected] of Object.entries(fixture.constructs)) {
    const construct = program.constructs.find(item => item.kind === kind);
    assert.equal(construct.status, 'represented', kind);
    const observed = construct.evidence.filter(item => item.file !== undefined).map(({ kind, name, file, start, end }) => ({ kind, name, file, text: fixture.sources.find(item => item.path === file).source.slice(start, end) }));
    assert.deepEqual(observed, expected, kind);
  }
  const missing = analyze([]);
  assert.ok(missing.diagnostics.length > 0);
  assert.deepEqual(missing.projectModules, []);
  assert.deepEqual(missing.projectReferences, []);
  assert.deepEqual(missing.expansions, []);
});
