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

table.schema = 'rml-foundation-candidate-table/v18';
table.ontologyExperiment = report.ontologyExperiment;

table.claimBoundary.proved = [...new Set([
  ...table.claimBoundary.proved.filter(statement =>
    ![
      'the equality partition is the complete invariant of the exhaustive two-occurrence observation contract',
      'structural singleton occurrences emerge in 13 conditional refinements but remain absent in 20',
      'the connected [[0,0,1],[2,1,3],[3,3,0]] structure has identity, self-incidence, shared address, recursive references, and the reverse [3,0] pair but not proposed [0,3]',
      'adding [4,0,3] preserves every composition premise, while binary formation admits all 16 ordered pairs over the four existing addresses and selects none',
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
  'products of local single-link descriptors collapse 10, 77, and 799 shared-address classes to 4, 8, and 16 classes at two through four ordered one-reference links',
  'the external-reference pair [[0,1],[2,3]] and two-link incidence cycle [[0,2],[2,0]] have identical local descriptors but inequivalent shared-address equality patterns',
  'cross-reference equality plus reference-to-link-address incidence classifies the ordered one-reference shared-address contract at one through four links',
  'the recursive association candidates [[3,0,1],[4,3,2]] and [[3,1,2],[4,0,3]] differ with ordered slots but coincide after uniform slot reversal and address renaming',
  'the unordered recursive candidate has two leaf orbits of sizes one and two, so it cannot structurally distinguish all three investigated leaf positions',
  'the connected [[3,0,1],[4,1,2],[5,2,0],[6,6,3]] structure keeps P/Q distinct from K/A/B and has identity, self-incidence, shared address, recursive references, and the reverse [2,0] pair but not proposed [0,2]',
  'adding [7,0,2] preserves every composition premise, while binary formation admits all 49 ordered pairs over the seven existing addresses and selects none',
  'a declared finite exact-cover verifier over linked descriptions, evidence mappings, and context incidence rejects missing, duplicate, foreign, and structurally wrong certificates',
  'finite enumeration of linked certificate bundles observes ZERO, ONE, and MANY admissible candidates without selecting among the MANY case',
  'a reusable local incidence join matches one described record through three linked correspondence witnesses and emits a four-link trace',
  'the same local join can replay a trace root but reversing the mapping interpretation changes the result on identical links',
  'one ordinary witness link conditionally selects [0,2] from [3,0,1] and [4,1,2] under a declared incidence join; reversal or removal destroys that conditional report',
  'the witness-only structure and its [7,0,2] extension satisfy the same join, so the witness does not force creation of the result link',
  'over all 128 completions of the recorded pairs [0,1] and [1,2], no new pair follows without an exclusion; transitive completions make [0,2] follow and circular completions make [2,0] follow',
  'all 16 two-premise position laws are invariant under address renaming, arbitrary substitution, record reordering, and nested encoding; the admitted criteria leave the [0,2] and [2,0] readouts and each commutes with an output swap that fixes no non-degenerate law',
  'with address equality and slot order alone, [3,0,1] and [4,1,2] keep [0,2] and [2,0] in different orbits under named or anonymous ordered slots, while unordered slots make them coincide',
  'the output swap commutes with every address renaming and with the global slot reversal, so in all 4567 extensions of the premises by up to two ordinary records no symmetry fixes exactly one of [0,2] and [2,0]',
  'the achiral [[3,0,1],[4,1,2],[5,3,4]] and its chiral extension by [8,8,9] have identical readouts under all 16 position laws, but only the first has a slot-reversing symmetry',
  'the cycle [[3,0,1],[4,1,2],[5,2,10],[6,10,0]] and detour [[3,0,1],[4,1,2],[5,2,10],[6,0,10]] have the same unordered records, but only the cycle exchanges [0,2] and [2,0] under named slots',
  'the rigid self-referential tag carrier [[20,20,20],[21,20,20]] forces slot identity, yet no symmetry of the tagged premises fixes exactly one of [0,2] and [2,0]',
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
  'that cross-link incidence is a source, target, dependency, transition, or execution edge',
  'that ordered link records or one-reference links are intrinsic to links',
  'that ordered structural positions intrinsically mean function, argument, result, or application',
  'that shared-address incidence entails creation of a composed link',
  'that binary link formation supplies a composition-selection or execution law',
  'that uniform reference-slot reversal is an intrinsic equivalence rather than an observer quotient',
  'that the exact-cover verifier, description, context, or assigned record roles are authorized by link structure',
  'that a locally isomorphic second candidate can be structurally rejected under the tested certificate contract',
  'that conditional admissibility admits, activates, publishes, or executes a candidate',
  'that the linked local-match trace executes or authorizes its own verifier',
  'that choosing an active description or correspondence orientation is intrinsic to the tested link records',
  'that the conditional continuation witness authorizes its join, reading orientation, or creation of a result link',
  'that the recorded links determine which exclusion or output orientation makes a continuation follow',
  'that slot order, chirality, tagged slot identity, or a self-referential slot carrier forces which of [0,2] and [2,0] follows',
  'that the identity correspondence between premise and conclusion slot orders is intrinsic rather than chosen',
])];

writeFileSync(tableUrl, `${JSON.stringify(table, null, 2)}\n`);
