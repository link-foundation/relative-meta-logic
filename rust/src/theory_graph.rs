//! Executable meta-theory graph and addressed doublet sequences.
//!
//! The graph reader deliberately round-trips its RML source through the
//! `meta-language` bridge before interpreting theory declarations. This keeps
//! arbitrary user theories on the same representation path as bundled ones.

use crate::meta_language_support::{
    parse_rml_to_meta_language, reconstruct_rml_from_meta_language,
};
use crate::{parse_lino, parse_one, tokenize_one, Node};
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
struct TheoryTerm {
    theory: String,
    term: String,
    address: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TheoryGraph {
    meta_language_round_trip_ok: bool,
    theories: BTreeMap<String, Theory>,
    definitions: Vec<TheoryDefinition>,
    terms: BTreeMap<(String, String), TheoryTerm>,
}

impl TheoryGraph {
    pub fn from_rml(source: &str) -> Result<Self, String> {
        let network = parse_rml_to_meta_language(source);
        let reconstructed = reconstruct_rml_from_meta_language(&network);
        let mut graph = Self {
            meta_language_round_trip_ok: reconstructed == source,
            theories: BTreeMap::new(),
            definitions: Vec::new(),
            terms: BTreeMap::new(),
        };

        for link in parse_lino(&reconstructed) {
            let form = parse_one(&tokenize_one(&link))
                .map_err(|error| format!("invalid theory graph link {link}: {error}"))?;
            let Node::List(children) = &form else {
                continue;
            };
            let Some(Node::Leaf(head)) = children.first() else {
                continue;
            };
            match head.as_str() {
                "theory" => graph.add_theory(children)?,
                "term" => graph.add_term(children)?,
                "definition" => graph.add_definition(children)?,
                _ => {}
            }
        }
        graph.validate()?;
        Ok(graph)
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

    fn validate(&self) -> Result<(), String> {
        for term in self.terms.values() {
            if !self.theories.contains_key(&term.theory) {
                return Err(format!(
                    "term {}.{} references unknown theory {}",
                    term.theory, term.term, term.theory
                ));
            }
        }
        for definition in &self.definitions {
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
        }
        Ok(())
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

    /// Find the shortest cycle-safe chain of definition edges.
    pub fn definition_path(&self, subject: &str, foundation: &str) -> Option<Vec<String>> {
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
struct DoubletSequenceNode {
    value: String,
    next: String,
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
    nodes: BTreeMap<String, DoubletSequenceNode>,
}

impl DoubletSequenceStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn define(&mut self, address: &str, value: &str, next: &str) -> Result<String, String> {
        require_reference(address, "sequence address")?;
        require_reference(value, "sequence value")?;
        require_reference(next, "sequence next address")?;
        if address == EMPTY_SEQUENCE {
            return Err(format!("{EMPTY_SEQUENCE} is reserved"));
        }
        if self.nodes.contains_key(address) {
            return Err(format!("sequence address {address} is already defined"));
        }
        self.nodes.insert(
            address.to_string(),
            DoubletSequenceNode {
                value: value.to_string(),
                next: next.to_string(),
            },
        );
        Ok(address.to_string())
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
                .nodes
                .get(current)
                .ok_or_else(|| format!("unknown sequence address {current}"))?;
            values.push(node.value.clone());
            current = &node.next;
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

    pub fn encode_ordered_set(&mut self, values: &[&str], address: &str) -> Result<String, String> {
        require_reference(address, "ordered set address")?;
        let mut unique = BTreeSet::new();
        for value in values {
            require_reference(value, "ordered set value")?;
            if !unique.insert(*value) {
                return Err(format!("ordered set contains duplicate {value}"));
            }
        }
        let addresses: Vec<_> = (0..values.len())
            .map(|index| format!("{address}.cell.{index}"))
            .collect();
        for cell in &addresses {
            if self.nodes.contains_key(cell) {
                return Err(format!("sequence address {cell} is already defined"));
            }
        }
        let mut next = EMPTY_SEQUENCE.to_string();
        for index in (0..values.len()).rev() {
            self.define(&addresses[index], values[index], &next)?;
            next = addresses[index].clone();
        }
        Ok(next)
    }

    pub fn decode_ordered_set(&self, head: &str) -> Result<Vec<String>, String> {
        require_reference(head, "ordered set head")?;
        let mut values = Vec::new();
        let mut nodes_seen = BTreeSet::new();
        let mut values_seen = BTreeSet::new();
        let mut current = head;
        while current != EMPTY_SEQUENCE {
            if !nodes_seen.insert(current.to_string()) {
                return Err(format!("ordered set must be finite; {head} is cyclic"));
            }
            let node = self
                .nodes
                .get(current)
                .ok_or_else(|| format!("unknown sequence address {current}"))?;
            if !values_seen.insert(node.value.clone()) {
                return Err(format!("ordered set contains duplicate {}", node.value));
            }
            values.push(node.value.clone());
            current = &node.next;
        }
        Ok(values)
    }
}

fn require_reference<'a>(value: &'a str, context: &str) -> Result<&'a str, String> {
    if value.is_empty() {
        Err(format!("{context} must be a non-empty reference"))
    } else {
        Ok(value)
    }
}
