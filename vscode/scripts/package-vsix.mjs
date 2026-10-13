#!/usr/bin/env node
/** VSCE writes privately; publish only its exact bytes under the producer lease. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { context, inheritedLease, cleanup } from '../../scripts/build-cache.mjs';
import { publishOutput } from '../../scripts/publish-cache-output.mjs';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(extensionRoot);
const require = createRequire(path.join(extensionRoot, 'package.json'));
const destination = 'vscode/relative-meta-logic.vsix';

try {
  const cache = context(root);
  if (!process.env.RML_CACHE_OUTPUT_DIR || !process.env.RML_CACHE_PRODUCTION ||
      process.env.RML_CACHE_PRODUCTION !== process.env.RML_CACHE_LEASE || !inheritedLease(cache) ||
      fs.realpathSync(process.env.RML_CACHE_ROOT) !== cache.root) {
    throw new Error('Use npm run package to provide a verified build-cache producer lease');
  }
  const outputRoot = fs.realpathSync(process.env.RML_CACHE_OUTPUT_DIR);
  if (!outputRoot.startsWith(`${cache.root}${path.sep}`)) throw new Error('VSIX production must stay inside the private worktree output directory');
  const output = path.join(fs.mkdtempSync(path.join(outputRoot, 'vsix-')), 'relative-meta-logic.vsix');
  const result = spawnSync(process.execPath, [require.resolve('@vscode/vsce/vsce'), 'package', '--out', output], {
    cwd: extensionRoot, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (process.exitCode === 0) {
    // Only verified older output can be removed. Unknown or edited packages,
    // including files created while VSCE ran, survive and block publication.
    cleanup(context(root), { full: true, onlyRoots: [destination] });
    publishOutput(output, path.join(root, destination));
    console.log('Published relative-meta-logic.vsix');
  }
} catch (error) { console.error(`package-vsix: ${error.message}`); process.exitCode = 1; }
