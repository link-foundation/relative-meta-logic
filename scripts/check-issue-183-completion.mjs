#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyIssue183LiveSources, validateReviewedLiveSources } from './issue-183-requirements-live-sources.mjs';
import { runIssue183Acceptance, loadIssue183Inputs, createIssue183ProgressJournal } from './issue-183-requirements.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const offline = rawArgs.includes('--offline');
const args = rawArgs.filter(arg => arg !== '--offline');
if (rawArgs.filter(arg => arg === '--offline').length > 1 || (args.length && (args.length !== 2 || args[0] !== '--report'))) {
  console.error('Usage: node scripts/check-issue-183-completion.mjs [--report path] [--offline]');
  process.exitCode = 2;
} else {
  const progress = args[1] ? createIssue183ProgressJournal(path.resolve(root, args[1])) : null;
  let expectedSources;
  let freshness;
  if (offline) freshness = { passed: false, offline: true, errors: ['Offline diagnostic only: live GitHub freshness was not checked, so completion cannot be certified.'] };
  else {
    try {
      expectedSources = JSON.parse(fs.readFileSync(path.join(root, 'docs/case-studies/issue-183/requirements.live-sources.json'), 'utf8'));
      validateReviewedLiveSources(expectedSources, loadIssue183Inputs(root).sources);
      freshness = await verifyIssue183LiveSources(expectedSources, { token: process.env.GITHUB_TOKEN });
    } catch (error) { freshness = { passed: false, errors: [`Missing or invalid reviewed live-source snapshot: ${error.message}`] }; }
  }
  const report = runIssue183Acceptance({ root, onCheck: (result, partialReport) => {
    progress?.record({ ...partialReport, liveSourcesBefore: freshness });
    console.error(`Producer ${result.id}: ${result.passed ? 'PASS' : 'FAIL'}${result.error ? ` (${result.error.slice(0,600)})` : ''}`);
  } });
  report.liveSourcesBefore = freshness;
  if (freshness.passed) {
    report.liveSourcesAfter = await verifyIssue183LiveSources(expectedSources, { token: process.env.GITHUB_TOKEN });
    if (!report.liveSourcesAfter.passed) report.errors.push(...report.liveSourcesAfter.errors);
  } else report.errors.push(...freshness.errors);
  report.passed = report.passed && freshness.passed && report.liveSourcesAfter?.passed === true;

  progress?.finalize(report);
  for (const error of report.errors) console.error(error);
  for (const row of report.requirements.filter(row => !row.passed)) {
    console.error(`${row.id} (${row.status}): ${row.errors.join('; ')}`);
  }
  console.log(`${report.requirements.filter(row => row.passed).length}/${report.requirements.length} requirements have complete live evidence; ${report.checks.filter(check => check.passed).length}/${report.checks.length} bound producers passed.`);
  if (report.passed) console.log('Issue 183 is complete at the tested source state.');
  else {
    console.error('Issue 183 is not complete. No status label or saved report overrides missing evidence.');
    process.exitCode = 1;
  }
}
