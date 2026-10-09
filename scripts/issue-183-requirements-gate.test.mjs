import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import { loadIssue183Inputs, runIssue183Acceptance, sha256, validateIssue183Inventory, parseCargoAssertions, captureIssue183SourceState, createIssue183ProgressJournal } from './issue-183-requirements.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://github.com/link-foundation/relative-meta-logic/issues/183';
const TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { increment, capabilities } from './implementation.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixture.json', import.meta.url)));
test('increments according to the independent fixture', () => {
  assert.equal(increment(fixture.input), fixture.expected);
  assert.equal(capabilities.increment, true);
});
test('rejects unsupported input', () => {
  assert.throws(() => increment('2'), /number required/);
});
`;

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-acceptance-fixture-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'implementation.mjs'), "export const capabilities = { increment: true };\nexport function increment(value) { if (typeof value !== 'number') throw new Error('number required'); return value + 1; }\n");
  fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ input: 4, expected: 5 }));
  fs.writeFileSync(path.join(root, 'behavior.test.mjs'), TEST);
  const source = { id: 'issue-183', url: SOURCE_URL, originalText: 'Implement integer increment and reject non-numeric input.', requirementIds: ['R1'], classification: 'requirement-bearing' };
  source.bodySha256 = sha256(source.originalText);
  const sources = { schema: 'rml-issue-183-sources/v1', requiredRequirementIds: ['R1'], sources: [source] };
  fs.writeFileSync(path.join(root, 'sources.json'), JSON.stringify(sources));
  const pin = (filename, role) => ({ path: filename, role, sha256: sha256(fs.readFileSync(path.join(root, filename))) });
  const ledger = `${SOURCE_URL}\n| R1 | Increment and reject invalid input. | Complete | Implementation and fixture. |\n`;
  const check = { id: 'increment', kind: 'node-test', testFiles: ['behavior.test.mjs'], files: [pin('implementation.mjs', 'implementation'), pin('fixture.json', 'fixture'), pin('behavior.test.mjs', 'test')], assertions: [{ file: 'behavior.test.mjs', name: 'increments according to the independent fixture', polarity: 'positive' }, { file: 'behavior.test.mjs', name: 'rejects unsupported input', polarity: 'negative' }] };
  const manifest = { schema: 'rml-issue-183-requirements/v1', sourceSnapshot: pin('sources.json', 'source'), checks: [check], requirements: [{ id: 'R1', obligation: 'Increment and reject invalid input.', status: 'Complete', claimedEvidence: 'Implementation and fixture.', remainingGap: 'Closed within the increment fixture scope only.', originalWording: [{ sourceId: 'issue-183', bodySha256: source.bodySha256 }], implementationClaims: [pin('implementation.mjs', 'implementation')], checks: ['increment'], assertionBindings: check.assertions.map(assertion => ({ checkId: check.id, ...assertion })), completionBindings: check.assertions.map(assertion => ({ checkId: check.id, ...assertion })) }] };
  return { root, ledger, manifest, sources, enforceBaseline: false };
}

function mutate(input, filename, transform, repin = false) {
  const location = path.join(input.root, filename);
  fs.writeFileSync(location, transform(fs.readFileSync(location, 'utf8')));
  if (repin) {
    for (const pin of [...input.manifest.checks.flatMap(check => check.files), ...input.manifest.requirements.flatMap(row => row.implementationClaims)]) {
      if (pin.path === filename) pin.sha256 = sha256(fs.readFileSync(location));
    }
  }
}

function failureText(report) {
  return [...report.errors, ...report.checks.map(check => check.error ?? ''), ...report.requirements.flatMap(row => row.errors)].join('\n');
}

function rejected(input, pattern) {
  const report = runIssue183Acceptance(input);
  assert.equal(report.passed, false);
  assert.match(failureText(report), pattern);
  return report;
}

function progressFixture(context) {
  const input = fixture(context);
  fs.writeFileSync(path.join(input.root, '.gitignore'), '.evidence/\n');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: input.root }).status, 0);
  const output = path.join(input.root, '.evidence', 'acceptance.json');
  const readProgress = () => JSON.parse(fs.readFileSync(`${output}.progress.json`, 'utf8'));
  return { input, output, readProgress };
}

describe('execution-backed issue 183 acceptance', () => {
  it('executes positive and negative behavioral assertions and records the actual command/version', context => {
    const report = runIssue183Acceptance(fixture(context));
    assert.equal(report.passed, true, failureText(report));
    assert.equal(report.checks[0].assertions.length, 2);
    assert.equal(report.checks[0].node, process.version);
    assert.equal(report.checks[0].exitCode, 0);
    assert.ok(report.checks[0].command.includes('--test'));
    assert.equal(report.requirements.length, 1);
  });

  it('publishes final reports separately from provisional producer evidence', context => {
    const { input, output, readProgress } = progressFixture(context);
    const journal = createIssue183ProgressJournal(output);
    const before = captureIssue183SourceState(input.root);
    const report = runIssue183Acceptance({ ...input, onCheck: (result, partial) => {
      journal.record(partial);
      const progress = readProgress();
      assert.equal(progress.schema, 'rml-issue-183-acceptance-progress/v1');
      assert.equal(progress.provisional, true);
      assert.equal(progress.passed, false);
      assert.equal(progress.phase, 'running');
      assert.equal(progress.finalReport, undefined);
      assert.equal(progress.sourceState.sha256, before.sha256);
      assert.deepEqual(progress.checks, [result]);
      assert.equal(fs.existsSync(output), false);
    } });
    assert.equal(report.passed, true, failureText(report));
    journal.finalize(report);
    const progress = readProgress();
    const final = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(progress.passed, false);
    assert.equal(progress.provisional, true);
    assert.equal(progress.phase, 'finalized');
    assert.equal(final.schema, 'rml-issue-183-acceptance/v1');
    assert.equal(final.passed, true);
    assert.equal(final.runId, progress.runId);
    assert.equal(progress.finalReport.sha256, sha256(fs.readFileSync(output)));
    assert.deepEqual(final.checks, report.checks);
    assert.equal(captureIssue183SourceState(input.root).sha256, before.sha256);

    // A new invocation starts empty. It never treats the saved successful run
    // as execution evidence, and cannot be confused with that run's final file.
    const next = createIssue183ProgressJournal(output);
    const restarted = readProgress();
    assert.equal(restarted.passed, false);
    assert.equal(restarted.finalReport, undefined);
    assert.deepEqual(restarted.checks, []);
    assert.notEqual(restarted.runId, final.runId);
    mutate(input, 'implementation.mjs', text => text.replace('return value + 1', 'return value - 1'));
    const rerun = runIssue183Acceptance({ ...input, onCheck: (_result, partial) => next.record(partial) });
    assert.equal(rerun.passed, false);
    assert.equal(readProgress().checks[0].passed, false);
    assert.match(readProgress().checks[0].error, /stale or corrupt/);
  });

  it('preserves completed producer receipts when the aggregate is interrupted or times out', async context => {
    for (const mode of ['SIGTERM', 'timeout']) {
      await context.test(mode, async inner => {
        const { input, output, readProgress } = progressFixture(inner);
        input.manifest.checks.push({ ...structuredClone(input.manifest.checks[0]), id: 'unexecuted' });
        fs.writeFileSync(path.join(input.root, 'input.json'), JSON.stringify(input));
        const driver = path.join(input.root, 'run.mjs');
        fs.writeFileSync(driver, `import fs from 'node:fs';
import { runIssue183Acceptance, createIssue183ProgressJournal } from ${JSON.stringify(new URL('./issue-183-requirements.mjs', import.meta.url).href)};
const input = JSON.parse(fs.readFileSync(new URL('./input.json', import.meta.url)));
const journal = createIssue183ProgressJournal(${JSON.stringify(output)});
const report = runIssue183Acceptance({ ...input, onCheck: (result, partial) => {
  journal.record(partial);
  // Pause between producers so the parent can interrupt the aggregate itself.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
} });
journal.finalize(report);
process.exitCode = report.passed ? 0 : 1;
`);
        const before = captureIssue183SourceState(input.root);
        if (mode === 'timeout') {
          const killed = spawnSync(process.execPath, [driver], { cwd: input.root, timeout: 2500, encoding: 'utf8' });
          assert.equal(killed.error?.code, 'ETIMEDOUT');
          assert.notEqual(killed.status, 0);
        } else {
          const child = spawn(process.execPath, [driver], { cwd: input.root, stdio: 'ignore' });
          const closed = once(child, 'close');
          inner.after(() => child.kill('SIGKILL'));
          const deadline = Date.now() + 5000;
          while ((!fs.existsSync(`${output}.progress.json`) || readProgress().checks.length === 0) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.equal(readProgress().checks.length, 1, 'the first real producer must finish before interruption');
          child.kill('SIGTERM');
          const [code, signal] = await closed;
          assert.ok(code !== 0 || signal === 'SIGTERM');
        }
        const progress = readProgress();
        assert.equal(progress.passed, false);
        assert.equal(progress.provisional, true);
        assert.equal(progress.phase, 'running');
        assert.equal(progress.finalReport, undefined);
        assert.equal(fs.existsSync(output), false);
        assert.equal(progress.sourceState.sha256, before.sha256);
        assert.equal(progress.sourceSha256, input.manifest.sourceSnapshot.sha256);
        assert.equal(progress.manifestSha256, sha256(JSON.stringify(input.manifest)));
        assert.equal(progress.ledgerSha256, sha256(input.ledger));
        assert.equal(progress.checks.length, 1);
        const receipt = progress.checks[0];
        assert.equal(receipt.id, 'increment');
        assert.equal(receipt.passed, true);
        assert.equal(receipt.exitCode, 0);
        assert.equal(receipt.assertions.length, 2);
        assert.deepEqual(receipt.inputPins, input.manifest.checks[0].files);
        assert.ok(receipt.command.includes('--test'));
        assert.match(receipt.stdout, /test:pass/);
      });
    }
  });

  it('retains failed and timed-out producer evidence without certifying completion', async context => {
    for (const mode of ['failure', 'timeout']) {
      await context.test(mode, inner => {
        const { input, output, readProgress } = progressFixture(inner);
        const badFile = 'failed.test.mjs';
        const contents = mode === 'timeout'
          ? `${TEST}\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);\n`
          : TEST.replace('fixture.expected)', 'fixture.expected + 1)');
        fs.writeFileSync(path.join(input.root, badFile), contents);
        const failed = structuredClone(input.manifest.checks[0]);
        failed.id = 'failed';
        failed.testFiles = [badFile];
        failed.files.find(pin => pin.role === 'test').path = badFile;
        failed.files.find(pin => pin.role === 'test').sha256 = sha256(contents);
        failed.assertions.forEach(assertion => { assertion.file = badFile; });
        if (mode === 'timeout') failed.timeoutMs = 100;
        input.manifest.checks.push(failed);
        const journal = createIssue183ProgressJournal(output);
        const report = runIssue183Acceptance({ ...input, onCheck: (_result, partial) => journal.record(partial) });
        assert.equal(report.passed, false);
        const progress = readProgress();
        assert.equal(progress.checks.length, 2);
        assert.equal(progress.checks[0].passed, true);
        assert.equal(progress.checks[0].assertions.length, 2);
        assert.equal(progress.checks[1].passed, false);
        assert.match(progress.checks[1].error, /execution failed/);
        assert.equal(progress.passed, false);
        journal.finalize(report);
        assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).passed, false);
        assert.deepEqual(readProgress().checks, report.checks);
      });
    }
  });

  it('preserves every incomplete status and fails completion without erasing its evidence', async context => {
    for (const status of ['Partial', 'Open', 'Blocked by upstream']) {
      await context.test(status, inner => {
        const input = fixture(inner);
        input.ledger = input.ledger.replace('Complete', status);
        input.manifest.requirements[0].status = status;
        const report = rejected(input, /unfinished/);
        assert.equal(report.checks[0].passed, true);
        assert.equal(report.requirements[0].status, status);
      });
    }
  });

  it('rejects an empty ledger and matching empty inventories', context => {
    const input = fixture(context);
    input.ledger = '';
    input.manifest.requirements = [];
    input.sources.requiredRequirementIds = [];
    fs.writeFileSync(path.join(input.root, 'sources.json'), JSON.stringify(input.sources));
    input.manifest.sourceSnapshot.sha256 = sha256(fs.readFileSync(path.join(input.root, 'sources.json')));
    rejected(input, /must not be empty/);
  });

  it('rejects a missing manifest rather than treating missing rows as complete', context => {
    const input = fixture(context);
    input.manifest = null;
    rejected(input, /missing or unsupported requirement manifest/);
  });

  it('rejects duplicate ledger IDs', context => {
    const input = fixture(context);
    input.ledger += input.ledger.split('\n')[1];
    rejected(input, /contains duplicates/);
  });

  it('rejects an omitted manifest row even while the remaining tests pass', context => {
    const input = fixture(context);
    input.manifest.requirements = [];
    rejected(input, /manifest requirement inventory must not be empty/);
  });

  it('rejects deletion of a claimed implementation, test, fixture, or original source', async context => {
    for (const filename of ['implementation.mjs', 'behavior.test.mjs', 'fixture.json', 'sources.json']) {
      await context.test(filename, inner => {
        const input = fixture(inner);
        fs.unlinkSync(path.join(input.root, filename));
        rejected(input, /ENOENT/);
      });
    }
  });

  it('rejects omission from a nonempty manifest while preserving the independent source inventory', context => {
    const input = fixture(context);
    const row = structuredClone(input.manifest.requirements[0]);
    row.id = 'R2';
    input.manifest.requirements.push(row);
    input.ledger += '| R2 | Increment and reject invalid input. | Complete | Implementation and fixture. |\n';
    input.sources.requiredRequirementIds.push('R2');
    input.sources.sources[0].requirementIds.push('R2');
    fs.writeFileSync(path.join(input.root, 'sources.json'), JSON.stringify(input.sources));
    input.manifest.sourceSnapshot.sha256 = sha256(fs.readFileSync(path.join(input.root, 'sources.json')));
    assert.doesNotThrow(() => validateIssue183Inventory(input));
    input.manifest.requirements.pop();
    rejected(input, /manifest omits or reorders required rows/);
  });

  it('rejects duplicate manifest rows', context => {
    const input = fixture(context);
    input.manifest.requirements.push(structuredClone(input.manifest.requirements[0]));
    rejected(input, /manifest requirement inventory contains duplicates/);
  });

  it('rejects original wording corruption even after the outer snapshot is rehashed', context => {
    const input = fixture(context);
    input.sources.sources[0].originalText = 'A different requirement.';
    fs.writeFileSync(path.join(input.root, 'sources.json'), JSON.stringify(input.sources));
    input.manifest.sourceSnapshot.sha256 = sha256(fs.readFileSync(path.join(input.root, 'sources.json')));
    rejected(input, /original wording is corrupt/);
  });

  it('rejects malformed rows that the old regular expression silently omitted', context => {
    const input = fixture(context);
    input.ledger = input.ledger.replace('Implementation and fixture.', 'broken | evidence');
    rejected(input, /malformed issue 183 requirement row/);
  });

  it('rejects a hand-edited status cell and matching labels without execution evidence', context => {
    const input = fixture(context);
    input.ledger = input.ledger.replace('Complete', 'Open');
    rejected(input, /ledger\/manifest mismatch/);
    input.manifest.requirements[0].status = 'Open';
    rejected(input, /unfinished/);
    input.ledger = input.ledger.replace('Open', 'Complete');
    input.manifest.requirements[0].status = 'Complete';
    input.manifest.requirements[0].checks = [];
    input.manifest.requirements[0].assertionBindings = [];
    input.manifest.requirements[0].completionBindings = [];
    input.manifest.checks = [];
    rejected(input, /missing executed positive\/negative/);
  });

  it('detects a removed required test although the remaining ordinary suite is green', context => {
    const input = fixture(context);
    mutate(input, 'behavior.test.mjs', text => text.slice(0, text.indexOf("test('rejects unsupported input'")), true);
    const ordinary = spawnSync(process.execPath, ['--test', 'behavior.test.mjs'], { cwd: input.root, encoding: 'utf8' });
    assert.equal(ordinary.status, 0);
    rejected(input, /required assertion did not execute exactly once: rejects unsupported input/);
  });

  it('detects suppressed execution callbacks despite a zero process exit code', context => {
    const input = fixture(context);
    mutate(input, 'behavior.test.mjs', () => 'process.exit(0);\n', true);
    rejected(input, /required assertion did not execute exactly once|missing live execution callbacks/);
  });

  it('rejects skipped and TODO assertions', async context => {
    for (const modifier of ['skip', 'todo']) {
      await context.test(modifier, inner => {
        const input = fixture(inner);
        mutate(input, 'behavior.test.mjs', text => text.replace("test('rejects unsupported input'", `test.${modifier}('rejects unsupported input'`), true);
        rejected(input, /failed, skipped, or unsupported assertions/);
      });
    }
  });

  it('detects semantics replaced by placeholders even after reviewed input pins are updated', context => {
    const input = fixture(context);
    mutate(input, 'implementation.mjs', text => text.replace('return value + 1', 'return value'), true);
    rejected(input, /execution failed/);
  });

  it('detects a falsified capability declaration through behavior', context => {
    const input = fixture(context);
    mutate(input, 'implementation.mjs', text => text.replace('increment: true', 'increment: false'), true);
    rejected(input, /execution failed/);
  });

  it('does not accept a saved passing report after implementation corruption', context => {
    const input = fixture(context);
    const report = runIssue183Acceptance(input);
    assert.equal(report.passed, true);
    fs.writeFileSync(path.join(input.root, 'old-success.json'), JSON.stringify(report));
    mutate(input, 'implementation.mjs', text => text.replace('return value + 1', 'return value - 1'));
    rejected(input, /stale or corrupt/);
  });

  it('rejects post-execution changes to pinned evidence', context => {
    const input = fixture(context);
    mutate(input, 'behavior.test.mjs', text => `${text}\nfs.appendFileSync(new URL('./fixture.json', import.meta.url), ' ');\n`, true);
    rejected(input, /stale or corrupt/);
  });

  it('rejects paths outside the repository and symlink escapes', async context => {
    for (const kind of ['traversal', 'symlink']) {
      await context.test(kind, inner => {
        const input = fixture(inner);
        if (kind === 'traversal') input.manifest.requirements[0].implementationClaims[0].path = '../implementation.mjs';
        else {
          fs.renameSync(path.join(input.root, 'implementation.mjs'), path.join(input.root, 'real.mjs'));
          fs.symlinkSync('real.mjs', path.join(input.root, 'implementation.mjs'));
        }
        rejected(input, /unsafe repository path|symlink in evidence path/);
      });
    }
  });

  it('does not mistake a declared native validation flag for a native test producer', context => {
    const input = fixture(context);
    input.manifest.requirements[0].nativeValidationRequired = true;
    input.manifest.checks[0].nativeValidation = true;
    rejected(input, /missing native validation producer/);
  });

  it('rejects omitted per-requirement positive or negative assertion edges', context => {
    const input = fixture(context);
    input.manifest.requirements[0].assertionBindings = input.manifest.requirements[0].assertionBindings.filter(binding => binding.polarity === 'positive');
    input.manifest.requirements[0].completionBindings = input.manifest.requirements[0].completionBindings.filter(binding => binding.polarity === 'positive');
    rejected(input, /missing requirement-specific negative assertion binding/);
  });

  it('does not promote a passing partial witness by changing only its completion status', context => {
    const input = fixture(context);
    input.manifest.requirements[0].completionBindings = [];
    input.manifest.requirements[0].status = 'Partial';
    input.ledger = input.ledger.replace('Complete', 'Partial');
    const partial = rejected(input, /unfinished/);
    assert.equal(partial.checks[0].passed, true);
    input.manifest.requirements[0].status = 'Complete';
    input.ledger = input.ledger.replace('Partial', 'Complete');
    const forged = rejected(input, /progress evidence is not completion/);
    assert.equal(forged.checks[0].passed, true);
  });

  it('does not accept an assertion binding to a different check or invented test', context => {
    const input = fixture(context);
    input.manifest.requirements[0].assertionBindings[0].name = 'invented proof';
    rejected(input, /assertion binding has no matching producer assertion/);
  });

  it('parses actual native test receipts and rejects empty filtered ignored or omitted native tests', () => {
    const check = { id: 'native', assertions: [{ name: 'positive', polarity: 'positive' }, { name: 'negative', polarity: 'negative' }] };
    const stdout = 'running 2 tests\ntest positive ... ok\ntest negative ... ok\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n';
    assert.equal(parseCargoAssertions(stdout, check).length, 2);
    for (const altered of [
      '',
      stdout.replace('0 filtered out', '1 filtered out'),
      stdout.replace('0 ignored', '1 ignored'),
      stdout.replace('negative ... ok', 'different ... ok'),
      stdout.replace('test negative ... ok\n', ''),
      stdout + stdout,
    ]) assert.throws(() => parseCargoAssertions(altered, check), /native/);
  });

  it('selects the real completion job for non-code changes without masking failure', () => {
    const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/issue-183-acceptance.yml'), 'utf8');
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /node-version: '22'/);
    assert.match(workflow, /submodules: recursive/);
    for (const permission of ['contents', 'issues', 'pull-requests']) assert.match(workflow, new RegExp(`^  ${permission}: read$`, 'm'));
    assert.doesNotMatch(workflow, /^\s+(?:contents|issues|pull-requests): write$/m);
    assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github.token \}\}/);
    assert.match(workflow, /node scripts\/check-issue-183-completion\.mjs --report/);
    assert.match(workflow, /run-with-cache\.mjs --isolate-output rust\/target -- node scripts\/check-issue-183-completion\.mjs/);
    assert.doesNotMatch(workflow, /^\s*(?:paths|paths-ignore|continue-on-error|workflow_dispatch):/m);
    const gate = workflow.slice(workflow.indexOf('- name: Enforce complete'), workflow.indexOf('- name: Archive'));
    assert.doesNotMatch(gate, /if:|\|\|\s*true|continue-on-error/);
    assert.ok(workflow.indexOf('- name: Archive') < workflow.indexOf('- name: Tear down'));
    assert.match(workflow, /if-no-files-found: error/);
  });

  it('hashes pinned submodule contents and rejects missing or moved source revisions', context => {
    const input = fixture(context);
    const module = path.join(input.root, 'vendor', 'upstream');
    fs.mkdirSync(module, { recursive: true });
    const git = (cwd, ...args) => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(input.root, 'init', '-q');
    git(module, 'init', '-q');
    fs.writeFileSync(path.join(module, 'source.mjs'), 'export const value = 1;\n');
    git(module, 'add', 'source.mjs');
    git(module, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
    const revision = git(module, 'rev-parse', 'HEAD');
    git(input.root, 'update-index', '--add', '--cacheinfo', `160000,${revision},vendor/upstream`);
    const original = captureIssue183SourceState(input.root);
    assert.ok(original.fileCount > 1);
    fs.appendFileSync(path.join(module, 'source.mjs'), '// changed\n');
    assert.notEqual(captureIssue183SourceState(input.root).sha256, original.sha256);
    fs.unlinkSync(path.join(module, 'source.mjs'));
    assert.notEqual(captureIssue183SourceState(input.root).sha256, original.sha256);
    fs.writeFileSync(path.join(module, 'source.mjs'), 'export const value = 2;\n');
    git(module, 'add', 'source.mjs');
    git(module, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'changed');
    assert.throws(() => captureIssue183SourceState(input.root), /differs from its indexed revision/);
    git(module, 'checkout', '--detach', revision);
    fs.rmSync(path.join(module, '.git'), { recursive: true });
    assert.throws(() => captureIssue183SourceState(input.root), /uninitialized source submodule/);
    fs.rmSync(module, { recursive: true });
    assert.throws(() => captureIssue183SourceState(input.root), /missing or unsafe source submodule/);
  });

  it('preserves all reviewed sources and the expanded inventory independently of labels', () => {
    const input = loadIssue183Inputs(ROOT);
    const rows = validateIssue183Inventory(input);
    assert.ok(rows.length >= 164);
    assert.ok(input.sources.conversationCount >= 204);
    assert.equal(input.sources.latestCommentId, '5856764556');
    assert.ok(input.sources.sources.find(source => source.id === 'comment-5856764556').originalText.includes('always-selected required aggregate acceptance job'));
  });
});
