//! Linked foundation workspace.
//!
//! A linked foundation is a named, versioned package of ordinary linked
//! programs. It declares each program in one role (axioms, inference,
//! typing, reduction, equality, truth, or proof), may depend on other
//! foundations, may restrict its judgements with a signature, and declares
//! how proof cycles are treated. A linked instance imports one unchanged
//! theory into one foundation, optionally renaming the theory's constants:
//!
//! ```text
//! (linked-foundation NAME (version V)
//!   (depends-on OTHER (version W))
//!   (ROLE PROGRAM) ...
//!   (signature PATTERN ...)
//!   (cycle-policy inductive | guarded-coinductive (guard PROGRAM RULE) ...))
//! (linked-instance NAME (theory PROGRAM (rebind FROM TO) ...)
//!   (foundation NAME (version V)))
//! ```
//!
//! The workspace reads these declarations as data and runs them through the
//! linked-program registry, so a logic supplied only as links executes on the
//! same public path as every other one. Nothing here names or branches on a
//! particular logic: the roles fix only which rule kind a program may hold,
//! and the two cycle policies fix only how a proof may close a cycle.
//!
//! Every answer carries its instance, theory, foundation version,
//! assumptions, cycle policy, bounds, the host operations it observed, and
//! the rules its evidence used, so a caller can tell which results a later
//! change of a rule or an assumption affects. Statuses keep "not derived",
//! "stopped by a bound", and "outside what the foundation supports" apart;
//! none of them is a proof that the query is false. This is the Rust
//! counterpart of `js/src/rml-foundation-workspace.mjs` and reports the same
//! statuses, reasons, and details; argument errors name the Rust fields.

use crate::linked_program::{
    ExecutionBasis, GoalNormalization, LinkedProgram, LinkedProgramRegistry, LinkedProof,
    ReductionStopped, RewriteTraceStep, SearchEnd,
};
use crate::{key_of, Node};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

pub const PACKAGE_SCHEMA: &str = "rml-foundation-package/v1";
pub const RESULT_SCHEMA: &str = "rml-foundation-result/v1";
pub const EXECUTION_SCHEMA: &str = "rml-foundation-execution/v1";

/// Each role admits one rule kind, so a declared role is a checked
/// classification of a program rather than a label.
const ROLE_KINDS: &[(&str, &str)] = &[
    ("axioms", "fact"),
    ("inference", "inference"),
    ("typing", "inference"),
    ("reduction", "rewrite"),
    ("equality", "rewrite"),
    ("truth", "rewrite"),
    ("proof", "rewrite"),
];
const RULE_HEADS: &[(&str, &str)] = &[
    ("linked-rewrite", "rewrite"),
    ("linked-fact", "fact"),
    ("linked-inference", "inference"),
];
/// The rule kinds in the order a program lists them.
const RULE_KINDS: &[&str] = &["rewrite", "fact", "inference"];
/// A proof-role program rewrites `(refutation-of goal)` to the judgement that
/// refutes the goal. When nothing rewrites it, the refutation is undefined.
const REFUTATION_HEAD: &str = "refutation-of";
const ADMITTED: &str = "admitted";
const INDUCTIVE: &str = "inductive";
const GUARDED_COINDUCTIVE: &str = "guarded-coinductive";
const THEORY_ROLE: &str = "theory";
const INPUT_PROGRAM: &str = "<input>";
const ASSUMPTION_PROGRAM: &str = "<assumption>";
const HYPOTHESIS_PROGRAM: &str = "<hypothesis>";

/// One result status and what it establishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultStatus {
    pub status: &'static str,
    pub meaning: &'static str,
    pub proves_query: bool,
    pub proves_refutation: bool,
}

const RESULT_STATUSES: &[ResultStatus] = &[
    ResultStatus {
        status: "proved",
        meaning: "The foundation derives the query, or at least one instance of a pattern query, from the theory and the assumptions.",
        proves_query: true,
        proves_refutation: false,
    },
    ResultStatus {
        status: "refuted",
        meaning: "The foundation derives the judgement its proof role gives as the refutation of the query and does not derive the query.",
        proves_query: false,
        proves_refutation: true,
    },
    ResultStatus {
        status: "contradictory",
        meaning: "The foundation derives both the query and its refutation. Both proofs are reported and the foundation decides what that entails.",
        proves_query: true,
        proves_refutation: true,
    },
    ResultStatus {
        status: "unknown",
        meaning: "Saturation reached a fixed point without deriving the query or its refutation. This is not a proof of falsity.",
        proves_query: false,
        proves_refutation: false,
    },
    ResultStatus {
        status: "exhausted",
        meaning: "A declared bound on rounds, facts, or rewrite steps, or the contraction budget of the closed S/K kernel, stopped the work first. Nothing is established.",
        proves_query: false,
        proves_refutation: false,
    },
    ResultStatus {
        status: "unsupported",
        meaning: "The query or an assumption is outside the foundation signature, or a rewrite cycle or stall leaves it without a normal form. Nothing is established.",
        proves_query: false,
        proves_refutation: false,
    },
];

/// A role a foundation may declare and the rule kind it admits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FoundationRole {
    pub role: &'static str,
    pub kind: &'static str,
}

/// A foundation by name and version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundationRef {
    pub name: String,
    pub version: String,
}

/// One `(rebind FROM TO)` of an instance theory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rebinding {
    pub from: String,
    pub to: String,
}

/// The theory program of an instance and how its constants are renamed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TheoryRef {
    pub name: String,
    pub rebind: Vec<Rebinding>,
}

/// A loaded instance with its theory and resolved foundation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceSummary {
    pub name: String,
    pub theory: TheoryRef,
    pub foundation: FoundationRef,
}

/// An inference or typing rule through which a guarded cycle may close.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Guard {
    pub program: String,
    pub rule: String,
}

/// How a foundation treats proof cycles: `inductive` rejects them and
/// `guarded-coinductive` accepts a cycle whose last step is a guard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CyclePolicy {
    pub kind: &'static str,
    pub guards: Vec<Guard>,
}

/// One role of a foundation closure and the foundation that declared it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleDeclaration {
    pub role: &'static str,
    pub kind: &'static str,
    pub program: String,
    pub declared_by: FoundationRef,
}

/// A rule with the role of its program and its kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleDescription {
    pub program: String,
    pub rule: String,
    pub role: &'static str,
    pub kind: &'static str,
}

/// The bootstrap kernel that executes a foundation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapDescription {
    pub kernel: &'static str,
    pub operations: Vec<&'static str>,
    pub execution_basis: ExecutionBasis,
}

/// One foundation as data, as returned by [`FoundationWorkspace::describe`].
#[derive(Debug, Clone, PartialEq)]
pub struct FoundationPackage {
    pub schema: &'static str,
    pub name: String,
    pub version: String,
    pub depends_on: Vec<FoundationRef>,
    pub closure: Vec<FoundationRef>,
    pub roles: Vec<RoleDeclaration>,
    pub signature: Vec<Node>,
    pub cycle_policy: CyclePolicy,
    pub rules: Vec<RuleDescription>,
    pub bootstrap: BootstrapDescription,
}

/// A proof in foundation terms: assumptions and the coinductive hypothesis
/// are labelled leaves, and every step carries the role of its program.
#[derive(Debug, Clone, PartialEq)]
pub struct FoundationProof {
    pub judgement: Node,
    pub program: String,
    pub rule: String,
    pub role: &'static str,
    pub premises: Vec<FoundationProof>,
}

/// One derived instance of a pattern query, with the value of each pattern
/// variable in first-occurrence order.
#[derive(Debug, Clone, PartialEq)]
pub struct FoundationAnswer {
    pub judgement: Node,
    pub bindings: Vec<(String, Node)>,
    pub proof: FoundationProof,
}

/// The refutation of a ground query as the foundation's proof role defines
/// it. `status` is `undefined`, `derived`, `not-derived-within-bounds`, or
/// `not-derived`.
#[derive(Debug, Clone, PartialEq)]
pub struct Refutation {
    pub judgement: Option<Node>,
    pub status: &'static str,
    pub proof: Option<FoundationProof>,
}

/// How one saturation ended and how many facts it knew.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SearchSummary {
    pub ended: SearchEnd,
    pub facts: usize,
}

/// The retry of an underived ground goal as a guarded cycle.
#[derive(Debug, Clone, PartialEq)]
pub struct Coinduction {
    pub hypothesis: Node,
    pub guards: Vec<Guard>,
    pub status: &'static str,
    pub search: SearchSummary,
}

/// A program of an instance closure and its role.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClosureMember {
    pub program: String,
    pub role: &'static str,
}

/// What a result depends on. With `evidence` scope only the listed rules and
/// assumptions can change it; with `closure` scope any change inside the
/// instance closure can.
#[derive(Debug, Clone, PartialEq)]
pub struct Dependencies {
    pub scope: &'static str,
    pub assumptions: Vec<Node>,
    pub rules: Vec<RuleDescription>,
    pub closure: Vec<ClosureMember>,
}

/// The bounds of one question.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FoundationBounds {
    pub max_rounds: usize,
    pub max_facts: usize,
    pub max_steps: usize,
}

impl Default for FoundationBounds {
    fn default() -> Self {
        Self {
            max_rounds: 128,
            max_facts: 10_000,
            max_steps: 10_000,
        }
    }
}

/// The answer to one question, as returned by [`FoundationWorkspace::ask`].
#[derive(Debug, Clone, PartialEq)]
pub struct FoundationResult {
    pub schema: &'static str,
    pub instance: String,
    pub theory: TheoryRef,
    pub foundation: FoundationRef,
    pub execution_basis: ExecutionBasis,
    pub query: Node,
    pub normalized: Option<Node>,
    pub assumptions: Vec<Node>,
    pub status: &'static str,
    pub reason: &'static str,
    pub detail: Option<String>,
    pub proof: Option<FoundationProof>,
    pub answers: Option<Vec<FoundationAnswer>>,
    pub complete: Option<bool>,
    pub refutation: Option<Refutation>,
    pub coinduction: Option<Coinduction>,
    pub cycle_policy: CyclePolicy,
    pub dependencies: Dependencies,
    pub search: Option<SearchSummary>,
    pub bounds: FoundationBounds,
    pub host_operations: Vec<String>,
}

/// One rewrite step of an execution with the role of its program.
#[derive(Debug, Clone, PartialEq)]
pub struct ExecutionStep {
    pub program: String,
    pub rule: String,
    pub role: &'static str,
    pub before: Node,
    pub after: Node,
}

/// A reduction, as returned by [`FoundationWorkspace::execute`].
#[derive(Debug, Clone, PartialEq)]
pub struct FoundationExecution {
    pub schema: &'static str,
    pub instance: String,
    pub foundation: FoundationRef,
    pub execution_basis: ExecutionBasis,
    pub input: Node,
    pub status: &'static str,
    pub reason: &'static str,
    pub detail: Option<String>,
    pub output: Option<Node>,
    pub steps: Option<usize>,
    pub trace: Option<Vec<ExecutionStep>>,
    pub host_operations: Vec<String>,
}

/// A change of one assumption or one linked rule.
#[derive(Debug, Clone, PartialEq)]
pub enum FoundationChange {
    /// Replace every assumption equal to `from` with `to`.
    ReplaceAssumption { from: Node, to: Node },
    /// Add a `linked-rewrite`, `linked-fact`, or `linked-inference` form.
    AddRule(Node),
    /// Replace the rule form with the same program and rule name.
    ReplaceRule(Node),
    /// Remove the named rule.
    RemoveRule { program: String, rule: String },
}

/// What [`FoundationWorkspace::revise`] did with one result: `kept` it or
/// `rechecked` it, and whether its outcome changed.
#[derive(Debug, Clone, PartialEq)]
pub struct ResultRevision {
    pub action: &'static str,
    pub before: FoundationResult,
    pub after: FoundationResult,
    pub changed: bool,
}

/// The workspace after a change and one revision per result. An assumption
/// change keeps the workspace, so it is borrowed; a rule change builds a new
/// one.
#[derive(Debug, Clone)]
pub struct FoundationRevision<'a> {
    pub workspace: Cow<'a, FoundationWorkspace>,
    pub revisions: Vec<ResultRevision>,
}

#[derive(Debug, Clone)]
struct Reference {
    name: String,
    version: Option<String>,
}

#[derive(Debug, Clone)]
struct RoleEntry {
    role: &'static str,
    program: String,
    declared_by: FoundationRef,
}

#[derive(Debug, Clone)]
struct GuardClauses {
    premises: Vec<Node>,
    conclusion: Node,
}

#[derive(Debug, Clone)]
struct Foundation {
    name: String,
    version: String,
    context: String,
    depends_on: Vec<Reference>,
    roles: BTreeMap<&'static str, String>,
    /// The foundation's own patterns until it is planned, then the patterns
    /// of its whole closure.
    signature: Vec<Node>,
    cycle_policy: CyclePolicy,
    guard_clauses: Vec<GuardClauses>,
    dependencies: Vec<usize>,
    closure: Vec<usize>,
    declared: BTreeMap<String, &'static str>,
    role_entries: Vec<RoleEntry>,
}

#[derive(Debug, Clone)]
struct ParsedInstance {
    name: String,
    theory: TheoryRef,
    reference: Reference,
}

#[derive(Debug, Clone)]
struct SynthesizedNames {
    program: String,
    guarded: String,
    signature: String,
    answer: String,
}

impl SynthesizedNames {
    fn reserved(&self) -> [&str; 3] {
        [&self.guarded, &self.signature, &self.answer]
    }
}

#[derive(Debug, Clone)]
struct Instance {
    name: String,
    theory: TheoryRef,
    foundation: usize,
    names: SynthesizedNames,
    program_forms: Vec<Node>,
    guarded_forms: Vec<Node>,
    signature_forms: Vec<Node>,
}

#[derive(Debug, Clone)]
struct Plan {
    foundations: Vec<Foundation>,
    foundation_index: BTreeMap<String, usize>,
    versions: BTreeMap<String, Vec<String>>,
    instances: Vec<Instance>,
    instance_index: BTreeMap<String, usize>,
    synthesized: Vec<Node>,
}

impl Plan {
    fn resolve(&self, reference: &Reference, context: &str) -> Result<usize, String> {
        resolve(&self.foundation_index, &self.versions, reference, context)
    }
}

#[derive(Debug, Clone)]
struct OpenRewrite {
    program: String,
    rule: String,
    length: Option<usize>,
}

#[derive(Debug, Clone)]
struct InstanceData {
    closure: Vec<String>,
    role_of: BTreeMap<String, &'static str>,
    forms: Vec<Node>,
    open_rewrites: Vec<OpenRewrite>,
}

impl InstanceData {
    fn role_of(&self, program: &str) -> &'static str {
        self.role_of.get(program).copied().unwrap_or(THEORY_ROLE)
    }
}

enum ValidatedChange {
    Assumption {
        from_key: String,
        to: Node,
    },
    Rule {
        action: &'static str,
        program: String,
        rule: String,
        kinds: BTreeSet<&'static str>,
        forms: Vec<Node>,
    },
}

fn describe_term(value: Option<&Node>) -> String {
    value.map_or_else(|| "nothing".to_string(), key_of)
}

fn is_variable(term: &Node) -> bool {
    matches!(term, Node::Leaf(value) if value.len() > 1 && value.starts_with('?'))
}

fn leaf_text(value: Option<&Node>) -> Option<&str> {
    match value {
        Some(Node::Leaf(text)) => Some(text),
        _ => None,
    }
}

fn head_text(term: &Node) -> Option<&str> {
    match term {
        Node::List(parts) => leaf_text(parts.first()),
        Node::Leaf(_) => None,
    }
}

fn name_node(text: &str) -> Node {
    Node::Leaf(text.to_string())
}

fn role_kind(role: &str) -> Option<&'static str> {
    ROLE_KINDS
        .iter()
        .find(|(name, _)| *name == role)
        .map(|(_, kind)| *kind)
}

fn declared_role(head: &str) -> Option<&'static str> {
    ROLE_KINDS
        .iter()
        .find(|(name, _)| *name == head)
        .map(|(name, _)| *name)
}

fn rule_kind_of_head(head: &str) -> Option<&'static str> {
    RULE_HEADS
        .iter()
        .find(|(name, _)| *name == head)
        .map(|(_, kind)| *kind)
}

fn name_leaf(value: Option<&Node>, context: &str) -> Result<String, String> {
    match value {
        Some(Node::Leaf(name)) if !name.is_empty() && !name.starts_with('?') => Ok(name.clone()),
        other => Err(format!(
            "{context} must be a name, not {}",
            describe_term(other)
        )),
    }
}

fn name_text(value: &str, context: &str) -> Result<String, String> {
    name_leaf(Some(&name_node(value)), context)
}

fn assert_term(value: &Node, context: &str) -> Result<(), String> {
    match value {
        Node::Leaf(text) if !text.is_empty() => Ok(()),
        Node::List(children) if !children.is_empty() => children
            .iter()
            .try_for_each(|child| assert_term(child, context)),
        _ => Err(format!("{context} must be a non-empty link term")),
    }
}

fn positive_bound(value: usize, name: &str) -> Result<usize, String> {
    if value == 0 {
        return Err(format!("{name} must be positive"));
    }
    Ok(value)
}

fn foundation_key(name: &str, version: &str) -> String {
    format!("{name}@{version}")
}

fn rule_key(kind: &str, program: &str, rule: &str) -> String {
    format!("{kind}\0{program}\0{rule}")
}

/// Variables of a term in first-occurrence order.
fn variables_in(term: &Node, output: &mut Vec<String>) {
    if let Node::Leaf(name) = term {
        if is_variable(term) && !output.contains(name) {
            output.push(name.clone());
        }
    }
    if let Node::List(children) = term {
        for child in children {
            variables_in(child, output);
        }
    }
}

fn has_variables(term: &Node) -> bool {
    match term {
        Node::Leaf(_) => is_variable(term),
        Node::List(children) => children.iter().any(has_variables),
    }
}

fn first_reserved<'a>(term: &'a Node, reserved: &[&str]) -> Option<&'a str> {
    match term {
        Node::Leaf(leaf) => reserved.contains(&leaf.as_str()).then_some(leaf.as_str()),
        Node::List(children) => children
            .iter()
            .find_map(|child| first_reserved(child, reserved)),
    }
}

fn rule_names(program: &LinkedProgram, kind: &str) -> Vec<String> {
    match kind {
        "rewrite" => program
            .rewrites
            .iter()
            .map(|rule| rule.name.clone())
            .collect(),
        "fact" => program.facts.iter().map(|fact| fact.name.clone()).collect(),
        _ => program
            .inferences
            .iter()
            .map(|rule| rule.name.clone())
            .collect(),
    }
}

/// Program names reachable through `uses`, the root first, in preorder.
fn uses_closure(registry: &LinkedProgramRegistry, root: &str) -> Vec<String> {
    fn visit(
        registry: &LinkedProgramRegistry,
        name: &str,
        seen: &mut BTreeSet<String>,
        order: &mut Vec<String>,
    ) {
        if !seen.insert(name.to_string()) {
            return;
        }
        order.push(name.to_string());
        if let Some(program) = registry.program(name) {
            for dependency in &program.uses {
                visit(registry, &dependency.program, seen, order);
            }
        }
    }
    let mut order = Vec::new();
    visit(registry, root, &mut BTreeSet::new(), &mut order);
    order
}

fn version_clause(clause: &Node, context: &str) -> Result<String, String> {
    match clause {
        Node::List(parts) if parts.len() == 2 && leaf_text(parts.first()) == Some("version") => {
            name_leaf(parts.get(1), &format!("{context} version"))
        }
        _ => Err(format!("{context} requires (version value)")),
    }
}

fn parse_cycle_policy(values: &[Node], context: &str) -> Result<CyclePolicy, String> {
    let guards = values.get(1..).unwrap_or_default();
    match leaf_text(values.first()) {
        Some(INDUCTIVE) => {
            if !guards.is_empty() {
                return Err(format!("{context} inductive cycle policy takes no guards"));
            }
            Ok(CyclePolicy {
                kind: INDUCTIVE,
                guards: Vec::new(),
            })
        }
        Some(GUARDED_COINDUCTIVE) => {
            if guards.is_empty() {
                return Err(format!(
                    "{context} guarded-coinductive cycle policy needs (guard program rule)"
                ));
            }
            let mut parsed: Vec<Guard> = Vec::new();
            for guard in guards {
                let parts = match guard {
                    Node::List(parts)
                        if parts.len() == 3 && leaf_text(parts.first()) == Some("guard") =>
                    {
                        parts
                    }
                    _ => {
                        return Err(format!(
                            "{context} cycle policy guards must be (guard program rule)"
                        ))
                    }
                };
                let program = name_leaf(parts.get(1), &format!("{context} guard program"))?;
                let rule = name_leaf(parts.get(2), &format!("{context} guard rule"))?;
                if parsed
                    .iter()
                    .any(|item| item.program == program && item.rule == rule)
                {
                    return Err(format!("{context} repeats guard {program}.{rule}"));
                }
                parsed.push(Guard { program, rule });
            }
            Ok(CyclePolicy {
                kind: GUARDED_COINDUCTIVE,
                guards: parsed,
            })
        }
        _ => Err(format!(
            "{context} has unknown cycle policy {}",
            describe_term(values.first())
        )),
    }
}

fn parse_foundation(parts: &[Node]) -> Result<Foundation, String> {
    let name = name_leaf(parts.get(1), "linked-foundation name")?;
    let context = format!("linked-foundation {name}");
    let mut version = None;
    let mut cycle_policy = None;
    let mut signature: Option<Vec<Node>> = None;
    let mut depends_on: Vec<Reference> = Vec::new();
    let mut roles = BTreeMap::new();
    for clause in parts.get(2..).unwrap_or_default() {
        let (head, values) = match clause {
            Node::List(items) => match items.split_first() {
                Some((Node::Leaf(head), values)) => (head.as_str(), values),
                _ => {
                    return Err(format!(
                        "{context} has an unsupported clause {}",
                        key_of(clause)
                    ))
                }
            },
            Node::Leaf(_) => {
                return Err(format!(
                    "{context} has an unsupported clause {}",
                    key_of(clause)
                ))
            }
        };
        if head == "version" {
            if version.is_some() {
                return Err(format!("{context} repeats its version"));
            }
            version = Some(version_clause(clause, &context)?);
        } else if head == "depends-on" {
            if values.is_empty() || values.len() > 2 {
                return Err(format!(
                    "{context} dependencies must be (depends-on name (version value))"
                ));
            }
            let dependency = name_leaf(values.first(), &format!("{context} dependency"))?;
            if depends_on.iter().any(|item| item.name == dependency) {
                return Err(format!("{context} repeats dependency {dependency}"));
            }
            let dependency_version = match values.get(1) {
                Some(clause) => Some(version_clause(
                    clause,
                    &format!("{context} dependency {dependency}"),
                )?),
                None => None,
            };
            depends_on.push(Reference {
                name: dependency,
                version: dependency_version,
            });
        } else if let Some(role) = declared_role(head) {
            if values.len() != 1 {
                return Err(format!("{context} role {role} names exactly one program"));
            }
            if roles.contains_key(role) {
                return Err(format!("{context} repeats role {role}"));
            }
            let program = name_leaf(values.first(), &format!("{context} {role} program"))?;
            roles.insert(role, program);
        } else if head == "signature" {
            if signature.is_some() {
                return Err(format!("{context} repeats its signature"));
            }
            if values.is_empty() {
                return Err(format!("{context} signature needs at least one pattern"));
            }
            for pattern in values {
                assert_term(pattern, &format!("{context} signature pattern"))?;
            }
            signature = Some(values.to_vec());
        } else if head == "cycle-policy" {
            if cycle_policy.is_some() {
                return Err(format!("{context} repeats its cycle policy"));
            }
            cycle_policy = Some(parse_cycle_policy(values, &context)?);
        } else {
            return Err(format!("{context} has an unsupported clause {head}"));
        }
    }
    let Some(version) = version else {
        return Err(format!("{context} requires (version value)"));
    };
    let Some(cycle_policy) = cycle_policy else {
        return Err(format!("{context} requires (cycle-policy ...)"));
    };
    Ok(Foundation {
        name,
        version,
        context,
        depends_on,
        roles,
        signature: signature.unwrap_or_default(),
        cycle_policy,
        guard_clauses: Vec::new(),
        dependencies: Vec::new(),
        closure: Vec::new(),
        declared: BTreeMap::new(),
        role_entries: Vec::new(),
    })
}

fn parse_instance(parts: &[Node]) -> Result<ParsedInstance, String> {
    let name = name_leaf(parts.get(1), "linked-instance name")?;
    let context = format!("linked-instance {name}");
    let mut theory = None;
    let mut foundation = None;
    for clause in parts.get(2..).unwrap_or_default() {
        let items = match clause {
            Node::List(items) if items.len() >= 2 => items,
            _ => {
                return Err(format!(
                    "{context} has an unsupported clause {}",
                    key_of(clause)
                ))
            }
        };
        match leaf_text(items.first()) {
            Some("theory") => {
                if theory.is_some() {
                    return Err(format!("{context} repeats its theory"));
                }
                let mut rebind: Vec<Rebinding> = Vec::new();
                for binding in &items[2..] {
                    let binding = match binding {
                        Node::List(binding)
                            if binding.len() == 3
                                && leaf_text(binding.first()) == Some("rebind") =>
                        {
                            binding
                        }
                        _ => {
                            return Err(format!("{context} theory only supports (rebind from to)"))
                        }
                    };
                    let from = name_leaf(binding.get(1), &format!("{context} rebind source"))?;
                    let to = name_leaf(binding.get(2), &format!("{context} rebind target"))?;
                    if rebind.iter().any(|item| item.from == from) {
                        return Err(format!("{context} repeats rebind source {from}"));
                    }
                    rebind.push(Rebinding { from, to });
                }
                theory = Some(TheoryRef {
                    name: name_leaf(items.get(1), &format!("{context} theory"))?,
                    rebind,
                });
            }
            Some("foundation") => {
                if foundation.is_some() {
                    return Err(format!("{context} repeats its foundation"));
                }
                if items.len() > 3 {
                    return Err(format!(
                        "{context} foundation must be (foundation name (version value))"
                    ));
                }
                let foundation_name = name_leaf(items.get(1), &format!("{context} foundation"))?;
                let version = match items.get(2) {
                    Some(clause) => Some(version_clause(clause, &format!("{context} foundation"))?),
                    None => None,
                };
                foundation = Some(Reference {
                    name: foundation_name,
                    version,
                });
            }
            _ => {
                return Err(format!(
                    "{context} has an unsupported clause {}",
                    describe_term(items.first())
                ))
            }
        }
    }
    let Some(theory) = theory else {
        return Err(format!("{context} requires (theory program)"));
    };
    let Some(reference) = foundation else {
        return Err(format!("{context} requires (foundation name)"));
    };
    Ok(ParsedInstance {
        name,
        theory,
        reference,
    })
}

fn inference_clauses(parts: &[Node], context: &str) -> Result<GuardClauses, String> {
    let malformed = || format!("{context} is not a well-formed linked-inference");
    let mut premises = Vec::new();
    let mut conclusions = Vec::new();
    for clause in parts.get(3..).unwrap_or_default() {
        match clause {
            Node::List(items)
                if items.len() == 2 && leaf_text(items.first()) == Some("premise") =>
            {
                premises.push(items[1].clone());
            }
            Node::List(items)
                if items.len() == 2 && leaf_text(items.first()) == Some("conclusion") =>
            {
                conclusions.push(items[1].clone());
            }
            _ => return Err(malformed()),
        }
    }
    if premises.is_empty() || conclusions.len() != 1 {
        return Err(malformed());
    }
    Ok(GuardClauses {
        premises,
        conclusion: conclusions.remove(0),
    })
}

fn resolve(
    foundation_index: &BTreeMap<String, usize>,
    versions: &BTreeMap<String, Vec<String>>,
    reference: &Reference,
    context: &str,
) -> Result<usize, String> {
    let Some(known) = versions.get(&reference.name) else {
        return Err(format!(
            "{context} references unknown linked-foundation {}",
            reference.name
        ));
    };
    if let Some(version) = &reference.version {
        return foundation_index
            .get(&foundation_key(&reference.name, version))
            .copied()
            .ok_or_else(|| {
                format!(
                    "{context} references unknown linked-foundation {} version {version}",
                    reference.name
                )
            });
    }
    if known.len() != 1 {
        return Err(format!(
            "{context} reference to linked-foundation {} is ambiguous among versions {}",
            reference.name,
            known.join(", ")
        ));
    }
    Ok(foundation_index[&foundation_key(&reference.name, &known[0])])
}

/// Read every foundation and instance declaration, resolve references, and
/// synthesize the linked programs that run each instance. Checks that need
/// loaded programs (role kinds, reserved names) run after the registry loads.
fn plan_workspace(forms: &[Node]) -> Result<Plan, String> {
    let mut programs = BTreeSet::new();
    let mut rule_programs = BTreeSet::new();
    let mut rules: BTreeMap<String, &[Node]> = BTreeMap::new();
    let mut foundations: Vec<Foundation> = Vec::new();
    let mut foundation_index = BTreeMap::new();
    let mut versions: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut parsed_instances: Vec<ParsedInstance> = Vec::new();
    for form in forms {
        let Node::List(parts) = form else {
            continue;
        };
        let head = leaf_text(parts.first());
        if head == Some("linked-program") {
            if let Some(name) = leaf_text(parts.get(1)) {
                programs.insert(name.to_string());
            }
        }
        if let Some(kind) = head.and_then(rule_kind_of_head) {
            if let (Some(program), Some(rule)) = (leaf_text(parts.get(1)), leaf_text(parts.get(2)))
            {
                rules.insert(rule_key(kind, program, rule), parts.as_slice());
            }
            if let Some(program) = leaf_text(parts.get(1)) {
                rule_programs.insert(program.to_string());
            }
        }
        if head == Some("linked-foundation") {
            let foundation = parse_foundation(parts)?;
            let key = foundation_key(&foundation.name, &foundation.version);
            if foundation_index.contains_key(&key) {
                return Err(format!(
                    "duplicate linked-foundation {} version {}",
                    foundation.name, foundation.version
                ));
            }
            foundation_index.insert(key, foundations.len());
            versions
                .entry(foundation.name.clone())
                .or_default()
                .push(foundation.version.clone());
            foundations.push(foundation);
        }
        if head == Some("linked-instance") {
            let instance = parse_instance(parts)?;
            if parsed_instances
                .iter()
                .any(|item| item.name == instance.name)
            {
                return Err(format!("duplicate linked-instance {}", instance.name));
            }
            parsed_instances.push(instance);
        }
    }

    for foundation in &mut foundations {
        let context = format!(
            "linked-foundation {} version {}",
            foundation.name, foundation.version
        );
        let dependencies = foundation
            .depends_on
            .iter()
            .map(|reference| resolve(&foundation_index, &versions, reference, &context))
            .collect::<Result<Vec<_>, _>>()?;
        foundation.context = context;
        foundation.dependencies = dependencies;
    }
    for index in 0..foundations.len() {
        plan_foundation(&mut foundations, index, &programs, &rules)?;
    }

    let mut synthesized_owners: BTreeMap<String, String> = BTreeMap::new();
    let mut synthesized = Vec::new();
    let mut instances = Vec::new();
    let mut instance_index = BTreeMap::new();
    for parsed in parsed_instances {
        let context = format!("linked-instance {}", parsed.name);
        let foundation_at = resolve(&foundation_index, &versions, &parsed.reference, &context)?;
        let foundation = &foundations[foundation_at];
        let theory = &parsed.theory;
        if !programs.contains(&theory.name) {
            return Err(format!(
                "{context} theory {} is not a linked-program",
                theory.name
            ));
        }
        if let Some(role) = foundation.declared.get(&theory.name) {
            return Err(format!(
                "{context} theory {} is the {role} program of its foundation",
                theory.name
            ));
        }
        let names = SynthesizedNames {
            program: parsed.name.clone(),
            guarded: format!("{}--guarded", parsed.name),
            signature: format!("{}--signature", parsed.name),
            answer: format!("{}--answer", parsed.name),
        };
        for name in [
            &names.program,
            &names.guarded,
            &names.signature,
            &names.answer,
        ] {
            if programs.contains(name) || rule_programs.contains(name) {
                return Err(format!(
                    "{context} needs the program name {name}, which the source already uses"
                ));
            }
            if let Some(owner) = synthesized_owners.get(name) {
                return Err(format!(
                    "{context} needs the program name {name}, which linked-instance {owner} also needs"
                ));
            }
            synthesized_owners.insert(name.clone(), parsed.name.clone());
        }
        let (program_forms, guarded_forms, signature_forms) =
            synthesize_instance(&names, theory, foundation);
        synthesized.extend(program_forms.iter().cloned());
        synthesized.extend(guarded_forms.iter().cloned());
        synthesized.extend(signature_forms.iter().cloned());
        instance_index.insert(parsed.name.clone(), instances.len());
        instances.push(Instance {
            name: parsed.name,
            theory: parsed.theory,
            foundation: foundation_at,
            names,
            program_forms,
            guarded_forms,
            signature_forms,
        });
    }
    Ok(Plan {
        foundations,
        foundation_index,
        versions,
        instances,
        instance_index,
        synthesized,
    })
}

fn plan_foundation(
    foundations: &mut [Foundation],
    index: usize,
    programs: &BTreeSet<String>,
    rules: &BTreeMap<String, &[Node]>,
) -> Result<(), String> {
    fn visit(
        foundations: &[Foundation],
        member: usize,
        path: &mut Vec<String>,
        visiting: &mut BTreeSet<usize>,
        seen: &mut BTreeSet<usize>,
        closure: &mut Vec<usize>,
    ) -> Result<(), String> {
        let key = foundation_key(&foundations[member].name, &foundations[member].version);
        if visiting.contains(&member) {
            let mut cycle = path.clone();
            cycle.push(key);
            return Err(format!(
                "linked-foundation dependency cycle {}",
                cycle.join(" -> ")
            ));
        }
        if !seen.insert(member) {
            return Ok(());
        }
        visiting.insert(member);
        closure.push(member);
        path.push(key);
        for &dependency in &foundations[member].dependencies {
            visit(foundations, dependency, path, visiting, seen, closure)?;
        }
        path.pop();
        visiting.remove(&member);
        Ok(())
    }

    let context = foundations[index].context.clone();
    let mut closure = Vec::new();
    visit(
        foundations,
        index,
        &mut Vec::new(),
        &mut BTreeSet::new(),
        &mut BTreeSet::new(),
        &mut closure,
    )?;
    let mut versions_by_name: BTreeMap<&str, &str> = BTreeMap::new();
    for &member in &closure {
        let member = &foundations[member];
        if let Some(other) = versions_by_name.get(member.name.as_str()) {
            if *other != member.version {
                return Err(format!(
                    "{context} depends on both versions {other} and {} of {}",
                    member.version, member.name
                ));
            }
        }
        versions_by_name.insert(&member.name, &member.version);
    }

    let mut declared: BTreeMap<String, &'static str> = BTreeMap::new();
    let mut role_entries = Vec::new();
    for &member in &closure {
        let member = &foundations[member];
        for &(role, _) in ROLE_KINDS {
            let Some(program) = member.roles.get(role) else {
                continue;
            };
            if !programs.contains(program) {
                return Err(format!(
                    "{} {role} program {program} is not a linked-program",
                    member.context
                ));
            }
            match declared.get(program) {
                Some(previous) if *previous == role => continue,
                Some(previous) => {
                    return Err(format!(
                        "{context} declares linked-program {program} as both {previous} and {role}"
                    ))
                }
                None => {}
            }
            declared.insert(program.clone(), role);
            role_entries.push(RoleEntry {
                role,
                program: program.clone(),
                declared_by: FoundationRef {
                    name: member.name.clone(),
                    version: member.version.clone(),
                },
            });
        }
    }

    let mut signature = Vec::new();
    let mut patterns = BTreeSet::new();
    for &member in &closure {
        for pattern in &foundations[member].signature {
            if patterns.insert(key_of(pattern)) {
                signature.push(pattern.clone());
            }
        }
    }

    let mut guard_clauses = Vec::new();
    for guard in &foundations[index].cycle_policy.guards {
        let place = format!("{context} guard {}.{}", guard.program, guard.rule);
        let admits_inference = declared
            .get(&guard.program)
            .is_some_and(|role| role_kind(role) == Some("inference"));
        if !admits_inference {
            return Err(format!(
                "{place} must name a rule of an inference or typing program of the foundation"
            ));
        }
        let Some(form) = rules.get(&rule_key("inference", &guard.program, &guard.rule)) else {
            return Err(format!("{place} is not a linked-inference"));
        };
        guard_clauses.push(inference_clauses(form, &place)?);
    }
    let foundation = &mut foundations[index];
    foundation.closure = closure;
    foundation.declared = declared;
    foundation.role_entries = role_entries;
    foundation.signature = signature;
    foundation.guard_clauses = guard_clauses;
    Ok(())
}

fn synthesize_instance(
    names: &SynthesizedNames,
    theory: &TheoryRef,
    foundation: &Foundation,
) -> (Vec<Node>, Vec<Node>, Vec<Node>) {
    let mut program = vec![name_node("linked-program"), name_node(&names.program)];
    for entry in &foundation.role_entries {
        program.push(Node::List(vec![
            name_node("uses"),
            name_node(&entry.program),
        ]));
    }
    let mut theory_use = vec![name_node("uses"), name_node(&theory.name)];
    for binding in &theory.rebind {
        theory_use.push(Node::List(vec![
            name_node("rebind"),
            name_node(&binding.from),
            name_node(&binding.to),
        ]));
    }
    program.push(Node::List(theory_use));
    // A guarded foundation closes a cycle only through a guard: the mirror
    // program copies each guard rule with its conclusion wrapped, so a
    // wrapped judgement proves that its last step was a guard.
    let mut guarded = Vec::new();
    if foundation.cycle_policy.kind == GUARDED_COINDUCTIVE {
        guarded.push(Node::List(vec![
            name_node("linked-program"),
            name_node(&names.guarded),
            Node::List(vec![name_node("uses"), name_node(&names.program)]),
        ]));
        for (index, clauses) in foundation.guard_clauses.iter().enumerate() {
            let mut rule = vec![
                name_node("linked-inference"),
                name_node(&names.guarded),
                name_node(&format!("guard-{}", index + 1)),
            ];
            for premise in &clauses.premises {
                rule.push(Node::List(vec![name_node("premise"), premise.clone()]));
            }
            rule.push(Node::List(vec![
                name_node("conclusion"),
                Node::List(vec![name_node(&names.guarded), clauses.conclusion.clone()]),
            ]));
            guarded.push(Node::List(rule));
        }
    }
    // The signature is a separate program whose rewrites admit exactly the
    // declared judgement shapes, so checking a query is one more reduction.
    let mut signature = Vec::new();
    if !foundation.signature.is_empty() {
        signature.push(Node::List(vec![
            name_node("linked-program"),
            name_node(&names.signature),
        ]));
        for (index, pattern) in foundation.signature.iter().enumerate() {
            signature.push(Node::List(vec![
                name_node("linked-rewrite"),
                name_node(&names.signature),
                name_node(&format!("admit-{}", index + 1)),
                Node::List(vec![
                    name_node("from"),
                    Node::List(vec![name_node(&names.signature), pattern.clone()]),
                ]),
                Node::List(vec![name_node("to"), name_node(ADMITTED)]),
            ]));
        }
    }
    (vec![Node::List(program)], guarded, signature)
}

// A spent step or contraction budget stops the work; a rewrite cycle or stall
// leaves the term without a normal form under the foundation's rules.
fn failure_status(normalization: GoalNormalization) -> &'static str {
    match normalization {
        GoalNormalization::RewriteLimit | GoalNormalization::ContractionLimit => "exhausted",
        _ => "unsupported",
    }
}

fn guarded_reason(ended: SearchEnd) -> &'static str {
    match ended {
        SearchEnd::Found => "guarded-found",
        SearchEnd::Saturated => "guarded-saturated",
        SearchEnd::InferenceLimit => "guarded-inference-limit",
        SearchEnd::FactLimit => "guarded-fact-limit",
    }
}

fn bounded(ended: SearchEnd) -> bool {
    !matches!(ended, SearchEnd::Found | SearchEnd::Saturated)
}

fn outcome_of(result: &FoundationResult) -> (&'static str, Option<String>, Vec<String>) {
    (
        result.status,
        result.normalized.as_ref().map(key_of),
        result
            .answers
            .iter()
            .flatten()
            .map(|answer| key_of(&answer.judgement))
            .collect(),
    )
}

fn collect_dependencies(
    proof: &FoundationProof,
    used_assumptions: &mut BTreeSet<usize>,
    rules: &mut BTreeMap<String, RuleDescription>,
) {
    if proof.program == ASSUMPTION_PROGRAM {
        let index = proof
            .rule
            .strip_prefix("assumption-")
            .and_then(|number| number.parse::<usize>().ok())
            .and_then(|number| number.checked_sub(1));
        if let Some(index) = index {
            used_assumptions.insert(index);
        }
    } else if proof.program != HYPOTHESIS_PROGRAM {
        let kind = if proof.premises.is_empty() {
            "fact"
        } else {
            "inference"
        };
        rules.insert(
            rule_key(kind, &proof.program, &proof.rule),
            RuleDescription {
                program: proof.program.clone(),
                rule: proof.rule.clone(),
                role: proof.role,
                kind,
            },
        );
    }
    for premise in &proof.premises {
        collect_dependencies(premise, used_assumptions, rules);
    }
}

/// The part of an outcome a question stage decides; `result` turns it into a
/// [`FoundationResult`].
#[derive(Default)]
struct Outcome {
    status: &'static str,
    reason: &'static str,
    detail: Option<String>,
    normalized: Option<Node>,
    proof: Option<FoundationProof>,
    answers: Option<Vec<FoundationAnswer>>,
    complete: Option<bool>,
    refutation: Option<Refutation>,
    coinduction: Option<Coinduction>,
    search: Option<SearchSummary>,
    traces: Vec<RewriteTraceStep>,
}

fn failure(stage: &str, stopped: ReductionStopped, traces: Vec<RewriteTraceStep>) -> Outcome {
    Outcome {
        status: failure_status(stopped.normalization),
        reason: stopped.normalization.as_str(),
        detail: Some(format!("{stage}: {}", stopped.detail)),
        traces,
        ..Outcome::default()
    }
}

/// The registries one question creates, so the result can report every host
/// operation they observed.
struct Session<'a> {
    workspace: &'a FoundationWorkspace,
    registries: RefCell<Vec<Rc<LinkedProgramRegistry>>>,
}

impl<'a> Session<'a> {
    fn new(workspace: &'a FoundationWorkspace) -> Self {
        Self {
            workspace,
            registries: RefCell::new(Vec::new()),
        }
    }

    fn registry(&self, forms: &[Node]) -> Result<Rc<LinkedProgramRegistry>, String> {
        let registry = Rc::new(
            LinkedProgramRegistry::from_forms_with_basis(
                forms,
                self.workspace.execution_basis,
                &self.workspace.disabled(),
            )?
            .with_max_contractions(self.workspace.registry.max_contractions())?,
        );
        self.registries.borrow_mut().push(Rc::clone(&registry));
        Ok(registry)
    }

    fn host_operations(&self) -> Vec<String> {
        let mut operations: BTreeSet<String> = self
            .workspace
            .registry
            .runtime_semantic_trace()
            .observed_operations
            .into_iter()
            .collect();
        for registry in self.registries.borrow().iter() {
            operations.extend(registry.runtime_semantic_trace().observed_operations);
        }
        operations.into_iter().collect()
    }
}

/// One question as asked.
struct Question<'a> {
    instance: &'a Instance,
    foundation: &'a Foundation,
    data: &'a InstanceData,
    query: &'a Node,
    assumptions: &'a [Node],
    bounds: FoundationBounds,
}

/// A question after its assumptions are normalized.
struct AskContext<'a> {
    question: &'a Question<'a>,
    session: &'a Session<'a>,
    registry: Rc<LinkedProgramRegistry>,
    normalized_assumptions: Vec<Node>,
}

/// Load linked foundations, theories, and instances and answer queries in
/// them. Build one with [`FoundationWorkspace::from_rml`] or
/// [`FoundationWorkspace::from_forms`].
#[derive(Debug, Clone)]
pub struct FoundationWorkspace {
    forms: Vec<Node>,
    plan: Plan,
    registry: LinkedProgramRegistry,
    execution_basis: ExecutionBasis,
    disabled_operations: Vec<String>,
    instance_data: BTreeMap<String, InstanceData>,
}

impl FoundationWorkspace {
    /// Parse linked source through the linked-program front end on the
    /// closed S/K basis and load every foundation, theory, and instance in
    /// it.
    pub fn from_rml(source: &str) -> Result<Self, String> {
        Self::from_rml_with_basis(source, ExecutionBasis::default(), &[])
    }

    /// Parse linked source like [`from_rml`](Self::from_rml) under a
    /// selected execution basis.
    pub fn from_rml_with_basis(
        source: &str,
        execution_basis: ExecutionBasis,
        disabled_operations: &[&str],
    ) -> Result<Self, String> {
        Self::require_rewriting(execution_basis)?;
        let mut planned = None;
        let registry = LinkedProgramRegistry::from_rml_expanded(
            source,
            execution_basis,
            disabled_operations,
            |parsed| {
                let forms = parsed.to_vec();
                let plan = plan_workspace(&forms)?;
                let synthesized = plan.synthesized.clone();
                planned = Some((forms, plan));
                Ok(synthesized)
            },
        )?;
        let Some((forms, plan)) = planned else {
            return Err("the linked front end loaded no forms".to_string());
        };
        Self::assemble(forms, plan, registry, execution_basis, disabled_operations)
    }

    /// Load already parsed top-level forms on the closed S/K basis.
    pub fn from_forms(forms: &[Node]) -> Result<Self, String> {
        Self::from_forms_with_basis(forms, ExecutionBasis::default(), &[])
    }

    /// Load already parsed top-level forms under a selected execution basis.
    pub fn from_forms_with_basis(
        forms: &[Node],
        execution_basis: ExecutionBasis,
        disabled_operations: &[&str],
    ) -> Result<Self, String> {
        Self::require_rewriting(execution_basis)?;
        let forms = forms.to_vec();
        let plan = plan_workspace(&forms)?;
        let mut loaded = forms.clone();
        loaded.extend(plan.synthesized.iter().cloned());
        let registry = LinkedProgramRegistry::from_forms_with_basis(
            &loaded,
            execution_basis,
            disabled_operations,
        )?;
        Self::assemble(forms, plan, registry, execution_basis, disabled_operations)
    }

    /// Bound the S/K contractions of each closed kernel call that a question
    /// makes, like the `maxContractions` option of `FoundationWorkspace.fromRml`
    /// in `js/src/rml-foundation-workspace.mjs`. A question that spends the
    /// budget ends `exhausted` with reason `contraction-limit`.
    pub fn with_max_contractions(mut self, max_contractions: usize) -> Result<Self, String> {
        self.registry = self.registry.with_max_contractions(max_contractions)?;
        Ok(self)
    }

    fn require_rewriting(execution_basis: ExecutionBasis) -> Result<(), String> {
        if execution_basis == ExecutionBasis::HornRelational {
            return Err(
                "foundation workspaces normalize judgements by rewriting, which the \
                        horn-relational basis does not perform"
                    .to_string(),
            );
        }
        Ok(())
    }

    fn assemble(
        forms: Vec<Node>,
        plan: Plan,
        registry: LinkedProgramRegistry,
        execution_basis: ExecutionBasis,
        disabled_operations: &[&str],
    ) -> Result<Self, String> {
        let mut workspace = Self {
            forms,
            plan,
            registry,
            execution_basis,
            disabled_operations: disabled_operations
                .iter()
                .map(|operation| (*operation).to_string())
                .collect(),
            instance_data: BTreeMap::new(),
        };
        workspace.check_role_kinds()?;
        for instance in &workspace.plan.instances {
            let data = workspace.instance_data_for(instance)?;
            workspace.instance_data.insert(instance.name.clone(), data);
        }
        Ok(workspace)
    }

    /// Describe every result status and what it establishes.
    pub fn result_statuses() -> Vec<ResultStatus> {
        RESULT_STATUSES.to_vec()
    }

    /// List the roles a foundation may declare and the rule kind each admits.
    pub fn roles() -> Vec<FoundationRole> {
        ROLE_KINDS
            .iter()
            .map(|&(role, kind)| FoundationRole { role, kind })
            .collect()
    }

    /// The execution basis every question of this workspace runs on.
    pub fn execution_basis(&self) -> ExecutionBasis {
        self.execution_basis
    }

    /// The S/K contractions each closed kernel call of a question may make.
    pub fn max_contractions(&self) -> usize {
        self.registry.max_contractions()
    }

    /// List loaded foundations, sorted by name and version.
    pub fn foundations(&self) -> Vec<FoundationRef> {
        let mut foundations: Vec<FoundationRef> = self
            .plan
            .foundations
            .iter()
            .map(|foundation| FoundationRef {
                name: foundation.name.clone(),
                version: foundation.version.clone(),
            })
            .collect();
        foundations.sort_by_cached_key(|item| foundation_key(&item.name, &item.version));
        foundations
    }

    /// List loaded instances with their theory and foundation, sorted.
    pub fn instances(&self) -> Vec<InstanceSummary> {
        let mut instances: Vec<InstanceSummary> = self
            .plan
            .instances
            .iter()
            .map(|instance| InstanceSummary {
                name: instance.name.clone(),
                theory: instance.theory.clone(),
                foundation: self.foundation_ref(instance),
            })
            .collect();
        instances.sort_by(|left, right| left.name.cmp(&right.name));
        instances
    }

    /// Describe one foundation as data: its dependencies, the programs of
    /// every role in its closure, its signature, its cycle policy, every rule
    /// with its role and kind, and the bootstrap kernel that executes it.
    /// Without a version the name must have exactly one loaded version.
    pub fn describe(&self, name: &str, version: Option<&str>) -> Result<FoundationPackage, String> {
        let reference = Reference {
            name: name_text(name, "described foundation")?,
            version: version.map(str::to_string),
        };
        let foundation = &self.plan.foundations[self.plan.resolve(&reference, "describe")?];
        let role_of = self.foundation_roles(foundation);
        let mut rules = Vec::new();
        let mut seen = BTreeSet::new();
        for entry in &foundation.role_entries {
            for program_name in uses_closure(&self.registry, &entry.program) {
                if !seen.insert(program_name.clone()) {
                    continue;
                }
                let role = role_of.get(&program_name).copied().unwrap_or(THEORY_ROLE);
                rules.extend(self.program_rules(&program_name, role));
            }
        }
        let kernel = LinkedProgramRegistry::bootstrap_kernel_report();
        let reference_of = |index: usize| FoundationRef {
            name: self.plan.foundations[index].name.clone(),
            version: self.plan.foundations[index].version.clone(),
        };
        Ok(FoundationPackage {
            schema: PACKAGE_SCHEMA,
            name: foundation.name.clone(),
            version: foundation.version.clone(),
            depends_on: foundation
                .dependencies
                .iter()
                .map(|&index| reference_of(index))
                .collect(),
            closure: foundation
                .closure
                .iter()
                .map(|&index| reference_of(index))
                .collect(),
            roles: foundation
                .role_entries
                .iter()
                .map(|entry| RoleDeclaration {
                    role: entry.role,
                    kind: role_kind(entry.role).unwrap_or_default(),
                    program: entry.program.clone(),
                    declared_by: entry.declared_by.clone(),
                })
                .collect(),
            signature: foundation.signature.clone(),
            cycle_policy: foundation.cycle_policy.clone(),
            rules,
            bootstrap: BootstrapDescription {
                kernel: kernel.name,
                operations: kernel.operations,
                execution_basis: self.execution_basis,
            },
        })
    }

    /// Ask a query of one instance. A ground query is normalized, searched
    /// for together with its refutation, and, under a guarded cycle policy,
    /// retried as a guarded cycle. A query with variables is a pattern: every
    /// derived instance is an answer. Assumptions are ground judgements added
    /// for this question only.
    pub fn ask(
        &self,
        instance_name: &str,
        query: &Node,
        assumptions: &[Node],
        bounds: FoundationBounds,
    ) -> Result<FoundationResult, String> {
        let instance = self.instance(instance_name)?;
        let data = self.data(instance);
        assert_term(query, "foundation query")?;
        for (index, assumption) in assumptions.iter().enumerate() {
            let context = format!("foundation assumption {}", index + 1);
            assert_term(assumption, &context)?;
            if has_variables(assumption) {
                return Err(format!("{context} must be ground"));
            }
        }
        let terms: Vec<&Node> = std::iter::once(query).chain(assumptions).collect();
        Self::reject_reserved(instance, &terms)?;
        let question = Question {
            instance,
            foundation: &self.plan.foundations[instance.foundation],
            data,
            query,
            assumptions,
            bounds: FoundationBounds {
                max_rounds: positive_bound(bounds.max_rounds, "max_rounds")?,
                max_facts: positive_bound(bounds.max_facts, "max_facts")?,
                max_steps: positive_bound(bounds.max_steps, "max_steps")?,
            },
        };
        let session = Session::new(self);
        if let Some(outcome) = self.outside_signature(&question, &terms, &session)? {
            return Ok(self.result(&question, &session, outcome));
        }

        let registry = session.registry(&self.instance_forms(instance, false))?;
        let mut normalized_assumptions = Vec::new();
        let mut traces = Vec::new();
        for (index, assumption) in assumptions.iter().enumerate() {
            match registry.reduce_or_stop(&instance.name, assumption, question.bounds.max_steps)? {
                Ok(reduced) => {
                    normalized_assumptions.push(reduced.term);
                    traces.extend(reduced.trace);
                }
                Err(stopped) => {
                    let outcome = failure(&format!("assumption {}", index + 1), stopped, traces);
                    return Ok(self.result(&question, &session, outcome));
                }
            }
        }
        let context = AskContext {
            question: &question,
            session: &session,
            registry,
            normalized_assumptions,
        };
        let outcome = if has_variables(query) {
            self.ask_pattern(&context, traces)?
        } else {
            self.ask_ground(&context, traces)?
        };
        Ok(self.result(&question, &session, outcome))
    }

    /// Reduce a term with the instance's rewrites and report every step with
    /// the role of the rule that made it.
    pub fn execute(
        &self,
        instance_name: &str,
        term: &Node,
        max_steps: usize,
    ) -> Result<FoundationExecution, String> {
        let instance = self.instance(instance_name)?;
        let data = self.data(instance);
        assert_term(term, "executed term")?;
        Self::reject_reserved(instance, &[term])?;
        positive_bound(max_steps, "max_steps")?;
        let session = Session::new(self);
        let registry = session.registry(&self.instance_forms(instance, false))?;
        let reduced = registry.reduce_or_stop(&instance.name, term, max_steps)?;
        let execution = FoundationExecution {
            schema: EXECUTION_SCHEMA,
            instance: instance.name.clone(),
            foundation: self.foundation_ref(instance),
            execution_basis: self.execution_basis,
            input: term.clone(),
            status: "normal",
            reason: "normal-form",
            detail: None,
            output: None,
            steps: None,
            trace: None,
            host_operations: Vec::new(),
        };
        let execution = match reduced {
            Err(stopped) => FoundationExecution {
                status: failure_status(stopped.normalization),
                reason: stopped.normalization.as_str(),
                detail: Some(stopped.detail),
                ..execution
            },
            Ok(reduced) => FoundationExecution {
                output: Some(reduced.term),
                steps: Some(reduced.trace.len()),
                trace: Some(
                    reduced
                        .trace
                        .into_iter()
                        .map(|step| ExecutionStep {
                            role: data.role_of(&step.program),
                            program: step.program,
                            rule: step.rule,
                            before: step.before,
                            after: step.after,
                        })
                        .collect(),
                ),
                ..execution
            },
        };
        Ok(FoundationExecution {
            host_operations: session.host_operations(),
            ..execution
        })
    }

    /// Tell whether `change` can alter `result`. A rewrite change inside the
    /// instance closure affects every result, because every judgement is
    /// normalized with the whole rewrite system. Otherwise a result whose
    /// evidence cannot be overturned by more derivations depends only on the
    /// rules and assumptions its proofs use.
    pub fn affected_by(
        &self,
        result: &FoundationResult,
        change: &FoundationChange,
    ) -> Result<bool, String> {
        let validated = self.validate_change(change)?;
        Ok(Self::affects(result, &validated))
    }

    /// Apply `change` and recheck exactly the results it affects. Returns the
    /// workspace after the change and one revision per result, each either
    /// `kept` or `rechecked`, with `changed` telling whether the outcome
    /// moved.
    pub fn revise(
        &self,
        results: &[FoundationResult],
        change: &FoundationChange,
    ) -> Result<FoundationRevision<'_>, String> {
        let validated = self.validate_change(change)?;
        let workspace = match &validated {
            ValidatedChange::Assumption { .. } => Cow::Borrowed(self),
            ValidatedChange::Rule { forms, .. } => Cow::Owned(
                Self::from_forms_with_basis(forms, self.execution_basis, &self.disabled())?
                    .with_max_contractions(self.registry.max_contractions())?,
            ),
        };
        let replaced = |assumptions: &[Node]| -> Vec<Node> {
            match &validated {
                ValidatedChange::Assumption { from_key, to } => assumptions
                    .iter()
                    .map(|item| {
                        if key_of(item) == *from_key {
                            to.clone()
                        } else {
                            item.clone()
                        }
                    })
                    .collect(),
                ValidatedChange::Rule { .. } => assumptions.to_vec(),
            }
        };
        let mut revisions = Vec::with_capacity(results.len());
        for before in results {
            if !Self::affects(before, &validated) {
                let mut after = before.clone();
                after.assumptions = replaced(&before.assumptions);
                revisions.push(ResultRevision {
                    action: "kept",
                    before: before.clone(),
                    after,
                    changed: false,
                });
                continue;
            }
            let after = workspace.ask(
                &before.instance,
                &before.query,
                &replaced(&before.assumptions),
                before.bounds,
            )?;
            let changed = outcome_of(before) != outcome_of(&after);
            revisions.push(ResultRevision {
                action: "rechecked",
                before: before.clone(),
                after,
                changed,
            });
        }
        Ok(FoundationRevision {
            workspace,
            revisions,
        })
    }

    fn ask_ground(
        &self,
        context: &AskContext,
        mut traces: Vec<RewriteTraceStep>,
    ) -> Result<Outcome, String> {
        let question = context.question;
        let instance = question.instance;
        let max_steps = question.bounds.max_steps;
        let goal =
            match context
                .registry
                .reduce_or_stop(&instance.name, question.query, max_steps)?
            {
                Ok(goal) => goal,
                Err(stopped) => return Ok(failure("goal", stopped, traces)),
            };
        traces.extend(goal.trace);
        let goal = goal.term;
        let refutation_query = Node::List(vec![name_node(REFUTATION_HEAD), goal.clone()]);
        let refutation =
            match context
                .registry
                .reduce_or_stop(&instance.name, &refutation_query, max_steps)?
            {
                Ok(refutation) => refutation,
                Err(stopped) => {
                    return Ok(Outcome {
                        normalized: Some(goal),
                        ..failure("refutation", stopped, traces)
                    })
                }
            };
        traces.extend(refutation.trace);
        let refutation = refutation.term;
        let defined = head_text(&refutation) != Some(REFUTATION_HEAD);
        let mut goals = vec![goal.clone()];
        if defined {
            goals.push(refutation.clone());
        }
        let search = match context.registry.search_or_stop(
            &instance.name,
            &goals,
            &context.normalized_assumptions,
            question.bounds.max_rounds,
            question.bounds.max_facts,
            max_steps,
        )? {
            Ok(search) => search,
            Err(stopped) => {
                return Ok(Outcome {
                    normalized: Some(goal),
                    ..failure("derivation", stopped, traces)
                })
            }
        };
        let goal_proof = search.goals.first().and_then(|item| item.proof.as_ref());
        let refutation_proof = if defined {
            search.goals.get(1).and_then(|item| item.proof.as_ref())
        } else {
            None
        };
        let bounded = bounded(search.ended);
        let refutation_status = if !defined {
            "undefined"
        } else if refutation_proof.is_some() {
            "derived"
        } else if bounded {
            "not-derived-within-bounds"
        } else {
            "not-derived"
        };
        let outcome = Outcome {
            normalized: Some(goal.clone()),
            proof: goal_proof.map(|proof| self.map_proof(context, proof, None)),
            refutation: Some(Refutation {
                judgement: defined.then_some(refutation),
                status: refutation_status,
                proof: refutation_proof.map(|proof| self.map_proof(context, proof, None)),
            }),
            search: Some(SearchSummary {
                ended: search.ended,
                facts: search.facts,
            }),
            traces,
            ..Outcome::default()
        };
        let (status, reason) = match (goal_proof.is_some(), refutation_proof.is_some()) {
            (true, true) => ("contradictory", "goal-and-refutation-derived"),
            (true, false) => ("proved", "goal-derived"),
            (false, true) => ("refuted", "refutation-derived"),
            (false, false) if bounded => ("exhausted", search.ended.as_str()),
            (false, false) if question.foundation.cycle_policy.kind == GUARDED_COINDUCTIVE => {
                return self.ask_guarded(context, goal, outcome)
            }
            (false, false) => ("unknown", "saturated-without-proof"),
        };
        Ok(Outcome {
            status,
            reason,
            ..outcome
        })
    }

    // Retry an underived ground goal as a guarded cycle: assume the goal and
    // derive it again through a final guard step. Every use of the
    // hypothesis then sits beneath a guard, so unfolding the cycle is
    // productive. The guard must be the last step of the cycle.
    fn ask_guarded(
        &self,
        context: &AskContext,
        hypothesis: Node,
        outcome: Outcome,
    ) -> Result<Outcome, String> {
        let question = context.question;
        let names = &question.instance.names;
        if let Some(open) = Self::wrapper_rewrite(question.data, 2) {
            return Ok(Outcome {
                status: "unsupported",
                reason: "synthesized-link-rewritable",
                detail: Some(format!(
                    "hypothesis: linked-rewrite {}.{} could rewrite the guard link {}",
                    open.program, open.rule, names.guarded
                )),
                ..outcome
            });
        }
        let registry = context
            .session
            .registry(&self.instance_forms(question.instance, true))?;
        let mut facts = context.normalized_assumptions.clone();
        facts.push(hypothesis.clone());
        let goal = Node::List(vec![name_node(&names.guarded), hypothesis.clone()]);
        let search = match registry.search_or_stop(
            &names.guarded,
            &[goal],
            &facts,
            question.bounds.max_rounds,
            question.bounds.max_facts,
            question.bounds.max_steps,
        )? {
            Ok(search) => search,
            Err(stopped) => {
                let failed = failure("hypothesis", stopped, Vec::new());
                return Ok(Outcome {
                    status: failed.status,
                    reason: failed.reason,
                    detail: failed.detail,
                    ..outcome
                });
            }
        };
        let proof = search.goals.first().and_then(|item| item.proof.as_ref());
        let bounded = bounded(search.ended);
        let coinduction = Coinduction {
            hypothesis,
            guards: question.foundation.cycle_policy.guards.clone(),
            status: if proof.is_some() {
                "derived"
            } else if bounded {
                "not-derived-within-bounds"
            } else {
                "not-derived"
            },
            search: SearchSummary {
                ended: search.ended,
                facts: search.facts,
            },
        };
        if let Some(proof) = proof {
            let hypothesis_index = context.normalized_assumptions.len() + 1;
            return Ok(Outcome {
                status: "proved",
                reason: "guarded-coinduction",
                proof: Some(self.map_proof(context, proof, Some(hypothesis_index))),
                coinduction: Some(coinduction),
                ..outcome
            });
        }
        let (status, reason) = if bounded {
            ("exhausted", guarded_reason(search.ended))
        } else {
            ("unknown", "saturated-without-proof")
        };
        Ok(Outcome {
            status,
            reason,
            coinduction: Some(coinduction),
            ..outcome
        })
    }

    fn ask_pattern(
        &self,
        context: &AskContext,
        mut traces: Vec<RewriteTraceStep>,
    ) -> Result<Outcome, String> {
        let question = context.question;
        let instance = question.instance;
        let constant_head =
            |term: &Node| head_text(term).is_some_and(|head| !head.starts_with('?'));
        if !constant_head(question.query) {
            return Ok(Outcome {
                status: "unsupported",
                reason: "pattern-without-constant-head",
                detail: Some(
                    "pattern: a pattern query must be a link whose head is a name".to_string(),
                ),
                traces,
                ..Outcome::default()
            });
        }
        let pattern = match context.registry.reduce_or_stop(
            &instance.name,
            question.query,
            question.bounds.max_steps,
        )? {
            Ok(pattern) => pattern,
            Err(stopped) => return Ok(failure("pattern", stopped, traces)),
        };
        traces.extend(pattern.trace);
        let pattern = pattern.term;
        if !constant_head(&pattern) {
            return Ok(Outcome {
                status: "unsupported",
                reason: "pattern-without-constant-head",
                detail: Some(format!(
                    "pattern: the pattern normalizes to {}",
                    key_of(&pattern)
                )),
                normalized: Some(pattern),
                traces,
                ..Outcome::default()
            });
        }
        let mut variables = Vec::new();
        variables_in(&pattern, &mut variables);
        let answer = &instance.names.answer;
        if let Some(open) = Self::wrapper_rewrite(question.data, variables.len() + 2) {
            return Ok(Outcome {
                status: "unsupported",
                reason: "synthesized-link-rewritable",
                detail: Some(format!(
                    "pattern: linked-rewrite {}.{} could rewrite the answer link {answer}",
                    open.program, open.rule
                )),
                normalized: Some(pattern),
                traces,
                ..Outcome::default()
            });
        }
        let mut forms = self.instance_forms(instance, false);
        forms.push(Node::List(vec![
            name_node("linked-program"),
            name_node(answer),
            Node::List(vec![name_node("uses"), name_node(&instance.name)]),
        ]));
        let mut conclusion = vec![name_node(answer), pattern.clone()];
        conclusion.extend(variables.iter().map(|variable| name_node(variable)));
        forms.push(Node::List(vec![
            name_node("linked-inference"),
            name_node(answer),
            name_node("answer"),
            Node::List(vec![name_node("premise"), pattern.clone()]),
            Node::List(vec![name_node("conclusion"), Node::List(conclusion)]),
        ]));
        let answer_registry = context.session.registry(&forms)?;
        let search = match answer_registry.search_or_stop(
            answer,
            &[],
            &context.normalized_assumptions,
            question.bounds.max_rounds,
            question.bounds.max_facts,
            question.bounds.max_steps,
        )? {
            Ok(search) => search,
            Err(stopped) => {
                return Ok(Outcome {
                    normalized: Some(pattern),
                    ..failure("derivation", stopped, traces)
                })
            }
        };
        let mut answers: Vec<FoundationAnswer> = search
            .derived
            .iter()
            .filter_map(|item| {
                let Node::List(parts) = &item.judgement else {
                    return None;
                };
                if leaf_text(parts.first()) != Some(answer.as_str()) {
                    return None;
                }
                let bindings = variables
                    .iter()
                    .enumerate()
                    .map(|(index, variable)| {
                        Some((variable.clone(), parts.get(index + 2)?.clone()))
                    })
                    .collect::<Option<Vec<_>>>()?;
                Some(FoundationAnswer {
                    judgement: parts.get(1)?.clone(),
                    bindings,
                    proof: self.map_proof(context, item.proof.premises.first()?, None),
                })
            })
            .collect();
        answers.sort_by_cached_key(|item| key_of(&item.judgement));
        // Answers come from saturation alone. Under a guarded cycle policy a
        // ground query can also establish an instance through a guarded
        // cycle, so only an inductive foundation can report its answers
        // complete.
        let complete = search.ended == SearchEnd::Saturated
            && question.foundation.cycle_policy.kind == INDUCTIVE;
        let (status, reason) = if !answers.is_empty() {
            ("proved", "instances-derived")
        } else if search.ended == SearchEnd::Saturated {
            ("unknown", "saturated-without-instances")
        } else {
            ("exhausted", search.ended.as_str())
        };
        Ok(Outcome {
            status,
            reason,
            normalized: Some(pattern),
            answers: Some(answers),
            complete: Some(complete),
            search: Some(SearchSummary {
                ended: search.ended,
                facts: search.facts,
            }),
            traces,
            ..Outcome::default()
        })
    }

    fn wrapper_rewrite(data: &InstanceData, length: usize) -> Option<&OpenRewrite> {
        data.open_rewrites
            .iter()
            .find(|rule| rule.length.is_none_or(|rule_length| rule_length == length))
    }

    // Map engine proofs to foundation proofs: assumptions and the
    // coinductive hypothesis become labelled leaves, guard mirror steps name
    // the original guard rule, and every step carries the role of its
    // program.
    fn map_proof(
        &self,
        context: &AskContext,
        proof: &LinkedProof,
        hypothesis_index: Option<usize>,
    ) -> FoundationProof {
        let question = context.question;
        if proof.program == INPUT_PROGRAM {
            let number = proof.rule.strip_prefix("input-").unwrap_or(&proof.rule);
            let index = number.parse::<usize>().ok();
            if index.is_some() && index == hypothesis_index {
                return FoundationProof {
                    judgement: proof.judgement.clone(),
                    program: HYPOTHESIS_PROGRAM.to_string(),
                    rule: "coinductive-hypothesis".to_string(),
                    role: "hypothesis",
                    premises: Vec::new(),
                };
            }
            return FoundationProof {
                judgement: proof.judgement.clone(),
                program: ASSUMPTION_PROGRAM.to_string(),
                rule: format!("assumption-{number}"),
                role: "assumption",
                premises: Vec::new(),
            };
        }
        let premises = proof
            .premises
            .iter()
            .map(|premise| self.map_proof(context, premise, hypothesis_index))
            .collect();
        if proof.program == question.instance.names.guarded {
            let guard = proof
                .rule
                .strip_prefix("guard-")
                .and_then(|number| number.parse::<usize>().ok())
                .and_then(|number| number.checked_sub(1))
                .and_then(|index| question.foundation.cycle_policy.guards.get(index));
            if let Some(guard) = guard {
                let judgement = match &proof.judgement {
                    Node::List(parts) if parts.len() == 2 => parts[1].clone(),
                    other => other.clone(),
                };
                return FoundationProof {
                    judgement,
                    program: guard.program.clone(),
                    rule: guard.rule.clone(),
                    role: question.data.role_of(&guard.program),
                    premises,
                };
            }
        }
        FoundationProof {
            judgement: proof.judgement.clone(),
            program: proof.program.clone(),
            rule: proof.rule.clone(),
            role: question.data.role_of(&proof.program),
            premises,
        }
    }

    fn result(&self, question: &Question, session: &Session, outcome: Outcome) -> FoundationResult {
        let ground = outcome.answers.is_none();
        let refutation_undefined = outcome
            .refutation
            .as_ref()
            .is_some_and(|refutation| refutation.status == "undefined");
        let evidence_scoped = ground
            && (outcome.status == "contradictory"
                || (outcome.status == "proved" && refutation_undefined));
        let mut used_assumptions = BTreeSet::new();
        let mut rules = BTreeMap::new();
        let proofs = outcome
            .proof
            .iter()
            .chain(
                outcome
                    .refutation
                    .iter()
                    .filter_map(|refutation| refutation.proof.as_ref()),
            )
            .chain(outcome.answers.iter().flatten().map(|answer| &answer.proof));
        for proof in proofs {
            collect_dependencies(proof, &mut used_assumptions, &mut rules);
        }
        for step in &outcome.traces {
            rules.insert(
                rule_key("rewrite", &step.program, &step.rule),
                RuleDescription {
                    program: step.program.clone(),
                    rule: step.rule.clone(),
                    role: question.data.role_of(&step.program),
                    kind: "rewrite",
                },
            );
        }
        let dependency_assumptions = if evidence_scoped {
            used_assumptions
                .iter()
                .filter_map(|&index| question.assumptions.get(index).cloned())
                .collect()
        } else {
            question.assumptions.to_vec()
        };
        let instance = question.instance;
        FoundationResult {
            schema: RESULT_SCHEMA,
            instance: instance.name.clone(),
            theory: instance.theory.clone(),
            foundation: self.foundation_ref(instance),
            execution_basis: self.execution_basis,
            query: question.query.clone(),
            normalized: outcome.normalized,
            assumptions: question.assumptions.to_vec(),
            status: outcome.status,
            reason: outcome.reason,
            detail: outcome.detail,
            proof: outcome.proof,
            answers: outcome.answers,
            complete: outcome.complete,
            refutation: outcome.refutation,
            coinduction: outcome.coinduction,
            cycle_policy: question.foundation.cycle_policy.clone(),
            dependencies: Dependencies {
                scope: if evidence_scoped {
                    "evidence"
                } else {
                    "closure"
                },
                assumptions: dependency_assumptions,
                rules: rules.into_values().collect(),
                closure: question
                    .data
                    .closure
                    .iter()
                    .map(|program| ClosureMember {
                        program: program.clone(),
                        role: question.data.role_of(program),
                    })
                    .collect(),
            },
            search: outcome.search,
            bounds: question.bounds,
            host_operations: session.host_operations(),
        }
    }

    // Check the query and assumptions against the signature in a registry
    // that holds only the signature program, so no theory rule can admit a
    // judgement. One rewrite per position suffices. Return the outcome of a
    // term outside the signature or of a check that spent its budget.
    fn outside_signature(
        &self,
        question: &Question,
        terms: &[&Node],
        session: &Session,
    ) -> Result<Option<Outcome>, String> {
        let instance = question.instance;
        if instance.signature_forms.is_empty() {
            return Ok(None);
        }
        let signature = &instance.names.signature;
        let registry = session.registry(&instance.signature_forms)?;
        let mut checks = vec![name_node("checks")];
        checks.extend(
            terms
                .iter()
                .map(|term| Node::List(vec![name_node(signature), (*term).clone()])),
        );
        let checked =
            match registry.reduce_or_stop(signature, &Node::List(checks), terms.len() + 1)? {
                Ok(reduced) => reduced.term,
                Err(stopped) => return Ok(Some(failure("signature", stopped, Vec::new()))),
            };
        let admitted = name_node(ADMITTED);
        let outside: Vec<String> = terms
            .iter()
            .enumerate()
            .filter(|(index, _)| {
                !matches!(&checked, Node::List(parts) if parts.get(index + 1) == Some(&admitted))
            })
            .map(|(_, term)| key_of(term))
            .collect();
        if outside.is_empty() {
            return Ok(None);
        }
        Ok(Some(Outcome {
            status: "unsupported",
            reason: "outside-signature",
            detail: Some(format!(
                "signature: {} matches no signature pattern of {} version {}",
                outside.join(", "),
                question.foundation.name,
                question.foundation.version
            )),
            ..Outcome::default()
        }))
    }

    fn reject_reserved(instance: &Instance, terms: &[&Node]) -> Result<(), String> {
        let reserved = instance.names.reserved();
        for term in terms {
            if let Some(leaf) = first_reserved(term, &reserved) {
                return Err(format!(
                    "linked-instance {} reserves {leaf} for its own programs",
                    instance.name
                ));
            }
        }
        Ok(())
    }

    fn disabled(&self) -> Vec<&str> {
        self.disabled_operations
            .iter()
            .map(String::as_str)
            .collect()
    }

    fn instance(&self, name: &str) -> Result<&Instance, String> {
        self.plan
            .instance_index
            .get(name)
            .map(|&index| &self.plan.instances[index])
            .ok_or_else(|| format!("unknown linked-instance {name}"))
    }

    fn data(&self, instance: &Instance) -> &InstanceData {
        &self.instance_data[&instance.name]
    }

    fn foundation_ref(&self, instance: &Instance) -> FoundationRef {
        let foundation = &self.plan.foundations[instance.foundation];
        FoundationRef {
            name: foundation.name.clone(),
            version: foundation.version.clone(),
        }
    }

    /// The loaded forms of an instance closure and the synthesized instance
    /// program, with the guard mirror when `guarded` is set.
    fn instance_forms(&self, instance: &Instance, guarded: bool) -> Vec<Node> {
        let mut forms = self.data(instance).forms.clone();
        forms.extend(instance.program_forms.iter().cloned());
        if guarded {
            forms.extend(instance.guarded_forms.iter().cloned());
        }
        forms
    }

    // Direct role declarations win, then the first role whose program uses
    // the program; every other program of an instance belongs to its theory.
    fn foundation_roles(&self, foundation: &Foundation) -> BTreeMap<String, &'static str> {
        let mut role_of = foundation.declared.clone();
        for entry in &foundation.role_entries {
            for name in uses_closure(&self.registry, &entry.program) {
                role_of.entry(name).or_insert(entry.role);
            }
        }
        role_of
    }

    fn program_rules(&self, program_name: &str, role: &'static str) -> Vec<RuleDescription> {
        let Some(program) = self.registry.program(program_name) else {
            return Vec::new();
        };
        RULE_KINDS
            .iter()
            .flat_map(|&kind| {
                rule_names(program, kind)
                    .into_iter()
                    .map(move |rule| RuleDescription {
                        program: program_name.to_string(),
                        rule,
                        role,
                        kind,
                    })
            })
            .collect()
    }

    fn check_role_kinds(&self) -> Result<(), String> {
        for foundation in &self.plan.foundations {
            for entry in &foundation.role_entries {
                let kind = role_kind(entry.role).unwrap_or_default();
                for name in uses_closure(&self.registry, &entry.program) {
                    let Some(program) = self.registry.program(&name) else {
                        continue;
                    };
                    for &other in RULE_KINDS {
                        if other == kind {
                            continue;
                        }
                        if let Some(first) = rule_names(program, other).first() {
                            return Err(format!(
                                "{} declares {} as {}, which admits only {kind} rules, but \
                                 linked-program {name} has {other} {first}",
                                foundation.context, entry.program, entry.role
                            ));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn instance_data_for(&self, instance: &Instance) -> Result<InstanceData, String> {
        let closure: Vec<String> = uses_closure(&self.registry, &instance.name)
            .into_iter()
            .skip(1)
            .collect();
        let role_of = self.foundation_roles(&self.plan.foundations[instance.foundation]);
        let reserved = instance.names.reserved();
        // The workspace wraps judgements in links headed by its reserved
        // names. No rule mentions those names, so only a rewrite whose
        // pattern is a variable or a link with a variable head could rewrite
        // such a wrapper.
        let scan = |terms: &[&Node], place: &dyn Fn() -> String| -> Result<(), String> {
            for term in terms {
                if let Some(leaf) = first_reserved(term, &reserved) {
                    return Err(format!(
                        "linked-instance {} reserves {leaf} for its own programs, but {} mentions it",
                        instance.name,
                        place()
                    ));
                }
            }
            Ok(())
        };
        let mut open_rewrites = Vec::new();
        for name in std::iter::once(&instance.name).chain(&closure) {
            let Some(program) = self.registry.program(name) else {
                continue;
            };
            for dependency in &program.uses {
                for (from, to) in &dependency.rebindings {
                    scan(&[&name_node(from), &name_node(to)], &|| {
                        format!("linked-program {name} rebinding")
                    })?;
                }
            }
            for rule in &program.rewrites {
                scan(&[&rule.pattern, &rule.replacement], &|| {
                    format!("linked-rewrite {name}.{}", rule.name)
                })?;
                let open = match &rule.pattern {
                    Node::List(parts) => parts.first().is_some_and(is_variable),
                    pattern => is_variable(pattern),
                };
                if open {
                    open_rewrites.push(OpenRewrite {
                        program: name.clone(),
                        rule: rule.name.clone(),
                        length: match &rule.pattern {
                            Node::List(parts) => Some(parts.len()),
                            Node::Leaf(_) => None,
                        },
                    });
                }
            }
            for fact in &program.facts {
                scan(&[&fact.judgement], &|| {
                    format!("linked-fact {name}.{}", fact.name)
                })?;
            }
            for rule in &program.inferences {
                let terms: Vec<&Node> = rule
                    .premises
                    .iter()
                    .chain(std::iter::once(&rule.conclusion))
                    .collect();
                scan(&terms, &|| format!("linked-inference {name}.{}", rule.name))?;
            }
        }
        let members: BTreeSet<&str> = closure.iter().map(String::as_str).collect();
        let forms = self
            .forms
            .iter()
            .filter(|form| {
                let Node::List(parts) = form else {
                    return false;
                };
                let loads = leaf_text(parts.first()).is_some_and(|head| {
                    head == "linked-program" || rule_kind_of_head(head).is_some()
                });
                loads && leaf_text(parts.get(1)).is_some_and(|program| members.contains(program))
            })
            .cloned()
            .collect();
        Ok(InstanceData {
            closure,
            role_of,
            forms,
            open_rewrites,
        })
    }

    fn affects(result: &FoundationResult, change: &ValidatedChange) -> bool {
        let dependencies = &result.dependencies;
        match change {
            ValidatedChange::Assumption { from_key, .. } => {
                if !result
                    .assumptions
                    .iter()
                    .any(|item| key_of(item) == *from_key)
                {
                    return false;
                }
                if dependencies.scope == "evidence" {
                    return dependencies
                        .assumptions
                        .iter()
                        .any(|item| key_of(item) == *from_key);
                }
                true
            }
            ValidatedChange::Rule {
                action,
                program,
                rule,
                kinds,
                ..
            } => {
                if result.reason == "outside-signature" {
                    return false;
                }
                if !dependencies
                    .closure
                    .iter()
                    .any(|entry| entry.program == *program)
                {
                    return false;
                }
                if kinds.contains("rewrite") || dependencies.scope == "closure" {
                    return true;
                }
                if *action == "add" {
                    return false;
                }
                dependencies.rules.iter().any(|dependency| {
                    dependency.program == *program
                        && dependency.rule == *rule
                        && kinds.contains(dependency.kind)
                })
            }
        }
    }

    // Normalize a change into the program and rule kinds it touches and, for
    // rule changes, the forms of the workspace after it.
    fn validate_change(&self, change: &FoundationChange) -> Result<ValidatedChange, String> {
        if let FoundationChange::ReplaceAssumption { from, to } = change {
            for (term, side) in [(from, "from"), (to, "to")] {
                assert_term(term, &format!("ReplaceAssumption {side}"))?;
                if has_variables(term) {
                    return Err("replaced assumptions must be ground".to_string());
                }
            }
            return Ok(ValidatedChange::Assumption {
                from_key: key_of(from),
                to: to.clone(),
            });
        }
        let rule_forms: Vec<(usize, &[Node], &'static str)> = self
            .forms
            .iter()
            .enumerate()
            .filter_map(|(index, form)| match form {
                Node::List(parts) => leaf_text(parts.first())
                    .and_then(rule_kind_of_head)
                    .map(|kind| (index, parts.as_slice(), kind)),
                Node::Leaf(_) => None,
            })
            .collect();
        let parsed_programs: BTreeSet<&str> = self
            .forms
            .iter()
            .filter(|form| head_text(form) == Some("linked-program"))
            .filter_map(|form| match form {
                Node::List(parts) => leaf_text(parts.get(1)),
                Node::Leaf(_) => None,
            })
            .collect();
        let target = |program: &str, rule: &str| -> Result<(usize, &'static str), String> {
            let matches: Vec<&(usize, &[Node], &'static str)> = rule_forms
                .iter()
                .filter(|(_, parts, _)| {
                    leaf_text(parts.get(1)) == Some(program)
                        && leaf_text(parts.get(2)) == Some(rule)
                })
                .collect();
            match matches.as_slice() {
                [] => Err(format!("no linked rule {program}.{rule} to change")),
                [(index, _, kind)] => Ok((*index, *kind)),
                _ => Err(format!(
                    "linked rule {program}.{rule} names rules of several kinds"
                )),
            }
        };
        let rule_form =
            |form: &Node, change_name: &str| -> Result<(String, String, &'static str), String> {
                let kind = head_text(form).and_then(rule_kind_of_head).ok_or_else(|| {
                    format!(
                    "{change_name} must be a linked-rewrite, linked-fact, or linked-inference form"
                )
                })?;
                let Node::List(parts) = form else {
                    unreachable!("a form with a rule head is a link");
                };
                let program = name_leaf(parts.get(1), &format!("{change_name} program"))?;
                let rule = name_leaf(parts.get(2), &format!("{change_name} rule"))?;
                if !parsed_programs.contains(program.as_str()) {
                    return Err(format!(
                        "{change_name} targets {program}, which is not a loaded linked-program"
                    ));
                }
                Ok((program, rule, kind))
            };
        match change {
            FoundationChange::ReplaceAssumption { .. } => unreachable!("handled above"),
            FoundationChange::AddRule(form) => {
                let (program, rule, kind) = rule_form(form, "AddRule")?;
                let exists = rule_forms.iter().any(|(_, parts, existing)| {
                    leaf_text(parts.get(1)) == Some(program.as_str())
                        && leaf_text(parts.get(2)) == Some(rule.as_str())
                        && *existing == kind
                });
                if exists {
                    return Err(format!("linked rule {program}.{rule} already exists"));
                }
                let mut forms = self.forms.clone();
                forms.push(form.clone());
                Ok(ValidatedChange::Rule {
                    action: "add",
                    program,
                    rule,
                    kinds: BTreeSet::from([kind]),
                    forms,
                })
            }
            FoundationChange::ReplaceRule(form) => {
                let (program, rule, kind) = rule_form(form, "ReplaceRule")?;
                let (index, existing) = target(&program, &rule)?;
                let mut forms = self.forms.clone();
                forms[index] = form.clone();
                Ok(ValidatedChange::Rule {
                    action: "replace",
                    program,
                    rule,
                    kinds: BTreeSet::from([existing, kind]),
                    forms,
                })
            }
            FoundationChange::RemoveRule { program, rule } => {
                let program = name_text(program, "RemoveRule program")?;
                let rule = name_text(rule, "RemoveRule rule")?;
                let (index, existing) = target(&program, &rule)?;
                let mut forms = self.forms.clone();
                forms.remove(index);
                Ok(ValidatedChange::Rule {
                    action: "remove",
                    program,
                    rule,
                    kinds: BTreeSet::from([existing]),
                    forms,
                })
            }
        }
    }
}
