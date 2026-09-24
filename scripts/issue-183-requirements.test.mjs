import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertIssue183Complete,
  assertTrackedIssue183Status,
  incompleteIssue183Requirements,
  parseIssue183Requirements,
} from './issue-183-requirements.mjs';
import {
  ISSUE_183_CLOSING_DIRECTIVE,
  repairIssue183PrBody,
  removeIssue183ClosingDirectives,
} from './issue-183-pr-body.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const LEDGER_PATH = path.join(
  REPOSITORY_ROOT,
  'docs/case-studies/issue-183/requirements.md',
);
function assertIssue183RemainsOpen(body) {
  assert.match(body, /^\s*Advances #183\s*$/m);
  assert.doesNotMatch(body, ISSUE_183_CLOSING_DIRECTIVE);
}

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
    5778389052,
    5778625533,
    5780145503,
    5781219145,
    5782983781,
    5783034346,
    5784120161,
    5785148374,
    5786000580,
    5791257637,
    5796435750,
    5799100000,
    5800815386,
    5802303479,
    5803686269,
    5810243989,
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

  it('tracks a contiguous atomic requirement set with truthful status and evidence', () => {
    const ledger = readLedger();
    const rows = parseIssue183Requirements(ledger);

    assert.ok(rows.length >= 143, `expected at least 143 requirements, found ${rows.length}`);
    assert.deepEqual(
      rows.map(row => row.id),
      Array.from({ length: rows.length }, (_, index) => index + 1),
      'requirement identifiers must be unique and contiguous',
    );

    for (const { id, requirement, status, evidence } of rows) {
      assert.doesNotThrow(() => assertTrackedIssue183Status(status), `R${id}`);
      assert.ok(requirement.length > 0, `R${id} has no requirement text`);
      assert.ok(evidence.includes('`'), `R${id} has no concrete repository evidence or gap`);
    }

    for (const id of [11, 18, 21, 47, 49, 51, 52, 55, 56, 62, 63, 64, 66, 71, 73, 74]) {
      const row = rows.find(candidate => candidate.id === id);
      assert.ok(row, `R${id} is missing`);
      assert.doesNotMatch(row.status, /^Complete(?: |$)/, `R${id} must retain its audited gap`);
    }
  });

  it('keeps traceability validation separate from the deliberately failing final gate', () => {
    const ledger = readLedger();
    const incomplete = incompleteIssue183Requirements(ledger);

    assert.ok(incomplete.length > 0);
    assert.ok(incomplete.some(row => row.id === 137));
    assert.throws(() => assertIssue183Complete(ledger), /issue 183 is not complete/);
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
      'rml-link-ontology-symmetry-experiment/v11',
      'COMPLETE_INVARIANT_FOR_CONTRACT',
      'NOT_DERIVABLE',
      'REPRESENTATION_DEPENDENT',
      'NEGATIVE_CONSTRAINT_ONLY',
      'BINARY_CONTRACT_NOT_EXHAUSTIVE',
      'CONDITIONAL_REFINEMENT_PROBE_NOT_DERIVED',
      'PROVEN_INFORMATION_LOSS',
      'PROVEN_NOT_RECOVERABLE',
      'BASE_FORCED',
      'REFINEMENT_PRESENT_NOT_BASE_FORCED',
      'RELATIONAL_INTERACTION_ONLY',
      '20/5/7/1',
      'BASE_DERIVATION_CANNOT_CREATE_NEW_OCCURRENCE_DISTINCTIONS',
      '255',
      '73',
      'none changes the base occurrence orbits',
      'REFERENCE_ONLY_PROJECTION_NOT_FAITHFUL_FOR_SELF_REFERENCE',
      '2/4/7/12',
      'DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT',
      'UNESTABLISHED_EQUIVALENCE',
      '0/1/8/40',
      'COMPLETE_INVARIANT_FOR_DECLARED_UNLABELLED_ADDRESS_EQUALITY_CONTRACT',
      'CLASSIFIED_PER_ORDERED_REFERENCE_SLOT',
      'RENAMING_INVARIANT_PERMUTATION_EQUIVARIANT',
      '2/4/8/16',
      '5799100000',
      '5800815386',
      '5802303479',
      '5803686269',
      'LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL',
      '2/10/77/799',
      'PROVEN_INFORMATION_LOSS_UNDER_LOCAL_PROJECTION',
      'RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION',
      'PROVEN_NOT_ENTAILED_BY_TESTED_LINK_STRUCTURE',
      '[[3,0,1],[4,1,2],[5,2,0],[6,6,3]]',
      '49 ordered',
      'additional selection/closure law',
      'LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY',
      'ASYMMETRY_PERMITS_BUT_DOES_NOT_FORCE_SELECTION',
      'EXPERIMENTAL_EQUAL-REFERENCE_OBSERVATION_NOT_INTRINSIC_AUTHORITY',
      'opposite equivariant',
      'isomorphic forgery',
      'Formation, selection, justification, and execution',
      'NO_LINK_DERIVED_ADMISSION_VALIDATION_OR_ACTIVATION',
      'AMBIENT_EXISTENCE_DOES_NOT_SELECT_APPLICABILITY',
      'NO_TRANSITION_CREATION_OR_PUBLICATION_EVENT',
      'does not prove that external authority is irreducible',
      'linkedStructuralAdmissibility',
      'linked_structural_admissibility',
      'LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING',
      'EXTERNAL_FINITE_RELATIONAL_CHECK_NOT_LINK_DERIVED_AUTHORITY',
      'ZERO`/`ONE`/`MANY',
      'locally isomorphic evidence remains admissible',
      'formation, matching, admissibility, uniqueness, justification, applicability, admission, activation, and execution',
      'NO_LINK_DERIVED_PUBLICATION_OR_ADMISSION',
      'observer-provided exact-cover checking',
      'logical implication',
      'contract-forced, representation-stable, observer-added',
      'The result uses no set,',
      'category, or type-theory axiom',
      'GITHUB_EVENT_PATH',
      'Advances #183',
    ]) {
      assert.ok(ledger.includes(statement), `missing scope statement: ${statement}`);
    }
  });

  it('rejects issue-closing metadata while foundational requirements remain open', () => {
    assert.doesNotThrow(() => assertIssue183RemainsOpen('Summary\n\nAdvances #183'));
    for (const directive of [
      'Fixes #183',
      'Closes #183',
      'Resolved #183',
      'Fixes #184',
    ]) {
      assert.throws(
        () => assertIssue183RemainsOpen(`Advances #183\n\n${directive}`),
        directive,
      );
    }
    assert.equal(
      removeIssue183ClosingDirectives('Advances #183\n\nFixes #184'),
      'Advances #183',
    );
  });

  it('repairs a premature closing directive without weakening the live guard', async context => {
    const body = [
      'This PR does not complete or close the issue.',
      '',
      'Advances #183',
      '',
      'Fixes #183',
    ].join('\n');
    const updatedBody = removeIssue183ClosingDirectives(body);

    assert.equal(
      updatedBody,
      'This PR does not complete or close the issue.\n\nAdvances #183',
    );
    assertIssue183RemainsOpen(updatedBody);

    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rml-issue-183-pr-body-'),
    );
    context.after(() =>
      fs.rmSync(temporaryDirectory, { recursive: true, force: true }),
    );
    const eventPath = path.join(temporaryDirectory, 'event.json');
    const outputEventPath = path.join(temporaryDirectory, 'repaired-event.json');
    const environmentFile = path.join(temporaryDirectory, 'github-env');
    fs.writeFileSync(
      eventPath,
      JSON.stringify({
        number: 184,
        pull_request: {
          body,
          head: { ref: 'issue-183-7fedfddffe9c' },
        },
      }),
    );

    let requestArguments;
    const result = await repairIssue183PrBody({
      eventPath,
      outputEventPath,
      environmentFile,
      token: 'test-token',
      repository: 'link-foundation/relative-meta-logic',
      request: async (...args) => {
        requestArguments = args;
        return { ok: true, status: 200 };
      },
    });

    assert.equal(result.action, 'updated');
    assert.equal(
      requestArguments[0],
      'https://api.github.com/repos/link-foundation/relative-meta-logic/pulls/184',
    );
    assert.equal(requestArguments[1].method, 'PATCH');
    assert.deepEqual(JSON.parse(requestArguments[1].body), { body: updatedBody });
    assert.equal(
      JSON.parse(fs.readFileSync(outputEventPath, 'utf8')).pull_request.body,
      updatedBody,
    );
    assert.equal(
      fs.readFileSync(environmentFile, 'utf8'),
      `ISSUE_183_REPAIRED_EVENT_PATH=${outputEventPath}\n`,
    );
  });

  it('checks the live PR 184 body supplied by every GitHub PR event', () => {
    const eventPath =
      process.env.ISSUE_183_REPAIRED_EVENT_PATH ?? process.env.GITHUB_EVENT_PATH;
    if (!eventPath) return;

    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    if (event.number !== 184 || !event.pull_request) return;

    assert.equal(event.pull_request.head.ref, 'issue-183-7fedfddffe9c');
    assertIssue183RemainsOpen(event.pull_request.body ?? '');
  });
});
