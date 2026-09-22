import { readFileSync, writeFileSync } from 'node:fs';

import { foundationSearchReport } from '../js/src/rml-foundation-search.mjs';

const tableUrl = new URL(
  '../lib/meta-theory/foundation-candidates.json',
  import.meta.url,
);
const universalSource = readFileSync(
  new URL('../lib/meta-theory/universal.lino', import.meta.url),
  'utf8',
);
const alternativeSource = readFileSync(
  new URL('../lib/meta-theory/alternative-foundations.lino', import.meta.url),
  'utf8',
);
const report = foundationSearchReport(universalSource, alternativeSource);
const table = JSON.parse(readFileSync(tableUrl, 'utf8'));

table.schema = 'rml-foundation-candidate-table/v7';
table.ontologyExperiment = report.ontologyExperiment;

table.claimBoundary.proved = [...new Set([
  ...table.claimBoundary.proved.filter(statement =>
    ![
      'the equality partition is the complete invariant of the exhaustive two-occurrence observation contract',
      'structural singleton occurrences emerge in 13 conditional refinements but remain absent in 20',
    ].includes(statement)),
  'binary equality coincidence is complete for the exhaustive fixed-width-two observation contract',
  'the same unlabelled-occurrence and equality vocabulary yields 1, 2, 3, and 5 multiplicity classes at widths one through four',
  'a conditional second equivalence observation produces 33 joint classes whose reference-only projection has five to nine refinements per fibre',
  'the width-four singleton-orbit histogram is 20 classes with zero, 5 with one, 7 with two, and 1 with four singleton orbits',
  'asymmetry provenance separates into 7 base-forced, 5 refinement-present, 1 relational-interaction-only, and 20 symmetric joint classes',
  'the same [2,1,1] base projection has a symmetric refinement countermodel and an interaction-only four-singleton refinement',
])];
table.claimBoundary.notProved = [...new Set([
  ...table.claimBoundary.notProved,
  'that fixed width two is sufficient to characterize links',
  'that the conditional second equivalence observation is fundamental to links',
  'that a conditional invariant singleton is a source, target, or execution role',
  'that finite completeness at widths one through four is an unbounded theorem',
])];

writeFileSync(tableUrl, `${JSON.stringify(table, null, 2)}\n`);
