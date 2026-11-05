//! Recursive semantic closure as one addressed links network, plus validation
//! of foundation-declared universe and soundness contracts. Mirrors
//! `js/src/rml-semantic-closure.mjs`.
//!
//! [`project_semantic_closure`] lowers actual host objects -- linked programs
//! and their rules, foundation packages, workspace judgements with their
//! proofs, assumptions and pattern substitutions, reduction values and a
//! selected ontology -- into doublets stored by [`TypedSemanticArchive`].
//! Anonymous structure is content-addressed, so equal subterms and shared
//! subproofs keep one identity; named programs, rules and foundations keep
//! their declared identity, so program/rule back references form cycles.
//! Categories are links and membership is stated by linked type facts.
//!
//! [`validate_semantic_closure`] checks closure, content addresses, named
//! identities, record schemas, back references, reachability and category
//! membership, then reconstructs the host-level records. The encoding is a
//! declared representation convention; it adds no inference rule, universe
//! axiom, proof admission or soundness claim.
//!
//! [`validate_universe_contract`] reads a foundation's universe policy, order,
//! typing judgement and soundness obligations through the public workspace and
//! checks them relative to that declaration. It is not a universal
//! well-foundedness or consistency checker.
use crate::foundation_workspace::{
    FoundationBounds, FoundationPackage, FoundationProof, FoundationRef, FoundationResult,
    FoundationWorkspace, Guard,
};
use crate::linked_program::{
    InferenceRule, LinkedFact, LinkedProgram, LinkedProgramRegistry, ProgramImport,
    ReductionResult, RewriteRule,
};
use crate::semantic_archive::TypedSemanticArchive;
use crate::theory_network::{TypedLinkNetwork, TypedLinkNetworkSnapshot};
use crate::{emit_lino_term, Node};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const SEMANTIC_CLOSURE_SCHEMA: &str = "rml-semantic-closure/v1";
pub const UNIVERSE_CONTRACT_SCHEMA: &str = "rml-universe-contract/v1";
pub const SEMANTIC_CLOSURE_CATEGORIES: [&str; 11] = [
    "term",
    "address",
    "type",
    "value",
    "rule",
    "substitution",
    "judgement",
    "proof",
    "foundation",
    "ontology",
    "program",
];
const ROOT: &str = "rml.closure";
const NIL: &str = "rml.nil";
const ONTOLOGY: &str = "rml.ontology";
const CATEGORY_ROOT: &str = "rml.category";
const ANONYMOUS: [&str; 4] = ["proof", "substitution", "judgement", "value"];

fn labelled_role(role: &str) -> bool {
    role == "assumption" || role == "hypothesis"
}
fn framed(text: &str) -> String {
    format!("{}:{}", text.len(), text)
}
/// Injective content address of an ordered pair of addresses.
pub fn closure_hash(left: &str, right: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(format!("{}{}", framed(left), framed(right)).as_bytes());
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn atom_address(text: &str) -> String {
    format!("rml.atom/{text}")
}
fn tag_address(kind: &str) -> String {
    atom_address(&format!("rml.{kind}"))
}
fn category_address(name: &str) -> String {
    format!("{CATEGORY_ROOT}/{name}")
}
fn program_address(name: &str) -> String {
    format!("rml.program/{name}")
}
fn rule_address(kind: &str, program: &str, name: &str) -> String {
    format!("rml.rule/{kind}/{}/{name}", framed(program))
}
fn foundation_address(name: &str, version: &str) -> String {
    format!("rml.foundation/{}/{version}", framed(name))
}
fn fact_address(subject: &str, category: &str) -> String {
    format!("rml.typed/{}", closure_hash(subject, category))
}

/// Incremental doublet table with content-addressed structure.
#[derive(Debug, Clone, Default)]
pub struct SemanticClosureBuilder {
    links: BTreeMap<String, (String, String)>,
    facts: BTreeMap<String, (String, String)>,
}

impl SemanticClosureBuilder {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn from_snapshot(snapshot: &TypedLinkNetworkSnapshot) -> Self {
        Self {
            links: snapshot
                .links
                .iter()
                .map(|(a, s, t)| (a.clone(), (s.clone(), t.clone())))
                .collect(),
            facts: snapshot
                .type_facts
                .iter()
                .map(|(a, s, t)| (a.clone(), (s.clone(), t.clone())))
                .collect(),
        }
    }
    pub fn link(&mut self, address: &str, source: &str, target: &str) -> Result<String, String> {
        if let Some((known_source, known_target)) = self.links.get(address) {
            if known_source != source || known_target != target {
                return Err(format!(
                    "semantic closure identity {address} has two definitions"
                ));
            }
        }
        self.links.insert(
            address.to_string(),
            (source.to_string(), target.to_string()),
        );
        Ok(address.to_string())
    }
    pub fn replace(&mut self, address: &str, source: &str, target: &str) -> String {
        self.links.insert(
            address.to_string(),
            (source.to_string(), target.to_string()),
        );
        address.to_string()
    }
    pub fn atom(&mut self, text: &str) -> Result<String, String> {
        if text.is_empty() {
            return Err("semantic closure atoms must be non-empty strings".to_string());
        }
        let address = atom_address(text);
        self.link(&address, &address, &address)?;
        self.classify(&address, "address");
        Ok(address)
    }
    pub fn nil(&mut self) -> String {
        self.links
            .insert(NIL.to_string(), (NIL.to_string(), NIL.to_string()));
        NIL.to_string()
    }
    pub fn seq(&mut self, addresses: &[String]) -> Result<String, String> {
        let mut tail = self.nil();
        for head in addresses.iter().rev() {
            let address = format!("rml.cons/{}", closure_hash(head, &tail));
            tail = self.link(&address, head, &tail)?;
        }
        Ok(tail)
    }
    /// Encode a term and record its `term` category.
    pub fn term(&mut self, node: &Node) -> Result<String, String> {
        let address = self.raw_term(node)?;
        self.classify(&address, "term");
        Ok(address)
    }
    fn raw_term(&mut self, node: &Node) -> Result<String, String> {
        match node {
            Node::Leaf(text) => self.atom(text),
            Node::List(children) => {
                let mut items = Vec::with_capacity(children.len());
                for child in children {
                    items.push(self.raw_term(child)?);
                }
                self.seq(&items)
            }
        }
    }
    pub fn anonymous(&mut self, kind: &str, payload: &str) -> Result<String, String> {
        let tag = self.atom(&format!("rml.{kind}"))?;
        let address = format!("rml.{kind}/{}", closure_hash(&tag, payload));
        self.link(&address, &tag, payload)?;
        self.classify(&address, kind);
        Ok(address)
    }
    pub fn named(
        &mut self,
        address: &str,
        kind: &str,
        payload: &str,
        category: Option<&str>,
    ) -> Result<String, String> {
        let tag = self.atom(&format!("rml.{kind}"))?;
        self.link(address, &tag, payload)?;
        if let Some(category) = category {
            self.classify(address, category);
        }
        Ok(address.to_string())
    }
    pub fn category(&mut self, name: &str) -> String {
        self.links.insert(
            CATEGORY_ROOT.to_string(),
            (CATEGORY_ROOT.to_string(), CATEGORY_ROOT.to_string()),
        );
        let address = category_address(name);
        self.links.insert(
            address.clone(),
            (CATEGORY_ROOT.to_string(), address.clone()),
        );
        if name == "type" {
            self.facts.insert(
                fact_address(&address, &address),
                (address.clone(), address.clone()),
            );
        } else {
            self.classify(&address, "type");
        }
        address
    }
    /// Record a linked category fact `(subject, rml.category/NAME)`.
    pub fn classify(&mut self, subject: &str, category: &str) -> String {
        let kind = self.category(category);
        self.facts
            .insert(fact_address(subject, &kind), (subject.to_string(), kind));
        subject.to_string()
    }
    /// Keep only rows reachable from the roots, as a strict archive requires.
    pub fn snapshot(&self, roots: &[String]) -> TypedLinkNetworkSnapshot {
        let (links, facts) = reachable_from(roots, &self.links, &self.facts);
        TypedLinkNetworkSnapshot {
            links: self
                .links
                .iter()
                .filter(|(address, _)| links.contains(address.as_str()))
                .map(|(a, (s, t))| (a.clone(), s.clone(), t.clone()))
                .collect(),
            type_facts: self
                .facts
                .iter()
                .filter(|(address, _)| facts.contains(address.as_str()))
                .map(|(a, (s, t))| (a.clone(), s.clone(), t.clone()))
                .collect(),
        }
    }
}

fn reachable_from(
    roots: &[String],
    links: &BTreeMap<String, (String, String)>,
    facts: &BTreeMap<String, (String, String)>,
) -> (BTreeSet<String>, BTreeSet<String>) {
    let mut seen = BTreeSet::<String>::new();
    let mut seen_facts = BTreeSet::<String>::new();
    let mut stack: Vec<String> = roots.to_vec();
    let mut changed = true;
    while changed {
        changed = false;
        while let Some(address) = stack.pop() {
            if !seen.insert(address.clone()) {
                continue;
            }
            if let Some((source, target)) = links.get(&address) {
                for next in [source, target] {
                    if !seen.contains(next) {
                        stack.push(next.clone());
                    }
                }
            }
            if let Some((subject, kind)) = facts.get(&address) {
                for next in [subject, kind] {
                    if !seen.contains(next) {
                        stack.push(next.clone());
                    }
                }
            }
        }
        for (address, (subject, _)) in facts {
            if !seen_facts.contains(address) && seen.contains(subject) {
                seen_facts.insert(address.clone());
                if !seen.contains(address) {
                    stack.push(address.clone());
                    changed = true;
                }
            }
        }
    }
    let reachable_links = seen
        .iter()
        .filter(|address| links.contains_key(*address))
        .cloned()
        .collect();
    (reachable_links, seen_facts)
}

/// A reduction value to project: the program, its input and its result.
#[derive(Clone, Copy)]
pub struct ClosureValue<'a> {
    pub program: &'a str,
    pub input: &'a Node,
    pub result: &'a ReductionResult,
}

/// Host objects lowered by [`project_semantic_closure`].
#[derive(Clone, Copy)]
pub struct SemanticClosureInput<'a> {
    pub ontology: Option<&'a TypedLinkNetwork>,
    pub registry: &'a LinkedProgramRegistry,
    pub foundations: &'a [FoundationPackage],
    pub judgements: &'a [FoundationResult],
    pub values: &'a [ClosureValue<'a>],
}

fn project_proof(
    builder: &mut SemanticClosureBuilder,
    step: &FoundationProof,
) -> Result<String, String> {
    let reference = if labelled_role(step.role) {
        let program = builder.atom(&step.program)?;
        let rule = builder.atom(&step.rule)?;
        builder.seq(&[program, rule])?
    } else {
        let kind = if step.premises.is_empty() {
            "fact"
        } else {
            "inference"
        };
        rule_address(kind, &step.program, &step.rule)
    };
    let judgement = builder.term(&step.judgement)?;
    let role = builder.atom(step.role)?;
    let mut premises = Vec::with_capacity(step.premises.len());
    for premise in &step.premises {
        premises.push(project_proof(builder, premise)?);
    }
    let premises = builder.seq(&premises)?;
    let payload = builder.seq(&[judgement, reference, role, premises])?;
    builder.anonymous("proof", &payload)
}

fn project_program(
    builder: &mut SemanticClosureBuilder,
    program: &LinkedProgram,
) -> Result<String, String> {
    let reference = program_address(&program.name);
    let mut uses = Vec::new();
    for import in &program.uses {
        let mut bindings = Vec::new();
        for (from, to) in &import.rebindings {
            let from = builder.atom(from)?;
            let to = builder.atom(to)?;
            bindings.push(builder.seq(&[from, to])?);
        }
        let bindings = builder.seq(&bindings)?;
        uses.push(builder.seq(&[program_address(&import.program), bindings])?);
    }
    let mut rules = Vec::new();
    let mut rule = |builder: &mut SemanticClosureBuilder,
                    kind: &str,
                    name: &str,
                    body: String|
     -> Result<(), String> {
        let kind_atom = builder.atom(kind)?;
        let name_atom = builder.atom(name)?;
        let payload = builder.seq(&[reference.clone(), kind_atom, name_atom, body])?;
        rules.push(builder.named(
            &rule_address(kind, &program.name, name),
            "rule",
            &payload,
            Some("rule"),
        )?);
        Ok(())
    };
    for item in &program.rewrites {
        let pattern = builder.term(&item.pattern)?;
        let replacement = builder.term(&item.replacement)?;
        let body = builder.seq(&[pattern, replacement])?;
        rule(&mut *builder, "rewrite", &item.name, body)?;
    }
    for item in &program.facts {
        let judgement = builder.term(&item.judgement)?;
        let body = builder.seq(&[judgement])?;
        rule(&mut *builder, "fact", &item.name, body)?;
    }
    for item in &program.inferences {
        let mut premises = Vec::new();
        for premise in &item.premises {
            premises.push(builder.term(premise)?);
        }
        let premises = builder.seq(&premises)?;
        let conclusion = builder.term(&item.conclusion)?;
        let body = builder.seq(&[premises, conclusion])?;
        rule(&mut *builder, "inference", &item.name, body)?;
    }
    let name = builder.atom(&program.name)?;
    let uses = builder.seq(&uses)?;
    let rules = builder.seq(&rules)?;
    let payload = builder.seq(&[name, uses, rules])?;
    builder.named(&reference, "program", &payload, Some("program"))
}

/// Project host objects into one closed archive rooted at `rml.closure`.
pub fn project_semantic_closure(
    input: &SemanticClosureInput<'_>,
) -> Result<TypedSemanticArchive, String> {
    let mut b = SemanticClosureBuilder::new();
    let categories: Vec<String> = SEMANTIC_CLOSURE_CATEGORIES
        .iter()
        .map(|name| b.category(name))
        .collect();
    let mut ontology_ref = b.nil();
    if let Some(ontology) = input.ontology {
        let snapshot = ontology.snapshot();
        let mut members = Vec::new();
        let mut facts = Vec::new();
        for (address, source, target) in &snapshot.links {
            if address.starts_with("rml.") {
                return Err(format!(
                    "ontology link {address} uses a reserved closure address"
                ));
            }
            b.link(address, source, target)?;
            b.classify(address, "ontology");
            members.push(address.clone());
        }
        for (address, subject, kind) in &snapshot.type_facts {
            if b.links.contains_key(address) {
                return Err(format!(
                    "ontology type fact {address} has conflicting roles"
                ));
            }
            b.facts
                .insert(address.clone(), (subject.clone(), kind.clone()));
            b.classify(kind, "type");
            facts.push(address.clone());
        }
        members.sort();
        facts.sort();
        let members = b.seq(&members)?;
        let facts = b.seq(&facts)?;
        let payload = b.seq(&[members, facts])?;
        ontology_ref = b.named(ONTOLOGY, "ontology", &payload, Some("ontology"))?;
    }
    let mut programs = Vec::new();
    for name in input.registry.names() {
        let program = input
            .registry
            .program(name)
            .ok_or_else(|| format!("unknown linked-program {name}"))?;
        programs.push(project_program(&mut b, program)?);
    }
    let mut foundations = Vec::new();
    for item in input.foundations {
        let name = b.atom(&item.name)?;
        let version = b.atom(&item.version)?;
        let dependencies: Vec<String> = item
            .depends_on
            .iter()
            .map(|dependency| foundation_address(&dependency.name, &dependency.version))
            .collect();
        let dependencies = b.seq(&dependencies)?;
        let mut roles = Vec::new();
        for role in &item.roles {
            let role_atom = b.atom(role.role)?;
            roles.push(b.seq(&[role_atom, program_address(&role.program)])?);
        }
        let roles = b.seq(&roles)?;
        let mut signature = Vec::new();
        for term in &item.signature {
            signature.push(b.term(term)?);
        }
        let signature = b.seq(&signature)?;
        let cycle = b.atom(item.cycle_policy.kind)?;
        let guards: Vec<String> = item
            .cycle_policy
            .guards
            .iter()
            .map(|guard| rule_address("inference", &guard.program, &guard.rule))
            .collect();
        let guards = b.seq(&guards)?;
        let policy = b.seq(&[cycle, guards])?;
        let payload = b.seq(&[name, version, dependencies, roles, signature, policy])?;
        foundations.push(b.named(
            &foundation_address(&item.name, &item.version),
            "foundation",
            &payload,
            Some("foundation"),
        )?);
    }
    let mut judgements = Vec::new();
    for result in input.judgements {
        let answers = match &result.answers {
            None => b.nil(),
            Some(answers) => {
                let mut items = Vec::new();
                for answer in answers {
                    let judgement = b.term(&answer.judgement)?;
                    let mut bindings = Vec::new();
                    for (variable, value) in &answer.bindings {
                        let variable = b.atom(variable)?;
                        let value = b.term(value)?;
                        bindings.push(b.seq(&[variable, value])?);
                    }
                    let bindings = b.seq(&bindings)?;
                    let substitution = b.anonymous("substitution", &bindings)?;
                    let proof = project_proof(&mut b, &answer.proof)?;
                    items.push(b.seq(&[judgement, substitution, proof])?);
                }
                let items = b.seq(&items)?;
                b.seq(&[items])?
            }
        };
        let instance = b.atom(&result.instance)?;
        let foundation = foundation_address(&result.foundation.name, &result.foundation.version);
        let query = b.term(&result.query)?;
        let status = b.atom(result.status)?;
        let reason = b.atom(result.reason)?;
        let mut assumptions = Vec::new();
        for assumption in &result.assumptions {
            assumptions.push(b.term(assumption)?);
        }
        let assumptions = b.seq(&assumptions)?;
        let proof = match &result.proof {
            Some(proof) => project_proof(&mut b, proof)?,
            None => b.nil(),
        };
        let payload = b.seq(&[
            instance,
            foundation,
            query,
            status,
            reason,
            assumptions,
            proof,
            answers,
        ])?;
        judgements.push(b.anonymous("judgement", &payload)?);
    }
    let mut values = Vec::new();
    for value in input.values {
        let input_term = b.term(value.input)?;
        let normal = b.term(&value.result.term)?;
        let steps = b.atom(&value.result.trace.len().to_string())?;
        let payload = b.seq(&[program_address(value.program), input_term, normal, steps])?;
        values.push(b.anonymous("value", &payload)?);
    }
    let categories = b.seq(&categories)?;
    let foundations = b.seq(&foundations)?;
    let programs = b.seq(&programs)?;
    let judgements = b.seq(&judgements)?;
    let values = b.seq(&values)?;
    let payload = b.seq(&[
        ontology_ref,
        categories,
        foundations,
        programs,
        judgements,
        values,
    ])?;
    b.named(ROOT, "closure", &payload, None)?;
    let roots = vec![ROOT.to_string()];
    TypedSemanticArchive::from_snapshot(&b.snapshot(&roots), &roots)
}

/// A proof reconstructed from the network, with its role as linked text.
#[derive(Debug, Clone, PartialEq)]
pub struct ClosureProof {
    pub judgement: Node,
    pub program: String,
    pub rule: String,
    pub role: String,
    pub premises: Vec<ClosureProof>,
}

impl ClosureProof {
    /// The record a workspace proof is expected to reconstruct to.
    pub fn of(proof: &FoundationProof) -> Self {
        Self {
            judgement: proof.judgement.clone(),
            program: proof.program.clone(),
            rule: proof.rule.clone(),
            role: proof.role.to_string(),
            premises: proof.premises.iter().map(Self::of).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClosureAnswer {
    pub judgement: Node,
    pub bindings: Vec<(String, Node)>,
    pub proof: ClosureProof,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClosureJudgement {
    pub instance: String,
    pub foundation: FoundationRef,
    pub query: Node,
    pub status: String,
    pub reason: String,
    pub assumptions: Vec<Node>,
    pub proof: Option<ClosureProof>,
    pub answers: Option<Vec<ClosureAnswer>>,
}

impl ClosureJudgement {
    /// The record a workspace result is expected to reconstruct to.
    pub fn of(result: &FoundationResult) -> Self {
        Self {
            instance: result.instance.clone(),
            foundation: result.foundation.clone(),
            query: result.query.clone(),
            status: result.status.to_string(),
            reason: result.reason.to_string(),
            assumptions: result.assumptions.clone(),
            proof: result.proof.as_ref().map(ClosureProof::of),
            answers: result.answers.as_ref().map(|answers| {
                answers
                    .iter()
                    .map(|answer| ClosureAnswer {
                        judgement: answer.judgement.clone(),
                        bindings: answer.bindings.clone(),
                        proof: ClosureProof::of(&answer.proof),
                    })
                    .collect()
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClosureRole {
    pub role: String,
    pub program: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClosureFoundation {
    pub name: String,
    pub version: String,
    pub depends_on: Vec<FoundationRef>,
    pub roles: Vec<ClosureRole>,
    pub signature: Vec<Node>,
    pub cycle_policy: String,
    pub guards: Vec<Guard>,
}

impl ClosureFoundation {
    /// The record a described foundation package is expected to reconstruct to.
    pub fn of(package: &FoundationPackage) -> Self {
        Self {
            name: package.name.clone(),
            version: package.version.clone(),
            depends_on: package.depends_on.clone(),
            roles: package
                .roles
                .iter()
                .map(|role| ClosureRole {
                    role: role.role.to_string(),
                    program: role.program.clone(),
                })
                .collect(),
            signature: package.signature.clone(),
            cycle_policy: package.cycle_policy.kind.to_string(),
            guards: package.cycle_policy.guards.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClosureValueRecord {
    pub program: String,
    pub input: Node,
    pub term: Node,
    pub steps: usize,
}

/// Host-level records reconstructed from a validated closure.
#[derive(Debug, Clone, PartialEq)]
pub struct SemanticClosureRecords {
    pub ontology: Option<TypedLinkNetworkSnapshot>,
    pub foundations: Vec<ClosureFoundation>,
    pub programs: Vec<LinkedProgram>,
    pub judgements: Vec<ClosureJudgement>,
    pub values: Vec<ClosureValueRecord>,
}

/// The result of [`validate_semantic_closure`].
#[derive(Debug, Clone, PartialEq)]
pub struct SemanticClosureReport {
    pub schema: &'static str,
    pub root: &'static str,
    pub links: usize,
    pub type_facts: usize,
    /// Member counts in [`SEMANTIC_CLOSURE_CATEGORIES`] order.
    pub categories: Vec<(&'static str, usize)>,
    pub records: SemanticClosureRecords,
}

#[derive(Debug, Clone)]
struct DecodedRule {
    kind: String,
    owner: String,
    program: String,
    name: String,
    rewrite: Option<RewriteRule>,
    fact: Option<LinkedFact>,
    inference: Option<InferenceRule>,
}

fn node_kind(address: &str, members: &BTreeSet<String>) -> Option<&'static str> {
    const PREFIXES: [(&str, &str); 10] = [
        ("rml.atom/", "atom"),
        ("rml.cons/", "cons"),
        ("rml.program/", "program"),
        ("rml.rule/", "rule"),
        ("rml.foundation/", "foundation"),
        ("rml.proof/", "proof"),
        ("rml.substitution/", "substitution"),
        ("rml.judgement/", "judgement"),
        ("rml.value/", "value"),
        ("rml.category/", "category"),
    ];
    match address {
        NIL => return Some("nil"),
        ROOT => return Some("closure"),
        ONTOLOGY => return Some("ontology"),
        CATEGORY_ROOT => return Some("category-root"),
        _ => {}
    }
    for (prefix, kind) in PREFIXES {
        if address.starts_with(prefix) {
            return Some(kind);
        }
    }
    members.contains(address).then_some("member")
}

fn allowed(kind: Option<&str>) -> &'static [&'static str] {
    match kind {
        Some("atom") => &["address", "term"],
        Some("nil") | Some("cons") => &["term"],
        Some("category") => &["type"],
        Some("member") => &["ontology", "type"],
        Some("program") => &["program"],
        Some("rule") => &["rule"],
        Some("foundation") => &["foundation"],
        Some("proof") => &["proof"],
        Some("substitution") => &["substitution"],
        Some("judgement") => &["judgement"],
        Some("value") => &["value"],
        Some("ontology") => &["ontology"],
        _ => &[],
    }
}

struct Decoder<'a> {
    links: BTreeMap<&'a str, (&'a str, &'a str)>,
    rules: BTreeMap<String, DecodedRule>,
    proofs: BTreeMap<String, ClosureProof>,
}

impl<'a> Decoder<'a> {
    fn node(&self, address: &str) -> Result<(&'a str, &'a str), String> {
        self.links
            .get(address)
            .copied()
            .ok_or_else(|| format!("semantic closure reference {address} is not a link"))
    }
    fn list(&self, address: &str, context: &str) -> Result<Vec<String>, String> {
        let mut items = Vec::new();
        let mut seen = BTreeSet::new();
        let mut at = address.to_string();
        while at != NIL {
            if !at.starts_with("rml.cons/") || !seen.insert(at.clone()) {
                return Err(format!("{context} is not a proper list"));
            }
            let (source, target) = self.node(&at)?;
            items.push(source.to_string());
            at = target.to_string();
        }
        Ok(items)
    }
    fn tuple(&self, address: &str, size: usize, context: &str) -> Result<Vec<String>, String> {
        let items = self.list(address, context)?;
        if items.len() != size {
            return Err(format!("{context} must have {size} fields"));
        }
        Ok(items)
    }
    fn atom(&self, address: &str, context: &str) -> Result<String, String> {
        address
            .strip_prefix("rml.atom/")
            .map(str::to_string)
            .ok_or_else(|| format!("{context} must be an atom"))
    }
    fn term(&self, address: &str) -> Result<Node, String> {
        if address.starts_with("rml.atom/") {
            return Ok(Node::Leaf(self.atom(address, "term")?));
        }
        if address == NIL || address.starts_with("rml.cons/") {
            let mut children = Vec::new();
            for item in self.list(address, "term")? {
                children.push(self.term(&item)?);
            }
            return Ok(Node::List(children));
        }
        Err(format!("term reference {address} is not term structure"))
    }
    fn terms(&self, address: &str, context: &str) -> Result<Vec<Node>, String> {
        self.list(address, context)?
            .iter()
            .map(|item| self.term(item))
            .collect()
    }
    fn entity(&self, address: &str, kind: &str) -> Result<String, String> {
        let (source, target) = self.node(address)?;
        if source != tag_address(kind) {
            return Err(format!("expected a {kind} reference at {address}"));
        }
        Ok(target.to_string())
    }
    fn program_name(&self, address: &str, context: &str) -> Result<String, String> {
        self.entity(address, "program")?;
        address
            .strip_prefix("rml.program/")
            .map(str::to_string)
            .ok_or_else(|| format!("{context} must reference a program"))
    }
    fn rule(&mut self, address: &str) -> Result<DecodedRule, String> {
        if let Some(rule) = self.rules.get(address) {
            return Ok(rule.clone());
        }
        let payload = self.entity(address, "rule")?;
        let fields = self.tuple(&payload, 4, &format!("rule {address}"))?;
        let kind = self.atom(&fields[1], "rule kind")?;
        let name = self.atom(&fields[2], "rule name")?;
        let owner = fields[0].clone();
        let program = owner
            .strip_prefix("rml.program/")
            .map(str::to_string)
            .ok_or_else(|| format!("rule {address} must reference its program"))?;
        if address != rule_address(&kind, &program, &name) {
            return Err(format!("identity mismatch for rule {address}"));
        }
        let mut decoded = DecodedRule {
            kind: kind.clone(),
            owner,
            program: program.clone(),
            name: name.clone(),
            rewrite: None,
            fact: None,
            inference: None,
        };
        match kind.as_str() {
            "rewrite" => {
                let body = self.tuple(&fields[3], 2, &format!("rewrite {address}"))?;
                decoded.rewrite = Some(RewriteRule {
                    program,
                    name,
                    pattern: self.term(&body[0])?,
                    replacement: self.term(&body[1])?,
                });
            }
            "fact" => {
                let body = self.tuple(&fields[3], 1, &format!("fact {address}"))?;
                decoded.fact = Some(LinkedFact {
                    program,
                    name,
                    judgement: self.term(&body[0])?,
                });
            }
            "inference" => {
                let body = self.tuple(&fields[3], 2, &format!("inference {address}"))?;
                decoded.inference = Some(InferenceRule {
                    program,
                    name,
                    premises: self.terms(&body[0], "premises")?,
                    conclusion: self.term(&body[1])?,
                });
            }
            other => return Err(format!("rule {address} has unsupported kind {other}")),
        }
        self.rules.insert(address.to_string(), decoded.clone());
        Ok(decoded)
    }
    fn proof(
        &mut self,
        address: &str,
        active: &mut BTreeSet<String>,
    ) -> Result<ClosureProof, String> {
        if let Some(proof) = self.proofs.get(address) {
            return Ok(proof.clone());
        }
        if !active.insert(address.to_string()) {
            return Err(format!("proof {address} is circular"));
        }
        let payload = self.entity(address, "proof")?;
        let fields = self.tuple(&payload, 4, &format!("proof {address}"))?;
        let role = self.atom(&fields[2], "proof role")?;
        let mut premises = Vec::new();
        for premise in self.list(&fields[3], "premises")? {
            premises.push(self.proof(&premise, active)?);
        }
        let (program, rule) = if labelled_role(&role) {
            let label = self.tuple(&fields[1], 2, "labelled proof leaf")?;
            if !premises.is_empty() {
                return Err(format!("labelled proof leaf {address} has premises"));
            }
            (
                self.atom(&label[0], "label")?,
                self.atom(&label[1], "label")?,
            )
        } else {
            let item = self.rule(&fields[1])?;
            let expected = if premises.is_empty() {
                "fact"
            } else {
                "inference"
            };
            if item.kind != expected {
                return Err(format!(
                    "proof {address} references a rule of the wrong kind"
                ));
            }
            (item.program, item.name)
        };
        active.remove(address);
        let decoded = ClosureProof {
            judgement: self.term(&fields[0])?,
            program,
            rule,
            role,
            premises,
        };
        self.proofs.insert(address.to_string(), decoded.clone());
        Ok(decoded)
    }
    fn foundation_ref(&self, address: &str, context: &str) -> Result<FoundationRef, String> {
        let payload = self.entity(address, "foundation")?;
        let fields = self.tuple(&payload, 6, context)?;
        Ok(FoundationRef {
            name: self.atom(&fields[0], "foundation name")?,
            version: self.atom(&fields[1], "foundation version")?,
        })
    }
}

/// Validate an archive as a recursive semantic closure and reconstruct its records.
pub fn validate_semantic_closure(
    archive: &TypedSemanticArchive,
) -> Result<SemanticClosureReport, String> {
    let snapshot = archive.snapshot();
    if archive.roots().len() != 1 || archive.roots()[0] != ROOT {
        return Err(format!("semantic closure must have the single root {ROOT}"));
    }
    let facts: BTreeMap<&str, (&str, &str)> = snapshot
        .type_facts
        .iter()
        .map(|(a, s, t)| (a.as_str(), (s.as_str(), t.as_str())))
        .collect();
    let mut d = Decoder {
        links: snapshot
            .links
            .iter()
            .map(|(a, s, t)| (a.as_str(), (s.as_str(), t.as_str())))
            .collect(),
        rules: BTreeMap::new(),
        proofs: BTreeMap::new(),
    };

    // Root, ontology membership and categories.
    let root = d.entity(ROOT, "closure")?;
    let root = d.tuple(&root, 6, "closure root")?;
    let mut members = BTreeSet::new();
    let mut ontology_facts = BTreeSet::new();
    let mut ontology = None;
    if root[0] != NIL {
        let payload = d.entity(&root[0], "ontology")?;
        let fields = d.tuple(&payload, 2, "ontology")?;
        members.extend(d.list(&fields[0], "ontology links")?);
        ontology_facts.extend(d.list(&fields[1], "ontology facts")?);
        let mut links = Vec::new();
        for member in &members {
            let (source, target) = d.node(member)?;
            links.push((member.clone(), source.to_string(), target.to_string()));
        }
        let mut type_facts = Vec::new();
        for fact in &ontology_facts {
            let (subject, kind) = facts
                .get(fact.as_str())
                .copied()
                .ok_or_else(|| format!("ontology type fact {fact} is undefined"))?;
            type_facts.push((fact.clone(), subject.to_string(), kind.to_string()));
        }
        ontology = Some(TypedLinkNetworkSnapshot { links, type_facts });
    }
    let categories = d.list(&root[1], "categories")?;
    if categories.len() != SEMANTIC_CLOSURE_CATEGORIES.len()
        || categories
            .iter()
            .zip(SEMANTIC_CLOSURE_CATEGORIES)
            .any(|(address, name)| *address != category_address(name))
    {
        return Err("semantic closure must list every category in canonical order".to_string());
    }

    // Per-link identity rules.
    for (address, source, target) in &snapshot.links {
        let kind =
            node_kind(address, &members).ok_or_else(|| format!("unrepresented node {address}"))?;
        if matches!(kind, "atom" | "nil" | "category-root")
            && (source != address || target != address)
        {
            return Err(format!("{address} must be a self-link"));
        }
        if kind == "cons" {
            if *address != format!("rml.cons/{}", closure_hash(source, target)) {
                return Err(format!("content address mismatch for {address}"));
            }
            if target != NIL && !target.starts_with("rml.cons/") {
                return Err(format!("{address} is an improper list"));
            }
        }
        if ANONYMOUS.contains(&kind)
            && (*source != tag_address(kind)
                || *address != format!("rml.{kind}/{}", closure_hash(source, target)))
        {
            return Err(format!("content address mismatch for {address}"));
        }
        if kind == "category" {
            let name = &address[CATEGORY_ROOT.len() + 1..];
            if !SEMANTIC_CLOSURE_CATEGORIES
                .iter()
                .any(|known| *known == name)
            {
                return Err(format!("unknown category {name}"));
            }
            if source != CATEGORY_ROOT || target != address {
                return Err(format!("{address} must be classified by {CATEGORY_ROOT}"));
            }
        }
    }

    // Records, named identities and back references.
    let mut programs: Vec<LinkedProgram> = Vec::new();
    for address in d.list(&root[3], "programs")? {
        let payload = d.entity(&address, "program")?;
        let fields = d.tuple(&payload, 3, &format!("program {address}"))?;
        let name = d.atom(&fields[0], "program name")?;
        if address != program_address(&name) {
            return Err(format!("identity mismatch for program {address}"));
        }
        if programs.iter().any(|program| program.name == name) {
            return Err(format!("semantic closure repeats program {name}"));
        }
        let mut uses = Vec::new();
        for import in d.list(&fields[1], "uses")? {
            let pair = d.tuple(&import, 2, "use")?;
            let program = d.program_name(&pair[0], "use")?;
            let mut rebindings = BTreeMap::new();
            for binding in d.list(&pair[1], "rebindings")? {
                let binding = d.tuple(&binding, 2, "rebinding")?;
                rebindings.insert(
                    d.atom(&binding[0], "rebinding")?,
                    d.atom(&binding[1], "rebinding")?,
                );
            }
            uses.push(ProgramImport {
                program,
                rebindings,
            });
        }
        let mut decoded = LinkedProgram {
            name: name.clone(),
            uses,
            rewrites: Vec::new(),
            facts: Vec::new(),
            inferences: Vec::new(),
        };
        let mut listed = BTreeSet::new();
        for rule_ref in d.list(&fields[2], &format!("rules of {name}"))? {
            if !listed.insert(rule_ref.clone()) {
                return Err(format!("program {name} repeats rule {rule_ref}"));
            }
            let item = d.rule(&rule_ref)?;
            if item.owner != address {
                return Err(format!(
                    "rule {rule_ref} does not link back to program {name}"
                ));
            }
            if let Some(rule) = item.rewrite {
                decoded.rewrites.push(rule);
            } else if let Some(rule) = item.fact {
                decoded.facts.push(rule);
            } else if let Some(rule) = item.inference {
                decoded.inferences.push(rule);
            }
        }
        programs.push(decoded);
    }
    for (address, _, _) in &snapshot.links {
        if address.starts_with("rml.rule/") {
            let item = d.rule(address)?;
            if !programs.iter().any(|program| program.name == item.program) {
                return Err(format!("rule {address} references an unlisted program"));
            }
        }
    }
    for program in &programs {
        let listed: BTreeSet<&str> = program
            .rewrites
            .iter()
            .map(|rule| rule.name.as_str())
            .chain(program.facts.iter().map(|rule| rule.name.as_str()))
            .chain(program.inferences.iter().map(|rule| rule.name.as_str()))
            .collect();
        for (address, item) in &d.rules {
            if item.program == program.name && !listed.contains(item.name.as_str()) {
                return Err(format!("rule {address} is not listed by its program"));
            }
        }
    }
    let mut foundations = Vec::new();
    for address in d.list(&root[2], "foundations")? {
        let payload = d.entity(&address, "foundation")?;
        let fields = d.tuple(&payload, 6, &format!("foundation {address}"))?;
        let name = d.atom(&fields[0], "foundation name")?;
        let version = d.atom(&fields[1], "foundation version")?;
        if address != foundation_address(&name, &version) {
            return Err(format!("identity mismatch for foundation {address}"));
        }
        let mut depends_on = Vec::new();
        for dependency in d.list(&fields[2], "dependencies")? {
            depends_on.push(d.foundation_ref(&dependency, "dependency")?);
        }
        let mut roles = Vec::new();
        for role in d.list(&fields[3], "roles")? {
            let pair = d.tuple(&role, 2, "role")?;
            roles.push(ClosureRole {
                role: d.atom(&pair[0], "role")?,
                program: d.program_name(&pair[1], "role")?,
            });
        }
        let signature = d.terms(&fields[4], "signature")?;
        let policy = d.tuple(&fields[5], 2, "cycle policy")?;
        let cycle_policy = d.atom(&policy[0], "cycle policy")?;
        let mut guards = Vec::new();
        for guard in d.list(&policy[1], "guards")? {
            let item = d.rule(&guard)?;
            if item.kind != "inference" {
                return Err(format!("guard {guard} must reference an inference rule"));
            }
            guards.push(Guard {
                program: item.program,
                rule: item.name,
            });
        }
        foundations.push(ClosureFoundation {
            name,
            version,
            depends_on,
            roles,
            signature,
            cycle_policy,
            guards,
        });
    }
    for (address, _, _) in &snapshot.links {
        let unlisted_program = address
            .strip_prefix("rml.program/")
            .is_some_and(|name| !programs.iter().any(|program| program.name == name));
        let unlisted_foundation = address.starts_with("rml.foundation/")
            && !foundations
                .iter()
                .any(|item| foundation_address(&item.name, &item.version) == *address);
        if unlisted_program || unlisted_foundation {
            return Err(format!(
                "named node {address} is not listed by the closure root"
            ));
        }
    }
    let mut judgements = Vec::new();
    for address in d.list(&root[4], "judgements")? {
        let payload = d.entity(&address, "judgement")?;
        let fields = d.tuple(&payload, 8, &format!("judgement {address}"))?;
        let mut assumptions = Vec::new();
        for assumption in d.list(&fields[5], "assumptions")? {
            assumptions.push(d.term(&assumption)?);
        }
        let proof = if fields[6] == NIL {
            None
        } else {
            Some(d.proof(&fields[6], &mut BTreeSet::new())?)
        };
        let answers = if fields[7] == NIL {
            None
        } else {
            let wrapper = d.tuple(&fields[7], 1, "answers")?;
            let mut answers = Vec::new();
            for answer in d.list(&wrapper[0], "answers")? {
                let parts = d.tuple(&answer, 3, "answer")?;
                let substitution = d.entity(&parts[1], "substitution")?;
                let mut bindings = Vec::new();
                for binding in d.list(&substitution, "substitution")? {
                    let pair = d.tuple(&binding, 2, "binding")?;
                    bindings.push((d.atom(&pair[0], "variable")?, d.term(&pair[1])?));
                }
                answers.push(ClosureAnswer {
                    judgement: d.term(&parts[0])?,
                    bindings,
                    proof: d.proof(&parts[2], &mut BTreeSet::new())?,
                });
            }
            Some(answers)
        };
        judgements.push(ClosureJudgement {
            instance: d.atom(&fields[0], "instance")?,
            foundation: d.foundation_ref(&fields[1], "judgement foundation")?,
            query: d.term(&fields[2])?,
            status: d.atom(&fields[3], "status")?,
            reason: d.atom(&fields[4], "reason")?,
            assumptions,
            proof,
            answers,
        });
    }
    let mut values = Vec::new();
    for address in d.list(&root[5], "values")? {
        let payload = d.entity(&address, "value")?;
        let fields = d.tuple(&payload, 4, &format!("value {address}"))?;
        let steps = d.atom(&fields[3], "steps")?;
        values.push(ClosureValueRecord {
            program: d.program_name(&fields[0], "value")?,
            input: d.term(&fields[1])?,
            term: d.term(&fields[2])?,
            steps: steps
                .parse::<usize>()
                .map_err(|_| format!("value {address} has an invalid step count"))?,
        });
    }

    // Reachability: nothing may hide outside the rooted network.
    let owned_links: BTreeMap<String, (String, String)> = snapshot
        .links
        .iter()
        .map(|(a, s, t)| (a.clone(), (s.clone(), t.clone())))
        .collect();
    let owned_facts: BTreeMap<String, (String, String)> = snapshot
        .type_facts
        .iter()
        .map(|(a, s, t)| (a.clone(), (s.clone(), t.clone())))
        .collect();
    let (reachable_links, reachable_facts) =
        reachable_from(&[ROOT.to_string()], &owned_links, &owned_facts);
    for (address, _, _) in &snapshot.links {
        if !reachable_links.contains(address) {
            return Err(format!("unreachable node {address}"));
        }
    }
    for (address, _, _) in &snapshot.type_facts {
        if !reachable_facts.contains(address) {
            return Err(format!("unreachable type fact {address}"));
        }
    }

    // Category membership is linked data and must agree with structure.
    let mut counts: BTreeMap<&str, usize> = SEMANTIC_CLOSURE_CATEGORIES
        .iter()
        .map(|name| (*name, 0))
        .collect();
    let mut memberships: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (address, subject, kind) in &snapshot.type_facts {
        if address.starts_with("rml.typed/") {
            if !kind.starts_with("rml.category/") || *address != fact_address(subject, kind) {
                return Err(format!("content address mismatch for type fact {address}"));
            }
            let category = &kind[CATEGORY_ROOT.len() + 1..];
            if !allowed(node_kind(subject, &members))
                .iter()
                .any(|known| *known == category)
            {
                return Err(format!(
                    "category spoofing: {subject} cannot be typed {category}"
                ));
            }
            if let Some(count) = counts.get_mut(category) {
                *count += 1;
            }
            memberships
                .entry(subject.as_str())
                .or_default()
                .push(category);
        } else if !ontology_facts.contains(address) {
            return Err(format!("unrepresented type fact {address}"));
        }
    }
    for (address, _, _) in &snapshot.links {
        let required = match node_kind(address, &members) {
            Some("atom") => Some("address"),
            Some("member") => Some("ontology"),
            Some("category") => Some("type"),
            Some(
                kind @ ("program" | "rule" | "foundation" | "proof" | "substitution" | "judgement"
                | "value" | "ontology"),
            ) => Some(kind),
            _ => None,
        };
        if let Some(required) = required {
            let has = memberships
                .get(address.as_str())
                .is_some_and(|categories| categories.contains(&required));
            if !has {
                return Err(format!("{address} is missing its {required} category"));
            }
        }
    }
    for name in SEMANTIC_CLOSURE_CATEGORIES {
        if counts[name] == 0 {
            return Err(format!("semantic closure is missing category {name}"));
        }
    }

    Ok(SemanticClosureReport {
        schema: SEMANTIC_CLOSURE_SCHEMA,
        root: ROOT,
        links: snapshot.links.len(),
        type_facts: snapshot.type_facts.len(),
        categories: SEMANTIC_CLOSURE_CATEGORIES
            .iter()
            .map(|name| (*name, counts[name]))
            .collect(),
        records: SemanticClosureRecords {
            ontology,
            foundations,
            programs,
            judgements,
            values,
        },
    })
}

/// Validate and return only the reconstructed host-level records.
pub fn reconstruct_semantic_closure(
    archive: &TypedSemanticArchive,
) -> Result<SemanticClosureRecords, String> {
    Ok(validate_semantic_closure(archive)?.records)
}

/// Why a universe obligation failed: the offending judgement and/or cycle.
#[derive(Debug, Clone, PartialEq)]
pub struct UniverseWitness {
    pub judgement: Option<Node>,
    pub cycle: Vec<Node>,
    pub terms: Vec<Node>,
}

/// One checked obligation: `holds`, `violated` or `unsupported`.
#[derive(Debug, Clone, PartialEq)]
pub struct UniverseObligation {
    pub name: String,
    pub source: &'static str,
    pub status: &'static str,
    pub witness: Option<UniverseWitness>,
}

/// The result of [`validate_universe_contract`]. `status` is `accepted`,
/// `violated`, `not-declared`, `unsupported` or `incomplete`; `consistency`
/// is always `not-established`.
#[derive(Debug, Clone, PartialEq)]
pub struct UniverseContractReport {
    pub schema: &'static str,
    pub instance: String,
    pub foundation: FoundationRef,
    pub status: &'static str,
    pub reason: &'static str,
    pub policy: Option<Node>,
    pub typing_judgement: Option<String>,
    pub cumulative: bool,
    pub universes: Vec<Node>,
    pub order: Vec<(Node, Node)>,
    pub obligations: Vec<UniverseObligation>,
    pub judgements_checked: usize,
    pub consistency: &'static str,
}

fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}
fn field(judgement: &Node, index: usize) -> Option<&Node> {
    match judgement {
        Node::List(items) => items.get(index),
        Node::Leaf(_) => None,
    }
}
fn complete(result: &FoundationResult) -> bool {
    (result.status == "proved" || result.status == "unknown") && result.complete == Some(true)
}
fn answer_judgements(result: &FoundationResult) -> Vec<Node> {
    if result.status != "proved" {
        return Vec::new();
    }
    result
        .answers
        .as_ref()
        .map(|answers| {
            answers
                .iter()
                .map(|answer| answer.judgement.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Validate a foundation's declared universe and soundness contract through
/// public pattern queries of one instance. Every judgement checked is either
/// derived by the selected foundation or explicitly supplied by the caller.
pub fn validate_universe_contract(
    workspace: &FoundationWorkspace,
    instance: &str,
    extra_judgements: &[Node],
    bounds: FoundationBounds,
) -> Result<UniverseContractReport, String> {
    let ask = |query: Node| workspace.ask(instance, &query, &[], bounds);
    let first = ask(Node::List(vec![leaf("universe-policy"), leaf("?policy")]))?;
    let mut report = UniverseContractReport {
        schema: UNIVERSE_CONTRACT_SCHEMA,
        instance: instance.to_string(),
        foundation: first.foundation.clone(),
        status: "accepted",
        reason: "declared-contract-holds",
        policy: None,
        typing_judgement: None,
        cumulative: false,
        universes: Vec::new(),
        order: Vec::new(),
        obligations: Vec::new(),
        judgements_checked: 0,
        consistency: "not-established",
    };
    let stop = |mut report: UniverseContractReport,
                status: &'static str,
                reason: &'static str|
     -> Result<UniverseContractReport, String> {
        report.status = status;
        report.reason = reason;
        Ok(report)
    };
    if first.status == "unsupported" {
        return stop(report, "not-declared", "policy-outside-signature");
    }
    if !complete(&first) {
        return stop(report, "incomplete", "policy-search-incomplete");
    }
    let policies: Vec<Node> = answer_judgements(&first)
        .iter()
        .filter_map(|judgement| field(judgement, 1).cloned())
        .collect();
    if policies.is_empty() {
        return stop(report, "not-declared", "no-universe-policy");
    }
    if policies.len() > 1 {
        report.obligations.push(UniverseObligation {
            name: "single-universe-policy".to_string(),
            source: "policy",
            status: "violated",
            witness: Some(UniverseWitness {
                judgement: None,
                cycle: Vec::new(),
                terms: policies,
            }),
        });
        return stop(report, "violated", "conflicting-universe-policies");
    }
    let policy = policies[0].clone();
    report.policy = Some(policy.clone());
    let policy_name = match &policy {
        Node::Leaf(name) if name == "stratified" || name == "type-in-type" => name.clone(),
        _ => return stop(report, "unsupported", "unsupported-universe-policy"),
    };

    let answers_of = |query: Node| -> Result<Option<Vec<Node>>, String> {
        let result = ask(query)?;
        if result.status == "unsupported" || !complete(&result) {
            return Ok(None);
        }
        Ok(Some(answer_judgements(&result)))
    };
    let Some(typing) = answers_of(Node::List(vec![
        leaf("universe-typing-judgement"),
        leaf("?predicate"),
    ]))?
    else {
        return stop(report, "incomplete", "typing-declaration-incomplete");
    };
    let predicate = match typing.as_slice() {
        [single] => match field(single, 1) {
            Some(Node::Leaf(name)) => name.clone(),
            _ => return stop(report, "unsupported", "ambiguous-typing-judgement"),
        },
        [] => return stop(report, "unsupported", "typing-judgement-undeclared"),
        _ => return stop(report, "unsupported", "ambiguous-typing-judgement"),
    };
    report.typing_judgement = Some(predicate.clone());
    let Some(cumulativity) = answers_of(Node::List(vec![
        leaf("universe-cumulativity"),
        leaf("?mode"),
    ]))?
    else {
        return stop(report, "incomplete", "cumulativity-declaration-incomplete");
    };
    if cumulativity.len() > 1
        || cumulativity
            .iter()
            .any(|answer| field(answer, 1) != Some(&leaf("cumulative")))
    {
        return stop(report, "unsupported", "unsupported-cumulativity");
    }
    report.cumulative = cumulativity.len() == 1;
    let Some(declared_order) = answers_of(Node::List(vec![
        leaf("universe-below"),
        leaf("?lower"),
        leaf("?upper"),
    ]))?
    else {
        return stop(report, "incomplete", "universe-order-incomplete");
    };
    let Some(declared) = answers_of(Node::List(vec![
        leaf("soundness-contract"),
        leaf("?obligation"),
    ]))?
    else {
        return stop(report, "incomplete", "soundness-contract-incomplete");
    };
    let Some(typed) = answers_of(Node::List(vec![
        leaf(&predicate),
        leaf("?term"),
        leaf("?type"),
    ]))?
    else {
        return stop(report, "incomplete", "typing-judgements-incomplete");
    };

    let edges: Vec<(Node, Node)> = declared_order
        .iter()
        .filter_map(|answer| Some((field(answer, 1)?.clone(), field(answer, 2)?.clone())))
        .collect();
    let mut universes: BTreeMap<String, Node> = BTreeMap::new();
    for (lower, upper) in &edges {
        universes.insert(emit_lino_term(lower), lower.clone());
        universes.insert(emit_lino_term(upper), upper.clone());
    }
    let keys: Vec<String> = universes.keys().cloned().collect();
    report.universes = keys.iter().map(|key| universes[key].clone()).collect();
    let mut order = edges.clone();
    order.sort_by_key(|(lower, upper)| (emit_lino_term(lower), emit_lino_term(upper)));
    report.order = order;
    let mut successors: BTreeMap<String, BTreeSet<String>> = keys
        .iter()
        .map(|key| (key.clone(), BTreeSet::new()))
        .collect();
    for (lower, upper) in &edges {
        if let Some(next) = successors.get_mut(&emit_lino_term(lower)) {
            next.insert(emit_lino_term(upper));
        }
    }
    let cumulative = report.cumulative;
    let below = |lower: &Node, upper: &Node| -> bool {
        let start = emit_lino_term(lower);
        let goal = emit_lino_term(upper);
        let Some(direct) = successors.get(&start) else {
            return false;
        };
        if !cumulative {
            return direct.contains(&goal);
        }
        let mut seen = BTreeSet::new();
        let mut stack: Vec<String> = direct.iter().cloned().collect();
        while let Some(key) = stack.pop() {
            if key == goal {
                return true;
            }
            if !seen.insert(key.clone()) {
                continue;
            }
            if let Some(next) = successors.get(&key) {
                stack.extend(next.iter().cloned());
            }
        }
        false
    };
    let mut judgements = typed;
    judgements.extend(extra_judgements.iter().filter(|item| {
        matches!(item, Node::List(parts) if parts.len() == 3 && parts[0] == leaf(&predicate))
    }).cloned());
    let universe_judgements: Vec<Node> = judgements
        .into_iter()
        .filter(|item| {
            let is_universe = |index| {
                field(item, index).is_some_and(|term| universes.contains_key(&emit_lino_term(term)))
            };
            is_universe(1) && is_universe(2)
        })
        .collect();
    report.judgements_checked = universe_judgements.len();
    let same = |item: &Node| {
        emit_lino_term(field(item, 1).expect("universe judgement has a term"))
            == emit_lino_term(field(item, 2).expect("universe judgement has a type"))
    };
    let pair = |item: &Node| {
        vec![
            field(item, 1)
                .expect("universe judgement has a term")
                .clone(),
            field(item, 2)
                .expect("universe judgement has a type")
                .clone(),
        ]
    };
    let check = |name: &str| -> Option<Option<UniverseWitness>> {
        match name {
            "well-founded-universe-order" => {
                fn visit(
                    key: &str,
                    successors: &BTreeMap<String, BTreeSet<String>>,
                    state: &mut BTreeMap<String, bool>,
                    path: &mut Vec<String>,
                    cycle: &mut Option<Vec<String>>,
                ) {
                    state.insert(key.to_string(), true);
                    path.push(key.to_string());
                    for next in &successors[key] {
                        if cycle.is_some() {
                            break;
                        }
                        match state.get(next) {
                            Some(true) => {
                                let start = path.iter().position(|item| item == next).unwrap_or(0);
                                let mut found = path[start..].to_vec();
                                found.push(next.clone());
                                *cycle = Some(found);
                            }
                            Some(false) => {}
                            None => visit(next, successors, state, path, cycle),
                        }
                    }
                    path.pop();
                    state.insert(key.to_string(), false);
                }
                let mut state = BTreeMap::new();
                let mut path = Vec::new();
                let mut cycle = None;
                for key in &keys {
                    if cycle.is_none() && !state.contains_key(key) {
                        visit(key, &successors, &mut state, &mut path, &mut cycle);
                    }
                }
                Some(cycle.map(|cycle| UniverseWitness {
                    judgement: None,
                    cycle: cycle.iter().map(|key| universes[key].clone()).collect(),
                    terms: Vec::new(),
                }))
            }
            "typing-respects-universe-order" => Some(
                universe_judgements
                    .iter()
                    .find(|item| !below(field(item, 1).unwrap(), field(item, 2).unwrap()))
                    .map(|item| UniverseWitness {
                        judgement: Some((*item).clone()),
                        cycle: if same(item) { pair(item) } else { Vec::new() },
                        terms: Vec::new(),
                    }),
            ),
            "no-universe-self-typing" => Some(
                universe_judgements
                    .iter()
                    .find(|item| same(item))
                    .map(|item| UniverseWitness {
                        judgement: Some((*item).clone()),
                        cycle: pair(item),
                        terms: Vec::new(),
                    }),
            ),
            _ => None,
        }
    };
    let mut required: BTreeMap<String, &'static str> = BTreeMap::new();
    if policy_name == "stratified" {
        required.insert("well-founded-universe-order".to_string(), "policy");
        required.insert("typing-respects-universe-order".to_string(), "policy");
    }
    for answer in &declared {
        let name = match field(answer, 1) {
            Some(Node::Leaf(name)) => name.clone(),
            Some(other) => emit_lino_term(other),
            None => continue,
        };
        let source = if required.contains_key(&name) {
            "policy-and-declared"
        } else {
            "declared"
        };
        required.insert(name, source);
    }
    for (name, source) in required {
        match check(&name) {
            None => report.obligations.push(UniverseObligation {
                name,
                source,
                status: "unsupported",
                witness: None,
            }),
            Some(witness) => report.obligations.push(UniverseObligation {
                name,
                source,
                status: if witness.is_none() {
                    "holds"
                } else {
                    "violated"
                },
                witness,
            }),
        }
    }
    if report
        .obligations
        .iter()
        .any(|item| item.status == "violated")
    {
        return stop(report, "violated", "obligation-violated");
    }
    if report
        .obligations
        .iter()
        .any(|item| item.status == "unsupported")
    {
        return stop(report, "unsupported", "obligation-not-checkable");
    }
    let reason = if policy_name == "type-in-type" {
        "accepted-relative-to-declared-type-in-type"
    } else {
        "accepted-relative-to-declared-stratification"
    };
    stop(report, "accepted", reason)
}
