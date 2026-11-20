// Trusted-foundation and process-boundary checks for the bundled theory
// network (issue #183). Mirrors the matching tests in
// rust/tests/theory_network_tests.rs. They load the whole bundled network
// many times, so they run apart from the faster theory-network suite.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { TheoryNetwork } from '../src/rml-theory-network.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const metaTheory = join(repoRoot, 'lib', 'meta-theory');
const read = name => readFileSync(join(metaTheory, name), 'utf8');
const universalSource = read('universal.lino');
const coreSource = read('core.lino');
const foundationSource = read('foundation.lino');

describe('bundled theory network foundation', () => {
  it('verifies every bundled definition under the complete trusted foundation', () => {
    const network = TheoryNetwork.fromRml(`${universalSource}\n${coreSource}`, foundationSource);
    const definitions = network.theoryNames().flatMap(theory => network.definitionsFor(theory));
    assert.ok(definitions.length >= 10, `${definitions.length} definitions`);
    for (const definition of definitions) {
      assert.strictEqual(network.definitionVerification(definition.name)?.verified, true, definition.name);
    }
  });

  it('rejects the bundled network when any trusted axiom or rule is removed', () => {
    const forms = foundationSource.split(/\n(?=\()/);
    const trusted = forms
      .map((form, index) => [index, form.match(/^\((axiom|rule) ([^\s()]+)/)])
      .filter(([, match]) => match);
    assert.strictEqual(trusted.length, 21);
    for (const [index, [, kind, name]] of trusted) {
      const reduced = forms.filter((_, other) => other !== index).join('\n');
      assert.throws(
        () => TheoryNetwork.fromRml(`${universalSource}\n${coreSource}`, reduced),
        Error,
        `${kind} ${name} is not needed`,
      );
    }
  });

  it('verifies the bundled network without starting a proof-assistant process', () => {
    // The verifier runs under the Node permission model with no child-process
    // permission and no read access to the external formal corpus.
    const script = `
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const { TheoryNetwork } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, 'js', 'src', 'rml-theory-network.mjs')).href)});
const read = name => readFileSync(${JSON.stringify(metaTheory)} + '/' + name, 'utf8');
const network = TheoryNetwork.fromRml(read('universal.lino') + '\\n' + read('core.lino'), read('foundation.lino'));
const denied = action => { try { action(); return null; } catch (error) { return error.code; } };
console.log(JSON.stringify({
  verified: ['links-by-sets', 'graphs-by-finite-sets', 'relations-by-types']
    .map(name => network.definitionVerification(name).verified),
  spawn: denied(() => spawnSync(process.execPath, ['--version'])),
  externalCorpus: denied(() => read('upstream-0.0.3.lino')),
}));
`;
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      '--permission',
      `--allow-fs-read=${join(repoRoot, 'js')}`,
      ...['universal.lino', 'core.lino', 'foundation.lino']
        .map(name => `--allow-fs-read=${join(metaTheory, name)}`),
      '--input-type=module',
      '--eval',
      script,
    ], { encoding: 'utf8', env: environment });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      verified: [true, true, true],
      spawn: 'ERR_ACCESS_DENIED',
      externalCorpus: 'ERR_ACCESS_DENIED',
    });
  });
});
