//! Direct source execution control for the existing lambda-link semantics.
//!
//! All five machine transitions are externally declared. This removes bracket
//! abstraction from this execution path, not the host binding/environment laws,
//! source elaborator, codec, runtime/compiler, or processor trust boundary.
//! It is not a second genuinely different minimal foundation.

use crate::linked_program::{
    InferenceRule, LinkedFact, LinkedProgram, LinkedProof, ProgramImport, RewriteRule,
};
use crate::{parse_lino, parse_one, tokenize_one, Node};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, OnceLock};

pub const SOURCE: &str = include_str!("../../lib/meta-theory/fixed-point-source.lino");
pub const DEFAULT_MAX_TRANSITIONS: usize = 100_000_000;
const CONTRACTION_LIMIT_PREFIX: &str = "lambda transition limit ";
pub const MACHINE_OPERATIONS: &[&str] = &[
    "lambda-push-argument",
    "lambda-bind-argument",
    "lambda-resolve-variable",
    "lambda-enter-closure",
    "lambda-reify-head",
];
pub const EXTERNAL_SEMANTIC_SERVICES: &[&str] = &[
    "call-by-name left-head application order and argument closure capture",
    "lexical lambda binding by persistent environment extension",
    "nearest-binding variable-name equality and environment lookup",
    "restoration of captured lexical environments",
    "weak-head result reification and neutral marker application",
];
pub const EXTERNAL_BOUNDARY_SERVICES: &[&str] = &[
    "LiNo parsing, addressed DAG resolution, closed-root validation and source limits",
    "program validation and pattern-variable elaboration (leading question mark)",
    "Scott/UTF-8 input encoding and checked output/proof decoding",
    "host public-call orchestration, stopping policy and resource limits",
    "host memory allocation, Rust runtime/compiler and physical processor",
];
const REQUIRED_ROOTS: &[&str] = &[
    "TRUE",
    "FALSE",
    "NIL",
    "CONS",
    "ATOM",
    "LIST",
    "PATTERN_VARIABLE",
    "PATTERN_ATOM",
    "PATTERN_LIST",
    "NAMED_RULE",
    "FACT",
    "INFERENCE",
    "REBINDING",
    "PROGRAM_IMPORT",
    "PROGRAM",
    "PROOF",
    "KNOWN",
    "APPEND",
    "RESOLVE_REWRITES",
    "RESOLVE_FACTS",
    "RESOLVE_INFERENCES",
    "REWRITE_ONCE",
    "ADD_FACTS",
    "INFER_ONCE",
    "FIND_KNOWN_PROOF",
];

#[derive(Clone, Copy)]
pub struct KernelOptions<'a> {
    pub disabled: &'a BTreeSet<String>,
    pub max_transitions: usize,
    pub kernel: Option<&'a Kernel>,
}
impl KernelOptions<'_> {
    fn kernel(&self) -> Result<&Kernel, String> {
        match self.kernel {
            Some(kernel) => Ok(kernel),
            None => Kernel::shared(),
        }
    }
}

#[derive(Debug)]
enum Term {
    Variable(String),
    Lambda(String, LinkedTerm),
    Closure(LinkedTerm, Environment),
    Atom(String),
    App(LinkedTerm, LinkedTerm),
}
type LinkedTerm = Arc<Term>;
type Environment = Option<Arc<Binding>>;
#[derive(Debug)]
struct Binding {
    name: String,
    value: LinkedTerm,
    parent: Environment,
}
fn atom(value: impl Into<String>) -> LinkedTerm {
    Arc::new(Term::Atom(value.into()))
}
fn app(left: LinkedTerm, right: LinkedTerm) -> LinkedTerm {
    Arc::new(Term::App(left, right))
}
fn apply_many(head: LinkedTerm, arguments: impl IntoIterator<Item = LinkedTerm>) -> LinkedTerm {
    arguments.into_iter().fold(head, app)
}
fn leaf(node: &Node) -> Result<&str, String> {
    match node {
        Node::Leaf(value) => Ok(value),
        _ => Err("expected lambda source reference".to_string()),
    }
}
fn list(node: &Node) -> Result<&[Node], String> {
    match node {
        Node::List(values) => Ok(values),
        _ => Err("expected lambda source form".to_string()),
    }
}
#[derive(Debug)]
pub struct Kernel {
    roots: BTreeMap<String, LinkedTerm>,
    pub node_count: usize,
    pub root_count: usize,
}

impl Kernel {
    pub fn from_source(source: &str) -> Result<Self, String> {
        if source.len() > 16 * 1024 * 1024 {
            return Err("lambda source must be text of at most 16 MiB".to_string());
        }
        let flattened = source
            .lines()
            .map(|line| line.trim_start_matches([' ', '\t']))
            .collect::<Vec<_>>()
            .join("\n");
        let forms = parse_lino(&flattened)
            .map_err(|error| error.to_string())?
            .iter()
            .map(|form| parse_one(&tokenize_one(form)))
            .collect::<Result<Vec<_>, _>>()?;
        let mut declaration = None;
        let mut descriptors = BTreeMap::new();
        let mut root_forms = Vec::new();
        for form in &forms {
            let items = list(form)?;
            let kind = items.first().ok_or("empty lambda source form")?;
            match leaf(kind)? {
                "bootstrap-source" => {
                    if declaration.replace(items).is_some() {
                        return Err("duplicate lambda source declaration".to_string());
                    }
                }
                "bootstrap-source-node" if items.len() == 3 => {
                    let id = leaf(&items[1])?.to_string();
                    let descriptor = list(&items[2])?
                        .iter()
                        .map(|value| leaf(value).map(str::to_string))
                        .collect::<Result<Vec<_>, _>>()?;
                    if descriptors.insert(id, descriptor).is_some() {
                        return Err("duplicate lambda source node".to_string());
                    }
                }
                "bootstrap-source-root" if items.len() == 3 => {
                    root_forms.push((leaf(&items[1])?.to_string(), leaf(&items[2])?.to_string()))
                }
                _ => return Err("unknown lambda source form".to_string()),
            }
        }
        let declaration = declaration.ok_or("missing lambda source declaration")?;
        if declaration.len() < 2 || leaf(&declaration[1])? != "rml.bootstrap.fixed-point" {
            return Err("invalid lambda source declaration".to_string());
        }
        let clause = |name: &str| -> Result<&str, String> {
            let matching = declaration[2..]
                .iter()
                .filter_map(|value| match value {
                    Node::List(items)
                        if items.first().and_then(|item| leaf(item).ok()) == Some(name) =>
                    {
                        Some(items)
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            if matching.len() != 1 || matching[0].len() != 2 {
                return Err(format!("invalid lambda source {name}"));
            }
            leaf(&matching[0][1])
        };
        if clause("schema")? != "rml-lambda-link-dag-v1"
            || clause("representation")? != "addressed-doublet-network"
            || clause("upstream-model")? != "network-duplet-function"
        {
            return Err("invalid lambda source metadata".to_string());
        }
        let node_count = clause("node-count")?
            .parse::<usize>()
            .map_err(|_| "invalid lambda node count")?;
        let root_count = clause("root-count")?
            .parse::<usize>()
            .map_err(|_| "invalid lambda root count")?;
        if node_count == 0 || root_count == 0 || node_count > 100_000 || root_count > 256 {
            return Err("lambda source counts exceed resource bounds".to_string());
        }
        if descriptors.len() != node_count || root_forms.len() != root_count {
            return Err("lambda source counts do not match".to_string());
        }
        type WithFree = (LinkedTerm, BTreeSet<String>);
        fn materialize(
            reference: &str,
            descriptors: &BTreeMap<String, Vec<String>>,
            roots: &BTreeMap<String, LinkedTerm>,
            nodes: &mut BTreeMap<String, WithFree>,
            visiting: &mut BTreeSet<String>,
        ) -> Result<WithFree, String> {
            if let Some(name) = reference.strip_prefix('r') {
                return roots
                    .get(name)
                    .cloned()
                    .map(|term| (term, BTreeSet::new()))
                    .ok_or_else(|| format!("unknown earlier lambda root {reference}"));
            }
            if let Some(term) = nodes.get(reference) {
                return Ok(term.clone());
            }
            if !visiting.insert(reference.to_string()) {
                return Err("cyclic lambda source node".to_string());
            }
            if visiting.len() > 512 {
                return Err("lambda source DAG depth exceeds resource bounds".to_string());
            }
            let descriptor = descriptors
                .get(reference)
                .ok_or_else(|| format!("unknown lambda source node {reference}"))?;
            let value = match descriptor.as_slice() {
                [kind, name] if kind == "variable" => (
                    Arc::new(Term::Variable(name.clone())),
                    BTreeSet::from([name.clone()]),
                ),
                [kind, name, body] if kind == "lambda" => {
                    let (body, mut free) = materialize(body, descriptors, roots, nodes, visiting)?;
                    free.remove(name);
                    (Arc::new(Term::Lambda(name.clone(), body)), free)
                }
                [kind, left, right] if kind == "application" => {
                    let (left, mut free) = materialize(left, descriptors, roots, nodes, visiting)?;
                    let (right, right_free) =
                        materialize(right, descriptors, roots, nodes, visiting)?;
                    free.extend(right_free);
                    (app(left, right), free)
                }
                _ => return Err("invalid lambda source expression".to_string()),
            };
            visiting.remove(reference);
            nodes.insert(reference.to_string(), value.clone());
            Ok(value)
        }
        let mut roots = BTreeMap::new();
        let mut nodes = BTreeMap::new();
        for (name, reference) in root_forms {
            if roots.contains_key(&name) {
                return Err("duplicate lambda source root".to_string());
            }
            let (term, free) = materialize(
                &reference,
                &descriptors,
                &roots,
                &mut nodes,
                &mut BTreeSet::new(),
            )?;
            if !free.is_empty() {
                return Err(format!("unbound lambda source root {name}"));
            }
            roots.insert(name, term);
        }
        for reference in descriptors.keys() {
            materialize(
                reference,
                &descriptors,
                &roots,
                &mut nodes,
                &mut BTreeSet::new(),
            )?;
        }
        for name in REQUIRED_ROOTS {
            if !roots.contains_key(*name) {
                return Err(format!("missing lambda source root {name}"));
            }
        }
        Ok(Self {
            roots,
            node_count,
            root_count,
        })
    }
    pub fn shared() -> Result<&'static Self, String> {
        static SHARED: OnceLock<Result<Kernel, String>> = OnceLock::new();
        SHARED
            .get_or_init(|| Self::from_source(SOURCE))
            .as_ref()
            .map_err(Clone::clone)
    }

    fn root(&self, name: &str) -> LinkedTerm {
        self.roots[name].clone()
    }

    fn encode_bits(&self, value: &str) -> LinkedTerm {
        let values = value.as_bytes().iter().flat_map(|byte| {
            (0..8).map(move |bit| {
                self.root(if byte & (128 >> bit) == 0 {
                    "FALSE"
                } else {
                    "TRUE"
                })
            })
        });
        self.encode_list(values.collect())
    }

    fn encode_list(&self, values: Vec<LinkedTerm>) -> LinkedTerm {
        values
            .into_iter()
            .rev()
            .fold(self.root("NIL"), |tail, value| {
                apply_many(self.root("CONS"), [value, tail])
            })
    }

    fn encode_node(&self, node: &Node) -> LinkedTerm {
        match node {
            Node::Leaf(value) => app(self.root("ATOM"), self.encode_bits(value)),
            Node::List(children) => app(
                self.root("LIST"),
                self.encode_list(
                    children
                        .iter()
                        .map(|child| self.encode_node(child))
                        .collect(),
                ),
            ),
        }
    }

    fn encode_pattern(&self, node: &Node) -> LinkedTerm {
        match node {
            Node::Leaf(value) if value.starts_with('?') && value.len() > 1 => {
                app(self.root("PATTERN_VARIABLE"), self.encode_bits(&value[1..]))
            }
            Node::Leaf(value) => app(self.root("PATTERN_ATOM"), self.encode_bits(value)),
            Node::List(children) => app(
                self.root("PATTERN_LIST"),
                self.encode_list(
                    children
                        .iter()
                        .map(|child| self.encode_pattern(child))
                        .collect(),
                ),
            ),
        }
    }

    fn encode_rules(&self, rules: &[RewriteRule]) -> LinkedTerm {
        self.encode_list(
            rules
                .iter()
                .map(|rule| {
                    apply_many(
                        self.root("NAMED_RULE"),
                        [
                            self.encode_bits(&format!("{}\0{}", rule.program, rule.name)),
                            self.encode_pattern(&rule.pattern),
                            self.encode_pattern(&rule.replacement),
                        ],
                    )
                })
                .collect(),
        )
    }

    fn encode_facts(&self, facts: &[LinkedFact]) -> LinkedTerm {
        self.encode_list(
            facts
                .iter()
                .map(|fact| {
                    apply_many(
                        self.root("FACT"),
                        [
                            self.encode_bits(&format!("{}\0{}", fact.program, fact.name)),
                            self.encode_node(&fact.judgement),
                        ],
                    )
                })
                .collect(),
        )
    }

    fn encode_inferences(&self, inferences: &[InferenceRule]) -> LinkedTerm {
        self.encode_list(
            inferences
                .iter()
                .map(|rule| {
                    apply_many(
                        self.root("INFERENCE"),
                        [
                            self.encode_bits(&format!("{}\0{}", rule.program, rule.name)),
                            self.encode_list(
                                rule.premises
                                    .iter()
                                    .map(|premise| self.encode_pattern(premise))
                                    .collect(),
                            ),
                            self.encode_pattern(&rule.conclusion),
                        ],
                    )
                })
                .collect(),
        )
    }

    fn encode_rebindings(&self, rebindings: &BTreeMap<String, String>) -> LinkedTerm {
        self.encode_list(
            rebindings
                .iter()
                .map(|(from, to)| {
                    apply_many(
                        self.root("REBINDING"),
                        [self.encode_bits(from), self.encode_bits(to)],
                    )
                })
                .collect(),
        )
    }

    fn encode_imports(&self, imports: &[ProgramImport]) -> LinkedTerm {
        self.encode_list(
            imports
                .iter()
                .map(|dependency| {
                    apply_many(
                        self.root("PROGRAM_IMPORT"),
                        [
                            self.encode_bits(&dependency.program),
                            self.encode_rebindings(&dependency.rebindings),
                        ],
                    )
                })
                .collect(),
        )
    }

    fn encode_program(&self, program: &LinkedProgram) -> LinkedTerm {
        apply_many(
            self.root("PROGRAM"),
            [
                self.encode_bits(&program.name),
                self.encode_rules(&program.rewrites),
                self.encode_facts(&program.facts),
                self.encode_inferences(&program.inferences),
                self.encode_imports(&program.uses),
            ],
        )
    }

    fn encode_programs(&self, programs: &BTreeMap<String, LinkedProgram>) -> LinkedTerm {
        self.encode_list(
            programs
                .values()
                .map(|program| self.encode_program(program))
                .collect(),
        )
    }

    fn resolve(
        &self,
        operation: &str,
        programs: &BTreeMap<String, LinkedProgram>,
        name: &str,
        runner: &mut Runner,
    ) -> Result<LinkedTerm, String> {
        let output = apply_many(
            self.root(operation),
            [
                self.encode_programs(programs),
                self.encode_bits(name),
                self.root("NIL"),
            ],
        );
        let observed = runner.head_normalize(apply_many(
            output,
            [atom("decoded-none"), atom("decoded-some")],
        ))?;
        if is_atom(&observed, "decoded-none") {
            return Err(format!(
                "lambda import resolver cannot find linked-program {name}"
            ));
        }
        let (_, arguments) = unfold(&observed);
        if !is_atom_head(&observed, "decoded-some") || arguments.len() != 1 {
            return Err("lambda import resolver returned an invalid result".to_string());
        }
        let items = runner.materialize_list(arguments[0].clone())?;
        Ok(self.encode_list(items))
    }
}
pub struct Runner {
    disabled: BTreeSet<String>,
    pub observed: BTreeSet<&'static str>,
    transitions: usize,
    max_transitions: usize,
}

impl Runner {
    pub fn new(options: KernelOptions<'_>) -> Self {
        Self {
            disabled: options.disabled.clone(),
            observed: BTreeSet::new(),
            transitions: 0,
            max_transitions: options.max_transitions,
        }
    }

    fn observe(&mut self, operation: &'static str) -> Result<(), String> {
        if self.disabled.contains(operation) {
            return Err(format!("disabled host semantic operation {operation}"));
        }
        self.observed.insert(operation);
        self.transitions += 1;
        if self.transitions > self.max_transitions {
            return Err(format!(
                "{CONTRACTION_LIMIT_PREFIX}{} exceeded",
                self.max_transitions
            ));
        }
        Ok(())
    }

    fn head_normalize(&mut self, term: LinkedTerm) -> Result<LinkedTerm, String> {
        let mut current = term;
        let mut environment: Environment = None;
        let mut arguments = Vec::new();
        loop {
            match current.as_ref() {
                Term::Closure(expression, captured) => {
                    self.observe("lambda-enter-closure")?;
                    environment = captured.clone();
                    current = expression.clone();
                }
                Term::App(left, right) => {
                    self.observe("lambda-push-argument")?;
                    arguments.push(Arc::new(Term::Closure(right.clone(), environment.clone())));
                    current = left.clone();
                }
                Term::Variable(name) => {
                    self.observe("lambda-resolve-variable")?;
                    let mut binding = environment.clone();
                    loop {
                        let found =
                            binding.ok_or_else(|| format!("unbound lambda variable {name}"))?;
                        if found.name == *name {
                            current = found.value.clone();
                            break;
                        }
                        binding = found.parent.clone();
                    }
                }
                Term::Lambda(name, body) if !arguments.is_empty() => {
                    self.observe("lambda-bind-argument")?;
                    environment = Some(Arc::new(Binding {
                        name: name.clone(),
                        value: arguments.pop().unwrap(),
                        parent: environment,
                    }));
                    current = body.clone();
                }
                _ => {
                    self.observe("lambda-reify-head")?;
                    if matches!(current.as_ref(), Term::Lambda(_, _)) {
                        current = Arc::new(Term::Closure(current, environment));
                    }
                    while let Some(argument) = arguments.pop() {
                        current = app(current, argument);
                    }
                    return Ok(current);
                }
            }
        }
    }

    fn materialize_list(&mut self, term: LinkedTerm) -> Result<Vec<LinkedTerm>, String> {
        let mut output = Vec::new();
        let mut current = term;
        loop {
            let observed = self.head_normalize(apply_many(
                current,
                [atom("decoded-nil"), atom("decoded-cons")],
            ))?;
            if is_atom(&observed, "decoded-nil") {
                return Ok(output);
            }
            let (_, arguments) = unfold(&observed);
            if !is_atom_head(&observed, "decoded-cons") || arguments.len() != 2 {
                return Err("lambda output is not a list".to_string());
            }
            output.push(arguments[0].clone());
            current = arguments[1].clone();
        }
    }

    fn decode_boolean(&mut self, term: LinkedTerm) -> Result<bool, String> {
        let observed = self.head_normalize(apply_many(
            term,
            [atom("decoded-true"), atom("decoded-false")],
        ))?;
        if is_atom(&observed, "decoded-true") {
            Ok(true)
        } else if is_atom(&observed, "decoded-false") {
            Ok(false)
        } else {
            Err("lambda output is not a boolean".to_string())
        }
    }

    fn decode_bits(&mut self, term: LinkedTerm) -> Result<String, String> {
        let bits = self.materialize_list(term)?;
        if bits.len() % 8 != 0 {
            return Err("lambda atom is not byte-aligned".to_string());
        }
        let mut bytes = vec![0u8; bits.len() / 8];
        for (index, bit) in bits.into_iter().enumerate() {
            if self.decode_boolean(bit)? {
                bytes[index / 8] |= 128 >> (index % 8);
            }
        }
        String::from_utf8(bytes).map_err(|error| error.to_string())
    }

    fn decode_node(&mut self, term: LinkedTerm) -> Result<Node, String> {
        let observed = self.head_normalize(apply_many(
            term,
            [atom("decoded-atom"), atom("decoded-list")],
        ))?;
        let (_, arguments) = unfold(&observed);
        if arguments.len() != 1 {
            return Err("lambda output is not a node".to_string());
        }
        if is_atom_head(&observed, "decoded-atom") {
            return Ok(Node::Leaf(self.decode_bits(arguments[0].clone())?));
        }
        if is_atom_head(&observed, "decoded-list") {
            return self
                .materialize_list(arguments[0].clone())?
                .into_iter()
                .map(|child| self.decode_node(child))
                .collect::<Result<Vec<_>, _>>()
                .map(Node::List);
        }
        Err("lambda output has an unknown node constructor".to_string())
    }

    fn decode_proof(&mut self, term: LinkedTerm) -> Result<LinkedProof, String> {
        let observed = self.head_normalize(app(term, atom("decoded-proof")))?;
        let (_, arguments) = unfold(&observed);
        if !is_atom_head(&observed, "decoded-proof") || arguments.len() != 3 {
            return Err("lambda output is not a proof".to_string());
        }
        let name = self.decode_bits(arguments[0].clone())?;
        let (program, rule) = name
            .split_once('\0')
            .ok_or_else(|| "lambda proof name has no separator".to_string())?;
        let judgement = self.decode_node(arguments[1].clone())?;
        let premises = self
            .materialize_list(arguments[2].clone())?
            .into_iter()
            .map(|premise| self.decode_proof(premise))
            .collect::<Result<_, _>>()?;
        Ok(LinkedProof {
            judgement,
            program: program.to_string(),
            rule: rule.to_string(),
            premises,
        })
    }
}

fn unfold(term: &LinkedTerm) -> (LinkedTerm, Vec<LinkedTerm>) {
    let mut head = term.clone();
    let mut reversed = Vec::new();
    while let Term::App(left, right) = head.as_ref() {
        reversed.push(right.clone());
        head = left.clone();
    }
    reversed.reverse();
    (head, reversed)
}

fn is_atom(term: &LinkedTerm, expected: &str) -> bool {
    matches!(term.as_ref(), Term::Atom(value) if value == expected)
}

fn is_atom_head(term: &LinkedTerm, expected: &str) -> bool {
    let (head, _) = unfold(term);
    is_atom(&head, expected)
}

pub struct ResolvedRules {
    pub transitions: usize,
    encoded: LinkedTerm,
    pub observed: BTreeSet<&'static str>,
}

pub struct RewriteOutput {
    pub transitions: usize,
    pub step: Option<(Node, String, String)>,
    pub observed: BTreeSet<&'static str>,
}

pub struct ProofState {
    encoded_rules: LinkedTerm,
    encoded_inferences: LinkedTerm,
    encoded_known: LinkedTerm,
    pub size: usize,
}

pub struct ProofStateOutput {
    pub transitions: usize,
    pub state: ProofState,
    pub observed: BTreeSet<&'static str>,
}

pub struct InferenceOutput {
    pub transitions: usize,
    /// The normalized judgement the transition added, with its proof.
    pub derivation: Option<(Node, LinkedProof)>,
    pub state: ProofState,
    pub observed: BTreeSet<&'static str>,
}

pub struct FindProofOutput {
    pub transitions: usize,
    pub proof: Option<LinkedProof>,
    pub observed: BTreeSet<&'static str>,
}

pub fn resolve_rewrites(
    programs: &BTreeMap<String, LinkedProgram>,
    name: &str,
    options: KernelOptions<'_>,
) -> Result<ResolvedRules, String> {
    if options.max_transitions == 0 {
        return Err("max_transitions must be positive".to_string());
    }
    let kernel = options.kernel()?;
    let mut runner = Runner::new(options);
    let encoded = kernel.resolve("RESOLVE_REWRITES", programs, name, &mut runner)?;
    Ok(ResolvedRules {
        transitions: runner.transitions,
        encoded,
        observed: runner.observed,
    })
}

pub fn rewrite_once(
    term: &Node,
    rules: &ResolvedRules,
    options: KernelOptions<'_>,
) -> Result<RewriteOutput, String> {
    if options.max_transitions == 0 {
        return Err("max_transitions must be positive".to_string());
    }
    let kernel = options.kernel()?;
    let mut runner = Runner::new(options);
    let output = apply_many(
        kernel.root("REWRITE_ONCE"),
        [rules.encoded.clone(), kernel.encode_node(term)],
    );
    let observed = runner.head_normalize(apply_many(
        output,
        [atom("decoded-none"), atom("decoded-some")],
    ))?;
    let step = if is_atom(&observed, "decoded-none") {
        None
    } else {
        let (_, option_arguments) = unfold(&observed);
        if !is_atom_head(&observed, "decoded-some") || option_arguments.len() != 1 {
            return Err("lambda output is not an optional rewrite step".to_string());
        }
        let step = runner.head_normalize(app(option_arguments[0].clone(), atom("decoded-step")))?;
        let (_, arguments) = unfold(&step);
        if !is_atom_head(&step, "decoded-step") || arguments.len() != 2 {
            return Err("lambda output is not a rewrite step".to_string());
        }
        let name = runner.decode_bits(arguments[1].clone())?;
        let (program, rule) = name
            .split_once('\0')
            .ok_or_else(|| "lambda rule name has no separator".to_string())?;
        Some((
            runner.decode_node(arguments[0].clone())?,
            program.to_string(),
            rule.to_string(),
        ))
    };
    Ok(RewriteOutput {
        transitions: runner.transitions,
        step,
        observed: runner.observed,
    })
}

pub fn create_proof_state(
    programs: &BTreeMap<String, LinkedProgram>,
    name: &str,
    input_facts: &[Node],
    options: KernelOptions<'_>,
) -> Result<ProofStateOutput, String> {
    if options.max_transitions == 0 {
        return Err("max_transitions must be positive".to_string());
    }
    let kernel = options.kernel()?;
    let mut runner = Runner::new(options);
    let encoded_rules = kernel.resolve("RESOLVE_REWRITES", programs, name, &mut runner)?;
    let encoded_facts = kernel.resolve("RESOLVE_FACTS", programs, name, &mut runner)?;
    let encoded_inferences = kernel.resolve("RESOLVE_INFERENCES", programs, name, &mut runner)?;
    let declared = apply_many(
        kernel.root("ADD_FACTS"),
        [encoded_facts, kernel.root("NIL"), encoded_rules.clone()],
    );
    let input = input_facts
        .iter()
        .enumerate()
        .map(|(index, judgement)| LinkedFact {
            program: "<input>".to_string(),
            name: format!("input-{}", index + 1),
            judgement: judgement.clone(),
        })
        .collect::<Vec<_>>();
    let all = apply_many(
        kernel.root("ADD_FACTS"),
        [kernel.encode_facts(&input), declared, encoded_rules.clone()],
    );
    let known = runner.materialize_list(all)?;
    let size = known.len();
    Ok(ProofStateOutput {
        transitions: runner.transitions,
        state: ProofState {
            encoded_rules,
            encoded_inferences,
            encoded_known: kernel.encode_list(known),
            size,
        },
        observed: runner.observed,
    })
}

pub fn infer_once(
    mut state: ProofState,
    options: KernelOptions<'_>,
) -> Result<InferenceOutput, String> {
    if options.max_transitions == 0 {
        return Err("max_transitions must be positive".to_string());
    }
    let kernel = options.kernel()?;
    let mut runner = Runner::new(options);
    let output = apply_many(
        kernel.root("INFER_ONCE"),
        [
            state.encoded_inferences.clone(),
            state.encoded_known.clone(),
            state.encoded_rules.clone(),
        ],
    );
    let observed = runner.head_normalize(apply_many(
        output,
        [atom("decoded-none"), atom("decoded-some")],
    ))?;
    let derivation = if is_atom(&observed, "decoded-none") {
        None
    } else {
        let (_, option_arguments) = unfold(&observed);
        if !is_atom_head(&observed, "decoded-some") || option_arguments.len() != 1 {
            return Err("lambda output is not an optional derivation".to_string());
        }
        let transition =
            runner.head_normalize(app(option_arguments[0].clone(), atom("decoded-transition")))?;
        let (_, transition_arguments) = unfold(&transition);
        if !is_atom_head(&transition, "decoded-transition") || transition_arguments.len() != 2 {
            return Err("lambda output is not an inference transition".to_string());
        }
        let encoded_derivation = transition_arguments[0].clone();
        let decoded = runner.head_normalize(app(encoded_derivation, atom("decoded-derivation")))?;
        let (_, arguments) = unfold(&decoded);
        if !is_atom_head(&decoded, "decoded-derivation") || arguments.len() != 2 {
            return Err("lambda output is not a derivation".to_string());
        }
        let judgement = runner.decode_node(arguments[0].clone())?;
        let proof = runner.decode_proof(arguments[1].clone())?;
        state.encoded_inferences = transition_arguments[1].clone();
        state.encoded_known = apply_many(
            kernel.root("APPEND"),
            [
                state.encoded_known,
                kernel.encode_list(vec![apply_many(
                    kernel.root("KNOWN"),
                    [arguments[0].clone(), arguments[1].clone()],
                )]),
            ],
        );
        state.size += 1;
        Some((judgement, proof))
    };
    Ok(InferenceOutput {
        transitions: runner.transitions,
        derivation,
        state,
        observed: runner.observed,
    })
}

pub fn find_proof(
    state: &ProofState,
    judgement: &Node,
    options: KernelOptions<'_>,
) -> Result<FindProofOutput, String> {
    if options.max_transitions == 0 {
        return Err("max_transitions must be positive".to_string());
    }
    let kernel = options.kernel()?;
    let mut runner = Runner::new(options);
    let output = apply_many(
        kernel.root("FIND_KNOWN_PROOF"),
        [kernel.encode_node(judgement), state.encoded_known.clone()],
    );
    let observed = runner.head_normalize(apply_many(
        output,
        [atom("decoded-none"), atom("decoded-some")],
    ))?;
    let proof = if is_atom(&observed, "decoded-none") {
        None
    } else {
        let (_, arguments) = unfold(&observed);
        if !is_atom_head(&observed, "decoded-some") || arguments.len() != 1 {
            return Err("lambda output is not an optional proof".to_string());
        }
        Some(runner.decode_proof(arguments[0].clone())?)
    };
    Ok(FindProofOutput {
        transitions: runner.transitions,
        proof,
        observed: runner.observed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn var(name: &str) -> LinkedTerm {
        Arc::new(Term::Variable(name.to_string()))
    }
    fn lam(name: &str, body: LinkedTerm) -> LinkedTerm {
        Arc::new(Term::Lambda(name.to_string(), body))
    }
    #[test]
    fn lexical_capture_shadowing_lazy_arguments_and_divergence_budget() {
        let disabled = BTreeSet::new();
        let mut runner = Runner::new(KernelOptions {
            disabled: &disabled,
            max_transitions: 100,
            kernel: None,
        });
        let keep = lam("x", lam("y", var("x")));
        let captured = runner
            .head_normalize(apply_many(keep.clone(), [atom("outer"), atom("inner")]))
            .unwrap();
        assert!(is_atom(&captured, "outer"));
        let shadow = runner
            .head_normalize(apply_many(
                lam("x", lam("x", var("x"))),
                [atom("outer"), atom("inner")],
            ))
            .unwrap();
        assert!(is_atom(&shadow, "inner"));
        let half = lam("x", app(var("x"), var("x")));
        let omega = app(half.clone(), half);
        let lazy = runner
            .head_normalize(apply_many(keep, [atom("kept"), omega.clone()]))
            .unwrap();
        assert!(is_atom(&lazy, "kept"));
        assert!(runner
            .head_normalize(var("unbound"))
            .unwrap_err()
            .contains("unbound lambda variable"));
        assert!(runner
            .head_normalize(omega)
            .unwrap_err()
            .contains("transition limit"));
    }
}
