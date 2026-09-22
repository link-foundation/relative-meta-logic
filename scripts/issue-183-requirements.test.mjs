import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const LEDGER_PATH = path.join(
  REPOSITORY_ROOT,
  'docs/case-studies/issue-183/requirements.md',
);

const REQUIREMENT_SOURCES = [
  'https://github.com/link-foundation/relative-meta-logic/issues/183',
  'https://github.com/link-foundation/relative-meta-logic/pull/184',
  ...[
    5750752869,
    5750869373,
    5750923882,
    5750925476,
    5751189191,
    5752324661,
    5756803396,
    5758516426,
    5760183637,
    5761499497,
    5763894325,
    5764336389,
    5766128876,
    5766158556,
    5766978427,
    5767102441,
    5768051551,
    5768059977,
    5769567009,
    5769569663,
    5772097742,
    5772805558,
    5773411325,
    5773514118,
    5775207546,
    5776265940,
    5777314436,
  ].map(id =>
    `https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-${id}`,
  ),
];

function readLedger() {
  return fs.readFileSync(LEDGER_PATH, 'utf8');
}

describe('issue 183 requirement traceability', () => {
  it('registers every requirement-bearing issue and PR source', () => {
    const ledger = readLedger();

    for (const source of REQUIREMENT_SOURCES) {
      assert.ok(ledger.includes(source), `requirement ledger is missing ${source}`);
    }
  });

  it('tracks a contiguous atomic requirement set without relabelling open research as complete', () => {
    const ledger = readLedger();
    const rows = [...ledger.matchAll(/^\| R(\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)];

    assert.ok(rows.length >= 76, `expected at least 76 requirements, found ${rows.length}`);
    assert.deepEqual(
      rows.map(match => Number(match[1])),
      Array.from({ length: rows.length }, (_, index) => index + 1),
      'requirement identifiers must be unique and contiguous',
    );

    const openRequirements = new Set(['71', '73', '74']);
    for (const [, id, requirement, status, evidence] of rows) {
      if (openRequirements.has(id)) {
        assert.match(status, /^Open(?: |$)/, `R${id} must remain open`);
      } else {
        assert.match(status, /^Complete(?: |$)/, `R${id} is not complete`);
      }
      assert.ok(requirement.trim().length > 0, `R${id} has no requirement text`);
      assert.ok(evidence.includes('`'), `R${id} has no concrete repository evidence`);
    }
  });

  it('states the claim boundary without hiding the external semantic laws', () => {
    const ledger = readLedger();

    for (const statement of [
      'claimsIrreducible: false',
      'two externally primitive S and K contractions',
      'Lean/Rocq cannot authorize RML execution',
      'all possible formal systems',
      'finite executable acceptance scope',
      'globallyMinimal: false',
      'not complete production implementations',
      'asymmetricRankingPermitted: false',
      'OPEN_NO_COMPARABLE_ALTERNATIVE',
      'ORDERED_LINK_REPRESENTATION_UNDERDETERMINES_TESTED_TRANSITIONS',
      'intrinsicTransitionAuthority: UNRESOLVED',
      'structureTransformationSeparation: ASSUMED_BY_EXPERIMENT',
      'OPEN_INDEPENDENT_INVESTIGATION',
      'primitive categories: UNRESOLVED',
      'EXECUTABLE_CONTROLS_ONLY',
      'represented-as-addressed-links',
    ]) {
      assert.ok(ledger.includes(statement), `missing scope statement: ${statement}`);
    }
  });
});
