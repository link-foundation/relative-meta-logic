#!/usr/bin/env node
/** Native acceptance for the structured-Link Rust implementation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeLinkedValues, encodeLinkedValues } from './linked-runtime-graph.mjs';
import { compileLinkedRustImplementation, emitLinkedRustImplementation, readLinkedRustImplementation, repositoryRoot, rustAstTool, rustImplementationModules } from './generate-linked-rust-runtime.mjs';
import { readImplementationConfiguration, emitImplementationConfiguration } from './linked-implementation-configuration.mjs';

const assertionSource = `
use rml::{Node, parse_lino_document, MAX_LINO_NESTING_DEPTH};
use rml::linked_program::{LinkedProgramRegistry, ExecutionBasis};
use rml::linked_proof::{verify_linked_proof, LinkedProofOptions};
fn node(value: &serde_json::Value) -> Node {
    match value { serde_json::Value::String(text) => Node::Leaf(text.clone()),
        serde_json::Value::Array(values) => Node::List(values.iter().map(node).collect()),
        _ => panic!("invalid fixture") }
}
#[test]
fn source_free_rust_authority_changes_parser_and_verifier() {
    let mutation = std::env::var("RML_AUTHORITY_MUTATION").unwrap_or_default();
    assert_eq!(MAX_LINO_NESTING_DEPTH, if mutation == "parser" { 2 } else { 64 });
    assert_eq!(parse_lino_document("(a (b (c d)))").is_err(), mutation == "parser");
    if mutation == "parser" { return; }
    let program = concat!(include_str!("../../lib/meta-theory/universal.lino"), "\\n", include_str!("../../lib/meta-theory/proof-verifier.lino"));
    let registry = LinkedProgramRegistry::from_rml_with_basis(program, ExecutionBasis::DirectStructural, &[]).unwrap();
    let cases: serde_json::Value = serde_json::from_str(include_str!("../../test-corpus/linked-proof/cases.json")).unwrap();
    let sample = &cases[0];
    let result = verify_linked_proof(&registry, &node(&sample["context"]), &node(&sample["goal"]), &node(&sample["candidate"]), &LinkedProofOptions::default()).unwrap();
    assert_eq!(result.accepted, mutation != "verifier");
}
`;
const sha256 = text => createHash('sha256').update(text).digest('hex');

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env }, timeout: 15 * 60_000 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.status}`);
}

function mutate(value, predicate, edit) {
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  if (predicate(value)) { edit(value); count += 1; }
  for (const child of Object.values(value)) count += mutate(child, predicate, edit);
  return count;
}

export function verifyLinkedRustRuntime(helper, targetDirectory, root = repositoryRoot) {
  const seedHelperSha256 = sha256(readFileSync(helper));
  const archive = readLinkedRustImplementation(root);
  const configuration = readImplementationConfiguration(root);
  const manifest = JSON.parse(readFileSync(join(root, 'lib/linked-runtime/rust-manifest.json')));
  const scratch = mkdtempSync(join(tmpdir(), 'rml-linked-rust-'));
  const cargo = process.env.CARGO ?? 'cargo';
  try {
    const modules = rustImplementationModules(archive);
    const files = compileLinkedRustImplementation(archive, helper);
    for (const item of manifest.modules) assert.equal(sha256(files[item.path]), item.generatedSha256, item.path);
    emitLinkedRustImplementation(archive, scratch, helper);
    emitImplementationConfiguration(configuration, scratch);
    symlinkSync(join(root, 'test-corpus'), join(scratch, 'test-corpus'), 'dir');
    const tests = join(scratch, 'rust/tests'); mkdirSync(tests, { recursive: true });
    for (const name of ['lino_frontend_tests.rs', 'linked_proof_tests.rs', 'kernel_replacement_tests.rs']) cpSync(join(root, 'rust/tests', name), join(tests, name));
    writeFileSync(join(tests, 'r151_authority.rs'), assertionSource);
    const target = resolve(targetDirectory);
    const cargoTest = (extra, env) => run(cargo, ['test', '--locked', '--manifest-path', join(scratch, 'rust/Cargo.toml'), '--target-dir', target, ...extra], env);
    cargoTest(['--test', 'lino_frontend_tests', '--test', 'kernel_replacement_tests', '--test', 'r151_authority']);
    cargoTest(['--test', 'linked_proof_tests', 'shared_linked_proof_adversarial_corpus']);
    // Source-free companion builds use its own manifest and generated modules.
    const companions = [...new Set(Object.keys(modules).filter(path => path.startsWith('rust/') && path.includes('/src/') && !path.startsWith('rust/src/')).map(path => path.slice(0, path.indexOf('/src/'))))];
    for (const companion of companions) {
      for (const file of ['Cargo.toml', 'Cargo.lock']) assert.ok(existsSync(join(scratch, companion, file)), `archived companion configuration ${companion}/${file}`);
      if (existsSync(join(root, companion, 'tests'))) cpSync(join(root, companion, 'tests'), join(scratch, companion, 'tests'), { recursive: true });
      // Maintained examples are executable owned sources and are already emitted
      // from their ASTs. Only independent tests may be copied from the checkout.
      run(cargo, ['test', '--locked', '--manifest-path', join(scratch, companion, 'Cargo.toml'), '--target-dir', target, '--all-targets']);
    }
    for (const variant of ['parser', 'verifier']) {
      const value = decodeLinkedValues(archive);
      if (variant === 'parser') assert.equal(mutate(value.modules['rust/src/lino_frontend.rs'], node => node.const?.ident === 'MAX_LINO_NESTING_DEPTH', node => { node.const.expr = { lit: { int: '2' } }; }), 1);
      else assert.equal(mutate(value.modules['rust/src/linked_proof.rs'], node => node.let?.pat?.ident?.ident === 'accepted', node => { node.let.init.expr = { lit: { bool: false } }; }), 1);
      emitLinkedRustImplementation(encodeLinkedValues(value), scratch, helper);
      cargoTest(['--test', 'r151_authority'], { RML_AUTHORITY_MUTATION: variant });
    }
    emitLinkedRustImplementation(archive, scratch, helper);
    run(cargo, ['build', '--locked', '--manifest-path', join(scratch, 'scripts/linked-runtime-rust/Cargo.toml'), '--target-dir', target]);
    const secondHelper = join(target, 'debug', process.platform === 'win32' ? 'rml-linked-rust-ast.exe' : 'rml-linked-rust-ast');
    const secondGeneration = compileLinkedRustImplementation(archive, secondHelper);
    for (const item of manifest.modules) assert.equal(sha256(secondGeneration[item.path]), item.generatedSha256, item.path);
    // These exercise the exact generic adapter corrections independently of RML.
    for (const source of ["fn f(r#type: u8) -> (u8,) { (r#type,) }", "fn f() -> u8 { b'\\t' }", "struct A { x: u8 } fn f(a: A) -> A { A { x: 1, ..a } }"]) {
      const syntax = rustAstTool('parse', source, helper);
      assert.deepEqual(rustAstTool('parse', rustAstTool('emit', JSON.stringify(syntax), secondHelper), helper), syntax);
    }
    // Syn 3 adds typed match guards, receiver kinds, function pointers and C strings.
    // Compile the regenerated generic syntax and execute its independent assertions.
    const syntaxSource = `
struct Holder<T = u8, const N: usize = 1> { value: T }
impl<T, const N: usize> Holder<T, N> { fn get(self: &Self) -> &T { &self.value } }
type Handler = fn(value: u8) -> u8;
#[test] fn syn3_syntax_preserves_native_observations() {
    let value = Holder::<u8> { value: b'\\t' };
    assert_eq!(*value.get(), 9);
    let handler: Handler = |value| value + 1;
    assert_eq!(match handler(1) { value if value > 1 => value, _ => 0 }, 2);
    assert_eq!(c"hello".to_bytes(), b"hello");
    let r#type = (7u8,);
    assert_eq!(r#type.0, 7);
}`;
    const syntax = rustAstTool('parse', syntaxSource, helper);
    const syntaxGenerated = rustAstTool('emit', JSON.stringify(syntax), secondHelper);
    assert.deepEqual(rustAstTool('parse', syntaxGenerated, helper), syntax);
    const syntaxFile = join(scratch, 'syn3-syntax.rs');
    const syntaxBinary = join(target, process.platform === 'win32' ? 'syn3-syntax.exe' : 'syn3-syntax');
    writeFileSync(syntaxFile, syntaxGenerated);
    run('rustc', ['--edition=2021', '--test', '--crate-name', 'syn3_syntax', syntaxFile, '-o', syntaxBinary]);
    run(syntaxBinary, []);
    assert.equal(sha256(readFileSync(helper)), seedHelperSha256, 'the generic seed executable remains unchanged');
    return { schema: 'rml-linked-rust-native-acceptance/v1', modules: manifest.moduleCount, archiveSha256: manifest.archiveSha256, seedHelperSha256, sourceFreeNativeCompilation: true,
      sourceFreeCompanions: companions, parserMutation: true, verifierMutation: true, generatorFixedPoint: true, syntaxRegressions: 4, fullImplementationClosure: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [helper, target] = process.argv.slice(2);
  if (!helper || !target || process.argv.length !== 4) throw new Error('Usage: node scripts/verify-linked-rust-runtime.mjs HELPER TARGET_DIRECTORY');
  console.log(JSON.stringify(verifyLinkedRustRuntime(resolve(helper), resolve(target)), null, 2));
}
