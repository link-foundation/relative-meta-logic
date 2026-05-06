#!/usr/bin/env node
/**
 * Files the planned issues from issues.json on GitHub via `gh issue create`.
 *
 * Usage:
 *   node file-issues.mjs --dry-run          # print bodies, do not call gh
 *   node file-issues.mjs --only=A1,A2       # file just these planned IDs
 *   node file-issues.mjs                    # file everything not yet filed
 *
 * State is persisted to ./state.json so re-running is idempotent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'link-foundation/relative-meta-logic';
const ISSUES_PATH = path.join(__dirname, 'issues.json');
const STATE_PATH = path.join(__dirname, 'state.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyArg = args.find(a => a.startsWith('--only='));
const onlySet = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;

const issues = JSON.parse(fs.readFileSync(ISSUES_PATH, 'utf8'));
const state = fs.existsSync(STATE_PATH)
  ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  : { idToNumber: {} };

function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function topoSort(specs) {
  // Sort so depends-on come first. Cycles fall back to original order.
  const byId = new Map(specs.map(s => [s.id, s]));
  const visited = new Set();
  const order = [];
  function visit(s, stack = new Set()) {
    if (visited.has(s.id)) return;
    if (stack.has(s.id)) return; // cycle: bail
    stack.add(s.id);
    for (const dep of s.depends || []) {
      const depSpec = byId.get(dep);
      if (depSpec) visit(depSpec, stack);
    }
    stack.delete(s.id);
    visited.add(s.id);
    order.push(s);
  }
  for (const s of specs) visit(s);
  return order;
}

function renderBody(spec) {
  const refMap = state.idToNumber;
  const formatRef = (id) => refMap[id] ? `#${refMap[id]}` : `${id} (planned)`;

  const lines = [];
  lines.push(`## Motivation`);
  lines.push(spec.motivation);
  lines.push('');
  lines.push(`## Goal`);
  lines.push(spec.goal);
  lines.push('');
  lines.push(`## LiNo Surface`);
  lines.push(spec.lino || 'n/a.');
  lines.push('');
  lines.push(`## API Surface`);
  lines.push(spec.api || 'n/a.');
  lines.push('');
  lines.push(`## Acceptance Criteria`);
  for (const c of spec.criteria) lines.push(`- [ ] ${c}`);
  lines.push('');
  lines.push(`## References`);
  lines.push(`- Source case study: [\`docs/case-studies/issue-26/\`](https://github.com/link-foundation/relative-meta-logic/tree/main/docs/case-studies/issue-26)`);
  lines.push(`- Comparison docs: [CONCEPTS-COMPARISION.md](https://github.com/link-foundation/relative-meta-logic/blob/main/docs/CONCEPTS-COMPARISION.md), [FEATURE-COMPARISION.md](https://github.com/link-foundation/relative-meta-logic/blob/main/docs/FEATURE-COMPARISION.md)`);
  lines.push(`- Planning issue: #26`);
  lines.push('');
  lines.push(`## Dependencies`);
  if ((spec.depends || []).length === 0) {
    lines.push(`- Depends on: _(none)_`);
  } else {
    lines.push(`- Depends on: ${spec.depends.map(formatRef).join(', ')}`);
  }
  if ((spec.blocks || []).length === 0) {
    lines.push(`- Blocks: _(none)_`);
  } else {
    lines.push(`- Blocks: ${spec.blocks.map(formatRef).join(', ')}`);
  }
  lines.push('');
  if (spec.outOfScope) {
    lines.push(`## Out of Scope`);
    lines.push(spec.outOfScope);
    lines.push('');
  }
  lines.push('---');
  lines.push(`_Plan ID: **${spec.id}**, phase **${spec.phase}**. Filed automatically from the case study under \`docs/case-studies/issue-26/issue-plan.md\` (PR #27)._`);
  return lines.join('\n');
}

function gh(args, options = {}) {
  if (dryRun) {
    console.log('+ gh', args.join(' '));
    return '';
  }
  return execFileSync('gh', args, { encoding: 'utf8', stdio: options.stdio || ['inherit', 'pipe', 'inherit'] });
}

function fileIssue(spec) {
  if (state.idToNumber[spec.id]) {
    console.log(`= ${spec.id}: already filed as #${state.idToNumber[spec.id]}`);
    return;
  }
  const body = renderBody(spec);
  if (dryRun) {
    console.log(`---- ${spec.id} ----`);
    console.log(`title: ${spec.title}`);
    console.log(`labels: ${(spec.labels || []).join(', ')}`);
    console.log(body);
    console.log();
    return;
  }
  const tmpFile = path.join(__dirname, `body-${spec.id}.tmp.md`);
  fs.writeFileSync(tmpFile, body);
  try {
    const labelArgs = (spec.labels || []).flatMap(l => ['--label', l]);
    const out = execFileSync(
      'gh',
      ['issue', 'create', '--repo', REPO, '--title', spec.title, '--body-file', tmpFile, ...labelArgs],
      { encoding: 'utf8' }
    );
    const url = out.trim().split('\n').pop();
    const number = parseInt(url.split('/').pop(), 10);
    if (!number) throw new Error(`Could not parse issue number from gh output: ${out}`);
    state.idToNumber[spec.id] = number;
    saveState();
    console.log(`+ ${spec.id} → #${number} (${url})`);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

function updateIssueBody(spec) {
  const number = state.idToNumber[spec.id];
  if (!number) {
    console.log(`! ${spec.id}: not yet filed, skip update`);
    return;
  }
  const body = renderBody(spec);
  if (dryRun) {
    console.log(`---- update #${number} (${spec.id}) ----`);
    console.log(body);
    console.log();
    return;
  }
  const tmpFile = path.join(__dirname, `body-${spec.id}.update.md`);
  fs.writeFileSync(tmpFile, body);
  try {
    execFileSync(
      'gh',
      ['issue', 'edit', String(number), '--repo', REPO, '--body-file', tmpFile],
      { encoding: 'utf8' }
    );
    console.log(`~ ${spec.id} (#${number}) body updated with real cross-refs`);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

const phase = args.includes('--update') ? 'update' : 'create';

const ordered = topoSort(issues);
for (const spec of ordered) {
  if (onlySet && !onlySet.has(spec.id)) continue;
  if (phase === 'create') fileIssue(spec);
  else updateIssueBody(spec);
}

console.log();
console.log('Done. State saved to', STATE_PATH);
