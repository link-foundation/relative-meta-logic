import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXCLUDED_DIRECTORIES, INLINE_LIMIT, JS_CLI, MODES, PARITY_SCHEMA, ROOT, ROOT_TOKEN, buildRecord, compareObservation,
  compareRecord, observeRuntime, parityInputs, readRecord, recordJson, sha256,
} from './runtime-parity.mjs';

const record = readRecord();
const observation = (input, mode) => record.observations.find(item => item.input === input && item.mode === mode);
const input = name => `test-corpus/runtime-parity/inputs/${name}.lino`;
const textOf = (name, mode, stream) => observation(input(name), mode)[stream].text;

describe('repository-wide JavaScript and Rust runtime parity', () => {
  it('records every repository RML source in every command-line mode', () => {
    const inputs = parityInputs();
    assert.equal(record.schema, PARITY_SCHEMA);
    assert.deepEqual(record.inputs.map(item => item.path), inputs);
    assert.deepEqual(record.modes.map(mode => mode.id), MODES.map(mode => mode.id));
    assert.equal(record.observations.length, inputs.length * MODES.length);
    for (const prefix of ['examples/', 'experiments/', 'lib/', 'test-corpus/runtime-parity/inputs/', 'test-corpus/lambda-kernel/']) {
      assert.ok(inputs.some(path => path.startsWith(prefix)), prefix);
    }
    assert.ok(inputs.every(path => !EXCLUDED_DIRECTORIES.some(directory => path.startsWith(`${directory}/`))));
    assert.ok(inputs.every(path => !path.endsWith('/expected.lino')));
    const json = recordJson(record);
    assert.ok(!json.includes(ROOT), 'the record carries no machine path');
    for (const item of record.observations) {
      for (const stream of ['stdout', 'stderr']) {
        assert.equal(item[stream].text !== undefined, item[stream].bytes <= INLINE_LIMIT);
        if (item[stream].text !== undefined) assert.equal(item[stream].sha256, sha256(item[stream].text));
      }
    }
    const statuses = new Set(record.observations.map(item => `${item.mode}:${item.status}`));
    for (const mode of MODES) assert.ok(statuses.has(`${mode.id}:0`) && statuses.has(`${mode.id}:1`), `${mode.id} covers success and failure`);
  });

  it('the JavaScript command line prints exactly the recorded observations', async () => {
    const live = await observeRuntime([process.execPath, JS_CLI]);
    assert.deepEqual(compareRecord(record, live), []);
  });

  it('pins the behaviour both runtimes now share on the divergences the comparison found', () => {
    assert.match(textOf('eval-nat-terms', 'trace', 'stderr'), /eval-nat \(add \(succ zero\) \(succ zero\)\) -> normal-form \(succ \(succ zero\)\) -> 2;/);
    assert.equal(textOf('numeric-exponent', 'run', 'stdout'), '1\n0.000001\n0\n');
    assert.equal(textOf('numeric-formatting', 'run', 'stdout'), '0.3\n0.333333\n0.666667\n0\n0.000001\n0.75\n');
    const rocq = observation('examples/bayesian-inference.lino', 'export-rocq');
    assert.equal(rocq.status, 1);
    assert.equal(rocq.stderr.text, 'Rocq export error: numeric literal `0.01` is outside the Rocq export subset\n');
    assert.equal(textOf('e033-bad-inductive', 'export-rocq', 'stderr'), 'Rocq export error: Inductive declaration for "nat": type name must start with an uppercase letter\n');
    assert.match(textOf('e003-bad-operator-shape', 'run', 'stderr'), /: E003: Unsupported operator definition for "="\n/);
    assert.match(textOf('e003-alias-of-unknown', 'run', 'stderr'), /: E003: Unsupported operator definition for "not"\n/);
    assert.match(textOf('e007-missing-import', 'run', 'stderr'), /: E007: Failed to read import "does-not-exist.lino": file not found\n/);
    assert.match(textOf('e009-dotted-namespace', 'run', 'stderr'), /: E009: Invalid namespace name "foo.bar"\n/);
    assert.match(textOf('e030-bad-mode', 'run', 'stderr'), /: E030: Mode declaration for "plus": unknown flag/);
    assert.match(textOf('e032-bad-relation', 'run', 'stderr'), /: E032: Relation declaration for "plus" must list/);
    assert.match(textOf('e033-bad-inductive', 'run', 'stderr'), /: E033: Inductive declaration for "nat": type name/);
    assert.match(textOf('e036-unproductive', 'run', 'stderr'), /: E036: Coinductive declaration for "Stream" is non-productive/);
    assert.match(textOf('e061-bad-foundation', 'run', 'stderr'), /: E061: foundation form must be `\(foundation <name> …\)`\n/);
    const layers = textOf('equality-layers', 'trace', 'stderr').split('\n').filter(line => line.includes('] equality-layer '))
      .map(line => line.replace(/^\[span [^\]]+:(\d+):1\] equality-layer /, '$1 '));
    assert.deepEqual(layers, ['3 definitional-equality', '4 definitional-equality', '5 numeric-equality', '6 definitional-equality',
      '7 numeric-inequality', '8 structural-equality', '9 numeric-equality']);
    for (const [name, code] of [['e001-unknown-op', 'E001'], ['e004-unknown-aggregator', 'E004'], ['e006-unclosed', 'E006'], ['e010-fresh-clash', 'E010'],
      ['e035-bad-define', 'E035'], ['e038-bad-whnf', 'E038'], ['e040-template-arity', 'E040'], ['e041-unknown-domain', 'E041'],
      ['e062-unknown-foundation', 'E062'], ['e064-bad-proof', 'E064'], ['e065-strict-host', 'E065'], ['eval-nat-arity', 'E067']]) {
      const run = observation(input(name), 'run');
      assert.equal(run.status, 1, name);
      assert.match(run.stderr.text, new RegExp(`: ${code}: `), name);
    }
    assert.match(observation(input('extractable-program'), 'extract-rust').stdout.text, /pub fn combo\(x: f64\) -> f64/);
    assert.match(observation(input('extractable-program'), 'extract-js').stdout.text, /combo/);
  });

  it('rejects drift in exit status, output, coverage, sources and the record itself', context => {
    const root = mkdtempSync(join(tmpdir(), 'rml-runtime-parity-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'examples'));
    mkdirSync(join(root, 'test-corpus', 'certified-translation'), { recursive: true });
    writeFileSync(join(root, 'examples', 'a.lino'), '(? (1 = 1))\n');
    writeFileSync(join(root, 'examples', 'expected.lino'), '(a.lino: 1)\n');
    writeFileSync(join(root, 'test-corpus', 'certified-translation', 'skip.lino'), '(x)\n');
    assert.deepEqual(parityInputs(root), ['examples/a.lino']);
    const long = 'x'.repeat(INLINE_LIMIT + 1);
    const live = MODES.map(mode => ({ input: 'examples/a.lino', mode: mode.id, status: 0, stdout: mode.id === 'trace' ? long : '1\n', stderr: '' }));
    const synthetic = buildRecord(live, { root });
    assert.equal(synthetic.observations.find(item => item.mode === 'trace').stdout.text, undefined, 'long streams are kept by digest');
    assert.deepEqual(compareRecord(synthetic, live, { root }), []);
    const changed = (mode, patch) => live.map(item => (item.mode === mode ? { ...item, ...patch } : item));
    assert.match(compareRecord(synthetic, changed('run', { status: 1 }), { root }).join('\n'), /\[run\]: exit status differs: expected 0, got 1/);
    assert.match(compareRecord(synthetic, changed('run', { stdout: '0\n' }), { root }).join('\n'), /\[run\]: stdout differs at character 0: expected "1\\n", got "0\\n"/);
    assert.match(compareRecord(synthetic, changed('trace', { stdout: `${long}y` }), { root }).join('\n'), /\[trace\]: stdout differs: expected 4097 bytes with sha256/);
    assert.match(compareRecord(synthetic, changed('export-rocq', { stderr: 'boom\n' }), { root }).join('\n'), /\[export-rocq\]: stderr differs/);
    writeFileSync(join(root, 'examples', 'b.lino'), '(? (0 = 0))\n');
    assert.match(compareRecord(synthetic, live, { root }).join('\n'), /examples\/b\.lino: not in the parity record/);
    rmSync(join(root, 'examples', 'b.lino'));
    writeFileSync(join(root, 'examples', 'a.lino'), '(? (1 = 0))\n');
    assert.match(compareRecord(synthetic, live, { root }).join('\n'), /examples\/a\.lino: source changed since it was recorded/);
    writeFileSync(join(root, 'examples', 'a.lino'), '(? (1 = 1))\n');
    const dropped = { ...synthetic, observations: synthetic.observations.filter(item => item.mode !== 'extract-js') };
    assert.match(compareRecord(dropped, live, { root }).join('\n'), /\[extract-js\]: no recorded observation/);
    const twice = { ...synthetic, observations: [...synthetic.observations, synthetic.observations[0]] };
    assert.match(compareRecord(twice, live, { root }).join('\n'), /\[run\]: recorded twice/);
    assert.match(compareRecord({ ...synthetic, schema: 'other' }, live, { root }).join('\n'), /^schema: expected rml-runtime-parity\/v1/);
    assert.deepEqual(compareObservation(synthetic.observations[0], live[0]), []);
  });

  it('reports a live second runtime that drifts from the record', async context => {
    const temp = mkdtempSync(join(tmpdir(), 'rml-runtime-parity-drift-'));
    context.after(() => rmSync(temp, { recursive: true, force: true }));
    const wrapper = join(temp, 'drifting-runtime.mjs');
    const cli = join(ROOT, JS_CLI);
    writeFileSync(wrapper, `import { spawnSync } from 'node:child_process';\nconst result = spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], { encoding: 'utf8' });\nprocess.stdout.write(result.stdout ?? '');\nprocess.stderr.write(result.stderr ?? '');\nif (process.argv.includes('--trace')) process.stderr.write('injected-drift\\n');\nprocess.exitCode = process.argv.includes('export') ? 7 : result.status ?? 1;\n`);
    const inputs = [input('eval-nat-terms'), 'examples/demo.lino'];
    const live = await observeRuntime([process.execPath, wrapper], { inputs });
    const problems = compareRecord(record, live);
    assert.equal(problems.length, 4, problems.join('\n'));
    for (const path of inputs) {
      assert.ok(problems.some(problem => problem.startsWith(`${path} [trace]: stderr differs`) && problem.includes('injected-drift')), path);
      assert.ok(problems.some(problem => problem.startsWith(`${path} [export-rocq]: exit status differs`) && problem.endsWith('got 7')), path);
    }
    const honest = await observeRuntime([process.execPath, cli], { inputs });
    assert.deepEqual(compareRecord(record, honest), [], 'the unmodified runtime matches');
    assert.ok(ROOT_TOKEN.length > 0);
  });
});
