use super::{InferenceRule, LinkedFact, LinkedProgram, LinkedProof, ProgramImport, RewriteRule};
use crate::Node;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, OnceLock};

const ARTIFACT: &str = include_str!("../../../lib/meta-theory/fixed-point.ski");
const SOURCE: &str = include_str!("../../../lib/meta-theory/fixed-point-source.lino");
const MAX_CONTRACTIONS: usize = 100_000_000;

pub(super) struct KernelSourceSummary {
    pub(super) artifact: &'static str,
    pub(super) schema: &'static str,
    pub(super) representation: &'static str,
    pub(super) upstream_model: &'static str,
    pub(super) source_nodes: usize,
    pub(super) runtime_nodes: usize,
    pub(super) roots: usize,
}

#[derive(Debug)]
enum Term {
    S,
    K,
    Atom(String),
    App(Arc<Term>, Arc<Term>),
}

type LinkedTerm = Arc<Term>;

fn atom(value: impl Into<String>) -> LinkedTerm {
    Arc::new(Term::Atom(value.into()))
}

fn app(left: LinkedTerm, right: LinkedTerm) -> LinkedTerm {
    Arc::new(Term::App(left, right))
}

fn apply_many(head: LinkedTerm, arguments: impl IntoIterator<Item = LinkedTerm>) -> LinkedTerm {
    arguments.into_iter().fold(head, app)
}

#[derive(Debug)]
struct Kernel {
    roots: BTreeMap<String, LinkedTerm>,
    node_count: usize,
    root_count: usize,
}

impl Kernel {
    fn load() -> Result<Self, String> {
        let mut lines = ARTIFACT.lines();
        if lines.next() != Some("rml-addressed-link-dag-v1") {
            return Err("invalid fixed-point kernel header".to_string());
        }
        let counts: Vec<usize> = lines
            .next()
            .ok_or_else(|| "missing fixed-point kernel counts".to_string())?
            .split('\t')
            .map(|value| value.parse::<usize>().map_err(|error| error.to_string()))
            .collect::<Result<_, _>>()?;
        if counts.len() != 2 {
            return Err("invalid fixed-point kernel counts".to_string());
        }
        let s = Arc::new(Term::S);
        let k = Arc::new(Term::K);
        let mut nodes: Vec<LinkedTerm> = Vec::with_capacity(counts[0]);
        let reference = |value: &str, nodes: &[LinkedTerm]| -> Result<LinkedTerm, String> {
            match value {
                "S" => Ok(s.clone()),
                "K" => Ok(k.clone()),
                _ if value.starts_with('n') => {
                    let index = value[1..]
                        .parse::<usize>()
                        .map_err(|error| error.to_string())?;
                    nodes
                        .get(index)
                        .cloned()
                        .ok_or_else(|| format!("unknown fixed-point node {value}"))
                }
                _ => Err(format!("invalid fixed-point reference {value}")),
            }
        };
        for expected in 0..counts[0] {
            let fields: Vec<&str> = lines
                .next()
                .ok_or_else(|| "truncated fixed-point node table".to_string())?
                .split('\t')
                .collect();
            if fields.len() != 3 || fields[0].parse::<usize>().ok() != Some(expected) {
                return Err(format!("invalid fixed-point node {expected}"));
            }
            nodes.push(app(
                reference(fields[1], &nodes)?,
                reference(fields[2], &nodes)?,
            ));
        }
        let mut roots = BTreeMap::new();
        for _ in 0..counts[1] {
            let fields: Vec<&str> = lines
                .next()
                .ok_or_else(|| "truncated fixed-point root table".to_string())?
                .split('\t')
                .collect();
            if fields.len() != 2 {
                return Err("invalid fixed-point root".to_string());
            }
            if roots
                .insert(fields[0].to_string(), reference(fields[1], &nodes)?)
                .is_some()
            {
                return Err(format!("duplicate fixed-point root {}", fields[0]));
            }
        }
        if lines.any(|line| !line.is_empty()) {
            return Err("unexpected data after fixed-point root table".to_string());
        }
        Ok(Self {
            roots,
            node_count: counts[0],
            root_count: counts[1],
        })
    }

    fn shared() -> Result<&'static Self, String> {
        static SHARED: OnceLock<Result<Kernel, String>> = OnceLock::new();
        SHARED
            .get_or_init(Self::load)
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
                "combinator import resolver cannot find linked-program {name}"
            ));
        }
        let (_, arguments) = unfold(&observed);
        if !is_atom_head(&observed, "decoded-some") || arguments.len() != 1 {
            return Err("combinator import resolver returned an invalid result".to_string());
        }
        let items = runner.materialize_list(arguments[0].clone())?;
        Ok(self.encode_list(items))
    }
}

pub(super) fn source_summary() -> Result<KernelSourceSummary, String> {
    fn clause(name: &str) -> Result<&'static str, String> {
        let prefix = format!("({name} ");
        SOURCE
            .lines()
            .find_map(|line| {
                line.trim()
                    .strip_prefix(&prefix)
                    .map(|value| value.trim_end_matches(')'))
            })
            .ok_or_else(|| format!("fixed-point source requires ({name} value)"))
    }

    if !SOURCE.contains("(bootstrap-source rml.bootstrap.fixed-point") {
        return Err("missing fixed-point bootstrap source declaration".to_string());
    }
    let source_nodes = SOURCE
        .lines()
        .filter(|line| line.trim_start().starts_with("(bootstrap-source-node "))
        .count();
    let roots = SOURCE
        .lines()
        .filter(|line| line.trim_start().starts_with("(bootstrap-source-root "))
        .count();
    let declared_source_nodes = clause("node-count")?
        .parse::<usize>()
        .map_err(|error| error.to_string())?;
    let declared_roots = clause("root-count")?
        .parse::<usize>()
        .map_err(|error| error.to_string())?;
    if source_nodes != declared_source_nodes || roots != declared_roots {
        return Err("fixed-point bootstrap source counts do not match its declaration".to_string());
    }
    let kernel = Kernel::shared()?;
    if roots != kernel.root_count {
        return Err("fixed-point source and runtime root counts differ".to_string());
    }
    Ok(KernelSourceSummary {
        artifact: "lib/meta-theory/fixed-point-source.lino",
        schema: clause("schema")?,
        representation: clause("representation")?,
        upstream_model: clause("upstream-model")?,
        source_nodes,
        runtime_nodes: kernel.node_count,
        roots,
    })
}

pub(super) struct Runner {
    disabled: BTreeSet<String>,
    pub(super) observed: BTreeSet<&'static str>,
    contractions: usize,
}

impl Runner {
    pub(super) fn new(disabled: &BTreeSet<String>) -> Self {
        Self {
            disabled: disabled.clone(),
            observed: BTreeSet::new(),
            contractions: 0,
        }
    }

    fn observe(&mut self, operation: &'static str) -> Result<(), String> {
        if self.disabled.contains(operation) {
            return Err(format!("disabled host semantic operation {operation}"));
        }
        self.observed.insert(operation);
        self.contractions += 1;
        if self.contractions > MAX_CONTRACTIONS {
            return Err(format!(
                "combinator contraction limit {MAX_CONTRACTIONS} exceeded"
            ));
        }
        Ok(())
    }

    fn head_normalize(&mut self, term: LinkedTerm) -> Result<LinkedTerm, String> {
        let mut current = term;
        let mut arguments = Vec::new();
        loop {
            while let Term::App(left, right) = current.as_ref() {
                arguments.push(right.clone());
                current = left.clone();
            }
            match current.as_ref() {
                Term::K if arguments.len() >= 2 => {
                    self.observe("contract-k-link")?;
                    current = arguments.pop().unwrap();
                    arguments.pop();
                }
                Term::S if arguments.len() >= 3 => {
                    self.observe("contract-s-link")?;
                    let left = arguments.pop().unwrap();
                    let right = arguments.pop().unwrap();
                    let argument = arguments.pop().unwrap();
                    current = app(app(left, argument.clone()), app(right, argument));
                }
                _ => {
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
                return Err("combinator output is not a list".to_string());
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
            Err("combinator output is not a boolean".to_string())
        }
    }

    fn decode_bits(&mut self, term: LinkedTerm) -> Result<String, String> {
        let bits = self.materialize_list(term)?;
        if bits.len() % 8 != 0 {
            return Err("combinator atom is not byte-aligned".to_string());
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
            return Err("combinator output is not a node".to_string());
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
        Err("combinator output has an unknown node constructor".to_string())
    }

    fn decode_proof(&mut self, term: LinkedTerm) -> Result<LinkedProof, String> {
        let observed = self.head_normalize(app(term, atom("decoded-proof")))?;
        let (_, arguments) = unfold(&observed);
        if !is_atom_head(&observed, "decoded-proof") || arguments.len() != 3 {
            return Err("combinator output is not a proof".to_string());
        }
        let name = self.decode_bits(arguments[0].clone())?;
        let (program, rule) = name
            .split_once('\0')
            .ok_or_else(|| "combinator proof name has no separator".to_string())?;
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

pub(super) struct ResolvedRules {
    encoded: LinkedTerm,
    pub(super) observed: BTreeSet<&'static str>,
}

pub(super) struct RewriteOutput {
    pub(super) step: Option<(Node, String, String)>,
    pub(super) observed: BTreeSet<&'static str>,
}

pub(super) struct ProofState {
    encoded_rules: LinkedTerm,
    encoded_inferences: LinkedTerm,
    encoded_known: LinkedTerm,
    pub(super) size: usize,
}

pub(super) struct ProofStateOutput {
    pub(super) state: ProofState,
    pub(super) observed: BTreeSet<&'static str>,
}

pub(super) struct InferenceOutput {
    pub(super) derivation: Option<LinkedProof>,
    pub(super) state: ProofState,
    pub(super) observed: BTreeSet<&'static str>,
}

pub(super) struct FindProofOutput {
    pub(super) proof: Option<LinkedProof>,
    pub(super) observed: BTreeSet<&'static str>,
}

pub(super) fn resolve_rewrites(
    programs: &BTreeMap<String, LinkedProgram>,
    name: &str,
    disabled: &BTreeSet<String>,
) -> Result<ResolvedRules, String> {
    let kernel = Kernel::shared()?;
    let mut runner = Runner::new(disabled);
    let encoded = kernel.resolve("RESOLVE_REWRITES", programs, name, &mut runner)?;
    Ok(ResolvedRules {
        encoded,
        observed: runner.observed,
    })
}

pub(super) fn rewrite_once(
    term: &Node,
    rules: &ResolvedRules,
    disabled: &BTreeSet<String>,
) -> Result<RewriteOutput, String> {
    let kernel = Kernel::shared()?;
    let mut runner = Runner::new(disabled);
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
            return Err("combinator output is not an optional rewrite step".to_string());
        }
        let step = runner.head_normalize(app(option_arguments[0].clone(), atom("decoded-step")))?;
        let (_, arguments) = unfold(&step);
        if !is_atom_head(&step, "decoded-step") || arguments.len() != 2 {
            return Err("combinator output is not a rewrite step".to_string());
        }
        let name = runner.decode_bits(arguments[1].clone())?;
        let (program, rule) = name
            .split_once('\0')
            .ok_or_else(|| "combinator rule name has no separator".to_string())?;
        Some((
            runner.decode_node(arguments[0].clone())?,
            program.to_string(),
            rule.to_string(),
        ))
    };
    Ok(RewriteOutput {
        step,
        observed: runner.observed,
    })
}

pub(super) fn create_proof_state(
    programs: &BTreeMap<String, LinkedProgram>,
    name: &str,
    input_facts: &[Node],
    disabled: &BTreeSet<String>,
) -> Result<ProofStateOutput, String> {
    let kernel = Kernel::shared()?;
    let mut runner = Runner::new(disabled);
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
        state: ProofState {
            encoded_rules,
            encoded_inferences,
            encoded_known: kernel.encode_list(known),
            size,
        },
        observed: runner.observed,
    })
}

pub(super) fn infer_once(
    mut state: ProofState,
    disabled: &BTreeSet<String>,
) -> Result<InferenceOutput, String> {
    let kernel = Kernel::shared()?;
    let mut runner = Runner::new(disabled);
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
            return Err("combinator output is not an optional derivation".to_string());
        }
        let transition =
            runner.head_normalize(app(option_arguments[0].clone(), atom("decoded-transition")))?;
        let (_, transition_arguments) = unfold(&transition);
        if !is_atom_head(&transition, "decoded-transition") || transition_arguments.len() != 2 {
            return Err("combinator output is not an inference transition".to_string());
        }
        let encoded_derivation = transition_arguments[0].clone();
        let decoded = runner.head_normalize(app(encoded_derivation, atom("decoded-derivation")))?;
        let (_, arguments) = unfold(&decoded);
        if !is_atom_head(&decoded, "decoded-derivation") || arguments.len() != 2 {
            return Err("combinator output is not a derivation".to_string());
        }
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
        Some(proof)
    };
    Ok(InferenceOutput {
        derivation,
        state,
        observed: runner.observed,
    })
}

pub(super) fn find_proof(
    state: &ProofState,
    judgement: &Node,
    disabled: &BTreeSet<String>,
) -> Result<FindProofOutput, String> {
    let kernel = Kernel::shared()?;
    let mut runner = Runner::new(disabled);
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
            return Err("combinator output is not an optional proof".to_string());
        }
        Some(runner.decode_proof(arguments[0].clone())?)
    };
    Ok(FindProofOutput {
        proof,
        observed: runner.observed,
    })
}
