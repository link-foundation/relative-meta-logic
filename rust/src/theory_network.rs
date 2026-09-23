//! Executable meta-theory network and addressed doublet sequences.
//!
//! The network reader deliberately round-trips its RML source through the
//! `meta-language` bridge before interpreting theory declarations. This keeps
//! arbitrary user theories on the same representation path as bundled ones.

use crate::linked_program::LinkedProgramRegistry;
use crate::meta_language_support::{
    parse_rml_to_meta_language, reconstruct_rml_from_meta_language,
};
use crate::{
    check_proof_object, parse_lino, parse_one, parse_proof_assumption_form,
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
    pub contract: String,
    pub program: String,
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
struct ImplementationContract {
    kind: String,
    obligations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
struct ConformanceCase {
    contract: String,
    obligation: String,
    program: String,
    input: Option<Node>,
    expected: Option<Node>,
    goal: Option<Node>,
    facts: Vec<Node>,
}

#[derive(Debug, Clone, PartialEq)]
struct ProofObligation {
    proof: String,
    judgement: Node,
}

#[derive(Debug, Clone)]
pub struct TheoryNetwork {
    meta_language_round_trip_ok: bool,
    trusted_foundation_round_trip_ok: bool,
    theories: BTreeMap<String, Theory>,
    definitions: Vec<TheoryDefinition>,
    terms: BTreeMap<(String, String), TheoryTerm>,
    implementations: BTreeMap<String, TheoryImplementation>,
    witnesses: BTreeMap<String, TheoryWitness>,
    verifications: BTreeMap<String, TheoryDefinitionVerification>,
    implementation_contracts: BTreeMap<String, ImplementationContract>,
    conformance_cases: BTreeMap<(String, String), ConformanceCase>,
    proof_obligations: BTreeMap<(String, String), ProofObligation>,
    linked_programs: LinkedProgramRegistry,
}

impl TheoryNetwork {
    pub fn from_rml(source: &str, trusted_foundation: &str) -> Result<Self, String> {
        let meta_language_network = parse_rml_to_meta_language(source);
        let reconstructed = reconstruct_rml_from_meta_language(&meta_language_network);
        let trusted_meta_language_network = parse_rml_to_meta_language(trusted_foundation);
        let trusted_reconstructed =
            reconstruct_rml_from_meta_language(&trusted_meta_language_network);
        let mut network = Self {
            meta_language_round_trip_ok: reconstructed == source,
            trusted_foundation_round_trip_ok: trusted_reconstructed == trusted_foundation,
            theories: BTreeMap::new(),
            definitions: Vec::new(),
            terms: BTreeMap::new(),
            implementations: BTreeMap::new(),
            witnesses: BTreeMap::new(),
            verifications: BTreeMap::new(),
            implementation_contracts: BTreeMap::new(),
            conformance_cases: BTreeMap::new(),
            proof_obligations: BTreeMap::new(),
            linked_programs: LinkedProgramRegistry::default(),
        };
        let mut proof_env = Env::new(None);
        let mut forms = Vec::new();

        for link in parse_lino(&trusted_reconstructed) {
            let form = parse_one(&tokenize_one(&link))
                .map_err(|error| format!("invalid trusted foundation link {link}: {error}"))?;
            let Some(head) = form_head(&form) else {
                continue;
            };
            let Node::List(children) = &form else {
                continue;
            };
            match head {
                "implementation-contract" => network.add_implementation_contract(children)?,
                "conformance-case" => network.add_conformance_case(children)?,
                "proof-obligation" => network.add_proof_obligation(children)?,
                "rule" if is_proof_rule_shape(&form) => {
                    proof_env.register_proof_rule(parse_rule_form(&form)?)
                }
                "axiom" | "assumption" => {
                    proof_env.register_proof_assumption(parse_proof_assumption_form(&form)?)
                }
                _ => return Err(format!("trusted foundation has unsupported form {head}")),
            }
        }
        network.validate_trusted_foundation()?;

        for link in parse_lino(&reconstructed) {
            let form = parse_one(&tokenize_one(&link))
                .map_err(|error| format!("invalid theory network link {link}: {error}"))?;
            let Node::List(children) = &form else {
                continue;
            };
            let Some(Node::Leaf(head)) = children.first() else {
                continue;
            };
            if matches!(
                head.as_str(),
                "implementation-contract"
                    | "conformance-case"
                    | "proof-obligation"
                    | "rule"
                    | "axiom"
                    | "assumption"
            ) {
                return Err(format!(
                    "candidate theory source cannot declare trusted {head} forms"
                ));
            }
            match head.as_str() {
                "theory" => network.add_theory(children)?,
                "term" => network.add_term(children)?,
                "implementation" => network.add_implementation(children)?,
                "witness" => network.add_witness(children)?,
                "definition" => network.add_definition(children)?,
                "proof-object" => proof_env.register_proof_object(parse_proof_object_form(&form)?),
                _ => {}
            }
            forms.push(form);
        }
        network.linked_programs = LinkedProgramRegistry::from_forms(&forms)?;
        network.validate(&proof_env)?;
        Ok(network)
    }

    fn add_implementation_contract(&mut self, form: &[Node]) -> Result<(), String> {
        if form.len() < 3 {
            return Err("implementation-contract must have a name and clauses".to_string());
        }
        let contract = leaf(&form[1], "implementation-contract name")?.to_string();
        if self.implementation_contracts.contains_key(&contract) {
            return Err(format!("duplicate implementation-contract {contract}"));
        }
        let (data, obligations) =
            implementation_clauses(&form[2..], &format!("implementation-contract {contract}"))?;
        for key in data.keys() {
            if key != "kind" {
                return Err(format!(
                    "implementation-contract {contract} has unsupported clause {key}"
                ));
            }
        }
        let kind = data
            .get("kind")
            .cloned()
            .ok_or_else(|| format!("implementation-contract {contract} is missing kind"))?;
        if obligations.is_empty() {
            return Err(format!(
                "implementation-contract {contract} is missing obligations"
            ));
        }
        self.implementation_contracts
            .insert(contract, ImplementationContract { kind, obligations });
        Ok(())
    }

    fn add_conformance_case(&mut self, form: &[Node]) -> Result<(), String> {
        if form.len() < 5 {
            return Err(
                "conformance-case must have a contract, obligation, and clauses".to_string(),
            );
        }
        let contract = leaf(&form[1], "conformance-case contract")?.to_string();
        let obligation = leaf(&form[2], "conformance-case obligation")?.to_string();
        let context = format!("conformance-case {contract}.{obligation}");
        let mut values = BTreeMap::new();
        let mut facts = Vec::new();
        for node in &form[3..] {
            let Node::List(clause) = node else {
                return Err(format!("{context} clauses must have the form (name value)"));
            };
            if clause.len() != 2 {
                return Err(format!("{context} clauses must have the form (name value)"));
            }
            let name = leaf(&clause[0], &format!("{context} clause name"))?;
            if name == "fact" {
                facts.push(clause[1].clone());
            } else {
                if !matches!(name, "program" | "input" | "expected" | "goal") {
                    return Err(format!("{context} has unsupported clause {name}"));
                }
                if values.insert(name.to_string(), clause[1].clone()).is_some() {
                    return Err(format!("{context} repeats clause {name}"));
                }
            }
        }
        let program = leaf(
            values
                .get("program")
                .ok_or_else(|| format!("{context} is missing program"))?,
            &format!("{context} program"),
        )?
        .to_string();
        let has_reduction = values.contains_key("input") || values.contains_key("expected");
        let has_proof = values.contains_key("goal") || !facts.is_empty();
        if has_reduction == has_proof {
            return Err(format!(
                "{context} must define exactly one reduction or proof case"
            ));
        }
        if has_reduction && (!values.contains_key("input") || !values.contains_key("expected")) {
            return Err(format!(
                "{context} reduction requires input and expected clauses"
            ));
        }
        if has_proof && !values.contains_key("goal") {
            return Err(format!("{context} proof requires a goal clause"));
        }
        let key = (contract.clone(), obligation.clone());
        if self.conformance_cases.contains_key(&key) {
            return Err(format!("duplicate {context}"));
        }
        self.conformance_cases.insert(
            key,
            ConformanceCase {
                contract,
                obligation,
                program,
                input: values.get("input").cloned(),
                expected: values.get("expected").cloned(),
                goal: values.get("goal").cloned(),
                facts,
            },
        );
        Ok(())
    }

    fn add_proof_obligation(&mut self, form: &[Node]) -> Result<(), String> {
        if form.len() < 3 {
            return Err("proof-obligation must have a contract and clauses".to_string());
        }
        let contract = leaf(&form[1], "proof-obligation contract")?.to_string();
        let mut data = BTreeMap::new();
        for node in &form[2..] {
            let Node::List(clause) = node else {
                return Err(format!(
                    "proof-obligation {contract} clauses must have the form (name value)"
                ));
            };
            if clause.len() != 2 {
                return Err(format!(
                    "proof-obligation {contract} clauses must have the form (name value)"
                ));
            }
            let name = leaf(
                &clause[0],
                &format!("proof-obligation {contract} clause name"),
            )?;
            if !matches!(name, "obligation" | "proof" | "judgement") {
                return Err(format!(
                    "proof-obligation {contract} has unsupported clause {name}"
                ));
            }
            if data.insert(name.to_string(), clause[1].clone()).is_some() {
                return Err(format!("proof-obligation {contract} repeats clause {name}"));
            }
        }
        let obligation = leaf(
            data.get("obligation")
                .ok_or_else(|| format!("proof-obligation {contract} is missing obligation"))?,
            &format!("proof-obligation {contract} name"),
        )?
        .to_string();
        let proof = leaf(
            data.get("proof")
                .ok_or_else(|| format!("proof-obligation {contract} is missing proof"))?,
            &format!("proof-obligation {contract} proof"),
        )?
        .to_string();
        let judgement = data
            .get("judgement")
            .ok_or_else(|| format!("proof-obligation {contract} is missing judgement"))?;
        if !matches!(judgement, Node::List(_)) {
            return Err(format!(
                "proof-obligation {contract}.{obligation} judgement must be a link"
            ));
        }
        let key = (contract.clone(), obligation.clone());
        if self.proof_obligations.contains_key(&key) {
            return Err(format!(
                "duplicate proof-obligation {contract}.{obligation}"
            ));
        }
        self.proof_obligations.insert(
            key,
            ProofObligation {
                proof,
                judgement: judgement.clone(),
            },
        );
        Ok(())
    }

    fn validate_trusted_foundation(&self) -> Result<(), String> {
        if self.implementation_contracts.is_empty() {
            return Err(
                "trusted foundation does not declare any implementation contracts".to_string(),
            );
        }
        for (contract_name, contract) in &self.implementation_contracts {
            for obligation in &contract.obligations {
                if !self
                    .conformance_cases
                    .contains_key(&(contract_name.clone(), obligation.clone()))
                {
                    return Err(format!(
                        "implementation-contract {contract_name} has no conformance-case for {obligation}"
                    ));
                }
            }
        }
        for ((contract_name, obligation), _) in &self.conformance_cases {
            let Some(contract) = self.implementation_contracts.get(contract_name) else {
                return Err(format!(
                    "conformance-case {contract_name}.{obligation} is not in its contract"
                ));
            };
            if !contract.obligations.contains(obligation) {
                return Err(format!(
                    "conformance-case {contract_name}.{obligation} is not in its contract"
                ));
            }
        }
        for ((contract_name, obligation), _) in &self.proof_obligations {
            let contract = self
                .implementation_contracts
                .get(contract_name)
                .ok_or_else(|| {
                    format!("proof-obligation {contract_name}.{obligation} has unknown contract")
                })?;
            if !contract.obligations.contains(obligation) {
                return Err(format!(
                    "proof-obligation {contract_name}.{obligation} is not in its contract"
                ));
            }
        }
        Ok(())
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
            if !matches!(
                key.as_str(),
                "contract" | "program" | "kind" | "subject" | "using"
            ) {
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
        let contract = field("contract")?;
        let program = field("program")?;
        let kind = field("kind")?;
        let subject = field("subject")?;
        let using = field("using")?;
        self.implementations.insert(
            name.clone(),
            TheoryImplementation {
                name,
                contract,
                program,
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

    fn validate(&mut self, proof_env: &Env) -> Result<(), String> {
        if !self.meta_language_round_trip_ok {
            return Err("candidate theory source failed its meta-language round trip".to_string());
        }
        if !self.trusted_foundation_round_trip_ok {
            return Err("trusted foundation failed its meta-language round trip".to_string());
        }
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
            let obligations =
                self.verify_implementation(&definition, &witness, &implementation, proof_env)?;
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
        proof_env: &Env,
    ) -> Result<Vec<String>, String> {
        let Some(contract) = self.implementation_contracts.get(&implementation.contract) else {
            return Err(format!(
                "implementation {} uses unknown contract {}",
                implementation.name, implementation.contract
            ));
        };

        for ((contract_name, obligation_name), obligation) in &self.proof_obligations {
            if contract_name != &implementation.contract {
                continue;
            }
            if !matches!(
                check_proof_object(proof_env, &obligation.proof),
                CheckProofVerdict::Ok(_)
            ) || proof_env
                .get_proof_object(&obligation.proof)
                .is_none_or(|proof| proof.conclusion != obligation.judgement)
            {
                return Err(format!(
                    "proof-obligation {contract_name}.{obligation_name} failed proof replay"
                ));
            }
        }

        if implementation.kind != contract.kind {
            return Err(format!(
                "implementation {} contract {} requires kind {}, not {}",
                implementation.name, implementation.contract, contract.kind, implementation.kind
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
        let expected_obligations: BTreeSet<_> = contract.obligations.iter().cloned().collect();
        if declared_obligations != expected_obligations {
            return Err(format!(
                "implementation {} obligations do not match contract {}",
                implementation.name, implementation.contract
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

        if !self.linked_programs.has(&implementation.program) {
            return Err(format!(
                "implementation {} uses unknown linked-program {}",
                implementation.name, implementation.program
            ));
        }
        for obligation in &contract.obligations {
            let test_case = self
                .conformance_cases
                .get(&(implementation.contract.clone(), obligation.clone()))
                .expect("trusted foundation validation resolves every conformance case");
            if test_case.program != implementation.program {
                return Err(format!(
                    "implementation {} program {} does not match {}.{} program {}",
                    implementation.name,
                    implementation.program,
                    implementation.contract,
                    obligation,
                    test_case.program
                ));
            }
            if let Some(input) = &test_case.input {
                let result = self
                    .linked_programs
                    .reduce(&test_case.program, input, 10_000)?;
                if Some(&result.term) != test_case.expected.as_ref() {
                    return Err(format!(
                        "implementation {} failed reduction conformance {}.{}",
                        implementation.name, implementation.contract, obligation
                    ));
                }
            } else {
                let goal = test_case
                    .goal
                    .as_ref()
                    .expect("proof conformance cases have goals");
                if self
                    .linked_programs
                    .prove(&test_case.program, goal, &test_case.facts, 128, 10_000)
                    .is_none()
                {
                    return Err(format!(
                        "implementation {} failed proof conformance {}.{}",
                        implementation.name, implementation.contract, obligation
                    ));
                }
            }
        }
        Ok(contract.obligations.clone())
    }

    pub fn meta_language_round_trip_ok(&self) -> bool {
        self.meta_language_round_trip_ok
    }

    pub fn trusted_foundation_round_trip_ok(&self) -> bool {
        self.trusted_foundation_round_trip_ok
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

fn form_head(form: &Node) -> Option<&str> {
    match form {
        Node::List(children) => match children.first() {
            Some(Node::Leaf(head)) => Some(head),
            _ => None,
        },
        _ => None,
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

    fn snapshot(&self) -> Vec<(String, String, String)> {
        self.links
            .iter()
            .map(|(address, link)| (address.clone(), link.source.clone(), link.target.clone()))
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypedLinkNetworkSnapshot {
    pub links: Vec<(String, String, String)>,
    pub type_facts: Vec<(String, String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkClosureReport {
    pub closed: bool,
    pub missing_references: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkCliPinnedTypeMapping {
    pub rml_address: String,
    pub mapped_rml_shape: Option<(u32, u32, u32)>,
    pub link_cli_shape: (u32, u32, u32),
    pub exact_shape: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkCliTypeInteropProfile {
    pub revision: &'static str,
    pub pinned_types: Vec<LinkCliPinnedTypeMapping>,
    pub unicode_type_fact_orientation_compatible: bool,
    pub unicode_canonical_definition_orientation_compatible: bool,
    pub names_require_numeric_identity: bool,
}

/// A link network whose references and ordered-pair endpoints are type checked.
#[derive(Debug, Clone, Default)]
pub struct TypedLinkNetwork {
    links: LinkNetwork,
    type_fact_links: LinkNetwork,
    type_index: Option<BTreeMap<String, BTreeSet<String>>>,
}

impl PartialEq for TypedLinkNetwork {
    fn eq(&self, other: &Self) -> bool {
        self.links == other.links && self.type_fact_links == other.type_fact_links
    }
}

impl Eq for TypedLinkNetwork {}

impl TypedLinkNetwork {
    pub fn new() -> Self {
        Self {
            links: LinkNetwork::new(),
            type_fact_links: LinkNetwork::new(),
            type_index: Some(BTreeMap::new()),
        }
    }

    /// Construct the selectable recursively linked default ontology.
    ///
    /// A canonical link's address is also its target. Its source is the
    /// classifier: Type classifies itself and SubType; SubType classifies Value.
    pub fn with_default_ontology() -> Self {
        let mut network = Self::new();
        network
            .links
            .define("Type", "Type", "Type")
            .expect("default Type link is valid");
        network
            .links
            .define("SubType", "Type", "SubType")
            .expect("default SubType link is valid");
        network
            .links
            .define("Value", "SubType", "Value")
            .expect("default Value link is valid");
        network
            .declare("Type", "Type")
            .expect("default Type fact is valid");
        network
            .declare("SubType", "Type")
            .expect("default SubType fact is valid");
        network
            .declare("Value", "SubType")
            .expect("default Value fact is valid");
        network
    }

    pub fn declare(&mut self, address: &str, r#type: &str) -> Result<String, String> {
        require_reference(address, "typed reference address")?;
        require_reference(r#type, "typed reference type")?;
        if self.types_of(address).contains(&r#type) {
            return Ok(address.to_string());
        }

        let mut fact_index = 0;
        let fact_address = loop {
            let candidate = format!("rml.type-fact.{fact_index}");
            if self.type_fact_links.doublet(&candidate).is_none() {
                break candidate;
            }
            fact_index += 1;
        };
        self.type_fact_links
            .define(&fact_address, address, r#type)?;
        if let Some(index) = &mut self.type_index {
            index
                .entry(address.to_string())
                .or_default()
                .insert(r#type.to_string());
        }
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
        self.declare(&address, &format!("(Pair {source_type} {target_type})"))?;
        Ok(address)
    }

    pub fn doublet(&self, address: &str) -> Option<(&str, &str)> {
        self.links.doublet(address)
    }

    pub fn type_of(&self, address: &str) -> Option<&str> {
        let declared = self.types_of(address);
        (declared.len() == 1).then_some(declared[0])
    }

    pub fn types_of(&self, address: &str) -> Vec<&str> {
        if let Some(index) = &self.type_index {
            return index
                .get(address)
                .into_iter()
                .flat_map(|declared| declared.iter().map(String::as_str))
                .collect();
        }
        self.type_fact_links
            .links
            .values()
            .filter_map(|fact| (fact.source == address).then_some(fact.target.as_str()))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// The authoritative type relation, represented as addressed doublets.
    pub fn type_facts(&self) -> Vec<(&str, &str, &str)> {
        self.type_fact_links
            .links
            .iter()
            .map(|(address, fact)| (address.as_str(), fact.source.as_str(), fact.target.as_str()))
            .collect()
    }

    /// Discard the derived host index; subsequent queries read linked facts.
    pub fn clear_type_index(&mut self) {
        self.type_index = None;
    }

    /// Rebuild the optional acceleration index solely from linked facts.
    pub fn rebuild_type_index(&mut self) {
        let mut rebuilt = BTreeMap::<String, BTreeSet<String>>::new();
        for fact in self.type_fact_links.links.values() {
            rebuilt
                .entry(fact.source.clone())
                .or_default()
                .insert(fact.target.clone());
        }
        self.type_index = Some(rebuilt);
    }

    /// Return the semantic network state without its disposable cache.
    pub fn snapshot(&self) -> TypedLinkNetworkSnapshot {
        TypedLinkNetworkSnapshot {
            links: self.links.snapshot(),
            type_facts: self.type_fact_links.snapshot(),
        }
    }

    /// Check whether every endpoint and every type fact resolves to a link.
    pub fn validate_closure(&self) -> LinkClosureReport {
        let mut missing = BTreeSet::new();
        let mut require_defined = |reference: &str| {
            if self.links.doublet(reference).is_none() {
                missing.insert(reference.to_string());
            }
        };
        for link in self.links.links.values() {
            require_defined(&link.source);
            require_defined(&link.target);
        }
        for fact in self.type_fact_links.links.values() {
            require_defined(&fact.source);
            require_defined(&fact.target);
        }
        let missing_references = missing.into_iter().collect::<Vec<_>>();
        LinkClosureReport {
            closed: missing_references.is_empty(),
            missing_references,
        }
    }

    /// Compare this ontology with link-cli's pinned construction without
    /// assuming that symbolic names and reserved numeric identities coincide.
    pub fn link_cli_interop_profile(&self) -> LinkCliTypeInteropProfile {
        let ordered_addresses = [("Type", 1), ("SubType", 2), ("Value", 3)];
        let numeric_addresses = BTreeMap::from(ordered_addresses);
        let pinned_types = ordered_addresses
            .iter()
            .map(|(rml_address, address)| {
                let mapped_rml_shape = self.doublet(rml_address).and_then(|(source, target)| {
                    Some((
                        *address,
                        *numeric_addresses.get(source)?,
                        *numeric_addresses.get(target)?,
                    ))
                });
                let link_cli_shape = (*address, 1, *address);
                LinkCliPinnedTypeMapping {
                    rml_address: (*rml_address).to_string(),
                    mapped_rml_shape,
                    link_cli_shape,
                    exact_shape: mapped_rml_shape == Some(link_cli_shape),
                }
            })
            .collect();
        LinkCliTypeInteropProfile {
            revision: "e801cb877f8ed90a103ee253add6f702da89ee40",
            pinned_types,
            unicode_type_fact_orientation_compatible: true,
            unicode_canonical_definition_orientation_compatible: false,
            names_require_numeric_identity: false,
        }
    }

    fn require_type(&self, address: &str, expected: &str, role: &str) -> Result<(), String> {
        let declared = self.types_of(address);
        if declared.is_empty() {
            return Err(format!("typed link {role} {address} has no declared type"));
        }
        if !declared.contains(&expected) {
            let actual = declared.join(", ");
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
