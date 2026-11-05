//! Explicit codecs and orchestration for linked Horn semantics. No upper predicate implementation.
use crate::horn_resolution::{HornResolution, Options, Proof as ResolutionProof, QueryResult};
use crate::linked_program::{LinkedProgram, LinkedProof, RewriteRule};
use crate::Node;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const SOURCE: &str = include_str!("../../../lib/meta-theory/relational-kernel.lino");
fn atom(value: &str) -> Node {
    Node::Leaf(value.to_string())
}
fn list(items: Vec<Node>) -> Node {
    Node::List(items)
}
fn tagged(tag: &str, items: Vec<Node>) -> Node {
    let mut out = vec![atom(tag)];
    out.extend(items);
    list(out)
}
fn items(node: &Node) -> Result<&[Node], String> {
    if let Node::List(items) = node {
        Ok(items)
    } else {
        Err("expected relational list term".into())
    }
}
fn tag<'a>(node: &'a Node, expected: &str, length: usize) -> Result<&'a [Node], String> {
    let parts = items(node)?;
    if parts.len() != length || parts[0] != atom(expected) {
        return Err(format!("invalid relational {expected}"));
    }
    Ok(parts)
}
pub fn encode_list(values: Vec<Node>) -> Node {
    values
        .into_iter()
        .rev()
        .fold(atom("end"), |tail, head| tagged("cons", vec![head, tail]))
}
pub fn decode_list(mut value: &Node) -> Result<Vec<Node>, String> {
    let mut output = Vec::new();
    while value != &atom("end") {
        let pair = tag(value, "cons", 3)?;
        output.push(pair[1].clone());
        value = &pair[2];
    }
    Ok(output)
}
pub fn encode_bits(value: &str) -> Node {
    value
        .as_bytes()
        .iter()
        .flat_map(|byte| (0..8).map(move |i| byte & (128 >> i) != 0))
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .fold(atom("end"), |tail, bit| {
            tagged(if bit { "one" } else { "zero" }, vec![tail])
        })
}
pub fn decode_bits(mut value: &Node) -> Result<String, String> {
    let mut bits = Vec::new();
    while value != &atom("end") {
        let parts = items(value)?;
        if parts.len() != 2 || ![atom("one"), atom("zero")].contains(&parts[0]) {
            return Err("invalid relational UTF-8 bits".into());
        }
        bits.push(parts[0] == atom("one"));
        value = &parts[1];
    }
    if bits.len() % 8 != 0 {
        return Err("invalid relational UTF-8 bits".into());
    }
    let mut bytes = vec![0; bits.len() / 8];
    for (i, bit) in bits.into_iter().enumerate() {
        if bit {
            bytes[i / 8] |= 128 >> (i % 8);
        }
    }
    String::from_utf8(bytes).map_err(|error| error.to_string())
}
pub fn encode_node(value: &Node, pattern: bool) -> Node {
    match value {
        Node::Leaf(value) if pattern && value.starts_with('?') && value.len() > 1 => {
            tagged("variable", vec![encode_bits(&value[1..])])
        }
        Node::Leaf(value) => tagged("atom", vec![encode_bits(value)]),
        Node::List(values) => tagged(
            "list",
            vec![encode_list(
                values
                    .iter()
                    .map(|value| encode_node(value, pattern))
                    .collect(),
            )],
        ),
    }
}
pub fn decode_node(value: &Node) -> Result<Node, String> {
    let parts = items(value)?;
    if parts.len() != 2 {
        return Err("invalid relational node".into());
    }
    if parts[0] == atom("atom") {
        Ok(Node::Leaf(decode_bits(&parts[1])?))
    } else if parts[0] == atom("list") {
        Ok(Node::List(
            decode_list(&parts[1])?
                .iter()
                .map(decode_node)
                .collect::<Result<_, _>>()?,
        ))
    } else {
        Err("unknown relational node".into())
    }
}
fn origin(program: &str, name: &str) -> Node {
    tagged("origin", vec![encode_bits(program), encode_bits(name)])
}
pub fn encode_rules(rules: &[RewriteRule]) -> Node {
    encode_list(
        rules
            .iter()
            .map(|rule| {
                tagged(
                    "rule",
                    vec![
                        origin(&rule.program, &rule.name),
                        encode_node(&rule.pattern, true),
                        encode_node(&rule.replacement, true),
                    ],
                )
            })
            .collect(),
    )
}
pub fn encode_programs(programs: &BTreeMap<String, LinkedProgram>) -> Node {
    encode_list(
        programs
            .values()
            .map(|program| {
                tagged(
                    "program",
                    vec![
                        encode_bits(&program.name),
                        encode_rules(&program.rewrites),
                        encode_list(
                            program
                                .facts
                                .iter()
                                .map(|fact| {
                                    tagged(
                                        "fact",
                                        vec![
                                            origin(&fact.program, &fact.name),
                                            encode_node(&fact.judgement, false),
                                        ],
                                    )
                                })
                                .collect(),
                        ),
                        encode_list(
                            program
                                .inferences
                                .iter()
                                .map(|rule| {
                                    tagged(
                                        "inference",
                                        vec![
                                            origin(&rule.program, &rule.name),
                                            encode_list(
                                                rule.premises
                                                    .iter()
                                                    .map(|premise| encode_node(premise, true))
                                                    .collect(),
                                            ),
                                            encode_node(&rule.conclusion, true),
                                        ],
                                    )
                                })
                                .collect(),
                        ),
                        encode_list(
                            program
                                .uses
                                .iter()
                                .map(|dependency| {
                                    tagged(
                                        "import",
                                        vec![
                                            encode_bits(&dependency.program),
                                            encode_list(
                                                dependency
                                                    .rebindings
                                                    .iter()
                                                    .map(|(from, to)| {
                                                        tagged(
                                                            "rebind",
                                                            vec![
                                                                encode_bits(from),
                                                                encode_bits(to),
                                                            ],
                                                        )
                                                    })
                                                    .collect(),
                                            ),
                                        ],
                                    )
                                })
                                .collect(),
                        ),
                    ],
                )
            })
            .collect(),
    )
}
fn fuel(count: usize) -> Result<Node, String> {
    if count > 256 {
        return Err("normalization_fuel must be from 0 to 256".into());
    }
    Ok((0..count).fold(atom("zero"), |tail, _| tagged("successor", vec![tail])))
}

pub fn decode_proof(value: &Node) -> Result<LinkedProof, String> {
    let parts = tag(value, "proof", 4)?;
    let name = tag(&parts[1], "origin", 3)?;
    Ok(LinkedProof {
        program: decode_bits(&name[1])?,
        rule: decode_bits(&name[2])?,
        judgement: decode_node(&parts[2])?,
        premises: decode_list(&parts[3])?
            .iter()
            .map(decode_proof)
            .collect::<Result<_, _>>()?,
    })
}
#[derive(Clone, Debug)]
pub struct Call {
    pub value: Node,
    pub proof: Option<ResolutionProof>,
    pub source_proof: Option<Node>,
    pub query: Node,
    pub execution: QueryResult,
}
#[derive(Clone, Debug)]
pub struct Rewrite {
    pub step: Option<(Node, String, String)>,
    pub call: Call,
}
#[derive(Clone, Debug)]
pub struct ProofState {
    pub rules: Node,
    pub inferences: Node,
    pub known: Node,
    pub size: usize,
}
#[derive(Clone, Debug)]
pub struct Inference {
    pub derivation: Option<(Node, LinkedProof)>,
    pub state: ProofState,
    pub execution: QueryResult,
}
struct InterpreterImage {
    names: Vec<String>,
    ids: BTreeMap<String, usize>,
    program: Node,
}
impl InterpreterImage {
    fn new(clauses: &[crate::horn_resolution::Clause]) -> Self {
        let mut image = Self {
            names: Vec::new(),
            ids: BTreeMap::new(),
            program: atom("end"),
        };
        let mut result = Vec::new();
        for clause in clauses {
            let name = image.encode_name(&clause.name);
            let head = image.encode(&clause.head);
            let body = encode_list(clause.body.iter().map(|term| image.encode(term)).collect());
            result.push(tagged("clause", vec![name, head, body]));
        }
        image.program = encode_list(result);
        image
    }
    fn encode_name(&mut self, name: &str) -> Node {
        let id = match self.ids.get(name) {
            Some(id) => *id,
            None => {
                let id = self.names.len();
                self.names.push(name.to_string());
                self.ids.insert(name.to_string(), id);
                id
            }
        };
        let mut value = id;
        let mut bits = atom("end");
        loop {
            bits = tagged(if value & 1 == 1 { "one" } else { "zero" }, vec![bits]);
            value /= 2;
            if value == 0 {
                break;
            }
        }
        bits
    }
    fn encode(&mut self, value: &Node) -> Node {
        match value {
            Node::Leaf(value) if value.starts_with('?') && value.len() > 1 => {
                tagged("variable", vec![self.encode_name(&value[1..])])
            }
            Node::Leaf(value) => tagged("atom", vec![self.encode_name(value)]),
            Node::List(values) => tagged(
                "list",
                vec![encode_list(
                    values.iter().map(|value| self.encode(value)).collect(),
                )],
            ),
        }
    }
    fn decode(&self, value: &Node) -> Result<Node, String> {
        let fields = items(value)?;
        if fields.len() != 2 {
            return Err("invalid interpreted node".into());
        }
        if fields[0] == atom("list") {
            return Ok(Node::List(
                decode_list(&fields[1])?
                    .iter()
                    .map(|node| self.decode(node))
                    .collect::<Result<_, _>>()?,
            ));
        }
        if fields[0] != atom("atom") {
            return Err("self interpreter returned a nonground atom".into());
        }
        let mut cursor = &fields[1];
        if cursor == &atom("end")
            || matches!(cursor, Node::List(values) if values.first() == Some(&atom("zero")) && values.get(1) != Some(&atom("end")))
        {
            return Err("noncanonical interpreted atom code".into());
        }
        let mut index = 0usize;
        while cursor != &atom("end") {
            let bits = items(cursor)?;
            if bits.len() != 2 || ![atom("zero"), atom("one")].contains(&bits[0]) {
                return Err("invalid interpreted atom code".into());
            }
            index = index
                .checked_mul(2)
                .and_then(|value| value.checked_add(usize::from(bits[0] == atom("one"))))
                .ok_or("interpreted atom code overflow")?;
            cursor = &bits[1];
        }
        self.names
            .get(index)
            .map(|name| Node::Leaf(name.clone()))
            .ok_or_else(|| "unknown interpreted atom code".into())
    }
    fn names_node(&self) -> Node {
        Node::List(self.names.iter().cloned().map(Node::Leaf).collect())
    }
}
#[derive(Clone, Debug)]
pub struct RelationalKernel {
    resolver: HornResolution,
    source_hash: String,
}
impl RelationalKernel {
    pub fn resolver(&self) -> &HornResolution {
        &self.resolver
    }
    pub fn from_source(source: &str) -> Result<Self, String> {
        Ok(Self {
            resolver: HornResolution::from_source(source)?,
            source_hash: Sha256::digest(source.as_bytes())
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        })
    }
    pub fn call(
        &self,
        predicate: &str,
        inputs: Vec<Node>,
        options: &Options,
    ) -> Result<Call, String> {
        let mut parts = vec![atom(predicate)];
        parts.extend(inputs);
        parts.push(atom("?result"));
        let query = list(parts);
        let execution = self.run_query(&query, options)?;
        if execution.answers.len() != 1 {
            return Err(format!(
                "linked relation {predicate} has no answer within the declared search"
            ));
        }
        let answer = &execution.answers[0];
        let value = items(&answer.goal)?.last().unwrap().clone();
        Ok(Call {
            value,
            proof: answer.proof.clone(),
            source_proof: answer.source_proof.clone(),
            query,
            execution,
        })
    }
    pub fn resolve(
        &self,
        programs: &BTreeMap<String, LinkedProgram>,
        name: &str,
        kind: &str,
        options: &Options,
    ) -> Result<Call, String> {
        let result = self.call(
            "resolve",
            vec![
                encode_programs(programs),
                encode_bits(name),
                atom(kind),
                atom("end"),
            ],
            options,
        )?;
        let values = items(&result.value)?;
        if values.first() != Some(&atom("resolved")) {
            return Err(format!("linked import resolution failed: {}", result.value));
        }
        tag(&result.value, "resolved", 2)?;
        Ok(result)
    }
    pub fn rewrite_once(
        &self,
        term: &Node,
        rules: &Node,
        options: &Options,
    ) -> Result<Rewrite, String> {
        let call = self.call(
            "rewrite-once",
            vec![rules.clone(), encode_node(term, false)],
            options,
        )?;
        let step = if call.value == atom("none") {
            None
        } else {
            let option = tag(&call.value, "some", 2)?;
            let step = tag(&option[1], "step", 3)?;
            let name = tag(&step[2], "origin", 3)?;
            Some((
                decode_node(&step[1])?,
                decode_bits(&name[1])?,
                decode_bits(&name[2])?,
            ))
        };
        Ok(Rewrite { step, call })
    }
    pub fn create_proof_state(
        &self,
        programs: &BTreeMap<String, LinkedProgram>,
        name: &str,
        input_facts: &[Node],
        options: &Options,
    ) -> Result<ProofState, String> {
        let rules = items(&self.resolve(programs, name, "rewrites", options)?.value)?[1].clone();
        let facts = items(&self.resolve(programs, name, "facts", options)?.value)?[1].clone();
        let inferences =
            items(&self.resolve(programs, name, "inferences", options)?.value)?[1].clone();
        let initial = self
            .call(
                "add-facts",
                vec![
                    facts,
                    rules.clone(),
                    fuel(options.normalization_fuel)?,
                    atom("end"),
                ],
                options,
            )?
            .value;
        let inputs = encode_list(
            input_facts
                .iter()
                .enumerate()
                .map(|(i, judgement)| {
                    tagged(
                        "fact",
                        vec![
                            origin("<input>", &format!("input-{}", i + 1)),
                            encode_node(judgement, false),
                        ],
                    )
                })
                .collect(),
        );
        let known = self
            .call(
                "add-facts",
                vec![
                    inputs,
                    rules.clone(),
                    fuel(options.normalization_fuel)?,
                    initial,
                ],
                options,
            )?
            .value;
        let size = decode_list(&known)?.len();
        Ok(ProofState {
            rules,
            inferences,
            known,
            size,
        })
    }
    pub fn infer_once(&self, state: ProofState, options: &Options) -> Result<Inference, String> {
        let query = tagged(
            "infer-step",
            vec![
                state.inferences.clone(),
                state.known.clone(),
                state.rules.clone(),
                fuel(options.normalization_fuel)?,
                atom("?result"),
            ],
        );
        let execution = self.run_query(&query, options)?;
        if execution.answers.is_empty() {
            if !execution.exhausted {
                return Err("inference search did not establish exhaustion".into());
            }
            return Ok(Inference {
                derivation: None,
                state,
                execution,
            });
        }
        let result = items(&execution.answers[0].goal)?.last().unwrap();
        if matches!(result, Node::List(values) if values.first() == Some(&atom("blocked"))) {
            let values = tag(result, "blocked", 3)?;
            return Err(format!("linked inference blocked: {}", values[1]));
        }
        let transition = tag(result, "transition", 3)?;
        let inferences = transition[2].clone();
        let result = tag(&transition[1], "derived", 3)?;
        let derivation = Some((decode_node(&result[1])?, decode_proof(&result[2])?));
        let known = self
            .call(
                "append",
                vec![
                    state.known,
                    encode_list(vec![tagged(
                        "known",
                        vec![result[1].clone(), result[2].clone()],
                    )]),
                ],
                options,
            )?
            .value;
        Ok(Inference {
            derivation,
            state: ProofState {
                inferences,
                known,
                size: state.size + 1,
                ..state
            },
            execution,
        })
    }
    pub fn find_proof(
        &self,
        state: &ProofState,
        judgement: &Node,
        options: &Options,
    ) -> Result<Option<LinkedProof>, String> {
        let result = self
            .call(
                "known-proof",
                vec![encode_node(judgement, false), state.known.clone()],
                options,
            )?
            .value;
        if result == atom("none") {
            Ok(None)
        } else {
            Ok(Some(decode_proof(&tag(&result, "some", 2)?[1])?))
        }
    }
    pub fn describe_program(&self) -> Node {
        encode_list(
            self.resolver
                .clauses()
                .iter()
                .map(|clause| {
                    tagged(
                        "clause",
                        vec![
                            encode_bits(&clause.name),
                            encode_node(&clause.head, true),
                            encode_list(
                                clause
                                    .body
                                    .iter()
                                    .map(|term| encode_node(term, true))
                                    .collect(),
                            ),
                        ],
                    )
                })
                .collect(),
        )
    }
    pub fn run_query(&self, query: &Node, options: &Options) -> Result<QueryResult, String> {
        if !options.self_interpret {
            return self.resolver.query(query, options);
        }
        let mut image = InterpreterImage::new(self.resolver.clauses());
        let goal = image.encode(query);
        let predicate = if options.include_source_proof {
            "self-query"
        } else {
            "self-query-value"
        };
        let outer = tagged(
            predicate,
            vec![image.program.clone(), goal, atom("?answer")],
        );
        let mut inner_options = options.clone();
        inner_options.self_interpret = false;
        inner_options.capture_proof = false;
        let mut result = self.resolver.query(&outer, &inner_options)?;
        for answer in &mut result.answers {
            let returned = items(&answer.goal)?.last().unwrap();
            let returned = tag(
                returned,
                "answer",
                if options.include_source_proof { 3 } else { 2 },
            )?;
            let goal = image.decode(&returned[1])?;
            let proof = if options.include_source_proof {
                Some(tagged(
                    "relational-self-proof-v1",
                    vec![
                        atom(&self.source_hash),
                        image.names_node(),
                        returned[2].clone(),
                    ],
                ))
            } else {
                None
            };
            answer.goal = goal;
            answer.proof = None;
            answer.source_proof = proof;
        }
        Ok(result)
    }
    pub fn self_query(&self, goal: &Node, options: &Options) -> Result<Node, String> {
        let mut options = options.clone();
        options.self_interpret = true;
        self.run_query(goal, &options)?
            .answers
            .first()
            .map(|answer| answer.goal.clone())
            .ok_or_else(|| "self interpreted query has no answer".into())
    }
    pub fn self_replay(
        &self,
        goal: &Node,
        proof: &Node,
        options: &Options,
    ) -> Result<Option<Node>, String> {
        let mut image = InterpreterImage::new(self.resolver.clauses());
        let encoded = image.encode(goal);
        let Ok(fields) = tag(proof, "relational-self-proof-v1", 4) else {
            return Ok(None);
        };
        if fields[1] != atom(&self.source_hash) || fields[2] != image.names_node() {
            return Ok(None);
        }
        let query = tagged(
            "self-replay",
            vec![
                image.program.clone(),
                encoded,
                fields[3].clone(),
                atom("?result"),
            ],
        );
        let mut options = options.clone();
        options.self_interpret = false;
        options.capture_proof = false;
        let result = self.resolver.query(&query, &options)?;
        match result.answers.first() {
            None => Ok(None),
            Some(answer) => {
                let value = items(&answer.goal)?.last().unwrap();
                Ok(Some(image.decode(&tag(value, "verified", 2)?[1])?))
            }
        }
    }
}
