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
pub struct TheoryImplementation {
    pub name: String,
    pub adapter: String,
    pub kind: String,
    pub subject: String,
    pub using: String,
    pub obligations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TheoryDefinitionVerification {
    pub definition: String,
    pub witness: String,
    pub proof: String,
    pub implementation: String,
    pub kind: String,
    pub obligations: Vec<String>,
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
    implementations: BTreeMap<String, TheoryImplementation>,
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
            implementations: BTreeMap::new(),
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
                "implementation" => network.add_implementation(children)?,
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

    fn add_implementation(&mut self, form: &[Node]) -> Result<(), String> {
        if form.len() < 3 {
            return Err("implementation must have a name and clauses".to_string());
        }
        let name = leaf(&form[1], "implementation name")?.to_string();
        if self.implementations.contains_key(&name) {
            return Err(format!("duplicate implementation {name}"));
        }
        let (data, obligations) =
            implementation_clauses(&form[2..], &format!("implementation {name}"))?;
        for key in data.keys() {
            if !matches!(key.as_str(), "adapter" | "kind" | "subject" | "using") {
                return Err(format!(
                    "implementation {name} has unsupported clause {key}"
                ));
            }
        }
        let field = |field: &str| {
            data.get(field)
                .cloned()
                .ok_or_else(|| format!("implementation {name} is missing {field}"))
        };
        if obligations.is_empty() {
            return Err(format!("implementation {name} is missing obligations"));
        }
        let adapter = field("adapter")?;
        let kind = field("kind")?;
        let subject = field("subject")?;
        let using = field("using")?;
        self.implementations.insert(
            name.clone(),
            TheoryImplementation {
                name,
                adapter,
                kind,
                subject,
                using,
                obligations,
            },
        );
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
            let Some(implementation) = self.implementations.get(&witness.implementation).cloned()
            else {
                return Err(format!(
                    "witness {} uses unknown implementation {}",
                    witness.address, witness.implementation
                ));
            };
            let obligations = self.verify_implementation(
                &definition,
                &witness,
                &implementation,
                forms,
                proof_env,
            )?;
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
                    obligations,
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
        implementation: &TheoryImplementation,
        forms: &[Node],
        proof_env: &Env,
    ) -> Result<Vec<String>, String> {
        let Some(contract) = implementation_contract(&implementation.adapter) else {
            return Err(format!(
                "implementation {} uses unknown adapter {}",
                implementation.name, implementation.adapter
            ));
        };
        if implementation.kind != contract.kind {
            return Err(format!(
                "implementation {} adapter {} requires kind {}, not {}",
                implementation.name, implementation.adapter, contract.kind, implementation.kind
            ));
        }
        if implementation.kind != witness.kind {
            return Err(format!(
                "implementation {} requires kind {}, not {}",
                implementation.name, implementation.kind, witness.kind
            ));
        }
        if implementation.subject != definition.subject || implementation.using != definition.using
        {
            return Err(format!(
                "implementation {} is declared for {} using {}, not {} using {}",
                implementation.name,
                implementation.subject,
                implementation.using,
                definition.subject,
                definition.using
            ));
        }
        let declared_obligations: BTreeSet<_> =
            implementation.obligations.iter().cloned().collect();
        let expected_obligations: BTreeSet<_> = contract
            .obligations
            .iter()
            .map(|item| item.to_string())
            .collect();
        if declared_obligations != expected_obligations {
            return Err(format!(
                "implementation {} obligations do not match adapter {}",
                implementation.name, implementation.adapter
            ));
        }

        let verified = || {
            contract
                .obligations
                .iter()
                .map(|item| item.to_string())
                .collect()
        };

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

        match implementation.adapter.as_str() {
            "theory-network" => {
                if !self.meta_language_round_trip_ok {
                    return Err(
                        "implementation theory-network failed its meta-language round trip"
                            .to_string(),
                    );
                }
                let chain = self.definition_chain(&definition.subject, &definition.using);
                if chain.as_deref() != Some(&[definition.subject.clone(), definition.using.clone()])
                {
                    return Err(
                        "implementation theory-network failed its definition-link probe"
                            .to_string(),
                    );
                }
                return Ok(verified());
            }
            "addressed-doublet-network" => {
                let mut links = LinkNetwork::new();
                links.define("probe.doublet", "probe.source", "probe.target")?;
                if links.doublet("probe.doublet") != Some(("probe.source", "probe.target")) {
                    return Err(format!(
                        "implementation {} failed its doublet probe",
                        implementation.name
                    ));
                }
                if links
                    .define("probe.doublet", "probe.other", "probe.value")
                    .is_ok()
                {
                    return Err(
                        "implementation addressed-doublet-network is not an address function"
                            .to_string(),
                    );
                }
                return Ok(verified());
            }
            "typed-doublet-network" => {
                let mut links = TypedLinkNetwork::new();
                links.declare("probe.source", "Reference")?;
                links.declare("probe.target", "Reference")?;
                links.declare("probe.wrong", "NotReference")?;
                links.define(
                    "probe.typed-doublet",
                    "probe.source",
                    "probe.target",
                    "Reference",
                    "Reference",
                )?;
                if links.type_of("probe.typed-doublet") != Some("(Pair Reference Reference)")
                    || links
                        .define(
                            "probe.invalid-doublet",
                            "probe.wrong",
                            "probe.target",
                            "Reference",
                            "Reference",
                        )
                        .is_ok()
                    || !has_typed_foundation(proof_env)
                {
                    return Err(
                        "implementation typed-doublet-network failed typed enforcement or proof replay"
                            .to_string(),
                    );
                }
                return Ok(verified());
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
                let mut recursive = LinkNetwork::new();
                recursive.define("probe.self", "probe.self", "probe.self")?;
                if recursive.doublet("probe.self") != Some(("probe.self", "probe.self")) {
                    return Err(
                        "implementation doublet-template failed its recursive-reference probe"
                            .to_string(),
                    );
                }
                return Ok(verified());
            }
            "membership-doublet-network" => {
                let mut sets = MembershipSetStore::new();
                sets.define("probe.membership.1", "probe.alpha", "probe.left")?;
                sets.define("probe.membership.2", "probe.beta", "probe.left")?;
                sets.define("probe.membership.3", "probe.beta", "probe.right")?;
                sets.define("probe.membership.4", "probe.alpha", "probe.right")?;
                if !sets.has("probe.left", "probe.alpha")
                    || !sets.is_subset_of("probe.left", "probe.right")
                    || !sets.equals("probe.left", "probe.right")
                {
                    return Err(
                        "implementation membership-doublet-network failed its membership probe"
                            .to_string(),
                    );
                }
                sets.define("probe.collection.1", "probe.left", "probe.collection")?;
                sets.define("probe.collection.2", "probe.right", "probe.collection")?;
                if sets.pair("probe.alpha", "probe.beta")? != ["probe.alpha", "probe.beta"]
                    || sets.union("probe.collection") != ["probe.alpha", "probe.beta"]
                    || sets.separation("probe.left", |value| value == "probe.beta")
                        != ["probe.beta"]
                    || sets.replacement("probe.left", |value| format!("{value}.image"))?
                        != ["probe.alpha.image", "probe.beta.image"]
                {
                    return Err(
                        "implementation membership-doublet-network failed its set algebra probe"
                            .to_string(),
                    );
                }
                return Ok(verified());
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
                if doublets.doublet(&root).is_none() {
                    return Err(
                        "implementation canonical-doublet-tree did not create nested doublets"
                            .to_string(),
                    );
                }
                return Ok(verified());
            }
            "typed-kernel-links" => {
                if !has_typed_foundation(proof_env) {
                    return Err(
                        "implementation typed-kernel-links is missing its typed foundation"
                            .to_string(),
                    );
                }
                return Ok(verified());
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
                        implementation.name
                    ));
                }
                if graph
                    .define_edge("probe.edge.invalid", "probe.alpha", "probe.missing")
                    .is_ok()
                {
                    return Err(format!(
                        "implementation {} failed endpoint closure",
                        implementation.name
                    ));
                }
                if implementation.adapter == "vertex-typed-link-graph"
                    && (graph.edge_type("probe.edge.1")
                        != Some("(Pair probe.graph.vertex probe.graph.vertex)")
                        || !has_typed_foundation(proof_env))
                {
                    return Err(
                        "implementation vertex-typed-link-graph failed edge typing or proof replay"
                            .to_string(),
                    );
                }
                return Ok(verified());
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
                let mut extra = FiniteRelation::new(
                    "probe.relation.extra",
                    &["probe.alpha"],
                    &["probe.middle"],
                )?;
                extra.define("probe.pair.extra", "probe.alpha", "probe.middle")?;
                let domain_rejected = first
                    .define("probe.pair.invalid-left", "probe.outside", "probe.middle")
                    .is_err();
                let codomain_rejected = first
                    .define("probe.pair.invalid-right", "probe.alpha", "probe.outside")
                    .is_err();
                if !first
                    .compose(&next, "probe.relation.composed")?
                    .has("probe.alpha", "probe.omega")
                    || !first
                        .converse("probe.relation.converse")?
                        .has("probe.middle", "probe.alpha")
                    || !first
                        .union(&extra, "probe.relation.union")?
                        .has("probe.alpha", "probe.middle")
                    || !first
                        .intersection(&extra, "probe.relation.intersection")?
                        .has("probe.alpha", "probe.middle")
                    || !domain_rejected
                    || !codomain_rejected
                {
                    return Err(format!(
                        "implementation {} failed its relation probe",
                        implementation.name
                    ));
                }
                if implementation.adapter == "typed-binary-link-relation"
                    && (first.pair_type("probe.pair.first")
                        != Some("(Pair probe.relation.first.domain probe.relation.first.codomain)")
                        || !has_typed_foundation(proof_env))
                {
                    return Err(
                        "implementation typed-binary-link-relation failed pair typing or proof replay"
                            .to_string(),
                    );
                }
                return Ok(verified());
            }
            _ => {}
        }
        Err(format!(
            "implementation {} has no executable probe",
            implementation.name
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

    pub fn implementation(&self, name: &str) -> Option<&TheoryImplementation> {
        self.implementations.get(name)
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

struct ImplementationContract {
    kind: &'static str,
    obligations: &'static [&'static str],
}

fn implementation_contract(adapter: &str) -> Option<ImplementationContract> {
    let contract = match adapter {
        "theory-network" => ImplementationContract {
            kind: "link-network-composition",
            obligations: &["meta-language-round-trip", "definition-link"],
        },
        "addressed-doublet-network" => ImplementationContract {
            kind: "set-theoretic-function",
            obligations: &["address-function", "ordered-pair"],
        },
        "typed-doublet-network" => ImplementationContract {
            kind: "dependent-function",
            obligations: &[
                "reference-typing",
                "dependent-pair",
                "ill-typed-rejection",
                "typed-proof-replay",
            ],
        },
        "doublet-template" => ImplementationContract {
            kind: "recursive-doublet",
            obligations: &["template-expansion", "recursive-reference"],
        },
        "membership-doublet-network" => ImplementationContract {
            kind: "extensional-set",
            obligations: &[
                "membership",
                "subset",
                "extensional-equality",
                "pairing",
                "union",
                "separation",
                "replacement",
            ],
        },
        "canonical-doublet-tree" => ImplementationContract {
            kind: "finite-set",
            obligations: &["nested-doublets", "canonical-order", "unique-members"],
        },
        "typed-kernel-links" => ImplementationContract {
            kind: "link-typed-foundation",
            obligations: &[
                "pi-formation",
                "lambda-introduction",
                "application-elimination",
                "beta-conversion",
            ],
        },
        "finite-directed-link-graph" => ImplementationContract {
            kind: "set-theoretic-graph",
            obligations: &["finite-vertex-set", "endpoint-closure", "reachability"],
        },
        "vertex-typed-link-graph" => ImplementationContract {
            kind: "typed-graph",
            obligations: &[
                "finite-vertex-set",
                "endpoint-closure",
                "reachability",
                "edge-typing",
                "typed-proof-replay",
            ],
        },
        "finite-binary-link-relation" => ImplementationContract {
            kind: "set-theoretic-relation",
            obligations: &[
                "domain-closure",
                "codomain-closure",
                "converse",
                "union",
                "intersection",
                "composition",
            ],
        },
        "typed-binary-link-relation" => ImplementationContract {
            kind: "typed-relation",
            obligations: &[
                "domain-closure",
                "codomain-closure",
                "converse",
                "union",
                "intersection",
                "composition",
                "pair-typing",
                "typed-proof-replay",
            ],
        },
        _ => return None,
    };
    Some(contract)
}

fn has_typed_foundation(env: &Env) -> bool {
    let expected = [
        "pi-formation",
        "lambda-introduction",
        "application-elimination",
        "beta-conversion",
    ];
    let foundation_present = env
        .foundation_report()
        .foundations
        .iter()
        .any(|foundation| {
            foundation.name == "typed-kernel-links"
                && expected
                    .iter()
                    .all(|construct| foundation.uses.iter().any(|item| item == construct))
        });
    let witnesses = [
        (
            "rml.type.proof.pi-formation",
            "(empty turnstile ((Pi (x has-type Nat) Nat) has-type Type0))",
        ),
        (
            "rml.type.proof.lambda-introduction",
            "(empty turnstile ((lambda (x has-type Nat) x) has-type (Pi (x has-type Nat) Nat)))",
        ),
        (
            "rml.type.proof.application-elimination",
            "(empty turnstile ((apply (lambda (x has-type Nat) x) zero) has-type (subst Nat x zero)))",
        ),
        (
            "rml.type.proof.beta-conversion",
            "(empty turnstile (zero has-type (subst Nat x zero)))",
        ),
    ];
    foundation_present
        && witnesses.iter().all(|(proof_name, expected_conclusion)| {
            if !matches!(
                check_proof_object(env, proof_name),
                CheckProofVerdict::Ok(_)
            ) {
                return false;
            }
            let Some(proof) = env.get_proof_object(proof_name) else {
                return false;
            };
            let Ok(expected) = parse_one(&tokenize_one(expected_conclusion)) else {
                return false;
            };
            proof.conclusion == expected
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

fn implementation_clauses(
    nodes: &[Node],
    context: &str,
) -> Result<(BTreeMap<String, String>, Vec<String>), String> {
    let mut data = BTreeMap::new();
    let mut obligations = Vec::new();
    for node in nodes {
        let Node::List(clause) = node else {
            return Err(format!("{context} clauses must have the form (name value)"));
        };
        if clause.len() != 2 {
            return Err(format!("{context} clauses must have the form (name value)"));
        }
        let name = leaf(&clause[0], &format!("{context} clause name"))?;
        let value = leaf(&clause[1], &format!("{context} {name}"))?;
        if name == "obligation" {
            if obligations.iter().any(|item| item == value) {
                return Err(format!("{context} repeats obligation {value}"));
            }
            obligations.push(value.to_string());
        } else if data.insert(name.to_string(), value.to_string()).is_some() {
            return Err(format!("{context} repeats clause {name}"));
        }
    }
    Ok((data, obligations))
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

/// A link network whose references and ordered-pair endpoints are type checked.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TypedLinkNetwork {
    links: LinkNetwork,
    types: BTreeMap<String, BTreeSet<String>>,
}

impl TypedLinkNetwork {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn declare(&mut self, address: &str, r#type: &str) -> Result<String, String> {
        require_reference(address, "typed reference address")?;
        require_reference(r#type, "typed reference type")?;
        self.types
            .entry(address.to_string())
            .or_default()
            .insert(r#type.to_string());
        Ok(address.to_string())
    }

    pub fn define(
        &mut self,
        address: &str,
        source: &str,
        target: &str,
        source_type: &str,
        target_type: &str,
    ) -> Result<String, String> {
        require_reference(source_type, "link source type")?;
        require_reference(target_type, "link target type")?;
        self.require_type(source, source_type, "source")?;
        self.require_type(target, target_type, "target")?;
        let address = self.links.define(address, source, target)?;
        self.types.insert(
            address.clone(),
            BTreeSet::from([format!("(Pair {source_type} {target_type})")]),
        );
        Ok(address)
    }

    pub fn doublet(&self, address: &str) -> Option<(&str, &str)> {
        self.links.doublet(address)
    }

    pub fn type_of(&self, address: &str) -> Option<&str> {
        let declared = self.types.get(address)?;
        (declared.len() == 1)
            .then(|| declared.first().map(String::as_str))
            .flatten()
    }

    pub fn types_of(&self, address: &str) -> Vec<&str> {
        self.types
            .get(address)
            .into_iter()
            .flat_map(|declared| declared.iter().map(String::as_str))
            .collect()
    }

    fn require_type(&self, address: &str, expected: &str, role: &str) -> Result<(), String> {
        let Some(declared) = self.types.get(address) else {
            return Err(format!("typed link {role} {address} has no declared type"));
        };
        if !declared.contains(expected) {
            let actual = declared.iter().cloned().collect::<Vec<_>>().join(", ");
            return Err(format!(
                "typed link {role} {address} has type {actual}; expected {expected}"
            ));
        }
        Ok(())
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

    pub fn is_subset_of(&self, left: &str, right: &str) -> bool {
        self.members(left)
            .into_iter()
            .all(|element| self.has(right, element))
    }

    pub fn pair(&self, left: &str, right: &str) -> Result<Vec<String>, String> {
        require_reference(left, "pair left value")?;
        require_reference(right, "pair right value")?;
        Ok([left.to_string(), right.to_string()]
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect())
    }

    /// Flatten a finite set whose members are addresses of finite sets.
    pub fn union(&self, collection: &str) -> Vec<&str> {
        self.members(collection)
            .into_iter()
            .flat_map(|set| self.members(set))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    pub fn separation<F>(&self, set: &str, mut predicate: F) -> Vec<&str>
    where
        F: FnMut(&str) -> bool,
    {
        self.members(set)
            .into_iter()
            .filter(|element| predicate(element))
            .collect()
    }

    pub fn replacement<F>(&self, set: &str, mut mapping: F) -> Result<Vec<String>, String>
    where
        F: FnMut(&str) -> String,
    {
        self.members(set)
            .into_iter()
            .map(|element| {
                let image = mapping(element);
                require_reference(&image, "replacement output")?;
                Ok(image)
            })
            .collect::<Result<BTreeSet<_>, String>>()
            .map(|images| images.into_iter().collect())
    }
}

/// A finite directed graph constrained to a vertex set and represented by links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkGraph {
    address: String,
    vertex_type: String,
    vertex_memberships: MembershipSetStore,
    edges: TypedLinkNetwork,
    edge_addresses: BTreeSet<String>,
    next_vertex_membership: usize,
}

impl LinkGraph {
    pub fn new(address: &str) -> Result<Self, String> {
        require_reference(address, "graph address")?;
        Ok(Self {
            address: address.to_string(),
            vertex_type: format!("{address}.vertex"),
            vertex_memberships: MembershipSetStore::new(),
            edges: TypedLinkNetwork::new(),
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
        self.edges.declare(vertex, &self.vertex_type)?;
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
        let address = self.edges.define(
            address,
            source,
            target,
            &self.vertex_type,
            &self.vertex_type,
        )?;
        self.edge_addresses.insert(address.clone());
        Ok(address)
    }

    pub fn edge(&self, address: &str) -> Option<(&str, &str)> {
        self.edge_addresses
            .contains(address)
            .then(|| self.edges.doublet(address))
            .flatten()
    }

    pub fn edge_type(&self, address: &str) -> Option<&str> {
        self.edge_addresses
            .contains(address)
            .then(|| self.edges.type_of(address))
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
    links: TypedLinkNetwork,
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
            links: TypedLinkNetwork::new(),
            relation_pairs: BTreeMap::new(),
        };
        for (index, value) in relation.domain.iter().enumerate() {
            relation.type_memberships.define(
                &format!("{address}.domain.{index}"),
                value,
                &format!("{address}.domain"),
            )?;
            relation
                .links
                .declare(value, &format!("{address}.domain"))?;
        }
        for (index, value) in relation.codomain.iter().enumerate() {
            relation.type_memberships.define(
                &format!("{address}.codomain.{index}"),
                value,
                &format!("{address}.codomain"),
            )?;
            relation
                .links
                .declare(value, &format!("{address}.codomain"))?;
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
        let address = self.links.define(
            address,
            left,
            right,
            &format!("{}.domain", self.address),
            &format!("{}.codomain", self.address),
        )?;
        self.relation_pairs
            .insert(address.clone(), (left.to_string(), right.to_string()));
        Ok(address)
    }

    pub fn has(&self, left: &str, right: &str) -> bool {
        self.relation_pairs
            .values()
            .any(|(pair_left, pair_right)| pair_left == left && pair_right == right)
    }

    pub fn pair_type(&self, address: &str) -> Option<&str> {
        self.relation_pairs
            .contains_key(address)
            .then(|| self.links.type_of(address))
            .flatten()
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
