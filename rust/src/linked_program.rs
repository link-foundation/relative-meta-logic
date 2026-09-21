//! Theory-agnostic execution of formal systems represented as LiNo links.
//!
//! The machine implements only structural pattern matching, substitution,
//! ordered rewriting, and bounded rule saturation. Object-language semantics
//! live in linked forms and never dispatch through theory-specific Rust
//! callbacks.

use crate::{key_of, parse_lino, parse_one, tokenize_one, Node};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

const IMPLEMENTED_HOST_SEMANTIC_OPERATIONS: &[&str] = &[
    "parse-linked-forms",
    "compare-link-structure",
    "bind-pattern-variables",
    "substitute-bound-structures",
    "select-and-traverse-rewrite-rules",
    "enforce-cycle-and-resource-bounds",
    "resolve-and-rebind-program-imports",
    "saturate-inference-rules",
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

const PREVIOUS_METRIC_REVISION: &str = "e2e9f7b2a87d4b128bb736d693d5512509974860";

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
    pub minimization_experiments: Vec<BootstrapMinimizationExperiment>,
    pub trust_graph: BootstrapTrustGraph,
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

#[derive(Debug, Clone, PartialEq)]
pub struct BootstrapRuntimeTrace {
    pub schema: &'static str,
    pub observed_paths: Vec<String>,
    pub observed_operations: Vec<String>,
    pub observed_path_segments: Vec<BootstrapObservedPathSegment>,
}

#[derive(Debug, Clone, Default)]
struct BootstrapRuntimeTraceState {
    observed_paths: BTreeSet<String>,
    observed_operations: BTreeSet<String>,
    observed_path_segments: BTreeSet<BootstrapObservedPathSegment>,
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
    pub removal_classifications: Vec<&'static str>,
    pub current: BootstrapCurrentMetrics,
    pub host_semantic_layers: Vec<BootstrapHostSemanticLayer>,
    pub removal_experiments: Vec<BootstrapRemovalExperiment>,
    pub host_linked_duplications: Vec<BootstrapHostLinkedDuplication>,
    pub linked_self_hosting_capabilities: Vec<BootstrapLinkedCapability>,
    pub runtime_trust_graph_coverage: BootstrapRuntimeTrustGraphCoverage,
    pub comparison: Vec<BootstrapMetricComparison>,
}

#[derive(Debug, Clone, Default)]
pub struct LinkedProgramRegistry {
    programs: BTreeMap<String, LinkedProgram>,
    disabled_operations: BTreeSet<String>,
    runtime_trace: RefCell<BootstrapRuntimeTraceState>,
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

fn match_term(pattern: &Node, candidate: &Node, substitution: &mut BTreeMap<String, Node>) -> bool {
    if let Some(variable) = variable_name(pattern) {
        if let Some(previous) = substitution.get(variable) {
            return previous == candidate;
        }
        substitution.insert(variable.to_string(), candidate.clone());
        return true;
    }
    match (pattern, candidate) {
        (Node::Leaf(left), Node::Leaf(right)) => left == right,
        (Node::List(left), Node::List(right)) if left.len() == right.len() => left
            .iter()
            .zip(right)
            .all(|(pattern, candidate)| match_term(pattern, candidate, substitution)),
        _ => false,
    }
}

fn instantiate(node: &Node, substitution: &BTreeMap<String, Node>) -> Result<Node, String> {
    if let Some(variable) = variable_name(node) {
        return substitution
            .get(variable)
            .cloned()
            .ok_or_else(|| format!("unbound variable {variable}"));
    }
    match node {
        Node::Leaf(value) => Ok(Node::Leaf(value.clone())),
        Node::List(children) => children
            .iter()
            .map(|child| instantiate(child, substitution))
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

    pub fn runtime_semantic_trace(&self) -> BootstrapRuntimeTrace {
        let trace = self.runtime_trace.borrow();
        BootstrapRuntimeTrace {
            schema: "rml-bootstrap-runtime-trace/v1",
            observed_paths: trace.observed_paths.iter().cloned().collect(),
            observed_operations: trace.observed_operations.iter().cloned().collect(),
            observed_path_segments: trace.observed_path_segments.iter().cloned().collect(),
        }
    }

    /// Reports the current K0 boundary, derived host services, and their trust graph.
    pub fn bootstrap_kernel_report() -> BootstrapKernelReport {
        let operations = vec![
            "parse-linked-forms",
            "compare-link-structure",
            "bind-pattern-variables",
            "substitute-bound-structures",
            "select-and-traverse-rewrite-rules",
            "enforce-cycle-and-resource-bounds",
        ];
        let derived_host_services = vec![
            "resolve-and-rebind-program-imports",
            "saturate-inference-rules",
        ];
        BootstrapKernelReport {
            name: "K0",
            status: "current-bootstrap-boundary",
            claims_irreducible: false,
            fixed_point_criterion: "Remove an operation only when every public semantic path still executes and the replacement does not presuppose the same operation under another name.",
            operations,
            derived_host_services,
            object_semantics: Vec::new(),
            minimization_experiments: vec![
                BootstrapMinimizationExperiment {
                    operation: "parse-linked-forms",
                    classification: "UNKNOWN",
                    outcome: "retained-at-text-ingress",
                    evidence: "from_forms bypasses parsing for pre-linked input, while from_rml demonstrates that textual LiNo still needs one explicit decoder.",
                },
                BootstrapMinimizationExperiment {
                    operation: "compare-link-structure",
                    classification: "UNKNOWN",
                    outcome: "retained-at-bootstrap-fixed-point",
                    evidence: "K1 defines object equality through repeated variables, but activating that K1 rule still requires K0 structural identity.",
                },
                BootstrapMinimizationExperiment {
                    operation: "bind-pattern-variables",
                    classification: "UNKNOWN",
                    outcome: "retained-at-bootstrap-fixed-point",
                    evidence: "K1 self-interprets its repeated-variable matcher, but the outer K1 rewrite still requires generic K0 binding.",
                },
                BootstrapMinimizationExperiment {
                    operation: "substitute-bound-structures",
                    classification: "UNKNOWN",
                    outcome: "retained-at-bootstrap-fixed-point",
                    evidence: "K1 self-interprets substitution, but producing the next K1 state still requires generic K0 template instantiation.",
                },
                BootstrapMinimizationExperiment {
                    operation: "select-and-traverse-rewrite-rules",
                    classification: "UNKNOWN",
                    outcome: "retained-at-bootstrap-fixed-point",
                    evidence: "K1 defines object-rule selection, while K0 remains the transition clock that makes any linked rule active.",
                },
                BootstrapMinimizationExperiment {
                    operation: "enforce-cycle-and-resource-bounds",
                    classification: "UNKNOWN",
                    outcome: "retained-as-external-observer",
                    evidence: "A user program cannot reliably bound its own divergence; mirrored cycle and step/fact-limit tests require an outside observer.",
                },
                BootstrapMinimizationExperiment {
                    operation: "resolve-and-rebind-program-imports",
                    classification: "UNKNOWN",
                    outcome: "retained-host-implementation",
                    evidence: "The service is composed from structural operations, but disabling its host implementation breaks the import/rebind probe; no links-defined replacement has yet preserved the baseline.",
                },
                BootstrapMinimizationExperiment {
                    operation: "saturate-inference-rules",
                    classification: "UNKNOWN",
                    outcome: "retained-host-implementation",
                    evidence: "The service is composed from matching, substitution, reduction, and bounds, but disabling its host implementation breaks the inference probe; no links-defined replacement has yet preserved the baseline.",
                },
            ],
            trust_graph: BootstrapTrustGraph {
                schema: "rml-bootstrap-trust-graph/v1",
                nodes: vec![
                    BootstrapTrustNode {
                        id: "parse-linked-forms",
                        layer: "bootstrap",
                        depends_on: vec![],
                        primitive_reason: "Text is outside the links substrate; one ingress operation must expose its leaf/list structure before any linked rule can run.",
                    },
                    BootstrapTrustNode {
                        id: "compare-link-structure",
                        layer: "bootstrap",
                        depends_on: vec![],
                        primitive_reason: "Rule activation and cycle observation require an initial decision about exact leaf/list identity; an encoded equality rule still needs this decision to activate.",
                    },
                    BootstrapTrustNode {
                        id: "bind-pattern-variables",
                        layer: "bootstrap",
                        depends_on: vec!["compare-link-structure"],
                        primitive_reason: "A parameterized linked rule cannot activate until sublinks are associated with its variables; the K1 matcher is itself activated by this association.",
                    },
                    BootstrapTrustNode {
                        id: "substitute-bound-structures",
                        layer: "bootstrap",
                        depends_on: vec!["bind-pattern-variables"],
                        primitive_reason: "An activated rule needs one operation that constructs its next linked state from the bindings; the K1 substitution relation is executed by that same transition.",
                    },
                    BootstrapTrustNode {
                        id: "select-and-traverse-rewrite-rules",
                        layer: "bootstrap",
                        depends_on: vec![
                            "bind-pattern-variables",
                            "substitute-bound-structures",
                        ],
                        primitive_reason: "Links do not execute themselves; a deterministic transition clock must select a rule and a sublink at which to attempt activation.",
                    },
                    BootstrapTrustNode {
                        id: "enforce-cycle-and-resource-bounds",
                        layer: "bootstrap",
                        depends_on: vec!["compare-link-structure"],
                        primitive_reason: "Arbitrary user rules may diverge, so an observer outside those rules must bound execution and report repeated states without assigning object meaning.",
                    },
                    BootstrapTrustNode {
                        id: "resolve-and-rebind-program-imports",
                        layer: "derived-host-service",
                        depends_on: vec![
                            "compare-link-structure",
                            "substitute-bound-structures",
                        ],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "saturate-inference-rules",
                        layer: "derived-host-service",
                        depends_on: vec![
                            "bind-pattern-variables",
                            "substitute-bound-structures",
                            "select-and-traverse-rewrite-rules",
                            "enforce-cycle-and-resource-bounds",
                        ],
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
                            "resolve-and-rebind-program-imports",
                            "select-and-traverse-rewrite-rules",
                            "enforce-cycle-and-resource-bounds",
                        ],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "prove-linked-judgement",
                        layer: "semantic-path",
                        depends_on: vec![
                            "saturate-inference-rules",
                            "reduce-linked-program",
                        ],
                        primitive_reason: "",
                    },
                    BootstrapTrustNode {
                        id: "execute-links-meta-foundation",
                        layer: "links-defined",
                        depends_on: vec!["reduce-linked-program"],
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
            if node.layer == "bootstrap" {
                return Ok(true);
            }
            if !visiting.insert(id.to_string()) {
                return Err(format!("trust graph dependency cycle at {id}"));
            }
            if node.depends_on.is_empty() {
                visiting.remove(id);
                return Ok(false);
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
                        Err(error) => BootstrapRemovalExperiment {
                            operation,
                            classification: "UNKNOWN",
                            baseline_preserved: false,
                            observed_failure: error,
                        },
                    },
                )
                .collect();

        let rules: Vec<String> = self_hosting_trace
            .iter()
            .map(|step| step.rule.clone())
            .collect();
        let capability =
            |name: &'static str, predicate: &dyn Fn(&str) -> bool| BootstrapLinkedCapability {
                capability: name,
                evidence_rules: rules
                    .iter()
                    .filter(|rule| predicate(rule))
                    .cloned()
                    .collect(),
            };
        let linked_self_hosting_capabilities: Vec<BootstrapLinkedCapability> = vec![
            capability("matching", &|rule| rule.starts_with("match-")),
            capability("substitution", &|rule| rule.starts_with("substitute-")),
            capability("rule-selection", &|rule| rule.starts_with("select-")),
            capability("result-verification", &|rule| {
                rule == "verify-object-result"
            }),
        ]
        .into_iter()
        .filter(|capability| !capability.evidence_rules.is_empty())
        .collect();
        let execute_operations: BTreeSet<String> = trace
            .observed_path_segments
            .iter()
            .filter(|segment| {
                matches!(
                    segment.path.as_str(),
                    "load-linked-program" | "execute-links-meta-foundation"
                )
            })
            .map(|segment| segment.operation.clone())
            .collect();
        let duplication_candidates: [(&str, &[&str]); 3] = [
            (
                "matching",
                &["compare-link-structure", "bind-pattern-variables"],
            ),
            ("substitution", &["substitute-bound-structures"]),
            ("rule-selection", &["select-and-traverse-rewrite-rules"]),
        ];
        let host_linked_duplications: Vec<BootstrapHostLinkedDuplication> = duplication_candidates
            .iter()
            .filter_map(|(name, host_operations)| {
                let linked = linked_self_hosting_capabilities
                    .iter()
                    .find(|capability| capability.capability == *name)?;
                host_operations
                    .iter()
                    .all(|operation| execute_operations.contains(*operation))
                    .then(|| BootstrapHostLinkedDuplication {
                        capability: name,
                        host_operations: host_operations.to_vec(),
                        linked_evidence_rules: linked.evidence_rules.clone(),
                    })
            })
            .collect();

        let linked_capability_names: Vec<&'static str> = linked_self_hosting_capabilities
            .iter()
            .map(|capability| capability.capability)
            .collect();
        let host_capability_names: Vec<String> = execute_operations.iter().cloned().collect();
        let linked_count = linked_capability_names.len();
        let host_count = host_capability_names.len();
        let unknown_count = removal_experiments
            .iter()
            .filter(|experiment| experiment.classification == "UNKNOWN")
            .count();
        let confirmed_independent_count = removal_experiments
            .iter()
            .filter(|experiment| experiment.classification == "INDEPENDENT")
            .count();
        let removable_count = removal_experiments
            .iter()
            .filter(|experiment| experiment.baseline_preserved)
            .count();
        let total_operations = IMPLEMENTED_HOST_SEMANTIC_OPERATIONS.len();
        let smallest_sufficient = total_operations - removable_count;
        let self_hosting_closure = BootstrapSelfHostingClosure {
            task: "textual-load-through-links-meta-foundation-verification",
            linked_capabilities: linked_count,
            linked_capability_names,
            host_capabilities: host_count,
            host_capability_names,
            total_capabilities: linked_count + host_count,
            numerator: linked_count,
            denominator: linked_count + host_count,
        };
        let sufficient_operations: Vec<&'static str> = removal_experiments
            .iter()
            .filter(|experiment| !experiment.baseline_preserved)
            .map(|experiment| experiment.operation)
            .collect();
        let foundation_compression = BootstrapFoundationCompression {
            basis: "host-operation fault injection over the declared acceptance probe",
            smallest_sufficient_host_operations: smallest_sufficient,
            original_host_operations: total_operations,
            candidate_operations: IMPLEMENTED_HOST_SEMANTIC_OPERATIONS.to_vec(),
            sufficient_operations,
            numerator: smallest_sufficient,
            denominator: total_operations,
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
            derived_host_semantic_services: 2,
            duplicated_semantic_capabilities: host_linked_duplications.len(),
            object_specific_host_semantics: 0,
            undocumented_semantic_paths: undocumented_count,
            self_hosting_closure,
            foundation_compression,
        };
        let host_semantic_layers = vec![
            BootstrapHostSemanticLayer {
                layer: "semantic-bootstrap",
                count: 4,
                operations: vec![
                    "compare-link-structure",
                    "bind-pattern-variables",
                    "substitute-bound-structures",
                    "select-and-traverse-rewrite-rules",
                ],
            },
            BootstrapHostSemanticLayer {
                layer: "derived-host-semantics",
                count: 2,
                operations: vec![
                    "resolve-and-rebind-program-imports",
                    "saturate-inference-rules",
                ],
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
                previous: Some("8".to_string()),
                current: total_operations.to_string(),
                delta: Some((total_operations as isize - 8).to_string()),
            },
            BootstrapMetricComparison {
                metric: "independent-host-primitives",
                previous: None,
                current: format!(
                    "{confirmed_independent_count} confirmed; {unknown_count} unknown"
                ),
                delta: None,
            },
            BootstrapMetricComparison {
                metric: "derived-host-semantic-services",
                previous: Some("2".to_string()),
                current: "2".to_string(),
                delta: Some("0".to_string()),
            },
            BootstrapMetricComparison {
                metric: "host-linked-duplicated-semantics",
                previous: None,
                current: host_linked_duplications.len().to_string(),
                delta: None,
            },
            BootstrapMetricComparison {
                metric: "object-specific-host-semantics",
                previous: Some("0".to_string()),
                current: "0".to_string(),
                delta: Some("0".to_string()),
            },
            BootstrapMetricComparison {
                metric: "undocumented-semantic-paths",
                previous: None,
                current: undocumented_count.to_string(),
                delta: None,
            },
            BootstrapMetricComparison {
                metric: "self-hosting-closure",
                previous: None,
                current: format!(
                    "{}/{}",
                    current.self_hosting_closure.numerator,
                    current.self_hosting_closure.denominator
                ),
                delta: None,
            },
            BootstrapMetricComparison {
                metric: "foundation-compression-ratio",
                previous: None,
                current: format!(
                    "{}/{}",
                    current.foundation_compression.numerator,
                    current.foundation_compression.denominator
                ),
                delta: None,
            },
        ];
        Ok(BootstrapMetricsReport {
            schema: "rml-bootstrap-metrics/v1",
            previous_revision: PREVIOUS_METRIC_REVISION,
            measurement_scope: "The executable probe covers textual load, import/rebind reduction, inference saturation, and links-meta-foundation result verification. UNKNOWN means removal failed but no exhaustive proof of independence exists.",
            removal_classifications: REMOVAL_CLASSIFICATIONS.to_vec(),
            current,
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
        let mut registry = Self {
            disabled_operations: disabled_operations
                .iter()
                .map(|operation| (*operation).to_string())
                .collect(),
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
        semantic_paths: &[&str],
    ) -> Result<Vec<RewriteRule>, String> {
        self.observe(semantic_paths, "resolve-and-rebind-program-imports")?;
        let mut output = Vec::new();
        let mut seen = BTreeSet::new();
        self.collect_rewrites(name, &[], &mut seen, &mut output)?;
        Ok(output)
    }

    fn collect_rewrites(
        &self,
        name: &str,
        rebindings: &[BTreeMap<String, String>],
        seen: &mut BTreeSet<String>,
        output: &mut Vec<RewriteRule>,
    ) -> Result<(), String> {
        let context = format!("{name}\0{rebindings:?}");
        if !seen.insert(context) {
            return Ok(());
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("execution references unknown linked-program {name}"))?;
        output.extend(program.rewrites.iter().map(|rule| RewriteRule {
            program: rule.program.clone(),
            name: rule.name.clone(),
            pattern: apply_rebindings(&rule.pattern, rebindings),
            replacement: apply_rebindings(&rule.replacement, rebindings),
        }));
        for dependency in &program.uses {
            let nested_rebindings = if dependency.rebindings.is_empty() {
                rebindings.to_vec()
            } else {
                let mut nested = vec![dependency.rebindings.clone()];
                nested.extend_from_slice(rebindings);
                nested
            };
            self.collect_rewrites(&dependency.program, &nested_rebindings, seen, output)?;
        }
        Ok(())
    }

    fn effective_facts(
        &self,
        name: &str,
        semantic_paths: &[&str],
    ) -> Result<Vec<LinkedFact>, String> {
        self.observe(semantic_paths, "resolve-and-rebind-program-imports")?;
        let mut output = Vec::new();
        let mut seen = BTreeSet::new();
        self.collect_facts(name, &[], &mut seen, &mut output)?;
        Ok(output)
    }

    fn collect_facts(
        &self,
        name: &str,
        rebindings: &[BTreeMap<String, String>],
        seen: &mut BTreeSet<String>,
        output: &mut Vec<LinkedFact>,
    ) -> Result<(), String> {
        let context = format!("{name}\0{rebindings:?}");
        if !seen.insert(context) {
            return Ok(());
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("execution references unknown linked-program {name}"))?;
        output.extend(program.facts.iter().map(|fact| LinkedFact {
            program: fact.program.clone(),
            name: fact.name.clone(),
            judgement: apply_rebindings(&fact.judgement, rebindings),
        }));
        for dependency in &program.uses {
            let nested_rebindings = if dependency.rebindings.is_empty() {
                rebindings.to_vec()
            } else {
                let mut nested = vec![dependency.rebindings.clone()];
                nested.extend_from_slice(rebindings);
                nested
            };
            self.collect_facts(&dependency.program, &nested_rebindings, seen, output)?;
        }
        Ok(())
    }

    fn effective_inferences(
        &self,
        name: &str,
        semantic_paths: &[&str],
    ) -> Result<Vec<InferenceRule>, String> {
        self.observe(semantic_paths, "resolve-and-rebind-program-imports")?;
        let mut output = Vec::new();
        let mut seen = BTreeSet::new();
        self.collect_inferences(name, &[], &mut seen, &mut output)?;
        Ok(output)
    }

    fn collect_inferences(
        &self,
        name: &str,
        rebindings: &[BTreeMap<String, String>],
        seen: &mut BTreeSet<String>,
        output: &mut Vec<InferenceRule>,
    ) -> Result<(), String> {
        let context = format!("{name}\0{rebindings:?}");
        if !seen.insert(context) {
            return Ok(());
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("execution references unknown linked-program {name}"))?;
        output.extend(program.inferences.iter().map(|rule| {
            InferenceRule {
                program: rule.program.clone(),
                name: rule.name.clone(),
                premises: rule
                    .premises
                    .iter()
                    .map(|premise| apply_rebindings(premise, rebindings))
                    .collect(),
                conclusion: apply_rebindings(&rule.conclusion, rebindings),
            }
        }));
        for dependency in &program.uses {
            let nested_rebindings = if dependency.rebindings.is_empty() {
                rebindings.to_vec()
            } else {
                let mut nested = vec![dependency.rebindings.clone()];
                nested.extend_from_slice(rebindings);
                nested
            };
            self.collect_inferences(&dependency.program, &nested_rebindings, seen, output)?;
        }
        Ok(())
    }

    fn rewrite_once(
        &self,
        term: &Node,
        rules: &[RewriteRule],
        semantic_paths: &[&str],
    ) -> Result<Option<(Node, RewriteRule)>, String> {
        self.observe(semantic_paths, "select-and-traverse-rewrite-rules")?;
        for rule in rules {
            self.observe(semantic_paths, "compare-link-structure")?;
            self.observe(semantic_paths, "bind-pattern-variables")?;
            let mut substitution = BTreeMap::new();
            if match_term(&rule.pattern, term, &mut substitution) {
                self.observe(semantic_paths, "substitute-bound-structures")?;
                return Ok(Some((
                    instantiate(&rule.replacement, &substitution)?,
                    rule.clone(),
                )));
            }
        }
        if let Node::List(children) = term {
            for (index, child) in children.iter().enumerate() {
                if let Some((rewritten, rule)) = self.rewrite_once(child, rules, semantic_paths)? {
                    let mut result = children.clone();
                    result[index] = rewritten;
                    return Ok(Some((Node::List(result), rule)));
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
        let rules = self.effective_rewrites(name, &semantic_paths)?;
        let mut term = input.clone();
        let mut trace = Vec::new();
        let mut seen = BTreeSet::from([key_of(&term)]);
        while trace.len() < max_steps {
            let Some((next, rule)) = self.rewrite_once(&term, &rules, &semantic_paths)? else {
                return Ok(ReductionResult { term, trace });
            };
            if next == term {
                return Err(format!(
                    "linked rewrite {}.{} made no progress",
                    rule.program, rule.name
                ));
            }
            trace.push(RewriteTraceStep {
                program: rule.program,
                rule: rule.name,
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
        self.observe(&semantic_paths, "saturate-inference-rules")
            .ok()?;
        self.observe(&semantic_paths, "enforce-cycle-and-resource-bounds")
            .ok()?;
        if max_rounds == 0 || max_facts == 0 {
            return None;
        }
        let normalized_goal = self.reduce(name, goal, 10_000).ok()?.term;
        let goal_key = key_of(&normalized_goal);
        let mut known: BTreeMap<String, (Node, LinkedProof)> = BTreeMap::new();
        for fact in self.effective_facts(name, &semantic_paths).ok()? {
            let normalized = self.reduce(name, &fact.judgement, 10_000).ok()?.term;
            let key = key_of(&normalized);
            known.entry(key).or_insert_with(|| {
                (
                    normalized,
                    LinkedProof {
                        judgement: fact.judgement,
                        program: fact.program,
                        rule: fact.name,
                        premises: Vec::new(),
                    },
                )
            });
            if known.len() > max_facts {
                return None;
            }
        }
        for (index, fact) in facts.iter().enumerate() {
            let normalized = self.reduce(name, fact, 10_000).ok()?.term;
            let key = key_of(&normalized);
            known.entry(key).or_insert_with(|| {
                (
                    normalized,
                    LinkedProof {
                        judgement: fact.clone(),
                        program: "<input>".to_string(),
                        rule: format!("input-{}", index + 1),
                        premises: Vec::new(),
                    },
                )
            });
            if known.len() > max_facts {
                return None;
            }
        }
        if let Some((_, proof)) = known.get(&goal_key) {
            return Some(proof.clone());
        }
        let rules = self.effective_inferences(name, &semantic_paths).ok()?;
        for _ in 0..max_rounds {
            let mut changed = false;
            for rule in &rules {
                let mut candidates = vec![(BTreeMap::new(), Vec::<LinkedProof>::new())];
                for premise in &rule.premises {
                    let mut next = Vec::new();
                    for (substitution, proofs) in candidates {
                        for (judgement, proof) in known.values() {
                            self.observe(&semantic_paths, "compare-link-structure")
                                .ok()?;
                            self.observe(&semantic_paths, "bind-pattern-variables")
                                .ok()?;
                            let mut candidate_substitution = substitution.clone();
                            if match_term(premise, judgement, &mut candidate_substitution) {
                                let mut candidate_proofs = proofs.clone();
                                candidate_proofs.push(proof.clone());
                                next.push((candidate_substitution, candidate_proofs));
                            }
                        }
                    }
                    candidates = next;
                    if candidates.is_empty() {
                        break;
                    }
                }
                for (substitution, premises) in candidates {
                    self.observe(&semantic_paths, "substitute-bound-structures")
                        .ok()?;
                    let judgement = instantiate(&rule.conclusion, &substitution).ok()?;
                    let normalized = self.reduce(name, &judgement, 10_000).ok()?.term;
                    let key = key_of(&normalized);
                    if known.contains_key(&key) {
                        continue;
                    }
                    let proof = LinkedProof {
                        judgement,
                        program: rule.program.clone(),
                        rule: rule.name.clone(),
                        premises,
                    };
                    known.insert(key.clone(), (normalized, proof));
                    changed = true;
                    if known.len() > max_facts {
                        return None;
                    }
                    if key == goal_key {
                        return known.get(&key).map(|(_, proof)| proof.clone());
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
