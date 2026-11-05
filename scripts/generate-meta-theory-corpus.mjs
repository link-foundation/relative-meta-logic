#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractFormalCorpus,
  renderFormalCorpus,
  renderFormalCorpusFoundation,
} from './check-meta-theory-corpus.mjs';

const REVISION = '087f4515d0652925eecc54bcade724445c3978f1';
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function main(upstreamRoot) {
  const actualRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: upstreamRoot,
    encoding: 'utf8',
  }).trim();
  if (actualRevision !== REVISION) {
    throw new Error(`upstream checkout must be pinned to ${REVISION}, got ${actualRevision}`);
  }
  const corpus = extractFormalCorpus(upstreamRoot);
  writeFileSync(
    join(repoRoot, 'lib', 'meta-theory', 'upstream-0.0.3.lino'),
    renderFormalCorpus(corpus),
  );
  writeFileSync(
    join(repoRoot, 'lib', 'meta-theory', 'upstream-0.0.3-foundation.lino'),
    renderFormalCorpusFoundation(corpus),
  );
  process.stdout.write(
    `generated ${corpus.declarations.length} semantic declarations from ` +
    `${corpus.modules.length} modules at ${actualRevision}\n`,
  );
}

const upstreamRoot = process.argv[2];
if (!upstreamRoot) {
  process.stderr.write('usage: node scripts/generate-meta-theory-corpus.mjs <meta-theory-checkout>\n');
  process.exitCode = 2;
} else {
  main(resolve(upstreamRoot));
}
