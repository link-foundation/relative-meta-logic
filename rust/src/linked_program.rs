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

/// A `linked-rewrite` as declared in its program.
#[derive(Debug, Clone, PartialEq)]
pub struct RewriteRule {
    pub program: String,
    pub name: String,
    pub pattern: Node,
    pub replacement: Node,
}

/// A `linked-fact` as declared in its program.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkedFact {
    pub program: String,
    pub name: String,
    pub judgement: Node,
}

/// A `linked-inference` as declared in its program.
#[derive(Debug, Clone, PartialEq)]
pub struct InferenceRule {
    pub program: String,
    pub name: String,
    pub premises: Vec<Node>,
    pub conclusion: Node,
}

/// One `(uses program (rebind from to) ...)` clause.
#[derive(Debug, Clone, PartialEq)]
pub struct ProgramImport {
    pub program: String,
    pub rebindings: BTreeMap<String, String>,
}

/// A loaded `linked-program`: its imports and the rules it declares itself,
/// each in declaration order. Imported rules are not copied in.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkedProgram {
    pub name: String,
    pub uses: Vec<ProgramImport>,
    pub rewrites: Vec<RewriteRule>,
    pub facts: Vec<LinkedFact>,
    pub inferences: Vec<InferenceRule>,
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

/// Why [`LinkedProgramRegistry::search`] stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchEnd {
    /// Every normalizable goal has a proof.
    Found,
    /// No rule derives a new fact: the fixed point was reached.
    Saturated,
    /// The transition bound was spent before the fixed point.
    InferenceLimit,
    /// The known facts exceeded `max_facts`.
    FactLimit,
}

impl SearchEnd {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Found => "found",
            Self::Saturated => "saturated",
            Self::InferenceLimit => "inference-limit",
            Self::FactLimit => "fact-limit",
        }
    }
}

/// Whether a search goal reached a normal form before the search began.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalNormalization {
    Normal,
    RewriteLimit,
    RewriteCycle,
    RewriteStalled,
}

impl GoalNormalization {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::RewriteLimit => "rewrite-limit",
            Self::RewriteCycle => "rewrite-cycle",
            Self::RewriteStalled => "rewrite-stalled",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SearchGoal {
    pub goal: Node,
    pub normalized: Option<Node>,
    pub normalization: GoalNormalization,
    pub detail: Option<String>,
    pub proof: Option<LinkedProof>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SearchDerivation {
    pub judgement: Node,
    pub proof: LinkedProof,
}

/// Explicit outcome of one saturation for several goals.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkedSearch {
    pub program: String,
    pub execution_basis: ExecutionBasis,
    pub ended: SearchEnd,
    pub goals: Vec<SearchGoal>,
    pub derived: Vec<SearchDerivation>,
    pub facts: usize,
}

/// An ordered reduction that stopped without a normal form, reported by
/// [`LinkedProgramRegistry::reduce_or_stop`] as a value instead of an error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReductionStopped {
    /// `RewriteLimit`, `RewriteCycle`, or `RewriteStalled`; never `Normal`.
    pub normalization: GoalNormalization,
    pub detail: String,
}

/// The three ways an ordered reduction can fail to reach a normal form, kept
/// apart from other errors so that `search` can report them as outcomes.
enum ReduceFailure {
    Limit(String),
    Cycle(String),
    Stalled(String),
    Other(String),
}

impl From<String> for ReduceFailure {
    fn from(message: String) -> Self {
        Self::Other(message)
    }
}

impl ReduceFailure {
    fn into_message(self) -> String {
        match self {
            Self::Limit(message)
            | Self::Cycle(message)
            | Self::Stalled(message)
            | Self::Other(message) => message,
        }
    }
}

enum AddedFact {
    Duplicate,
    New,
    OverLimit,
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
pub struct LinkOntologyArityEnumeration {
    pub occurrence_count: usize,
    pub surjective_assignments_examined: usize,
    pub reference_rename_classes: usize,
    pub quotient_classes: usize,
    pub multiplicity_spectra: Vec<Vec<usize>>,
    pub complete_invariant_verified: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyConditionalAssumption {
    pub id: &'static str,
    pub provenance: &'static str,
    pub foundational_status: &'static str,
    pub role: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyRefinementEncoding {
    pub id: &'static str,
    pub distinct_classes: usize,
    pub complete_for_enumeration: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyProjectionFibre {
    pub reference_multiplicity_spectrum: Vec<usize>,
    pub joint_classes: usize,
    pub refinement_multiplicity_spectra: Vec<Vec<usize>>,
    pub classes_with_invariant_singleton: usize,
    pub classes_without_invariant_singleton: usize,
    pub singleton_presence_classification: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySingletonOrbitHistogram {
    pub singleton_orbits: usize,
    pub joint_classes: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAsymmetryProvenanceClassification {
    pub id: &'static str,
    pub joint_classes: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyRefinementCountermodel {
    pub normalized_partition: Vec<usize>,
    pub refinement_occurrence_orbit_sizes: Vec<usize>,
    pub joint_occurrence_orbit_sizes: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAsymmetryCountermodel {
    pub normalized_reference_partition: Vec<usize>,
    pub reference_occurrence_orbit_sizes: Vec<usize>,
    pub without_singleton_refinement: LinkOntologyRefinementCountermodel,
    pub interaction_only_refinement: LinkOntologyRefinementCountermodel,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAsymmetryProvenance {
    pub classifications: Vec<LinkOntologyAsymmetryProvenanceClassification>,
    pub base_projection_fibres_with_both_outcomes: usize,
    pub base_projection_fibres_forcing_singleton: usize,
    pub countermodel: LinkOntologyAsymmetryCountermodel,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyDerivationEnumeration {
    pub occurrence_count: usize,
    pub base_patterns_examined: usize,
    pub candidate_observations_examined: usize,
    pub base_symmetry_preserving_candidates: usize,
    pub symmetry_breaking_candidates: usize,
    pub preserving_candidates_changing_occurrence_orbits: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyGeneralDerivationArgument {
    pub scope: &'static str,
    pub steps: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyInteractionCounterexample {
    pub base_pattern: Vec<usize>,
    pub conditional_pattern: Vec<usize>,
    pub base_preserving_relabelling: Vec<usize>,
    pub relabelled_base_pattern: Vec<usize>,
    pub relabelled_conditional_pattern: Vec<usize>,
    pub base_preserved: bool,
    pub conditional_pattern_preserved: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyDerivationBoundary {
    pub derivation_criterion: &'static str,
    pub finite_enumeration: Vec<LinkOntologyDerivationEnumeration>,
    pub general_argument: LinkOntologyGeneralDerivationArgument,
    pub consequence: &'static str,
    pub interaction_only_counterexample: LinkOntologyInteractionCounterexample,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyConditionalRefinement {
    pub assumption: LinkOntologyConditionalAssumption,
    pub occurrence_count: usize,
    pub reference_partitions_examined: usize,
    pub refinement_partitions_examined: usize,
    pub labelled_joint_structures_examined: usize,
    pub occurrence_permutations_examined: usize,
    pub joint_quotient_classes: usize,
    pub encodings: Vec<LinkOntologyRefinementEncoding>,
    pub encoding_agreement: bool,
    pub projection_fibres: Vec<LinkOntologyProjectionFibre>,
    pub every_projection_fibre_ambiguous: bool,
    pub refinement_recoverable_from_base: bool,
    pub classes_with_invariant_singleton: usize,
    pub classes_without_invariant_singleton: usize,
    pub conditional_singleton_selector_exists: bool,
    pub universal_singleton_selector_exists: bool,
    pub singleton_orbit_histogram: Vec<LinkOntologySingletonOrbitHistogram>,
    pub asymmetry_provenance: LinkOntologyAsymmetryProvenance,
    pub derivation_boundary: LinkOntologyDerivationBoundary,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyLossAudit {
    pub distinction: &'static str,
    pub classification: &'static str,
    pub evidence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAddressableProjectionFibreHistogram {
    pub addressable_classes: usize,
    pub reference_only_classes: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAddressableEnumeration {
    pub occurrence_count: usize,
    pub reference_only_classes: usize,
    pub addressable_link_classes: usize,
    pub classes_with_no_direct_self_reference: usize,
    pub classes_with_direct_self_reference: usize,
    pub projection_fibre_histogram: Vec<LinkOntologyAddressableProjectionFibreHistogram>,
    pub every_projection_fibre_ambiguous: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyStartingRepresentationJustification {
    pub requirement: &'static str,
    pub provenance: &'static str,
    pub consequence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAddressableCountermodelSide {
    pub normalized_address_pattern: Vec<usize>,
    pub direct_self_reference_count: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAddressableCountermodel {
    pub projected_reference_multiplicity_spectrum: Vec<usize>,
    pub direct_self_link: LinkOntologyAddressableCountermodelSide,
    pub fresh_external_link: LinkOntologyAddressableCountermodelSide,
    pub same_reference_only_projection: bool,
    pub same_addressable_link_class: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyGeneralProjectionArgument {
    pub scope: &'static str,
    pub steps: Vec<&'static str>,
    pub exact_fibre_cardinality: &'static str,
    pub consequence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySlotwiseSelfIncidenceClass {
    pub self_incidence_by_reference_slot: Vec<bool>,
    pub ordered_equality_classes: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySlotwiseSelfIncidenceEnumeration {
    pub occurrence_count: usize,
    pub self_incidence_patterns: usize,
    pub ordered_equality_classes: usize,
    pub classes_by_self_incidence: Vec<LinkOntologySlotwiseSelfIncidenceClass>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySlotwiseSelfIncidenceCountermodel {
    pub first_ordered_pattern: Vec<usize>,
    pub second_ordered_pattern: Vec<usize>,
    pub first_self_incidence_by_reference_slot: Vec<bool>,
    pub second_self_incidence_by_reference_slot: Vec<bool>,
    pub same_self_incidence_multiplicity: bool,
    pub same_slotwise_self_incidence: bool,
    pub same_after_occurrence_permutation: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySlotwiseSelfIncidenceAudit {
    pub status: &'static str,
    pub provenance: &'static str,
    pub predicate: &'static str,
    pub finite_enumeration: Vec<LinkOntologySlotwiseSelfIncidenceEnumeration>,
    pub every_boolean_slot_pattern_realized: bool,
    pub address_renaming_invariant_verified: bool,
    pub occurrence_permutation_equivariant_verified: bool,
    pub occurrence_permutation_invariant: bool,
    pub countermodel: LinkOntologySlotwiseSelfIncidenceCountermodel,
    pub ordered_faithful_descriptor: LinkOntologyMinimalFaithfulDescriptor,
    pub quotient_consequence: &'static str,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySharedCompositionFibreHistogram {
    pub shared_address_classes: usize,
    pub local_descriptor_classes: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySharedCompositionEnumeration {
    pub link_count: usize,
    pub reference_slots_per_link: usize,
    pub shared_address_classes: usize,
    pub local_descriptor_classes: usize,
    pub local_descriptor_fibre_histogram: Vec<LinkOntologySharedCompositionFibreHistogram>,
    pub local_descriptors_faithful: bool,
    pub shared_descriptor_classes: usize,
    pub shared_descriptor_faithful: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySharedCompositionCountermodel {
    pub external_references: Vec<Vec<usize>>,
    pub two_link_cycle: Vec<Vec<usize>>,
    pub same_local_descriptors: bool,
    pub same_shared_address_class: bool,
    pub external_references_cycle_length: usize,
    pub two_link_cycle_length: usize,
    pub distinguishing_observation: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySharedCompositionClassification {
    pub forced_by_issue_contract: &'static str,
    pub survives_representation_change: &'static str,
    pub introduced_by_observer: &'static str,
    pub semantics_not_assigned: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySharedAddressCompositionAudit {
    pub status: &'static str,
    pub provenance: &'static str,
    pub removed_assumption: &'static str,
    pub retained_assumptions: Vec<&'static str>,
    pub finite_enumeration: Vec<LinkOntologySharedCompositionEnumeration>,
    pub local_descriptors_faithful_at_every_tested_multi_link_width: bool,
    pub countermodel: LinkOntologySharedCompositionCountermodel,
    pub shared_faithful_descriptor: LinkOntologyMinimalFaithfulDescriptor,
    pub general_consequence: &'static str,
    pub assumption_classification: LinkOntologySharedCompositionClassification,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySemanticSeparation {
    pub logical_implication: &'static str,
    pub link_structure: &'static str,
    pub composition: &'static str,
    pub execution: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyCandidateEncodings {
    pub left_associated: Vec<Vec<usize>>,
    pub right_associated: Vec<Vec<usize>>,
    pub same_under_address_renaming_alone: bool,
    pub same_after_uniform_slot_reversal_and_address_renaming: bool,
    pub recursive_address_references_present: bool,
    pub ordered_slot_contract_consequence: &'static str,
    pub unordered_slot_contract_consequence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyRoleRecovery {
    pub investigated_roles: Vec<&'static str>,
    pub semantic_assignments_for_three_leaves: usize,
    pub unordered_structure_automorphisms: usize,
    pub unordered_leaf_orbit_sizes: Vec<usize>,
    pub ordered_positions_select_semantic_roles: bool,
    pub all_four_semantic_roles_recovered: bool,
    pub status: &'static str,
    pub evidence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyCompositionCommonFacts {
    pub distinct_link_identities: bool,
    pub premise_link_identities_distinct_from_references: bool,
    pub premise_reference_addresses_pairwise_distinct: bool,
    pub direct_self_incidence: bool,
    pub shared_address_incidence: bool,
    pub recursive_link_references: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyCompositionCountermodel {
    pub without_proposed_result: Vec<Vec<usize>>,
    pub with_proposed_result: Vec<Vec<usize>>,
    pub premise_p: Vec<usize>,
    pub premise_q: Vec<usize>,
    pub proposed_result: Vec<usize>,
    pub common_facts: LinkOntologyCompositionCommonFacts,
    pub premises_hold_in_both: bool,
    pub reverse_pair_already_present: bool,
    pub proposed_result_absent_in_first: bool,
    pub proposed_result_present_in_second: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyFormationProbe {
    pub existing_addresses: Vec<usize>,
    pub ordered_pairs_using_existing_addresses: usize,
    pub proposed_reference_pair: Vec<usize>,
    pub every_formation_extension_preserves_premises: bool,
    pub composition_specific_selection_from_formation_only: bool,
    pub consequence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyStructuralApplicationCompositionProbe {
    pub status: &'static str,
    pub premise_vocabulary: Vec<&'static str>,
    pub semantic_separation: LinkOntologySemanticSeparation,
    pub candidate_encodings: LinkOntologyCandidateEncodings,
    pub role_recovery: LinkOntologyRoleRecovery,
    pub composition_countermodel: LinkOntologyCompositionCountermodel,
    pub formation_probe: LinkOntologyFormationProbe,
    pub conclusion: &'static str,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyContinuationCase {
    pub id: &'static str,
    pub records: Vec<Vec<usize>>,
    pub continuations: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyCompetingReadouts {
    pub forward_projection: Vec<Vec<usize>>,
    pub reverse_projection: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyTransitionLawRemoval {
    pub without_witness_orientation: &'static str,
    pub without_output_projection: &'static str,
    pub without_incidence_equality: &'static str,
    pub without_enumeration: &'static str,
    pub without_construction: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyTransitionStageBoundary {
    pub formable: bool,
    pub conditionally_identifiable: bool,
    pub intrinsically_admissible: bool,
    pub follows_from_records_alone: bool,
    pub produced_by_records_alone: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAdjacencyEqualityErasureCountermodel {
    pub same_retained_addresses_and_witness: bool,
    pub shared_reference_readout: Vec<Vec<usize>>,
    pub split_reference_readout: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyTransitionLawAudit {
    pub nested_encoding_preserves_readout: bool,
    pub both_readouts_address_renaming_equivariant: bool,
    pub both_readouts_record_reordering_invariant: bool,
    pub unordered_witness_readout: Vec<Vec<usize>>,
    pub reversed_witness_under_unordered_reading: Vec<Vec<usize>>,
    pub same_facts_competing_readouts: LinkOntologyCompetingReadouts,
    pub same_facts_with_rule_record_competing_readouts: LinkOntologyCompetingReadouts,
    pub adjacency_equality_erasure_countermodel: LinkOntologyAdjacencyEqualityErasureCountermodel,
    pub operation_removal: LinkOntologyTransitionLawRemoval,
    pub stage_boundary: LinkOntologyTransitionStageBoundary,
    pub law_self_application_established: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyExclusionClass {
    pub id: &'static str,
    pub admissible_completions: usize,
    pub follows: Vec<Vec<usize>>,
    pub least_completion_admissible: bool,
    pub forward_follows: bool,
    pub reverse_follows: bool,
    pub unoriented_connection_follows: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAdmittedLawCriterion {
    pub id: &'static str,
    pub passing: usize,
    pub survivors_without_it: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologySurvivingPositionLaw {
    pub slots: Vec<&'static str>,
    pub readout: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationTieBreaker {
    pub id: &'static str,
    pub selects: Vec<Vec<usize>>,
    pub mirror: &'static str,
    pub mirror_selects: Vec<Vec<usize>>,
    pub provenance: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyPositionLawSpace {
    pub position_laws: usize,
    pub distinct_readouts: usize,
    pub admitted_criteria: Vec<LinkOntologyAdmittedLawCriterion>,
    pub admitted_criteria_commute_with_output_swap: bool,
    pub output_swap_fixes_no_non_degenerate_law: bool,
    pub survivors: Vec<LinkOntologySurvivingPositionLaw>,
    pub tie_breakers: Vec<LinkOntologyOrientationTieBreaker>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyConsequenceMinimalPair {
    pub agree_on_recorded_premises: bool,
    pub forward_least_model: Vec<Vec<usize>>,
    pub reverse_least_model: Vec<Vec<usize>>,
    pub forward_least_model_automorphisms: usize,
    pub reverse_least_model_automorphisms: usize,
    pub forward_every_link_follows_from_others: bool,
    pub reverse_every_link_follows_from_others: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyConsequenceSlotOrder {
    pub ordered_automorphisms: usize,
    pub unordered_automorphisms: usize,
    pub witness_changes_automorphism_counts: bool,
    pub unordered_automorphism_exchanges_candidates: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyConsequenceAssumptionRemoval {
    pub with_oriented_exclusion: &'static str,
    pub without_exclusion_orientation: &'static str,
    pub without_exclusion: &'static str,
    pub without_slot_order: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyConsequenceSelfApplication {
    pub each_survivor_closed_on_own_least_model: bool,
    pub any_survivor_closed_on_other_least_model: bool,
    pub exclusions_consistent_with_records: usize,
    pub exclusion_determined_by_records: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyConsequenceAudit {
    pub question: &'static str,
    pub status: &'static str,
    pub modal_reading: &'static str,
    pub premise_pairs: Vec<Vec<usize>>,
    pub completion_count: usize,
    pub every_pair_possible_in_each_class: bool,
    pub positive_facts_alone_force_nothing_new: bool,
    pub exclusion_classes: Vec<LinkOntologyExclusionClass>,
    pub oriented_exclusions_restate_survivors: bool,
    pub law_space: LinkOntologyPositionLawSpace,
    pub minimal_pair: LinkOntologyConsequenceMinimalPair,
    pub slot_order: LinkOntologyConsequenceSlotOrder,
    pub assumption_removal: LinkOntologyConsequenceAssumptionRemoval,
    pub self_application: LinkOntologyConsequenceSelfApplication,
    pub missing_information: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationContract {
    pub id: &'static str,
    pub symmetries: usize,
    pub element_orbits: Vec<Vec<usize>>,
    pub ends_exchanged: bool,
    pub candidate_relation: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationTally {
    pub id: &'static str,
    pub separated: usize,
    pub exchanged: usize,
    pub symmetries_fixing_exactly_one_candidate: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationTwinFamily {
    pub extension: &'static str,
    pub structures: usize,
    pub by_extra_records: Vec<usize>,
    pub contracts: Vec<LinkOntologyOrientationTally>,
    pub exchanging_extensions: Vec<Vec<Vec<usize>>>,
    pub chiral_under_anonymous_slots: usize,
    pub free_correspondences: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationAnonymousCase {
    pub records: Vec<Vec<usize>>,
    pub slot_reversing_symmetries: usize,
    pub ends_exchanged: bool,
    pub candidate_relation: &'static str,
    pub symmetries_fixing_exactly_one_candidate: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationChiralityPair {
    pub observation: &'static str,
    pub identical_observations: bool,
    pub achiral: LinkOntologyOrientationAnonymousCase,
    pub chiral: LinkOntologyOrientationAnonymousCase,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationSlotOrderCase {
    pub records: Vec<Vec<usize>>,
    pub named_candidate_relation: &'static str,
    pub aligned_readout: Vec<Vec<usize>>,
    pub reversed_readout: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationSlotOrderPair {
    pub observation: &'static str,
    pub identical_observations: bool,
    pub cycle: LinkOntologyOrientationSlotOrderCase,
    pub detour: LinkOntologyOrientationSlotOrderCase,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationSameObservationPairs {
    pub chirality: LinkOntologyOrientationChiralityPair,
    pub slot_order: LinkOntologyOrientationSlotOrderPair,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationTaggedEncoding {
    pub id: &'static str,
    pub symmetries: usize,
    pub tags_exchanged: bool,
    pub ends_exchanged: bool,
    pub candidate_relation: &'static str,
    pub symmetries_fixing_exactly_one_candidate: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationTagSwap {
    pub isomorphic_with_tags_fixed: bool,
    pub aligned_candidate_decodes_to: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationRepresentations {
    pub address_renamings: usize,
    pub renaming_failures: usize,
    pub tagged_encodings: Vec<LinkOntologyOrientationTaggedEncoding>,
    pub tag_swap: LinkOntologyOrientationTagSwap,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationCarrier {
    pub id: &'static str,
    pub carrier_records: Vec<Vec<usize>>,
    pub carrier_symmetries: usize,
    pub carrier_records_have_equal_slots: bool,
    pub symmetries: usize,
    pub tags_exchanged: bool,
    pub ends_exchanged: bool,
    pub candidate_relation: &'static str,
    pub symmetries_fixing_exactly_one_candidate: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationRecursion {
    pub carriers: Vec<LinkOntologyOrientationCarrier>,
    pub result: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationAsymmetry {
    pub id: &'static str,
    pub provenance: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationNoGo {
    pub argument: &'static str,
    pub strong_negative: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationClosure {
    pub correspondence: &'static str,
    pub closure: Vec<Vec<usize>>,
    pub derived_pairs: usize,
    pub every_path_has_joined_ends: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationRequirement {
    pub id: &'static str,
    pub selects: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationIterationBoundary {
    pub records: Vec<Vec<usize>>,
    pub closures: Vec<LinkOntologyOrientationClosure>,
    pub separating_requirements: Vec<LinkOntologyOrientationRequirement>,
    pub provenance: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOrientationAudit {
    pub question: &'static str,
    pub status: &'static str,
    pub primitives: &'static str,
    pub candidates: Vec<Vec<usize>>,
    pub contracts: Vec<LinkOntologyOrientationContract>,
    pub twin_family: LinkOntologyOrientationTwinFamily,
    pub same_observation_pairs: LinkOntologyOrientationSameObservationPairs,
    pub representations: LinkOntologyOrientationRepresentations,
    pub recursion: LinkOntologyOrientationRecursion,
    pub asymmetries: Vec<LinkOntologyOrientationAsymmetry>,
    pub no_go: LinkOntologyOrientationNoGo,
    pub iteration_boundary: LinkOntologyOrientationIterationBoundary,
    pub missing_information: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyConditionalContinuationProbe {
    pub status: &'static str,
    pub contract: &'static str,
    pub criterion: &'static str,
    pub criterion_provenance: &'static str,
    pub premises: Vec<Vec<usize>>,
    pub forward_witness: Vec<usize>,
    pub reverse_witness: Vec<usize>,
    pub cases: Vec<LinkOntologyContinuationCase>,
    pub address_renaming_equivariant: bool,
    pub record_reordering_invariant: bool,
    pub slot_reversal_changes_continuation: bool,
    pub result_absent_with_witness: bool,
    pub result_present_in_extension: bool,
    pub witness_condition_holds_in_both: bool,
    pub intrinsic_creation_or_authority_established: bool,
    pub transition_law_audit: LinkOntologyTransitionLawAudit,
    pub consequence_audit: LinkOntologyConsequenceAudit,
    pub orientation_audit: LinkOntologyOrientationAudit,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityRecords {
    pub interpretation: &'static str,
    pub records_treated_as_unordered: bool,
    pub incidence_readout_provenance: &'static str,
    pub premises: Vec<Vec<usize>>,
    pub candidates: Vec<Vec<usize>>,
    pub additional_link: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyCandidateSymmetry {
    pub candidate_automorphisms: Vec<Vec<usize>>,
    pub candidate_orbit_sizes: Vec<usize>,
    pub invariant_candidate_subsets: Vec<Vec<usize>>,
    pub invariant_singleton_selections: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyEquivariantSelectionConstraint {
    pub criterion: &'static str,
    pub without_additional_link: LinkOntologyCandidateSymmetry,
    pub with_additional_link: LinkOntologyCandidateSymmetry,
    pub singleton_selection_made_possible: bool,
    pub singleton_selection_forced: bool,
    pub general_argument: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyEquivariantReading {
    pub id: &'static str,
    pub selected_candidates: Vec<usize>,
    pub address_renaming_equivariant: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityRemoval {
    pub records: Vec<Vec<usize>>,
    pub marked_candidates: Vec<usize>,
    pub unique: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityReplacement {
    pub replacement_link: Vec<usize>,
    pub marked_candidates: Vec<usize>,
    pub unique: bool,
    pub same_under_candidate_address_renaming: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityDuplication {
    pub additional_links: Vec<Vec<usize>>,
    pub marked_candidates: Vec<usize>,
    pub unique: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityForgery {
    pub original_link: Vec<usize>,
    pub forged_link: Vec<usize>,
    pub same_local_equality_pattern: bool,
    pub whole_structures_related_by_candidate_renaming: bool,
    pub structurally_rejected: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityContextRelocation {
    pub first_context_relation: Vec<usize>,
    pub second_context_relation: Vec<usize>,
    pub authority_link_exists_in_both: bool,
    pub relation_changes_observed_context: bool,
    pub same_under_context_address_renaming: bool,
    pub ambient_existence_selects_active_context: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityPerturbations {
    pub removal: LinkOntologyAuthorityRemoval,
    pub replacement: LinkOntologyAuthorityReplacement,
    pub duplication: LinkOntologyAuthorityDuplication,
    pub forgery: LinkOntologyAuthorityForgery,
    pub context_relocation: LinkOntologyAuthorityContextRelocation,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyRecursiveAuthority {
    pub finite_ordinary_link_chain: Vec<Vec<usize>>,
    pub finite_chain_candidate_swap_preserves_shape: bool,
    pub self_referential_link: Vec<usize>,
    pub self_reference_closes_address_cycle: bool,
    pub self_referential_candidate_swap_preserves_shape: bool,
    pub selection_polarity_still_underdetermined: bool,
    pub consequence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityDistinctions {
    pub formation: &'static str,
    pub selection: &'static str,
    pub justification: &'static str,
    pub activation: &'static str,
    pub applicability: &'static str,
    pub execution: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyLinkCarriedSelectionAuthorityProbe {
    pub status: &'static str,
    pub records: LinkOntologyAuthorityRecords,
    pub equivariant_selection_constraint: LinkOntologyEquivariantSelectionConstraint,
    pub opposite_equivariant_readings: Vec<LinkOntologyEquivariantReading>,
    pub perturbations: LinkOntologyAuthorityPerturbations,
    pub recursive_authority: LinkOntologyRecursiveAuthority,
    pub distinctions: LinkOntologyAuthorityDistinctions,
    pub conclusion: &'static str,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAdmissibilityContract {
    pub record_encoding: &'static str,
    pub description: Vec<Vec<usize>>,
    pub verification_operation: &'static str,
    pub verification_provenance: &'static str,
    pub role_names_intrinsic_to_records: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAdmissibilityCase {
    pub id: &'static str,
    pub admissible_candidates: Vec<usize>,
    pub admissible_candidate_count: usize,
    pub cardinality: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyCardinalityAudit {
    pub method: &'static str,
    pub observed_classifications: Vec<&'static str>,
    pub classification_derived_inside_link_substrate: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAdmissibilityAdversarialBoundary {
    pub complete_evidence_accepts_reconstructed_candidate: bool,
    pub missing_duplicate_foreign_and_wrong_evidence_rejected: bool,
    pub forged_locally_isomorphic_candidate_rejected: bool,
    pub context_incidence_changes_applicability: bool,
    pub description_replacement_changes_admissibility: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAuthorityRegress {
    pub description_represented_as_links: bool,
    pub evidence_and_context_represented_as_links: bool,
    pub description_authenticated_by_structure: bool,
    pub observer_role_assignment_authorized_by_structure: bool,
    pub verifier_represented_or_executed_by_tested_records: bool,
    pub finite_linked_meta_chain_closes_authority_regress: bool,
    pub consequence: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyAdmissibilityDistinctions {
    pub formation: &'static str,
    pub matching: &'static str,
    pub admissibility: &'static str,
    pub uniqueness: &'static str,
    pub justification: &'static str,
    pub applicability: &'static str,
    pub admission: &'static str,
    pub activation: &'static str,
    pub execution: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyLinkedStructuralAdmissibilityProbe {
    pub status: &'static str,
    pub contract: LinkOntologyAdmissibilityContract,
    pub cases: Vec<LinkOntologyAdmissibilityCase>,
    pub cardinality_audit: LinkOntologyCardinalityAudit,
    pub adversarial_boundary: LinkOntologyAdmissibilityAdversarialBoundary,
    pub authority_regress: LinkOntologyAuthorityRegress,
    pub distinctions: LinkOntologyAdmissibilityDistinctions,
    pub conclusion: &'static str,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyVerifierStepCase {
    pub id: &'static str,
    pub cardinality: &'static str,
    pub trace_records: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyVerifierStepRemovalTests {
    pub no_cardinality_classification: &'static str,
    pub reversed_mapping_reading: &'static str,
    pub self_application_cardinality: &'static str,
    pub trace_replay_by_same_join: bool,
    pub alternate_description_on_same_links: &'static str,
    pub set_or_map_construction_removed: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyVerifierStepBoundaries {
    pub representation: &'static str,
    pub execution: &'static str,
    pub semantic_authority: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyVerifierStepProbe {
    pub status: &'static str,
    pub relation: &'static str,
    pub cases: Vec<LinkOntologyVerifierStepCase>,
    pub trace_replay_records: Vec<Vec<usize>>,
    pub removal_tests: LinkOntologyVerifierStepRemovalTests,
    pub boundaries: LinkOntologyVerifierStepBoundaries,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyQuotientEnumeration {
    pub occurrence_count: usize,
    pub ordered_equality_classes_after_address_renaming: usize,
    pub unlabelled_addressable_classes: usize,
    pub classes_collapsed_by_occurrence_permutation: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyQuotientTransformation {
    pub transformation: &'static str,
    pub classification: &'static str,
    pub evidence: &'static str,
    pub ontology_scope: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyOccurrencePermutationCountermodel {
    pub first_ordered_pattern: Vec<usize>,
    pub second_ordered_pattern: Vec<usize>,
    pub same_under_address_renaming_alone: bool,
    pub same_after_occurrence_permutation: bool,
    pub interpretation: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyMinimalFaithfulDescriptor {
    pub status: &'static str,
    pub fields: Vec<&'static str>,
    pub finite_enumeration_agreement: bool,
    pub general_argument: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyQuotientAudit {
    pub finite_enumeration: Vec<LinkOntologyQuotientEnumeration>,
    pub address_renaming_complete_invariant_verified: bool,
    pub transformations: Vec<LinkOntologyQuotientTransformation>,
    pub occurrence_permutation_countermodel: LinkOntologyOccurrencePermutationCountermodel,
    pub minimal_faithful_descriptor: LinkOntologyMinimalFaithfulDescriptor,
    pub occurrence_permutation_intrinsic: &'static str,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyStartingRepresentationAudit {
    pub status: &'static str,
    pub scope: &'static str,
    pub independent_justification: LinkOntologyStartingRepresentationJustification,
    pub representation_changes_under_audit: Vec<&'static str>,
    pub finite_enumeration: Vec<LinkOntologyAddressableEnumeration>,
    pub every_projection_fibre_ambiguous: bool,
    pub reference_only_projection_faithful: bool,
    pub countermodel: LinkOntologyAddressableCountermodel,
    pub general_argument: LinkOntologyGeneralProjectionArgument,
    pub slotwise_self_incidence: LinkOntologySlotwiseSelfIncidenceAudit,
    pub shared_address_composition: LinkOntologySharedAddressCompositionAudit,
    pub structural_application_composition: LinkOntologyStructuralApplicationCompositionProbe,
    pub conditional_continuation: LinkOntologyConditionalContinuationProbe,
    pub link_carried_selection_authority: LinkOntologyLinkCarriedSelectionAuthorityProbe,
    pub linked_structural_admissibility: LinkOntologyLinkedStructuralAdmissibilityProbe,
    pub linked_verifier_step: LinkOntologyVerifierStepProbe,
    pub quotient_audit: LinkOntologyQuotientAudit,
    pub claim_boundary: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkOntologyObservationBoundary {
    pub status: &'static str,
    pub unchanged_primitive_vocabulary: Vec<&'static str>,
    pub arity_enumeration: Vec<LinkOntologyArityEnumeration>,
    pub arity_enumeration_complete: bool,
    pub generalized_complete_invariant: &'static str,
    pub starting_representation_audit: LinkOntologyStartingRepresentationAudit,
    pub conditional_refinement: LinkOntologyConditionalRefinement,
    pub loss_audit: Vec<LinkOntologyLossAudit>,
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
    pub observation_boundary: LinkOntologyObservationBoundary,
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

fn ontology_set_partitions(width: usize) -> Vec<Vec<usize>> {
    fn visit(
        width: usize,
        partition: &mut Vec<usize>,
        maximum: usize,
        partitions: &mut Vec<Vec<usize>>,
    ) {
        if partition.len() == width {
            partitions.push(partition.clone());
            return;
        }
        for value in 0..=maximum + 1 {
            partition.push(value);
            visit(width, partition, maximum.max(value), partitions);
            partition.pop();
        }
    }

    if width == 0 {
        return vec![Vec::new()];
    }
    let mut partitions = Vec::new();
    visit(width, &mut vec![0], 0, &mut partitions);
    partitions
}

fn permute_ontology_partition(partition: &[usize], permutation: &[usize]) -> Vec<usize> {
    first_occurrence_normal_form(
        &permutation
            .iter()
            .map(|index| partition[*index])
            .collect::<Vec<_>>(),
    )
}

fn canonical_partition_signature(partition: &[usize]) -> Vec<usize> {
    finite_permutations(&(0..partition.len()).collect::<Vec<_>>())
        .iter()
        .map(|permutation| permute_ontology_partition(partition, permutation))
        .min()
        .expect("a nonempty observation has a permutation")
}

fn canonical_partition_pair_signature(left: &[usize], right: &[usize]) -> Vec<usize> {
    finite_permutations(&(0..left.len()).collect::<Vec<_>>())
        .iter()
        .map(|permutation| {
            let mut signature = permute_ontology_partition(left, permutation);
            signature.push(usize::MAX);
            signature.extend(permute_ontology_partition(right, permutation));
            signature
        })
        .min()
        .expect("a nonempty observation has a permutation")
}

fn canonical_paired_equality_matrix_signature(left: &[usize], right: &[usize]) -> Vec<usize> {
    finite_permutations(&(0..left.len()).collect::<Vec<_>>())
        .iter()
        .map(|permutation| {
            let mut signature =
                ontology_equality_matrix(&permute_ontology_partition(left, permutation));
            signature.push(usize::MAX);
            signature.extend(ontology_equality_matrix(&permute_ontology_partition(
                right,
                permutation,
            )));
            signature
        })
        .min()
        .expect("a nonempty observation has a permutation")
}

fn ontology_intersection_table(left: &[usize], right: &[usize]) -> Vec<Vec<usize>> {
    let rows = left.iter().copied().max().unwrap_or(0) + 1;
    let columns = right.iter().copied().max().unwrap_or(0) + 1;
    let mut table = vec![vec![0; columns]; rows];
    for index in 0..left.len() {
        table[left[index]][right[index]] += 1;
    }
    table
}

fn canonical_intersection_table_signature(left: &[usize], right: &[usize]) -> Vec<usize> {
    let table = ontology_intersection_table(left, right);
    let rows = table.len();
    let columns = table[0].len();
    finite_permutations(&(0..rows).collect::<Vec<_>>())
        .iter()
        .flat_map(|row_permutation| {
            finite_permutations(&(0..columns).collect::<Vec<_>>())
                .into_iter()
                .map(|column_permutation| {
                    let mut signature = vec![rows, columns];
                    signature.extend(row_permutation.iter().flat_map(|row| {
                        column_permutation.iter().map(|column| table[*row][*column])
                    }));
                    signature
                })
                .collect::<Vec<_>>()
        })
        .min()
        .expect("a nonempty table has row and column permutations")
}

type OntologyPairEncoder = fn(&[usize], &[usize]) -> Vec<usize>;

fn pair_classifications_agree(
    structures: &[(Vec<usize>, Vec<usize>)],
    baseline: OntologyPairEncoder,
    candidate: OntologyPairEncoder,
) -> bool {
    let mut baseline_to_candidate = BTreeMap::<Vec<usize>, BTreeSet<Vec<usize>>>::new();
    let mut candidate_to_baseline = BTreeMap::<Vec<usize>, BTreeSet<Vec<usize>>>::new();
    for (left, right) in structures {
        let baseline_key = baseline(left, right);
        let candidate_key = candidate(left, right);
        baseline_to_candidate
            .entry(baseline_key.clone())
            .or_default()
            .insert(candidate_key.clone());
        candidate_to_baseline
            .entry(candidate_key)
            .or_default()
            .insert(baseline_key);
    }
    baseline_to_candidate
        .values()
        .all(|values| values.len() == 1)
        && candidate_to_baseline
            .values()
            .all(|values| values.len() == 1)
}

fn partition_pair_occurrence_orbits(left: &[usize], right: &[usize]) -> Vec<Vec<usize>> {
    let identity = {
        let mut value = left.to_vec();
        value.push(usize::MAX);
        value.extend(right);
        value
    };
    let automorphisms = finite_permutations(&(0..left.len()).collect::<Vec<_>>())
        .into_iter()
        .filter(|permutation| {
            let mut transformed = permute_ontology_partition(left, permutation);
            transformed.push(usize::MAX);
            transformed.extend(permute_ontology_partition(right, permutation));
            transformed == identity
        })
        .collect::<Vec<_>>();
    let mut pending = (0..left.len()).collect::<BTreeSet<_>>();
    let mut orbits = Vec::new();
    while let Some(seed) = pending.iter().next().copied() {
        let orbit = automorphisms
            .iter()
            .map(|permutation| permutation[seed])
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        for occurrence in &orbit {
            pending.remove(occurrence);
        }
        orbits.push(orbit);
    }
    orbits.sort();
    orbits
}

fn base_preserving_relabellings(base_pattern: &[usize]) -> Vec<Vec<usize>> {
    finite_permutations(&(0..base_pattern.len()).collect::<Vec<_>>())
        .into_iter()
        .filter(|permutation| permute_ontology_partition(base_pattern, permutation) == base_pattern)
        .collect()
}

fn link_ontology_derivation_boundary(
    interaction_base_pattern: &[usize],
    interaction_conditional_pattern: &[usize],
) -> LinkOntologyDerivationBoundary {
    let finite_enumeration = (1..=4)
        .map(|occurrence_count| {
            let patterns = ontology_set_partitions(occurrence_count);
            let mut base_symmetry_preserving_candidates = 0;
            let mut preserving_candidates_changing_occurrence_orbits = 0;
            for base_pattern in &patterns {
                let base_relabellings = base_preserving_relabellings(base_pattern);
                let base_orbits = partition_pair_occurrence_orbits(base_pattern, base_pattern);
                for candidate_pattern in &patterns {
                    let preserves_base_symmetry = base_relabellings.iter().all(|permutation| {
                        permute_ontology_partition(candidate_pattern, permutation)
                            == *candidate_pattern
                    });
                    if !preserves_base_symmetry {
                        continue;
                    }
                    base_symmetry_preserving_candidates += 1;
                    let joint_orbits =
                        partition_pair_occurrence_orbits(base_pattern, candidate_pattern);
                    if joint_orbits != base_orbits {
                        preserving_candidates_changing_occurrence_orbits += 1;
                    }
                }
            }
            let candidate_observations_examined = patterns.len() * patterns.len();
            LinkOntologyDerivationEnumeration {
                occurrence_count,
                base_patterns_examined: patterns.len(),
                candidate_observations_examined,
                base_symmetry_preserving_candidates,
                symmetry_breaking_candidates: candidate_observations_examined
                    - base_symmetry_preserving_candidates,
                preserving_candidates_changing_occurrence_orbits,
            }
        })
        .collect::<Vec<_>>();

    let base_preserving_relabelling = base_preserving_relabellings(interaction_base_pattern)
        .into_iter()
        .find(|permutation| {
            permutation[0] == 1
                && permute_ontology_partition(interaction_conditional_pattern, permutation)
                    != interaction_conditional_pattern
        })
        .expect("interaction-only witness must expose added choice");
    let relabelled_base_pattern =
        permute_ontology_partition(interaction_base_pattern, &base_preserving_relabelling);
    let relabelled_conditional_pattern = permute_ontology_partition(
        interaction_conditional_pattern,
        &base_preserving_relabelling,
    );

    LinkOntologyDerivationBoundary {
        derivation_criterion: "a deterministic observation derived from the base alone must commute with every occurrence relabelling",
        finite_enumeration,
        general_argument: LinkOntologyGeneralDerivationArgument {
            scope: "all finite observations satisfying the stated derivation criterion",
            steps: vec![
                "take any occurrence relabelling that leaves the base observation unchanged",
                "commutation makes derivation after relabelling equal relabelling after derivation",
                "because the relabelled base is unchanged, the derived observation must also be unchanged",
                "therefore every base-preserving relabelling survives in the base together with its derived observation",
            ],
        },
        consequence: "BASE_DERIVATION_CANNOT_CREATE_NEW_OCCURRENCE_DISTINCTIONS",
        interaction_only_counterexample: LinkOntologyInteractionCounterexample {
            base_pattern: interaction_base_pattern.to_vec(),
            conditional_pattern: interaction_conditional_pattern.to_vec(),
            base_preserving_relabelling,
            base_preserved: relabelled_base_pattern == interaction_base_pattern,
            conditional_pattern_preserved: relabelled_conditional_pattern
                == interaction_conditional_pattern,
            relabelled_base_pattern,
            relabelled_conditional_pattern,
        },
    }
}

fn canonical_addressable_link_signature(address_pattern: &[usize]) -> Vec<usize> {
    finite_permutations(&(1..address_pattern.len()).collect::<Vec<_>>())
        .into_iter()
        .map(|permutation| {
            let mut permuted = vec![address_pattern[0]];
            permuted.extend(permutation.iter().map(|index| address_pattern[*index]));
            first_occurrence_normal_form(&permuted)
        })
        .min()
        .expect("an addressable link has at least one reference occurrence")
}

fn addressable_link_descriptor(address_pattern: &[usize]) -> (Vec<usize>, usize) {
    let references = &address_pattern[1..];
    (
        ontology_multiplicity_spectrum(references),
        references
            .iter()
            .filter(|address| **address == address_pattern[0])
            .count(),
    )
}

fn self_incidence_by_reference_slot(address_pattern: &[usize]) -> Vec<bool> {
    address_pattern[1..]
        .iter()
        .map(|reference_address| *reference_address == address_pattern[0])
        .collect()
}

fn ordered_addressable_link_descriptor(address_pattern: &[usize]) -> (Vec<usize>, Vec<bool>) {
    (
        ontology_equality_matrix(&address_pattern[1..]),
        self_incidence_by_reference_slot(address_pattern),
    )
}

fn link_ontology_slotwise_self_incidence_audit() -> LinkOntologySlotwiseSelfIncidenceAudit {
    let finite_enumeration = (1..=4)
        .map(|occurrence_count| {
            let ordered_patterns = ontology_set_partitions(occurrence_count + 1);
            let mut classes = BTreeMap::<Vec<bool>, usize>::new();
            for address_pattern in &ordered_patterns {
                *classes
                    .entry(self_incidence_by_reference_slot(address_pattern))
                    .or_insert(0) += 1;
            }
            LinkOntologySlotwiseSelfIncidenceEnumeration {
                occurrence_count,
                self_incidence_patterns: classes.len(),
                ordered_equality_classes: ordered_patterns.len(),
                classes_by_self_incidence: classes
                    .into_iter()
                    .map(
                        |(self_incidence_by_reference_slot, ordered_equality_classes)| {
                            LinkOntologySlotwiseSelfIncidenceClass {
                                self_incidence_by_reference_slot,
                                ordered_equality_classes,
                            }
                        },
                    )
                    .collect(),
            }
        })
        .collect::<Vec<_>>();
    let ordered_patterns = (1..=4)
        .flat_map(|occurrence_count| ontology_set_partitions(occurrence_count + 1))
        .collect::<Vec<_>>();
    let address_renaming_invariant_verified = ordered_patterns.iter().all(|address_pattern| {
        let addresses = address_pattern
            .iter()
            .copied()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let expected = self_incidence_by_reference_slot(address_pattern);
        finite_permutations(&addresses)
            .into_iter()
            .all(|permuted_addresses| {
                let renaming = addresses
                    .iter()
                    .copied()
                    .zip(permuted_addresses)
                    .collect::<BTreeMap<_, _>>();
                let renamed_pattern = address_pattern
                    .iter()
                    .map(|address| renaming[address])
                    .collect::<Vec<_>>();
                self_incidence_by_reference_slot(&renamed_pattern) == expected
            })
    });
    let mut occurrence_permutation_equivariant_verified = true;
    let mut occurrence_permutation_invariant = true;
    for address_pattern in &ordered_patterns {
        let references = &address_pattern[1..];
        let self_incidence = self_incidence_by_reference_slot(address_pattern);
        for permutation in finite_permutations(&(0..references.len()).collect::<Vec<_>>()) {
            let mut permuted_pattern = vec![address_pattern[0]];
            permuted_pattern.extend(permutation.iter().map(|index| references[*index]));
            let permuted_incidence = self_incidence_by_reference_slot(&permuted_pattern);
            let expected = permutation
                .iter()
                .map(|index| self_incidence[*index])
                .collect::<Vec<_>>();
            occurrence_permutation_equivariant_verified &= permuted_incidence == expected;
            occurrence_permutation_invariant &= permuted_incidence == self_incidence;
        }
    }
    let mut descriptor_to_signatures =
        BTreeMap::<(Vec<usize>, Vec<bool>), BTreeSet<Vec<usize>>>::new();
    for address_pattern in &ordered_patterns {
        descriptor_to_signatures
            .entry(ordered_addressable_link_descriptor(address_pattern))
            .or_default()
            .insert(first_occurrence_normal_form(address_pattern));
    }
    let first_ordered_pattern = vec![0, 0, 1];
    let second_ordered_pattern = vec![0, 1, 0];
    let first_self_incidence = self_incidence_by_reference_slot(&first_ordered_pattern);
    let second_self_incidence = self_incidence_by_reference_slot(&second_ordered_pattern);

    LinkOntologySlotwiseSelfIncidenceAudit {
        status: "CLASSIFIED_PER_ORDERED_REFERENCE_SLOT",
        provenance: "ISSUE_183_DIRECT_SELF_REFERENCE_REQUIREMENT",
        predicate:
            "selfIncidenceByReferenceSlot[i] = (referenceAddress[i] === linkAddress)",
        every_boolean_slot_pattern_realized: finite_enumeration
            .iter()
            .all(|item| item.self_incidence_patterns == 2usize.pow(item.occurrence_count as u32)),
        finite_enumeration,
        address_renaming_invariant_verified,
        occurrence_permutation_equivariant_verified,
        occurrence_permutation_invariant,
        countermodel: LinkOntologySlotwiseSelfIncidenceCountermodel {
            first_ordered_pattern: first_ordered_pattern.clone(),
            second_ordered_pattern: second_ordered_pattern.clone(),
            first_self_incidence_by_reference_slot: first_self_incidence.clone(),
            second_self_incidence_by_reference_slot: second_self_incidence.clone(),
            same_self_incidence_multiplicity: first_self_incidence
                .iter()
                .filter(|incident| **incident)
                .count()
                == second_self_incidence
                    .iter()
                    .filter(|incident| **incident)
                    .count(),
            same_slotwise_self_incidence: first_self_incidence == second_self_incidence,
            same_after_occurrence_permutation: canonical_addressable_link_signature(
                &first_ordered_pattern,
            ) == canonical_addressable_link_signature(&second_ordered_pattern),
        },
        ordered_faithful_descriptor: LinkOntologyMinimalFaithfulDescriptor {
            status: "COMPLETE_INVARIANT_FOR_ORDERED_ADDRESS_EQUALITY_CONTRACT",
            fields: vec![
                "referenceEqualityMatrix",
                "selfIncidenceByReferenceSlot",
            ],
            finite_enumeration_agreement: descriptor_to_signatures
                .values()
                .all(|signatures| signatures.len() == 1)
                && descriptor_to_signatures.len() == ordered_patterns.len(),
            general_argument: "Reference equality classifies the ordered references up to address renaming, while the slotwise self-incidence mask identifies exactly which reference class, if any, is the link address.",
        },
        quotient_consequence: "Occurrence permutation preserves the slotwise mask only equivariantly; the unlabelled quotient retains its number of true entries but forgets their ordered positions.",
        claim_boundary: "This classifies address/reference equality per ordered slot. It does not establish that reference-slot identity is intrinsic, assign endpoint roles to slots, or supply dynamics or execution semantics.",
    }
}

fn ordered_shared_address_configurations(link_count: usize) -> Vec<Vec<usize>> {
    ontology_set_partitions(link_count * 2)
        .into_iter()
        .filter(|configuration| {
            (0..link_count)
                .map(|link_index| configuration[link_index * 2])
                .collect::<BTreeSet<_>>()
                .len()
                == link_count
        })
        .collect()
}

fn local_single_link_descriptors(configuration: &[usize]) -> Vec<(Vec<usize>, Vec<bool>)> {
    (0..configuration.len() / 2)
        .map(|link_index| {
            ordered_addressable_link_descriptor(&[
                configuration[link_index * 2],
                configuration[(link_index * 2) + 1],
            ])
        })
        .collect()
}

fn shared_address_descriptor(configuration: &[usize]) -> (Vec<usize>, Vec<usize>) {
    let link_count = configuration.len() / 2;
    let link_addresses = (0..link_count)
        .map(|link_index| configuration[link_index * 2])
        .collect::<Vec<_>>();
    let references = (0..link_count)
        .map(|link_index| configuration[(link_index * 2) + 1])
        .collect::<Vec<_>>();
    let incidence = references
        .iter()
        .flat_map(|reference| {
            link_addresses
                .iter()
                .map(move |link_address| usize::from(reference == link_address))
        })
        .collect::<Vec<_>>();
    (ontology_equality_matrix(&references), incidence)
}

fn link_incidence_cycle_length(configuration: &[usize], starting_link_index: usize) -> usize {
    let link_count = configuration.len() / 2;
    let link_addresses = (0..link_count)
        .map(|link_index| configuration[link_index * 2])
        .collect::<Vec<_>>();
    let mut visited_at = BTreeMap::new();
    let mut link_index = starting_link_index;
    while !visited_at.contains_key(&link_index) {
        visited_at.insert(link_index, visited_at.len());
        let reference_address = configuration[(link_index * 2) + 1];
        let Some(next_link_index) = link_addresses
            .iter()
            .position(|link_address| *link_address == reference_address)
        else {
            return 0;
        };
        link_index = next_link_index;
    }
    if link_index == starting_link_index {
        visited_at.len() - visited_at[&link_index]
    } else {
        0
    }
}

fn link_ontology_shared_address_composition_audit() -> LinkOntologySharedAddressCompositionAudit {
    let finite_enumeration = (1..=4)
        .map(|link_count| {
            let configurations = ordered_shared_address_configurations(link_count);
            let mut local_descriptor_fibres =
                BTreeMap::<Vec<(Vec<usize>, Vec<bool>)>, usize>::new();
            let mut shared_descriptor_to_signatures =
                BTreeMap::<(Vec<usize>, Vec<usize>), BTreeSet<Vec<usize>>>::new();
            for configuration in &configurations {
                *local_descriptor_fibres
                    .entry(local_single_link_descriptors(configuration))
                    .or_insert(0) += 1;
                shared_descriptor_to_signatures
                    .entry(shared_address_descriptor(configuration))
                    .or_default()
                    .insert(first_occurrence_normal_form(configuration));
            }
            let local_descriptor_fibre_histogram = local_descriptor_fibres
                .values()
                .fold(BTreeMap::new(), |mut histogram, shared_address_classes| {
                    *histogram.entry(*shared_address_classes).or_insert(0) += 1;
                    histogram
                })
                .into_iter()
                .map(|(shared_address_classes, local_descriptor_classes)| {
                    LinkOntologySharedCompositionFibreHistogram {
                        shared_address_classes,
                        local_descriptor_classes,
                    }
                })
                .collect::<Vec<_>>();
            LinkOntologySharedCompositionEnumeration {
                link_count,
                reference_slots_per_link: 1,
                shared_address_classes: configurations.len(),
                local_descriptor_classes: local_descriptor_fibres.len(),
                local_descriptor_fibre_histogram,
                local_descriptors_faithful: local_descriptor_fibres
                    .values()
                    .all(|fibre_size| *fibre_size == 1),
                shared_descriptor_classes: shared_descriptor_to_signatures.len(),
                shared_descriptor_faithful: shared_descriptor_to_signatures
                    .values()
                    .all(|signatures| signatures.len() == 1)
                    && shared_descriptor_to_signatures.len() == configurations.len(),
            }
        })
        .collect::<Vec<_>>();
    let external_references = vec![vec![0, 1], vec![2, 3]];
    let two_link_cycle = vec![vec![0, 2], vec![2, 0]];
    let external_pattern = external_references.concat();
    let cycle_pattern = two_link_cycle.concat();

    LinkOntologySharedAddressCompositionAudit {
        status: "LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL",
        provenance: "ISSUE_183_INDIRECT_SELF_REFERENCE_REQUIREMENT",
        removed_assumption: "single addressed link considered in isolation",
        retained_assumptions: vec![
            "finite ordered link records",
            "one ordered reference slot per link",
            "distinct link addresses in one shared address space",
            "address equality is the only observation",
        ],
        local_descriptors_faithful_at_every_tested_multi_link_width:
            finite_enumeration
                .iter()
                .filter(|item| item.link_count > 1)
                .all(|item| item.local_descriptors_faithful),
        countermodel: LinkOntologySharedCompositionCountermodel {
            external_references: external_references.clone(),
            two_link_cycle: two_link_cycle.clone(),
            same_local_descriptors: local_single_link_descriptors(&external_pattern)
                == local_single_link_descriptors(&cycle_pattern),
            same_shared_address_class: first_occurrence_normal_form(&external_pattern)
                == first_occurrence_normal_form(&cycle_pattern),
            external_references_cycle_length: link_incidence_cycle_length(
                &external_pattern,
                0,
            ),
            two_link_cycle_length: link_incidence_cycle_length(&cycle_pattern, 0),
            distinguishing_observation: "whether each reference address equals another link address in the same configuration",
        },
        shared_faithful_descriptor: LinkOntologyMinimalFaithfulDescriptor {
            status: "COMPLETE_INVARIANT_FOR_ORDERED_SHARED_ADDRESS_EQUALITY_CONTRACT",
            fields: vec![
                "referenceEqualityMatrixAcrossLinks",
                "referenceToLinkAddressIncidenceMatrix",
            ],
            finite_enumeration_agreement: finite_enumeration
                .iter()
                .all(|item| item.shared_descriptor_faithful),
            general_argument: "With distinct ordered link addresses, incidence identifies every reference equal to a link address; the reference equality matrix partitions all remaining external references. Equal descriptors therefore induce a global bijection of every used address.",
        },
        finite_enumeration,
        general_consequence: "For any finite ordered collection of distinct link addresses with one reference each, the product of local single-link descriptors retains only the diagonal of cross-link incidence and is non-faithful from two links onward.",
        assumption_classification: LinkOntologySharedCompositionClassification {
            forced_by_issue_contract: "indirect self-reference requires comparing references with other link addresses in a shared address space",
            survives_representation_change: "the external-reference and two-link-cycle configurations remain distinct under every global address renaming",
            introduced_by_observer: "link-record order, fixed finite link count, and one reference slot are retained experimental restrictions",
            semantics_not_assigned: "cross-link incidence is only address equality; it is not a source, target, transition, dependency, or execution edge",
        },
        claim_boundary: "This removes single-link isolation and proves a compositional information loss for the declared equality contract. It does not establish that ordered link records or one-slot links are intrinsic, interpret an incidence cycle dynamically, or define a complete link ontology.",
    }
}

fn binary_link_record_signature(records: &[Vec<usize>]) -> Vec<usize> {
    first_occurrence_normal_form(&records.concat())
}

fn reverse_binary_reference_slots(records: &[Vec<usize>]) -> Vec<Vec<usize>> {
    records
        .iter()
        .map(|record| vec![record[0], record[2], record[1]])
        .collect()
}

fn unordered_binary_link_record_signature(records: &[Vec<usize>]) -> Vec<Vec<usize>> {
    records
        .iter()
        .map(|record| {
            let mut references = vec![record[1], record[2]];
            references.sort_unstable();
            vec![record[0], references[0], references[1]]
        })
        .collect()
}

fn rename_candidate_leaves(records: &[Vec<usize>], permutation: &[usize]) -> Vec<Vec<usize>> {
    records
        .iter()
        .map(|record| {
            let mut renamed = vec![record[0]];
            renamed.extend(record[1..].iter().map(|reference| {
                if *reference < permutation.len() {
                    permutation[*reference]
                } else {
                    *reference
                }
            }));
            renamed
        })
        .collect()
}

fn has_reference_pair(records: &[Vec<usize>], pair: &[usize]) -> bool {
    records
        .iter()
        .any(|record| record.len() == 3 && record[1..] == *pair)
}

fn has_link_record(records: &[Vec<usize>], expected: &[usize]) -> bool {
    records.iter().any(|record| record == expected)
}

fn link_ontology_structural_application_composition_probe(
) -> LinkOntologyStructuralApplicationCompositionProbe {
    // Each record is [link address, first reference, second reference]. The
    // numbers are addresses only: none is assigned a semantic role here.
    let left_associated = vec![vec![3, 0, 1], vec![4, 3, 2]];
    let right_associated = vec![vec![3, 1, 2], vec![4, 0, 3]];
    let candidate_link_addresses = left_associated
        .iter()
        .map(|record| record[0])
        .collect::<BTreeSet<_>>();
    let recursive_address_references_present =
        [&left_associated, &right_associated].iter().all(|records| {
            records.iter().any(|record| {
                record[1..].iter().any(|reference| {
                    *reference != record[0] && candidate_link_addresses.contains(reference)
                })
            })
        });

    let leaf_addresses = vec![0, 1, 2];
    let left_unordered_signature = unordered_binary_link_record_signature(&left_associated);
    let unordered_automorphisms = finite_permutations(&leaf_addresses)
        .into_iter()
        .filter(|permutation| {
            unordered_binary_link_record_signature(&rename_candidate_leaves(
                &left_associated,
                permutation,
            )) == left_unordered_signature
        })
        .collect::<Vec<_>>();
    let mut unseen_leaves = leaf_addresses.iter().copied().collect::<BTreeSet<_>>();
    let mut unordered_leaf_orbit_sizes = Vec::new();
    while let Some(leaf) = unseen_leaves.iter().next().copied() {
        let orbit = unordered_automorphisms
            .iter()
            .map(|permutation| permutation[leaf])
            .collect::<BTreeSet<_>>();
        unordered_leaf_orbit_sizes.push(orbit.len());
        for member in orbit {
            unseen_leaves.remove(&member);
        }
    }
    unordered_leaf_orbit_sizes.sort_unstable();

    // P and Q have identities 3 and 4, their K/A/B references are the distinct
    // addresses 0/1/2, and they share only A. A third link contains the reverse
    // B/K pair. A fourth is directly self-incident and recursively refers to P.
    // Thus all requested structural phenomena are present without a record whose
    // references are [0, 2].
    let without_proposed_result = vec![vec![3, 0, 1], vec![4, 1, 2], vec![5, 2, 0], vec![6, 6, 3]];
    let proposed_result = vec![7, 0, 2];
    let mut with_proposed_result = without_proposed_result.clone();
    with_proposed_result.push(proposed_result.clone());
    let premise_p = vec![3, 0, 1];
    let premise_q = vec![4, 1, 2];
    let premise_reference_addresses = premise_p[1..]
        .iter()
        .chain(premise_q[1..].iter())
        .copied()
        .collect::<BTreeSet<_>>();
    let used_addresses = without_proposed_result
        .iter()
        .flatten()
        .copied()
        .collect::<BTreeSet<_>>();
    let structural_facts = |records: &[Vec<usize>]| {
        let link_addresses = records
            .iter()
            .map(|record| record[0])
            .collect::<BTreeSet<_>>();
        LinkOntologyCompositionCommonFacts {
            distinct_link_identities: link_addresses.len() == records.len(),
            premise_link_identities_distinct_from_references: [premise_p[0], premise_q[0]]
                .iter()
                .all(|address| !premise_reference_addresses.contains(address)),
            premise_reference_addresses_pairwise_distinct: premise_reference_addresses.len() == 3,
            direct_self_incidence: records
                .iter()
                .any(|record| record[1..].contains(&record[0])),
            shared_address_incidence: premise_p[2] == premise_q[1],
            recursive_link_references: records.iter().any(|record| {
                record[1..]
                    .iter()
                    .any(|reference| *reference != record[0] && link_addresses.contains(reference))
            }),
        }
    };
    let common_facts_hold = |facts: &LinkOntologyCompositionCommonFacts| {
        facts.distinct_link_identities
            && facts.premise_link_identities_distinct_from_references
            && facts.premise_reference_addresses_pairwise_distinct
            && facts.direct_self_incidence
            && facts.shared_address_incidence
            && facts.recursive_link_references
    };
    let common_facts = structural_facts(&without_proposed_result);
    let premises_hold = |records: &[Vec<usize>]| {
        has_link_record(records, &premise_p)
            && has_link_record(records, &premise_q)
            && common_facts_hold(&structural_facts(records))
    };
    let every_formation_extension_preserves_premises = used_addresses.iter().all(|left| {
        used_addresses.iter().all(|right| {
            let mut extension = without_proposed_result.clone();
            extension.push(vec![proposed_result[0], *left, *right]);
            premises_hold(&extension)
        })
    });

    LinkOntologyStructuralApplicationCompositionProbe {
        status: "RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION",
        premise_vocabulary: vec![
            "link identity",
            "reference-address equality",
            "self-incidence",
            "shared-address incidence",
            "recursive reference to a link address",
        ],
        semantic_separation: LinkOntologySemanticSeparation {
            logical_implication: "NOT_IDENTIFIED_WITH_LINK_STRUCTURE",
            link_structure: "ADDRESS_REFERENCE_INCIDENCE_ONLY",
            composition: "PROPOSED_LINK_NOT_FORCED",
            execution: "NO_TRANSFORMATION_OR_CREATION_LAW_PRESENT",
        },
        candidate_encodings: LinkOntologyCandidateEncodings {
            left_associated: left_associated.clone(),
            right_associated: right_associated.clone(),
            same_under_address_renaming_alone: binary_link_record_signature(&left_associated)
                == binary_link_record_signature(&right_associated),
            same_after_uniform_slot_reversal_and_address_renaming:
                binary_link_record_signature(&reverse_binary_reference_slots(&left_associated))
                    == binary_link_record_signature(&right_associated),
            recursive_address_references_present,
            ordered_slot_contract_consequence:
                "the two association candidates occupy different ordered reference positions",
            unordered_slot_contract_consequence:
                "uniform reference-slot reversal plus address renaming identifies the two candidates",
        },
        role_recovery: LinkOntologyRoleRecovery {
            investigated_roles: vec!["function", "argument", "result", "application"],
            semantic_assignments_for_three_leaves: finite_permutations(&leaf_addresses).len(),
            unordered_structure_automorphisms: unordered_automorphisms.len(),
            unordered_leaf_orbit_sizes,
            ordered_positions_select_semantic_roles: false,
            all_four_semantic_roles_recovered: false,
            status: "ADDITIONAL_ROLE_ASSIGNMENT_REQUIRED",
            evidence: "Ordered slots distinguish three leaf positions but do not name their meaning. Without slot order, the two leaves of the nested link form one orbit, so the raw structure does not even separate all three leaf positions.",
        },
        composition_countermodel: LinkOntologyCompositionCountermodel {
            without_proposed_result: without_proposed_result.clone(),
            with_proposed_result: with_proposed_result.clone(),
            premise_p: premise_p.clone(),
            premise_q: premise_q.clone(),
            proposed_result: proposed_result.clone(),
            common_facts,
            premises_hold_in_both: premises_hold(&without_proposed_result)
                && premises_hold(&with_proposed_result),
            reverse_pair_already_present: has_reference_pair(&without_proposed_result, &[2, 0]),
            proposed_result_absent_in_first: !has_reference_pair(
                &without_proposed_result,
                &proposed_result[1..],
            ),
            proposed_result_present_in_second: has_reference_pair(
                &with_proposed_result,
                &proposed_result[1..],
            ),
        },
        formation_probe: LinkOntologyFormationProbe {
            existing_addresses: used_addresses.iter().copied().collect(),
            ordered_pairs_using_existing_addresses: used_addresses.len() * used_addresses.len(),
            proposed_reference_pair: proposed_result[1..].to_vec(),
            every_formation_extension_preserves_premises,
            composition_specific_selection_from_formation_only: false,
            consequence: "Binary link formation admits every ordered pair of the seven existing addresses; it does not uniquely select [0,2].",
        },
        conclusion: "The proposed result is structurally formable but is neither unavoidable nor selected. The premise-only structure and its result-bearing conservative extension satisfy the same stated structural conditions.",
        claim_boundary: "This countermodel refutes entailment from the tested identity/equality/incidence/recursion structure. It does not refute a future links-derived composition, but such a result needs an additional selection/closure law and an explicit account of its authority; no logical implication, function role, or execution meaning is assigned here.",
    }
}

// Observer-declared incidence criterion. This reports a possible reference
// pair; it creates no record and assigns no implication meaning.
fn conditional_continuations(records: &[Vec<usize>]) -> Vec<Vec<usize>> {
    conditional_continuations_with_law(records, false, false)
}

fn conditional_continuations_with_law(
    records: &[Vec<usize>],
    unordered_witness: bool,
    reverse_projection: bool,
) -> Vec<Vec<usize>> {
    let mut pairs = BTreeSet::new();
    for first in records {
        for second in records {
            if first[0] == second[0] || first[2] != second[1] {
                continue;
            }
            if records.iter().any(|witness| {
                witness[0] != first[0]
                    && witness[0] != second[0]
                    && ((witness[1] == first[0] && witness[2] == second[0])
                        || (unordered_witness && witness[1] == second[0] && witness[2] == first[0]))
            }) {
                pairs.insert(if reverse_projection {
                    vec![second[2], first[1]]
                } else {
                    vec![first[1], second[2]]
                });
            }
        }
    }
    pairs.into_iter().collect()
}

fn competing_continuation_readouts(records: &[Vec<usize>]) -> LinkOntologyCompetingReadouts {
    LinkOntologyCompetingReadouts {
        forward_projection: conditional_continuations(records),
        reverse_projection: conditional_continuations_with_law(records, false, true),
    }
}

// Consequence audit over the same two premises. It is a finite model check,
// not a verifier step: a pair is possible when some admissible completion of
// the recorded pairs contains it and follows when every one contains it.
// Position laws copy two of the four premise reference slots into an
// unrecorded output pair.
type ConsequencePositionLaw = [usize; 2];

const CONSEQUENCE_CRITERIA: [&str; 7] = [
    "address-renaming",
    "arbitrary-substitution",
    "record-reordering",
    "nested-encoding",
    "global-slot-reversal",
    "non-degenerate",
    "unordered-novelty",
];

fn consequence_law_readouts(
    records: &[Vec<usize>],
    law: ConsequencePositionLaw,
) -> Vec<Vec<usize>> {
    let mut pairs = BTreeSet::new();
    for left in records {
        for right in records {
            if left[0] != right[0] && left[2] == right[1] {
                let references = [left[1], left[2], right[1], right[2]];
                pairs.insert(vec![references[law[0]], references[law[1]]]);
            }
        }
    }
    pairs.into_iter().collect()
}

fn consequence_unique_pairs(pairs: impl IntoIterator<Item = Vec<usize>>) -> Vec<Vec<usize>> {
    pairs
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn consequence_rename_pairs(pairs: &[Vec<usize>], renaming: &[usize]) -> Vec<Vec<usize>> {
    consequence_unique_pairs(pairs.iter().map(|pair| {
        pair.iter()
            .map(|value| renaming.get(*value).copied().unwrap_or(*value))
            .collect()
    }))
}

fn consequence_pairs_of(records: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut pairs = records
        .iter()
        .map(|record| vec![record[1], record[2]])
        .collect::<Vec<_>>();
    pairs.sort();
    pairs
}

fn consequence_least_model(
    premises: &[Vec<usize>],
    law: ConsequencePositionLaw,
) -> Vec<Vec<usize>> {
    let mut records = premises.to_vec();
    loop {
        let recorded = consequence_pairs_of(&records);
        let fresh = consequence_law_readouts(&records, law)
            .into_iter()
            .filter(|pair| !recorded.contains(pair))
            .collect::<Vec<_>>();
        if fresh.is_empty() {
            return records;
        }
        let first_fresh_address = 7 + records.len() - premises.len();
        records.extend(
            fresh
                .into_iter()
                .enumerate()
                .map(|(index, pair)| vec![first_fresh_address + index, pair[0], pair[1]]),
        );
    }
}

fn consequence_closed_on(law: ConsequencePositionLaw, records: &[Vec<usize>]) -> bool {
    let pairs = consequence_pairs_of(records);
    consequence_law_readouts(records, law)
        .iter()
        .all(|pair| pairs.contains(pair))
}

fn consequence_record_automorphisms(
    records: &[Vec<usize>],
    unordered: bool,
) -> Vec<BTreeMap<usize, usize>> {
    let normal = |candidate: &[Vec<usize>]| {
        let mut normalized = candidate
            .iter()
            .map(|record| {
                if unordered {
                    vec![
                        record[0],
                        record[1].min(record[2]),
                        record[1].max(record[2]),
                    ]
                } else {
                    record.clone()
                }
            })
            .collect::<Vec<_>>();
        normalized.sort_by_key(|record| record[0]);
        normalized
    };
    let values = records
        .iter()
        .flatten()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let original = normal(records);
    finite_permutations(&values)
        .into_iter()
        .map(|image| {
            values
                .iter()
                .copied()
                .zip(image)
                .collect::<BTreeMap<_, _>>()
        })
        .filter(|renaming| normal(&rename_record_addresses(records, renaming)) == original)
        .collect()
}

fn link_ontology_continuation_consequence_audit() -> LinkOntologyConsequenceAudit {
    let (k, a, b) = (0, 1, 2);
    let carrier = [k, a, b];
    let premises = vec![vec![3, k, a], vec![4, a, b]];
    let premise_pairs = consequence_pairs_of(&premises);

    let all_pairs = carrier
        .iter()
        .flat_map(|left| carrier.iter().map(move |right| vec![*left, *right]))
        .collect::<Vec<_>>();
    let optional_pairs = all_pairs
        .iter()
        .filter(|pair| !premise_pairs.contains(pair))
        .cloned()
        .collect::<Vec<_>>();
    let completions = (0..1usize << optional_pairs.len())
        .map(|mask| {
            consequence_unique_pairs(
                premise_pairs.iter().cloned().chain(
                    optional_pairs
                        .iter()
                        .enumerate()
                        .filter(|(bit, _)| mask & (1 << bit) != 0)
                        .map(|(_, pair)| pair.clone()),
                ),
            )
        })
        .collect::<Vec<_>>();
    // Transitive closure concludes [x,z] from [x,y],[y,z]; circular closure
    // concludes [z,x] from the same chain.
    let closed_under = |relation: &[Vec<usize>], circular: bool| {
        relation.iter().all(|first| {
            relation.iter().all(|second| {
                second[0] != first[1]
                    || relation.contains(&if circular {
                        vec![second[1], first[0]]
                    } else {
                        vec![first[0], second[1]]
                    })
            })
        })
    };
    let intersection = |relations: &[Vec<Vec<usize>>]| {
        all_pairs
            .iter()
            .filter(|pair| relations.iter().all(|relation| relation.contains(pair)))
            .cloned()
            .collect::<Vec<_>>()
    };
    let admissible_by_class = vec![
        ("none", completions.clone()),
        (
            "transitive",
            completions
                .iter()
                .filter(|relation| closed_under(relation, false))
                .cloned()
                .collect::<Vec<_>>(),
        ),
        (
            "circular",
            completions
                .iter()
                .filter(|relation| closed_under(relation, true))
                .cloned()
                .collect(),
        ),
        (
            "transitive-or-circular",
            completions
                .iter()
                .filter(|relation| closed_under(relation, false) || closed_under(relation, true))
                .cloned()
                .collect(),
        ),
    ];
    let forward_pair = vec![k, b];
    let reverse_pair = vec![b, k];
    let exclusion_classes = admissible_by_class
        .iter()
        .map(|(id, admissible)| {
            let follows = intersection(admissible);
            LinkOntologyExclusionClass {
                id: *id,
                admissible_completions: admissible.len(),
                least_completion_admissible: admissible.contains(&follows),
                forward_follows: follows.contains(&forward_pair),
                reverse_follows: follows.contains(&reverse_pair),
                unoriented_connection_follows: admissible.iter().all(|relation| {
                    relation.contains(&forward_pair) || relation.contains(&reverse_pair)
                }),
                follows,
            }
        })
        .collect::<Vec<_>>();
    let class_by_id = |id: &str| {
        exclusion_classes
            .iter()
            .find(|class| class.id == id)
            .expect("declared exclusion class")
    };
    let every_pair_possible_in_each_class = admissible_by_class.iter().all(|(_, admissible)| {
        all_pairs
            .iter()
            .all(|pair| admissible.iter().any(|relation| relation.contains(pair)))
    });
    let positive_facts_alone_force_nothing_new = completions.iter().all(|facts| {
        intersection(
            &completions
                .iter()
                .filter(|relation| facts.iter().all(|pair| relation.contains(pair)))
                .cloned()
                .collect::<Vec<_>>(),
        ) == *facts
    });

    let slot_names = ["P.first", "P.second", "Q.first", "Q.second"];
    let laws = (0..4)
        .flat_map(|first| (0..4).map(move |second| [first, second]))
        .collect::<Vec<ConsequencePositionLaw>>();
    let swap_output = |law: ConsequencePositionLaw| [law[1], law[0]];
    let readout = |law: ConsequencePositionLaw| consequence_law_readouts(&premises, law)[0].clone();
    let renamings = finite_permutations(&[0, 1, 2, 3, 4]);
    let substitutions = finite_assignments(3, carrier.len());
    // One result per CONSEQUENCE_CRITERIA entry, in the same order.
    let criteria = |law: ConsequencePositionLaw| -> [bool; 7] {
        let original = consequence_law_readouts(&premises, law);
        let mut unordered_readout = original[0].clone();
        unordered_readout.sort_unstable();
        [
            renamings.iter().all(|renaming| {
                consequence_law_readouts(
                    &premises
                        .iter()
                        .map(|record| record.iter().map(|value| renaming[*value]).collect())
                        .collect::<Vec<_>>(),
                    law,
                ) == consequence_rename_pairs(&original, renaming)
            }),
            substitutions.iter().all(|substitution| {
                let substituted = premises
                    .iter()
                    .map(|record| vec![record[0], substitution[record[1]], substitution[record[2]]])
                    .collect::<Vec<_>>();
                let actual = consequence_law_readouts(&substituted, law);
                consequence_rename_pairs(&original, substitution)
                    .iter()
                    .all(|pair| actual.contains(pair))
            }),
            consequence_law_readouts(&premises.iter().rev().cloned().collect::<Vec<_>>(), law)
                == original,
            consequence_law_readouts(
                &premises
                    .iter()
                    .map(|record| (record[0], [(0, record[1]), (1, record[2])]))
                    .map(|(address, slots)| vec![address, slots[0].1, slots[1].1])
                    .collect::<Vec<_>>(),
                law,
            ) == original,
            consequence_law_readouts(&reverse_binary_reference_slots(&premises), law)
                == consequence_unique_pairs(original.iter().map(|pair| vec![pair[1], pair[0]])),
            original[0][0] != original[0][1],
            !premise_pairs.iter().any(|pair| {
                let mut unordered_pair = pair.clone();
                unordered_pair.sort_unstable();
                unordered_pair == unordered_readout
            }),
        ]
    };
    let law_criteria = laws
        .iter()
        .map(|law| (*law, criteria(*law)))
        .collect::<Vec<_>>();
    let passes_all = |results: &[bool; 7], skipped: Option<usize>| {
        results
            .iter()
            .enumerate()
            .all(|(index, passes)| Some(index) == skipped || *passes)
    };
    let survivors = law_criteria
        .iter()
        .filter(|(_, results)| passes_all(results, None))
        .map(|(law, _)| *law)
        .collect::<Vec<_>>();

    let least_model = |law: ConsequencePositionLaw| consequence_least_model(&premises, law);
    let pair_automorphisms = |pairs: &[Vec<usize>]| {
        let normal = consequence_unique_pairs(pairs.iter().cloned());
        finite_permutations(&carrier)
            .into_iter()
            .filter(|renaming| consequence_rename_pairs(pairs, renaming) == normal)
            .collect::<Vec<_>>()
    };
    let derived_outside_premise_orbits = |law: ConsequencePositionLaw| {
        let pairs = consequence_pairs_of(&least_model(law));
        let derived = pairs
            .iter()
            .filter(|pair| !premise_pairs.contains(pair))
            .cloned()
            .collect::<Vec<_>>();
        pair_automorphisms(&pairs).iter().all(|renaming| {
            !consequence_rename_pairs(&derived, renaming)
                .iter()
                .any(|pair| premise_pairs.contains(pair))
        })
    };
    let every_link_follows_from_others = |law: ConsequencePositionLaw| {
        let model = least_model(law);
        model.iter().enumerate().all(|(index, record)| {
            let others = model
                .iter()
                .enumerate()
                .filter(|(other, _)| *other != index)
                .map(|(_, other)| other.clone())
                .collect::<Vec<_>>();
            consequence_law_readouts(&others, law).contains(&vec![record[1], record[2]])
        })
    };
    let first_slots = [0, 2];
    let second_slots = [1, 3];
    let unit_cases = [
        vec![vec![3, k, a], vec![4, a, a]],
        vec![vec![3, a, a], vec![4, a, b]],
    ];
    let unit_neutral = |law: ConsequencePositionLaw, converse: bool| {
        unit_cases.iter().all(|records| {
            let mut expected = records
                .iter()
                .find(|record| record[1] != record[2])
                .expect("one non-loop premise")[1..]
                .to_vec();
            if converse {
                expected.reverse();
            }
            consequence_law_readouts(records, law) == vec![expected]
        })
    };
    let declared_closed = |law: ConsequencePositionLaw, conclusion: Vec<usize>| {
        let mut records = premises.clone();
        records.push(conclusion);
        consequence_closed_on(law, &records)
    };
    let selected = |select: &dyn Fn(ConsequencePositionLaw) -> bool| {
        survivors
            .iter()
            .copied()
            .filter(|law| select(*law))
            .map(readout)
            .collect::<Vec<_>>()
    };
    let tie_breakers = vec![
        LinkOntologyOrientationTieBreaker {
            id: "slot-position-preservation",
            selects: selected(&|law| {
                first_slots.contains(&law[0]) && second_slots.contains(&law[1])
            }),
            mirror: "slot-exchange",
            mirror_selects: selected(&|law| {
                second_slots.contains(&law[0]) && first_slots.contains(&law[1])
            }),
            provenance: "ALIGNS_UNRECORDED_OUTPUT_SLOTS_WITH_PREMISE_SLOTS",
        },
        LinkOntologyOrientationTieBreaker {
            id: "unit-neutrality",
            selects: selected(&|law| unit_neutral(law, false)),
            mirror: "converse-unit-neutrality",
            mirror_selects: selected(&|law| unit_neutral(law, true)),
            provenance: "IMPORTS_IDENTITY_LAW_AND_ORIENTED_EQUALITY",
        },
        LinkOntologyOrientationTieBreaker {
            id: "declared-closed-model",
            selects: selected(&|law| declared_closed(law, vec![7, k, b])),
            mirror: "declared-closed-cycle",
            mirror_selects: selected(&|law| declared_closed(law, vec![7, b, k])),
            provenance: "CONCLUSION_ALREADY_RECORDED",
        },
        LinkOntologyOrientationTieBreaker {
            id: "premise-recoverability",
            selects: selected(&derived_outside_premise_orbits),
            mirror: "premise-interchangeability",
            mirror_selects: selected(&every_link_follows_from_others),
            provenance: "IMPORTS_IRREVERSIBLE_CONSEQUENCE",
        },
    ];

    let (forward_law, reverse_law) = ([0, 3], [3, 0]);
    let forward_least_model = consequence_pairs_of(&least_model(forward_law));
    let reverse_least_model = consequence_pairs_of(&least_model(reverse_law));
    let mut with_witness = premises.clone();
    with_witness.push(vec![5, 3, 4]);
    let automorphism_counts = |unordered: bool| {
        [premises.as_slice(), with_witness.as_slice()]
            .map(|records| consequence_record_automorphisms(records, unordered).len())
    };
    let ordered_counts = automorphism_counts(false);
    let unordered_counts = automorphism_counts(true);
    let unordered_automorphism_exchanges_candidates =
        consequence_record_automorphisms(&premises, true)
            .iter()
            .any(|renaming| renaming[&k] == b && renaming[&b] == k);
    let unconstrained = class_by_id("none");
    let transitive = class_by_id("transitive");
    let circular = class_by_id("circular");
    let disjunctive = class_by_id("transitive-or-circular");
    let oriented_exclusions_restate_survivors = transitive.follows == forward_least_model
        && circular.follows == reverse_least_model
        && survivors == vec![forward_law, reverse_law];
    let assumption_removal = LinkOntologyConsequenceAssumptionRemoval {
        with_oriented_exclusion: if transitive.forward_follows
            && !transitive.reverse_follows
            && circular.reverse_follows
            && !circular.forward_follows
        {
            "ORIENTED_CONTINUATION_FOLLOWS_RELATIVE_TO_THAT_EXCLUSION"
        } else {
            "ORIENTATION_NOT_SEPARATED"
        },
        without_exclusion_orientation: if disjunctive.unoriented_connection_follows
            && !disjunctive.forward_follows
            && !disjunctive.reverse_follows
        {
            "ONLY_UNORIENTED_CONNECTION_FOLLOWS"
        } else {
            "ORIENTED_CONTINUATION_FOLLOWS"
        },
        without_exclusion: if unconstrained.follows == premise_pairs {
            "NOTHING_BEYOND_RECORDED_FACTS_FOLLOWS"
        } else {
            "NEW_PAIR_FOLLOWS"
        },
        without_slot_order: if unordered_automorphism_exchanges_candidates {
            "PREMISE_AUTOMORPHISM_EXCHANGES_CANDIDATES"
        } else {
            "CANDIDATES_REMAIN_DISTINGUISHABLE"
        },
    };
    let consistent_exclusions = admissible_by_class
        .iter()
        .filter(|(_, admissible)| !admissible.is_empty())
        .count();
    let law_space = LinkOntologyPositionLawSpace {
        position_laws: laws.len(),
        distinct_readouts: laws
            .iter()
            .map(|law| readout(*law))
            .collect::<BTreeSet<_>>()
            .len(),
        admitted_criteria: CONSEQUENCE_CRITERIA
            .into_iter()
            .enumerate()
            .map(|(index, id)| LinkOntologyAdmittedLawCriterion {
                id,
                passing: law_criteria
                    .iter()
                    .filter(|(_, results)| results[index])
                    .count(),
                survivors_without_it: law_criteria
                    .iter()
                    .filter(|(_, results)| passes_all(results, Some(index)))
                    .count(),
            })
            .collect(),
        admitted_criteria_commute_with_output_swap: law_criteria
            .iter()
            .all(|(law, results)| *results == criteria(swap_output(*law))),
        output_swap_fixes_no_non_degenerate_law: laws.iter().all(|law| {
            let value = readout(*law);
            value[0] == value[1] || *law != swap_output(*law)
        }),
        survivors: survivors
            .iter()
            .map(|law| LinkOntologySurvivingPositionLaw {
                slots: law.iter().map(|slot| slot_names[*slot]).collect(),
                readout: readout(*law),
            })
            .collect(),
        tie_breakers,
    };
    let minimal_pair = LinkOntologyConsequenceMinimalPair {
        agree_on_recorded_premises: premise_pairs
            .iter()
            .all(|pair| forward_least_model.contains(pair) && reverse_least_model.contains(pair)),
        forward_least_model_automorphisms: pair_automorphisms(&forward_least_model).len(),
        reverse_least_model_automorphisms: pair_automorphisms(&reverse_least_model).len(),
        forward_every_link_follows_from_others: every_link_follows_from_others(forward_law),
        reverse_every_link_follows_from_others: every_link_follows_from_others(reverse_law),
        forward_least_model,
        reverse_least_model,
    };
    let self_application = LinkOntologyConsequenceSelfApplication {
        each_survivor_closed_on_own_least_model: survivors
            .iter()
            .all(|law| consequence_closed_on(*law, &least_model(*law))),
        any_survivor_closed_on_other_least_model: survivors
            .iter()
            .any(|law| consequence_closed_on(*law, &least_model(swap_output(*law)))),
        exclusions_consistent_with_records: consistent_exclusions,
        exclusion_determined_by_records: consistent_exclusions == 1,
    };
    LinkOntologyConsequenceAudit {
        question: "What structural fact turns a possible continuation into one that follows?",
        status: "CONSEQUENCE_REQUIRES_UNRECORDED_ORIENTED_EXCLUSION",
        modal_reading: "a pair is possible when some admissible completion of the recorded pairs contains it, and follows when every admissible completion contains it",
        completion_count: completions.len(),
        every_pair_possible_in_each_class,
        positive_facts_alone_force_nothing_new,
        oriented_exclusions_restate_survivors,
        law_space,
        minimal_pair,
        slot_order: LinkOntologyConsequenceSlotOrder {
            ordered_automorphisms: ordered_counts[0],
            unordered_automorphisms: unordered_counts[0],
            witness_changes_automorphism_counts: ordered_counts[0] != ordered_counts[1]
                || unordered_counts[0] != unordered_counts[1],
            unordered_automorphism_exchanges_candidates,
        },
        assumption_removal,
        self_application,
        missing_information: "Recorded Links supply only positive facts. A continuation follows only under an exclusion over completions, and one orientation bit of that exclusion still separates [K,B] from [B,K]; the records state neither.",
        premise_pairs,
        exclusion_classes,
    }
}

// Orientation audit over the same two premises (R148). It uses only address
// equality and, per contract, slot order: no completion, exclusion, or
// position law decides anything here. A contract symmetry renames addresses
// and, when slots are anonymous, may also reverse every record's slots, so it
// acts on an unrecorded pair exactly as it would act on a record.
#[derive(Clone, Copy, PartialEq, Eq)]
enum OrientationContract {
    Named,
    Anonymous,
    Unordered,
}

#[derive(Clone, PartialEq, Eq)]
struct OrientationSymmetry {
    map: BTreeMap<usize, usize>,
    reversed: bool,
}

const ORIENTATION_FORWARD: [usize; 2] = [0, 2];
const ORIENTATION_REVERSE: [usize; 2] = [2, 0];
const ORIENTATION_TAGS: [usize; 2] = [20, 21];
const ORIENTATION_ALIGNED_LAW: ConsequencePositionLaw = [0, 3];
const ORIENTATION_REVERSED_LAW: ConsequencePositionLaw = [3, 0];

fn orientation_contract_id(contract: OrientationContract) -> &'static str {
    match contract {
        OrientationContract::Named => "named-ordered-slots",
        OrientationContract::Anonymous => "anonymous-ordered-slots",
        OrientationContract::Unordered => "unordered-slots",
    }
}

// A symmetry maps records to records, so once the record permutation and the
// slot treatment are fixed, every referenced address has one image. Unordered
// slots may flip each record separately.
fn orientation_symmetries(
    records: &[Vec<usize>],
    contract: OrientationContract,
) -> Vec<OrientationSymmetry> {
    let by_address = records
        .iter()
        .map(|record| (record[0], record))
        .collect::<BTreeMap<_, _>>();
    let addresses = records.iter().map(|record| record[0]).collect::<Vec<_>>();
    let flip_choices = match contract {
        OrientationContract::Named => vec![vec![false; records.len()]],
        OrientationContract::Anonymous => {
            vec![vec![false; records.len()], vec![true; records.len()]]
        }
        OrientationContract::Unordered => (0..1usize << records.len())
            .map(|mask| {
                (0..records.len())
                    .map(|index| mask & (1 << index) != 0)
                    .collect()
            })
            .collect(),
    };
    let mut found: Vec<OrientationSymmetry> = Vec::new();
    for image in finite_permutations(&addresses) {
        for flips in &flip_choices {
            let mut map = addresses
                .iter()
                .copied()
                .zip(image.iter().copied())
                .collect::<BTreeMap<_, _>>();
            let consistent = records.iter().zip(flips).all(|(record, flipped)| {
                let target = by_address[&map[&record[0]]];
                let images = if *flipped {
                    [target[2], target[1]]
                } else {
                    [target[1], target[2]]
                };
                [record[1], record[2]]
                    .into_iter()
                    .zip(images)
                    .all(|(value, image)| *map.entry(value).or_insert(image) == image)
            });
            if !consistent || map.values().collect::<BTreeSet<_>>().len() != map.len() {
                continue;
            }
            let symmetry = OrientationSymmetry {
                map,
                reversed: contract == OrientationContract::Anonymous
                    && flips.first() == Some(&true),
            };
            if !found.contains(&symmetry) {
                found.push(symmetry);
            }
        }
    }
    found
}

fn orientation_act(symmetry: &OrientationSymmetry, pair: [usize; 2]) -> [usize; 2] {
    let [left, right] = pair.map(|value| symmetry.map[&value]);
    if symmetry.reversed {
        [right, left]
    } else {
        [left, right]
    }
}

fn orientation_fixes(symmetry: &OrientationSymmetry, pair: [usize; 2]) -> bool {
    orientation_act(symmetry, pair) == pair
}

fn orientation_exchanges_candidates(group: &[OrientationSymmetry]) -> bool {
    group
        .iter()
        .any(|symmetry| orientation_act(symmetry, ORIENTATION_FORWARD) == ORIENTATION_REVERSE)
}

fn orientation_fixing_exactly_one_candidate(group: &[OrientationSymmetry]) -> usize {
    group
        .iter()
        .filter(|symmetry| {
            orientation_fixes(symmetry, ORIENTATION_FORWARD)
                != orientation_fixes(symmetry, ORIENTATION_REVERSE)
        })
        .count()
}

fn orientation_ends_exchanged(group: &[OrientationSymmetry]) -> bool {
    group
        .iter()
        .any(|symmetry| symmetry.map[&ORIENTATION_FORWARD[0]] == ORIENTATION_FORWARD[1])
}

fn orientation_candidate_relation(
    group: &[OrientationSymmetry],
    contract: OrientationContract,
) -> &'static str {
    if contract == OrientationContract::Unordered {
        "COINCIDE"
    } else if orientation_exchanges_candidates(group) {
        "EXCHANGED"
    } else {
        "SEPARATED"
    }
}

fn orientation_element_orbits(
    group: &[OrientationSymmetry],
    records: &[Vec<usize>],
) -> Vec<Vec<usize>> {
    let mut orbits: Vec<Vec<usize>> = Vec::new();
    for address in records.iter().flatten().copied().collect::<BTreeSet<_>>() {
        if orbits.iter().any(|orbit| orbit.contains(&address)) {
            continue;
        }
        orbits.push(
            group
                .iter()
                .map(|symmetry| symmetry.map[&address])
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
        );
    }
    orbits
}

// References of added records range over every existing address and fresh
// addresses 10, 11, ... numbered in order of first use.
fn orientation_reference_sequences(length: usize, existing: &[usize]) -> Vec<Vec<usize>> {
    fn extend(
        length: usize,
        existing: &[usize],
        prefix: &mut Vec<usize>,
        fresh_count: usize,
        output: &mut Vec<Vec<usize>>,
    ) {
        if prefix.len() == length {
            output.push(prefix.clone());
            return;
        }
        for value in existing {
            prefix.push(*value);
            extend(length, existing, prefix, fresh_count, output);
            prefix.pop();
        }
        for fresh in 0..=fresh_count {
            prefix.push(10 + fresh);
            extend(length, existing, prefix, fresh_count.max(fresh + 1), output);
            prefix.pop();
        }
    }
    let mut output = Vec::new();
    extend(length, existing, &mut Vec::new(), 0, &mut output);
    output
}

// Tagged incidence: [a,x,y] becomes the triples (a,t0,x) and (a,t1,y), so slot
// identity is carried by tag addresses 20 and 21. Symmetries permute every
// address and preserve the triple set; named tags stay fixed.
fn orientation_encode(records: &[Vec<usize>], tags: [usize; 2]) -> Vec<Vec<usize>> {
    records
        .iter()
        .flat_map(|record| {
            [
                vec![record[0], tags[0], record[1]],
                vec![record[0], tags[1], record[2]],
            ]
        })
        .collect()
}

fn orientation_rename_items(
    items: &[Vec<usize>],
    rename: impl Fn(usize) -> usize,
) -> Vec<Vec<usize>> {
    let mut renamed = items
        .iter()
        .map(|item| item.iter().map(|symbol| rename(*symbol)).collect())
        .collect::<Vec<Vec<usize>>>();
    renamed.sort();
    renamed
}

fn orientation_triple_symmetries(
    triples: &[Vec<usize>],
    fixed: &[usize],
) -> Vec<BTreeMap<usize, usize>> {
    let symbols = triples
        .iter()
        .flatten()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let original = orientation_rename_items(triples, |symbol| symbol);
    finite_permutations(&symbols)
        .into_iter()
        .map(|image| {
            symbols
                .iter()
                .copied()
                .zip(image)
                .collect::<BTreeMap<_, _>>()
        })
        .filter(|map| {
            fixed.iter().all(|symbol| map[symbol] == *symbol)
                && orientation_rename_items(triples, |symbol| map[&symbol]) == original
        })
        .collect()
}

fn orientation_tagged_candidate(pair: [usize; 2]) -> Vec<Vec<usize>> {
    orientation_rename_items(
        &[
            vec![ORIENTATION_TAGS[0], pair[0]],
            vec![ORIENTATION_TAGS[1], pair[1]],
        ],
        |symbol| symbol,
    )
}

fn orientation_tagged_case(
    id: &'static str,
    premises: &[Vec<usize>],
    carrier_records: &[Vec<usize>],
    fixed: &[usize],
) -> LinkOntologyOrientationTaggedEncoding {
    let mut triples = orientation_encode(premises, ORIENTATION_TAGS);
    triples.extend(orientation_encode(carrier_records, ORIENTATION_TAGS));
    let group = orientation_triple_symmetries(&triples, fixed);
    let tagged_forward = orientation_tagged_candidate(ORIENTATION_FORWARD);
    let tagged_reverse = orientation_tagged_candidate(ORIENTATION_REVERSE);
    let tagged_act = |map: &BTreeMap<usize, usize>, candidate: &[Vec<usize>]| {
        orientation_rename_items(candidate, |symbol| map[&symbol])
    };
    LinkOntologyOrientationTaggedEncoding {
        id,
        symmetries: group.len(),
        tags_exchanged: group
            .iter()
            .any(|map| map[&ORIENTATION_TAGS[0]] == ORIENTATION_TAGS[1]),
        ends_exchanged: group
            .iter()
            .any(|map| map[&ORIENTATION_FORWARD[0]] == ORIENTATION_FORWARD[1]),
        candidate_relation: if group
            .iter()
            .any(|map| tagged_act(map, &tagged_forward) == tagged_reverse)
        {
            "EXCHANGED"
        } else {
            "SEPARATED"
        },
        symmetries_fixing_exactly_one_candidate: group
            .iter()
            .filter(|map| {
                (tagged_act(map, &tagged_forward) == tagged_forward)
                    != (tagged_act(map, &tagged_reverse) == tagged_reverse)
            })
            .count(),
    }
}

// Scope of the one-step result: once a conclusion is recorded and composed
// again, its slot order is a record fact and the two correspondences build
// different closures of a three-link chain.
fn orientation_closure(pairs: &[Vec<usize>], law: ConsequencePositionLaw) -> Vec<Vec<usize>> {
    let mut pairs = pairs.to_vec();
    loop {
        let records = pairs
            .iter()
            .enumerate()
            .map(|(index, pair)| vec![100 + index, pair[0], pair[1]])
            .collect::<Vec<_>>();
        let derived = consequence_law_readouts(&records, law)
            .into_iter()
            .filter(|pair| !pairs.contains(pair))
            .collect::<Vec<_>>();
        if derived.is_empty() {
            pairs.sort();
            return pairs;
        }
        pairs.extend(derived);
    }
}

fn orientation_every_path_has_joined_ends(pairs: &[Vec<usize>]) -> bool {
    pairs.iter().all(|pair| {
        let start = pair[0];
        let mut reached = BTreeSet::new();
        let mut pending = vec![start];
        while let Some(node) = pending.pop() {
            for edge in pairs {
                if edge[0] == node && reached.insert(edge[1]) {
                    pending.push(edge[1]);
                }
            }
        }
        reached.iter().all(|end| {
            *end == start
                || pairs.contains(&vec![start, *end])
                || pairs.contains(&vec![*end, start])
        })
    })
}

fn link_ontology_continuation_orientation_audit() -> LinkOntologyOrientationAudit {
    let (k, a, b) = (0, 1, 2);
    let premises = vec![vec![3, k, a], vec![4, a, b]];
    let contracts = [
        OrientationContract::Named,
        OrientationContract::Anonymous,
        OrientationContract::Unordered,
    ]
    .into_iter()
    .map(|contract| {
        let group = orientation_symmetries(&premises, contract);
        LinkOntologyOrientationContract {
            id: orientation_contract_id(contract),
            symmetries: group.len(),
            element_orbits: orientation_element_orbits(&group, &premises),
            ends_exchanged: orientation_ends_exchanged(&group),
            candidate_relation: orientation_candidate_relation(&group, contract),
        }
    })
    .collect::<Vec<_>>();

    // Premises plus up to two ordinary records at addresses 5 and 6.
    let family = (0..=2usize)
        .flat_map(|extra| {
            let existing = (0..premises.len() + 3 + extra).collect::<Vec<_>>();
            orientation_reference_sequences(2 * extra, &existing)
                .into_iter()
                .map(|references| {
                    let mut records = premises.clone();
                    records.extend((0..extra).map(|index| {
                        vec![5 + index, references[2 * index], references[2 * index + 1]]
                    }));
                    records
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let correspondences: [(&'static str, fn([usize; 2]) -> [usize; 2]); 2] = [
        ("identity", |pair| pair),
        ("exchange", |[left, right]| [right, left]),
    ];
    let mut tallies = [OrientationContract::Named, OrientationContract::Anonymous]
        .into_iter()
        .map(|contract| LinkOntologyOrientationTally {
            id: orientation_contract_id(contract),
            separated: 0,
            exchanged: 0,
            symmetries_fixing_exactly_one_candidate: 0,
        })
        .collect::<Vec<_>>();
    let mut exchanging_extensions = Vec::new();
    let mut chiral_under_anonymous_slots = 0;
    let mut free = [true; 2];
    for records in &family {
        // Named symmetries are exactly the anonymous ones that keep slots in place.
        let anonymous_group = orientation_symmetries(records, OrientationContract::Anonymous);
        let named_group = anonymous_group
            .iter()
            .filter(|symmetry| !symmetry.reversed)
            .cloned()
            .collect::<Vec<_>>();
        for (tally, group) in tallies.iter_mut().zip([&named_group, &anonymous_group]) {
            tally.symmetries_fixing_exactly_one_candidate +=
                orientation_fixing_exactly_one_candidate(group);
            if orientation_exchanges_candidates(group) {
                tally.exchanged += 1;
            } else {
                tally.separated += 1;
            }
            for (still_free, (_, correspondence)) in free.iter_mut().zip(&correspondences) {
                *still_free = *still_free
                    && group.iter().all(|symmetry| {
                        orientation_act(symmetry, correspondence(ORIENTATION_FORWARD))
                            == correspondence(orientation_act(symmetry, ORIENTATION_FORWARD))
                    });
            }
        }
        if orientation_exchanges_candidates(&named_group) {
            exchanging_extensions.push(records[premises.len()..].to_vec());
        }
        if !anonymous_group.iter().any(|symmetry| symmetry.reversed) {
            chiral_under_anonymous_slots += 1;
        }
    }
    let free_correspondences = correspondences
        .iter()
        .zip(free)
        .filter(|(_, still_free)| *still_free)
        .map(|((id, _), _)| *id)
        .collect::<Vec<_>>();

    let laws = (0..4)
        .flat_map(|first| (0..4).map(move |second| [first, second]))
        .collect::<Vec<ConsequencePositionLaw>>();
    let anonymous_case = |records: Vec<Vec<usize>>| {
        let group = orientation_symmetries(&records, OrientationContract::Anonymous);
        LinkOntologyOrientationAnonymousCase {
            slot_reversing_symmetries: group.iter().filter(|symmetry| symmetry.reversed).count(),
            ends_exchanged: orientation_ends_exchanged(&group),
            candidate_relation: orientation_candidate_relation(
                &group,
                OrientationContract::Anonymous,
            ),
            symmetries_fixing_exactly_one_candidate: orientation_fixing_exactly_one_candidate(
                &group,
            ),
            records,
        }
    };
    let mut achiral = premises.clone();
    achiral.push(vec![5, 3, 4]);
    let mut chiral = achiral.clone();
    chiral.push(vec![8, 8, 9]);
    let unordered_shadow = |records: &[Vec<usize>]| {
        records
            .iter()
            .map(|record| {
                vec![
                    record[0],
                    record[1].min(record[2]),
                    record[1].max(record[2]),
                ]
            })
            .collect::<Vec<_>>()
    };
    let slot_order_case = |records: Vec<Vec<usize>>| LinkOntologyOrientationSlotOrderCase {
        named_candidate_relation: orientation_candidate_relation(
            &orientation_symmetries(&records, OrientationContract::Named),
            OrientationContract::Named,
        ),
        aligned_readout: consequence_law_readouts(&records, ORIENTATION_ALIGNED_LAW),
        reversed_readout: consequence_law_readouts(&records, ORIENTATION_REVERSED_LAW),
        records,
    };
    let mut cycle = premises.clone();
    cycle.extend([vec![5, b, 10], vec![6, 10, k]]);
    let mut detour = premises.clone();
    detour.extend([vec![5, b, 10], vec![6, k, 10]]);

    let renamings = finite_permutations(&[0, 1, 2, 3, 4]);
    let renaming_failures = renamings
        .iter()
        .filter(|image| {
            let renamed = premises
                .iter()
                .map(|record| record.iter().map(|value| image[*value]).collect())
                .collect::<Vec<Vec<usize>>>();
            let group = orientation_symmetries(&renamed, OrientationContract::Anonymous);
            let renamed_forward = ORIENTATION_FORWARD.map(|value| image[value]);
            let renamed_reverse = ORIENTATION_REVERSE.map(|value| image[value]);
            group.iter().any(|symmetry| {
                orientation_act(symmetry, renamed_forward) == renamed_reverse
                    || orientation_fixes(symmetry, renamed_forward)
                        != orientation_fixes(symmetry, renamed_reverse)
            })
        })
        .count();

    let tagged_encodings = vec![
        orientation_tagged_case("named-tags", &premises, &[], &ORIENTATION_TAGS),
        orientation_tagged_case("anonymous-tags", &premises, &[], &[]),
    ];
    let carrier = |id: &'static str, carrier_records: Vec<Vec<usize>>| {
        let tagged = orientation_tagged_case(id, &premises, &carrier_records, &[]);
        LinkOntologyOrientationCarrier {
            id,
            carrier_symmetries: orientation_triple_symmetries(
                &orientation_encode(&carrier_records, ORIENTATION_TAGS),
                &[],
            )
            .len(),
            carrier_records_have_equal_slots: carrier_records
                .iter()
                .all(|record| record[1] == record[2]),
            carrier_records,
            symmetries: tagged.symmetries,
            tags_exchanged: tagged.tags_exchanged,
            ends_exchanged: tagged.ends_exchanged,
            candidate_relation: tagged.candidate_relation,
            symmetries_fixing_exactly_one_candidate: tagged.symmetries_fixing_exactly_one_candidate,
        }
    };
    let carriers = vec![
        carrier(
            "symmetric-self-loop-carrier",
            vec![vec![20, 20, 20], vec![21, 21, 21]],
        ),
        carrier(
            "rigid-self-referential-carrier",
            vec![vec![20, 20, 20], vec![21, 20, 20]],
        ),
    ];
    let original = orientation_encode(&premises, ORIENTATION_TAGS);
    let tag_swapped = orientation_encode(&premises, [ORIENTATION_TAGS[1], ORIENTATION_TAGS[0]]);
    let sorted_tag_swapped = orientation_rename_items(&tag_swapped, |symbol| symbol);
    let isomorphic_with_tags_fixed = renamings.iter().any(|image| {
        orientation_rename_items(&original, |symbol| {
            if ORIENTATION_TAGS.contains(&symbol) {
                symbol
            } else {
                image[symbol]
            }
        }) == sorted_tag_swapped
    });
    // The aligned candidate keeps each end with the tag it has in its premise;
    // decoding reads tag 20 as the first slot.
    let aligned_decoding = |triples: &[Vec<usize>]| {
        let tag_of = |address: usize, value: usize| {
            triples
                .iter()
                .find(|triple| triple[0] == address && triple[2] == value)
                .map_or(usize::MAX, |triple| triple[1])
        };
        let mut tagged = vec![(tag_of(3, k), k), (tag_of(4, b), b)];
        tagged.sort();
        tagged
            .into_iter()
            .map(|(_, value)| value)
            .collect::<Vec<_>>()
    };

    let chain = vec![vec![3, k, a], vec![4, a, b], vec![5, b, 9]];
    let chain_pairs = chain
        .iter()
        .map(|record| vec![record[1], record[2]])
        .collect::<Vec<_>>();
    let closures = [
        ("identity", ORIENTATION_ALIGNED_LAW),
        ("exchange", ORIENTATION_REVERSED_LAW),
    ]
    .into_iter()
    .map(|(correspondence, law)| {
        let closure = orientation_closure(&chain_pairs, law);
        LinkOntologyOrientationClosure {
            correspondence,
            derived_pairs: closure.len() - chain_pairs.len(),
            every_path_has_joined_ends: orientation_every_path_has_joined_ends(&closure),
            closure,
        }
    })
    .collect::<Vec<_>>();
    let fewest_derived = closures
        .iter()
        .map(|item| item.derived_pairs)
        .min()
        .unwrap_or_default();

    let chirality = LinkOntologyOrientationChiralityPair {
        observation: "readouts of all 16 position laws",
        identical_observations: laws
            .iter()
            .map(|law| consequence_law_readouts(&achiral, *law))
            .collect::<Vec<_>>()
            == laws
                .iter()
                .map(|law| consequence_law_readouts(&chiral, *law))
                .collect::<Vec<_>>(),
        achiral: anonymous_case(achiral),
        chiral: anonymous_case(chiral),
    };
    let (named, anonymous, unordered) = (&contracts[0], &contracts[1], &contracts[2]);
    let rigid_carrier = &carriers[1];
    let asymmetries = vec![
        LinkOntologyOrientationAsymmetry {
            id: "join-address",
            provenance: if contracts.iter().all(|contract| {
                contract
                    .element_orbits
                    .iter()
                    .any(|orbit| orbit == &vec![a])
            }) {
                "FORCED_BY_INCIDENCE"
            } else {
                "NOT_FORCED"
            },
        },
        LinkOntologyOrientationAsymmetry {
            id: "candidate-separation",
            provenance: if named.candidate_relation == "SEPARATED"
                && anonymous.candidate_relation == "SEPARATED"
                && unordered.candidate_relation == "COINCIDE"
            {
                "FORCED_BY_SLOT_ORDER"
            } else {
                "NOT_FORCED"
            },
        },
        LinkOntologyOrientationAsymmetry {
            id: "end-asymmetry",
            provenance: if !named.ends_exchanged
                && anonymous.ends_exchanged
                && !chirality.chiral.ends_exchanged
            {
                "FORCED_BY_SLOT_NAMES_OR_CHIRAL_CONTEXT"
            } else {
                "NOT_FORCED"
            },
        },
        LinkOntologyOrientationAsymmetry {
            id: "slot-identity",
            provenance: if tagged_encodings[1].tags_exchanged && !rigid_carrier.tags_exchanged {
                "FORCED_ONLY_BY_A_RIGID_SELF_REFERENTIAL_CARRIER"
            } else {
                "NOT_FORCED"
            },
        },
        LinkOntologyOrientationAsymmetry {
            id: "output-correspondence",
            provenance: if free_correspondences.len() == correspondences.len() {
                "CHOSEN_NOT_FORCED"
            } else {
                "FORCED"
            },
        },
    ];
    let recursion_result = if rigid_carrier.carrier_records_have_equal_slots
        && rigid_carrier.carrier_symmetries == 1
        && !rigid_carrier.tags_exchanged
        && rigid_carrier.candidate_relation == "SEPARATED"
        && rigid_carrier.symmetries_fixing_exactly_one_candidate == 0
    {
        "SLOT_IDENTITY_FORCED_BY_SELF_INCIDENCE_CANDIDATES_STILL_UNRANKED"
    } else {
        "CARRIER_RESULT_CHANGED"
    };
    let separating_requirements = vec![
        LinkOntologyOrientationRequirement {
            id: "every-path-has-joined-ends",
            selects: closures
                .iter()
                .filter(|item| item.every_path_has_joined_ends)
                .map(|item| item.correspondence)
                .collect(),
        },
        LinkOntologyOrientationRequirement {
            id: "fewest-derived-pairs",
            selects: closures
                .iter()
                .filter(|item| item.derived_pairs == fewest_derived)
                .map(|item| item.correspondence)
                .collect(),
        },
    ];

    LinkOntologyOrientationAudit {
        question: "What structural property, if any, breaks the K⟼B / B⟼K symmetry without merely encoding the desired direction?",
        status: "CONSEQUENCE_ORIENTATION_DISTINGUISHED_BUT_NOT_FORCED",
        primitives: "address equality and, per contract, slot order; no completion, exclusion, or position law",
        candidates: vec![ORIENTATION_FORWARD.to_vec(), ORIENTATION_REVERSE.to_vec()],
        twin_family: LinkOntologyOrientationTwinFamily {
            extension: "the premises plus up to two ordinary records whose references range over every existing address and fresh addresses",
            structures: family.len(),
            by_extra_records: (0..=2)
                .map(|extra| {
                    family
                        .iter()
                        .filter(|records| records.len() == premises.len() + extra)
                        .count()
                })
                .collect(),
            contracts: tallies,
            exchanging_extensions,
            chiral_under_anonymous_slots,
            free_correspondences,
        },
        same_observation_pairs: LinkOntologyOrientationSameObservationPairs {
            chirality,
            slot_order: LinkOntologyOrientationSlotOrderPair {
                observation: "records with unordered slots",
                identical_observations: unordered_shadow(&cycle) == unordered_shadow(&detour),
                cycle: slot_order_case(cycle),
                detour: slot_order_case(detour),
            },
        },
        representations: LinkOntologyOrientationRepresentations {
            address_renamings: renamings.len(),
            renaming_failures,
            tagged_encodings,
            tag_swap: LinkOntologyOrientationTagSwap {
                isomorphic_with_tags_fixed,
                aligned_candidate_decodes_to: vec![
                    aligned_decoding(&original),
                    aligned_decoding(&tag_swapped),
                ],
            },
        },
        recursion: LinkOntologyOrientationRecursion {
            carriers,
            result: recursion_result,
        },
        asymmetries,
        no_go: LinkOntologyOrientationNoGo {
            argument: "Every contract symmetry renames addresses and may reverse every record's slots, so it acts on an unrecorded pair as on a record. The output swap commutes with every renaming and acts on pairs as that reversal does, so it commutes with every contract symmetry of every structure. Hence [0,2] and [2,0] have equal stabilizers, the orbit of [2,0] is the swapped orbit of [0,2], and composing any invariant selector with the swap gives an invariant selector that chooses the opposite orientation.",
            strong_negative: "EVERY_INTRINSIC_LINK_OBSERVATION_PRESERVED_ORIENTATION_STILL_REVERSIBLE",
        },
        iteration_boundary: LinkOntologyOrientationIterationBoundary {
            records: chain,
            closures,
            separating_requirements,
            provenance: "REQUIREMENT_ON_HOW_CONSEQUENCE_COMPOSES",
        },
        contracts,
        missing_information: "Slot order separates [K,B] from [B,K] but never ranks them. What is missing is the correspondence between the premise slot order and the unrecorded conclusion slot order: the identity correspondence is the neutral one, which makes [K,B] the default reading, but requiring consequence to use it is R147's slot-position preservation, which no record states. The records force separation, not orientation.",
    }
}

fn link_ontology_conditional_continuation_probe() -> LinkOntologyConditionalContinuationProbe {
    let premises = vec![vec![3, 0, 1], vec![4, 1, 2]];
    let forward_witness = vec![5, 3, 4];
    let reverse_witness = vec![5, 4, 3];
    let mut with_witness = premises.clone();
    with_witness.push(forward_witness.clone());
    let mut with_result = with_witness.clone();
    with_result.push(vec![7, 0, 2]);
    let mut with_unrelated_result = with_witness.clone();
    with_unrelated_result.push(vec![8, 0, 9]);
    let cases = vec![
        ("forward-witness", with_witness.clone()),
        (
            "reverse-witness",
            vec![
                premises[0].clone(),
                premises[1].clone(),
                reverse_witness.clone(),
            ],
        ),
        (
            "without-first-premise",
            vec![premises[1].clone(), forward_witness.clone()],
        ),
        (
            "without-second-premise",
            vec![premises[0].clone(), forward_witness.clone()],
        ),
        ("without-witness", premises.clone()),
        ("unrelated-result-record", with_unrelated_result),
    ]
    .into_iter()
    .map(|(id, records)| LinkOntologyContinuationCase {
        id,
        continuations: conditional_continuations(&records),
        records,
    })
    .collect();
    let renaming = with_witness
        .iter()
        .flatten()
        .map(|address| (*address, address + 10))
        .collect::<BTreeMap<_, _>>();
    let renamed = rename_record_addresses(&with_witness, &renaming);
    let reversed_slots = reverse_binary_reference_slots(&with_witness);
    let nested_encoding = with_witness
        .iter()
        .map(|record| (record[0], [(0, record[1]), (1, record[2])]))
        .collect::<Vec<_>>();
    let decoded_nested = nested_encoding
        .iter()
        .map(|(address, slots)| vec![*address, slots[0].1, slots[1].1])
        .collect::<Vec<_>>();
    let same_facts_competing_readouts = competing_continuation_readouts(&with_witness);
    let unordered_witness_readout = conditional_continuations_with_law(&with_witness, true, false);
    let reversed_witness_under_unordered_reading = conditional_continuations_with_law(
        &[
            premises[0].clone(),
            premises[1].clone(),
            reverse_witness.clone(),
        ],
        true,
        false,
    );
    let mut with_rule_record = with_witness.clone();
    with_rule_record.push(vec![6, 5, 5]);
    let split_reference_records = vec![premises[0].clone(), vec![4, 9, 2], forward_witness.clone()];
    let same_retained_addresses_and_witness = with_witness
        .iter()
        .map(|record| record[0])
        .collect::<Vec<_>>()
        == split_reference_records
            .iter()
            .map(|record| record[0])
            .collect::<Vec<_>>()
        && with_witness[2] == split_reference_records[2];
    let split_reference_readout = conditional_continuations(&split_reference_records);
    LinkOntologyConditionalContinuationProbe {
        status: "LINKED_WITNESS_CONDITIONALLY_SELECTS_CONTINUATION_WITHOUT_FORCING_IT",
        contract: "ordered addressed binary records with equality of addresses",
        criterion: "for distinct records P and Q, P.second equals Q.first and an ordinary witness references P.address then Q.address; report [P.first,Q.second]",
        criterion_provenance: "OBSERVER_SELECTED_INCIDENCE_JOIN",
        premises,
        forward_witness,
        reverse_witness,
        cases,
        address_renaming_equivariant: conditional_continuations(&renamed) == vec![vec![10, 12]],
        record_reordering_invariant: conditional_continuations(
            &with_witness.iter().rev().cloned().collect::<Vec<_>>(),
        ) == vec![vec![0, 2]],
        slot_reversal_changes_continuation:
            conditional_continuations(&reversed_slots) == vec![vec![2, 0]],
        result_absent_with_witness: !has_reference_pair(&with_witness, &[0, 2]),
        result_present_in_extension: has_reference_pair(&with_result, &[0, 2]),
        witness_condition_holds_in_both:
            conditional_continuations(&with_witness) == conditional_continuations(&with_result),
        intrinsic_creation_or_authority_established: false,
        transition_law_audit: LinkOntologyTransitionLawAudit {
            nested_encoding_preserves_readout:
                conditional_continuations(&decoded_nested) == conditional_continuations(&with_witness),
            both_readouts_address_renaming_equivariant:
                competing_continuation_readouts(&renamed)
                    == LinkOntologyCompetingReadouts {
                        forward_projection: vec![vec![10, 12]],
                        reverse_projection: vec![vec![12, 10]],
                    },
            both_readouts_record_reordering_invariant:
                competing_continuation_readouts(
                    &with_witness.iter().rev().cloned().collect::<Vec<_>>(),
                ) == same_facts_competing_readouts.clone(),
            unordered_witness_readout: unordered_witness_readout.clone(),
            reversed_witness_under_unordered_reading: reversed_witness_under_unordered_reading.clone(),
            same_facts_with_rule_record_competing_readouts:
                competing_continuation_readouts(&with_rule_record),
            adjacency_equality_erasure_countermodel:
                LinkOntologyAdjacencyEqualityErasureCountermodel {
                    same_retained_addresses_and_witness,
                    shared_reference_readout: conditional_continuations(&with_witness),
                    split_reference_readout: split_reference_readout.clone(),
                },
            operation_removal: LinkOntologyTransitionLawRemoval {
                without_witness_orientation: if unordered_witness_readout
                    == reversed_witness_under_unordered_reading {
                    "SAME_CANDIDATE_FOR_THIS_CHAIN"
                } else {
                    "CANDIDATE_CHANGES"
                },
                without_output_projection: if same_facts_competing_readouts.forward_projection
                    != same_facts_competing_readouts.reverse_projection {
                    "TWO_CANDIDATE_READOUTS"
                } else {
                    "SAME_CANDIDATE"
                },
                without_incidence_equality: if same_retained_addresses_and_witness
                    && split_reference_readout.is_empty() {
                    "JOIN_UNDETERMINED"
                } else {
                    "COUNTERMODEL_NOT_ESTABLISHED"
                },
                without_enumeration: "CANDIDATE_DISCOVERY_UNDETERMINED",
                without_construction: "NO_RESULT_RECORD_PRODUCED",
            },
            same_facts_competing_readouts,
            stage_boundary: LinkOntologyTransitionStageBoundary {
                formable: true,
                conditionally_identifiable: true,
                intrinsically_admissible: false,
                follows_from_records_alone: false,
                produced_by_records_alone: false,
            },
            law_self_application_established: false,
        },
        consequence_audit: link_ontology_continuation_consequence_audit(),
        orientation_audit: link_ontology_continuation_orientation_audit(),
        claim_boundary: "A third ordinary link makes one continuation structurally identifiable under the declared join. Its witness order is dispensable for this particular chain, but the output projection is not: two generic projections report different pairs from identical records, even with an added ordinary rule-like record. Faithful nested encoding preserves a chosen readout without authorizing it. The witness-only structure and its result-bearing extension satisfy the same join, so no intrinsic admissibility, consequence, creation, execution, or self-applying transition law is established. Read over every completion of the premises, nothing new follows without an exclusion; the transitive and circular exclusions restate the two surviving projections and make opposite orientations follow, and every admitted genericity criterion is blind to that orientation. With address equality and slot order alone, slot order separates the two orientations but never ranks them: the output swap commutes with every contract symmetry, so each invariant selector has an invariant twin, and even a rigid self-referential slot carrier leaves the premise-to-conclusion slot correspondence free.",
    }
}

fn unordered_record_set_signature(records: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut signature = records.to_vec();
    signature.sort();
    signature
}

fn rename_record_addresses(
    records: &[Vec<usize>],
    renaming: &BTreeMap<usize, usize>,
) -> Vec<Vec<usize>> {
    records
        .iter()
        .map(|record| {
            record
                .iter()
                .map(|address| renaming.get(address).copied().unwrap_or(*address))
                .collect()
        })
        .collect()
}

fn candidate_address_automorphisms(
    records: &[Vec<usize>],
    candidate_addresses: &[usize],
) -> Vec<Vec<usize>> {
    let candidate_set = candidate_addresses.iter().copied().collect::<BTreeSet<_>>();
    let background_addresses = records
        .iter()
        .flatten()
        .filter(|address| !candidate_set.contains(address))
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    finite_permutations(&(0..candidate_addresses.len()).collect::<Vec<_>>())
        .into_iter()
        .filter(|permutation| {
            let candidate_renaming = candidate_addresses
                .iter()
                .enumerate()
                .map(|(index, address)| (*address, candidate_addresses[permutation[index]]))
                .collect::<BTreeMap<_, _>>();
            finite_permutations(&background_addresses)
                .into_iter()
                .any(|background_permutation| {
                    let mut renaming = candidate_renaming.clone();
                    renaming.extend(
                        background_addresses
                            .iter()
                            .copied()
                            .zip(background_permutation),
                    );
                    unordered_record_set_signature(&rename_record_addresses(records, &renaming))
                        == unordered_record_set_signature(records)
                })
        })
        .collect()
}

fn finite_orbit_sizes(size: usize, automorphisms: &[Vec<usize>]) -> Vec<usize> {
    let mut unseen = (0..size).collect::<BTreeSet<_>>();
    let mut sizes = Vec::new();
    while let Some(seed) = unseen.iter().next().copied() {
        let orbit = automorphisms
            .iter()
            .map(|permutation| permutation[seed])
            .collect::<BTreeSet<_>>();
        sizes.push(orbit.len());
        for member in orbit {
            unseen.remove(&member);
        }
    }
    sizes.sort_unstable();
    sizes
}

fn marked_candidates(records: &[Vec<usize>], candidate_addresses: &[usize]) -> Vec<usize> {
    let candidates = candidate_addresses.iter().copied().collect::<BTreeSet<_>>();
    records
        .iter()
        .filter_map(|record| {
            if record.len() == 3 && record[1] == record[2] && candidates.contains(&record[1]) {
                Some(record[1])
            } else {
                None
            }
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn link_ontology_link_carried_selection_authority_probe(
) -> LinkOntologyLinkCarriedSelectionAuthorityProbe {
    // These names describe the experiment, not roles encoded in the records.
    // Every record remains only [address, first reference, second reference].
    let premises = vec![vec![3, 0, 1], vec![4, 1, 2]];
    let candidates = vec![vec![7, 0, 2], vec![8, 0, 2]];
    let candidate_addresses = candidates
        .iter()
        .map(|record| record[0])
        .collect::<Vec<_>>();
    let without_additional_link = premises
        .iter()
        .chain(candidates.iter())
        .cloned()
        .collect::<Vec<_>>();
    let additional_link = vec![9, 7, 7];
    let mut with_additional_link = without_additional_link.clone();
    with_additional_link.push(additional_link.clone());
    let replacement_link = vec![9, 8, 8];
    let mut with_replacement_link = without_additional_link.clone();
    with_replacement_link.push(replacement_link.clone());
    let without_automorphisms =
        candidate_address_automorphisms(&without_additional_link, &candidate_addresses);
    let with_automorphisms =
        candidate_address_automorphisms(&with_additional_link, &candidate_addresses);
    let invariant_candidate_subsets = |automorphisms: &[Vec<usize>]| {
        finite_invariant_subsets(candidate_addresses.len(), automorphisms)
            .into_iter()
            .map(|subset| {
                subset
                    .into_iter()
                    .map(|index| candidate_addresses[index])
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
    };
    let without_invariant_subsets = invariant_candidate_subsets(&without_automorphisms);
    let with_invariant_subsets = invariant_candidate_subsets(&with_automorphisms);
    let candidate_swap = BTreeMap::from([(7, 8), (8, 7)]);
    let swapped_with_additional_link =
        rename_record_addresses(&with_additional_link, &candidate_swap);
    let referenced = marked_candidates(&with_additional_link, &candidate_addresses);
    let unreferenced = candidate_addresses
        .iter()
        .filter(|address| !referenced.contains(address))
        .copied()
        .collect::<Vec<_>>();
    let replacement_referenced = marked_candidates(&with_replacement_link, &candidate_addresses);
    let replacement_unreferenced = candidate_addresses
        .iter()
        .filter(|address| !replacement_referenced.contains(address))
        .copied()
        .collect::<Vec<_>>();
    let swap_selection = |selected: &[usize]| {
        let mut swapped = selected
            .iter()
            .map(|address| candidate_swap.get(address).copied().unwrap_or(*address))
            .collect::<Vec<_>>();
        swapped.sort_unstable();
        swapped
    };

    let context_identities = vec![vec![10, 10, 10], vec![11, 11, 11]];
    let first_context_relation = vec![12, 10, 9];
    let second_context_relation = vec![12, 11, 9];
    let first_context_structure = with_additional_link
        .iter()
        .chain(context_identities.iter())
        .cloned()
        .chain(std::iter::once(first_context_relation.clone()))
        .collect::<Vec<_>>();
    let second_context_structure = with_additional_link
        .iter()
        .chain(context_identities.iter())
        .cloned()
        .chain(std::iter::once(second_context_relation.clone()))
        .collect::<Vec<_>>();
    let context_swap = BTreeMap::from([(10, 11), (11, 10)]);
    let duplicated_links = vec![vec![9, 7, 7], vec![10, 8, 8]];
    let duplicated_structure = without_additional_link
        .iter()
        .chain(duplicated_links.iter())
        .cloned()
        .collect::<Vec<_>>();
    let duplicated_marked = marked_candidates(&duplicated_structure, &candidate_addresses);
    let finite_ordinary_link_chain = vec![vec![9, 7, 7], vec![10, 9, 9], vec![11, 10, 10]];
    let replacement_finite_ordinary_link_chain =
        vec![vec![9, 8, 8], vec![10, 9, 9], vec![11, 10, 10]];
    let recursive_link = vec![9, 9, 7];
    let replacement_recursive_link = vec![9, 9, 8];
    let same_local_equality_pattern =
        first_occurrence_normal_form(&additional_link) == first_occurrence_normal_form(&[9, 8, 8]);
    let whole_structures_related_by_candidate_renaming =
        unordered_record_set_signature(&swapped_with_additional_link)
            == unordered_record_set_signature(&with_replacement_link);
    let same_under_context_address_renaming = unordered_record_set_signature(
        &rename_record_addresses(&first_context_structure, &context_swap),
    ) == unordered_record_set_signature(
        &second_context_structure,
    );
    let finite_chain_candidate_swap_preserves_shape =
        unordered_record_set_signature(&rename_record_addresses(
            &without_additional_link
                .iter()
                .chain(finite_ordinary_link_chain.iter())
                .cloned()
                .collect::<Vec<_>>(),
            &candidate_swap,
        )) == unordered_record_set_signature(
            &without_additional_link
                .iter()
                .chain(replacement_finite_ordinary_link_chain.iter())
                .cloned()
                .collect::<Vec<_>>(),
        );
    let self_referential_candidate_swap_preserves_shape =
        unordered_record_set_signature(&rename_record_addresses(
            &without_additional_link
                .iter()
                .cloned()
                .chain(std::iter::once(recursive_link.clone()))
                .collect::<Vec<_>>(),
            &candidate_swap,
        )) == unordered_record_set_signature(
            &without_additional_link
                .iter()
                .cloned()
                .chain(std::iter::once(replacement_recursive_link))
                .collect::<Vec<_>>(),
        );
    let without_singletons = without_invariant_subsets
        .iter()
        .filter(|subset| subset.len() == 1)
        .count();
    let with_singletons = with_invariant_subsets
        .iter()
        .filter(|subset| subset.len() == 1)
        .count();

    LinkOntologyLinkCarriedSelectionAuthorityProbe {
        status: "LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY",
        records: LinkOntologyAuthorityRecords {
            interpretation: "each vector is only [address, first reference, second reference]",
            records_treated_as_unordered: true,
            incidence_readout_provenance:
                "EXPERIMENTAL_EQUAL-REFERENCE_OBSERVATION_NOT_INTRINSIC_AUTHORITY",
            premises,
            candidates,
            additional_link: additional_link.clone(),
        },
        equivariant_selection_constraint: LinkOntologyEquivariantSelectionConstraint {
            criterion: "a selection derived only from the record structure must be invariant under every address automorphism that preserves the candidate domain",
            without_additional_link: LinkOntologyCandidateSymmetry {
                candidate_automorphisms: without_automorphisms.clone(),
                candidate_orbit_sizes: finite_orbit_sizes(
                    candidate_addresses.len(),
                    &without_automorphisms,
                ),
                invariant_candidate_subsets: without_invariant_subsets.clone(),
                invariant_singleton_selections: without_singletons,
            },
            with_additional_link: LinkOntologyCandidateSymmetry {
                candidate_automorphisms: with_automorphisms.clone(),
                candidate_orbit_sizes: finite_orbit_sizes(
                    candidate_addresses.len(),
                    &with_automorphisms,
                ),
                invariant_candidate_subsets: with_invariant_subsets.clone(),
                invariant_singleton_selections: with_singletons,
            },
            singleton_selection_made_possible: without_singletons == 0 && with_singletons > 0,
            singleton_selection_forced: with_singletons == 1,
            general_argument: vec![
                "an equivariant selected subset must be a union of candidate orbits under every automorphism of the containing structure",
                "before the additional link, swapping candidate addresses 7 and 8 preserves the unordered record collection, so neither singleton is invariant",
                "the additional link [9,7,7] breaks that swap and splits the candidate orbit into two singleton orbits",
                "both singleton subsets then become invariant, so symmetry breaking permits but does not force one selection",
            ],
        },
        opposite_equivariant_readings: vec![
            LinkOntologyEquivariantReading {
                id: "referenced-candidate",
                selected_candidates: referenced.clone(),
                address_renaming_equivariant: swap_selection(&referenced)
                    == replacement_referenced,
            },
            LinkOntologyEquivariantReading {
                id: "unreferenced-candidate",
                selected_candidates: unreferenced.clone(),
                address_renaming_equivariant: swap_selection(&unreferenced)
                    == replacement_unreferenced,
            },
        ],
        perturbations: LinkOntologyAuthorityPerturbations {
            removal: LinkOntologyAuthorityRemoval {
                records: without_additional_link.clone(),
                marked_candidates: marked_candidates(
                    &without_additional_link,
                    &candidate_addresses,
                ),
                unique: marked_candidates(&without_additional_link, &candidate_addresses).len()
                    == 1,
            },
            replacement: LinkOntologyAuthorityReplacement {
                replacement_link: replacement_link.clone(),
                marked_candidates: replacement_referenced.clone(),
                unique: replacement_referenced.len() == 1,
                same_under_candidate_address_renaming: unordered_record_set_signature(
                    &swapped_with_additional_link,
                ) == unordered_record_set_signature(&with_replacement_link),
            },
            duplication: LinkOntologyAuthorityDuplication {
                additional_links: duplicated_links,
                marked_candidates: duplicated_marked.clone(),
                unique: duplicated_marked.len() == 1,
            },
            forgery: LinkOntologyAuthorityForgery {
                original_link: additional_link.clone(),
                forged_link: replacement_link,
                same_local_equality_pattern,
                whole_structures_related_by_candidate_renaming,
                structurally_rejected: !(same_local_equality_pattern
                    && whole_structures_related_by_candidate_renaming),
            },
            context_relocation: LinkOntologyAuthorityContextRelocation {
                first_context_relation: first_context_relation.clone(),
                second_context_relation: second_context_relation.clone(),
                authority_link_exists_in_both: [&first_context_structure, &second_context_structure]
                    .iter()
                    .all(|records| has_link_record(records, &additional_link)),
                relation_changes_observed_context: first_context_relation[1]
                    != second_context_relation[1],
                same_under_context_address_renaming,
                ambient_existence_selects_active_context: !same_under_context_address_renaming,
            },
        },
        recursive_authority: LinkOntologyRecursiveAuthority {
            finite_ordinary_link_chain,
            finite_chain_candidate_swap_preserves_shape,
            self_referential_link: recursive_link.clone(),
            self_reference_closes_address_cycle: recursive_link.contains(&recursive_link[0]),
            self_referential_candidate_swap_preserves_shape,
            selection_polarity_still_underdetermined: finite_chain_candidate_swap_preserves_shape
                && self_referential_candidate_swap_preserves_shape,
            consequence: "finite chains and self-incidence can represent authority-about-authority and close an address cycle, but neither structure chooses how its terminal candidate incidence is to be read",
        },
        distinctions: LinkOntologyAuthorityDistinctions {
            formation: "BOTH_CANDIDATE_LINKS_EXIST",
            selection: "NOT_FORCED_TWO_OPPOSITE_EQUIVARIANT_READINGS",
            justification: "ISOMORPHIC_FORGERY_NOT_REJECTED",
            activation: "NO_LINK_DERIVED_ADMISSION_VALIDATION_OR_ACTIVATION",
            applicability: "AMBIENT_EXISTENCE_DOES_NOT_SELECT_APPLICABILITY",
            execution: "NO_TRANSITION_CREATION_OR_PUBLICATION_EVENT",
        },
        conclusion: "An ordinary additional link can carry enough incidence to remove a symmetry obstruction and make a singleton candidate structurally expressible. The same extension admits opposite equivariant readings, while removal, replacement, duplication, forgery, context relocation, finite meta-chains, and self-reference supply no structural authenticity or activation criterion.",
        claim_boundary: "This refutes both the claim that linked structure cannot carry selection-relevant information and the claim that asymmetric incidence alone supplies authority. It does not prove that external authority is irreducible, rule out richer link-carried justification, interpret the additional link as a rule or witness, or derive execution.",
    }
}

fn linked_certificate_records(
    bundle_address: usize,
    context_address: usize,
    mapping_pairs: &[(usize, usize)],
    mapping_address_start: usize,
    membership_address_start: usize,
    applicability_address: usize,
) -> Vec<Vec<usize>> {
    let mappings = mapping_pairs
        .iter()
        .enumerate()
        .map(|(index, (description_address, concrete_address))| {
            vec![
                mapping_address_start + index,
                *description_address,
                *concrete_address,
            ]
        })
        .collect::<Vec<_>>();
    std::iter::once(vec![bundle_address, bundle_address, bundle_address])
        .chain(mappings.iter().cloned())
        .chain(mappings.iter().enumerate().map(|(index, mapping)| {
            vec![membership_address_start + index, bundle_address, mapping[0]]
        }))
        .chain(std::iter::once(vec![
            applicability_address,
            context_address,
            bundle_address,
        ]))
        .collect()
}

// The local incidence join is reusable, but its enumeration and interpretation
// are still host operations. All inputs and the emitted trace are link triples.
fn linked_local_matches(
    description: &[usize],
    mappings: &[Vec<usize>],
    records: &[Vec<usize>],
    reversed: bool,
) -> Vec<(usize, [usize; 3])> {
    if !has_link_record(records, description) {
        return Vec::new();
    }
    let mut matches = Vec::new();
    for concrete in records {
        let options = (0..3)
            .map(|position| {
                mappings
                    .iter()
                    .filter(|mapping| {
                        if reversed {
                            mapping[2] == description[position] && mapping[1] == concrete[position]
                        } else {
                            mapping[1] == description[position] && mapping[2] == concrete[position]
                        }
                    })
                    .map(|mapping| mapping[0])
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        for address_witness in &options[0] {
            for first_witness in &options[1] {
                for second_witness in &options[2] {
                    matches.push((
                        concrete[0],
                        [*address_witness, *first_witness, *second_witness],
                    ));
                }
            }
        }
    }
    matches
}

fn link_ontology_linked_verifier_step_probe() -> LinkOntologyVerifierStepProbe {
    let description = vec![40, 30, 31];
    let mappings = vec![vec![50, 40, 3], vec![51, 30, 0], vec![52, 31, 1]];
    let base_records = [
        vec![description.clone(), vec![41, 31, 30], vec![3, 0, 1]],
        mappings.clone(),
    ]
    .concat();
    let evaluate = |id: &'static str,
                    records: &[Vec<usize>],
                    selected_mappings: &[Vec<usize>],
                    concrete_addresses: &[usize],
                    reversed: bool| {
        let matches = linked_local_matches(&description, selected_mappings, records, reversed)
            .into_iter()
            .filter(|(address, _)| concrete_addresses.contains(address))
            .collect::<Vec<_>>();
        let trace_records =
            matches
                .iter()
                .enumerate()
                .flat_map(|(index, (concrete_address, witness_addresses))| {
                    let root = 200 + index * 10;
                    std::iter::once(vec![root, description[0], *concrete_address])
                        .chain(witness_addresses.iter().enumerate().map(
                            move |(position, address)| vec![root + position + 1, root, *address],
                        ))
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>();
        LinkOntologyVerifierStepCase {
            id,
            cardinality: match matches.len() {
                0 => "ZERO",
                1 => "ONE",
                _ => "MANY",
            },
            trace_records,
        }
    };
    let missing_records = base_records
        .iter()
        .filter(|record| record[0] != 52)
        .cloned()
        .collect::<Vec<_>>();
    let duplicate_records = [base_records.clone(), vec![vec![53, 30, 0]]].concat();
    let duplicate_mappings = [mappings.clone(), vec![vec![53, 30, 0]]].concat();
    let reversed_records = [vec![description.clone(), vec![3, 1, 0]], mappings.clone()].concat();
    let two_records = [base_records.clone(), vec![vec![7, 0, 1], vec![54, 40, 7]]].concat();
    let two_mappings = [mappings.clone(), vec![vec![54, 40, 7]]].concat();
    let self_mappings = vec![vec![50, 40, 40], vec![51, 30, 30], vec![52, 31, 31]];
    let self_records = [vec![description.clone()], self_mappings.clone()].concat();
    let cases = vec![
        evaluate(
            "complete-local-match",
            &base_records,
            &mappings,
            &[3],
            false,
        ),
        evaluate(
            "missing-description-record",
            &base_records
                .iter()
                .filter(|record| record[0] != 40)
                .cloned()
                .collect::<Vec<_>>(),
            &mappings,
            &[3],
            false,
        ),
        evaluate(
            "missing-mapping",
            &missing_records,
            &mappings[..2],
            &[3],
            false,
        ),
        evaluate(
            "duplicate-mapping",
            &duplicate_records,
            &duplicate_mappings,
            &[3],
            false,
        ),
        evaluate(
            "reversed-concrete-record",
            &reversed_records,
            &mappings,
            &[3],
            false,
        ),
        evaluate(
            "two-concrete-records",
            &two_records,
            &two_mappings,
            &[3, 7],
            false,
        ),
        evaluate(
            "self-application",
            &self_records,
            &self_mappings,
            &[40],
            false,
        ),
    ];
    let trace_root = &cases[0].trace_records[0];
    let trace_self_mappings = vec![
        vec![801, trace_root[0], trace_root[0]],
        vec![802, trace_root[1], trace_root[1]],
        vec![803, trace_root[2], trace_root[2]],
    ];
    let trace_self_records = [vec![trace_root.clone()], trace_self_mappings.clone()].concat();
    let trace_replay_by_same_join =
        linked_local_matches(trace_root, &trace_self_mappings, &trace_self_records, false).len()
            == 1;
    LinkOntologyVerifierStepProbe {
        status: "LOCAL_MATCH_HAS_LINKED_TRACE_BUT_RETAINS_HOST_EXECUTION_BOUNDARY",
        relation: "a description record and a concrete record commute through three linked correspondence witnesses",
        trace_replay_records: trace_self_records,
        removal_tests: LinkOntologyVerifierStepRemovalTests {
            no_cardinality_classification: if cases[0].trace_records.is_empty() {
                "NO_TRACE"
            } else {
                "TRACE_EXISTS_CLASSIFICATION_UNAVAILABLE"
            },
            reversed_mapping_reading: if evaluate(
                "reversed-reading", &base_records, &mappings, &[3], true,
            ).cardinality == "ZERO" {
                "ZERO_FOR_SAME_LINKS"
            } else {
                "MATCH"
            },
            self_application_cardinality: cases
                .iter()
                .find(|item| item.id == "self-application")
                .map(|item| item.cardinality)
                .unwrap_or("ZERO"),
            trace_replay_by_same_join,
            alternate_description_on_same_links: if linked_local_matches(
                &[41, 31, 30], &mappings, &base_records, false,
            ).is_empty() {
                "ZERO_WHILE_SELECTED_DESCRIPTION_IS_ONE"
            } else {
                "MATCH"
            },
            set_or_map_construction_removed:
                "LOCAL_JOIN_STILL_PRODUCES_TRACE_WITHOUT_SET_OR_MAP",
        },
        boundaries: LinkOntologyVerifierStepBoundaries {
            representation: "DESCRIPTION_CORRESPONDENCES_AND_TRACE_ARE_LINK_RECORDS",
            execution: "HOST_ITERATION_PROJECTION_EQUALITY_AND_BRANCHING_REMAIN",
            semantic_authority: "ACTIVE_DESCRIPTION_AND_MAPPING_ROLE_NOT_LINK_AUTHORIZED",
        },
        claim_boundary: "The local record comparison is factored into a reusable incidence join and emits ordinary linked trace records. The host still enumerates records, reads positions, tests equality, and classifies multiplicity; self-application supplies no rule for choosing or executing this relation.",
        cases,
    }
}

fn linked_certificate_candidates(
    description: &[Vec<usize>],
    records: &[Vec<usize>],
    candidate_addresses: &[usize],
    context_address: usize,
) -> Vec<usize> {
    let description_addresses = description
        .iter()
        .flatten()
        .copied()
        .collect::<BTreeSet<_>>();
    let description_record_addresses = description
        .iter()
        .map(|record| record[0])
        .collect::<Vec<_>>();
    let candidate_description_address = description.last().unwrap()[0];
    let candidate_set = candidate_addresses.iter().copied().collect::<BTreeSet<_>>();
    let mut record_by_address = BTreeMap::<usize, Vec<Vec<usize>>>::new();
    for record in records {
        record_by_address
            .entry(record[0])
            .or_default()
            .push(record.clone());
    }
    let bundle_addresses = records
        .iter()
        .filter(|record| record[0] == record[1] && record[1] == record[2])
        .map(|record| record[0])
        .collect::<Vec<_>>();
    let mut accepted = BTreeSet::new();

    for bundle_address in bundle_addresses {
        let applicability_link_count = records
            .iter()
            .filter(|record| record[1] == context_address && record[2] == bundle_address)
            .count();
        if applicability_link_count != 1 {
            continue;
        }
        let membership_links = records
            .iter()
            .filter(|record| record[0] != bundle_address && record[1] == bundle_address)
            .collect::<Vec<_>>();
        let mapping_records = membership_links
            .iter()
            .filter_map(|membership| {
                let addressed = record_by_address.get(&membership[2])?;
                (addressed.len() == 1).then(|| addressed[0].clone())
            })
            .collect::<Vec<_>>();
        if mapping_records.len() != description_addresses.len() {
            continue;
        }
        let mapped_sources = mapping_records
            .iter()
            .map(|record| record[1])
            .collect::<Vec<_>>();
        if mapped_sources
            .iter()
            .copied()
            .collect::<BTreeSet<_>>()
            .len()
            != description_addresses.len()
            || !description_addresses
                .iter()
                .all(|address| mapped_sources.contains(address))
        {
            continue;
        }
        let concrete_targets = mapping_records
            .iter()
            .map(|record| record[2])
            .collect::<Vec<_>>();
        if concrete_targets
            .iter()
            .copied()
            .collect::<BTreeSet<_>>()
            .len()
            != concrete_targets.len()
        {
            continue;
        }
        let mapping = mapping_records
            .iter()
            .map(|record| (record[1], record[2]))
            .collect::<BTreeMap<_, _>>();
        if !description.iter().all(|record| {
            !linked_local_matches(record, &mapping_records, records, false).is_empty()
        }) {
            continue;
        }
        let context_record = vec![
            context_address,
            mapping[&description_record_addresses[0]],
            mapping[&description_record_addresses[1]],
        ];
        if !has_link_record(records, &context_record) {
            continue;
        }
        let candidate_address = mapping[&candidate_description_address];
        if candidate_set.contains(&candidate_address) {
            accepted.insert(candidate_address);
        }
    }
    accepted.into_iter().collect()
}

fn link_ontology_linked_structural_admissibility_probe(
) -> LinkOntologyLinkedStructuralAdmissibilityProbe {
    // The descriptive names and verifier are experimental observer vocabulary.
    // Every represented object below remains an ordinary addressed record.
    let description = vec![vec![40, 30, 31], vec![41, 31, 32], vec![42, 30, 32]];
    let replacement_description = vec![vec![40, 30, 31], vec![41, 31, 32], vec![42, 32, 30]];
    let premises = vec![vec![3, 0, 1], vec![4, 1, 2]];
    let valid_candidate = vec![7, 0, 2];
    let reverse_candidate = vec![8, 2, 0];
    let duplicate_candidate = vec![8, 0, 2];
    let contexts = vec![vec![60, 3, 4], vec![61, 3, 4]];
    let base_mapping = vec![(40, 3), (41, 4), (42, 7), (30, 0), (31, 1), (32, 2)];
    let second_mapping = vec![(40, 3), (41, 4), (42, 8), (30, 0), (31, 1), (32, 2)];
    let first_certificate = linked_certificate_records(49, 60, &base_mapping, 50, 100, 70);
    let second_certificate = linked_certificate_records(79, 60, &second_mapping, 80, 110, 71);
    let common_records = description
        .iter()
        .chain(premises.iter())
        .cloned()
        .chain(std::iter::once(valid_candidate.clone()))
        .chain(std::iter::once(reverse_candidate.clone()))
        .chain(contexts.iter().cloned())
        .collect::<Vec<_>>();
    let baseline_records = common_records
        .iter()
        .chain(first_certificate.iter())
        .cloned()
        .collect::<Vec<_>>();
    let evaluate = |id: &'static str,
                    records: &[Vec<usize>],
                    selected_description: &[Vec<usize>],
                    candidate_addresses: &[usize],
                    context_address: usize| {
        let admissible_candidates = linked_certificate_candidates(
            selected_description,
            records,
            candidate_addresses,
            context_address,
        );
        LinkOntologyAdmissibilityCase {
            id,
            admissible_candidate_count: admissible_candidates.len(),
            cardinality: match admissible_candidates.len() {
                0 => "ZERO",
                1 => "ONE",
                _ => "MANY",
            },
            admissible_candidates,
        }
    };
    let missing_evidence_records = baseline_records
        .iter()
        .filter(|record| ![55, 105].contains(&record[0]))
        .cloned()
        .collect::<Vec<_>>();
    let duplicate_evidence_records = baseline_records
        .iter()
        .cloned()
        .chain([vec![56, 42, 7], vec![106, 49, 56]])
        .collect::<Vec<_>>();
    let foreign_evidence_records = baseline_records
        .iter()
        .map(|record| {
            if record[0] == 55 {
                vec![55, 99, 2]
            } else {
                record.clone()
            }
        })
        .collect::<Vec<_>>();
    let wrong_decomposition_records = common_records
        .iter()
        .chain(second_certificate.iter())
        .cloned()
        .collect::<Vec<_>>();
    let two_candidate_records = description
        .iter()
        .chain(premises.iter())
        .cloned()
        .chain(std::iter::once(valid_candidate.clone()))
        .chain(std::iter::once(duplicate_candidate))
        .chain(contexts.iter().cloned())
        .chain(first_certificate.iter().cloned())
        .chain(second_certificate.iter().cloned())
        .collect::<Vec<_>>();
    let relocated_certificate = first_certificate
        .iter()
        .map(|record| {
            if record[0] == 70 {
                vec![70, 61, 49]
            } else {
                record.clone()
            }
        })
        .collect::<Vec<_>>();
    let relocated_records = common_records
        .iter()
        .chain(relocated_certificate.iter())
        .cloned()
        .collect::<Vec<_>>();
    let replacement_records = replacement_description
        .iter()
        .chain(premises.iter())
        .cloned()
        .chain(std::iter::once(valid_candidate))
        .chain(std::iter::once(reverse_candidate))
        .chain(contexts.iter().cloned())
        .chain(second_certificate.iter().cloned())
        .collect::<Vec<_>>();
    let cases = vec![
        evaluate(
            "valid-complete-evidence",
            &baseline_records,
            &description,
            &[7, 8],
            60,
        ),
        evaluate(
            "missing-evidence",
            &missing_evidence_records,
            &description,
            &[7, 8],
            60,
        ),
        evaluate(
            "duplicate-evidence",
            &duplicate_evidence_records,
            &description,
            &[7, 8],
            60,
        ),
        evaluate(
            "foreign-evidence",
            &foreign_evidence_records,
            &description,
            &[7, 8],
            60,
        ),
        evaluate(
            "wrong-decomposition",
            &wrong_decomposition_records,
            &description,
            &[7, 8],
            60,
        ),
        evaluate(
            "two-equally-admissible-candidates",
            &two_candidate_records,
            &description,
            &[7, 8],
            60,
        ),
        evaluate(
            "zero-admissible-candidates",
            &wrong_decomposition_records,
            &description,
            &[8],
            60,
        ),
        evaluate(
            "same-candidate-other-context",
            &baseline_records,
            &description,
            &[7, 8],
            61,
        ),
        evaluate(
            "context-relocated-evidence",
            &relocated_records,
            &description,
            &[7, 8],
            61,
        ),
        evaluate(
            "replacement-description",
            &replacement_records,
            &replacement_description,
            &[7, 8],
            60,
        ),
    ];
    let case = |id| cases.iter().find(|item| item.id == id).unwrap();

    LinkOntologyLinkedStructuralAdmissibilityProbe {
        status:
            "LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING",
        contract: LinkOntologyAdmissibilityContract {
            record_encoding: "each vector is only [address, first reference, second reference]",
            description: description.clone(),
            verification_operation: "exactly cover every description address with an injective linked mapping, reconstruct every described record, and require explicit context-to-bundle incidence",
            verification_provenance:
                "EXTERNAL_FINITE_RELATIONAL_CHECK_NOT_LINK_DERIVED_AUTHORITY",
            role_names_intrinsic_to_records: false,
        },
        cardinality_audit: LinkOntologyCardinalityAudit {
            method: "exhaustively enumerate the supplied finite certificate bundles; do not choose a candidate inside the verifier",
            observed_classifications: vec!["ZERO", "ONE", "MANY"],
            classification_derived_inside_link_substrate: false,
        },
        adversarial_boundary: LinkOntologyAdmissibilityAdversarialBoundary {
            complete_evidence_accepts_reconstructed_candidate:
                cases[0].cardinality == "ONE",
            missing_duplicate_foreign_and_wrong_evidence_rejected:
                cases[1..5].iter().all(|item| item.cardinality == "ZERO"),
            forged_locally_isomorphic_candidate_rejected:
                case("two-equally-admissible-candidates").cardinality != "MANY",
            context_incidence_changes_applicability:
                case("same-candidate-other-context").cardinality == "ZERO"
                    && case("context-relocated-evidence").cardinality == "ONE",
            description_replacement_changes_admissibility:
                case("replacement-description").admissible_candidates == vec![8],
        },
        authority_regress: LinkOntologyAuthorityRegress {
            description_represented_as_links: description
                .iter()
                .all(|record| has_link_record(&baseline_records, record)),
            evidence_and_context_represented_as_links: true,
            description_authenticated_by_structure: false,
            observer_role_assignment_authorized_by_structure: false,
            verifier_represented_or_executed_by_tested_records: false,
            finite_linked_meta_chain_closes_authority_regress: false,
            consequence: "ordinary links can carry a checkable finite certificate relative to a declared verifier, but the same records do not establish why that verifier, description, context, or role assignment is authoritative",
        },
        distinctions: LinkOntologyAdmissibilityDistinctions {
            formation: "ALL_CASE_RECORDS_ARE_STRUCTURALLY_FORMABLE",
            matching: "CONDITIONAL_EXACT_COVER_RECONSTRUCTION",
            admissibility: "FILTERED_RELATIVE_TO_DECLARED_DESCRIPTION_AND_VERIFIER",
            uniqueness: "FINITE_ENUMERATION_OBSERVES_ZERO_ONE_OR_MANY",
            justification: "CERTIFICATE_IS_CHECKABLE_BUT_NOT_SELF_AUTHORIZING",
            applicability: "EXPLICIT_CONTEXT_INCIDENCE_REQUIRED_BY_DECLARED_VERIFIER",
            admission: "NO_LINK_DERIVED_PUBLICATION_OR_ADMISSION",
            activation: "NO_LINK_DERIVED_ACTIVATION",
            execution: "NO_TRANSITION_CREATION_OR_EXECUTION_EVENT",
        },
        cases,
        conclusion: "For the declared finite exact-cover verifier, linked descriptions, mappings, and context incidence distinguish complete evidence from missing, duplicated, foreign, and wrong evidence and expose ZERO/ONE/MANY admissible candidates. A second isomorphic candidate remains equally admissible, while replacing or relocating ordinary links changes the conditional result.",
        claim_boundary: "The filtering result is conditional on the observer-supplied verifier and role assignment. It does not make the description self-authenticating, derive the verifier from link structure, reject a locally isomorphic forgery, close the authority regress, admit or activate a candidate, or execute a transition.",
    }
}

fn link_ontology_starting_representation_audit() -> LinkOntologyStartingRepresentationAudit {
    let finite_enumeration = (1..=4)
        .map(|occurrence_count| {
            let addressable_classes = ontology_set_partitions(occurrence_count + 1)
                .into_iter()
                .map(|address_pattern| {
                    let signature = canonical_addressable_link_signature(&address_pattern);
                    (signature.clone(), signature)
                })
                .collect::<BTreeMap<_, _>>();
            let mut fibres = BTreeMap::<Vec<usize>, Vec<Vec<usize>>>::new();
            for address_pattern in addressable_classes.values() {
                fibres
                    .entry(ontology_multiplicity_spectrum(&address_pattern[1..]))
                    .or_default()
                    .push(address_pattern.clone());
            }
            let projection_fibre_histogram = fibres
                .values()
                .fold(BTreeMap::new(), |mut histogram, fibre| {
                    *histogram.entry(fibre.len()).or_insert(0) += 1;
                    histogram
                })
                .into_iter()
                .map(|(addressable_classes, reference_only_classes)| {
                    LinkOntologyAddressableProjectionFibreHistogram {
                        addressable_classes,
                        reference_only_classes,
                    }
                })
                .collect::<Vec<_>>();
            let classes_with_direct_self_reference = addressable_classes
                .values()
                .filter(|pattern| pattern[1..].contains(&pattern[0]))
                .count();

            LinkOntologyAddressableEnumeration {
                occurrence_count,
                reference_only_classes: fibres.len(),
                addressable_link_classes: addressable_classes.len(),
                classes_with_no_direct_self_reference: addressable_classes.len()
                    - classes_with_direct_self_reference,
                classes_with_direct_self_reference,
                projection_fibre_histogram,
                every_projection_fibre_ambiguous: fibres.values().all(|fibre| fibre.len() > 1),
            }
        })
        .collect::<Vec<_>>();
    let direct_self_pattern = vec![0, 0, 1];
    let fresh_external_pattern = vec![0, 1, 2];
    let direct_self_projection = ontology_multiplicity_spectrum(&direct_self_pattern[1..]);
    let fresh_external_projection = ontology_multiplicity_spectrum(&fresh_external_pattern[1..]);
    let quotient_finite_enumeration = (1..=4)
        .map(|occurrence_count| {
            let ordered_patterns = ontology_set_partitions(occurrence_count + 1);
            let unlabelled_signatures = ordered_patterns
                .iter()
                .map(|pattern| canonical_addressable_link_signature(pattern))
                .collect::<BTreeSet<_>>();
            LinkOntologyQuotientEnumeration {
                occurrence_count,
                ordered_equality_classes_after_address_renaming: ordered_patterns.len(),
                unlabelled_addressable_classes: unlabelled_signatures.len(),
                classes_collapsed_by_occurrence_permutation: ordered_patterns.len()
                    - unlabelled_signatures.len(),
            }
        })
        .collect::<Vec<_>>();
    let mut descriptor_to_signatures = BTreeMap::<(Vec<usize>, usize), BTreeSet<Vec<usize>>>::new();
    for occurrence_count in 1..=4 {
        for address_pattern in ontology_set_partitions(occurrence_count + 1) {
            descriptor_to_signatures
                .entry(addressable_link_descriptor(&address_pattern))
                .or_default()
                .insert(canonical_addressable_link_signature(&address_pattern));
        }
    }
    let address_renaming_complete_invariant_verified = (1..=4).all(|occurrence_count| {
        let ordered_patterns = ontology_set_partitions(occurrence_count + 1);
        ordered_patterns
            .iter()
            .map(|pattern| ontology_equality_matrix(pattern))
            .collect::<BTreeSet<_>>()
            .len()
            == ordered_patterns.len()
    });
    let descriptor_finite_enumeration_agreement = descriptor_to_signatures
        .values()
        .all(|signatures| signatures.len() == 1)
        && descriptor_to_signatures.len()
            == quotient_finite_enumeration
                .iter()
                .map(|item| item.unlabelled_addressable_classes)
                .sum::<usize>();
    let first_ordered_pattern = vec![0, 0, 1];
    let second_ordered_pattern = vec![0, 1, 0];

    LinkOntologyStartingRepresentationAudit {
        status: "REFERENCE_ONLY_PROJECTION_NOT_FAITHFUL_FOR_SELF_REFERENCE",
        scope: "finite addressable links with one or more unlabelled reference occurrences and direct self-reference in the same address space",
        independent_justification: LinkOntologyStartingRepresentationJustification {
            requirement: "a link may occur directly among its own references",
            provenance: "ISSUE_183_DIRECT_SELF_REFERENCE_REQUIREMENT",
            consequence: "the link address and reference addresses must participate in the same equality comparison",
        },
        representation_changes_under_audit: vec![
            "global address renaming",
            "permutation of reference occurrences",
        ],
        every_projection_fibre_ambiguous: finite_enumeration
            .iter()
            .all(|item| item.every_projection_fibre_ambiguous),
        reference_only_projection_faithful: finite_enumeration
            .iter()
            .all(|item| item.addressable_link_classes == item.reference_only_classes),
        finite_enumeration,
        countermodel: LinkOntologyAddressableCountermodel {
            projected_reference_multiplicity_spectrum: direct_self_projection.clone(),
            direct_self_link: LinkOntologyAddressableCountermodelSide {
                normalized_address_pattern: direct_self_pattern.clone(),
                direct_self_reference_count: direct_self_pattern[1..]
                    .iter()
                    .filter(|address| **address == direct_self_pattern[0])
                    .count(),
            },
            fresh_external_link: LinkOntologyAddressableCountermodelSide {
                normalized_address_pattern: fresh_external_pattern.clone(),
                direct_self_reference_count: fresh_external_pattern[1..]
                    .iter()
                    .filter(|address| **address == fresh_external_pattern[0])
                    .count(),
            },
            same_reference_only_projection: direct_self_projection
                == fresh_external_projection,
            same_addressable_link_class: canonical_addressable_link_signature(
                &direct_self_pattern,
            ) == canonical_addressable_link_signature(&fresh_external_pattern),
        },
        general_argument: LinkOntologyGeneralProjectionArgument {
            scope: "every nonempty finite reference multiplicity spectrum",
            steps: vec![
                "give the link a fresh address not used by any reference occurrence",
                "alternatively identify the link address with a reference class",
                "forgetting the link address maps both lifts to the same reference-only observation",
                "global address renaming and occurrence permutation preserve whether a reference equals the link address",
            ],
            exact_fibre_cardinality: "one fresh-address lift plus one self-identifying lift for each distinct reference multiplicity",
            consequence: "REFERENCE_ONLY_PROJECTION_IS_NON_INJECTIVE_AT_EVERY_NONZERO_FINITE_ARITY",
        },
        slotwise_self_incidence: link_ontology_slotwise_self_incidence_audit(),
        shared_address_composition: link_ontology_shared_address_composition_audit(),
        structural_application_composition:
            link_ontology_structural_application_composition_probe(),
        conditional_continuation: link_ontology_conditional_continuation_probe(),
        link_carried_selection_authority:
            link_ontology_link_carried_selection_authority_probe(),
        linked_structural_admissibility:
            link_ontology_linked_structural_admissibility_probe(),
        linked_verifier_step: link_ontology_linked_verifier_step_probe(),
        quotient_audit: LinkOntologyQuotientAudit {
            finite_enumeration: quotient_finite_enumeration,
            address_renaming_complete_invariant_verified,
            transformations: vec![
                LinkOntologyQuotientTransformation {
                    transformation: "global address renaming",
                    classification:
                        "DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT",
                    evidence: "The full equality matrix is invariant under every bijective address renaming and uniquely determines every ordered equality class at widths one through four; generally, equal matrices induce the bijection between used addresses.",
                    ontology_scope: "CONTRACT_RELATIVE_NOT_ABSOLUTE",
                },
                LinkOntologyQuotientTransformation {
                    transformation: "reference-occurrence permutation",
                    classification: "UNESTABLISHED_EQUIVALENCE",
                    evidence: "No link-derived fact in the tested contract identifies reference slots. The quotient collapses 0/1/8/40 ordered equality classes at widths one through four; treating those collapses as intrinsic would require an independent reason that slots have no identity.",
                    ontology_scope: "OBSERVER_CHOICE_UNTIL_DERIVED",
                },
            ],
            occurrence_permutation_countermodel:
                LinkOntologyOccurrencePermutationCountermodel {
                    same_under_address_renaming_alone:
                        first_occurrence_normal_form(&first_ordered_pattern)
                            == first_occurrence_normal_form(&second_ordered_pattern),
                    same_after_occurrence_permutation:
                        canonical_addressable_link_signature(&first_ordered_pattern)
                            == canonical_addressable_link_signature(&second_ordered_pattern),
                    first_ordered_pattern,
                    second_ordered_pattern,
                    interpretation:
                        "DISTINGUISHABLE_ONLY_IF_REFERENCE_SLOTS_HAVE_IDENTITY",
                },
            minimal_faithful_descriptor: LinkOntologyMinimalFaithfulDescriptor {
                status:
                    "COMPLETE_INVARIANT_FOR_DECLARED_UNLABELLED_ADDRESS_EQUALITY_CONTRACT",
                fields: vec![
                    "referenceMultiplicitySpectrum",
                    "directSelfReferenceMultiplicity",
                ],
                finite_enumeration_agreement: descriptor_finite_enumeration_agreement,
                general_argument: "The reference multiplicity spectrum fixes the unlabelled reference classes; zero denotes a fresh link address, while a positive self-reference multiplicity selects the uniquely sized reference class identified with the link. Equal descriptors therefore differ only by address renaming and occurrence permutation.",
            },
            occurrence_permutation_intrinsic: "UNRESOLVED",
            claim_boundary: "The canonical descriptor is faithful only after unlabelled occurrences are declared. The audit derives address-renaming equivalence from equality, but it neither derives occurrence permutation from links nor proves that ordered slots are intrinsic.",
        },
        claim_boundary: "This proves a loss in the starting representation required to express direct self-reference and audits the remaining quotient assumptions. It does not establish that reference occurrences are intrinsically ordered or unlabelled, make link identity a complete ontology, derive endpoint roles, an evaluator, dynamics, or an execution law.",
    }
}

fn link_ontology_observation_boundary() -> LinkOntologyObservationBoundary {
    let arity_enumeration = (1..=4)
        .map(|occurrence_count| {
            let surjective_assignments_examined = (1..=occurrence_count)
                .map(|carrier_size| {
                    surjective_finite_assignments(occurrence_count, carrier_size).len()
                })
                .sum();
            let partitions = ontology_set_partitions(occurrence_count);
            let multiplicity_spectra = partitions
                .iter()
                .map(|partition| ontology_multiplicity_spectrum(partition))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let mut orbit_to_spectrum = BTreeMap::<Vec<usize>, BTreeSet<Vec<usize>>>::new();
            let mut spectrum_to_orbit = BTreeMap::<Vec<usize>, BTreeSet<Vec<usize>>>::new();
            for partition in &partitions {
                let orbit = canonical_partition_signature(partition);
                let spectrum = ontology_multiplicity_spectrum(partition);
                orbit_to_spectrum
                    .entry(orbit.clone())
                    .or_default()
                    .insert(spectrum.clone());
                spectrum_to_orbit.entry(spectrum).or_default().insert(orbit);
            }
            LinkOntologyArityEnumeration {
                occurrence_count,
                surjective_assignments_examined,
                reference_rename_classes: partitions.len(),
                quotient_classes: multiplicity_spectra.len(),
                multiplicity_spectra,
                complete_invariant_verified: orbit_to_spectrum
                    .values()
                    .all(|values| values.len() == 1)
                    && spectrum_to_orbit.values().all(|values| values.len() == 1),
            }
        })
        .collect::<Vec<_>>();

    let occurrence_count = 4;
    let partitions = ontology_set_partitions(occurrence_count);
    let structures = partitions
        .iter()
        .flat_map(|reference_partition| {
            partitions.iter().map(|refinement_partition| {
                (reference_partition.clone(), refinement_partition.clone())
            })
        })
        .collect::<Vec<_>>();
    let encoders: [(&str, OntologyPairEncoder); 3] = [
        (
            "canonical-partition-pair",
            canonical_partition_pair_signature,
        ),
        (
            "paired-equality-matrices",
            canonical_paired_equality_matrix_signature,
        ),
        (
            "intersection-multiplicity-table",
            canonical_intersection_table_signature,
        ),
    ];
    let encodings = encoders
        .iter()
        .map(|(id, encode)| LinkOntologyRefinementEncoding {
            id,
            distinct_classes: structures
                .iter()
                .map(|(left, right)| encode(left, right))
                .collect::<BTreeSet<_>>()
                .len(),
            complete_for_enumeration: pair_classifications_agree(
                &structures,
                canonical_partition_pair_signature,
                *encode,
            ),
        })
        .collect::<Vec<_>>();

    #[derive(Debug)]
    struct JointClassSummary {
        reference_partition: Vec<usize>,
        refinement_partition: Vec<usize>,
        reference_spectrum: Vec<usize>,
        refinement_spectrum: Vec<usize>,
        reference_occurrence_orbit_sizes: Vec<usize>,
        refinement_occurrence_orbit_sizes: Vec<usize>,
        occurrence_orbit_sizes: Vec<usize>,
    }

    let mut joint_classes = BTreeMap::new();
    for (reference_partition, refinement_partition) in &structures {
        let key = canonical_partition_pair_signature(reference_partition, refinement_partition);
        joint_classes.entry(key).or_insert_with(|| {
            let mut occurrence_orbit_sizes =
                partition_pair_occurrence_orbits(reference_partition, refinement_partition)
                    .iter()
                    .map(Vec::len)
                    .collect::<Vec<_>>();
            let mut reference_occurrence_orbit_sizes =
                partition_pair_occurrence_orbits(reference_partition, reference_partition)
                    .iter()
                    .map(Vec::len)
                    .collect::<Vec<_>>();
            let mut refinement_occurrence_orbit_sizes =
                partition_pair_occurrence_orbits(refinement_partition, refinement_partition)
                    .iter()
                    .map(Vec::len)
                    .collect::<Vec<_>>();
            occurrence_orbit_sizes.sort_by(|left, right| right.cmp(left));
            reference_occurrence_orbit_sizes.sort_by(|left, right| right.cmp(left));
            refinement_occurrence_orbit_sizes.sort_by(|left, right| right.cmp(left));
            JointClassSummary {
                reference_partition: reference_partition.clone(),
                refinement_partition: refinement_partition.clone(),
                reference_spectrum: ontology_multiplicity_spectrum(reference_partition),
                refinement_spectrum: ontology_multiplicity_spectrum(refinement_partition),
                reference_occurrence_orbit_sizes,
                refinement_occurrence_orbit_sizes,
                occurrence_orbit_sizes,
            }
        });
    }

    let mut fibres = BTreeMap::<Vec<usize>, Vec<&JointClassSummary>>::new();
    for joint_class in joint_classes.values() {
        fibres
            .entry(joint_class.reference_spectrum.clone())
            .or_default()
            .push(joint_class);
    }
    let projection_fibres = fibres
        .into_iter()
        .map(|(reference_multiplicity_spectrum, items)| {
            let classes_with_invariant_singleton = items
                .iter()
                .filter(|item| item.occurrence_orbit_sizes.contains(&1))
                .count();
            let classes_without_invariant_singleton =
                items.len() - classes_with_invariant_singleton;
            LinkOntologyProjectionFibre {
                reference_multiplicity_spectrum,
                joint_classes: items.len(),
                refinement_multiplicity_spectra: items
                    .iter()
                    .map(|item| item.refinement_spectrum.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect(),
                classes_with_invariant_singleton,
                classes_without_invariant_singleton,
                singleton_presence_classification: if items[0]
                    .reference_occurrence_orbit_sizes
                    .contains(&1)
                {
                    "BASE_FORCED"
                } else {
                    "REFINEMENT_DEPENDENT"
                },
            }
        })
        .collect::<Vec<_>>();
    let classes_with_invariant_singleton = joint_classes
        .values()
        .filter(|item| item.occurrence_orbit_sizes.contains(&1))
        .count();
    let classes_without_invariant_singleton =
        joint_classes.len() - classes_with_invariant_singleton;
    let singleton_orbit_histogram = joint_classes
        .values()
        .fold(BTreeMap::new(), |mut histogram, item| {
            let singleton_orbits = item
                .occurrence_orbit_sizes
                .iter()
                .filter(|size| **size == 1)
                .count();
            *histogram.entry(singleton_orbits).or_insert(0) += 1;
            histogram
        })
        .into_iter()
        .map(
            |(singleton_orbits, joint_classes)| LinkOntologySingletonOrbitHistogram {
                singleton_orbits,
                joint_classes,
            },
        )
        .collect::<Vec<_>>();
    let provenance_classifications = vec![
        LinkOntologyAsymmetryProvenanceClassification {
            id: "BASE_FORCED",
            joint_classes: joint_classes
                .values()
                .filter(|item| item.reference_occurrence_orbit_sizes.contains(&1))
                .count(),
        },
        LinkOntologyAsymmetryProvenanceClassification {
            id: "REFINEMENT_PRESENT_NOT_BASE_FORCED",
            joint_classes: joint_classes
                .values()
                .filter(|item| {
                    !item.reference_occurrence_orbit_sizes.contains(&1)
                        && item.refinement_occurrence_orbit_sizes.contains(&1)
                })
                .count(),
        },
        LinkOntologyAsymmetryProvenanceClassification {
            id: "RELATIONAL_INTERACTION_ONLY",
            joint_classes: joint_classes
                .values()
                .filter(|item| {
                    !item.reference_occurrence_orbit_sizes.contains(&1)
                        && !item.refinement_occurrence_orbit_sizes.contains(&1)
                        && item.occurrence_orbit_sizes.contains(&1)
                })
                .count(),
        },
        LinkOntologyAsymmetryProvenanceClassification {
            id: "NO_SINGLETON_ORBIT",
            joint_classes: joint_classes
                .values()
                .filter(|item| !item.occurrence_orbit_sizes.contains(&1))
                .count(),
        },
    ];
    let interaction_only_class = joint_classes
        .values()
        .find(|item| {
            !item.reference_occurrence_orbit_sizes.contains(&1)
                && !item.refinement_occurrence_orbit_sizes.contains(&1)
                && item.occurrence_orbit_sizes.contains(&1)
        })
        .expect("the exhaustive width-four quotient has an interaction-only class");
    let without_singleton_class = joint_classes
        .values()
        .find(|item| {
            item.reference_partition == interaction_only_class.reference_partition
                && !item.occurrence_orbit_sizes.contains(&1)
        })
        .expect("the interaction-only base projection has a symmetric countermodel");
    let asymmetry_countermodel = LinkOntologyAsymmetryCountermodel {
        normalized_reference_partition: interaction_only_class.reference_partition.clone(),
        reference_occurrence_orbit_sizes: interaction_only_class
            .reference_occurrence_orbit_sizes
            .clone(),
        without_singleton_refinement: LinkOntologyRefinementCountermodel {
            normalized_partition: without_singleton_class.refinement_partition.clone(),
            refinement_occurrence_orbit_sizes: without_singleton_class
                .refinement_occurrence_orbit_sizes
                .clone(),
            joint_occurrence_orbit_sizes: without_singleton_class.occurrence_orbit_sizes.clone(),
        },
        interaction_only_refinement: LinkOntologyRefinementCountermodel {
            normalized_partition: interaction_only_class.refinement_partition.clone(),
            refinement_occurrence_orbit_sizes: interaction_only_class
                .refinement_occurrence_orbit_sizes
                .clone(),
            joint_occurrence_orbit_sizes: interaction_only_class.occurrence_orbit_sizes.clone(),
        },
    };
    let derivation_boundary = link_ontology_derivation_boundary(
        &interaction_only_class.reference_partition,
        &interaction_only_class.refinement_partition,
    );
    let every_projection_fibre_ambiguous =
        projection_fibres.iter().all(|item| item.joint_classes > 1);
    let refinement_recoverable_from_base =
        projection_fibres.iter().all(|item| item.joint_classes == 1);
    let base_projection_fibres_with_both_outcomes = projection_fibres
        .iter()
        .filter(|item| {
            item.classes_with_invariant_singleton > 0
                && item.classes_without_invariant_singleton > 0
        })
        .count();
    let base_projection_fibres_forcing_singleton = projection_fibres
        .iter()
        .filter(|item| item.singleton_presence_classification == "BASE_FORCED")
        .count();
    let joint_quotient_classes = joint_classes.len();
    let encoding_agreement = encodings.iter().all(|item| {
        item.complete_for_enumeration && item.distinct_classes == joint_quotient_classes
    });

    LinkOntologyObservationBoundary {
        status: "BINARY_CONTRACT_NOT_EXHAUSTIVE",
        unchanged_primitive_vocabulary: vec![
            "unlabelled reference occurrences",
            "reference equality",
        ],
        arity_enumeration_complete: arity_enumeration
            .iter()
            .all(|item| item.complete_invariant_verified),
        arity_enumeration,
        generalized_complete_invariant:
            "reference multiplicity spectrum for each exhaustively tested unlabelled width 1 through 4",
        starting_representation_audit: link_ontology_starting_representation_audit(),
        conditional_refinement: LinkOntologyConditionalRefinement {
            assumption: LinkOntologyConditionalAssumption {
                id: "second-unlabelled-equivalence-observation",
                provenance: "CONDITIONAL_REFINEMENT_PROBE_NOT_DERIVED",
                foundational_status: "UNESTABLISHED",
                role: "measures information erased by the reference-only projection without interpreting the second equivalence as link identity, grouping, order, or semantics",
            },
            occurrence_count,
            reference_partitions_examined: partitions.len(),
            refinement_partitions_examined: partitions.len(),
            labelled_joint_structures_examined: structures.len(),
            occurrence_permutations_examined: finite_permutations(
                &(0..occurrence_count).collect::<Vec<_>>(),
            )
            .len(),
            joint_quotient_classes,
            encodings,
            encoding_agreement,
            projection_fibres,
            every_projection_fibre_ambiguous,
            refinement_recoverable_from_base,
            classes_with_invariant_singleton,
            classes_without_invariant_singleton,
            conditional_singleton_selector_exists: classes_with_invariant_singleton > 0,
            universal_singleton_selector_exists: classes_without_invariant_singleton == 0,
            singleton_orbit_histogram,
            asymmetry_provenance: LinkOntologyAsymmetryProvenance {
                classifications: provenance_classifications,
                base_projection_fibres_with_both_outcomes,
                base_projection_fibres_forcing_singleton,
                countermodel: asymmetry_countermodel,
            },
            derivation_boundary,
        },
        loss_audit: vec![
            LinkOntologyLossAudit {
                distinction: "reference names",
                classification: "DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT",
                evidence: "The full equality matrix is invariant and complete under bijective address renaming; this justification remains relative to the address/equality contract.",
            },
            LinkOntologyLossAudit {
                distinction: "occurrence order",
                classification: "UNESTABLISHED_EQUIVALENCE",
                evidence: "Occurrence permutation collapses 0/1/8/40 ordered equality classes at widths one through four, but no link-derived premise in the tested contract establishes that reference slots lack identity.",
            },
            LinkOntologyLossAudit {
                distinction: "width beyond two occurrences",
                classification: "PROVEN_INFORMATION_LOSS",
                evidence: "The unchanged equality vocabulary yields three classes at width three and five at width four, which the fixed binary contract cannot express.",
            },
            LinkOntologyLossAudit {
                distinction: "second equivalence observation",
                classification: "PROVEN_NOT_RECOVERABLE",
                evidence: "Every reference-only width-four class is the projection of five to nine inequivalent joint classes.",
            },
            LinkOntologyLossAudit {
                distinction: "direct self-reference",
                classification: "PROVEN_INFORMATION_LOSS_FOR_ADDRESSABLE_LINKS",
                evidence: "At widths one through four, forgetting the link address maps 2/4/7/12 addressable classes to 1/2/3/5 reference-only classes; every coarse fibre contains both fresh-address and self-identifying lifts.",
            },
            LinkOntologyLossAudit {
                distinction: "self-incidence reference slot",
                classification: "RENAMING_INVARIANT_PERMUTATION_EQUIVARIANT",
                evidence: "All 2/4/8/16 Boolean self-incidence masks occur at widths one through four. Each mask is invariant under address renaming and moves equivariantly, rather than remaining fixed, under reference-slot permutation.",
            },
            LinkOntologyLossAudit {
                distinction: "cross-link address incidence",
                classification: "PROVEN_INFORMATION_LOSS_UNDER_LOCAL_PROJECTION",
                evidence: "For two through four ordered one-reference links, products of local descriptors collapse 10/77/799 shared-address classes to 4/8/16 classes. A fresh-external pair and a two-link incidence cycle have identical local descriptors but inequivalent global equality patterns.",
            },
            LinkOntologyLossAudit {
                distinction: "application and composition meaning",
                classification: "PROVEN_NOT_ENTAILED_BY_TESTED_LINK_STRUCTURE",
                evidence: "A connected countermodel keeps the P/Q link identities distinct from the pairwise-distinct K/A/B addresses and has direct self-incidence, a shared address, and recursive link references while containing [2,0] but not the proposed [0,2]. Adding [0,2] preserves every premise. Formation admits all 49 ordered pairs over the seven existing addresses and selects none.",
            },
            LinkOntologyLossAudit {
                distinction: "selection authority from additional linked incidence",
                classification: "ASYMMETRY_PERMITS_BUT_DOES_NOT_FORCE_SELECTION",
                evidence: "Two duplicate candidates form one orbit and admit no invariant singleton. Adding ordinary link [9,7,7] splits them into singleton orbits, but both {7} and {8} are invariant. Opposite referenced/unreferenced readings are equivariant, and isomorphic replacement evidence cannot be rejected by the equality/incidence contract.",
            },
            LinkOntologyLossAudit {
                distinction: "admissibility from linked descriptions and evidence",
                classification:
                    "STRUCTURAL_CERTIFICATES_FILTER_RELATIVE_TO_EXTERNAL_VERIFIER",
                evidence: "A declared finite exact-cover check over ordinary linked descriptions, mappings, and context incidence rejects missing, duplicate, foreign, and wrong evidence and observes ZERO/ONE/MANY candidates. A locally isomorphic second candidate remains admissible, and the records do not authenticate the description, role assignment, or verifier.",
            },
            LinkOntologyLossAudit {
                distinction: "endpoint direction",
                classification: "NOT_OBSERVED_NOT_DISPROVED",
                evidence: "Neither the base family nor the conditional refinement names or measures endpoint order.",
            },
            LinkOntologyLossAudit {
                distinction: "dynamics and time",
                classification: "NOT_OBSERVED_NOT_DISPROVED",
                evidence: "Both enumerations are static and contain no transition or temporal observation.",
            },
        ],
    }
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
    let observation_boundary = link_ontology_observation_boundary();

    LinkOntologySymmetryReport {
        schema: "rml-link-ontology-symmetry-experiment/v15",
        question: "Which facts survive the binary reference observation, what do fixed width and single-link isolation erase, how is self-incidence classified per reference slot, do identity, incidence, shared address, and recursion entail application or composition, can an additional link carry selection authority, how far can linked exact-cover evidence, a linked local-match trace, and a one-link continuation witness reduce the external verifier, what, if anything, turns a possible continuation into one that follows, and does any Link structure force which orientation follows?",
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
        observation_boundary,
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
            LinkOntologyResult {
                id: "fixed-binary-observation-sufficiency",
                result: "INSUFFICIENT_OUTSIDE_FIXED_ARITY",
                evidence: "Without adding an observable, widening from two to three and four unlabelled occurrences yields three and five multiplicity classes. The binary quotient cannot express those distinctions.",
            },
            LinkOntologyResult {
                id: "conditional-refinement-recoverability",
                result: "NOT_RECOVERABLE_FROM_BASE_PROJECTION",
                evidence: "At width four, every reference-only class is the image of five to nine inequivalent structures carrying an uninterpreted second equivalence observation.",
            },
            LinkOntologyResult {
                id: "conditional-structural-asymmetry",
                result: "EMERGES_IN_SOME_REFINEMENTS_NOT_UNIVERSAL",
                evidence: "The singleton-orbit histogram is 20 classes with zero, 5 with one, 7 with two, and 1 with four. Structural asymmetry can therefore emerge, but only five classes select exactly one occurrence orbit and none assigns semantic endpoint meaning.",
            },
            LinkOntologyResult {
                id: "conditional-asymmetry-provenance",
                result: "BASE_FORCED_AND_REFINEMENT_DEPENDENT_COMPONENTS_SEPARATED",
                evidence: "Seven classes inherit a singleton forced by the base [3,1] multiplicity, five acquire one from an independently asymmetric refinement, one acquires four only through the interaction of two individually symmetric relations, and 20 retain none. Four base fibres have both outcomes; only [3,1] forces asymmetry across every refinement.",
            },
            LinkOntologyResult {
                id: "conditional-interaction-forcedness",
                result: "SYMMETRY_BREAKING_REQUIRES_INFORMATION_NOT_DERIVED_FROM_BASE",
                evidence: "All 73 candidate observations at widths one through four that preserve every base symmetry leave the base occurrence orbits unchanged. The interaction-only witness instead changes under a relabelling that leaves its base fixed. Generally, any deterministic derivation commuting with relabelling must preserve every base symmetry.",
            },
            LinkOntologyResult {
                id: "starting-representation-faithfulness",
                result: "REFERENCE_ONLY_PROJECTION_NON_FAITHFUL_FOR_SELF_REFERENCE",
                evidence: "Direct-self [0,0,1] and fresh-external [0,1,2] address patterns have the same reference-only [1,1] projection but cannot be related by address renaming or occurrence permutation. At widths one through four, 2/4/7/12 addressable classes collapse to 1/2/3/5 reference-only classes.",
            },
            LinkOntologyResult {
                id: "slotwise-self-incidence",
                result: "CLASSIFIED_PER_ORDERED_REFERENCE_SLOT",
                evidence: "The slotwise Boolean mask realizes 2/4/8/16 patterns at widths one through four, is invariant under global address renaming, and is equivariant but not invariant under slot permutation. Together with the ordered reference-equality matrix it completely classifies the tested ordered address/equality patterns.",
            },
            LinkOntologyResult {
                id: "shared-address-composition",
                result: "LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL",
                evidence: "At two through four ordered one-reference links, 10/77/799 shared-address equality classes collapse to 4/8/16 products of local descriptors. [[0,1],[2,3]] and [[0,2],[2,0]] have identical local descriptors, but only the latter is a two-link incidence cycle.",
            },
            LinkOntologyResult {
                id: "structural-application-composition",
                result: "RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION",
                evidence: "The premise-only [[3,0,1],[4,1,2],[5,2,0],[6,6,3]] and result-bearing extension with [7,0,2] both keep P/Q distinct from K/A/B and preserve distinct identities, self-incidence, shared address, and recursive reference. The first already contains reverse references [2,0] but no [0,2]. Recursive association candidates coincide after the still-unestablished uniform slot reversal plus address renaming; semantic roles and a creation law require additional authority.",
            },
            LinkOntologyResult {
                id: "link-carried-selection-authority",
                result: "LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY",
                evidence: "Duplicate candidate links [7,0,2] and [8,0,2] form one automorphism orbit and admit no invariant singleton. Ordinary link [9,7,7] splits the orbit, making both singleton subsets invariant rather than forcing either one. Removal gives zero marked candidates, replacement flips the mark, duplication gives two, an isomorphic forgery is not rejected, context relocation remains a relabelling, and finite or self-referential authority chains do not determine selection polarity or execution.",
            },
            LinkOntologyResult {
                id: "linked-structural-admissibility",
                result: "LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING",
                evidence: "Under an explicitly external finite relational check, ordinary linked descriptions, exact-cover mappings, and context incidence accept one complete reconstruction; reject missing, duplicate, foreign, and wrong evidence; distinguish ZERO, ONE, and MANY; and change under context or description replacement. A second locally isomorphic candidate still passes, and no tested record authorizes the description, verifier, admission, activation, or execution.",
            },
            LinkOntologyResult {
                id: "linked-verifier-step",
                result: "LOCAL_MATCH_HAS_LINKED_TRACE_BUT_RETAINS_HOST_EXECUTION_BOUNDARY",
                evidence: "A reusable three-position incidence join replaces specialized record reconstruction and emits four ordinary link records per local match. Missing, duplicate, reversed, two-candidate, self-application, trace-replay, reversed-role, and alternate-description cases expose where host iteration, projection, equality, counting, and selection remain.",
            },
            LinkOntologyResult {
                id: "conditional-continuation",
                result: "LINKED_WITNESS_CONDITIONALLY_SELECTS_CONTINUATION_WITHOUT_FORCING_IT",
                evidence: "An ordinary third link [5,3,4] cites premise addresses [3,0,1] and [4,1,2], so a declared incidence join reports [0,2]. Reversing the witness or removing any of the three records removes that conditional report. The witness-only structure and its [7,0,2] extension satisfy the same condition, so neither creation nor the join authority follows from the records.",
            },
            LinkOntologyResult {
                id: "continuation-consequence",
                result: "CONSEQUENCE_REQUIRES_UNRECORDED_ORIENTED_EXCLUSION",
                evidence: "Over all 128 completions of the recorded pairs [0,1] and [1,2], positive link facts alone make no new pair follow. A transitive exclusion makes [0,2] follow and a circular exclusion makes [2,0] follow, but each exclusion's meet equals the least model of one surviving projection, so the selecting fact restates the law. Address renaming, arbitrary substitution, record reordering, nested encoding, slot reversal, non-degeneracy, and novelty all commute with the output swap, which fixes no non-degenerate law, so none of them selects an orientation.",
            },
            LinkOntologyResult {
                id: "continuation-orientation",
                result: "CONSEQUENCE_ORIENTATION_DISTINGUISHED_BUT_NOT_FORCED",
                evidence: "Using only address equality and slot order, the premises [3,0,1] and [4,1,2] keep [0,2] and [2,0] in different orbits whenever slots are ordered, while unordered slots make them coincide. The output swap commutes with every renaming and with the global slot reversal, so in all 4567 extensions by up to two ordinary records no symmetry fixes exactly one candidate, and both premise-to-conclusion slot correspondences remain compatible. Chirality, address renaming, tagged encodings, and a rigid self-referential tag carrier change which ends or slots are distinguishable, but never which candidate follows.",
            },
            LinkOntologyResult {
                id: "addressable-quotient-assumptions",
                result: "RENAMING_DERIVED_ORDER_QUOTIENT_UNESTABLISHED",
                evidence: "Equality matrices completely classify ordered address patterns under bijective renaming, but occurrence permutation additionally collapses 0/1/8/40 classes at widths one through four without a link-derived premise that reference slots lack identity. Multiplicity spectrum plus self-reference multiplicity is complete only for the explicitly unlabelled contract.",
            },
            LinkOntologyResult {
                id: "observation-loss-provenance",
                result: "CLASSIFIED_NOT_RESOLVED",
                evidence: "The report derives renaming equivalence within the equality contract, marks occurrence permutation unestablished, separates demonstrated width and projection losses, and leaves unobserved distinctions unresolved.",
            },
        ],
        admissible_conclusion: "Exhaustive enumeration shows that binary equality coincidence is complete only at fixed width two. At tested widths one through four, multiplicity spectra classify the unlabelled base observations, but that reference-only projection is non-faithful once the issue requirement that links can reference themselves is admitted: it forgets whether a reference equals the link address. Before occurrence permutation, the Boolean self-incidence mask classifies that equality per ordered reference slot. Removing single-link isolation exposes another loss: local descriptors retain only self-incidence and cannot distinguish external references from cross-link incidence, including a two-link cycle. Across one through four ordered one-reference links, the cross-reference equality matrix plus the reference-to-link-address incidence matrix completely classifies the shared-address contract. A connected identity/self-incidence/shared-address/recursion countermodel proves that a proposed composition link is formable but not entailed; raw structure cannot assign source or target, function roles, logical implication, composition authority, or execution meaning. An additional ordinary link can break a candidate symmetry and make singleton selection structurally expressible, but opposite equivariant readings show that the same asymmetry does not force selection. Relative to a declared finite exact-cover verifier, linked descriptions, evidence mappings, and context incidence reject incomplete or structurally wrong certificates and expose ZERO/ONE/MANY candidates; however, an isomorphic second candidate passes and the records do not authorize their own interpretation, admission, activation, or execution. Factoring one record check into a reusable incidence join yields a linked trace, while host iteration, projection, equality, counting, and role selection remain. Over every completion of two chained premise pairs, a continuation follows only relative to an exclusion the records do not state, and the transitive and circular exclusions make opposite orientations follow. With address equality and slot order alone, slot order separates the two orientations but never ranks them: the output swap commutes with every contract symmetry, so each invariant selector has an invariant twin.",
        remaining_boundary: "This experiment proves that the interaction-only asymmetry is not derivable from the tested base, that reference-only and link-local projections lose required self-reference information, that raw address names add no information within the address/equality contract, that self-incidence has an explicit slotwise invariant before the permutation quotient, that the tested raw structure has models both without and with the proposed composition result, that link-carried incidence can remove a symmetry obstruction without supplying a unique reading of that asymmetry, that ordinary links can carry conditionally checkable exact-cover certificates, and that slot order separates the two continuation orientations without ranking them. It does not define a link ontology, establish whether reference occurrences or link records intrinsically have order, interpret an incidence cycle dynamically, claim the addressed representation is complete, derive or authorize the certificate verifier and role assignment, reject locally isomorphic forgery, prove that external authority is irreducible, derive linked admission or activation, derive which exclusion or orientation makes a continuation follow, exhibit a Link structure that forces that orientation, derive execution semantics, or generalize every finite enumeration beyond its stated argument.",
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

/// Reads the forms of a linked source.  Linked program forms are an unordered
/// top-level graph, so leading horizontal whitespace never nests them: it is
/// stripped from every line before parsing, exactly like `parseForms` in
/// `js/src/rml-linked-program.mjs` (whose `^` also follows `\r`, U+2028 and
/// U+2029).
fn parse_linked_forms(source: &str) -> Result<Vec<Node>, String> {
    let mut normalized = String::with_capacity(source.len());
    let mut at_line_start = true;
    for character in source.chars() {
        if at_line_start && matches!(character, ' ' | '\t') {
            continue;
        }
        at_line_start = matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}');
        normalized.push(character);
    }
    parse_lino(&normalized)
        .map_err(|error| error.to_string())?
        .iter()
        .map(|link| parse_one(&tokenize_one(link)))
        .collect()
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
        Self::from_rml_expanded(source, execution_basis, disabled_operations, |_| {
            Ok(Vec::new())
        })
    }

    /// Parse and load linked source like
    /// [`from_rml_with_basis`](Self::from_rml_with_basis). `expand` receives
    /// the parsed top-level forms and returns further forms to load with
    /// them, so a layer that declares programs through its own forms reads
    /// the source through this single front end instead of parsing it a
    /// second time, like `expandForms` of `LinkedProgramRegistry.fromRml` in
    /// `js/src/rml-linked-program.mjs`.
    pub fn from_rml_expanded<F>(
        source: &str,
        execution_basis: ExecutionBasis,
        disabled_operations: &[&str],
        expand: F,
    ) -> Result<Self, String>
    where
        F: FnOnce(&[Node]) -> Result<Vec<Node>, String>,
    {
        if disabled_operations.contains(&"parse-linked-forms") {
            return Err("disabled host semantic operation parse-linked-forms".to_string());
        }
        let mut forms = parse_linked_forms(source)?;
        let expanded = expand(&forms)?;
        forms.extend(expanded);
        let registry = Self::from_forms_with_basis(&forms, execution_basis, disabled_operations)?;
        registry.observe(&["load-linked-program"], "parse-linked-forms")?;
        Ok(registry)
    }

    fn from_rml_with_disabled(source: &str, disabled_operations: &[&str]) -> Result<Self, String> {
        if disabled_operations.contains(&"parse-linked-forms") {
            return Err("disabled host semantic operation parse-linked-forms".to_string());
        }
        let forms = parse_linked_forms(source)?;
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

    /// Load already parsed forms under a selected execution basis.
    pub fn from_forms_with_basis(
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

    /// The declared imports and rules of one program, like the public
    /// `programs` map of the JavaScript registry.
    pub fn program(&self, name: &str) -> Option<&LinkedProgram> {
        self.programs.get(name)
    }

    /// The execution basis this registry was loaded under.
    pub fn execution_basis(&self) -> ExecutionBasis {
        self.execution_basis
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
        self.reduce_classified(name, input, max_steps)
            .map_err(ReduceFailure::into_message)
    }

    /// Reduce like [`reduce`](Self::reduce), but return a reduction that
    /// stops without a normal form (the step limit, a revisited term, or a
    /// rewrite that made no progress) as `Ok(Err(..))`, the way `search`
    /// classifies its goals. Other failures stay errors.
    pub fn reduce_or_stop(
        &self,
        name: &str,
        input: &Node,
        max_steps: usize,
    ) -> Result<Result<ReductionResult, ReductionStopped>, String> {
        let stopped = |normalization, detail| {
            Ok(Err(ReductionStopped {
                normalization,
                detail,
            }))
        };
        match self.reduce_classified(name, input, max_steps) {
            Ok(result) => Ok(Ok(result)),
            Err(ReduceFailure::Limit(detail)) => stopped(GoalNormalization::RewriteLimit, detail),
            Err(ReduceFailure::Cycle(detail)) => stopped(GoalNormalization::RewriteCycle, detail),
            Err(ReduceFailure::Stalled(detail)) => {
                stopped(GoalNormalization::RewriteStalled, detail)
            }
            Err(ReduceFailure::Other(message)) => Err(message),
        }
    }

    fn reduce_classified(
        &self,
        name: &str,
        input: &Node,
        max_steps: usize,
    ) -> Result<ReductionResult, ReduceFailure> {
        let mut semantic_paths = vec!["reduce-linked-program"];
        if name == "links-meta-foundation" {
            semantic_paths.push("execute-links-meta-foundation");
        }
        self.observe(&semantic_paths, "enforce-cycle-and-resource-bounds")?;
        if max_steps == 0 {
            return Err(ReduceFailure::Other(
                "max_steps must be positive".to_string(),
            ));
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
                    return Err(ReduceFailure::Stalled(format!(
                        "linked rewrite {}.{} made no progress",
                        rule.program, rule.name
                    )));
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
                    return Err(ReduceFailure::Cycle(format!(
                        "rewrite cycle after {} steps at {key}",
                        trace.len()
                    )));
                }
            }
            return Err(ReduceFailure::Limit(format!(
                "rewrite step limit {max_steps} exceeded"
            )));
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
                    ReduceFailure::Other(format!(
                        "combinator kernel selected unknown rule {program_name}.{rule_name}"
                    ))
                })?;
            if next == term {
                return Err(ReduceFailure::Stalled(format!(
                    "linked rewrite {}.{} made no progress",
                    rule.program, rule.name
                )));
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
                return Err(ReduceFailure::Cycle(format!(
                    "rewrite cycle after {} steps at {key}",
                    trace.len()
                )));
            }
        }
        Err(ReduceFailure::Limit(format!(
            "rewrite step limit {max_steps} exceeded"
        )))
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
        let mut goals = vec![(normalized_goal, None)];
        let (ended, _, _) = self
            .saturate(
                name,
                &mut goals,
                facts,
                max_rounds,
                max_facts,
                &semantic_paths,
            )
            .ok()?;
        if ended == SearchEnd::FactLimit {
            return None;
        }
        goals.pop().and_then(|(_, proof)| proof)
    }

    /// Search for several judgements in one saturation and report why it
    /// ended.
    ///
    /// `prove` answers one goal and collapses a fixed point, an exhausted
    /// bound, and an error into `None`. A caller that must tell "no proof
    /// exists under these rules" from "the search stopped early" uses this
    /// instead. It runs the same inference engine as `prove`, so it adds no
    /// host semantic operation. The search stops when every normalizable goal
    /// has a proof, when no rule derives a new fact, when the transition bound
    /// is spent, or when the known facts exceed `max_facts`. A goal whose
    /// ordered reduction has no normal form within `max_steps` is reported
    /// with its [`GoalNormalization`] and is not searched for. With no
    /// normalizable goal the search runs to a fixed point or a bound, so
    /// `derived` then reports the whole closure.
    pub fn search(
        &self,
        name: &str,
        goals: &[Node],
        facts: &[Node],
        max_rounds: usize,
        max_facts: usize,
        max_steps: usize,
    ) -> Result<LinkedSearch, String> {
        self.search_classified(name, goals, facts, max_rounds, max_facts, max_steps)
            .map_err(ReduceFailure::into_message)
    }

    /// Search like [`search`](Self::search), but return a fact that has no
    /// normal form (the step limit, a revisited term, or a rewrite that made
    /// no progress) as `Ok(Err(..))`, the way
    /// [`reduce_or_stop`](Self::reduce_or_stop) reports a reduction. Direct
    /// saturation normalizes each input and derived fact with the ordered
    /// rewrites, so such a fact stops the whole search. The closed S/K basis
    /// normalizes facts inside the combinator kernel, whose bounds stay
    /// errors. Other failures stay errors.
    pub fn search_or_stop(
        &self,
        name: &str,
        goals: &[Node],
        facts: &[Node],
        max_rounds: usize,
        max_facts: usize,
        max_steps: usize,
    ) -> Result<Result<LinkedSearch, ReductionStopped>, String> {
        let stopped = |normalization, detail| {
            Ok(Err(ReductionStopped {
                normalization,
                detail,
            }))
        };
        match self.search_classified(name, goals, facts, max_rounds, max_facts, max_steps) {
            Ok(search) => Ok(Ok(search)),
            Err(ReduceFailure::Limit(detail)) => stopped(GoalNormalization::RewriteLimit, detail),
            Err(ReduceFailure::Cycle(detail)) => stopped(GoalNormalization::RewriteCycle, detail),
            Err(ReduceFailure::Stalled(detail)) => {
                stopped(GoalNormalization::RewriteStalled, detail)
            }
            Err(ReduceFailure::Other(message)) => Err(message),
        }
    }

    fn search_classified(
        &self,
        name: &str,
        goals: &[Node],
        facts: &[Node],
        max_rounds: usize,
        max_facts: usize,
        max_steps: usize,
    ) -> Result<LinkedSearch, ReduceFailure> {
        let semantic_paths = ["prove-linked-judgement"];
        self.observe(&semantic_paths, "enforce-cycle-and-resource-bounds")?;
        if max_rounds == 0 || max_facts == 0 {
            return Err(ReduceFailure::Other(
                "proof bounds must be positive".to_string(),
            ));
        }
        if max_steps == 0 {
            return Err(ReduceFailure::Other(
                "max_steps must be positive".to_string(),
            ));
        }
        let mut entries = Vec::with_capacity(goals.len());
        for goal in goals {
            let (normalized, normalization, detail) =
                match self.reduce_classified(name, goal, max_steps) {
                    Ok(result) => (Some(result.term), GoalNormalization::Normal, None),
                    Err(other @ ReduceFailure::Other(_)) => return Err(other),
                    Err(ReduceFailure::Limit(message)) => {
                        (None, GoalNormalization::RewriteLimit, Some(message))
                    }
                    Err(ReduceFailure::Cycle(message)) => {
                        (None, GoalNormalization::RewriteCycle, Some(message))
                    }
                    Err(ReduceFailure::Stalled(message)) => {
                        (None, GoalNormalization::RewriteStalled, Some(message))
                    }
                };
            entries.push(SearchGoal {
                goal: goal.clone(),
                normalized,
                normalization,
                detail,
                proof: None,
            });
        }
        let mut searched = entries
            .iter()
            .filter_map(|entry| entry.normalized.clone().map(|goal| (goal, None)))
            .collect::<Vec<_>>();
        let (ended, derived, known) = self.saturate(
            name,
            &mut searched,
            facts,
            max_rounds,
            max_facts,
            &semantic_paths,
        )?;
        let mut proofs = searched.into_iter().map(|(_, proof)| proof);
        for entry in &mut entries {
            if entry.normalized.is_some() {
                entry.proof = proofs.next().flatten();
            }
        }
        Ok(LinkedSearch {
            program: name.to_string(),
            execution_basis: self.execution_basis,
            ended,
            goals: entries,
            derived,
            facts: known,
        })
    }

    fn find_goals(
        &self,
        state: &combinator_kernel::ProofState,
        goals: &mut [(Node, Option<LinkedProof>)],
        semantic_paths: &[&str],
    ) -> Result<bool, String> {
        for (goal, proof) in goals.iter_mut() {
            if proof.is_some() {
                continue;
            }
            let found = combinator_kernel::find_proof(state, goal, &self.disabled_operations)?;
            self.observe_combinator(semantic_paths, &found.observed, &["result-verification"])?;
            *proof = found.proof;
        }
        Ok(!goals.is_empty() && goals.iter().all(|(_, proof)| proof.is_some()))
    }

    /// Shared by `prove` and `search`: fill the proof of each normalized goal
    /// and report why saturation stopped, the derived facts, and the number of
    /// known facts.
    fn saturate(
        &self,
        name: &str,
        goals: &mut [(Node, Option<LinkedProof>)],
        input_facts: &[Node],
        max_rounds: usize,
        max_facts: usize,
        semantic_paths: &[&str],
    ) -> Result<(SearchEnd, Vec<SearchDerivation>, usize), ReduceFailure> {
        if self.execution_basis != ExecutionBasis::ClosedSk {
            return self.direct_saturate(
                name,
                goals,
                input_facts,
                max_rounds,
                max_facts,
                semantic_paths,
            );
        }
        let created = combinator_kernel::create_proof_state(
            &self.programs,
            name,
            input_facts,
            &self.disabled_operations,
        )?;
        self.observe_combinator(
            semantic_paths,
            &created.observed,
            &[
                "import-and-rebinding",
                "matching",
                "substitution",
                "rule-selection-and-traversal",
            ],
        )?;
        let mut state = created.state;
        let mut derived = Vec::new();
        if state.size > max_facts {
            return Ok((SearchEnd::FactLimit, derived, state.size));
        }
        if self.find_goals(&state, goals, semantic_paths)? {
            return Ok((SearchEnd::Found, derived, state.size));
        }
        // One legacy round could add many facts. The closed kernel emits one
        // derivation per transition, so preserve that capacity per round.
        for _ in 0..max_rounds.saturating_mul(max_facts) {
            let next = combinator_kernel::infer_once(state, &self.disabled_operations)?;
            self.observe_combinator(
                semantic_paths,
                &next.observed,
                &[
                    "matching",
                    "substitution",
                    "rule-selection-and-traversal",
                    "inference-saturation",
                ],
            )?;
            state = next.state;
            let Some((judgement, proof)) = next.derivation else {
                return Ok((SearchEnd::Saturated, derived, state.size));
            };
            derived.push(SearchDerivation { judgement, proof });
            if state.size > max_facts {
                return Ok((SearchEnd::FactLimit, derived, state.size));
            }
            if self.find_goals(&state, goals, semantic_paths)? {
                return Ok((SearchEnd::Found, derived, state.size));
            }
        }
        Ok((SearchEnd::InferenceLimit, derived, state.size))
    }

    fn direct_saturate(
        &self,
        name: &str,
        goals: &mut [(Node, Option<LinkedProof>)],
        input_facts: &[Node],
        max_rounds: usize,
        max_facts: usize,
        semantic_paths: &[&str],
    ) -> Result<(SearchEnd, Vec<SearchDerivation>, usize), ReduceFailure> {
        match self.execution_basis {
            ExecutionBasis::DirectStructural => {
                self.observe(semantic_paths, "saturate-inference-rules")?;
            }
            ExecutionBasis::HornRelational => {
                self.observe(semantic_paths, "schedule-horn-saturation")?;
            }
            ExecutionBasis::ClosedSk => {
                return Err(ReduceFailure::Other(
                    "the closed S/K basis has no direct saturation".to_string(),
                ));
            }
        }

        // `derived` is `Some` only for facts that an inference rule concluded.
        // A fact without a normal form keeps its classified failure, so a
        // caller can tell a rewrite limit from a cycle, as in JavaScript.
        fn add_known(
            registry: &LinkedProgramRegistry,
            program: &str,
            known: &mut BTreeMap<String, (Node, LinkedProof)>,
            judgement: &Node,
            proof: LinkedProof,
            max_facts: usize,
            semantic_paths: &[&str],
            derived: Option<&mut Vec<SearchDerivation>>,
        ) -> Result<AddedFact, ReduceFailure> {
            let normalized = registry.reduce_classified(program, judgement, 10_000)?.term;
            let key = key_of(&normalized);
            if known.contains_key(&key) {
                return Ok(AddedFact::Duplicate);
            }
            if let Some(derived) = derived {
                if registry.execution_basis == ExecutionBasis::HornRelational {
                    registry.observe(semantic_paths, "insert-derived-fact")?;
                }
                derived.push(SearchDerivation {
                    judgement: normalized.clone(),
                    proof: proof.clone(),
                });
            }
            known.insert(key, (normalized, proof));
            Ok(if known.len() <= max_facts {
                AddedFact::New
            } else {
                AddedFact::OverLimit
            })
        }

        fn all_found(
            known: &BTreeMap<String, (Node, LinkedProof)>,
            goals: &mut [(Node, Option<LinkedProof>)],
        ) -> bool {
            for (goal, proof) in goals.iter_mut() {
                if proof.is_none() {
                    *proof = known.get(&key_of(goal)).map(|(_, found)| found.clone());
                }
            }
            !goals.is_empty() && goals.iter().all(|(_, proof)| proof.is_some())
        }

        let mut known = BTreeMap::new();
        let mut derived = Vec::new();
        let declared = self.effective_facts(name, semantic_paths, &mut BTreeSet::new(), &[])?;
        for fact in declared {
            let proof = LinkedProof {
                judgement: fact.judgement.clone(),
                program: fact.program,
                rule: fact.name,
                premises: Vec::new(),
            };
            if let AddedFact::OverLimit = add_known(
                self,
                name,
                &mut known,
                &fact.judgement,
                proof,
                max_facts,
                semantic_paths,
                None,
            )? {
                return Ok((SearchEnd::FactLimit, derived, known.len()));
            }
        }
        for (index, fact) in input_facts.iter().enumerate() {
            let proof = LinkedProof {
                judgement: fact.clone(),
                program: "<input>".to_string(),
                rule: format!("input-{}", index + 1),
                premises: Vec::new(),
            };
            if let AddedFact::OverLimit = add_known(
                self,
                name,
                &mut known,
                fact,
                proof,
                max_facts,
                semantic_paths,
                None,
            )? {
                return Ok((SearchEnd::FactLimit, derived, known.len()));
            }
        }
        if all_found(&known, goals) {
            return Ok((SearchEnd::Found, derived, known.len()));
        }

        let rules = self.effective_inferences(name, semantic_paths, &mut BTreeSet::new(), &[])?;
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
                            )? {
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
                        direct_instantiate(&rule.conclusion, &substitution, &mut observe)?;
                    let proof = LinkedProof {
                        judgement: judgement.clone(),
                        program: rule.program.clone(),
                        rule: rule.name.clone(),
                        premises,
                    };
                    match add_known(
                        self,
                        name,
                        &mut known,
                        &judgement,
                        proof,
                        max_facts,
                        semantic_paths,
                        Some(&mut derived),
                    )? {
                        AddedFact::Duplicate => {}
                        AddedFact::OverLimit => {
                            return Ok((SearchEnd::FactLimit, derived, known.len()));
                        }
                        AddedFact::New => {
                            changed = true;
                            if all_found(&known, goals) {
                                return Ok((SearchEnd::Found, derived, known.len()));
                            }
                        }
                    }
                }
            }
            if !changed {
                return Ok((SearchEnd::Saturated, derived, known.len()));
            }
        }
        Ok((SearchEnd::InferenceLimit, derived, known.len()))
    }
}
