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

table.schema = 'rml-foundation-candidate-table/v9';
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
  'all 73 base-symmetry-preserving candidate observations at widths one through four retain the base occurrence orbits',
  'the interaction-only refinement changes under a relabelling that leaves its base observation fixed',
  'any deterministic observation derived from the base and commuting with occurrence relabelling preserves every base symmetry',
  'the direct-self [0,0,1] and fresh-external [0,1,2] address patterns have the same reference-only [1,1] projection but are not equivalent under address renaming and occurrence permutation',
  'forgetting the link address collapses 2, 4, 7, and 12 addressable classes to 1, 2, 3, and 5 reference-only classes at widths one through four',
  'every nonempty finite reference-only class has a fresh-address lift and at least one inequivalent self-identifying lift',
  'full equality matrices completely classify ordered address patterns under bijective address renaming',
  'reference-occurrence permutation collapses 0, 1, 8, and 40 additional ordered classes at widths one through four',
  'reference multiplicity plus direct-self-reference multiplicity classifies the declared unlabelled addressable quotient at widths one through four',
  'all 2, 4, 8, and 16 slotwise self-incidence masks occur at widths one through four',
  'slotwise self-incidence is invariant under address renaming and equivariant under reference-slot permutation',
  'reference equality plus the slotwise self-incidence mask classifies ordered address/equality patterns at widths one through four',
])];
table.claimBoundary.notProved = [...new Set([
  ...table.claimBoundary.notProved,
  'that fixed width two is sufficient to characterize links',
  'that the conditional second equivalence observation is fundamental to links',
  'that a conditional invariant singleton is a source, target, or execution role',
  'that finite completeness at widths one through four is an unbounded theorem',
  'that the interaction-only refinement is forced by the tested base observation',
  'that the tested base observation exhausts the intrinsic structure of links',
  'that retaining the link address defines a complete link ontology',
  'that direct self-reference supplies endpoint roles, dynamics, or an execution law',
  'that reference occurrences intrinsically lack slot identity',
  'that the declared unlabelled addressable quotient is a complete representation of links',
  'that reference-slot identity is intrinsic to links',
  'that a self-incident slot is a source, target, or execution role',
])];

writeFileSync(tableUrl, `${JSON.stringify(table, null, 2)}\n`);
