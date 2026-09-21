//! Theory-agnostic execution of formal systems represented as LiNo links.
//!
//! The machine implements only structural pattern matching, substitution,
//! ordered rewriting, and bounded rule saturation. Object-language semantics
//! live in linked forms and never dispatch through theory-specific Rust
//! callbacks.

use crate::{key_of, parse_lino, parse_one, tokenize_one, Node};
use std::collections::{BTreeMap, BTreeSet};

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
struct LinkedProgram {
    name: String,
    uses: Vec<String>,
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

#[derive(Debug, Clone, Default)]
pub struct LinkedProgramRegistry {
    programs: BTreeMap<String, LinkedProgram>,
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
    pub fn from_rml(source: &str) -> Result<Self, String> {
        let forms = parse_lino(source)
            .iter()
            .map(|link| parse_one(&tokenize_one(link)))
            .collect::<Result<Vec<_>, _>>()?;
        Self::from_forms(&forms)
    }

    pub fn from_forms(forms: &[Node]) -> Result<Self, String> {
        let mut registry = Self::default();
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
                format!("linked-program {name} only supports (uses program) clauses")
            })?;
            if values.len() != 2 || !matches!(&values[0], Node::Leaf(head) if head == "uses") {
                return Err(format!(
                    "linked-program {name} only supports (uses program) clauses"
                ));
            }
            let dependency = leaf(&values[1], "linked-program dependency")?.to_string();
            if uses.contains(&dependency) {
                return Err(format!(
                    "linked-program {name} repeats dependency {dependency}"
                ));
            }
            uses.push(dependency);
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
                if !self.programs.contains_key(dependency) {
                    return Err(format!(
                        "linked-program {} uses unknown program {dependency}",
                        program.name
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
                visit(dependency, programs, visiting, visited)?;
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

    fn effective_rewrites(&self, name: &str) -> Result<Vec<RewriteRule>, String> {
        let mut output = Vec::new();
        let mut seen = BTreeSet::new();
        self.collect_rewrites(name, &mut seen, &mut output)?;
        Ok(output)
    }

    fn collect_rewrites(
        &self,
        name: &str,
        seen: &mut BTreeSet<String>,
        output: &mut Vec<RewriteRule>,
    ) -> Result<(), String> {
        if !seen.insert(name.to_string()) {
            return Ok(());
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("execution references unknown linked-program {name}"))?;
        output.extend(program.rewrites.clone());
        for dependency in &program.uses {
            self.collect_rewrites(dependency, seen, output)?;
        }
        Ok(())
    }

    fn effective_facts(&self, name: &str) -> Result<Vec<LinkedFact>, String> {
        let mut output = Vec::new();
        let mut seen = BTreeSet::new();
        self.collect_facts(name, &mut seen, &mut output)?;
        Ok(output)
    }

    fn collect_facts(
        &self,
        name: &str,
        seen: &mut BTreeSet<String>,
        output: &mut Vec<LinkedFact>,
    ) -> Result<(), String> {
        if !seen.insert(name.to_string()) {
            return Ok(());
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("execution references unknown linked-program {name}"))?;
        output.extend(program.facts.clone());
        for dependency in &program.uses {
            self.collect_facts(dependency, seen, output)?;
        }
        Ok(())
    }

    fn effective_inferences(&self, name: &str) -> Result<Vec<InferenceRule>, String> {
        let mut output = Vec::new();
        let mut seen = BTreeSet::new();
        self.collect_inferences(name, &mut seen, &mut output)?;
        Ok(output)
    }

    fn collect_inferences(
        &self,
        name: &str,
        seen: &mut BTreeSet<String>,
        output: &mut Vec<InferenceRule>,
    ) -> Result<(), String> {
        if !seen.insert(name.to_string()) {
            return Ok(());
        }
        let program = self
            .programs
            .get(name)
            .ok_or_else(|| format!("execution references unknown linked-program {name}"))?;
        output.extend(program.inferences.clone());
        for dependency in &program.uses {
            self.collect_inferences(dependency, seen, output)?;
        }
        Ok(())
    }

    fn rewrite_once(
        term: &Node,
        rules: &[RewriteRule],
    ) -> Result<Option<(Node, RewriteRule)>, String> {
        for rule in rules {
            let mut substitution = BTreeMap::new();
            if match_term(&rule.pattern, term, &mut substitution) {
                return Ok(Some((
                    instantiate(&rule.replacement, &substitution)?,
                    rule.clone(),
                )));
            }
        }
        if let Node::List(children) = term {
            for (index, child) in children.iter().enumerate() {
                if let Some((rewritten, rule)) = Self::rewrite_once(child, rules)? {
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
        if max_steps == 0 {
            return Err("max_steps must be positive".to_string());
        }
        let rules = self.effective_rewrites(name)?;
        let mut term = input.clone();
        let mut trace = Vec::new();
        let mut seen = BTreeSet::from([key_of(&term)]);
        while trace.len() < max_steps {
            let Some((next, rule)) = Self::rewrite_once(&term, &rules)? else {
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
        if max_rounds == 0 || max_facts == 0 {
            return None;
        }
        let normalized_goal = self.reduce(name, goal, 10_000).ok()?.term;
        let goal_key = key_of(&normalized_goal);
        let mut known: BTreeMap<String, (Node, LinkedProof)> = BTreeMap::new();
        for fact in self.effective_facts(name).ok()? {
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
        }
        if let Some((_, proof)) = known.get(&goal_key) {
            return Some(proof.clone());
        }
        let rules = self.effective_inferences(name).ok()?;
        for _ in 0..max_rounds {
            let mut changed = false;
            for rule in &rules {
                let mut candidates = vec![(BTreeMap::new(), Vec::<LinkedProof>::new())];
                for premise in &rule.premises {
                    let mut next = Vec::new();
                    for (substitution, proofs) in candidates {
                        for (judgement, proof) in known.values() {
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
