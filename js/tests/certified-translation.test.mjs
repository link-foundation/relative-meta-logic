import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { LinkMetadata, LinkType, SubstitutionRule } from '#meta-language';
import {
  CERTIFIED_LANGUAGES, CERTIFIED_EXTENSIONS, PRESERVATION_DIMENSIONS,
  checkTranslationCertificate, checkTranslationRefusal, decodeCertifiedIntermediate, exportCertifiedIntermediate,
  importCertifiedIntermediate, importCertifiedSource, observeCertifiedProgram, readLinksDocument, serializeLinks,
  translateCertified, verifyVendoredMetaLanguage,
} from '../src/rml-certified-translation.mjs';
import { buildCertifiedCorpus, checkCertifiedCorpus, CORPUS_DIRECTORY, GENERATED_DIRECTORY, readCertifiedCorpus } from '../../scripts/generate-certified-translations.mjs';
import { emitJavaScript } from '#meta-language-pr201/translation/emit-javascript.js';
import { conceptOf, conceptSpaceSha256 } from '../src/rml-concept-space.mjs';

const corpus = readCertifiedCorpus();
const read = path => readFileSync(join(CORPUS_DIRECTORY, path), 'utf8');
const generated = path => readFileSync(join(GENERATED_DIRECTORY, path), 'utf8');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const targets = language => CERTIFIED_LANGUAGES.filter(target => target !== language);
const stem = (name, target) => `${name}/${target.toLowerCase()}`;

function runJavaScriptTarget(code) {
  const lines = [];
  vm.runInNewContext(code, { console: { log: (...values) => lines.push(values.map(String).join(' ')) }, process: { argv: [] } }, { timeout: 5000 });
  return lines;
}

/** Re-serialize an edited certificate and give it a valid digest, as a forger would. */
function reDigest(form) {
  const body = form.filter(item => !(Array.isArray(item) && item[0] === 'digest'));
  return serializeLinks([...body, ['digest', 'sha256', sha256(serializeLinks(body))]]);
}
function editCertificate(text, edit) {
  const [form] = readLinksDocument(text);
  edit(form);
  return reDigest(form);
}
const sectionOf = (form, name) => form.find(item => Array.isArray(item) && item[0] === name);
const codes = report => report.errors.map(error => error.code);

describe('vendored meta-language PR #201 code', () => {
  it('every vendored file matches the pinned upstream lock', () => {
    const report = verifyVendoredMetaLanguage();
    assert.equal(report.ok, true, JSON.stringify(report.mismatches));
    assert.equal(report.commit, '7c4bf8f1e3f88806b09d5210643cc6611d30d1f9');
    assert.ok(report.checked >= 50);
    assert.deepEqual(report.shims, ['js/src/primitives.js']);
  });
  it('a tampered vendored file is reported against the lock', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rml-vendored-')));
    try {
      const source = new URL('../vendor/meta-language-pr201/', import.meta.url);
      cpSync(source, directory, { recursive: true });
      writeFileSync(join(directory, 'js/src/translation/check.js'), `${readFileSync(join(directory, 'js/src/translation/check.js'), 'utf8')}\n// tampered\n`);
      const report = verifyVendoredMetaLanguage({ root: pathToFileURL(`${directory}/`) });
      assert.equal(report.ok, false);
      assert.deepEqual(report.mismatches, [{ path: 'js/src/translation/check.js', reason: 'hash-mismatch' }]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('certified translation over all twelve directed paths', () => {
  const paths = new Set();
  for (const item of corpus.translations) for (const target of targets(item.language)) {
    paths.add(`${item.language}->${target}`);
    it(`${item.name}: ${item.language} → RML → ${target} is certified and checked`, () => {
      const source = read(item.source);
      const result = translateCertified(source, item.language, target);
      assert.equal(result.status, 'translated');
      assert.equal(result.preservedSource, source);
      assert.deepEqual(result.observation, { status: 'completed', lines: item.lines }, 'RML observation matches the hand-written expectation');
      assert.equal(result.targetSource, generated(`${stem(item.name, target)}.${CERTIFIED_EXTENSIONS[target]}`));
      assert.equal(result.certificate, generated(`${stem(item.name, target)}.certificate.lino`));
      const proof = result.obligations.filter(obligation => ['theorem', 'assertion'].includes(obligation.kind));
      assert.deepEqual({ discharged: proof.filter(o => o.status === 'discharged').length, open: proof.filter(o => o.status === 'open').length }, item.proofObligations);
      assert.ok(proof.filter(o => o.status === 'discharged').every(o => o.by === 'rml-evaluation' && o.closed === 'true'));
      assert.ok(result.obligations.some(o => o.id === 'emitter-faithfulness' && o.status === 'open'));
      const report = checkTranslationCertificate(result.certificate, { source, target: result.targetSource });
      assert.deepEqual(report.errors, []);
      assert.equal(report.valid, true);
      const [form] = readLinksDocument(result.certificate);
      assert.deepEqual(sectionOf(form, 'preservation').slice(1).map(entry => entry[0]), PRESERVATION_DIMENSIONS);
      if (target === 'JavaScript') assert.deepEqual(runJavaScriptTarget(result.targetSource), item.lines, 'the emitted JavaScript prints the expected lines');
    });
  }
  it('covers all twelve directed language pairs', () => {
    assert.equal(paths.size, 12);
  });
  it('Rocq targets never qualify a declaration with the module that is still open', () => {
    for (const name of ['lean-tree', 'rust-shapes']) {
      const text = read(`generated/${name}/rocq.v`);
      const open = [];
      for (const line of text.split('\n')) {
        const start = /^Module (\S+)\.$/.exec(line), end = /^End (\S+)\.$/.exec(line);
        if (start) open.push(start[1]); else if (end) open.pop();
        else for (const module of open) assert.doesNotMatch(line.replace(/"[^"]*"/g, ''), new RegExp(`(?<![\\w.])${module}\\.[A-Za-z_]`), `${name}: ${line}`);
      }
      assert.match(read(`generated/${name}/rocq.certificate.lino`), /rml-rocq-open-module-local-names/);
    }
  });
  it('JavaScript sources print the hand-written expectations natively (independent oracle)', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rml-certified-js-')));
    try {
      for (const item of corpus.translations.filter(entry => entry.language === 'JavaScript')) {
        const file = join(directory, `${item.name}.mjs`);
        writeFileSync(file, read(item.source));
        const run = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20000 });
        assert.equal(run.status, 0, run.stderr);
        assert.deepEqual(run.stdout.trimEnd().split('\n'), item.lines);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('source-free structured RML import and export', () => {
  for (const item of corpus.translations) it(`${item.name}: the committed Links archive regenerates every target without source`, () => {
    const lino = generated(`${item.name}/intermediate.lino`);
    assert.ok(!lino.includes(read(item.source)), 'the archive embeds no source envelope');
    const firstComment = read(item.source).split('\n')[0];
    assert.ok(!lino.includes(encodeURIComponent(firstComment)) && !lino.includes(firstComment), 'source comments are not carried');
    const network = importCertifiedIntermediate(lino);
    assert.equal(exportCertifiedIntermediate(network), lino);
    const imported = importCertifiedSource(read(item.source), item.language);
    const program = decodeCertifiedIntermediate(network, imported.root);
    assert.equal(program.sourceLanguage, item.language);
    assert.deepEqual(observeCertifiedProgram(program).lines, item.lines);
    if (item.language !== 'JavaScript') assert.equal(emitJavaScript(program).text, generated(`${stem(item.name, 'JavaScript')}.js`));
  });

  it('a Links-network substitution changes RML observation and emitted code without consulting source', () => {
    const imported = importCertifiedSource(read('sources/lean-tree.lean'), 'Lean');
    const network = imported.rmlNetwork;
    const reference = (term) => network.links().filter(link => link.metadata().linkType === LinkType.Syntax
      && link.metadata().definition === 'rml:structure:1:reference' && link.metadata().term === term);
    const parentOf = id => network.links().find(link => link.references().some(child => Number(child) === Number(id)));
    // `(def: 21)` is a structure link whose term is `def` and whose single reference is `21`.
    const old = reference('21').find(link => parentOf(link.id())?.metadata().term === 'def');
    assert.ok(old, 'found the literal 21 in the RML structure');
    const parent = parentOf(old.id());
    const replacement = network.insertLink([], LinkMetadata.new().withLinkType(LinkType.Syntax).withLanguage('RML').withDefinition('rml:structure:1:reference').withTerm('50'));
    network.applySubstitution(new SubstitutionRule(parent.references(), parent.references().map(id => Number(id) === Number(old.id()) ? replacement : id)));
    const program = decodeCertifiedIntermediate(network, imported.root);
    assert.deepEqual(observeCertifiedProgram(program).lines, ['9', '2', '100']);
    assert.deepEqual(runJavaScriptTarget(emitJavaScript(program).text), ['9', '2', '100']);
    const certificate = generated(`${stem('lean-tree', 'Rust')}.certificate.lino`);
    const [form] = readLinksDocument(certificate);
    assert.notEqual(sectionOf(sectionOf(form, 'intermediate'), 'sha256')?.[1], sha256(exportCertifiedIntermediate(network)), 'the edited network is not the certified one');
  });
});

describe('RML certificate checker rejects forged, stale and mismatched certificates', () => {
  const item = corpus.translations.find(entry => entry.name === 'lean-list');
  const source = read(item.source);
  const certificate = generated(`${stem(item.name, 'Rust')}.certificate.lino`);
  const target = generated(`${stem(item.name, 'Rust')}.rs`);

  it('accepts the committed certificate', () => {
    assert.equal(checkTranslationCertificate(certificate, { source, target }).valid, true);
  });
  it('rejects a body edit that keeps the old digest', () => {
    const forged = certificate.replace('(status open)', '(status discharged)');
    assert.notEqual(forged, certificate);
    assert.ok(codes(checkTranslationCertificate(forged, { source, target })).includes('RML_CERT_DIGEST'));
  });
  it('rejects a forged discharge of an open universal theorem even with a valid digest', () => {
    const forged = editCertificate(certificate, form => {
      const obligation = sectionOf(form, 'obligations').find(entry => Array.isArray(entry) && sectionOf(entry, 'id')?.[1] === 'theorem:add_zero_right');
      sectionOf(obligation, 'status')[1] = 'discharged';
      sectionOf(obligation, 'by')[1] = 'rml-evaluation';
    });
    const report = checkTranslationCertificate(forged, { source, target });
    assert.equal(report.valid, false);
    assert.ok(codes(report).includes('RML_CERT_OBLIGATION_FORGED'));
    assert.ok(!codes(report).includes('RML_CERT_DIGEST'));
  });
  it('rejects a kernel acceptance relabelled as an RML discharge of the trust obligation', () => {
    const forged = editCertificate(certificate, form => {
      const obligation = sectionOf(form, 'obligations').find(entry => Array.isArray(entry) && sectionOf(entry, 'id')?.[1] === 'emitter-faithfulness');
      sectionOf(obligation, 'status')[1] = 'discharged';
    });
    assert.ok(codes(checkTranslationCertificate(forged, { source, target })).includes('RML_CERT_OBLIGATION_FORGED'));
  });
  it('rejects a dropped obligation', () => {
    const forged = editCertificate(certificate, form => {
      const obligations = sectionOf(form, 'obligations');
      const index = obligations.findIndex(entry => Array.isArray(entry) && sectionOf(entry, 'id')?.[1] === 'theorem:add_zero_right');
      obligations.splice(index, 1);
    });
    assert.ok(codes(checkTranslationCertificate(forged, { source, target })).includes('RML_CERT_OBLIGATION_DROPPED'));
  });
  it('rejects a stale certificate after the source changes', () => {
    const changed = source.replace('NatList.cons 10', 'NatList.cons 11');
    const report = checkTranslationCertificate(certificate, { source: changed });
    assert.ok(codes(report).includes('RML_CERT_SOURCE_HASH'));
    assert.ok(codes(report).includes('RML_CERT_OBSERVATION'), 'the re-derived observation differs (43 instead of 42)');
  });
  it('rejects a certificate paired with a different target', () => {
    const other = generated(`${stem('lean-tree', 'Rust')}.rs`);
    assert.ok(codes(checkTranslationCertificate(certificate, { source, target: other })).includes('RML_CERT_TARGET_HASH'));
  });
  it('rejects a certificate for a different source program (mismatch)', () => {
    const other = read('sources/lean-tree.lean');
    const report = checkTranslationCertificate(certificate, { source: other, target });
    assert.ok(codes(report).includes('RML_CERT_SOURCE_HASH'));
    assert.ok(codes(report).includes('RML_CERT_CORRESPONDENCE'));
  });
  it('rejects a relabelled source language', () => {
    const forged = editCertificate(certificate, form => { sectionOf(sectionOf(form, 'source'), 'language')[1] = 'Rocq'; });
    assert.ok(codes(checkTranslationCertificate(forged, { source, target })).includes('RML_CERT_SOURCE_LANGUAGE'));
  });
  it('rejects a relabelled target language', () => {
    const forged = editCertificate(certificate, form => { sectionOf(sectionOf(form, 'target'), 'language')[1] = 'JavaScript'; });
    const report = checkTranslationCertificate(forged, { source, target });
    assert.equal(report.valid, false);
    assert.ok(codes(report).includes('RML_CERT_TARGET_REGENERATION'));
  });
  it('rejects implicit authority grants', () => {
    const forged = editCertificate(certificate, form => { sectionOf(sectionOf(form, 'authority'), 'traits')[1] = 'granted'; });
    assert.ok(codes(checkTranslationCertificate(forged, { source, target })).includes('RML_CERT_AUTHORITY'));
  });
  it('rejects a stale translator pin', () => {
    const forged = editCertificate(certificate, form => { sectionOf(sectionOf(form, 'translator'), 'lock-sha256')[1] = '0'.repeat(64); });
    assert.ok(codes(checkTranslationCertificate(forged, { source, target })).includes('RML_CERT_TRANSLATOR'));
  });
  it('rejects forged observations, correspondences and weakened preservation contracts', () => {
    const observation = editCertificate(certificate, form => { sectionOf(form, 'observation').find(entry => Array.isArray(entry) && entry[0] === 'line')[1] = '4'; });
    assert.ok(codes(checkTranslationCertificate(observation, { source, target })).includes('RML_CERT_OBSERVATION'));
    const correspondence = editCertificate(certificate, form => { sectionOf(sectionOf(form, 'correspondence').at(-1), 'target')[1] = 'renamed'; });
    assert.ok(codes(checkTranslationCertificate(correspondence, { source, target })).includes('RML_CERT_CORRESPONDENCE'));
    const weakened = editCertificate(certificate, form => { const preservation = sectionOf(form, 'preservation'); preservation.splice(preservation.findIndex(entry => entry[0] === 'ownership'), 1); });
    assert.ok(codes(checkTranslationCertificate(weakened, { source, target })).includes('RML_CERT_PRESERVATION'));
    const losses = editCertificate(certificate, form => { const section = sectionOf(form, 'losses'); section.splice(1, 1); });
    assert.ok(codes(checkTranslationCertificate(losses, { source, target })).includes('RML_CERT_LOSSES'));
  });
  it('rejects non-certificates', () => {
    assert.ok(codes(checkTranslationCertificate('(not a certificate)', { source })).includes('RML_CERT_SCHEMA'));
    assert.ok(codes(checkTranslationCertificate('(unclosed', { source })).includes('RML_CERT_SYNTAX'));
  });
});

describe('first-refusal receipts keep the source and name every loss', () => {
  for (const item of corpus.refusals) it(`${item.name}: refuses at ${item.stage} for every target`, () => {
    const source = read(item.source);
    for (const target of targets(item.language)) {
      const result = translateCertified(source, item.language, target);
      assert.equal(result.status, 'refused');
      assert.equal(result.targetSource, null);
      assert.equal(result.preservedSource, source);
      assert.equal(result.stage, item.stage);
      assert.equal(result.diagnostic.kind, item.kind);
      if (item.stage === 'rml-lowering') assert.ok(result.diagnostic.message.startsWith(`${item.construct}:`), result.diagnostic.message);
      if (result.diagnostic.span) {
        assert.equal(sha256(source.slice(result.diagnostic.span.start, result.diagnostic.span.end)), result.diagnostic.span.sha256);
        assert.equal(Buffer.byteLength(source.slice(0, result.diagnostic.span.start)), result.diagnostic.span.byteStart);
      }
      const receipt = generated(`refusals/${item.name}.${target.toLowerCase()}.refusal.lino`);
      assert.equal(result.receipt, receipt);
      assert.deepEqual(checkTranslationRefusal(receipt, { source }), { valid: true, errors: [] });
      const [form] = readLinksDocument(receipt);
      assert.equal(sectionOf(sectionOf(form, 'preserved-source'), 'sha256')[1], sha256(source));
      assert.equal(sectionOf(sectionOf(form, 'losses'), 'whole-program')[0], 'whole-program');
    }
  });
  it('a refusal receipt is stale once the source translates, and tampering is detected', () => {
    const receipt = generated('refusals/rust-generic-function.javascript.refusal.lino');
    const fixed = 'fn ident(x: i64) -> i64 { x }\nfn main() { println!("{}", ident(3)); }\n';
    assert.deepEqual(codes(checkTranslationRefusal(receipt, { source: fixed })), ['RML_REFUSAL_NOT_REFUSED']);
    const tampered = receipt.replace('generic call', 'generic fn');
    assert.deepEqual(codes(checkTranslationRefusal(tampered, { source: read('refusals/rust-generic-function.rs') })), ['RML_REFUSAL_MISMATCH']);
  });
});

describe('RML-native evaluation semantics', () => {
  it('checked Rust overflow aborts the observation instead of wrapping', () => {
    const result = translateCertified('fn grow(x: i64) -> i64 { x * 4611686018427387904 }\nfn main() { println!("{}", grow(1)); println!("{}", grow(4)); }\n', 'Rust', 'Lean');
    assert.equal(result.status, 'translated');
    assert.deepEqual(result.observation, { status: 'aborted', lines: ['4611686018427387904'], reason: 'integer overflow' });
  });
  it('natural subtraction truncates and Lean division by zero is total', () => {
    const result = translateCertified('def f (a : Nat) (b : Nat) : Nat := a - b + a / 0\n\ndef main : IO Unit := do\n  IO.println (f 3 5)\n', 'Lean', 'Rust');
    assert.deepEqual(result.observation, { status: 'completed', lines: ['0'] });
  });
  it('a false closed theorem is refuted by RML evaluation, never discharged', () => {
    const result = translateCertified('def double (n : Nat) : Nat := n + n\n\ntheorem bad : double 2 = 5 := by decide\n\ndef main : IO Unit := do\n  IO.println (double 2)\n', 'Lean', 'Rocq');
    assert.equal(result.status, 'translated');
    const obligation = result.obligations.find(item => item.id === 'theorem:bad');
    assert.deepEqual([obligation.status, obligation.by], ['refuted', 'rml-evaluation']);
  });
});

describe('surface lowering and termination evidence are certified', () => {
  const lowered = ['rust-records', 'rust-generic', 'lean-structure', 'rocq-record'];
  it('every lowered certificate lists its rewrites with exact original spans; others carry no lowering section', () => {
    for (const item of corpus.translations) for (const target of targets(item.language)) {
      const [form] = readLinksDocument(generated(`${stem(item.name, target)}.certificate.lino`));
      const lowering = sectionOf(form, 'lowering');
      if (!lowered.includes(item.name)) { assert.equal(lowering, undefined, item.name); continue; }
      const source = read(item.source);
      assert.equal(sectionOf(lowering, 'schema')[1], 'rml:surface-lowering:1');
      const rewrites = lowering.filter(entry => Array.isArray(entry) && entry[0] === 'rewrite');
      assert.equal(sectionOf(lowering, 'count')[1], String(rewrites.length));
      for (const rewrite of rewrites) {
        const [, start, end] = sectionOf(rewrite, 'span');
        assert.equal(sha256(source.slice(Number(start), Number(end))), sectionOf(rewrite, 'span-sha256')[1]);
      }
    }
  });
  it('rejects a forged, hidden or dropped lowering section', () => {
    const source = read('sources/rust-records.rs');
    const certificate = generated('rust-records/lean.certificate.lino');
    const renamed = editCertificate(certificate, form => { sectionOf(sectionOf(form, 'lowering'), 'rewrite')[1][1] = 'rust-macro-expansion'; });
    assert.ok(codes(checkTranslationCertificate(renamed, { source })).includes('RML_CERT_LOWERING'));
    const dropped = editCertificate(certificate, form => { form.splice(form.indexOf(sectionOf(form, 'lowering')), 1); });
    assert.ok(codes(checkTranslationCertificate(dropped, { source })).includes('RML_CERT_LOWERING'));
    const plain = generated('lean-list/rust.certificate.lino');
    const invented = editCertificate(plain, form => { form.splice(4, 0, ['lowering', ['schema', 'rml:surface-lowering:1'], ['count', '0']]); });
    assert.ok(codes(checkTranslationCertificate(invented, { source: read('sources/lean-list.lean') })).includes('RML_CERT_LOWERING'));
  });
  it('the certified observation of a lowered program is the hand-written native output, and its correspondence spans are original', () => {
    const source = read('sources/rust-records.rs');
    const result = translateCertified(source, 'Rust', 'JavaScript');
    assert.deepEqual(runJavaScriptTarget(result.targetSource), ['7', '3', '2', '30', '12', '7']);
    const [form] = readLinksDocument(result.certificate);
    const manhattan = sectionOf(form, 'correspondence').find(entry => Array.isArray(entry) && sectionOf(entry, 'source')?.[1] === 'manhattan');
    const [, start, end] = sectionOf(manhattan, 'span');
    assert.match(source.slice(Number(start), Number(end)), /^fn manhattan\(point: Point\) -> i64/u);
  });
  it('a refusal inside lowered code points at the original source', () => {
    const source = 'struct P {\n    a: i64,\n}\n\nfn main() {\n    let p = P { a: 1 };\n    println!("{}", p.a + true);\n}\n';
    const result = translateCertified(source, 'Rust', 'Lean');
    assert.equal(result.status, 'refused');
    assert.notEqual(result.stage, 'rml-lowering');
    const { start, end } = result.diagnostic.span;
    assert.ok(start >= source.indexOf('println') && end <= source.length, `${start}..${end}`);
  });
  it('structural recursion is discharged by RML; general and mutual recursion stay open', () => {
    const lean = translateCertified(read('sources/lean-list.lean'), 'Lean', 'Rust');
    assert.deepEqual(lean.obligations.filter(item => item.kind === 'termination').map(item => [item.id, item.status, item.by, item.target]), [
      ['termination:length', 'discharged', 'rml-structural-decrease', 'structural:ml_arg0'],
      ['termination:total', 'discharged', 'rml-structural-decrease', 'structural:ml_arg0'],
      ['termination:append', 'discharged', 'rml-structural-decrease', 'structural:left'],
    ]);
    const fold = translateCertified(read('sources/rust-fold.rs'), 'Rust', 'Lean');
    assert.deepEqual(fold.obligations.filter(item => item.kind === 'termination').map(item => [item.id, item.status, item.by]), [
      ['termination:gcd', 'open', 'unproved-general-recursion'],
      ['termination:triangle', 'open', 'unproved-general-recursion'],
    ]);
    const mutual = translateCertified('fn even(n: i64) -> bool {\n    if n == 0 { true } else { odd(n - 1) }\n}\n\nfn odd(n: i64) -> bool {\n    if n == 0 { false } else { even(n - 1) }\n}\n\nfn main() {\n    println!("{}", even(10));\n}\n', 'Rust', 'JavaScript');
    assert.equal(mutual.status, 'translated');
    assert.deepEqual(mutual.obligations.filter(item => item.kind === 'termination').map(item => [item.id, item.status, item.target]), [
      ['termination:even', 'open', 'mutual-recursion'],
      ['termination:odd', 'open', 'mutual-recursion'],
    ]);
  });
  it('rejects a termination obligation promoted to a structural discharge RML did not derive', () => {
    const source = read('sources/rust-fold.rs');
    const certificate = generated('rust-fold/lean.certificate.lino');
    const forged = editCertificate(certificate, form => {
      const obligation = sectionOf(form, 'obligations').find(entry => Array.isArray(entry) && sectionOf(entry, 'id')?.[1] === 'termination:gcd');
      sectionOf(obligation, 'status')[1] = 'discharged';
      sectionOf(obligation, 'by')[1] = 'rml-structural-decrease';
    });
    assert.ok(codes(checkTranslationCertificate(forged, { source })).includes('RML_CERT_OBLIGATION_FORGED'));
  });
});

describe('certificates bind their vocabulary to the shared concept space', () => {
  it('every certificate pins the concept space and binds exactly the terms it uses', () => {
    let upstream = 0;
    for (const item of corpus.translations) for (const target of targets(item.language)) {
      const [form] = readLinksDocument(generated(`${stem(item.name, target)}.certificate.lino`));
      const concepts = sectionOf(form, 'concepts');
      assert.equal(sectionOf(concepts, 'sha256')[1], conceptSpaceSha256(), item.name);
      assert.equal(sectionOf(concepts, 'sha256')[1], sha256(generated('concept-space.json')));
      const entries = concepts.filter(entry => Array.isArray(entry) && entry[0] === 'concept');
      assert.equal(sectionOf(concepts, 'count')[1], String(entries.length));
      const kinds = sectionOf(form, 'correspondence').filter(entry => Array.isArray(entry)).map(entry => sectionOf(entry, 'kind')[1]);
      const terms = category => entries.filter(entry => sectionOf(entry, 'category')[1] === category).map(entry => sectionOf(entry, 'term')[1]);
      assert.deepEqual(terms('construct-kind'), [...new Set(kinds)], `${item.name} ${target}`);
      assert.deepEqual(terms('preservation'), [...PRESERVATION_DIMENSIONS]);
      for (const entry of entries) {
        const bound = conceptOf(sectionOf(entry, 'category')[1], sectionOf(entry, 'term')[1]);
        assert.deepEqual([sectionOf(entry, 'id')[1], sectionOf(entry, 'origin')[1]], [bound.concept, bound.origin]);
        if (bound.origin === 'upstream') upstream += 1;
      }
    }
    assert.ok(upstream > 0, 'certificates reuse meta-language concepts');
  });
  it('rejects a near-miss, relabelled, dropped or missing concept binding', () => {
    const source = read('sources/rust-records.rs');
    const certificate = generated('rust-records/lean.certificate.lino');
    const entry = (form, category, term) => sectionOf(form, 'concepts')
      .find(item => Array.isArray(item) && item[0] === 'concept' && sectionOf(item, 'category')[1] === category && sectionOf(item, 'term')[1] === term);
    const nearMiss = editCertificate(certificate, form => { sectionOf(entry(form, 'construct-kind', 'function'), 'id')[1] = 'Function'; });
    assert.ok(codes(checkTranslationCertificate(nearMiss, { source })).includes('RML_CERT_CONCEPTS'));
    const relabelled = editCertificate(certificate, form => { sectionOf(entry(form, 'construct-kind', 'data'), 'origin')[1] = 'upstream'; });
    assert.ok(codes(checkTranslationCertificate(relabelled, { source })).includes('RML_CERT_CONCEPTS'));
    const dropped = editCertificate(certificate, form => {
      const concepts = sectionOf(form, 'concepts');
      concepts.splice(concepts.indexOf(entry(form, 'lowering', 'rust-struct')), 1);
    });
    assert.ok(codes(checkTranslationCertificate(dropped, { source })).includes('RML_CERT_CONCEPTS'));
    const missing = editCertificate(certificate, form => { form.splice(form.indexOf(sectionOf(form, 'concepts')), 1); });
    assert.ok(codes(checkTranslationCertificate(missing, { source })).includes('RML_CERT_CONCEPTS'));
    assert.deepEqual(codes(checkTranslationCertificate(certificate, { source })), []);
  });
});

describe('bulk freshness gate', () => {
  it('the committed generated corpus is fresh', () => {
    const report = checkCertifiedCorpus();
    assert.deepEqual({ stale: report.stale, missing: report.missing, unexpected: report.unexpected }, { stale: [], missing: [], unexpected: [] });
    assert.equal(report.files, 12 * 3 * 2 + 12 + 16 * 3 + 2 + 1);
  });
  it('detects stale and missing outputs', () => {
    const files = buildCertifiedCorpus();
    files.set('lean-tree/rust.rs', `${files.get('lean-tree/rust.rs')}// edited\n`);
    files.set('unexpected/new.lino', '()');
    const report = checkCertifiedCorpus(files);
    assert.equal(report.ok, false);
    assert.deepEqual(report.stale, ['lean-tree/rust.rs']);
    assert.deepEqual(report.missing, ['unexpected/new.lino']);
  });
  it('the producer receipt fingerprints every input and output', () => {
    const [receipt] = readLinksDocument(generated('receipt.lino'));
    const inputs = sectionOf(receipt, 'inputs').slice(1);
    assert.equal(inputs.length, corpus.translations.length + corpus.refusals.length);
    for (const input of inputs) assert.equal(sectionOf(input, 'sha256')[1], sha256(read(sectionOf(input, 'path')[1])));
    for (const output of sectionOf(receipt, 'outputs').slice(1)) assert.equal(sectionOf(output, 'sha256')[1], sha256(generated(sectionOf(output, 'path')[1])));
  });
});
