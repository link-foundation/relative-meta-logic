#!/usr/bin/env node
/** Deliberate source migration; ordinary builds never import source edits. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { context, inheritedLease } from './build-cache.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !args[0].startsWith('--helper='))) throw new Error('Usage: node scripts/update-linked-implementation.mjs [--helper=PATH]');
const selectedHelper = args[0]?.slice('--helper='.length);
if (args[0] && !selectedHelper) throw new Error('The helper path must not be empty');

function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed during source migration: ${result.error?.message ?? result.status}`);
}

if (!inheritedLease(context(root))) {
  run(process.execPath, ['scripts/run-with-cache.mjs', '--source-migration', '--cache', '.rml-cache/linked-runtime-helper', '--retain', '.rml-cache/linked-runtime-helper', '--', process.execPath, 'scripts/update-linked-implementation.mjs', ...args]);
} else {
  const target = '.rml-cache/linked-runtime-helper';
  if (!selectedHelper) run(process.env.CARGO ?? 'cargo', ['build', '--locked', '--manifest-path', 'scripts/linked-runtime-rust/Cargo.toml', '--target-dir', target]);
  const helper = selectedHelper ? resolve(root, selectedHelper) : resolve(root, target, 'debug', `rml-linked-rust-ast${process.platform === 'win32' ? '.exe' : ''}`);
  run(process.execPath, ['scripts/generate-linked-target.mjs', '--generate']);
  run(process.execPath, ['scripts/build-playground.mjs']);
  run(process.execPath, ['scripts/generate-linked-runtime.mjs', '--capture']);
  run(process.execPath, ['scripts/generate-linked-rust-runtime.mjs', '--capture', helper]);
  run(process.execPath, ['scripts/linked-implementation-configuration.mjs', '--capture']);
  run(process.execPath, ['scripts/check-linked-implementation.mjs']);
}
