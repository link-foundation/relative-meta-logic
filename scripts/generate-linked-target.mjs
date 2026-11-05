#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readTargetModel, generateJavaScriptTarget } from './linked-target-abi.mjs';
import { generateRustTarget } from './linked-target-rust-codegen.mjs';
import { parseJavaScriptAst } from './generate-linked-runtime.mjs';
import { rustAstTool } from './generate-linked-rust-runtime.mjs';

export function generateLinkedTarget(root = new URL('../', import.meta.url)) {
  const model = readTargetModel(root);
  return { 'js/src/rml-linked-target-abi.mjs': generateJavaScriptTarget(model), 'rust/linked-target/src/abi.rs': generateRustTarget(model) };
}

export function checkLinkedTarget(helper, root = new URL('../', import.meta.url)) {
  for (const [path, generated] of Object.entries(generateLinkedTarget(root))) {
    const actual = readFileSync(new URL(path, root), 'utf8');
    const parse = path.endsWith('.mjs') ? parseJavaScriptAst : source => rustAstTool('parse', source, helper);
    if (!isDeepStrictEqual(parse(actual), parse(generated))) throw new Error(`target adapter differs from authoritative model: ${path}`);
  }
  return { targetModelConsistent: true, generatedAdapters: 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--generate' && process.argv.length === 3) for (const [path, source] of Object.entries(generateLinkedTarget())) writeFileSync(new URL(`../${path}`, import.meta.url), source);
  else if (process.argv[2] === '--check' && process.argv.length === 4) console.log(JSON.stringify(checkLinkedTarget(process.argv[3]), null, 2));
  else throw new Error('Usage: node scripts/generate-linked-target.mjs --generate | --check GENERIC_RUST_SYNTAX_HELPER');
}
