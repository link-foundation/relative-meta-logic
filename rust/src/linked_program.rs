//! Theory-agnostic execution of formal systems represented as LiNo links.
//!
//! The host contracts only S and K, parses representation input, and enforces
//! resource bounds. Closed linked terms implement matching, substitution,
//! ordered rewriting, imports, and inference. Object-language semantics never
//! dispatch through theory-specific Rust callbacks.

mod combinator_kernel;

use crate::{key_of, parse_lino, parse_one, tokenize_one, Node};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

const IMPLEMENTED_HOST_SEMANTIC_OPERATIONS: &[&str] = &[
    "parse-linked-forms",
    "contract-s-link",
    "contract-k-link",
    "enforce-cycle-and-resource-bounds",
];

const REMOVAL_CLASSIFICATIONS: &[&str] = &[
    "INDEPENDENT",
    "DERIVABLE",
    "EQUIVALENT_REENCODING",
    "UNKNOWN",
];

const BOOTSTRAP_METRIC_PROBE_SOURCE: &str = r#"
(linked-program bootstrap-metric-rewrite)
(linked-rewrite bootstrap-metric-rewrite apply
  (from (metric-input ?value))
  (to (metric-output ?value)))
(linked-program bootstrap-metric-import
  (uses bootstrap-metric-rewrite
    (rebind metric-input measured-input)))

(linked-program bootstrap-metric-proof)
(linked-fact bootstrap-metric-proof premise
  (judgement (metric-holds a)))
(linked-inference bootstrap-metric-proof infer
  (premise (metric-holds ?value))
  (conclusion (metric-derived ?value)))
"#;

const PREVIOUS_METRIC_REVISION: &str = "8b39df510a083e5cbe2a56a72e6595aae7b48146";
const PROVENANCE_CLASSIFICATIONS: &[&str] = &[
    "represented-as-addressed-links",
    "derived-inside-system",
    "compiled-from-external-semantic-description",
    "externally-primitive",
];

#[derive(Debug, Clone, PartialEq)]
struct RewriteRule {
    program: String,
    name: String,
    pattern: Node,
    replacement: Node,
}

#[derive(Debug, Clone, PartialEq)]
struct LinkedFact {
    program: String,
    name: String,
    judgement: Node,
}

#[derive(Debug, Clone, PartialEq)]
struct InferenceRule {
    program: String,
    name: String,
    premises: Vec<Node>,
    conclusion: Node,
}

#[derive(Debug, Clone, PartialEq)]
struct ProgramImport {
    program: String,
    rebindings: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq)]
struct LinkedProgram {
    name: String,
    uses: Vec<ProgramImport>,
    rewrites: Vec<RewriteRule>,
    facts: Vec<LinkedFact>,
    inferences: Vec<InferenceRule>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RewriteTraceStep {
    pub program: String,
    pub rule: String,
    pub before: Node,
    pub after: Node,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReductionResult {
    pub term: Node,
    pub trace: Vec<RewriteTraceStep>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkedProof {
    pub judgement: Node,
    pub program: String,
    pub rule: String,
    pub premises: Vec<LinkedProof>,
}

/// Complete theory-independent host boundary for linked-program execution.
#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapKernelReport {
    pub name: &'static str,
    pub status: &'static str,
    pub claims_irreducible: bool,
    pub fixed_point_criterion: &'static str,
    pub operations: Vec<&'static str>,
    pub derived_host_services: Vec<&'static str>,
    pub object_semantics: Vec<&'static str>,
    pub semantic_source: BootstrapSemanticSource,
    pub semantic_law_provenance: Vec<BootstrapSemanticLawProvenance>,
    pub minimization_experiments: Vec<BootstrapMinimizationExperiment>,
    pub trust_graph: BootstrapTrustGraph,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapSemanticSource {
    pub artifact: &'static str,
    pub schema: &'static str,
    pub representation: &'static str,
    pub upstream_model: &'static str,
    pub source_nodes: usize,
    pub runtime_nodes: usize,
    pub roots: usize,
    pub provenance: &'static str,
    pub compiled_from_external_semantic_description: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapSemanticLawProvenance {
    pub operation: &'static str,
    pub provenance: &'static str,
    pub law: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapMinimizationExperiment {
    pub operation: &'static str,
    pub classification: &'static str,
    pub outcome: &'static str,
    pub evidence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapTrustNode {
    pub id: &'static str,
    pub layer: &'static str,
    pub depends_on: Vec<&'static str>,
    pub primitive_reason: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapTrustGraph {
    pub schema: &'static str,
    pub nodes: Vec<BootstrapTrustNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct BootstrapObservedPathSegment {
    pub path: String,
    pub operation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct BootstrapObservedLinkedCapabilitySegment {
    pub path: String,
    pub capability: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapRuntimeTrace {
    pub schema: &'static str,
    pub observed_paths: Vec<String>,
    pub observed_operations: Vec<String>,
    pub observed_linked_capabilities: Vec<String>,
    pub observed_path_segments: Vec<BootstrapObservedPathSegment>,
    pub observed_linked_capability_segments: Vec<BootstrapObservedLinkedCapabilitySegment>,
}

#[derive(Debug, Clone, Default)]
struct BootstrapRuntimeTraceState {
    observed_paths: BTreeSet<String>,
    observed_operations: BTreeSet<String>,
    observed_linked_capabilities: BTreeSet<String>,
    observed_path_segments: BTreeSet<BootstrapObservedPathSegment>,
    observed_linked_capability_segments: BTreeSet<BootstrapObservedLinkedCapabilitySegment>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapPrimitiveMetric {
    pub confirmed: usize,
    pub unknown: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapSelfHostingClosure {
    pub task: &'static str,
    pub linked_capabilities: usize,
    pub linked_capability_names: Vec<&'static str>,
    pub host_capabilities: usize,
    pub host_capability_names: Vec<String>,
    pub total_capabilities: usize,
    pub numerator: usize,
    pub denominator: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapFoundationCompression {
    pub basis: &'static str,
    pub smallest_sufficient_host_operations: usize,
    pub original_host_operations: usize,
    pub candidate_operations: Vec<&'static str>,
    pub sufficient_operations: Vec<&'static str>,
    pub numerator: usize,
    pub denominator: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapCurrentMetrics {
    pub total_host_semantic_operations: usize,
    pub independent_host_primitives: BootstrapPrimitiveMetric,
    pub derived_host_semantic_services: usize,
    pub duplicated_semantic_capabilities: usize,
    pub object_specific_host_semantics: usize,
    pub undocumented_semantic_paths: usize,
    pub self_hosting_closure: BootstrapSelfHostingClosure,
    pub foundation_compression: BootstrapFoundationCompression,
    pub residual_semantic_basis: BootstrapResidualSemanticBasis,
    pub external_semantic_information: BootstrapExternalSemanticInformation,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapExternalSemanticInformation {
    pub independent_laws: usize,
    pub law_names: Vec<&'static str>,
    pub provenance: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapResidualSemanticBasis {
    pub operations: Vec<&'static str>,
    pub experimentally_necessary: usize,
    pub equivalent_one_rule_bases: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapHostSemanticLayer {
    pub layer: &'static str,
    pub count: usize,
    pub operations: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapRemovalExperiment {
    pub operation: &'static str,
    pub classification: &'static str,
    pub baseline_preserved: bool,
    pub observed_failure: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapHostLinkedDuplication {
    pub capability: &'static str,
    pub host_operations: Vec<&'static str>,
    pub linked_evidence_rules: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapLinkedCapability {
    pub capability: &'static str,
    pub observed_paths: Vec<String>,
    pub evidence_rules: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapRuntimeTrustGraphCoverage {
    pub documented_observed_paths: usize,
    pub total_observed_paths: usize,
    pub documented_observed_path_segments: usize,
    pub total_observed_path_segments: usize,
    pub undocumented_paths: Vec<String>,
    pub undocumented_operations: Vec<String>,
    pub undocumented_path_segments: Vec<BootstrapObservedPathSegment>,
    pub trace: BootstrapRuntimeTrace,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapMetricComparison {
    pub metric: &'static str,
    pub previous: Option<String>,
    pub current: String,
    pub delta: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapMetricsReport {
    pub schema: &'static str,
    pub previous_revision: &'static str,
    pub measurement_scope: &'static str,
    pub provenance_classifications: Vec<&'static str>,
    pub removal_classifications: Vec<&'static str>,
    pub current: BootstrapCurrentMetrics,
    pub semantic_provenance: BootstrapSemanticProvenance,
    pub foundation_search_experiments: Vec<BootstrapFoundationSearchExperiment>,
    pub host_semantic_layers: Vec<BootstrapHostSemanticLayer>,
    pub removal_experiments: Vec<BootstrapRemovalExperiment>,
    pub host_linked_duplications: Vec<BootstrapHostLinkedDuplication>,
    pub linked_self_hosting_capabilities: Vec<BootstrapLinkedCapability>,
    pub runtime_trust_graph_coverage: BootstrapRuntimeTrustGraphCoverage,
    pub comparison: Vec<BootstrapMetricComparison>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapProvenanceItem {
    pub id: &'static str,
    pub provenance: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapEliminatedSource {
    pub id: &'static str,
    pub provenance: &'static str,
    pub present: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapSemanticProvenance {
    pub authoritative_source: BootstrapSemanticSource,
    pub derived_capabilities: Vec<BootstrapProvenanceItem>,
    pub eliminated_external_sources: Vec<BootstrapEliminatedSource>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapFoundationSearchExperiment {
    pub candidate: &'static str,
    pub classification: &'static str,
    pub surface_law_count: usize,
    pub residual_external_semantic_law_count: usize,
    pub baseline_preserved: Option<bool>,
    pub observed_failure: String,
    pub experiment_scope: Option<&'static str>,
    pub observed_external_operations: Vec<&'static str>,
    pub semantic_information_reduced: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ExecutionBasis {
    #[default]
    ClosedSk,
    DirectStructural,
    HornRelational,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IntrinsicLinkInterpretation {
    pub id: &'static str,
    pub input: Node,
    pub output: Node,
    pub preserves_link_formation: bool,
    pub renaming_invariant: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkModelAssumption {
    pub id: &'static str,
    pub status: &'static str,
    pub role: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FoundationalOpenQuestion {
    pub id: &'static str,
    pub status: &'static str,
    pub question: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImportedPrimitiveCategory {
    pub id: &'static str,
    pub provenance: &'static str,
    pub foundational_status: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAssumption {
    pub id: &'static str,
    pub provenance: &'static str,
    pub role: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyCanonicalClass {
    pub signature: &'static str,
    pub representative: Vec<usize>,
    pub orbit: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyRepresentationAgreement {
    pub encoding: &'static str,
    pub same_reference: &'static str,
    pub distinct_references: &'static str,
    pub invariant_across_all_actions: bool,
    pub same_reference_output: Vec<usize>,
    pub distinct_references_output: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAutomorphism {
    pub occurrence_permutation: Vec<usize>,
    pub reference_permutation: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySelfMap {
    pub id: &'static str,
    pub mapping: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyDistinctReferenceSymmetry {
    pub automorphisms: Vec<LinkOntologyAutomorphism>,
    pub occurrence_orbits: Vec<Vec<usize>>,
    pub unary_selectors_examined: usize,
    pub invariant_unary_selectors: Vec<Vec<usize>>,
    pub invariant_singleton_selector_exists: bool,
    pub total_self_maps_examined: usize,
    pub equivariant_self_maps: Vec<LinkOntologySelfMap>,
    pub unique_equivariant_self_map: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyReificationCountermodel {
    pub id: &'static str,
    pub has_link_identity: bool,
    pub projected_observation: &'static str,
    pub projection: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyResult {
    pub id: &'static str,
    pub result: &'static str,
    pub evidence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySymmetryReport {
    pub schema: &'static str,
    pub question: &'static str,
    pub starting_contract: &'static str,
    pub occurrence_count: usize,
    pub assumptions: Vec<LinkOntologyAssumption>,
    pub deliberately_absent: Vec<&'static str>,
    pub carrier_sizes_examined: Vec<usize>,
    pub support_restriction: &'static str,
    pub assignments_examined: usize,
    pub group_actions_examined: usize,
    pub action_applications_examined: usize,
    pub canonical_classes: Vec<LinkOntologyCanonicalClass>,
    pub complete_invariant: &'static str,
    pub representation_agreement: Vec<LinkOntologyRepresentationAgreement>,
    pub distinct_reference_symmetry: LinkOntologyDistinctReferenceSymmetry,
    pub reification_countermodels: Vec<LinkOntologyReificationCountermodel>,
    pub results: Vec<LinkOntologyResult>,
    pub admissible_conclusion: &'static str,
    pub remaining_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkRepresentationBoundaryReport {
    pub classification: &'static str,
    pub investigated_object: &'static str,
    pub link_ontology_covered: bool,
    pub representation_exhaustiveness_established: bool,
    pub intrinsic_transition_authority: &'static str,
    pub structure_transformation_separation: &'static str,
    pub transition_externality: &'static str,
    pub model_assumptions: Vec<LinkModelAssumption>,
    pub shared_input: Node,
    pub representation_signature: Vec<&'static str>,
    pub interpretations: Vec<IntrinsicLinkInterpretation>,
    pub unique_transition_selected: bool,
    pub admissible_conclusion: &'static str,
    pub prohibited_conclusions: Vec<&'static str>,
    pub next_search_constraint: &'static str,
    pub foundational_status: &'static str,
    pub investigation_status: &'static str,
    pub open_questions: Vec<FoundationalOpenQuestion>,
    pub provenance_questions: Vec<&'static str>,
    pub imported_primitive_categories: Vec<ImportedPrimitiveCategory>,
    pub existing_candidates_role: &'static str,
    pub existing_candidates_constrain_search: bool,
    pub target_architecture_selected: bool,
    pub comparison_scope: &'static str,
    pub acceptance_criterion: &'static str,
}

fn finite_permutations(values: &[usize]) -> Vec<Vec<usize>> {
    if values.is_empty() {
        return vec![Vec::new()];
    }
    let mut output = Vec::new();
    for (index, value) in values.iter().enumerate() {
        let mut rest = values.to_vec();
        rest.remove(index);
        for permutation in finite_permutations(&rest) {
            let mut result = vec![*value];
            result.extend(permutation);
            output.push(result);
        }
    }
    output
}

fn finite_assignments(width: usize, carrier_size: usize) -> Vec<Vec<usize>> {
    fn extend(
        width: usize,
        carrier_size: usize,
        prefix: &mut Vec<usize>,
        output: &mut Vec<Vec<usize>>,
    ) {
        if prefix.len() == width {
            output.push(prefix.clone());
            return;
        }
        for value in 0..carrier_size {
            prefix.push(value);
            extend(width, carrier_size, prefix, output);
            prefix.pop();
        }
    }

    let mut output = Vec::new();
    extend(width, carrier_size, &mut Vec::new(), &mut output);
    output
}

fn surjective_finite_assignments(width: usize, carrier_size: usize) -> Vec<Vec<usize>> {
    finite_assignments(width, carrier_size)
        .into_iter()
        .filter(|assignment| {
            assignment.iter().copied().collect::<BTreeSet<_>>().len() == carrier_size
        })
        .collect()
}

fn ontology_observation_actions(carrier_size: usize) -> Vec<LinkOntologyAutomorphism> {
    let occurrence_permutations = finite_permutations(&[0, 1]);
    let references = (0..carrier_size).collect::<Vec<_>>();
    let reference_permutations = finite_permutations(&references);
    let mut output = Vec::new();
    for occurrence_permutation in occurrence_permutations {
        for reference_permutation in &reference_permutations {
            output.push(LinkOntologyAutomorphism {
                occurrence_permutation: occurrence_permutation.clone(),
                reference_permutation: reference_permutation.clone(),
            });
        }
    }
    output
}

fn apply_ontology_action(assignment: &[usize], action: &LinkOntologyAutomorphism) -> Vec<usize> {
    action
        .occurrence_permutation
        .iter()
        .map(|occurrence| action.reference_permutation[assignment[*occurrence]])
        .collect()
}

fn ontology_observation_orbit(assignment: &[usize]) -> Vec<Vec<usize>> {
    ontology_observation_actions(assignment.iter().copied().collect::<BTreeSet<_>>().len())
        .iter()
        .map(|action| apply_ontology_action(assignment, action))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn first_occurrence_normal_form(assignment: &[usize]) -> Vec<usize> {
    let mut names = BTreeMap::new();
    let mut next_name = 0;
    assignment
        .iter()
        .map(|reference| {
            *names.entry(*reference).or_insert_with(|| {
                let name = next_name;
                next_name += 1;
                name
            })
        })
        .collect()
}

fn ontology_equality_matrix(assignment: &[usize]) -> Vec<usize> {
    assignment
        .iter()
        .flat_map(|left| {
            assignment
                .iter()
                .map(move |right| usize::from(left == right))
        })
        .collect()
}

fn ontology_multiplicity_spectrum(assignment: &[usize]) -> Vec<usize> {
    let mut counts = BTreeMap::new();
    for reference in assignment {
        *counts.entry(reference).or_insert(0) += 1;
    }
    let mut output = counts.into_values().collect::<Vec<_>>();
    output.sort_by(|left, right| right.cmp(left));
    output
}

fn ontology_observation_signature(assignment: &[usize]) -> &'static str {
    if assignment[0] == assignment[1] {
        "same-reference"
    } else {
        "distinct-references"
    }
}

fn ontology_encoding_is_invariant(
    observations: &[Vec<usize>],
    encode: fn(&[usize]) -> Vec<usize>,
) -> bool {
    observations.iter().all(|observation| {
        ontology_observation_actions(observation.iter().copied().collect::<BTreeSet<_>>().len())
            .iter()
            .all(|action| {
                encode(observation) == encode(&apply_ontology_action(observation, action))
            })
    })
}

fn finite_invariant_subsets(size: usize, permutations: &[Vec<usize>]) -> Vec<Vec<usize>> {
    (0..(1 << size))
        .map(|mask| {
            (0..size)
                .filter(|index| mask & (1 << index) != 0)
                .collect::<Vec<_>>()
        })
        .filter(|subset| {
            permutations.iter().all(|permutation| {
                let mut transformed = subset
                    .iter()
                    .map(|index| permutation[*index])
                    .collect::<Vec<_>>();
                transformed.sort_unstable();
                transformed == *subset
            })
        })
        .collect()
}

fn finite_maps_commute(left: &[usize], right: &[usize]) -> bool {
    (0..left.len()).all(|index| left[right[index]] == right[left[index]])
}

/// Exhaust the representation-independent consequences of observing two
/// unlabelled reference occurrences plus equality. This is not an evaluator
/// or a fourth foundation architecture: it enumerates every finite assignment,
/// quotients by occurrence permutations and reference renamings, and derives the
/// surviving symmetry facts.
pub fn link_ontology_symmetry_report() -> LinkOntologySymmetryReport {
    let occurrence_count = 2;
    let observations = (1..=occurrence_count)
        .flat_map(|carrier_size| surjective_finite_assignments(occurrence_count, carrier_size))
        .collect::<Vec<_>>();
    let mut classes = BTreeMap::new();
    for observation in &observations {
        let orbit = ontology_observation_orbit(observation);
        let representative = orbit[0].clone();
        classes
            .entry(representative.clone())
            .or_insert_with(|| LinkOntologyCanonicalClass {
                signature: ontology_observation_signature(observation),
                representative,
                orbit,
            });
    }
    let canonical_classes = classes.into_values().collect::<Vec<_>>();

    let same_reference = vec![0, 0];
    let distinct_references = vec![0, 1];
    let representation_agreement = vec![
        LinkOntologyRepresentationAgreement {
            encoding: "first-occurrence-normal-form",
            same_reference: ontology_observation_signature(&same_reference),
            distinct_references: ontology_observation_signature(&distinct_references),
            invariant_across_all_actions: ontology_encoding_is_invariant(
                &observations,
                first_occurrence_normal_form,
            ),
            same_reference_output: first_occurrence_normal_form(&same_reference),
            distinct_references_output: first_occurrence_normal_form(&distinct_references),
        },
        LinkOntologyRepresentationAgreement {
            encoding: "occurrence-equality-matrix",
            same_reference: ontology_observation_signature(&same_reference),
            distinct_references: ontology_observation_signature(&distinct_references),
            invariant_across_all_actions: ontology_encoding_is_invariant(
                &observations,
                ontology_equality_matrix,
            ),
            same_reference_output: ontology_equality_matrix(&same_reference),
            distinct_references_output: ontology_equality_matrix(&distinct_references),
        },
        LinkOntologyRepresentationAgreement {
            encoding: "reference-multiplicity-spectrum",
            same_reference: ontology_observation_signature(&same_reference),
            distinct_references: ontology_observation_signature(&distinct_references),
            invariant_across_all_actions: ontology_encoding_is_invariant(
                &observations,
                ontology_multiplicity_spectrum,
            ),
            same_reference_output: ontology_multiplicity_spectrum(&same_reference),
            distinct_references_output: ontology_multiplicity_spectrum(&distinct_references),
        },
    ];

    let automorphisms = ontology_observation_actions(2)
        .into_iter()
        .filter(|action| apply_ontology_action(&distinct_references, action) == distinct_references)
        .collect::<Vec<_>>();
    let occurrence_automorphisms = automorphisms
        .iter()
        .map(|action| action.occurrence_permutation.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let occurrence_orbit = occurrence_automorphisms
        .iter()
        .map(|permutation| permutation[0])
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let invariant_unary_selectors =
        finite_invariant_subsets(occurrence_count, &occurrence_automorphisms);
    let self_maps = finite_assignments(occurrence_count, occurrence_count);
    let equivariant_self_maps = self_maps
        .iter()
        .filter(|mapping| {
            occurrence_automorphisms
                .iter()
                .all(|automorphism| finite_maps_commute(mapping, automorphism))
        })
        .map(|mapping| LinkOntologySelfMap {
            id: if mapping == &[0, 1] {
                "identity"
            } else {
                "swap"
            },
            mapping: mapping.clone(),
        })
        .collect::<Vec<_>>();
    let distinct_reference_symmetry = LinkOntologyDistinctReferenceSymmetry {
        automorphisms,
        occurrence_orbits: vec![occurrence_orbit],
        unary_selectors_examined: 1 << occurrence_count,
        invariant_singleton_selector_exists: invariant_unary_selectors
            .iter()
            .any(|selector| selector.len() == 1),
        invariant_unary_selectors,
        total_self_maps_examined: self_maps.len(),
        unique_equivariant_self_map: equivariant_self_maps.len() == 1,
        equivariant_self_maps,
    };

    let unreified_projection = first_occurrence_normal_form(&distinct_references);
    let reified_incidence_references = vec![0, 1];
    let reified_projection = first_occurrence_normal_form(&reified_incidence_references);
    let reification_countermodels = vec![
        LinkOntologyReificationCountermodel {
            id: "unreified-occurrence-pair",
            has_link_identity: false,
            projected_observation: ontology_observation_signature(&unreified_projection),
            projection: unreified_projection,
        },
        LinkOntologyReificationCountermodel {
            id: "reified-incidence-star",
            has_link_identity: true,
            projected_observation: ontology_observation_signature(&reified_projection),
            projection: reified_projection,
        },
    ];

    LinkOntologySymmetryReport {
        schema: "rml-link-ontology-symmetry-experiment/v1",
        question: "Which facts survive when a two-occurrence reference observation is quotiented by occurrence permutation, reference renaming, and representation change?",
        starting_contract: "unoriented-binary-reference-observation",
        occurrence_count,
        assumptions: vec![
            LinkOntologyAssumption {
                id: "two-unlabelled-reference-occurrences",
                provenance: "EXPERIMENTAL_OBSERVATION_CONTRACT",
                role: "fixes only the arity of the investigated observation",
            },
            LinkOntologyAssumption {
                id: "reference-equality",
                provenance: "EXPERIMENTAL_OBSERVATION_CONTRACT",
                role: "permits observation of whether the two occurrences coincide",
            },
        ],
        deliberately_absent: vec![
            "link identity",
            "endpoint order",
            "source/target roles",
            "passivity",
            "time",
            "execution law",
        ],
        carrier_sizes_examined: vec![1, 2],
        support_restriction:
            "the carrier is exactly the set of observed references; unused references are discarded",
        assignments_examined: observations.len(),
        group_actions_examined: (1..=occurrence_count)
            .map(|carrier_size| ontology_observation_actions(carrier_size).len())
            .sum(),
        action_applications_examined: observations
            .iter()
            .map(|observation| {
                ontology_observation_actions(
                    observation.iter().copied().collect::<BTreeSet<_>>().len(),
                )
                .len()
            })
            .sum(),
        canonical_classes,
        complete_invariant: "equality partition of the two reference occurrences",
        representation_agreement,
        distinct_reference_symmetry,
        reification_countermodels,
        results: vec![
            LinkOntologyResult {
                id: "endpoint-direction",
                result: "NOT_DERIVABLE",
                evidence: "The distinct-reference class has one occurrence orbit and no automorphism-invariant singleton selector; choosing a source is changed by its occurrence-swap automorphism.",
            },
            LinkOntologyResult {
                id: "reified-link-identity",
                result: "REPRESENTATION_DEPENDENT",
                evidence: "Unreified and reified incidence representations project to the same observation while disagreeing about whether a distinct link identity exists.",
            },
            LinkOntologyResult {
                id: "reference-equality-pattern",
                result: "COMPLETE_INVARIANT_FOR_CONTRACT",
                evidence: "Exhaustive quotienting produces exactly the same-reference and distinct-references classes, and three independent encodings distinguish exactly those classes.",
            },
            LinkOntologyResult {
                id: "structure-transformation-separation",
                result: "NON_ABSOLUTE_FOR_SYMMETRIES",
                evidence: "Identity and endpoint swap are derived as automorphisms of the observation itself; they are structural symmetries, not imported execution steps.",
            },
            LinkOntologyResult {
                id: "representation-independent-authority",
                result: "NEGATIVE_CONSTRAINT_ONLY",
                evidence: "A representation-independent assertion must be constant on each computed orbit, which rejects an intrinsic source/target choice but supplies no positive execution law.",
            },
            LinkOntologyResult {
                id: "intrinsic-dynamics",
                result: "NOT_SELECTED",
                evidence: "Exactly two self-maps commute with every computed symmetry: identity and swap. The static contract does not select either as a dynamic law.",
            },
        ],
        admissible_conclusion: "For the exhaustive two-occurrence contract, equality coincidence is the complete representation-independent invariant. The contract cannot select source versus target or a unique self-map, and reification does not survive the tested projection.",
        remaining_boundary: "This experiment eliminates properties from one minimal observational contract; it does not define a link ontology, prove that the contract is exhaustive of links, or turn a structural automorphism into execution semantics.",
    }
}

/// Source-compatible name for the legacy intrinsic-authority report type.
pub type IntrinsicLinkAuthorityReport = LinkRepresentationBoundaryReport;

#[derive(Debug, Clone, PartialEq)]
pub struct FoundationComparisonEligibility {
    pub eligible: bool,
    pub exclusion_reasons: Vec<&'static str>,
}

/// Apply the same comparison-cohort gate as the JavaScript foundation report.
pub fn foundation_comparison_eligibility(
    linked_capabilities: usize,
    host_self_semantic_duplication: usize,
    external_semantic_source_descriptions: usize,
    runtime_trust_coverage_complete: bool,
) -> FoundationComparisonEligibility {
    let mut exclusion_reasons = Vec::new();
    let total_capabilities = linked_capabilities + host_self_semantic_duplication;
    if linked_capabilities != total_capabilities {
        exclusion_reasons.push("INCOMPLETE_SELF_HOSTING_CLOSURE");
    }
    if host_self_semantic_duplication != 0 {
        exclusion_reasons.push("HOST_SELF_SEMANTIC_DUPLICATION");
    }
    if external_semantic_source_descriptions != 0 {
        exclusion_reasons.push("EXTERNAL_SEMANTIC_SOURCE_DESCRIPTION");
    }
    if !runtime_trust_coverage_complete {
        exclusion_reasons.push("INCOMPLETE_RUNTIME_TRUST_COVERAGE");
    }
    FoundationComparisonEligibility {
        eligible: exclusion_reasons.is_empty(),
        exclusion_reasons,
    }
}

fn rename_authority_witness_atoms(node: &Node) -> Node {
    match node {
        Node::Leaf(value) if value == "left" => Node::Leaf("renamed-left".to_string()),
        Node::Leaf(value) if value == "right" => Node::Leaf("renamed-right".to_string()),
        Node::Leaf(value) => Node::Leaf(value.clone()),
        Node::List(children) => Node::List(
            children
                .iter()
                .map(rename_authority_witness_atoms)
                .collect(),
        ),
    }
}

fn reverse_link_endpoints(node: &Node) -> Node {
    let Node::List(children) = node else {
        return node.clone();
    };
    if children.len() != 3 || children.first() != Some(&Node::Leaf("link".to_string())) {
        return node.clone();
    }
    Node::List(vec![
        children[0].clone(),
        children[2].clone(),
        children[1].clone(),
    ])
}

fn is_link_form(node: &Node) -> bool {
    matches!(
        node,
        Node::List(children)
            if children.len() == 3
                && children.first() == Some(&Node::Leaf("link".to_string()))
    )
}

/// Exhibit two different transition functions over one host representation.
///
/// Both interpretations preserve link formation and commute with atom
/// renaming, yet produce different results. This only establishes that the
/// tested signature does not select between them. Passivity, external
/// transition, ordered endpoints, and the separation of structure from
/// transformation are inputs to this experiment, not facts derived about the
/// ontology of links.
pub fn link_representation_boundary_report() -> LinkRepresentationBoundaryReport {
    let shared_input = Node::List(vec![
        Node::Leaf("link".to_string()),
        Node::Leaf("left".to_string()),
        Node::Leaf("right".to_string()),
    ]);
    let identity_output = shared_input.clone();
    let reversed_output = reverse_link_endpoints(&shared_input);
    let renamed_input = rename_authority_witness_atoms(&shared_input);
    let interpretations = vec![
        IntrinsicLinkInterpretation {
            id: "reflexive-observation",
            input: shared_input.clone(),
            output: identity_output.clone(),
            preserves_link_formation: is_link_form(&identity_output),
            renaming_invariant: renamed_input == rename_authority_witness_atoms(&identity_output),
        },
        IntrinsicLinkInterpretation {
            id: "reverse-endpoints",
            input: shared_input.clone(),
            output: reversed_output.clone(),
            preserves_link_formation: is_link_form(&reversed_output),
            renaming_invariant: reverse_link_endpoints(&renamed_input)
                == rename_authority_witness_atoms(&reversed_output),
        },
    ];
    LinkRepresentationBoundaryReport {
        classification: "ORDERED_LINK_REPRESENTATION_UNDERDETERMINES_TESTED_TRANSITIONS",
        investigated_object: "host-representation-of-an-ordered-link",
        link_ontology_covered: false,
        representation_exhaustiveness_established: false,
        intrinsic_transition_authority: "UNRESOLVED",
        structure_transformation_separation: "ASSUMED_BY_EXPERIMENT",
        transition_externality: "ASSUMED_BY_EXPERIMENT",
        model_assumptions: vec![
            LinkModelAssumption {
                id: "tagged-ternary-host-value",
                status: "ASSUMED_NOT_DERIVED",
                role: "models one link as a host list containing a tag and two references",
            },
            LinkModelAssumption {
                id: "ordered-endpoint-positions",
                status: "ASSUMED_NOT_DERIVED",
                role: "models source and target as distinct ordered list positions",
            },
            LinkModelAssumption {
                id: "passive-link-value",
                status: "ASSUMED_NOT_DERIVED",
                role: "keeps represented structure unchanged until a host function acts",
            },
            LinkModelAssumption {
                id: "external-transition-function",
                status: "ASSUMED_NOT_DERIVED",
                role: "models transformation as a function supplied outside the represented link",
            },
        ],
        shared_input,
        representation_signature: vec![
            "link-identity",
            "ordered-source-reference",
            "ordered-target-reference",
        ],
        interpretations,
        unique_transition_selected: false,
        admissible_conclusion: "This host representation signature does not select between the two tested formation-preserving, atom-renaming-invariant transition functions.",
        prohibited_conclusions: vec![
            "the representation signature exhausts the nature of links",
            "structure and transformation are intrinsically independent",
            "transformation must be external to links",
            "no execution principle can arise from links themselves",
            "links have no intrinsic transition authority",
        ],
        next_search_constraint: "Re-audit the model of a link before drawing an ontological or foundational conclusion; do not add another known calculus as evidence about link ontology.",
        foundational_status: "OPEN",
        investigation_status: "OPEN_INDEPENDENT_INVESTIGATION",
        open_questions: vec![
            FoundationalOpenQuestion {
                id: "link-ontology",
                status: "UNRESOLVED",
                question: "What is a link before a host representation assigns categories to it?",
            },
            FoundationalOpenQuestion {
                id: "primitive-categories",
                status: "UNRESOLVED",
                question: "Which, if any, primitive categories are forced by the investigated phenomenon?",
            },
            FoundationalOpenQuestion {
                id: "structure-transformation-relation",
                status: "UNRESOLVED",
                question: "Is a distinction between structure and transformation derived or imported?",
            },
            FoundationalOpenQuestion {
                id: "intrinsic-semantic-authority",
                status: "UNRESOLVED",
                question: "Can semantic authority arise from links without being supplied externally?",
            },
            FoundationalOpenQuestion {
                id: "comparative-minimality",
                status: "UNRESOLVED",
                question: "Do independent derivations converge on a comparable minimal foundation?",
            },
        ],
        provenance_questions: vec![
            "Was the concept forced by the investigated link phenomenon?",
            "Was the concept derived from already established properties?",
            "Was the concept imported from an existing formalism or host representation?",
        ],
        imported_primitive_categories: [
            "data",
            "operation",
            "state",
            "transition",
            "interpreter",
            "evaluator",
            "rewrite",
            "rule",
            "function",
            "relation",
        ]
        .into_iter()
        .map(|id| ImportedPrimitiveCategory {
            id,
            provenance: "IMPORTED_EXPERIMENTAL_VOCABULARY",
            foundational_status: "UNESTABLISHED",
        })
        .collect(),
        existing_candidates_role: "EXECUTABLE_CONTROLS_ONLY",
        existing_candidates_constrain_search: false,
        target_architecture_selected: false,
        comparison_scope: "EXECUTION_ARCHITECTURE_ONLY_NOT_ONTOLOGY",
        acceptance_criterion: "A primitive earns foundational status only through an explicit derivation from independently established properties; successful execution, universality, self-hosting, elegance, and small size are insufficient.",
    }
}

/// Source-compatible alias for the pre-v3 API. The returned report deliberately
/// makes no claim about intrinsic link authority.
pub fn intrinsic_link_authority_report() -> IntrinsicLinkAuthorityReport {
    link_representation_boundary_report()
}

#[derive(Debug, Clone, Default)]
pub struct LinkedProgramRegistry {
    programs: BTreeMap<String, LinkedProgram>,
    disabled_operations: BTreeSet<String>,
    runtime_trace: RefCell<BootstrapRuntimeTraceState>,
    execution_basis: ExecutionBasis,
}

fn leaf<'a>(node: &'a Node, context: &str) -> Result<&'a str, String> {
    match node {
        Node::Leaf(value) if !value.is_empty() => Ok(value),
        _ => Err(format!("{context} must be a non-empty reference")),
    }
}

fn variable_name(node: &Node) -> Option<&str> {
    match node {
        Node::Leaf(value) if value.starts_with('?') && value.len() > 1 => Some(value),
        _ => None,
    }
}

fn variables_in(node: &Node, output: &mut BTreeSet<String>) {
    if let Some(variable) = variable_name(node) {
        output.insert(variable.to_string());
    }
    if let Node::List(children) = node {
        for child in children {
            variables_in(child, output);
        }
    }
}

fn direct_match_term<F>(
    pattern: &Node,
    candidate: &Node,
    substitution: &mut BTreeMap<String, Node>,
    observe: &mut F,
) -> Result<bool, String>
where
    F: FnMut(&'static str) -> Result<(), String>,
{
    if let Some(variable) = variable_name(pattern) {
        observe("bind-pattern-variables")?;
        if let Some(previous) = substitution.get(variable) {
            observe("compare-link-structure")?;
            return Ok(previous == candidate);
        }
        substitution.insert(variable.to_string(), candidate.clone());
        return Ok(true);
    }
    observe("compare-link-structure")?;
    match (pattern, candidate) {
        (Node::Leaf(left), Node::Leaf(right)) => Ok(left == right),
        (Node::List(left), Node::List(right)) if left.len() == right.len() => {
            for (pattern, candidate) in left.iter().zip(right) {
                if !direct_match_term(pattern, candidate, substitution, observe)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn direct_instantiate<F>(
    node: &Node,
    substitution: &BTreeMap<String, Node>,
    observe: &mut F,
) -> Result<Node, String>
where
    F: FnMut(&'static str) -> Result<(), String>,
{
    if let Some(variable) = variable_name(node) {
        observe("substitute-bound-structures")?;
        return substitution
            .get(variable)
            .cloned()
            .ok_or_else(|| format!("unbound variable {variable}"));
    }
    match node {
        Node::Leaf(value) => Ok(Node::Leaf(value.clone())),
        Node::List(children) => children
            .iter()
            .map(|child| direct_instantiate(child, substitution, observe))
            .collect::<Result<Vec<_>, _>>()
            .map(Node::List),
    }
}

fn rebind_node(node: &Node, rebindings: &BTreeMap<String, String>) -> Node {
    match node {
        Node::Leaf(value) => Node::Leaf(
            rebindings
                .get(value)
                .cloned()
                .unwrap_or_else(|| value.clone()),
        ),
        Node::List(children) => Node::List(
            children
                .iter()
                .map(|child| rebind_node(child, rebindings))
                .collect(),
        ),
    }
}

fn apply_rebindings(node: &Node, rebindings: &[BTreeMap<String, String>]) -> Node {
    rebindings.iter().fold(node.clone(), |current, bindings| {
        rebind_node(&current, bindings)
    })
}

fn form_children(form: &Node) -> Option<&[Node]> {
    match form {
        Node::List(children) => Some(children),
        Node::Leaf(_) => None,
    }
}

fn form_head(form: &Node) -> Option<&str> {
    form_children(form)?.first().and_then(|node| match node {
        Node::Leaf(value) => Some(value.as_str()),
        Node::List(_) => None,
    })
}

fn single_clause(form: &[Node], name: &str, context: &str) -> Result<Node, String> {
    let values: Vec<&Node> = form[3..]
        .iter()
        .filter_map(|clause| {
            let children = form_children(clause)?;
            (children.len() == 2 && matches!(&children[0], Node::Leaf(head) if head == name))
                .then_some(&children[1])
        })
        .collect();
    if values.len() != 1 {
        return Err(format!(
            "{context} requires exactly one ({name} value) clause"
        ));
    }
    Ok(values[0].clone())
}

fn assert_replacement_bound(
    pattern: &Node,
    replacement: &Node,
    context: &str,
) -> Result<(), String> {
    let mut bound = BTreeSet::new();
    let mut used = BTreeSet::new();
    variables_in(pattern, &mut bound);
    variables_in(replacement, &mut used);
    for variable in used {
        if !bound.contains(&variable) {
            return Err(format!("{context} has unbound variable {variable}"));
        }
    }
    Ok(())
}

impl LinkedProgramRegistry {
    fn observe_path(&self, path: &str) {
        self.runtime_trace
            .borrow_mut()
            .observed_paths
            .insert(path.to_string());
    }

    fn observe(&self, paths: &[&str], operation: &str) -> Result<(), String> {
        if self.disabled_operations.contains(operation) {
            return Err(format!("disabled host semantic operation {operation}"));
        }
        let mut trace = self.runtime_trace.borrow_mut();
        trace.observed_operations.insert(operation.to_string());
        for path in paths {
            trace.observed_paths.insert((*path).to_string());
            trace
                .observed_path_segments
                .insert(BootstrapObservedPathSegment {
                    path: (*path).to_string(),
                    operation: operation.to_string(),
                });
        }
        Ok(())
    }

    fn observe_combinator(
        &self,
        paths: &[&str],
        operations: &BTreeSet<&'static str>,
        capabilities: &[&str],
    ) -> Result<(), String> {
        for operation in operations {
            self.observe(paths, operation)?;
        }
        let mut trace = self.runtime_trace.borrow_mut();
        for capability in capabilities {
            trace
                .observed_linked_capabilities
                .insert((*capability).to_string());
            for path in paths {
                trace.observed_paths.insert((*path).to_string());
                trace.observed_linked_capability_segments.insert(
                    BootstrapObservedLinkedCapabilitySegment {
                        path: (*path).to_string(),
                        capability: (*capability).to_string(),
                    },
                );
            }
        }
        Ok(())
    }

    pub fn runtime_semantic_trace(&self) -> BootstrapRuntimeTrace {
        let trace = self.runtime_trace.borrow();
        BootstrapRuntimeTrace {
            schema: "rml-bootstrap-runtime-trace/v1",
            observed_paths: trace.observed_paths.iter().cloned().collect(),
            observed_operations: trace.observed_operations.iter().cloned().collect(),
            observed_linked_capabilities: trace
                .observed_linked_capabilities
                .iter()
                .cloned()
                .collect(),
            observed_path_segments: trace.observed_path_segments.iter().cloned().collect(),
            observed_linked_capability_segments: trace
                .observed_linked_capability_segments
                .iter()
                .cloned()
                .collect(),
        }
    }

    /// Reports the residual combinator boundary and its complete trust graph.
    pub fn bootstrap_kernel_report() -> BootstrapKernelReport {
        let source = combinator_kernel::source_summary()
            .expect("checked-in fixed-point source and runtime graph must be valid");
        let operations = vec![
            "contract-s-link",
            "contract-k-link",
            "parse-linked-forms",
            "enforce-cycle-and-resource-bounds",
        ];
        let derived_host_services = vec![];
        BootstrapKernelReport {
            name: "K0",
            status: "current-bootstrap-boundary",
            claims_irreducible: false,
            fixed_point_criterion: "Remove an operation only when every public semantic path still executes and the replacement does not presuppose the same operation under another name.",
            operations,
            derived_host_services,
            object_semantics: Vec::new(),
            semantic_source: BootstrapSemanticSource {
                artifact: source.artifact,
                schema: source.schema,
                representation: source.representation,
                upstream_model: source.upstream_model,
                source_nodes: source.source_nodes,
                runtime_nodes: source.runtime_nodes,
                roots: source.roots,
                provenance: "represented-as-addressed-links",
                compiled_from_external_semantic_description: false,
            },
            semantic_law_provenance: vec![
                BootstrapSemanticLawProvenance {
                    operation: "contract-s-link",
                    provenance: "externally-primitive",
                    law: "S x y z -> x z (y z)",
                },
                BootstrapSemanticLawProvenance {
                    operation: "contract-k-link",
                    provenance: "externally-primitive",
                    law: "K x y -> x",
                },
            ],
            minimization_experiments: vec![
                BootstrapMinimizationExperiment {
                    operation: "contract-s-link",
                    classification: "INDEPENDENT",
                    outcome: "experimentally-necessary-in-current-basis",
                    evidence: "Fault injection disables S while retaining K; the import, rewrite, inference, and self-verification acceptance probe fails closed.",
                },
                BootstrapMinimizationExperiment {
                    operation: "contract-k-link",
                    classification: "INDEPENDENT",
                    outcome: "experimentally-necessary-in-current-basis",
                    evidence: "Fault injection disables K while retaining S; the import, rewrite, inference, and self-verification acceptance probe fails closed.",
                },
                BootstrapMinimizationExperiment {
                    operation: "parse-linked-forms",
                    classification: "UNKNOWN",
                    outcome: "retained-at-representation-ingress",
                    evidence: "from_forms bypasses this text decoder entirely; it is measured as representation rather than a semantic primitive.",
                },
                BootstrapMinimizationExperiment {
                    operation: "enforce-cycle-and-resource-bounds",
                    classification: "UNKNOWN",
                    outcome: "retained-as-non-semantic-observer",
                    evidence: "Cycle/step/fact limits stop computation but never create a match, rewrite, import, inference, or proof result.",
                },
            ],
            trust_graph: BootstrapTrustGraph {
                schema: "rml-bootstrap-trust-graph/v1",
                nodes: vec![
                    BootstrapTrustNode {
                        id: "contract-s-link",
                        layer: "bootstrap",
                        depends_on: vec![],
                        primitive_reason: "The S link duplicates one argument into two linked applications; disabling this contraction makes the complete acceptance probe fail.",
                    },
                    BootstrapTrustNode {
                        id: "contract-k-link",
                        layer: "bootstrap",
                        depends_on: vec![],
                        primitive_reason: "The K link discards one argument; disabling this contraction makes the complete acceptance probe fail.",
                    },
                    BootstrapTrustNode {
                        id: "parse-linked-forms",
                        layer: "representation-parsing",
                        depends_on: vec![],
                        primitive_reason: "Text is outside the binary-link substrate; this ingress decoder exposes leaf/list structure but assigns no linked-program semantics.",
                    },
                    BootstrapTrustNode {
                        id: "enforce-cycle-and-resource-bounds",
                        layer: "execution-control-resource-bounds",
                        depends_on: vec![],
                        primitive_reason: "An external observer limits divergent linked computation without choosing, matching, or constructing any semantic result.",
                    },
                    BootstrapTrustNode {
                        id: "matching",
                        layer: "links-defined-service",
                        depends_on: vec!["contract-s-link", "contract-k-link"],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "substitution",
                        layer: "links-defined-service",
                        depends_on: vec!["contract-s-link", "contract-k-link"],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "rule-selection-and-traversal",
                        layer: "links-defined-service",
                        depends_on: vec!["matching", "substitution"],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "import-and-rebinding",
                        layer: "links-defined-service",
                        depends_on: vec!["contract-s-link", "contract-k-link"],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "inference-saturation",
                        layer: "links-defined-service",
                        depends_on: vec![
                            "matching",
                            "substitution",
                            "rule-selection-and-traversal",
                        ],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "result-verification",
                        layer: "links-defined-service",
                        depends_on: vec!["contract-s-link", "contract-k-link"],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "load-linked-program",
                        layer: "semantic-path",
                        depends_on: vec!["parse-linked-forms"],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "reduce-linked-program",
                        layer: "semantic-path",
                        depends_on: vec![
                            "import-and-rebinding",
                            "matching",
                            "substitution",
                            "rule-selection-and-traversal",
                            "enforce-cycle-and-resource-bounds",
                        ],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "prove-linked-judgement",
                        layer: "semantic-path",
                        depends_on: vec![
                            "import-and-rebinding",
                            "inference-saturation",
                            "result-verification",
                            "reduce-linked-program",
                            "enforce-cycle-and-resource-bounds",
                        ],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "execute-links-meta-foundation",
                        layer: "links-defined",
                        depends_on: vec!["reduce-linked-program", "result-verification"],
                        primitive_reason: "",
                    },
                ],
            },
        }
    }

    /// Fails closed when executable host semantics and the trust graph differ.
    pub fn audit_bootstrap_kernel(implemented_operations: Option<&[&str]>) -> Result<(), String> {
        let report = Self::bootstrap_kernel_report();
        let nodes: BTreeMap<&str, &BootstrapTrustNode> = report
            .trust_graph
            .nodes
            .iter()
            .map(|node| (node.id, node))
            .collect();
        if nodes.len() != report.trust_graph.nodes.len() {
            return Err("duplicate trust graph node".to_string());
        }
        for node in nodes.values() {
            for dependency in &node.depends_on {
                if !nodes.contains_key(dependency) {
                    return Err(format!(
                        "trust graph node {} has unknown dependency {dependency}",
                        node.id
                    ));
                }
            }
        }

        fn reaches_bootstrap(
            id: &str,
            nodes: &BTreeMap<&str, &BootstrapTrustNode>,
            visiting: &mut BTreeSet<String>,
        ) -> Result<bool, String> {
            let node = nodes[id];
            if !visiting.insert(id.to_string()) {
                return Err(format!("trust graph dependency cycle at {id}"));
            }
            if node.depends_on.is_empty() {
                visiting.remove(id);
                return Ok(!node.primitive_reason.is_empty());
            }
            for dependency in &node.depends_on {
                if !reaches_bootstrap(dependency, nodes, visiting)? {
                    visiting.remove(id);
                    return Ok(false);
                }
            }
            visiting.remove(id);
            Ok(true)
        }

        for node in nodes.values() {
            if node.layer != "bootstrap"
                && !reaches_bootstrap(node.id, &nodes, &mut BTreeSet::new())?
            {
                return Err(format!(
                    "trust graph path {} does not terminate in K0",
                    node.id
                ));
            }
        }

        let reported: BTreeSet<&str> = report
            .operations
            .iter()
            .chain(&report.derived_host_services)
            .copied()
            .collect();
        let implemented: BTreeSet<&str> = implemented_operations
            .unwrap_or(IMPLEMENTED_HOST_SEMANTIC_OPERATIONS)
            .iter()
            .copied()
            .collect();
        for operation in &implemented {
            if !reported.contains(operation) {
                return Err(format!("unreported host semantic operation {operation}"));
            }
        }
        for operation in &reported {
            if !implemented.contains(operation) {
                return Err(format!(
                    "reported host semantic operation {operation} is not implemented"
                ));
            }
        }
        let experimented: BTreeSet<&str> = report
            .minimization_experiments
            .iter()
            .map(|experiment| experiment.operation)
            .collect();
        for operation in reported {
            if !experimented.contains(operation) {
                return Err(format!(
                    "host semantic operation {operation} has no minimization experiment"
                ));
            }
        }
        Ok(())
    }

    fn run_bootstrap_metric_probe(
        source: &str,
        disabled_operations: &[&str],
    ) -> Result<(Self, Vec<RewriteTraceStep>), String> {
        let combined = format!("{source}\n{BOOTSTRAP_METRIC_PROBE_SOURCE}");
        let programs = Self::from_rml_with_disabled(&combined, disabled_operations)?;
        let parse = |value: &str| parse_one(&tokenize_one(value));
        let imported = programs.reduce(
            "bootstrap-metric-import",
            &parse("(measured-input value)")?,
            10_000,
        )?;
        if imported.term != parse("(metric-output value)")? {
            return Err("import/rebind metric probe changed its baseline result".to_string());
        }
        if programs
            .prove(
                "bootstrap-metric-proof",
                &parse("(metric-derived a)")?,
                &[],
                128,
                10_000,
            )
            .is_none()
        {
            return Err("inference metric probe changed its baseline result".to_string());
        }
        let request = parse(
            "(meta-verify\n\
               (atom a)\n\
               (meta-rewrite\n\
                 (rules\n\
                   (rewrite\n\
                     (pair (atom identity) (meta-variable argument))\n\
                     (meta-variable argument))\n\
                   (no-rules))\n\
                 (pair (atom identity) (atom a))))",
        )?;
        let self_hosting = programs.reduce("links-meta-foundation", &request, 10_000)?;
        if self_hosting.term != Node::Leaf("verified".to_string()) {
            return Err("self-hosting metric probe changed its baseline result".to_string());
        }
        Ok((programs, self_hosting.trace))
    }

    /// Executes the foundation probe and reports the host machinery that still
    /// exists outside the links-defined interpreter.
    pub fn bootstrap_metrics_report(source: &str) -> Result<BootstrapMetricsReport, String> {
        let (programs, self_hosting_trace) = Self::run_bootstrap_metric_probe(source, &[])?;
        let trace = programs.runtime_semantic_trace();
        let kernel = Self::bootstrap_kernel_report();
        let nodes: BTreeMap<&str, &BootstrapTrustNode> = kernel
            .trust_graph
            .nodes
            .iter()
            .map(|node| (node.id, node))
            .collect();
        let reported_operations: BTreeSet<&str> = kernel
            .operations
            .iter()
            .chain(&kernel.derived_host_services)
            .copied()
            .collect();

        fn reaches_operation(
            path: &str,
            operation: &str,
            nodes: &BTreeMap<&str, &BootstrapTrustNode>,
            visiting: &mut BTreeSet<String>,
        ) -> bool {
            if path == operation {
                return true;
            }
            if !visiting.insert(path.to_string()) {
                return false;
            }
            let Some(node) = nodes.get(path) else {
                visiting.remove(path);
                return false;
            };
            let reached = node
                .depends_on
                .iter()
                .any(|dependency| reaches_operation(dependency, operation, nodes, visiting));
            visiting.remove(path);
            reached
        }

        let undocumented_paths: Vec<String> = trace
            .observed_paths
            .iter()
            .filter(|path| !nodes.contains_key(path.as_str()))
            .cloned()
            .collect();
        let undocumented_operations: Vec<String> = trace
            .observed_operations
            .iter()
            .filter(|operation| !reported_operations.contains(operation.as_str()))
            .cloned()
            .collect();
        let undocumented_path_segments: Vec<BootstrapObservedPathSegment> = trace
            .observed_path_segments
            .iter()
            .filter(|segment| {
                !reaches_operation(
                    &segment.path,
                    &segment.operation,
                    &nodes,
                    &mut BTreeSet::new(),
                )
            })
            .cloned()
            .collect();
        let runtime_trust_graph_coverage = BootstrapRuntimeTrustGraphCoverage {
            documented_observed_paths: trace.observed_paths.len() - undocumented_paths.len(),
            total_observed_paths: trace.observed_paths.len(),
            documented_observed_path_segments: trace.observed_path_segments.len()
                - undocumented_path_segments.len(),
            total_observed_path_segments: trace.observed_path_segments.len(),
            undocumented_paths,
            undocumented_operations,
            undocumented_path_segments,
            trace: trace.clone(),
        };

        let removal_experiments: Vec<BootstrapRemovalExperiment> =
            IMPLEMENTED_HOST_SEMANTIC_OPERATIONS
                .iter()
                .map(
                    |operation| match Self::run_bootstrap_metric_probe(source, &[*operation]) {
                        Ok(_) => BootstrapRemovalExperiment {
                            operation,
                            classification: "DERIVABLE",
                            baseline_preserved: true,
                            observed_failure: String::new(),
                        },
                        Err(error) => {
                            let classification = kernel
                                .minimization_experiments
                                .iter()
                                .find(|experiment| experiment.operation == *operation)
                                .map_or("UNKNOWN", |experiment| experiment.classification);
                            BootstrapRemovalExperiment {
                                operation,
                                classification,
                                baseline_preserved: false,
                                observed_failure: error,
                            }
                        }
                    },
                )
                .collect();

        let rules: Vec<String> = self_hosting_trace
            .iter()
            .map(|step| step.rule.clone())
            .collect();
        let evidence = |predicate: &dyn Fn(&str) -> bool| {
            rules
                .iter()
                .filter(|rule| predicate(rule))
                .cloned()
                .collect()
        };
        let observed_paths = |capability: &str| {
            trace
                .observed_linked_capability_segments
                .iter()
                .filter(|segment| segment.capability == capability)
                .map(|segment| segment.path.clone())
                .collect::<Vec<_>>()
        };
        let linked_self_hosting_capabilities: Vec<BootstrapLinkedCapability> = vec![
            BootstrapLinkedCapability {
                capability: "matching",
                observed_paths: observed_paths("matching"),
                evidence_rules: evidence(&|rule| rule.starts_with("match-")),
            },
            BootstrapLinkedCapability {
                capability: "substitution",
                observed_paths: observed_paths("substitution"),
                evidence_rules: evidence(&|rule| rule.starts_with("substitute-")),
            },
            BootstrapLinkedCapability {
                capability: "rule-selection-and-traversal",
                observed_paths: observed_paths("rule-selection-and-traversal"),
                evidence_rules: evidence(&|rule| rule.starts_with("select-")),
            },
            BootstrapLinkedCapability {
                capability: "import-and-rebinding",
                observed_paths: observed_paths("import-and-rebinding"),
                evidence_rules: vec![],
            },
            BootstrapLinkedCapability {
                capability: "inference-saturation",
                observed_paths: observed_paths("inference-saturation"),
                evidence_rules: vec![],
            },
            BootstrapLinkedCapability {
                capability: "result-verification",
                observed_paths: observed_paths("result-verification"),
                evidence_rules: evidence(&|rule| rule == "verify-object-result"),
            },
        ]
        .into_iter()
        .filter(|capability| !capability.observed_paths.is_empty())
        .collect();
        let host_linked_duplications = vec![];

        let linked_capability_names: Vec<&'static str> = linked_self_hosting_capabilities
            .iter()
            .map(|capability| capability.capability)
            .collect();
        let host_capability_names: Vec<String> = vec![];
        let linked_count = linked_capability_names.len();
        let host_count = host_capability_names.len();
        let unknown_count = removal_experiments
            .iter()
            .filter(|experiment| {
                matches!(experiment.operation, "contract-s-link" | "contract-k-link")
                    && experiment.classification == "UNKNOWN"
            })
            .count();
        let confirmed_independent_count = removal_experiments
            .iter()
            .filter(|experiment| {
                matches!(experiment.operation, "contract-s-link" | "contract-k-link")
                    && experiment.classification == "INDEPENDENT"
                    && !experiment.baseline_preserved
            })
            .count();
        let total_operations = 2;
        let self_hosting_closure = BootstrapSelfHostingClosure {
            task: "linked-load-import-reduce-infer-and-self-verify-above-residual-basis",
            linked_capabilities: linked_count,
            linked_capability_names,
            host_capabilities: host_count,
            host_capability_names,
            total_capabilities: linked_count + host_count,
            numerator: linked_count,
            denominator: linked_count + host_count,
        };
        let foundation_compression = BootstrapFoundationCompression {
            basis: "semantic-operation fault injection over the complete acceptance probe",
            smallest_sufficient_host_operations: 2,
            original_host_operations: 8,
            candidate_operations: vec!["contract-s-link", "contract-k-link"],
            sufficient_operations: vec!["contract-s-link", "contract-k-link"],
            numerator: 2,
            denominator: 8,
        };
        let zero_transition_failure =
            match Self::run_bootstrap_metric_probe(source, &["contract-s-link", "contract-k-link"])
            {
                Ok(_) => {
                    return Err(
                        "zero-transition foundation unexpectedly preserved the baseline"
                            .to_string(),
                    )
                }
                Err(error) => error,
            };
        let undocumented_count = runtime_trust_graph_coverage.undocumented_paths.len()
            + runtime_trust_graph_coverage.undocumented_operations.len()
            + runtime_trust_graph_coverage
                .undocumented_path_segments
                .len();
        let current = BootstrapCurrentMetrics {
            total_host_semantic_operations: total_operations,
            independent_host_primitives: BootstrapPrimitiveMetric {
                confirmed: confirmed_independent_count,
                unknown: unknown_count,
            },
            derived_host_semantic_services: 0,
            duplicated_semantic_capabilities: 0,
            object_specific_host_semantics: 0,
            undocumented_semantic_paths: undocumented_count,
            self_hosting_closure,
            foundation_compression,
            residual_semantic_basis: BootstrapResidualSemanticBasis {
                operations: vec!["contract-s-link", "contract-k-link"],
                experimentally_necessary: confirmed_independent_count,
                equivalent_one_rule_bases: vec!["iota"],
            },
            external_semantic_information: BootstrapExternalSemanticInformation {
                independent_laws: 2,
                law_names: vec!["contract-s-link", "contract-k-link"],
                provenance: "externally-primitive",
            },
        };
        let host_semantic_layers = vec![
            BootstrapHostSemanticLayer {
                layer: "semantic-bootstrap",
                count: 2,
                operations: vec!["contract-s-link", "contract-k-link"],
            },
            BootstrapHostSemanticLayer {
                layer: "derived-host-semantics",
                count: 0,
                operations: vec![],
            },
            BootstrapHostSemanticLayer {
                layer: "representation-parsing",
                count: 1,
                operations: vec!["parse-linked-forms"],
            },
            BootstrapHostSemanticLayer {
                layer: "execution-control-resource-bounds",
                count: 1,
                operations: vec!["enforce-cycle-and-resource-bounds"],
            },
            BootstrapHostSemanticLayer {
                layer: "debugging-observability",
                count: 0,
                operations: vec![],
            },
            BootstrapHostSemanticLayer {
                layer: "object-specific-host-semantics",
                count: 0,
                operations: vec![],
            },
        ];
        let comparison = vec![
            BootstrapMetricComparison {
                metric: "total-host-semantic-operations",
                previous: Some("2".to_string()),
                current: total_operations.to_string(),
                delta: Some((total_operations as isize - 2).to_string()),
            },
            BootstrapMetricComparison {
                metric: "independent-host-primitives",
                previous: Some("2 confirmed; 0 unknown".to_string()),
                current: format!(
                    "{confirmed_independent_count} confirmed; {unknown_count} unknown"
                ),
                delta: None,
            },
            BootstrapMetricComparison {
                metric: "derived-host-semantic-services",
                previous: Some("0".to_string()),
                current: "0".to_string(),
                delta: Some("0".to_string()),
            },
            BootstrapMetricComparison {
                metric: "host-linked-duplicated-semantics",
                previous: Some("0".to_string()),
                current: host_linked_duplications.len().to_string(),
                delta: Some("0".to_string()),
            },
            BootstrapMetricComparison {
                metric: "object-specific-host-semantics",
                previous: Some("0".to_string()),
                current: "0".to_string(),
                delta: Some("0".to_string()),
            },
            BootstrapMetricComparison {
                metric: "undocumented-semantic-paths",
                previous: Some("0".to_string()),
                current: undocumented_count.to_string(),
                delta: Some("0".to_string()),
            },
            BootstrapMetricComparison {
                metric: "self-hosting-closure",
                previous: Some("6/6".to_string()),
                current: format!(
                    "{}/{}",
                    current.self_hosting_closure.numerator,
                    current.self_hosting_closure.denominator
                ),
                delta: None,
            },
            BootstrapMetricComparison {
                metric: "foundation-compression-ratio",
                previous: Some("2/8".to_string()),
                current: format!(
                    "{}/{}",
                    current.foundation_compression.numerator,
                    current.foundation_compression.denominator
                ),
                delta: None,
            },
            BootstrapMetricComparison {
                metric: "independent-external-semantic-laws",
                previous: None,
                current: "2".to_string(),
                delta: None,
            },
            BootstrapMetricComparison {
                metric: "external-semantic-source-descriptions",
                previous: Some("1".to_string()),
                current: "0".to_string(),
                delta: Some("-1".to_string()),
            },
        ];
        let iota_operations = combinator_kernel::iota_equivalence_operations()?;
        Ok(BootstrapMetricsReport {
            schema: "rml-bootstrap-metrics/v4",
            previous_revision: PREVIOUS_METRIC_REVISION,
            measurement_scope: "The executable probe covers textual load, linked import/rebinding, reduction, inference saturation, links-meta-foundation result verification, and a zero-transition fault injection. The source is represented as an addressed network aligned with the upstream network-duplet structure; S/K remain externally primitive transition laws. Necessity is relative to this representation and probe, not a claim of global irreducibility.",
            provenance_classifications: PROVENANCE_CLASSIFICATIONS.to_vec(),
            removal_classifications: REMOVAL_CLASSIFICATIONS.to_vec(),
            current,
            semantic_provenance: BootstrapSemanticProvenance {
                authoritative_source: kernel.semantic_source.clone(),
                derived_capabilities: vec![
                    "matching",
                    "substitution",
                    "rule-selection-and-traversal",
                    "import-and-rebinding",
                    "inference-saturation",
                    "result-verification",
                ]
                .into_iter()
                .map(|id| BootstrapProvenanceItem {
                    id,
                    provenance: "derived-inside-system",
                })
                .collect(),
                eliminated_external_sources: vec![BootstrapEliminatedSource {
                    id: "buildSourceKernel",
                    provenance: "compiled-from-external-semantic-description",
                    present: false,
                }],
            },
            foundation_search_experiments: vec![
                BootstrapFoundationSearchExperiment {
                    candidate: "zero-semantic-transition",
                    classification: "INSUFFICIENT",
                    surface_law_count: 0,
                    residual_external_semantic_law_count: 0,
                    baseline_preserved: Some(false),
                    observed_failure: zero_transition_failure,
                    experiment_scope: Some("complete-acceptance-probe"),
                    observed_external_operations: vec![],
                    semantic_information_reduced: None,
                },
                BootstrapFoundationSearchExperiment {
                    candidate: "s-k-over-addressed-link-source",
                    classification: "CURRENT_SUFFICIENT",
                    surface_law_count: 2,
                    residual_external_semantic_law_count: 2,
                    baseline_preserved: Some(true),
                    observed_failure: String::new(),
                    experiment_scope: Some("complete-acceptance-probe"),
                    observed_external_operations: vec![
                        "contract-k-link",
                        "contract-s-link",
                    ],
                    semantic_information_reduced: None,
                },
                BootstrapFoundationSearchExperiment {
                    candidate: "iota",
                    classification: "EQUIVALENT_REENCODING",
                    surface_law_count: 1,
                    residual_external_semantic_law_count: iota_operations.len(),
                    baseline_preserved: Some(true),
                    observed_failure: String::new(),
                    experiment_scope: Some("residual-basis-equivalence-witness"),
                    observed_external_operations: iota_operations.iter().copied().collect(),
                    semantic_information_reduced: Some(iota_operations.len() < 2),
                },
            ],
            host_semantic_layers,
            removal_experiments,
            host_linked_duplications,
            linked_self_hosting_capabilities,
            runtime_trust_graph_coverage,
            comparison,
        })
    }

    pub fn from_rml(source: &str) -> Result<Self, String> {
        Self::from_rml_with_disabled(source, &[])
    }

    /// Load the same linked source under an independently selected semantic
    /// mechanism.  This is used by the alternative-foundation search; the
    /// default public path remains the closed S/K basis.
    pub fn from_rml_with_basis(
        source: &str,
        execution_basis: ExecutionBasis,
        disabled_operations: &[&str],
    ) -> Result<Self, String> {
        if disabled_operations.contains(&"parse-linked-forms") {
            return Err("disabled host semantic operation parse-linked-forms".to_string());
        }
        let forms = parse_lino(source)
            .iter()
            .map(|link| parse_one(&tokenize_one(link)))
            .collect::<Result<Vec<_>, _>>()?;
        let registry = Self::from_forms_with_basis(&forms, execution_basis, disabled_operations)?;
        registry.observe(&["load-linked-program"], "parse-linked-forms")?;
        Ok(registry)
    }

    fn from_rml_with_disabled(source: &str, disabled_operations: &[&str]) -> Result<Self, String> {
        if disabled_operations.contains(&"parse-linked-forms") {
            return Err("disabled host semantic operation parse-linked-forms".to_string());
        }
        let forms = parse_lino(source)
            .iter()
            .map(|link| parse_one(&tokenize_one(link)))
            .collect::<Result<Vec<_>, _>>()?;
        let registry = Self::from_forms_with_disabled(&forms, disabled_operations)?;
        registry.observe(&["load-linked-program"], "parse-linked-forms")?;
        Ok(registry)
    }

    pub fn from_forms(forms: &[Node]) -> Result<Self, String> {
        Self::from_forms_with_disabled(forms, &[])
    }

    fn from_forms_with_disabled(
        forms: &[Node],
        disabled_operations: &[&str],
    ) -> Result<Self, String> {
        Self::from_forms_with_basis(forms, ExecutionBasis::ClosedSk, disabled_operations)
    }

    fn from_forms_with_basis(
        forms: &[Node],
        execution_basis: ExecutionBasis,
        disabled_operations: &[&str],
    ) -> Result<Self, String> {
        let mut registry = Self {
            disabled_operations: disabled_operations
                .iter()
                .map(|operation| (*operation).to_string())
                .collect(),
            execution_basis,
            ..Self::default()
        };
        registry.observe_path("load-linked-program");
        for form in forms {
            if form_head(form) == Some("linked-program") {
                registry.add_program(form)?;
            }
        }
        for form in forms {
            match form_head(form) {
                Some("linked-rewrite") => registry.add_rewrite(form)?,
                Some("linked-fact") => registry.add_fact(form)?,
                Some("linked-inference") => registry.add_inference(form)?,
                _ => {}
            }
        }
        registry.validate()?;
        Ok(registry)
    }

    fn add_program(&mut self, form: &Node) -> Result<(), String> {
        let children = form_children(form).ok_or("linked-program must be a link")?;
        if children.len() < 2 {
            return Err("linked-program requires a name".to_string());
        }
        let name = leaf(&children[1], "linked-program name")?.to_string();
        if self.programs.contains_key(&name) {
            return Err(format!("duplicate linked-program {name}"));
        }
        let mut uses = Vec::new();
        for clause in &children[2..] {
            let values = form_children(clause).ok_or_else(|| {
                format!(
                    "linked-program {name} only supports \
                     (uses program (rebind from to) ...) clauses"
                )
            })?;
            if values.len() < 2 || !matches!(&values[0], Node::Leaf(head) if head == "uses") {
                return Err(format!(
                    "linked-program {name} only supports \
                     (uses program (rebind from to) ...) clauses"
                ));
            }
            let dependency = leaf(&values[1], "linked-program dependency")?.to_string();
            if uses
                .iter()
                .any(|item: &ProgramImport| item.program == dependency)
            {
                return Err(format!(
                    "linked-program {name} repeats dependency {dependency}"
                ));
            }
            let mut rebindings = BTreeMap::new();
            for binding in &values[2..] {
                let binding_values = form_children(binding).ok_or_else(|| {
                    format!(
                        "linked-program {name} import {dependency} only supports \
                         (rebind from to)"
                    )
                })?;
                if binding_values.len() != 3
                    || !matches!(&binding_values[0], Node::Leaf(head) if head == "rebind")
                {
                    return Err(format!(
                        "linked-program {name} import {dependency} only supports \
                         (rebind from to)"
                    ));
                }
                let from = leaf(&binding_values[1], "linked-program rebind source")?.to_string();
                let to = leaf(&binding_values[2], "linked-program rebind target")?.to_string();
                if from.starts_with('?') || to.starts_with('?') {
                    return Err(format!(
                        "linked-program {name} cannot rebind pattern variables"
                    ));
                }
                if rebindings.insert(from.clone(), to).is_some() {
                    return Err(format!(
                        "linked-program {name} repeats rebind source {from}"
                    ));
                }
            }
            uses.push(ProgramImport {
                program: dependency,
                rebindings,
            });
        }
        self.programs.insert(
            name.clone(),
            LinkedProgram {
                name,
                uses,
                rewrites: Vec::new(),
                facts: Vec::new(),
                inferences: Vec::new(),
            },
        );
        Ok(())
    }

    fn program_mut(&mut self, name: &str, context: &str) -> Result<&mut LinkedProgram, String> {
        self.programs
            .get_mut(name)
            .ok_or_else(|| format!("{context} references unknown linked-program {name}"))
    }

    fn add_rewrite(&mut self, form: &Node) -> Result<(), String> {
        let children = form_children(form).ok_or("linked-rewrite must be a link")?;
        if children.len() < 5 {
            return Err("linked-rewrite requires a program, name, from, and to".to_string());
        }
        let program_name = leaf(&children[1], "linked-rewrite program")?.to_string();
        let name = leaf(&children[2], "linked-rewrite name")?.to_string();
        let context = format!("linked-rewrite {program_name}.{name}");
        for clause in &children[3..] {
            if !matches!(form_head(clause), Some("from") | Some("to")) {
                return Err(format!("{context} has an unsupported clause"));
            }
        }
        let pattern = single_clause(children, "from", &context)?;
        let replacement = single_clause(children, "to", &context)?;
        assert_replacement_bound(&pattern, &replacement, &context)?;
        let program = self.program_mut(&program_name, &context)?;
        if program.rewrites.iter().any(|rule| rule.name == name) {
            return Err(format!("duplicate {context}"));
        }
        program.rewrites.push(RewriteRule {
            program: program_name,
            name,
            pattern,
            replacement,
        });
        Ok(())
    }

    fn add_fact(&mut self, form: &Node) -> Result<(), String> {
        let children = form_children(form).ok_or("linked-fact must be a link")?;
        if children.len() != 4 {
            return Err("linked-fact requires a program, name, and judgement".to_string());
        }
        let program_name = leaf(&children[1], "linked-fact program")?.to_string();
        let name = leaf(&children[2], "linked-fact name")?.to_string();
        let context = format!("linked-fact {program_name}.{name}");
        let clause = form_children(&children[3])
            .filter(|values| {
                values.len() == 2 && matches!(&values[0], Node::Leaf(head) if head == "judgement")
            })
            .ok_or_else(|| format!("{context} requires (judgement value)"))?;
        let mut variables = BTreeSet::new();
        variables_in(&clause[1], &mut variables);
        if !variables.is_empty() {
            return Err(format!("{context} cannot contain variables"));
        }
        let program = self.program_mut(&program_name, &context)?;
        if program.facts.iter().any(|fact| fact.name == name) {
            return Err(format!("duplicate {context}"));
        }
        program.facts.push(LinkedFact {
            program: program_name,
            name,
            judgement: clause[1].clone(),
        });
        Ok(())
    }

    fn add_inference(&mut self, form: &Node) -> Result<(), String> {
        let children = form_children(form).ok_or("linked-inference must be a link")?;
        if children.len() < 4 {
            return Err("linked-inference requires a program, name, and clauses".to_string());
        }
        let program_name = leaf(&children[1], "linked-inference program")?.to_string();
        let name = leaf(&children[2], "linked-inference name")?.to_string();
        let context = format!("linked-inference {program_name}.{name}");
        let mut premises = Vec::new();
        let mut conclusion = None;
        for clause in &children[3..] {
            let values = form_children(clause)
                .ok_or_else(|| format!("{context} supports only premise and conclusion clauses"))?;
            if values.len() != 2 {
                return Err(format!(
                    "{context} supports only premise and conclusion clauses"
                ));
            }
            match &values[0] {
                Node::Leaf(head) if head == "premise" => premises.push(values[1].clone()),
                Node::Leaf(head) if head == "conclusion" && conclusion.is_none() => {
                    conclusion = Some(values[1].clone())
                }
                Node::Leaf(head) if head == "conclusion" => {
                    return Err(format!("{context} repeats its conclusion"))
                }
                _ => {
                    return Err(format!(
                        "{context} supports only premise and conclusion clauses"
                    ))
                }
            }
        }
        if premises.is_empty() {
            return Err(format!("{context} requires at least one premise"));
        }
        let conclusion =
            conclusion.ok_or_else(|| format!("{context} is missing its conclusion"))?;
        let mut bound = BTreeSet::new();
        for premise in &premises {
            variables_in(premise, &mut bound);
        }
        let mut used = BTreeSet::new();
        variables_in(&conclusion, &mut used);
        for variable in used {
            if !bound.contains(&variable) {
                return Err(format!("{context} has unbound variable {variable}"));
            }
        }
        let program = self.program_mut(&program_name, &context)?;
        if program.inferences.iter().any(|rule| rule.name == name) {
            return Err(format!("duplicate {context}"));
        }
        program.inferences.push(InferenceRule {
            program: program_name,
            name,
            premises,
            conclusion,
        });
        Ok(())
    }

    fn validate(&self) -> Result<(), String> {
        for program in self.programs.values() {
            for dependency in &program.uses {
                if !self.programs.contains_key(&dependency.program) {
                    return Err(format!(
                        "linked-program {} uses unknown program {}",
                        program.name, dependency.program
                    ));
                }
            }
        }
        fn visit(
            name: &str,
            programs: &BTreeMap<String, LinkedProgram>,
            visiting: &mut BTreeSet<String>,
            visited: &mut BTreeSet<String>,
        ) -> Result<(), String> {
            if visiting.contains(name) {
                return Err(format!("linked-program import cycle at {name}"));
            }
            if visited.contains(name) {
                return Ok(());
            }
            visiting.insert(name.to_string());
            for dependency in &programs[name].uses {
                visit(&dependency.program, programs, visiting, visited)?;
            }
            visiting.remove(name);
            visited.insert(name.to_string());
            Ok(())
        }
        let mut visiting = BTreeSet::new();
        let mut visited = BTreeSet::new();
        for name in self.programs.keys() {
            visit(name, &self.programs, &mut visiting, &mut visited)?;
        }
        Ok(())
    }

    pub fn has(&self, name: &str) -> bool {
        self.programs.contains_key(name)
    }

    pub fn names(&self) -> Vec<&str> {
        self.programs.keys().map(String::as_str).collect()
    }

    fn effective_rewrites(
        &self,
        name: &str,
        paths: &[&str],
        seen: &mut BTreeSet<String>,
        rebindings: &[BTreeMap<String, String>],
    ) -> Result<Vec<RewriteRule>, String> {
        if self.execution_basis == ExecutionBasis::DirectStructural {
            self.observe(paths, "resolve-and-rebind-program-imports")?;
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("direct execution references unknown linked-program {name}"))?;
        let context = format!("{name}:{rebindings:?}");
        if !seen.insert(context) {
            return Ok(Vec::new());
        }
        let mut result = program
            .rewrites
            .iter()
            .map(|rule| RewriteRule {
                program: rule.program.clone(),
                name: rule.name.clone(),
                pattern: apply_rebindings(&rule.pattern, rebindings),
                replacement: apply_rebindings(&rule.replacement, rebindings),
            })
            .collect::<Vec<_>>();
        for dependency in &program.uses {
            let nested = if dependency.rebindings.is_empty() {
                rebindings.to_vec()
            } else {
                let mut nested = vec![dependency.rebindings.clone()];
                nested.extend_from_slice(rebindings);
                nested
            };
            result.extend(self.effective_rewrites(&dependency.program, paths, seen, &nested)?);
        }
        Ok(result)
    }

    fn effective_facts(
        &self,
        name: &str,
        paths: &[&str],
        seen: &mut BTreeSet<String>,
        rebindings: &[BTreeMap<String, String>],
    ) -> Result<Vec<LinkedFact>, String> {
        if self.execution_basis == ExecutionBasis::DirectStructural {
            self.observe(paths, "resolve-and-rebind-program-imports")?;
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("direct execution references unknown linked-program {name}"))?;
        let context = format!("{name}:{rebindings:?}");
        if !seen.insert(context) {
            return Ok(Vec::new());
        }
        let mut result = program
            .facts
            .iter()
            .map(|fact| LinkedFact {
                program: fact.program.clone(),
                name: fact.name.clone(),
                judgement: apply_rebindings(&fact.judgement, rebindings),
            })
            .collect::<Vec<_>>();
        for dependency in &program.uses {
            let nested = if dependency.rebindings.is_empty() {
                rebindings.to_vec()
            } else {
                let mut nested = vec![dependency.rebindings.clone()];
                nested.extend_from_slice(rebindings);
                nested
            };
            result.extend(self.effective_facts(&dependency.program, paths, seen, &nested)?);
        }
        Ok(result)
    }

    fn effective_inferences(
        &self,
        name: &str,
        paths: &[&str],
        seen: &mut BTreeSet<String>,
        rebindings: &[BTreeMap<String, String>],
    ) -> Result<Vec<InferenceRule>, String> {
        if self.execution_basis == ExecutionBasis::DirectStructural {
            self.observe(paths, "resolve-and-rebind-program-imports")?;
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("direct execution references unknown linked-program {name}"))?;
        let context = format!("{name}:{rebindings:?}");
        if !seen.insert(context) {
            return Ok(Vec::new());
        }
        let mut result = program
            .inferences
            .iter()
            .map(|rule| InferenceRule {
                program: rule.program.clone(),
                name: rule.name.clone(),
                premises: rule
                    .premises
                    .iter()
                    .map(|premise| apply_rebindings(premise, rebindings))
                    .collect(),
                conclusion: apply_rebindings(&rule.conclusion, rebindings),
            })
            .collect::<Vec<_>>();
        for dependency in &program.uses {
            let nested = if dependency.rebindings.is_empty() {
                rebindings.to_vec()
            } else {
                let mut nested = vec![dependency.rebindings.clone()];
                nested.extend_from_slice(rebindings);
                nested
            };
            result.extend(self.effective_inferences(&dependency.program, paths, seen, &nested)?);
        }
        Ok(result)
    }

    fn direct_rewrite_once(
        &self,
        term: &Node,
        rules: &[RewriteRule],
        paths: &[&str],
    ) -> Result<Option<(Node, usize)>, String> {
        self.observe(paths, "select-and-traverse-rewrite-rules")?;
        for (index, rule) in rules.iter().enumerate() {
            let mut substitution = BTreeMap::new();
            let mut observe = |operation| self.observe(paths, operation);
            if direct_match_term(&rule.pattern, term, &mut substitution, &mut observe)? {
                return direct_instantiate(&rule.replacement, &substitution, &mut observe)
                    .map(|next| Some((next, index)));
            }
        }
        if let Node::List(children) = term {
            for (child_index, child) in children.iter().enumerate() {
                if let Some((rewritten, rule_index)) =
                    self.direct_rewrite_once(child, rules, paths)?
                {
                    let mut next = children.clone();
                    next[child_index] = rewritten;
                    return Ok(Some((Node::List(next), rule_index)));
                }
            }
        }
        Ok(None)
    }

    pub fn reduce(
        &self,
        name: &str,
        input: &Node,
        max_steps: usize,
    ) -> Result<ReductionResult, String> {
        let mut semantic_paths = vec!["reduce-linked-program"];
        if name == "links-meta-foundation" {
            semantic_paths.push("execute-links-meta-foundation");
        }
        self.observe(&semantic_paths, "enforce-cycle-and-resource-bounds")?;
        if max_steps == 0 {
            return Err("max_steps must be positive".to_string());
        }
        if self.execution_basis == ExecutionBasis::HornRelational {
            return Ok(ReductionResult {
                term: input.clone(),
                trace: Vec::new(),
            });
        }
        if self.execution_basis == ExecutionBasis::DirectStructural {
            let rules =
                self.effective_rewrites(name, &semantic_paths, &mut BTreeSet::new(), &[])?;
            let mut term = input.clone();
            let mut trace = Vec::new();
            let mut seen = BTreeSet::from([key_of(&term)]);
            while trace.len() < max_steps {
                let Some((next, rule_index)) =
                    self.direct_rewrite_once(&term, &rules, &semantic_paths)?
                else {
                    return Ok(ReductionResult { term, trace });
                };
                let rule = &rules[rule_index];
                if next == term {
                    return Err(format!(
                        "linked rewrite {}.{} made no progress",
                        rule.program, rule.name
                    ));
                }
                trace.push(RewriteTraceStep {
                    program: rule.program.clone(),
                    rule: rule.name.clone(),
                    before: term,
                    after: next.clone(),
                });
                term = next;
                let key = key_of(&term);
                if !seen.insert(key.clone()) {
                    return Err(format!(
                        "rewrite cycle after {} steps at {key}",
                        trace.len()
                    ));
                }
            }
            return Err(format!("rewrite step limit {max_steps} exceeded"));
        }
        let rules =
            combinator_kernel::resolve_rewrites(&self.programs, name, &self.disabled_operations)?;
        self.observe_combinator(&semantic_paths, &rules.observed, &["import-and-rebinding"])?;
        let mut term = input.clone();
        let mut trace = Vec::new();
        let mut seen = BTreeSet::from([key_of(&term)]);
        while trace.len() < max_steps {
            let execution =
                combinator_kernel::rewrite_once(&term, &rules, &self.disabled_operations)?;
            self.observe_combinator(
                &semantic_paths,
                &execution.observed,
                &["matching", "substitution", "rule-selection-and-traversal"],
            )?;
            let Some((next, program_name, rule_name)) = execution.step else {
                return Ok(ReductionResult { term, trace });
            };
            let rule = self
                .programs
                .get(&program_name)
                .and_then(|program| program.rewrites.iter().find(|rule| rule.name == rule_name))
                .ok_or_else(|| {
                    format!("combinator kernel selected unknown rule {program_name}.{rule_name}")
                })?;
            if next == term {
                return Err(format!(
                    "linked rewrite {}.{} made no progress",
                    rule.program, rule.name
                ));
            }
            trace.push(RewriteTraceStep {
                program: rule.program.clone(),
                rule: rule.name.clone(),
                before: term,
                after: next.clone(),
            });
            term = next;
            let key = key_of(&term);
            if !seen.insert(key.clone()) {
                return Err(format!(
                    "rewrite cycle after {} steps at {key}",
                    trace.len()
                ));
            }
        }
        Err(format!("rewrite step limit {max_steps} exceeded"))
    }

    pub fn prove(
        &self,
        name: &str,
        goal: &Node,
        facts: &[Node],
        max_rounds: usize,
        max_facts: usize,
    ) -> Option<LinkedProof> {
        let semantic_paths = ["prove-linked-judgement"];
        self.observe(&semantic_paths, "enforce-cycle-and-resource-bounds")
            .ok()?;
        if max_rounds == 0 || max_facts == 0 {
            return None;
        }
        let normalized_goal = self.reduce(name, goal, 10_000).ok()?.term;
        if self.execution_basis != ExecutionBasis::ClosedSk {
            return self.direct_prove(
                name,
                &normalized_goal,
                facts,
                max_rounds,
                max_facts,
                &semantic_paths,
            );
        }
        let created = combinator_kernel::create_proof_state(
            &self.programs,
            name,
            facts,
            &self.disabled_operations,
        )
        .ok()?;
        self.observe_combinator(
            &semantic_paths,
            &created.observed,
            &[
                "import-and-rebinding",
                "matching",
                "substitution",
                "rule-selection-and-traversal",
            ],
        )
        .ok()?;
        let mut state = created.state;
        if state.size > max_facts {
            return None;
        }
        let found =
            combinator_kernel::find_proof(&state, &normalized_goal, &self.disabled_operations)
                .ok()?;
        self.observe_combinator(&semantic_paths, &found.observed, &["result-verification"])
            .ok()?;
        if found.proof.is_some() {
            return found.proof;
        }
        // One legacy round could add many facts. The closed kernel emits one
        // derivation per transition, so preserve that capacity per round.
        for _ in 0..max_rounds.saturating_mul(max_facts) {
            let next = combinator_kernel::infer_once(state, &self.disabled_operations).ok()?;
            self.observe_combinator(
                &semantic_paths,
                &next.observed,
                &[
                    "matching",
                    "substitution",
                    "rule-selection-and-traversal",
                    "inference-saturation",
                ],
            )
            .ok()?;
            state = next.state;
            next.derivation.as_ref()?;
            if state.size > max_facts {
                return None;
            }
            let found =
                combinator_kernel::find_proof(&state, &normalized_goal, &self.disabled_operations)
                    .ok()?;
            self.observe_combinator(&semantic_paths, &found.observed, &["result-verification"])
                .ok()?;
            if found.proof.is_some() {
                return found.proof;
            }
        }
        None
    }

    fn direct_prove(
        &self,
        name: &str,
        normalized_goal: &Node,
        input_facts: &[Node],
        max_rounds: usize,
        max_facts: usize,
        semantic_paths: &[&str],
    ) -> Option<LinkedProof> {
        match self.execution_basis {
            ExecutionBasis::DirectStructural => {
                self.observe(semantic_paths, "saturate-inference-rules")
                    .ok()?;
            }
            ExecutionBasis::HornRelational => {
                self.observe(semantic_paths, "schedule-horn-saturation")
                    .ok()?;
            }
            ExecutionBasis::ClosedSk => return None,
        }

        fn add_known(
            registry: &LinkedProgramRegistry,
            program: &str,
            known: &mut BTreeMap<String, (Node, LinkedProof)>,
            judgement: &Node,
            proof: LinkedProof,
            max_facts: usize,
            semantic_paths: &[&str],
            derived: bool,
        ) -> Option<bool> {
            let normalized = registry.reduce(program, judgement, 10_000).ok()?.term;
            let key = key_of(&normalized);
            if known.contains_key(&key) {
                return Some(false);
            }
            if derived && registry.execution_basis == ExecutionBasis::HornRelational {
                registry
                    .observe(semantic_paths, "insert-derived-fact")
                    .ok()?;
            }
            known.insert(key, (normalized, proof));
            (known.len() <= max_facts).then_some(true)
        }

        let mut known = BTreeMap::new();
        let declared = self
            .effective_facts(name, semantic_paths, &mut BTreeSet::new(), &[])
            .ok()?;
        for fact in declared {
            let proof = LinkedProof {
                judgement: fact.judgement.clone(),
                program: fact.program,
                rule: fact.name,
                premises: Vec::new(),
            };
            add_known(
                self,
                name,
                &mut known,
                &fact.judgement,
                proof,
                max_facts,
                semantic_paths,
                false,
            )?;
        }
        for (index, fact) in input_facts.iter().enumerate() {
            let proof = LinkedProof {
                judgement: fact.clone(),
                program: "<input>".to_string(),
                rule: format!("input-{}", index + 1),
                premises: Vec::new(),
            };
            add_known(
                self,
                name,
                &mut known,
                fact,
                proof,
                max_facts,
                semantic_paths,
                false,
            )?;
        }
        let goal_key = key_of(normalized_goal);
        if let Some((_, proof)) = known.get(&goal_key) {
            return Some(proof.clone());
        }

        let rules = self
            .effective_inferences(name, semantic_paths, &mut BTreeSet::new(), &[])
            .ok()?;
        for _ in 0..max_rounds {
            let mut changed = false;
            for rule in &rules {
                let mut candidates = vec![(BTreeMap::new(), Vec::<LinkedProof>::new())];
                for premise in &rule.premises {
                    let mut next = Vec::new();
                    for (candidate_substitution, candidate_premises) in &candidates {
                        for (judgement, proof) in known.values() {
                            let mut substitution = candidate_substitution.clone();
                            let mut observe = |operation| self.observe(semantic_paths, operation);
                            if direct_match_term(
                                premise,
                                judgement,
                                &mut substitution,
                                &mut observe,
                            )
                            .ok()?
                            {
                                let mut premises = candidate_premises.clone();
                                premises.push(proof.clone());
                                next.push((substitution, premises));
                            }
                        }
                    }
                    candidates = next;
                    if candidates.is_empty() {
                        break;
                    }
                }
                for (substitution, premises) in candidates {
                    let mut observe = |operation| self.observe(semantic_paths, operation);
                    let judgement =
                        direct_instantiate(&rule.conclusion, &substitution, &mut observe).ok()?;
                    let proof = LinkedProof {
                        judgement: judgement.clone(),
                        program: rule.program.clone(),
                        rule: rule.name.clone(),
                        premises,
                    };
                    if add_known(
                        self,
                        name,
                        &mut known,
                        &judgement,
                        proof,
                        max_facts,
                        semantic_paths,
                        true,
                    )? {
                        changed = true;
                        if let Some((_, proof)) = known.get(&goal_key) {
                            return Some(proof.clone());
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }
        None
    }
}
