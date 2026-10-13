// Repository-scale certified translation (R165): the committed bulk receipt over js/src,
// rust/src and lib/ is fresh, preserves every original item, aggregates exactly, re-derives
// its refusal receipts, validates its certificates and records the hand-written mirrors.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CERTIFIED_EXTENSIONS, CERTIFIED_LANGUAGES, checkTranslationCertificate, checkTranslationRefusal, readLinksDocument, translateCertified,
} from '../src/rml-certified-translation.mjs';
import {
  BULK_DIRECTORY, BULK_SCOPE, MIRRORS_FILE, assembleItem, buildCertifiedBulk, bulkInputs, checkCertifiedBulk, extractItems,
} from '../../scripts/generate-certified-bulk.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sha256 = text => createHash('sha256').update(text).digest('hex');
const encoder = new TextEncoder();
const repository = path => readFileSync(join(root, path), 'utf8');
const bulk = path => readFileSync(join(BULK_DIRECTORY, path), 'utf8');
const document = path => {
  const forms = readLinksDocument(bulk(path));
  assert.equal(forms.length, 1, `${path} holds one form`);
  return forms[0];
};
const entry = (form, key) => form.find(item => Array.isArray(item) && item[0] === key);
const entries = (form, key) => form.filter(item => Array.isArray(item) && item[0] === key);
const value = (form, key) => entry(form, key)?.[1];
const targetsOf = language => CERTIFIED_LANGUAGES.filter(target => target !== language);

const receipt = document('receipt.lino');
const languages = entries(entry(receipt, 'languages'), 'language').map(form => form[1]);
const items = languages.flatMap(language => entries(document(`items-${language.toLowerCase()}.lino`), 'item').map(form => {
  const id = value(form, 'id');
  return { form, id, language, path: id.slice(0, id.indexOf('#')), status: value(form, 'status'), kind: value(form, 'kind'),
    span: entry(form, 'span').slice(1).map(Number), refusals: entries(form, 'refusal') };
}));

// The closure program of an item, re-assembled from the current repository file.
const extracted = new Map();
function programOf(item) {
  if (!extracted.has(item.path)) {
    const text = repository(item.path);
    extracted.set(item.path, { text, list: extractItems(text, item.language, item.path) });
  }
  const { text, list } = extracted.get(item.path);
  const found = list.find(candidate => candidate.start === item.span[0] && candidate.end === item.span[1]);
  assert.ok(found, `${item.id} is still an item of ${item.path}`);
  return assembleItem(text, list, found, item.language).program;
}

// The refusal of an item on one directed path, or undefined when that path translates.
function pathRefusal(item, target) {
  const shared = item.refusals.find(refusal => !entry(refusal, 'target'));
  return shared ?? item.refusals.find(refusal => value(refusal, 'target') === target);
}

describe('certified bulk translation of the repository (R165)', () => {
  let built;
  const build = () => (built ??= buildCertifiedBulk());

  it('regenerates the committed bulk receipt byte for byte (--check freshness gate)', { timeout: 600_000 }, () => {
    const report = checkCertifiedBulk(build().files);
    assert.deepEqual({ stale: report.stale, missing: report.missing, unexpected: report.unexpected }, { stale: [], missing: [], unexpected: [] });
    assert.ok(report.ok);
  });

  it('rejects stale, missing and unexpected bulk outputs', { timeout: 600_000 }, () => {
    const files = new Map(build().files);
    files.set('receipt.lino', `${files.get('receipt.lino')} `);
    files.set('items-zz.lino', '()\n');
    const dropped = [...files.keys()].find(path => path.startsWith('targets/'));
    files.delete(dropped);
    const report = checkCertifiedBulk(files);
    assert.equal(report.ok, false);
    assert.deepEqual(report.stale, ['receipt.lino']);
    assert.deepEqual(report.missing, ['items-zz.lino']);
    assert.deepEqual(report.unexpected, [dropped]);
  });

  it('fingerprints every in-scope repository file with the reconstruction recipe', () => {
    const inputs = entries(entry(receipt, 'inputs'), 'input');
    assert.deepEqual(inputs.map(form => value(form, 'path')), bulkInputs().map(input => input.path));
    for (const form of inputs) {
      const text = repository(value(form, 'path'));
      assert.equal(value(form, 'sha256'), sha256(text), value(form, 'path'));
      assert.equal(Number(value(form, 'bytes')), encoder.encode(text).length);
      assert.equal(Number(value(form, 'items')), items.filter(item => item.path === value(form, 'path')).length);
    }
    assert.deepEqual(entries(entry(receipt, 'scope'), 'root').map(form => form[1]), BULK_SCOPE.map(scope => scope.root));
    assert.equal(value(entry(receipt, 'recipe'), 'freshness'), 'node scripts/generate-certified-bulk.mjs --check');
    for (const form of entries(entry(receipt, 'implementation'), 'file')) assert.equal(form[2], sha256(readFileSync(join(root, form[1]))), form[1]);
    const outputs = entries(entry(receipt, 'outputs'), 'output');
    assert.ok(outputs.length > 0);
    for (const form of outputs) assert.equal(value(form, 'sha256'), sha256(bulk(value(form, 'path'))), value(form, 'path'));
  });

  it('preserves every original item and refusal site at its exact span and hash', () => {
    for (const item of items) {
      const text = repository(item.path);
      assert.equal(value(item.form, 'sha256'), sha256(text.slice(...item.span)), item.id);
      assert.deepEqual(entry(item.form, 'bytes').slice(1).map(Number), item.span.map(offset => encoder.encode(text.slice(0, offset)).length));
      assert.ok(['admitted', 'lowered', 'refused'].includes(item.status), item.id);
      for (const refusal of item.refusals) {
        const span = entry(refusal, 'span');
        if (span.length !== 3) continue;
        assert.equal(value(refusal, 'span-sha256'), sha256(text.slice(Number(span[1]), Number(span[2]))), item.id);
        assert.ok(value(refusal, 'site'), item.id);
      }
      if (item.status === 'refused') assert.ok(item.refusals.length > 0, item.id);
    }
  });

  it('aggregates totals, per-language and per-path counts and refusal causes exactly from the item records', () => {
    const count = predicate => items.filter(predicate).length;
    const totals = entry(receipt, 'totals');
    assert.equal(Number(value(totals, 'items')), items.length);
    for (const status of ['admitted', 'lowered', 'refused']) assert.equal(Number(value(totals, status)), count(item => item.status === status), status);
    const certified = items.filter(item => item.status === 'admitted').reduce((sum, item) => sum + entry(item.form, 'targets').length - 1, 0);
    assert.equal(Number(value(totals, 'certified-translations')), certified);
    for (const form of entries(entry(receipt, 'languages'), 'language')) {
      for (const status of ['admitted', 'lowered', 'refused']) {
        assert.equal(Number(value(form, status)), count(item => item.language === form[1] && item.status === status), `${form[1]} ${status}`);
      }
    }
    for (const form of entries(entry(receipt, 'paths'), 'path')) {
      const [from, to] = [value(form, 'from'), value(form, 'to')];
      const scoped = items.filter(item => item.language === from);
      assert.equal(Number(value(form, 'refused')), scoped.filter(item => pathRefusal(item, to)).length, `${from} -> ${to}`);
      assert.equal(Number(value(form, 'admitted')), scoped.filter(item => item.status === 'admitted' && !pathRefusal(item, to)).length);
      assert.equal(Number(value(form, 'lowered')), scoped.filter(item => item.status === 'lowered' && !pathRefusal(item, to)).length);
    }
    const causes = new Map();
    for (const item of items) {
      const seen = new Set();
      for (const target of targetsOf(item.language)) {
        const refusal = pathRefusal(item, target);
        if (!refusal) continue;
        const key = JSON.stringify([item.language, value(refusal, 'stage'), value(refusal, 'kind'), value(refusal, 'construct'), value(refusal, 'target') ?? '']);
        const tally = causes.get(key) ?? { items: 0, paths: 0 };
        tally.paths += 1;
        if (!seen.has(key)) { seen.add(key); tally.items += 1; }
        causes.set(key, tally);
      }
    }
    const recorded = entries(entry(receipt, 'causes'), 'cause');
    assert.equal(recorded.length, causes.size);
    for (const form of recorded) {
      const key = JSON.stringify(['language', 'stage', 'kind', 'construct'].map(name => value(form, name)).concat(value(form, 'target') ?? ''));
      assert.deepEqual({ items: Number(value(form, 'items')), paths: Number(value(form, 'paths')) }, causes.get(key), key);
    }
  });

  it('re-derives the first-refusal receipt of one item per cause exactly', { timeout: 600_000 }, () => {
    const sampled = new Map();
    for (const item of items) {
      for (const target of targetsOf(item.language)) {
        const refusal = pathRefusal(item, target);
        if (!refusal) continue;
        const key = JSON.stringify([item.language, value(refusal, 'stage'), value(refusal, 'kind'), value(refusal, 'construct'), value(refusal, 'target') ?? '']);
        if (!sampled.has(key)) sampled.set(key, { item, refusal, target: value(refusal, 'target') ?? target });
      }
    }
    assert.ok(sampled.size > 50);
    for (const { item, refusal, target } of sampled.values()) {
      const program = programOf(item);
      assert.equal(sha256(program), value(item.form, 'program-sha256'), item.id);
      const result = translateCertified(program, item.language, target);
      assert.equal(result.status, 'refused', item.id);
      assert.equal(result.diagnostic.message, value(refusal, 'message'), item.id);
      assert.equal(sha256(result.receipt), value(refusal, 'receipt-sha256'), item.id);
      const verdict = checkTranslationRefusal(result.receipt, { source: program });
      assert.ok(verdict.valid, `${item.id}: ${JSON.stringify(verdict.errors)}`);
    }
  });

  it('validates every committed certificate and target against its re-assembled source program', { timeout: 600_000 }, () => {
    let checked = 0;
    const admitted = items.filter(item => item.status === 'admitted');
    for (const path of new Set(admitted.map(item => item.path))) {
      const stem = path.replace(/\.[^.]+$/u, '');
      const local = admitted.filter(item => item.path === path);
      for (const target of targetsOf(local[0].language)) {
        const certified = local.filter(item => entries(entry(item.form, 'targets'), 'target').some(form => form[1] === target));
        if (!certified.length) continue;
        const certificates = bulk(`certificates/${stem}.${target.toLowerCase()}.lino`).replace(/\n$/u, '').split('\n\n');
        const targetFile = bulk(`targets/${stem}.${target.toLowerCase()}.${CERTIFIED_EXTENSIONS[target]}`);
        const headers = [...targetFile.matchAll(/^.*rml-certified-item (\S+) target-sha256=([0-9a-f]{64}).*\n/gmu)];
        assert.equal(certificates.length, certified.length, `${stem} ${target}`);
        assert.equal(headers.length, certified.length, `${stem} ${target}`);
        certified.forEach((item, index) => {
          const recorded = entries(entry(item.form, 'targets'), 'target').find(form => form[1] === target);
          const header = headers[index];
          const targetText = targetFile.slice(header.index + header[0].length, headers[index + 1]?.index ?? targetFile.length);
          assert.equal(header[1], item.id);
          assert.equal(sha256(targetText), header[2], item.id);
          assert.equal(sha256(targetText), value(recorded, 'sha256'), item.id);
          assert.equal(sha256(certificates[index]), value(recorded, 'certificate-sha256'), item.id);
          const verdict = checkTranslationCertificate(certificates[index], { source: programOf(item), target: targetText });
          assert.ok(verdict.valid, `${item.id} -> ${target}: ${JSON.stringify(verdict.errors)}`);
          checked += 1;
        });
      }
    }
    assert.equal(checked, Number(value(entry(receipt, 'totals'), 'certified-translations')));
  });

  it('matches the hand-written mirrors on their documented behaviour without compiling them', () => {
    const cases = JSON.parse(repository(MIRRORS_FILE)).mirrors;
    const recorded = document('mirrors.lino');
    assert.deepEqual(entry(recorded, 'cases').slice(1), [MIRRORS_FILE, sha256(readFileSync(join(root, MIRRORS_FILE)))]);
    const mirrors = entries(recorded, 'mirror');
    assert.deepEqual(mirrors.map(form => value(form, 'id')), cases.map(mirror => mirror.id));
    let calls = 0;
    for (const [index, mirror] of cases.entries()) {
      const form = mirrors[index];
      assert.ok(repository(mirror.mirror.path).includes(mirror.mirror.signature), `${mirror.id}: the hand-written mirror is unchanged`);
      const item = items.find(candidate => candidate.id === value(form, 'item'));
      assert.equal(item?.status, 'admitted', mirror.id);
      const signature = value(form, 'certified-signature');
      const targetFile = bulk(`targets/${item.path.replace(/\.[^.]+$/u, '')}.${mirror.to.toLowerCase()}.${CERTIFIED_EXTENSIONS[mirror.to]}`);
      assert.ok(targetFile.split('\n').includes(signature), `${mirror.id}: the committed target declares ${signature}`);
      if (mirror.correspondence === 'signature-differs') {
        assert.equal(value(form, 'verdict'), 'signature-differs', mirror.id);
        assert.equal(entries(form, 'call').length, 0);
        continue;
      }
      assert.equal(value(form, 'verdict'), 'match', mirror.id);
      const observed = entries(form, 'call');
      assert.equal(observed.length, mirror.calls.length);
      mirror.calls.forEach((call, position) => {
        const lines = entries(observed[position], 'observed');
        assert.ok(lines.length >= 1);
        for (const line of lines) assert.equal(JSON.parse(line[2]), call.expected, `${mirror.id}(${call.args}) by ${line[1]}`);
        assert.equal(value(observed[position], 'verdict'), 'match');
        calls += 1;
      });
    }
    const summary = entry(receipt, 'mirrors');
    assert.equal(Number(value(summary, 'calls')), calls);
    assert.equal(Number(value(summary, 'matching-calls')), calls);
    assert.equal(Number(value(summary, 'mismatch')), 0);
  });
});
