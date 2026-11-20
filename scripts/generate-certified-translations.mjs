#!/usr/bin/env node
// Bulk certified translation of the shared corpus. Without arguments it writes
// every intermediate, target, certificate, refusal receipt and the producer
// receipt under test-corpus/certified-translation/generated. With --check it
// regenerates in memory and rejects stale, missing or unexpected files without
// writing anything. Regeneration runs JavaScript only: no compiler, kernel,
// network request or package installation is involved.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CERTIFIED_EXTENSIONS, CERTIFIED_LANGUAGES, TRANSLATION_RECEIPT_SCHEMA,
  importCertifiedSource, serializeLinks, translateCertified, vendoredTranslatorIdentity, verifyVendoredMetaLanguage,
} from '../js/src/rml-certified-translation.mjs';
import { certifiedConceptSpace, conceptSpaceJson, conceptSpaceNetwork } from '../js/src/rml-concept-space.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const CORPUS_DIRECTORY = join(root, 'test-corpus/certified-translation');
export const GENERATED_DIRECTORY = join(CORPUS_DIRECTORY, 'generated');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const implementation = ['js/src/rml-certified-translation.mjs', 'js/src/rml-surface-lowering.mjs', 'js/src/rml-concept-space.mjs',
  'scripts/generate-certified-translations.mjs', 'js/vendor/meta-language-pr201/upstream-files.json'];

export function readCertifiedCorpus() {
  return JSON.parse(readFileSync(join(CORPUS_DIRECTORY, 'cases.json'), 'utf8'));
}

/** Build every generated artifact in memory: relative path -> exact text. */
export function buildCertifiedCorpus() {
  const vendored = verifyVendoredMetaLanguage();
  if (!vendored.ok) throw new Error(`Vendored meta-language files differ from their lock: ${JSON.stringify(vendored.mismatches)}`);
  const corpus = readCertifiedCorpus();
  const files = new Map();
  const inputs = []; const outputs = [];
  const add = (path, text, kind) => { files.set(path, text); outputs.push(['output', ['path', path], ['kind', kind], ['sha256', sha256(text)]]); };
  for (const item of corpus.translations) {
    const source = readFileSync(join(CORPUS_DIRECTORY, item.source), 'utf8');
    inputs.push(['input', ['path', item.source], ['language', item.language], ['sha256', sha256(source)], ['bytes', String(Buffer.byteLength(source))]]);
    const imported = importCertifiedSource(source, item.language);
    if (imported.status !== 'imported') throw new Error(`${item.name} unexpectedly refused: ${imported.diagnostic.message}`);
    let intermediate = null;
    for (const target of CERTIFIED_LANGUAGES) {
      if (target === item.language) continue;
      const result = translateCertified(source, item.language, target, { imported });
      if (result.status !== 'translated') throw new Error(`${item.name} to ${target} refused: ${result.diagnostic.message}`);
      intermediate ??= result.intermediate;
      const stem = `${item.name}/${target.toLowerCase()}`;
      add(`${stem}.${CERTIFIED_EXTENSIONS[target]}`, result.targetSource, 'target');
      add(`${stem}.certificate.lino`, result.certificate, 'certificate');
    }
    add(`${item.name}/intermediate.lino`, intermediate, 'intermediate');
  }
  for (const item of corpus.refusals) {
    const source = readFileSync(join(CORPUS_DIRECTORY, item.source), 'utf8');
    inputs.push(['input', ['path', item.source], ['language', item.language], ['sha256', sha256(source)], ['bytes', String(Buffer.byteLength(source))]]);
    const imported = importCertifiedSource(source, item.language);
    for (const target of CERTIFIED_LANGUAGES) {
      if (target === item.language) continue;
      const result = translateCertified(source, item.language, target, { imported });
      if (result.status !== 'refused') throw new Error(`${item.name} unexpectedly translated to ${target}`);
      add(`refusals/${item.name}.${target.toLowerCase()}.refusal.lino`, result.receipt, 'refusal');
    }
  }
  // The concept space every certificate's `concepts` section pins, as JSON (read by the Rust mirror)
  // and as the meta-language link network meta-language's own insertConceptRecord builds.
  const space = certifiedConceptSpace();
  add('concept-space.json', conceptSpaceJson(space), 'concept-space');
  add('concept-space.lino', conceptSpaceNetwork(space).toLino(), 'concept-network');
  const identity = vendoredTranslatorIdentity();
  const receipt = ['translation-producer-receipt', ['schema', TRANSLATION_RECEIPT_SCHEMA],
    ['translator', ['upstream', identity.upstream], ['commit', identity.commit], ['lock-sha256', identity.lockSha256]],
    ['implementation', ...implementation.map(path => ['file', path, sha256(readFileSync(join(root, path)))])],
    ['recipe', ['regenerate', 'node scripts/generate-certified-translations.mjs'], ['freshness', 'node scripts/generate-certified-translations.mjs --check'],
      ['native-oracles', 'node scripts/check-certified-translation-native.mjs --require=JavaScript,Rust,Lean,Rocq']],
    ['inputs', ...inputs], ['outputs', ...outputs],
    ['totals', ['translations', String(corpus.translations.length * 3)], ['refusals', String(corpus.refusals.length * 3)]],
    ['authority', ['macros', 'none'], ['traits', 'none'], ['runtime', 'none'], ['external-kernels', 'oracle-only']]];
  files.set('receipt.lino', `${serializeLinks(receipt)}\n`);
  return files;
}

function listFiles(directory, base = directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path, base) : [relative(base, path).split('\\').join('/')];
  });
}

/** Compare the regenerated corpus with the committed files. */
export function checkCertifiedCorpus(files = buildCertifiedCorpus()) {
  const stale = []; const missing = [];
  for (const [path, text] of files) {
    const absolute = join(GENERATED_DIRECTORY, path);
    if (!existsSync(absolute)) missing.push(path);
    else if (readFileSync(absolute, 'utf8') !== text) stale.push(path);
  }
  const unexpected = listFiles(GENERATED_DIRECTORY).filter(path => !files.has(path));
  return { ok: !stale.length && !missing.length && !unexpected.length, stale, missing, unexpected, files: files.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildCertifiedCorpus();
  if (process.argv.includes('--check')) {
    const report = checkCertifiedCorpus(files);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } else {
    rmSync(GENERATED_DIRECTORY, { recursive: true, force: true });
    for (const [path, text] of files) {
      const absolute = join(GENERATED_DIRECTORY, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, text);
    }
    console.log(`wrote ${files.size} files`);
  }
}
