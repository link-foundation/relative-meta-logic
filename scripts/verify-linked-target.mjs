#!/usr/bin/env node
/** Source-to-native observation witness for the actual RML byte-frame entry points. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { decodeLinkedValues, encodeLinkedValues } from './linked-runtime-graph.mjs';
import { emitLinkedImplementation, readLinkedImplementation, repositoryRoot } from './generate-linked-runtime.mjs';
import { emitLinkedRustImplementation, readLinkedRustImplementation } from './generate-linked-rust-runtime.mjs';
import { emitImplementationConfiguration, readImplementationConfiguration } from './linked-implementation-configuration.mjs';
import { readTargetModel, generateJavaScriptTarget, executeTargetProgram, interpretTargetEncode, interpretTargetDecode } from './linked-target-abi.mjs';
import { generateRustTarget } from './linked-target-rust-codegen.mjs';

const sha = x => createHash('sha256').update(x).digest('hex');
const hex = x => Buffer.from(x).toString('hex');
const bytes = x => Uint8Array.from(Buffer.from(x, 'hex'));
const tool = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 600000, maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.status}\n${result.stderr}`);
  return result.stdout;
};

export async function verifyLinkedTarget(helper, target, root = repositoryRoot) {
  const scratch = mkdtempSync(join(tmpdir(), 'rml-target-native-'));
  const hashes = ['scripts/linked-target-abi.mjs', 'scripts/linked-target-rust-codegen.mjs'].map(p => [p, sha(readFileSync(join(root, p)))]);
  const model = readTargetModel(pathToFileURL(`${root}/`));
  const nativeArtifactHashes = [];
  try {
    const configuration = readImplementationConfiguration(root);
    emitLinkedImplementation(readLinkedImplementation(root), scratch);
    emitLinkedRustImplementation(readLinkedRustImplementation(root), scratch, helper);
    emitImplementationConfiguration(configuration, scratch);
    symlinkSync(join(root, 'js/node_modules'), join(scratch, 'js/node_modules'), 'dir');
    mkdirSync(join(scratch, 'js/vendor'), { recursive: true });
    symlinkSync(join(root, 'js/vendor/meta-language'), join(scratch, 'js/vendor/meta-language'), 'dir');
    // Use the generators reconstructed from their own authoritative syntax graphs.
    const generatedModelTools = await import(pathToFileURL(join(scratch, 'scripts/linked-target-abi.mjs')).href);
    const generatedRustTools = await import(pathToFileURL(join(scratch, 'scripts/linked-target-rust-codegen.mjs')).href);
    const { LinkedProgramRegistry } = await import(pathToFileURL(join(scratch, 'js/src/rml-linked-program.mjs')).href);
    const proof = await import(pathToFileURL(join(scratch, 'js/src/rml-linked-proof.mjs')).href);
    const program = ['universal.lino', 'proof-verifier.lino'].map(p => readFileSync(join(scratch, 'lib/meta-theory', p), 'utf8')).join('\n');
    const registry = LinkedProgramRegistry.fromRml(program, { executionBasis: 'direct-structural' });
    const cases = JSON.parse(readFileSync(join(root, 'test-corpus/linked-proof/cases.json')));
    const native = join(resolve(target), 'debug', process.platform === 'win32' ? 'rml-linked-target.exe' : 'rml-linked-target');
    const compile = m => {
      writeFileSync(join(scratch, 'rust/linked-target/src/abi.rs'), generatedRustTools.generateRustTarget(m));
      tool(process.env.CARGO ?? 'cargo', ['build', '--offline', '--locked', '--manifest-path', join(scratch, 'rust/linked-target/Cargo.toml'), '--target-dir', resolve(target)]);
      nativeArtifactHashes.push(sha(readFileSync(native)));
    };
    const invoke = requests => tool(native, [], { input: requests.map(x => JSON.stringify(x)).join('\n') + '\n' }).trim().split('\n').map(x => JSON.parse(x));
    const variant = async (m, name, parserFile = 'rml-lino-frontend.mjs') => {
      const folder = join(scratch, name); mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'abi.mjs'), generatedModelTools.generateJavaScriptTarget(m));
      // A distinct module graph avoids reusing an already imported baseline adapter.
      const bridge = readFileSync(join(scratch, 'js/src/rml-linked-target.mjs'), 'utf8')
        .replaceAll('./rml-linked-target-abi.mjs', './abi.mjs')
        .replaceAll('./rml-linked-proof.mjs', pathToFileURL(join(scratch, 'js/src/rml-linked-proof.mjs')).href)
        .replaceAll('./rml-lino-frontend.mjs', pathToFileURL(join(scratch, 'js/src', parserFile)).href);
      writeFileSync(join(folder, 'bridge.mjs'), bridge);
      return { codec: await import(pathToFileURL(join(folder, 'abi.mjs')).href), bridge: await import(pathToFileURL(join(folder, 'bridge.mjs')).href) };
    };
    const baseline = await variant(model, 'baseline'); compile(model);
    const ordinaryFrames = ['a', '😀é\ufeff', [], ['x', [], ['y', 'z']]].map(v => interpretTargetEncode(model, v));
    const nativeFrames = invoke(ordinaryFrames.map(frame => ({ op: 'roundtrip', frame: hex(frame) })));
    nativeFrames.forEach((result, i) => { assert.equal(result.ok, true); assert.equal(result.frame, hex(ordinaryFrames[i])); });
    const malformedUtf8 = interpretTargetEncode(model, 'a'); malformedUtf8[24] = 255;
    const alias = interpretTargetEncode(model, ['a', 'b']); new DataView(alias.buffer).setUint32(28, new DataView(alias.buffer).getUint32(24, true), true);
    const hiddenPadding = interpretTargetEncode(model, ['a', 'b']); hiddenPadding[45] = 255;
    const corruptFrames = [ordinaryFrames[0].slice(0, -1), Uint8Array.from([...ordinaryFrames[0], 0]), malformedUtf8, alias, hiddenPadding];
    const refusals = invoke(corruptFrames.map(frame => ({ op: 'roundtrip', frame: hex(frame) })));
    refusals.forEach((result, i) => { assert.equal(result.ok, false); assert.throws(() => baseline.codec.decodeFrame(corruptFrames[i])); assert.throws(() => interpretTargetDecode(model, corruptFrames[i])); });
    const packets = cases.map(c => interpretTargetEncode(model, [c.context, c.goal, c.candidate]));
    const receipts = [];
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i], result = invoke([{ op: 'verify', frame: hex(packets[i]) }])[0]; assert.equal(result.ok, true, c.name);
      const original = proof.verifyLinkedProof(registry, c.context, c.goal, c.candidate);
      const jsBytes = baseline.bridge.verifyTargetFrame(registry, packets[i]);
      assert.equal(hex(jsBytes), result.frame, `${c.name}: native/JS exact receipt bytes`);
      const receipt = baseline.bridge.receiptFromTargetFrame(bytes(result.frame));
      assert.deepEqual(receipt, original, `${c.name}: actual verifier complete receipt`);
      assert.equal(receipt.accepted, c.accepted, c.name);
      const interpretedRequest = executeTargetProgram(model, 'request', [c.context, c.goal, c.candidate]);
      assert.deepEqual(interpretedRequest, receipt.request);
      const interpretedReceipt = executeTargetProgram(model, 'receipt', [receipt.program, receipt.request, receipt.result, receipt.trace, String(receipt.steps)]);
      assert.equal(hex(interpretTargetEncode(model, interpretedReceipt)), result.frame, `${c.name}: independent model bytes`);
      receipts.push(gzipSync(bytes(result.frame)));
      if ((i + 1) % 8 === 0 || i + 1 === cases.length) console.log(`Exact model/JavaScript/native receipt bytes: ${i + 1}/${cases.length}`);
    }
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i], request = { op: 'replay', frame: hex(gunzipSync(receipts[i])), context: hex(interpretTargetEncode(model, c.context)), goal: hex(interpretTargetEncode(model, c.goal)) };
      const replay = invoke([request])[0]; assert.equal(replay.ok, true, c.name);
      const js = baseline.bridge.replayTargetFrame(registry, bytes(request.context), bytes(request.goal), bytes(request.frame));
      assert.equal(hex(js), replay.frame, `${c.name}: cross-port replay`);
      assert.equal(interpretTargetDecode(model, bytes(replay.frame))[1], 'true');
      if ((i + 1) % 8 === 0 || i + 1 === cases.length) console.log(`Independent cross-port replay: ${i + 1}/${cases.length}`);
    }
    const firstReceipt = Uint8Array.from(gunzipSync(receipts[0]));
    const forged = interpretTargetDecode(model, firstReceipt); forged[2] = 'false';
    const forgedRequest = { op: 'replay', context: hex(interpretTargetEncode(model, cases[0].context)), goal: hex(interpretTargetEncode(model, cases[0].goal)), frame: hex(interpretTargetEncode(model, forged)) };
    const forgedResult = invoke([forgedRequest])[0]; assert.equal(forgedResult.ok, true); assert.equal(interpretTargetDecode(model, bytes(forgedResult.frame))[1], 'false');
    const exhausted = invoke([{ op: 'exhaust', frame: hex(packets[0]) }])[0]; assert.equal(exhausted.ok, false);
    assert.throws(() => baseline.bridge.verifyTargetFrame(registry, packets[0], 1));
    const parserInputs = ['(a (b c))', '("😀" é)', '(a:', '(a (b (c d)))'];
    const parsed = invoke(parserInputs.map(source => ({ op: 'parse', frame: hex(interpretTargetEncode(model, source)) })));
    for (let i = 0; i < parserInputs.length; i += 1) {
      let js; try { js = { ok: true, frame: hex(baseline.bridge.parseTargetFrame(interpretTargetEncode(model, parserInputs[i]))) }; } catch { js = { ok: false }; }
      assert.equal(parsed[i].ok, js.ok); if (js.ok) assert.equal(parsed[i].frame, js.frame);
    }
    // Layout edits are executable ABI changes, including physical word byte order.
    const layout = decodeLinkedValues(encodeLinkedValues(model)); layout.target.endian = 'big'; layout.target.alignment = 8; layout.layout.cellWords = ['length', 'tag', 'payload']; layout.layout.codes.text = 42;
    const layoutRuntime = await variant(layout, 'layout'); compile(layout);
    const layoutPacket = interpretTargetEncode(layout, [cases[0].context, cases[0].goal, cases[0].candidate]);
    const layoutReceipt = invoke([{ op: 'verify', frame: hex(layoutPacket) }])[0]; assert.equal(layoutReceipt.ok, true);
    assert.equal(layoutReceipt.frame, hex(layoutRuntime.bridge.verifyTargetFrame(registry, layoutPacket)));
    assert.notEqual(layoutReceipt.frame, hex(firstReceipt));
    assert.deepEqual(layoutRuntime.bridge.receiptFromTargetFrame(bytes(layoutReceipt.frame)), baseline.bridge.receiptFromTargetFrame(firstReceipt));
    // Executable verdict projection changes the actual public byte-frame API.
    const verdict = decodeLinkedValues(encodeLinkedValues(model)); verdict.programs.accepted.body = ['equal', ['text', 'x'], ['text', 'y']];
    const verdictRuntime = await variant(verdict, 'verdict'); compile(verdict);
    const changed = invoke([{ op: 'verify', frame: hex(packets[0]) }])[0]; assert.equal(changed.ok, true);
    assert.equal(changed.frame, hex(verdictRuntime.bridge.verifyTargetFrame(registry, packets[0])));
    assert.equal(verdictRuntime.bridge.receiptFromTargetFrame(bytes(changed.frame)).accepted, false);
    assert.equal(executeTargetProgram(verdict, 'accepted', [baseline.bridge.receiptFromTargetFrame(firstReceipt).result]), false);
    // A real parser source-AST edit is observed through the same compiled ABI.
    function mutate(value, predicate, edit) { if (!value || typeof value !== 'object') return 0; let count = 0; if (predicate(value)) { edit(value); count += 1; } for (const child of Object.values(value)) count += mutate(child, predicate, edit); return count; }
    const js = decodeLinkedValues(readLinkedImplementation(root));
    assert.equal(mutate(js.modules['js/src/rml-lino-frontend.mjs'], n => n.type === 'VariableDeclarator' && n.id.name === 'MAX_LINO_NESTING_DEPTH', n => { n.init = { type: 'NumericLiteral', value: 2 }; }), 1);
    const regeneratedCode = await import(pathToFileURL(join(scratch, 'scripts/linked-runtime-codegen.mjs')).href);
    writeFileSync(join(scratch, 'js/src/rml-lino-frontend-mutated.mjs'), regeneratedCode.generateJavaScript(js.modules['js/src/rml-lino-frontend.mjs']));
    const parserRuntime = await variant(model, 'parser-source', 'rml-lino-frontend-mutated.mjs');
    const rs = decodeLinkedValues(readLinkedRustImplementation(root));
    assert.equal(mutate(rs.modules['rust/src/lino_frontend.rs'], n => n.const?.ident === 'MAX_LINO_NESTING_DEPTH', n => { n.const.expr = { lit: { int: '2' } }; }), 1);
    emitLinkedRustImplementation(encodeLinkedValues(rs), scratch, helper); compile(model);
    const deepSource = interpretTargetEncode(model, '(a (b (c d)))');
    assert.doesNotThrow(() => baseline.bridge.parseTargetFrame(deepSource));
    assert.throws(() => parserRuntime.bridge.parseTargetFrame(deepSource));
    assert.equal(invoke([{ op: 'parse', frame: hex(deepSource) }])[0].ok, false);
    for (const [p, hash] of hashes) assert.equal(sha(readFileSync(join(root, p))), hash, 'generic generator unchanged');
    assert.equal(new Set(nativeArtifactHashes).size, nativeArtifactHashes.length, 'model changes regenerate distinct real native artifacts');
    return { schema: 'rml-linked-target-witness/v1', sourceFree: true, proofCases: cases.length, exactReceiptByteComparisons: cases.length, crossPortReplays: cases.length, parserCases: parserInputs.length, strictNativeFrames: ordinaryFrames.length, corruptNativeFramesRejected: corruptFrames.length, forgedReceiptRejected: true, resourceExhaustionIsError: true, independentModelInterpreter: true, regeneratedLayoutChangesBytes: true, regeneratedVerdictChangesExecution: true, regeneratedParserChangesObservation: true, nativeArtifactHashes, genericGeneratorHashes: hashes, fullCompilerCorrectness: false, physicalIsaModel: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [helper, target] = process.argv.slice(2); if (!helper || !target) throw new Error('Usage: node scripts/verify-linked-target.mjs HELPER TARGET_DIRECTORY');
  console.log(JSON.stringify(await verifyLinkedTarget(resolve(helper), resolve(target)), null, 2));
}
