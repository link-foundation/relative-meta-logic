#!/usr/bin/env node
/** Publish exact producer bytes, preserving every pre-existing unowned file. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeProducedFile } from './build-cache.mjs';

export function publishOutput(source, destination) {
  const root = fs.realpathSync(process.env.RML_CACHE_ROOT);
  const isolated = fs.realpathSync(process.env.RML_CACHE_OUTPUT_DIR);
  source = path.resolve(source);
  destination = path.resolve(destination);
  if (source !== isolated && !source.startsWith(`${isolated}${path.sep}`)) throw new Error('Published source must be inside the private producer output directory');
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('Published destination must stay inside this worktree');
  let count = 0;
  function visit(from, to) {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink() || stat.dev !== fs.statSync(isolated).dev) throw new Error('Producer publication cannot follow links or cross filesystems');
    if (stat.isDirectory()) {
      if (fs.existsSync(path.join(from, '.git'))) throw new Error('Cannot publish a nested source repository as generated output');
      for (const name of fs.readdirSync(from)) visit(path.join(from, name), path.join(to, name));
    } else if (stat.isFile()) {
      writeProducedFile(path.relative(root, to).split(path.sep).join('/'), fs.readFileSync(from), { mode: stat.mode & 0o777 });
      count++;
    } else throw new Error('Producer publication requires regular files');
  }
  visit(source, destination);
  return count;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: publish-cache-output.mjs <isolated-source> <generated-destination>');
    console.log(`Published ${publishOutput(process.argv[2], process.argv[3])} produced files`);
  } catch (error) { console.error(`publish-cache-output: ${error.message}`); process.exitCode = 1; }
}
