//! Executable meta-theory network and addressed doublet sequences.
//!
//! The network reader deliberately round-trips its RML source through the
//! `meta-language` bridge before interpreting theory declarations. This keeps
//! arbitrary user theories on the same representation path as bundled ones.

use crate::meta_language_support::{
    parse_rml_to_meta_language, reconstruct_rml_from_meta_language,
};
use crate::{
    check_proof_object, key_of, parse_lino, parse_one, parse_proof_assumption_form,
    parse_proof_object_form, parse_rule_form, tokenize_one, CheckProofVerdict, Env, Node,
};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};

pub const EMPTY_SEQUENCE: &str = "rml.sequence.empty";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Theory {
    pub name: String,
    pub address: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TheoryDefinition {
    pub name: String,
    pub subject: String,
    pub using: String,
    pub witness: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TheoryWitness {
    pub address: String,
    pub kind: String,
    pub implementation: String,
    pub proof: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TheoryDefinitionVerification {
    pub definition: String,
    pub witness: String,
    pub proof: String,
    pub implementation: String,
    pub kind: String,
    pub verified: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TheoryTerm {
    theory: String,
    term: String,
    address: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TheoryNetwork {
    meta_language_round_trip_ok: bool,
    theories: BTreeMap<String, Theory>,
    definitions: Vec<TheoryDefinition>,
    terms: BTreeMap<(String, String), TheoryTerm>,
    witnesses: BTreeMap<String, TheoryWitness>,
    verifications: BTreeMap<String, TheoryDefinitionVerification>,
}

impl TheoryNetwork {
    pub fn from_rml(source: &str) -> Result<Self, String> {
        let meta_language_network = parse_rml_to_meta_language(source);
        let reconstructed = reconstruct_rml_from_meta_language(&meta_language_network);
        let mut network = Self {
            meta_language_round_trip_ok: reconstructed == source,
            theories: BTreeMap::new(),
            definitions: Vec::new(),
            terms: BTreeMap::new(),
            witnesses: BTreeMap::new(),
            verifications: BTreeMap::new(),
        };
        let mut proof_env = Env::new(None);
        let mut forms = Vec::new();

        for link in parse_lino(&reconstructed) {
            let form = parse_one(&tokenize_one(&link))
                .map_err(|error| format!("invalid theory network link {link}: {error}"))?;
            let Node::List(children) = &form else {
                continue;
            };
            let Some(Node::Leaf(head)) = children.first() else {
                continue;
            };
            match head.as_str() {
                "theory" => network.add_theory(children)?,
                "term" => network.add_term(children)?,
                "witness" => network.add_witness(children)?,
                "definition" => network.add_definition(children)?,
                _ => {}
            }
            register_proof_form(&mut proof_env, &form)?;
            forms.push(form);
        }
        network.validate(&proof_env, &forms)?;
        Ok(network)
    }

    fn add_theory(&mut self, form: &[Node]) -> Result<(), String> {
        if form.len() < 3 {
            return Err("theory must have a name and address".to_string());
        }
        let name = leaf(&form[1], "theory name")?.to_string();
        let data = clauses(&form[2..], &format!("theory {name}"))?;
        let address = data
            .get("address")
            .ok_or_else(|| format!("theory {name} is missing address"))?
            .clone();
        if self.theories.contains_key(&name) {
            return Err(format!("duplicate theory {name}"));
        }
        if self
            .theories
            .values()
            .any(|theory| theory.address == address)
        {
            return Err(format!("duplicate theory address {address}"));
        }
        self.theories.insert(name.clone(), Theory { name, address });
        Ok(())
    }

    fn add_term(&mut self, form: &[Node]) -> Result<(), String> {
        if form.len() != 4 {
            return Err("term must have the form (term theory local-name address)".to_string());
        }
        let theory = leaf(&form[1], "term theory")?.to_string();
        let term = leaf(&form[2], "term name")?.to_string();
        let address = leaf(&form[3], "term address")?.to_string();
        let key = (theory.clone(), term.clone());
        if let Some(previous) = self.terms.get(&key) {
            if previous.address != address {
                return Err(format!(
                    "term {theory}.{term} maps to both {} and {address}",
                    previous.address
                ));
            }
        }
        self.terms.insert(
            key,
            TheoryTerm {
                theory,
                term,
                address,
            },
        );
        Ok(())
    }

    fn add_definition(&mut self, form: &[Node]) -> Result<(), String> {
        if form.len() < 3 {
            return Err("definition must have a name and clauses".to_string());
        }
        let name = leaf(&form[1], "definition name")?.to_string();
        if self
            .definitions
            .iter()
            .any(|definition| definition.name == name)
        {
            return Err(format!("duplicate definition {name}"));
        }
        let data = clauses(&form[2..], &format!("definition {name}"))?;
        let field = |field: &str| {
            data.get(field)
                .cloned()
                .ok_or_else(|| format!("definition {name} is missing {field}"))
        };
        let subject = field("subject")?;
        let using = field("using")?;
        let witness = field("witness")?;
        self.definitions.push(TheoryDefinition {
            name,
            subject,
            using,
            witness,
        });
        Ok(())
    }

    fn add_witness(&mut self, form: &[Node]) -> Result<(), String> {
        if form.len() < 3 {
            return Err("witness must have an address and clauses".to_string());
        }
        let address = leaf(&form[1], "witness address")?.to_string();
        if self.witnesses.contains_key(&address) {
            return Err(format!("duplicate witness {address}"));
        }
        let data = clauses(&form[2..], &format!("witness {address}"))?;
        let field = |field: &str| {
            data.get(field)
                .cloned()
                .ok_or_else(|| format!("witness {address} is missing {field}"))
        };
        let kind = field("kind")?;
        let implementation = field("implementation")?;
        let proof = field("proof")?;
        self.witnesses.insert(
            address.clone(),
            TheoryWitness {
                address,
                kind,
                implementation,
                proof,
            },
        );
        Ok(())
    }

    fn validate(&mut self, proof_env: &Env, forms: &[Node]) -> Result<(), String> {
        for term in self.terms.values() {
            if !self.theories.contains_key(&term.theory) {
                return Err(format!(
                    "term {}.{} references unknown theory {}",
                    term.theory, term.term, term.theory
                ));
            }
        }
        for definition in self.definitions.clone() {
            if !self.theories.contains_key(&definition.subject) {
                return Err(format!(
                    "definition {} has unknown subject {}",
                    definition.name, definition.subject
                ));
            }
            if !self.theories.contains_key(&definition.using) {
                return Err(format!(
                    "definition {} uses unknown theory {}",
                    definition.name, definition.using
                ));
            }
            let Some(witness) = self.witnesses.get(&definition.witness).cloned() else {
                return Err(format!(
                    "definition {} has unknown witness {}",
                    definition.name, definition.witness
                ));
            };
            self.verify_implementation(&definition, &witness, forms, proof_env)?;
            match check_proof_object(proof_env, &witness.proof) {
                CheckProofVerdict::Ok(_) => {}
                CheckProofVerdict::Err(error) => {
                    return Err(format!(
                        "witness {} has invalid proof {}: {}",
                        witness.address, witness.proof, error
                    ));
                }
            }
            let proof = proof_env
                .get_proof_object(&witness.proof)
                .expect("a successful proof check must resolve its proof object");
            let expected = Node::List(
                [
                    definition.name.as_str(),
                    "defines",
                    definition.subject.as_str(),
                    "using",
                    definition.using.as_str(),
                    "via",
                    witness.implementation.as_str(),
                    "as",
                    witness.kind.as_str(),
                ]
                .into_iter()
                .map(|value| Node::Leaf(value.to_string()))
                .collect(),
            );
            if proof.conclusion != expected {
                return Err(format!(
                    "proof {} does not establish definition {}",
                    witness.proof, definition.name
                ));
            }
            self.verifications.insert(
                definition.name.clone(),
                TheoryDefinitionVerification {
                    definition: definition.name,
                    witness: witness.address,
                    proof: witness.proof,
                    implementation: witness.implementation,
                    kind: witness.kind,
                    verified: true,
                },
            );
        }
        Ok(())
    }

    fn verify_implementation(
        &self,
        definition: &TheoryDefinition,
        witness: &TheoryWitness,
        forms: &[Node],
        proof_env: &Env,
    ) -> Result<(), String> {
        let Some(expected_kind) = implementation_kind(&witness.implementation) else {
            return Err(format!(
                "witness {} uses unknown implementation {}",
                witness.address, witness.implementation
            ));
        };
        if expected_kind != witness.kind {
            return Err(format!(
                "implementation {} requires kind {}, not {}",
                witness.implementation, expected_kind, witness.kind
            ));
        }

        if definition.subject != definition.using {
            let subject_addresses: BTreeSet<&str> = self
                .terms
                .values()
                .filter(|term| term.theory == definition.subject)
                .map(|term| term.address.as_str())
                .collect();
            let shares_address = self.terms.values().any(|term| {
                term.theory == definition.using && subject_addresses.contains(term.address.as_str())
            });
            if !shares_address {
                return Err(format!(
                    "implementation {} has no shared concept between {} and {}",
                    witness.implementation, definition.subject, definition.using
                ));
            }
        }

        match witness.implementation.as_str() {
            "theory-network" => {
                let chain = self.definition_chain(&definition.subject, &definition.using);
                if chain.as_deref() != Some(&[definition.subject.clone(), definition.using.clone()])
                {
                    return Err(
                        "implementation theory-network failed its definition-link probe"
                            .to_string(),
                    );
                }
                return Ok(());
            }
            "addressed-doublet-network" | "typed-doublet-network" => {
                let mut links = LinkNetwork::new();
                links.define("probe.doublet", "probe.source", "probe.target")?;
                if links.doublet("probe.doublet") != Some(("probe.source", "probe.target")) {
                    return Err(format!(
                        "implementation {} failed its doublet probe",
                        witness.implementation
                    ));
                }
                if witness.implementation == "typed-doublet-network"
                    && !has_typed_foundation(proof_env)
                {
                    return Err(
                        "implementation typed-doublet-network is missing its typed foundation"
                            .to_string(),
                    );
                }
                return Ok(());
            }
            "doublet-template" => {
                let expected =
                    "(template (doublet address source target) (address maps-to (source target)))";
                if !forms.iter().any(|form| key_of(form) == expected) {
                    return Err(
                        "implementation doublet-template is missing its executable template"
                            .to_string(),
                    );
                }
                return Ok(());
            }
            "membership-doublet-network" => {
                let mut sets = MembershipSetStore::new();
                sets.define("probe.membership.1", "probe.alpha", "probe.left")?;
                sets.define("probe.membership.2", "probe.beta", "probe.left")?;
                sets.define("probe.membership.3", "probe.beta", "probe.right")?;
                sets.define("probe.membership.4", "probe.alpha", "probe.right")?;
                if !sets.has("probe.left", "probe.alpha")
                    || !sets.equals("probe.left", "probe.right")
                {
                    return Err(
                        "implementation membership-doublet-network failed its membership probe"
                            .to_string(),
                    );
                }
                return Ok(());
            }
            "canonical-doublet-tree" => {
                let mut doublets = DoubletSequenceStore::new();
                let root = doublets
                    .encode_set(&["probe.beta", "probe.alpha", "probe.beta"], "probe.set")?;
                if doublets.decode_set(&root)? != ["probe.alpha", "probe.beta"] {
                    return Err(
                        "implementation canonical-doublet-tree failed its set probe".to_string()
                    );
                }
                return Ok(());
            }
            "typed-kernel-links" => {
                if !has_typed_foundation(proof_env) {
                    return Err(
                        "implementation typed-kernel-links is missing its typed foundation"
                            .to_string(),
                    );
                }
                return Ok(());
            }
            "finite-directed-link-graph" | "vertex-typed-link-graph" => {
                let mut graph = LinkGraph::new("probe.graph")?;
                graph.add_vertex("probe.alpha")?;
                graph.add_vertex("probe.beta")?;
                graph.add_vertex("probe.gamma")?;
                graph.define_edge("probe.edge.1", "probe.alpha", "probe.beta")?;
                graph.define_edge("probe.edge.2", "probe.beta", "probe.gamma")?;
                if !graph.reachable("probe.alpha", "probe.gamma") {
                    return Err(format!(
                        "implementation {} failed its graph probe",
                        witness.implementation
                    ));
                }
                if witness.implementation == "vertex-typed-link-graph"
                    && !has_typed_foundation(proof_env)
                {
                    return Err(
                        "implementation vertex-typed-link-graph is missing its typed foundation"
                            .to_string(),
                    );
                }
                return Ok(());
            }
            "finite-binary-link-relation" | "typed-binary-link-relation" => {
                let mut first = FiniteRelation::new(
                    "probe.relation.first",
                    &["probe.alpha"],
                    &["probe.middle"],
                )?;
                first.define("probe.pair.first", "probe.alpha", "probe.middle")?;
                let mut next = FiniteRelation::new(
                    "probe.relation.next",
                    &["probe.middle"],
                    &["probe.omega"],
                )?;
                next.define("probe.pair.next", "probe.middle", "probe.omega")?;
                if !first
                    .compose(&next, "probe.relation.composed")?
                    .has("probe.alpha", "probe.omega")
                {
                    return Err(format!(
                        "implementation {} failed its relation probe",
                        witness.implementation
                    ));
                }
                if witness.implementation == "typed-binary-link-relation"
                    && !has_typed_foundation(proof_env)
                {
                    return Err(
                        "implementation typed-binary-link-relation is missing its typed foundation"
                            .to_string(),
                    );
                }
                return Ok(());
            }
            _ => {}
        }
        Err(format!(
            "implementation {} has no executable probe",
            witness.implementation
        ))
    }

    pub fn meta_language_round_trip_ok(&self) -> bool {
        self.meta_language_round_trip_ok
    }

    pub fn theory_names(&self) -> Vec<&str> {
        self.theories.keys().map(String::as_str).collect()
    }

    pub fn definitions_for(&self, theory: &str) -> Vec<&TheoryDefinition> {
        self.definitions
            .iter()
            .filter(|definition| definition.subject == theory)
            .collect()
    }

    pub fn definition_witness(&self, address: &str) -> Option<&TheoryWitness> {
        self.witnesses.get(address)
    }

    pub fn definition_verification(&self, name: &str) -> Option<&TheoryDefinitionVerification> {
        self.verifications.get(name)
    }

    pub fn resolve_term(&self, theory: &str, term: &str) -> Option<&str> {
        self.terms
            .get(&(theory.to_string(), term.to_string()))
            .map(|entry| entry.address.as_str())
    }

    pub fn terms_at(&self, address: &str) -> Vec<(&str, &str)> {
        self.terms
            .values()
            .filter(|term| term.address == address)
            .map(|term| (term.theory.as_str(), term.term.as_str()))
            .collect()
    }

    /// Translate a theory-local term through its shared concept address.
    pub fn translate_term(
        &self,
        source_theory: &str,
        source_term: &str,
        target_theory: &str,
    ) -> Vec<&str> {
        let Some(address) = self.resolve_term(source_theory, source_term) else {
            return Vec::new();
        };
        self.terms_at(address)
            .into_iter()
            .filter_map(|(theory, term)| (theory == target_theory).then_some(term))
            .collect()
    }

    /// Find the shortest cycle-safe chain of definition links.
    pub fn definition_chain(&self, subject: &str, foundation: &str) -> Option<Vec<String>> {
        if !self.theories.contains_key(subject) || !self.theories.contains_key(foundation) {
            return None;
        }
        if subject == foundation {
            return Some(vec![subject.to_string()]);
        }
        let mut queue = VecDeque::from([vec![subject.to_string()]]);
        let mut visited = BTreeSet::from([subject.to_string()]);
        while let Some(path) = queue.pop_front() {
            let current = path.last().expect("paths are never empty");
            for definition in self.definitions_for(current) {
                let next = &definition.using;
                if next == foundation {
                    let mut result = path;
                    result.push(next.clone());
                    return Some(result);
                }
                if visited.insert(next.clone()) {
                    let mut candidate = path.clone();
                    candidate.push(next.clone());
                    queue.push_back(candidate);
                }
            }
        }
        None
    }
}

fn implementation_kind(implementation: &str) -> Option<&'static str> {
    match implementation {
        "theory-network" => Some("link-network-composition"),
        "addressed-doublet-network" => Some("set-theoretic-function"),
        "typed-doublet-network" => Some("dependent-function"),
        "doublet-template" => Some("recursive-doublet"),
        "membership-doublet-network" => Some("extensional-set"),
        "canonical-doublet-tree" => Some("finite-set"),
        "typed-kernel-links" => Some("link-typed-foundation"),
        "finite-directed-link-graph" => Some("set-theoretic-graph"),
        "vertex-typed-link-graph" => Some("typed-graph"),
        "finite-binary-link-relation" => Some("set-theoretic-relation"),
        "typed-binary-link-relation" => Some("typed-relation"),
        _ => None,
    }
}

fn has_typed_foundation(env: &Env) -> bool {
    let expected = [
        "pi-formation",
        "lambda-introduction",
        "application-elimination",
        "beta-conversion",
    ];
    env.foundation_report()
        .foundations
        .iter()
        .any(|foundation| {
            foundation.name == "typed-kernel-links"
                && expected
                    .iter()
                    .all(|construct| foundation.uses.iter().any(|item| item == construct))
        })
}

fn is_proof_rule_shape(form: &Node) -> bool {
    let Node::List(children) = form else {
        return false;
    };
    if !matches!(children.first(), Some(Node::Leaf(head)) if head == "rule")
        || !matches!(children.get(1), Some(Node::Leaf(name)) if !name.is_empty())
    {
        return false;
    }
    let clauses = &children[2..];
    clauses.iter().all(|clause| {
        matches!(clause, Node::List(items) if matches!(items.first(), Some(Node::Leaf(head)) if head == "premise" || head == "conclusion"))
    }) && clauses.iter().any(|clause| {
        matches!(clause, Node::List(items) if matches!(items.first(), Some(Node::Leaf(head)) if head == "conclusion"))
    })
}

fn register_proof_form(env: &mut Env, form: &Node) -> Result<(), String> {
    let head = match form {
        Node::List(children) => match children.first() {
            Some(Node::Leaf(head)) => head.as_str(),
            _ => return Ok(()),
        },
        _ => return Ok(()),
    };
    if is_proof_rule_shape(form) {
        env.register_proof_rule(parse_rule_form(form)?);
    } else if head == "axiom" || head == "assumption" {
        env.register_proof_assumption(parse_proof_assumption_form(form)?);
    } else if head == "proof-object" {
        env.register_proof_object(parse_proof_object_form(form)?);
    }
    Ok(())
}

fn leaf<'a>(node: &'a Node, context: &str) -> Result<&'a str, String> {
    match node {
        Node::Leaf(value) if !value.is_empty() => Ok(value),
        _ => Err(format!("{context} must be a non-empty reference")),
    }
}

fn clauses(nodes: &[Node], context: &str) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for node in nodes {
        let Node::List(clause) = node else {
            return Err(format!("{context} clauses must have the form (name value)"));
        };
        if clause.len() != 2 {
            return Err(format!("{context} clauses must have the form (name value)"));
        }
        let name = leaf(&clause[0], &format!("{context} clause name"))?;
        let value = leaf(&clause[1], &format!("{context} {name}"))?;
        if result.insert(name.to_string(), value.to_string()).is_some() {
            return Err(format!("{context} repeats clause {name}"));
        }
    }
    Ok(result)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LinkNode {
    source: String,
    target: String,
}

/// The unconstrained addressed-doublet substrate used by every interpretation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LinkNetwork {
    links: BTreeMap<String, LinkNode>,
}

impl LinkNetwork {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn define(&mut self, address: &str, source: &str, target: &str) -> Result<String, String> {
        require_reference(address, "link address")?;
        require_reference(source, "link source")?;
        require_reference(target, "link target")?;
        if self.links.contains_key(address) {
            return Err(format!("link address {address} is already defined"));
        }
        self.links.insert(
            address.to_string(),
            LinkNode {
                source: source.to_string(),
                target: target.to_string(),
            },
        );
        Ok(address.to_string())
    }

    pub fn doublet(&self, address: &str) -> Option<(&str, &str)> {
        self.links
            .get(address)
            .map(|link| (link.source.as_str(), link.target.as_str()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SequenceLayout {
    Balanced,
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SequenceTree {
    Leaf(String),
    Branch(Box<SequenceTree>, Box<SequenceTree>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SequenceWalk {
    pub values: Vec<String>,
    pub complete: bool,
    pub cyclic: bool,
    pub cycle_at: Option<usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DoubletSequenceStore {
    network: LinkNetwork,
}

impl DoubletSequenceStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn define(&mut self, address: &str, source: &str, target: &str) -> Result<String, String> {
        require_reference(address, "sequence address")?;
        require_reference(source, "sequence source")?;
        require_reference(target, "sequence target")?;
        if address == EMPTY_SEQUENCE {
            return Err(format!("{EMPTY_SEQUENCE} is reserved"));
        }
        if self.network.links.contains_key(address) {
            return Err(format!("sequence address {address} is already defined"));
        }
        self.network.links.insert(
            address.to_string(),
            LinkNode {
                source: source.to_string(),
                target: target.to_string(),
            },
        );
        Ok(address.to_string())
    }

    /// Return the source and target references stored at an address.
    pub fn doublet(&self, address: &str) -> Option<(&str, &str)> {
        self.network
            .links
            .get(address)
            .map(|node| (node.source.as_str(), node.target.as_str()))
    }

    pub fn walk(&self, head: &str, limit: usize) -> Result<SequenceWalk, String> {
        require_reference(head, "sequence head")?;
        let mut values = Vec::new();
        let mut seen = HashMap::new();
        let mut current = head;
        let mut cycle_at = None;
        while current != EMPTY_SEQUENCE && values.len() < limit {
            if !seen.contains_key(current) {
                seen.insert(current.to_string(), values.len());
            }
            let node = self
                .network
                .links
                .get(current)
                .ok_or_else(|| format!("unknown sequence address {current}"))?;
            values.push(node.source.clone());
            current = &node.target;
            if current != EMPTY_SEQUENCE && cycle_at.is_none() {
                cycle_at = seen.get(current).copied();
            }
        }
        Ok(SequenceWalk {
            values,
            complete: current == EMPTY_SEQUENCE,
            cyclic: cycle_at.is_some(),
            cycle_at,
        })
    }

    /// Encode a finite sequence as a nested tree of addressed doublets.
    pub fn encode_sequence(
        &mut self,
        values: &[&str],
        address: &str,
        layout: SequenceLayout,
    ) -> Result<String, String> {
        require_reference(address, "sequence address")?;
        let references = values
            .iter()
            .map(|value| {
                require_reference(value, "sequence value")?;
                Ok((*value).to_string())
            })
            .collect::<Result<Vec<_>, String>>()?;
        if references.is_empty() {
            return Ok(EMPTY_SEQUENCE.to_string());
        }
        if references.len() == 1 {
            return Ok(references[0].clone());
        }

        let tree = sequence_tree(&references, layout);
        let mut next_cell = 0;
        let mut entries = Vec::new();
        let head = serialize_sequence_tree(&tree, address, &mut next_cell, &mut entries);
        for (node_address, _, _) in &entries {
            if self.network.links.contains_key(node_address) {
                return Err(format!(
                    "sequence address {node_address} is already defined"
                ));
            }
            if references.contains(node_address) {
                return Err(format!(
                    "sequence value {node_address} collides with an internal link"
                ));
            }
        }
        for (node_address, source, target) in entries {
            self.define(&node_address, &source, &target)?;
        }
        Ok(head)
    }

    /// Decode a finite nested-doublet sequence in left-to-right leaf order.
    pub fn decode_sequence(&self, head: &str) -> Result<Vec<String>, String> {
        require_reference(head, "sequence head")?;
        let mut values = Vec::new();
        let mut active = BTreeSet::new();
        self.decode_sequence_reference(head, head, &mut active, &mut values)?;
        Ok(values)
    }

    fn decode_sequence_reference(
        &self,
        reference: &str,
        head: &str,
        active: &mut BTreeSet<String>,
        values: &mut Vec<String>,
    ) -> Result<(), String> {
        if reference == EMPTY_SEQUENCE {
            return Ok(());
        }
        let Some(node) = self.network.links.get(reference) else {
            values.push(reference.to_string());
            return Ok(());
        };
        if !active.insert(reference.to_string()) {
            return Err(format!("sequence {head} is cyclic"));
        }
        self.decode_sequence_reference(&node.source, head, active, values)?;
        self.decode_sequence_reference(&node.target, head, active, values)?;
        active.remove(reference);
        Ok(())
    }

    pub fn encode_ordered_set(&mut self, values: &[&str], address: &str) -> Result<String, String> {
        require_reference(address, "ordered set address")?;
        let mut unique = BTreeSet::new();
        for value in values {
            require_reference(value, "ordered set value")?;
            if !unique.insert(*value) {
                return Err(format!("ordered set contains duplicate {value}"));
            }
        }
        self.encode_sequence(values, address, SequenceLayout::Balanced)
    }

    pub fn decode_ordered_set(&self, head: &str) -> Result<Vec<String>, String> {
        require_reference(head, "ordered set head")?;
        let values = self.decode_sequence(head).map_err(|error| {
            if error == format!("sequence {head} is cyclic") {
                format!("ordered set must be finite; {head} is cyclic")
            } else {
                error
            }
        })?;
        let mut values_seen = BTreeSet::new();
        for value in &values {
            if !values_seen.insert(value.clone()) {
                return Err(format!("ordered set contains duplicate {value}"));
            }
        }
        Ok(values)
    }

    /// Encode an extensional finite set in canonical reference order.
    pub fn encode_set(&mut self, values: &[&str], address: &str) -> Result<String, String> {
        require_reference(address, "set address")?;
        let mut canonical = BTreeSet::new();
        for value in values {
            require_reference(value, "set value")?;
            canonical.insert(*value);
        }
        let canonical: Vec<_> = canonical.into_iter().collect();
        self.encode_sequence(&canonical, address, SequenceLayout::Balanced)
    }

    /// Decode a canonical finite-set tree and verify its ordering invariant.
    pub fn decode_set(&self, head: &str) -> Result<Vec<String>, String> {
        let values = self.decode_sequence(head)?;
        if values.windows(2).any(|window| window[0] >= window[1]) {
            return Err(format!("set {head} is not in strict canonical order"));
        }
        Ok(values)
    }
}

/// Extensional finite sets represented by addressed `(element, set)` links.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MembershipSetStore {
    doublets: LinkNetwork,
    memberships: BTreeMap<String, (String, String)>,
}

impl MembershipSetStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn define(&mut self, address: &str, element: &str, set: &str) -> Result<String, String> {
        require_reference(element, "set member")?;
        require_reference(set, "set address")?;
        let address = self.doublets.define(address, element, set)?;
        self.memberships
            .insert(address.clone(), (element.to_string(), set.to_string()));
        Ok(address)
    }

    pub fn has(&self, set: &str, element: &str) -> bool {
        self.memberships
            .values()
            .any(|(member, owner)| owner == set && member == element)
    }

    pub fn members(&self, set: &str) -> Vec<&str> {
        self.memberships
            .values()
            .filter_map(|(member, owner)| (owner == set).then_some(member.as_str()))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    pub fn equals(&self, left: &str, right: &str) -> bool {
        self.members(left) == self.members(right)
    }
}

/// A finite directed graph constrained to a vertex set and represented by links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkGraph {
    address: String,
    vertex_memberships: MembershipSetStore,
    edges: LinkNetwork,
    edge_addresses: BTreeSet<String>,
    next_vertex_membership: usize,
}

impl LinkGraph {
    pub fn new(address: &str) -> Result<Self, String> {
        require_reference(address, "graph address")?;
        Ok(Self {
            address: address.to_string(),
            vertex_memberships: MembershipSetStore::new(),
            edges: LinkNetwork::new(),
            edge_addresses: BTreeSet::new(),
            next_vertex_membership: 0,
        })
    }

    pub fn add_vertex(&mut self, vertex: &str) -> Result<String, String> {
        require_reference(vertex, "graph vertex")?;
        if self.vertex_memberships.has(&self.address, vertex) {
            return Err(format!("vertex {vertex} is already in {}", self.address));
        }
        let membership = format!(
            "{}.vertex-membership.{}",
            self.address, self.next_vertex_membership
        );
        self.next_vertex_membership += 1;
        self.vertex_memberships
            .define(&membership, vertex, &self.address)?;
        Ok(vertex.to_string())
    }

    pub fn vertices(&self) -> Vec<&str> {
        self.vertex_memberships.members(&self.address)
    }

    pub fn define_edge(
        &mut self,
        address: &str,
        source: &str,
        target: &str,
    ) -> Result<String, String> {
        require_reference(source, "edge source")?;
        require_reference(target, "edge target")?;
        if !self.vertex_memberships.has(&self.address, source) {
            return Err(format!(
                "edge source {source} is not a vertex of {}",
                self.address
            ));
        }
        if !self.vertex_memberships.has(&self.address, target) {
            return Err(format!(
                "edge target {target} is not a vertex of {}",
                self.address
            ));
        }
        let address = self.edges.define(address, source, target)?;
        self.edge_addresses.insert(address.clone());
        Ok(address)
    }

    pub fn edge(&self, address: &str) -> Option<(&str, &str)> {
        self.edge_addresses
            .contains(address)
            .then(|| self.edges.doublet(address))
            .flatten()
    }

    pub fn successors(&self, vertex: &str) -> Vec<&str> {
        self.edge_addresses
            .iter()
            .filter_map(|address| self.edges.doublet(address))
            .filter_map(|(source, target)| (source == vertex).then_some(target))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    pub fn reachable(&self, source: &str, target: &str) -> bool {
        if !self.vertex_memberships.has(&self.address, source)
            || !self.vertex_memberships.has(&self.address, target)
        {
            return false;
        }
        let mut queue = VecDeque::from([source]);
        let mut visited = BTreeSet::from([source]);
        while let Some(current) = queue.pop_front() {
            if current == target {
                return true;
            }
            for successor in self.successors(current) {
                if visited.insert(successor) {
                    queue.push_back(successor);
                }
            }
        }
        false
    }
}

/// A finite typed binary relation with standard set-theoretic operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FiniteRelation {
    address: String,
    domain: BTreeSet<String>,
    codomain: BTreeSet<String>,
    type_memberships: MembershipSetStore,
    links: LinkNetwork,
    relation_pairs: BTreeMap<String, (String, String)>,
}

impl FiniteRelation {
    pub fn new(address: &str, domain: &[&str], codomain: &[&str]) -> Result<Self, String> {
        require_reference(address, "relation address")?;
        let domain = domain
            .iter()
            .map(|value| {
                require_reference(value, "relation domain value")?;
                Ok((*value).to_string())
            })
            .collect::<Result<BTreeSet<_>, String>>()?;
        let codomain = codomain
            .iter()
            .map(|value| {
                require_reference(value, "relation codomain value")?;
                Ok((*value).to_string())
            })
            .collect::<Result<BTreeSet<_>, String>>()?;
        let mut relation = Self {
            address: address.to_string(),
            domain,
            codomain,
            type_memberships: MembershipSetStore::new(),
            links: LinkNetwork::new(),
            relation_pairs: BTreeMap::new(),
        };
        for (index, value) in relation.domain.iter().enumerate() {
            relation.type_memberships.define(
                &format!("{address}.domain.{index}"),
                value,
                &format!("{address}.domain"),
            )?;
        }
        for (index, value) in relation.codomain.iter().enumerate() {
            relation.type_memberships.define(
                &format!("{address}.codomain.{index}"),
                value,
                &format!("{address}.codomain"),
            )?;
        }
        Ok(relation)
    }

    pub fn define(&mut self, address: &str, left: &str, right: &str) -> Result<String, String> {
        require_reference(left, "relation left value")?;
        require_reference(right, "relation right value")?;
        if !self.domain.contains(left) {
            return Err(format!(
                "relation left value {left} is outside the declared domain"
            ));
        }
        if !self.codomain.contains(right) {
            return Err(format!(
                "relation right value {right} is outside the declared codomain"
            ));
        }
        if self.has(left, right) {
            return Err(format!(
                "relation {} already contains ({left}, {right})",
                self.address
            ));
        }
        let address = self.links.define(address, left, right)?;
        self.relation_pairs
            .insert(address.clone(), (left.to_string(), right.to_string()));
        Ok(address)
    }

    pub fn has(&self, left: &str, right: &str) -> bool {
        self.relation_pairs
            .values()
            .any(|(pair_left, pair_right)| pair_left == left && pair_right == right)
    }

    pub fn pairs(&self) -> Vec<(&str, &str)> {
        self.relation_pairs
            .values()
            .map(|(left, right)| (left.as_str(), right.as_str()))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    pub fn converse(&self, address: &str) -> Result<Self, String> {
        relation_from_pairs(
            address,
            &self.codomain,
            &self.domain,
            self.pairs()
                .into_iter()
                .map(|(left, right)| (right.to_string(), left.to_string())),
        )
    }

    pub fn union(&self, other: &Self, address: &str) -> Result<Self, String> {
        self.require_same_signature(other, "union")?;
        relation_from_pairs(
            address,
            &self.domain,
            &self.codomain,
            self.pairs()
                .into_iter()
                .chain(other.pairs())
                .map(|(left, right)| (left.to_string(), right.to_string())),
        )
    }

    pub fn intersection(&self, other: &Self, address: &str) -> Result<Self, String> {
        self.require_same_signature(other, "intersection")?;
        relation_from_pairs(
            address,
            &self.domain,
            &self.codomain,
            self.pairs()
                .into_iter()
                .filter(|(left, right)| other.has(left, right))
                .map(|(left, right)| (left.to_string(), right.to_string())),
        )
    }

    pub fn compose(&self, next: &Self, address: &str) -> Result<Self, String> {
        if self.codomain != next.domain {
            return Err(
                "relation composition requires the first codomain to equal the next domain"
                    .to_string(),
            );
        }
        let mut pairs = Vec::new();
        for (left, middle) in self.pairs() {
            for (next_middle, right) in next.pairs() {
                if middle == next_middle {
                    pairs.push((left.to_string(), right.to_string()));
                }
            }
        }
        relation_from_pairs(address, &self.domain, &next.codomain, pairs)
    }

    fn require_same_signature(&self, other: &Self, operation: &str) -> Result<(), String> {
        if self.domain != other.domain || self.codomain != other.codomain {
            return Err(format!(
                "relation {operation} requires equal domains and codomains"
            ));
        }
        Ok(())
    }
}

fn relation_from_pairs(
    address: &str,
    domain: &BTreeSet<String>,
    codomain: &BTreeSet<String>,
    pairs: impl IntoIterator<Item = (String, String)>,
) -> Result<FiniteRelation, String> {
    let domain: Vec<_> = domain.iter().map(String::as_str).collect();
    let codomain: Vec<_> = codomain.iter().map(String::as_str).collect();
    let mut relation = FiniteRelation::new(address, &domain, &codomain)?;
    for (index, (left, right)) in pairs
        .into_iter()
        .collect::<BTreeSet<_>>()
        .iter()
        .enumerate()
    {
        relation.define(&format!("{address}.pair.{index}"), left, right)?;
    }
    Ok(relation)
}

fn sequence_tree(values: &[String], layout: SequenceLayout) -> SequenceTree {
    let leaf = |value: &String| SequenceTree::Leaf(value.clone());
    match layout {
        SequenceLayout::Balanced => {
            if values.len() == 1 {
                leaf(&values[0])
            } else {
                let middle = values.len() / 2;
                SequenceTree::Branch(
                    Box::new(sequence_tree(&values[..middle], layout)),
                    Box::new(sequence_tree(&values[middle..], layout)),
                )
            }
        }
        SequenceLayout::Left => {
            let mut tree =
                SequenceTree::Branch(Box::new(leaf(&values[0])), Box::new(leaf(&values[1])));
            for value in &values[2..] {
                tree = SequenceTree::Branch(Box::new(tree), Box::new(leaf(value)));
            }
            tree
        }
        SequenceLayout::Right => {
            let mut tree = leaf(values.last().expect("sequences are non-empty"));
            for value in values[..values.len() - 1].iter().rev() {
                tree = SequenceTree::Branch(Box::new(leaf(value)), Box::new(tree));
            }
            tree
        }
    }
}

fn serialize_sequence_tree(
    tree: &SequenceTree,
    address: &str,
    next_cell: &mut usize,
    entries: &mut Vec<(String, String, String)>,
) -> String {
    match tree {
        SequenceTree::Leaf(value) => value.clone(),
        SequenceTree::Branch(source, target) => {
            let node_address = format!("{address}.cell.{next_cell}");
            *next_cell += 1;
            let source = serialize_sequence_tree(source, address, next_cell, entries);
            let target = serialize_sequence_tree(target, address, next_cell, entries);
            entries.push((node_address.clone(), source, target));
            node_address
        }
    }
}

fn require_reference<'a>(value: &'a str, context: &str) -> Result<&'a str, String> {
    if value.is_empty() {
        Err(format!("{context} must be a non-empty reference"))
    } else {
        Ok(value)
    }
}
