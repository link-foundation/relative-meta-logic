#!/usr/bin/env node
/** JSDoc writes privately; only its exact produced bytes are published. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { context, cleanup } from './build-cache.mjs';
import { publishOutput } from './publish-cache-output.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'js/package.json'));
try {
  if (!process.env.RML_CACHE_OUTPUT_DIR) throw new Error('Use the build-cache wrapper for JSDoc production');
  const args = process.argv.slice(2);
  const forwarded = [];
  let destination = 'out';
  for (let i = 0; i < args.length; i++) {
    if (['-d', '--destination'].includes(args[i])) {
      if (!args[i + 1]) throw new Error(`Missing ${args[i]} value`);
      destination = args[++i];
    } else if (args[i].startsWith('--destination=')) destination = args[i].slice(14);
    else forwarded.push(args[i]);
  }
  const destinationPath = path.resolve(destination);
  const destinationRelative = path.relative(root, destinationPath).split(path.sep).join('/');
  cleanup(context(root), { full: true, onlyRoots: [destinationRelative] });
  const output = fs.mkdtempSync(path.join(process.env.RML_CACHE_OUTPUT_DIR, 'jsdoc-'));
  const result = spawnSync(process.execPath, [require.resolve('jsdoc/jsdoc.js'), '-c', path.join(root, 'docs/api/jsdoc.json'), ...forwarded, '--destination', output], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (process.exitCode === 0) console.log(`Published ${publishOutput(output, destinationPath)} JSDoc files`);
} catch (error) { console.error(`build-docs: ${error.message}`); process.exitCode = 1; }
