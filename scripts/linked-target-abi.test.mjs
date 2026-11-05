import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { encodeLinkedValues, decodeLinkedValues } from './linked-runtime-graph.mjs';
import { readTargetModel, validateTargetModel, interpretTargetEncode, interpretTargetDecode, executeTargetProgram, generateJavaScriptTarget } from './linked-target-abi.mjs';
import { generateRustTarget } from './linked-target-rust-codegen.mjs';
import { parseJavaScriptAst } from './generate-linked-runtime.mjs';
import { encodeLinkedProofData } from '../js/src/rml-linked-proof.mjs';

const model = readTargetModel();
const scratch = mkdtempSync(join(tmpdir(), 'rml-linked-target-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
async function compiled(model) { const p = join(scratch, `${serial++}.mjs`); writeFileSync(p, generateJavaScriptTarget(model)); return import(pathToFileURL(p).href); }

test('pure Link model executes real proof quotation and compiles adapter expressions', async () => {
  const archive = JSON.parse(readFileSync(new URL('../lib/target-abi/model.links.json', import.meta.url)));
  assert.ok(archive.links.every(row => row.every(Number.isSafeInteger)));
  assert.deepEqual(decodeLinkedValues(encodeLinkedValues(model)), model);
  const generated = await compiled(model);
  const values = ['a', '😀', '\ufeff', [], ['a', ['b', 'é'], []]];
  for (const value of values) {
    const expected = encodeLinkedProofData(value);
    assert.deepEqual(executeTargetProgram(model, 'quote', [value]), expected);
    assert.deepEqual(generated.executeProgram('quote', [value]), expected);
  }
  assert.doesNotThrow(() => parseJavaScriptAst(generateJavaScriptTarget(model)));
  assert.deepEqual(parseJavaScriptAst(readFileSync(new URL('../js/src/rml-linked-target-abi.mjs', import.meta.url), 'utf8')), parseJavaScriptAst(generateJavaScriptTarget(model)), 'ordinary tests reject a stale JavaScript adapter');
  assert.match(generateRustTarget(model), /pub fn encode_frame/);
  assert.throws(() => validateTargetModel({ ...model, programs: { bad: { params: 1, body: ['native-proof-oracle'] } } }), /unsupported/);
});

test('independent memory planner agrees byte-for-byte with generated target and rejects corruption', async () => {
  const generated = await compiled(model);
  for (const value of ['a', '😀é\ufeff', [], ['x', [], ['y', 'z']], Array.from({ length: 20 }, (_, i) => `leaf${i}`)]) {
    const bytes = interpretTargetEncode(model, value);
    assert.deepEqual(generated.encodeFrame(value), bytes);
    assert.deepEqual(generated.decodeFrame(bytes), value);
    assert.deepEqual(interpretTargetDecode(model, bytes), value);
    for (const altered of [bytes.slice(0, -1), Uint8Array.from([...bytes, 0]), bytes.map((x, i) => i === 0 ? x ^ 1 : x)]) {
      assert.throws(() => generated.decodeFrame(altered)); assert.throws(() => interpretTargetDecode(model, altered));
    }
  }
  const atom = interpretTargetEncode(model, 'a'); atom[24] = 0xff;
  assert.throws(() => interpretTargetDecode(model, atom)); assert.throws(() => generated.decodeFrame(atom));
  for (const value of ['\ud800', '\udfff', '', 1, true, null]) {
    assert.throws(() => interpretTargetEncode(model, value)); assert.throws(() => generated.encodeFrame(value));
  }
  const cycle = []; cycle.push(cycle);
  assert.throws(() => interpretTargetEncode(model, cycle)); assert.throws(() => generated.encodeFrame(cycle));
  const alias = interpretTargetEncode(model, ['a', 'b']); new DataView(alias.buffer).setUint32(28, new DataView(alias.buffer).getUint32(24, true), true);
  assert.throws(() => interpretTargetDecode(model, alias)); assert.throws(() => generated.decodeFrame(alias));
});

test('Link layout and program replacements change actual generated storage and verdicts', async () => {
  const changed = decodeLinkedValues(encodeLinkedValues(model));
  changed.target.endian = 'big'; changed.target.alignment = 8;
  changed.layout.cellWords = ['length', 'tag', 'payload']; changed.layout.codes.text = 42;
  changed.programs.accepted.body = ['equal', ['text', 'x'], ['text', 'y']];
  const generated = await compiled(changed), baseline = await compiled(model), value = ['proof-accepted', 'p'];
  assert.deepEqual(generated.encodeFrame(value), interpretTargetEncode(changed, value));
  assert.deepEqual(generated.decodeFrame(generated.encodeFrame(value)), value);
  assert.notDeepEqual(generated.encodeFrame(value), baseline.encodeFrame(value));
  assert.throws(() => baseline.decodeFrame(generated.encodeFrame(value)));
  assert.equal(generated.executeProgram('accepted', [value]), false);
  assert.equal(executeTargetProgram(changed, 'accepted', [value]), false);
  assert.equal(baseline.executeProgram('accepted', [value]), true);
  assert.throws(() => executeTargetProgram(model, 'quote', [value], 1), /fuel/);
  assert.throws(() => baseline.executeProgram('quote', [value], 1), /fuel/);
  const bounded = structuredClone(model); bounded.domain.maxNodes = 2; bounded.domain.maxDepth = 2; bounded.domain.maxTextBytes = 2;
  const limited = await compiled(bounded);
  for (const value of [['a', 'b'], [[['a']]], '😀']) { assert.throws(() => limited.encodeFrame(value)); assert.throws(() => interpretTargetEncode(bounded, value)); }
});
