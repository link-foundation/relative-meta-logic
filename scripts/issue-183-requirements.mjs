import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'docs/case-studies/issue-183';
const DELIVERED_STATUS = /^Complete(?: |$)/;
const TRACKED_STATUS = /^(?:Complete|Partial|Open|Blocked by upstream)(?: |$)/;
const SHA256 = /^[a-f0-9]{64}$/;
const BASELINE_COUNT = 164;
const LATEST_COMMENT = 'comment-5856764556';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function parseIssue183Requirements(ledger) {
  const rows = [];
  for (const line of ledger.split(/\r?\n/)) {
    if (!/^\|\s*R\d+\s*\|/.test(line)) continue;
    const match = line.match(/^\| R(\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);
    if (!match) throw new Error(`malformed issue 183 requirement row: ${line}`);
    rows.push({ id: Number(match[1]), requirement: match[2].trim(), status: match[3].trim(), evidence: match[4].trim() });
  }
  return rows;
}

export function incompleteIssue183Requirements(ledger) {
  return parseIssue183Requirements(ledger).filter(row => !DELIVERED_STATUS.test(row.status));
}

export function assertTrackedIssue183Status(status) {
  if (typeof status !== 'string' || !TRACKED_STATUS.test(status)) {
    throw new Error(`unsupported issue 183 status: ${status}`);
  }
}

export function readIssue183Requirements(filename) {
  return fs.readFileSync(filename, 'utf8');
}

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function nonempty(value, label) {
  requireThat(typeof value === 'string' && value.trim().length > 0, `${label} is missing`);
}

function unique(values, label) {
  requireThat(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  requireThat(new Set(values).size === values.length, `${label} contains duplicates`);
}

// No symlink components, even ones currently pointing back inside the repository.
// This prevents a later retarget from changing which implementation was attested.
function repositoryFile(root, relative) {
  nonempty(relative, 'repository path');
  requireThat(!path.isAbsolute(relative) && !relative.includes('\\') && !relative.split('/').some(part => !part || part === '.' || part === '..'), `unsafe repository path: ${relative}`);
  let current = fs.realpathSync(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    requireThat(!fs.lstatSync(current).isSymbolicLink(), `symlink in evidence path: ${relative}`);
  }
  requireThat(fs.statSync(current).isFile(), `evidence is not a file: ${relative}`);
  return current;
}

function verifyPin(root, pin, label) {
  requireThat(pin && SHA256.test(pin.sha256), `${label} has no valid SHA-256`);
  const file = repositoryFile(root, pin.path);
  requireThat(sha256(fs.readFileSync(file)) === pin.sha256, `${label} is stale or corrupt: ${pin.path}`);
}

export function loadIssue183Inputs(root = ROOT) {
  const ledger = fs.readFileSync(path.join(root, BASE, 'requirements.md'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, BASE, 'requirements.manifest.json'), 'utf8'));
  verifyPin(root, manifest.sourceSnapshot, 'source snapshot');
  const sources = JSON.parse(fs.readFileSync(repositoryFile(root, manifest.sourceSnapshot.path), 'utf8'));
  return { root, ledger, manifest, sources };
}

export function validateIssue183Inventory({ root, ledger, manifest, sources, enforceBaseline = true }) {
  requireThat(manifest?.schema === 'rml-issue-183-requirements/v1', 'missing or unsupported requirement manifest');
  requireThat(sources?.schema === 'rml-issue-183-sources/v1', 'missing or unsupported source snapshot');
  verifyPin(root, manifest.sourceSnapshot, 'source snapshot');
  // The parsed object must actually be the checked snapshot, not caller-supplied claims.
  requireThat(JSON.stringify(JSON.parse(fs.readFileSync(repositoryFile(root, manifest.sourceSnapshot.path), 'utf8'))) === JSON.stringify(sources), 'source snapshot object does not match its file');
  const rows = parseIssue183Requirements(ledger);
  const ids = rows.map(row => `R${row.id}`);
  unique(ids, 'ledger requirement inventory');
  unique(manifest.requirements?.map(row => row.id), 'manifest requirement inventory');
  unique(sources.requiredRequirementIds, 'source requirement inventory');
  const expected = Array.from({ length: ids.length }, (_, index) => `R${index + 1}`);
  requireThat(JSON.stringify(ids) === JSON.stringify(expected), 'ledger IDs must be contiguous and ordered');
  for (const [name, actual] of [['manifest', manifest.requirements.map(row => row.id)], ['source', sources.requiredRequirementIds]]) {
    requireThat(JSON.stringify(actual) === JSON.stringify(ids), `${name} omits or reorders required rows`);
  }
  unique(sources.sources?.map(source => source.id), 'source IDs');
  const sourceMap = new Map(sources.sources.map(source => [source.id, source]));
  if (enforceBaseline) {
    requireThat(ids.length >= BASELINE_COUNT, `requirement inventory fell below reviewed baseline ${BASELINE_COUNT}`);
    requireThat(sourceMap.has('issue-183') && sourceMap.has('pull-184') && sourceMap.has(LATEST_COMMENT), 'missing original issue, PR, or latest review source');
    const comments = sources.sources.filter(source => source.id.startsWith('comment-'));
    requireThat(comments.length >= 204 && comments.length === sources.conversationCount, 'incomplete conversation snapshot');
    requireThat(sourceMap.get(LATEST_COMMENT).url === 'https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5856764556', 'incorrect latest review permalink');
  }
  for (const source of sources.sources) {
    requireThat(typeof source.originalText === 'string', `${source.id} original wording is missing`);
    if (source.classification === 'requirement-bearing') nonempty(source.originalText, `${source.id} original wording`);
    nonempty(source.url, `${source.id} permalink`);
    requireThat(source.bodySha256 === sha256(source.originalText), `${source.id} original wording is corrupt`);
    requireThat(Array.isArray(source.requirementIds), `${source.id} requirement mapping is missing`);
    requireThat(source.requirementIds.every(id => ids.includes(id)), `${source.id} refers to an omitted requirement`);
    requireThat(source.classification === (source.requirementIds.length ? 'requirement-bearing' : 'implementation-report-or-automation'), `${source.id} classification disagrees with its mapped requirements`);
  }
  requireThat(Array.isArray(manifest.checks), 'check registry is missing');
  const checkIds = manifest.checks.map(check => check.id);
  requireThat(new Set(checkIds).size === checkIds.length, 'duplicate check IDs');
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const record = manifest.requirements[index];
    assertTrackedIssue183Status(row.status);
    requireThat(record.obligation === row.requirement && record.status === row.status && record.claimedEvidence === row.evidence, `R${row.id} ledger/manifest mismatch`);
    unique(record.originalWording?.map(ref => ref.sourceId), `R${row.id} original sources`);
    for (const ref of record.originalWording) {
      const source = sourceMap.get(ref.sourceId);
      requireThat(source?.requirementIds.includes(record.id) && ref.bodySha256 === source.bodySha256, `R${row.id} has no authentic mapped source ${ref.sourceId}`);
      requireThat(ledger.includes(source.url), `ledger source register omits ${source.url}`);
    }
    const mapped = sources.sources.filter(source => source.requirementIds.includes(record.id)).map(source => source.id).sort();
    requireThat(JSON.stringify(record.originalWording.map(ref => ref.sourceId).sort()) === JSON.stringify(mapped), `R${row.id} omits a requirement-bearing source`);
    requireThat(Array.isArray(record.implementationClaims) && Array.isArray(record.checks) && Array.isArray(record.assertionBindings) && Array.isArray(record.completionBindings), `R${row.id} evidence inventory is missing`);
    requireThat(record.checks.every(id => checkIds.includes(id)), `R${row.id} refers to a missing check`);
    requireThat(new Set(record.checks).size === record.checks.length, `R${row.id} repeats check IDs`);
    for (const binding of record.assertionBindings) {
      const check = manifest.checks.find(candidate => candidate.id === binding.checkId);
      requireThat(record.checks.includes(binding.checkId) && check?.assertions.some(assertion => assertion.file === binding.file && assertion.name === binding.name && assertion.polarity === binding.polarity), `${record.id} assertion binding has no matching producer assertion`);
    }
    for (const binding of record.completionBindings) {
      requireThat(record.assertionBindings.some(progress => progress.checkId === binding.checkId && progress.file === binding.file && progress.name === binding.name && progress.polarity === binding.polarity), `${record.id} full-scope binding has no matching progress assertion`);
    }
    requireThat(new Set(record.completionBindings.map(binding => `${binding.checkId}:${binding.file}:${binding.name}`)).size === record.completionBindings.length, `${record.id} repeats full-scope bindings`);
    requireThat(new Set(record.assertionBindings.map(binding => `${binding.checkId}:${binding.file}:${binding.name}`)).size === record.assertionBindings.length, `${record.id} repeats assertion bindings`);
    nonempty(record.remainingGap, `R${row.id} gap/closure explanation`);
  }
  return rows;
}

function validateCheck(root, check) {
  nonempty(check.id, 'check ID');
  requireThat(['node-test', 'cargo-test'].includes(check.kind), `${check.id} has unsupported producer kind; native evidence cannot be replaced by a declaration`);
  unique(check.testFiles, `${check.id} test files`);
  if (check.kind === 'cargo-test') {
    requireThat(/^[a-zA-Z0-9_]+$/.test(check.testTarget) && check.testFiles.length === 1 && check.testFiles[0] === `rust/tests/${check.testTarget}.rs`, `${check.id} has an invalid native test target`);
    requireThat(check.files?.some(pin => pin.path === 'rust/Cargo.toml') && check.files?.some(pin => pin.path === 'rust/Cargo.lock'), `${check.id} omits native dependency inputs`);
  }
  unique(check.files?.map(pin => pin.path), `${check.id} pinned inputs`);
  for (const file of check.testFiles) {
    requireThat(check.files.some(pin => pin.path === file && ['test', 'test-and-fixture'].includes(pin.role)), `${check.id} test is not pinned: ${file}`);
  }
  requireThat(check.files.some(pin => pin.role === 'implementation'), `${check.id} has no implementation inputs`);
  requireThat(check.files.some(pin => ['fixture', 'test-and-fixture'].includes(pin.role)), `${check.id} has no independent fixture inputs`);
  for (const pin of check.files) verifyPin(root, pin, check.id);
  unique(check.assertions?.map(assertion => `${assertion.file}:${assertion.name}`), `${check.id} required assertions`);
  for (const assertion of check.assertions) {
    nonempty(assertion.name, `${check.id} assertion name`);
    requireThat(check.testFiles.includes(assertion.file), `${check.id} assertion belongs to an unexecuted test file`);
    requireThat(['positive', 'negative'].includes(assertion.polarity), `${check.id} assertion has unsupported polarity`);
  }
  requireThat(check.assertions.some(assertion => assertion.polarity === 'positive') && check.assertions.some(assertion => assertion.polarity === 'negative'), `${check.id} needs positive and negative assertions`);
}

// This is intentionally a producer, not an importer of user-edited evidence JSON.
// Only test:pass events emitted by the Node runner in this process invocation count.
export function executeIssue183Check(root, check) {
  validateCheck(root, check);
  if (check.kind === 'cargo-test') return executeCargoCheck(root, check);
  const reporter = path.join(ROOT, 'scripts/issue-183-requirements-reporter.mjs');
  const nonce = crypto.randomUUID();
  const command = [process.execPath, '--test', `--test-reporter=${reporter}`, '--test-concurrency=1', ...check.testFiles];
  const environment = { ...process.env, RML_ACCEPTANCE_NONCE: nonce };
  // Inherited flags could preload a fabricated reporter or alter test selection.
  delete environment.NODE_OPTIONS;
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_UNIQUE_ID;
  const startedAt = new Date().toISOString();
  const result = spawnSync(command[0], command.slice(1), { cwd: root, env: environment, encoding: 'utf8', timeout: check.timeoutMs ?? 120000, maxBuffer: 32 * 1024 * 1024 });
  const evidence = { id: check.id, command, cwd: root, startedAt, finishedAt: new Date().toISOString(), node: process.version, exitCode: result.status, signal: result.signal, inputPins: check.files, stdout: result.stdout ?? '', stderr: result.stderr ?? '', passed: false, assertions: [] };
  try {
    requireThat(!result.error && result.status === 0 && !result.signal, `${check.id} execution failed: ${result.error?.message ?? result.stderr ?? result.status}`);
    const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    requireThat(events.length > 0 && events.every(event => event.nonce === nonce), `${check.id} missing live execution callbacks`);
    const completed = events.filter(event => event.type === 'test:pass' && event.data.details?.type !== 'suite');
    requireThat(!events.some(event => event.type === 'test:fail' || event.data.skip || event.data.todo), `${check.id} contains failed, skipped, or unsupported assertions`);
    for (const assertion of check.assertions) {
      const matches = completed.filter(event => event.data.name === assertion.name && path.resolve(event.data.file ?? '') === path.resolve(root, assertion.file));
      requireThat(matches.length === 1, `${check.id} required assertion did not execute exactly once: ${assertion.name}`);
      evidence.assertions.push({ ...assertion, passed: true });
    }
    // Tests cannot alter their own inputs or erase artifacts and still certify them.
    for (const pin of check.files) verifyPin(root, pin, check.id);
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.message;
  }
  return evidence;
}

export function parseCargoAssertions(stdout, check) {
  const runs = [...stdout.matchAll(/^running (\d+) tests?$/gm)];
  const summaries = [...stdout.matchAll(/^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;/gm)];
  requireThat(runs.length === 1 && summaries.length === 1, `${check.id} missing unambiguous native execution summary`);
  const summary = summaries[0];
  requireThat(Number(summary[1]) > 0 && summary.slice(2).every(count => Number(count) === 0) && Number(runs[0][1]) === Number(summary[1]), `${check.id} native tests failed, skipped, measured, filtered, or did not run`);
  const names = [...stdout.matchAll(/^test ([^\r\n]+) \.\.\. ok$/gm)].map(match => match[1]);
  requireThat(names.length === Number(summary[1]) && new Set(names).size === names.length, `${check.id} native assertion receipts do not match the execution count`);
  for (const assertion of check.assertions) requireThat(names.includes(assertion.name), `${check.id} required native assertion did not execute: ${assertion.name}`);
  return check.assertions.map(assertion => ({ ...assertion, passed: true }));
}

function executeCargoCheck(root, check) {
  const command = ['cargo', 'test', '--locked', '--jobs', '2', '--manifest-path', 'rust/Cargo.toml', '--test', check.testTarget, '--', '--test-threads=1', '--format=pretty', '--color=never'];
  const startedAt = new Date().toISOString();
  const result = spawnSync(command[0], command.slice(1), { cwd: root, encoding: 'utf8', timeout: check.timeoutMs ?? 1200000, maxBuffer: 32 * 1024 * 1024 });
  const evidence = { id: check.id, command, cwd: root, startedAt, finishedAt: new Date().toISOString(), cargo: version('cargo', ['--version'], root), rustc: version('rustc', ['--version'], root), exitCode: result.status, signal: result.signal, inputPins: check.files, stdout: result.stdout ?? '', stderr: result.stderr ?? '', passed: false, assertions: [] };
  try {
    requireThat(!result.error && result.status === 0 && !result.signal, `${check.id} native execution failed: ${result.error?.message ?? result.stderr ?? result.status}`);
    requireThat(evidence.cargo && evidence.rustc, `${check.id} native tool versions are unavailable`);
    evidence.assertions = parseCargoAssertions(result.stdout, check);
    for (const pin of check.files) verifyPin(root, pin, check.id);
    evidence.passed = true;
  } catch (error) { evidence.error = error.message; }
  return evidence;
}

export function captureIssue183SourceState(root) {
  const entries = [];
  function collect(directory, prefix = '', depth = 0) {
    requireThat(depth <= 16, 'source submodule nesting exceeds the reviewed safety bound');
    const git = args => spawnSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const result = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    if (result.status !== 0 && depth === 0) return false;
    requireThat(result.status === 0, `cannot enumerate source submodule: ${prefix}`);
    const staged = git(['ls-files', '--stage', '-z']);
    requireThat(staged.status === 0, `cannot read source index: ${prefix}`);
    const gitlinks = new Map(staged.stdout.split('\0').filter(Boolean).flatMap(entry => {
      const match = entry.match(/^160000 ([a-f0-9]+) 0\t([\s\S]+)$/);
      return match ? [[match[2], match[1]]] : [];
    }));
    for (const relative of [...new Set(result.stdout.split('\0').filter(Boolean))].sort()) {
      const location = path.join(directory, relative);
      const name = prefix + relative;
      if (gitlinks.has(relative)) {
        requireThat(fs.existsSync(location) && fs.lstatSync(location).isDirectory(), `missing or unsafe source submodule: ${name}`);
        requireThat(version('git', ['rev-parse', '--show-toplevel'], location) === fs.realpathSync(location), `uninitialized source submodule: ${name}`);
        const revision = version('git', ['rev-parse', '--verify', 'HEAD'], location);
        requireThat(revision === gitlinks.get(relative), `source submodule differs from its indexed revision: ${name}`);
        entries.push([name, `GITLINK:${revision}`]);
        collect(location, `${name}/`, depth + 1);
      } else if (!fs.existsSync(location)) entries.push([name, 'MISSING']);
      else {
        const stat = fs.lstatSync(location);
        if (stat.isSymbolicLink()) entries.push([name, `SYMLINK:${fs.readlinkSync(location)}`]);
        else {
          requireThat(stat.isFile(), `unexpected directory in source inventory: ${name}`);
          entries.push([name, sha256(fs.readFileSync(location))]);
        }
      }
    }
    return true;
  }
  if (!collect(root)) return null;
  return { sha256: sha256(JSON.stringify(entries)), fileCount: entries.length, clean: version('git', ['status', '--porcelain'], root) === '' };
}

function version(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function runIssue183Acceptance({ root = ROOT, ledger, manifest, sources, enforceBaseline = true, onCheck = () => {} } = {}) {
  const report = { schema: 'rml-issue-183-acceptance/v1', startedAt: new Date().toISOString(), passed: false, commit: version('git', ['rev-parse', 'HEAD'], root), versions: { node: process.version, platform: process.platform, architecture: process.arch }, errors: [], requirements: [], checks: [] };
  try {
    if (ledger === undefined || manifest === undefined || sources === undefined) {
      const loaded = loadIssue183Inputs(root);
      ledger ??= loaded.ledger;
      manifest ??= loaded.manifest;
      sources ??= loaded.sources;
    }
    const rows = validateIssue183Inventory({ root, ledger, manifest, sources, enforceBaseline });
    report.sourceState = captureIssue183SourceState(root);
    report.manifestSha256 = sha256(JSON.stringify(manifest));
    report.ledgerSha256 = sha256(ledger);
    report.sourceSha256 = manifest.sourceSnapshot.sha256;
    report.versions.git = version('git', ['--version'], root);
    const checkResults = new Map();
    for (const check of manifest.checks) {
      let result;
      try { result = executeIssue183Check(root, check); }
      catch (error) { result = { id: check.id, passed: false, error: error.message }; }
      checkResults.set(check.id, result);
      report.checks.push(result);
      onCheck(result);
    }
    for (const [index, row] of rows.entries()) {
      const record = manifest.requirements[index];
      const errors = [];
      if (!DELIVERED_STATUS.test(row.status)) errors.push(`unfinished: ${row.status}`);
      if (!record.implementationClaims.length) errors.push('missing implementation/file evidence');
      for (const pin of record.implementationClaims) {
        try { verifyPin(root, pin, record.id); } catch (error) { errors.push(error.message); }
      }
      if (!record.checks.length) errors.push('missing executed positive/negative assertion bindings');
      for (const polarity of ['positive', 'negative']) {
        if (!record.assertionBindings.some(binding => binding.polarity === polarity)) errors.push(`missing requirement-specific ${polarity} assertion binding`);
        if (!record.completionBindings.some(binding => binding.polarity === polarity)) errors.push(`missing full-scope ${polarity} completion binding; progress evidence is not completion`);
      }
      for (const id of record.checks) if (!checkResults.get(id)?.passed) errors.push(`check ${id} failed: ${checkResults.get(id)?.error ?? 'missing execution'}`);
      // Native parity must be explicitly fulfilled, never inferred from JS or a prose claim.
      if (record.nativeValidationRequired && !record.checks.some(id => manifest.checks.find(check => check.id === id)?.kind === 'cargo-test')) errors.push('missing native validation producer');
      report.requirements.push({ id: record.id, obligation: row.requirement, status: row.status, originalSources: record.originalWording.map(ref => ref.sourceId), implementation: record.implementationClaims, checks: record.checks, assertionBindings: record.assertionBindings, completionBindings: record.completionBindings, remainingGap: record.remainingGap, passed: errors.length === 0, errors });
    }
    requireThat(sha256(fs.readFileSync(repositoryFile(root, manifest.sourceSnapshot.path))) === report.sourceSha256, 'source snapshot changed during execution');
    const afterState = captureIssue183SourceState(root);
    requireThat(!report.sourceState || report.sourceState.sha256 === afterState?.sha256, 'repository sources changed during execution');
    report.passed = report.requirements.length > 0 && report.requirements.every(row => row.passed) && report.checks.every(check => check.passed);
  } catch (error) {
    report.errors.push(error.message);
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

export function assertIssue183Complete(ledger, options = {}) {
  // Fail fast on explicit incompleteness in unit-test callers. The CLI uses
  // runIssue183Acceptance directly so it still records every bound producer.
  let inputs;
  try {
    inputs = { root: ROOT, ...options, ledger };
    if (inputs.manifest === undefined || inputs.sources === undefined) {
      const loaded = loadIssue183Inputs(inputs.root);
      inputs.manifest ??= loaded.manifest;
      inputs.sources ??= loaded.sources;
    }
    const rows = validateIssue183Inventory(inputs);
    const incomplete = rows.filter(row => !DELIVERED_STATUS.test(row.status));
    if (incomplete.length) {
      throw new Error(incomplete.map(row => `R${row.id} (${row.status})`).join(', '));
    }
  } catch (error) {
    throw new Error(`issue 183 is not complete: ${error.message}`);
  }
  const report = runIssue183Acceptance(inputs);
  if (!report.passed) {
    const failures = [...report.errors, ...report.requirements.filter(row => !row.passed).map(row => `${row.id} (${row.status}): ${row.errors.join('; ')}`)];
    throw new Error(`issue 183 is not complete: ${failures.join(', ')}`);
  }
  return report;
}
