import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { releaseAssets } from './sync-release-assets.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url));

test('published runtimes embed the same theory inputs as the repository', () => {
  for (const [directory, assets] of Object.entries(releaseAssets)) {
    for (const asset of assets) {
      assert.deepEqual(read(`${directory}/src/meta-theory/${asset}`), read(`lib/meta-theory/${asset}`), asset);
    }
  }
});

test('the npm tarball includes the theory and upstream runtime providers', {
  skip: process.env.RML_CHECK_NPM_TARBALL !== '1',
}, () => {
  const cwd = fileURLToPath(new URL('../js/', import.meta.url));
  const [{ files }] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], { cwd }));
  const packed = new Set(files.map(file => file.path));
  for (const file of [
    'src/meta-theory/horn-link-substitution.lino',
    'src/meta-theory/horn-rml-elaboration.lino',
    'vendor/meta-language/js/src/index.js',
    'vendor/meta-language/js/src/data/concept-records.json',
    'vendor/meta-language-pr201/upstream-files.json',
  ]) {
    assert.ok(packed.has(file), `missing from npm package: ${file}`);
  }
});
