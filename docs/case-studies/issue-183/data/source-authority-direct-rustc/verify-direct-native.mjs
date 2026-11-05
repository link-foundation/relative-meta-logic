import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkCurrentLinkedImplementation } from '../rml-full-source-integration/scripts/check-linked-implementation.mjs';
import { decodeLinkedValues, encodeLinkedValues } from '../rml-full-source-integration/scripts/linked-runtime-graph.mjs';
import { readLinkedImplementation } from '../rml-full-source-integration/scripts/generate-linked-runtime.mjs';
import { readLinkedRustImplementation, emitLinkedRustImplementation, compileLinkedRustImplementation, rustAstTool } from '../rml-full-source-integration/scripts/generate-linked-rust-runtime.mjs';
import { readImplementationConfiguration, emitImplementationConfiguration } from '../rml-full-source-integration/scripts/linked-implementation-configuration.mjs';
import { verifyLinkedTarget } from '../rml-full-source-integration/scripts/verify-linked-target.mjs';
const here = '/workspace/shared/phase27-source-native-verification';
const sha = value => createHash('sha256').update(value).digest('hex');
const freezePath = '/workspace/shared/phase27-source-authority-native-inputs.json';
const freezeBytes = readFileSync(freezePath), freeze = JSON.parse(freezeBytes), root = freeze.authoritativeRoot;
const genericBytes = readFileSync(join(here, 'generic-inputs.json')), generic = JSON.parse(genericBytes);
const helper = freeze.seedHelper.path, target = join(here, '.rml-cache/direct-native'), output = join(target, 'debug');
const builder = join(here, 'direct-rustc-builder.py');
const reportPath = join(here, 'native-result.json');
const guard = () => {
  for (const file of freeze.files) assert.equal(sha(readFileSync(join(root, file.path))), file.sha256, `frozen owned input ${file.path}`);
  for (const file of generic.files) assert.equal(sha(readFileSync(file.path)), file.sha256, `read-only generic provider ${file.path}`);
  assert.equal(sha(readFileSync(helper)), freeze.seedHelper.sha256);
  assert.deepEqual(checkCurrentLinkedImplementation(root), freeze.guard);
};
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env }, timeout: 10 * 60_000 });
  assert.equal(result.error, undefined, command); assert.equal(result.status, 0, `${command} exited ${result.status}`);
};
function mutate(value, predicate, edit) {
  if (!value || typeof value !== 'object') return 0;
  let count = 0; if (predicate(value)) { edit(value); count += 1; }
  for (const child of Object.values(value)) count += mutate(child, predicate, edit);
  return count;
}
guard();
console.log(`DIRECT NATIVE: frozen source ${sha(freezeBytes)}, ${freeze.files.length} owned/input files; ${generic.files.length} read-only generic artifacts`);
const archive = readLinkedRustImplementation(root);
const manifest = JSON.parse(readFileSync(join(root, 'lib/linked-runtime/rust-manifest.json')));
const scratch = mkdtempSync(join(tmpdir(), 'direct-source-'));
mkdirSync(output, { recursive: true });
const receipts = [];
try {
  const baselineFiles = compileLinkedRustImplementation(archive, helper);
  for (const file of manifest.modules) assert.equal(sha(baselineFiles[file.path]), file.generatedSha256, file.path);
  emitLinkedRustImplementation(archive, scratch, helper);
  emitImplementationConfiguration(readImplementationConfiguration(root), scratch);
  symlinkSync(join(root, 'test-corpus'), join(scratch, 'test-corpus'), 'dir');
  mkdirSync(join(scratch, 'rust/tests'), { recursive: true });
  // The original acceptance assertion is itself recovered from the authoritative JavaScript AST.
  const jsAuthority = decodeLinkedValues(readLinkedImplementation(root));
  const nodes = jsAuthority.modules['scripts/verify-linked-rust-runtime.mjs'];
  let assertionSource;
  mutate(nodes, node => node.type === 'VariableDeclarator' && node.id?.name === 'assertionSource', node => { assertionSource = node.init.quasis[0].value.cooked; });
  assert.equal(typeof assertionSource, 'string');
  const testFile = join(scratch, 'rust/tests/r151_authority.rs');
  writeFileSync(testFile, assertionSource);
  const testBinary = join(output, 'r151-authority');
  for (const variant of ['baseline', 'parser', 'verifier']) {
    const value = decodeLinkedValues(archive);
    if (variant === 'parser') assert.equal(mutate(value.modules['rust/src/lino_frontend.rs'], n => n.const?.ident === 'MAX_LINO_NESTING_DEPTH', n => { n.const.expr = { lit: { int: '2' } }; }), 1);
    if (variant === 'verifier') assert.equal(mutate(value.modules['rust/src/linked_proof.rs'], n => n.let?.pat?.ident?.ident === 'accepted', n => { n.let.init.expr = { lit: { bool: false } }; }), 1);
    emitLinkedRustImplementation(encodeLinkedValues(value), scratch, helper);
    run(builder, ['rml', scratch, output]);
    const args = ['--edition=2021', '--crate-name', 'r151_authority', '--test', testFile, '-C', 'opt-level=1', '-C', 'debuginfo=0', '-L', `dependency=${output}`, '-L', `dependency=${generic.roots[0]}`, '--extern', `rml=${join(output, 'librml.rlib')}`, '--extern', `serde_json=${generic.selection.rml.serde_json}`, '-o', testBinary];
    run('rustc', args);
    run(testBinary, [], { RML_AUTHORITY_MUTATION: variant === 'baseline' ? '' : variant });
    receipts.push({ variant, runtimeSha256: sha(readFileSync(join(output, 'librml.rlib'))), testSha256: sha(readFileSync(testBinary)), assertionSourceSha256: sha(assertionSource) });
  }
  emitLinkedRustImplementation(archive, scratch, helper);
  run(builder, ['helper', scratch, output]);
  const secondHelper = join(output, 'rml-linked-rust-ast');
  const secondGeneration = compileLinkedRustImplementation(archive, secondHelper);
  for (const file of manifest.modules) assert.equal(sha(secondGeneration[file.path]), file.generatedSha256, file.path);
  for (const source of ["fn f(r#type: u8) -> (u8,) { (r#type,) }", "fn f() -> u8 { b'\\t' }", "struct A { x: u8 } fn f(a: A) -> A { A { x: 1, ..a } }"]) {
    const syntax = rustAstTool('parse', source, helper);
    assert.deepEqual(rustAstTool('parse', rustAstTool('emit', JSON.stringify(syntax), secondHelper), helper), syntax);
  }
  const syntaxSource = `struct Holder<T = u8, const N: usize = 1> { value: T }
impl<T, const N: usize> Holder<T, N> { fn get(self: &Self) -> &T { &self.value } }
type Handler = fn(value: u8) -> u8;
#[test] fn syn3_syntax_preserves_native_observations() {
 let value = Holder::<u8> { value: b'\\t' }; assert_eq!(*value.get(), 9);
 let handler: Handler = |value| value + 1;
 assert_eq!(match handler(1) { value if value > 1 => value, _ => 0 }, 2);
 assert_eq!(c"hello".to_bytes(), b"hello"); let r#type = (7u8,); assert_eq!(r#type.0, 7);
}`;
  const syntax = rustAstTool('parse', syntaxSource, helper), generated = rustAstTool('emit', JSON.stringify(syntax), secondHelper);
  assert.deepEqual(rustAstTool('parse', generated, helper), syntax);
  const syntaxFile = join(scratch, 'syn3-syntax.rs'), syntaxBinary = join(output, 'syn3-syntax');
  writeFileSync(syntaxFile, generated);
  run('rustc', ['--edition=2021', '--test', '--crate-name', 'syn3_syntax', syntaxFile, '-o', syntaxBinary]);
  run(syntaxBinary, []);
  guard();
  const result = { schema: 'rml-source-free-direct-rustc-validation/v1', mode: 'Freshly compile emitted owned source using read-only SHA-frozen generic rlibs; no Cargo resolution or provider rebuild', sourceModules: manifest.moduleCount, archiveSha256: manifest.archiveSha256, inputFreezeSha256: sha(freezeBytes), genericInputManifestSha256: sha(genericBytes), seedHelperSha256: freeze.seedHelper.sha256, regeneratedHelperSha256: sha(readFileSync(secondHelper)), parserMutation: true, verifierMutation: true, generatorFixedPoint: true, syntaxRegressions: 4, sourceInputsUnchanged: true, genericInputsUnchanged: true, receipts, fullCargoAggregatePassed: false, fullCompilerCorrectness: false };
  writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
process.env.CARGO = builder;
const abi = await verifyLinkedTarget(helper, target, root);
guard();
writeFileSync(join(here, 'abi-result.json'), JSON.stringify({ ...abi, compilationMode: 'direct-rustc with frozen read-only generic dependency artifacts', inputFreezeSha256: sha(freezeBytes), genericInputManifestSha256: sha(genericBytes), sourceInputsUnchanged: true, genericInputsUnchanged: true }, null, 2) + '\n');
console.log(JSON.stringify(abi, null, 2));
