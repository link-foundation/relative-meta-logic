//! The unchanged lambda-link meta-semantics executed on the Horn foundation.
//! `horn-link-substitution.lino` defines binder resolution, environment-based
//! substitution, value construction/observation and workflow orchestration as
//! Horn clauses. This module only transcribes the validated lambda source,
//! interns binder names injectively, caches the linked binder-resolution result
//! as root facts, and converts first-order inputs and outputs.
use crate::horn_resolution::{Clause, HornResolution, Options};
use crate::linked_program::{LinkedProgram, LinkedProof};
use crate::relational_kernel::{decode_bits, decode_list, decode_node, encode_bits, encode_list, encode_node, encode_programs};
use crate::{parse_lino, parse_one, tokenize_one, Node};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const SOURCE: &str = include_str!("../../../lib/meta-theory/horn-link-substitution.lino");
pub const DEFAULT_MAX_STEPS: usize = 400_000_000;
pub const DEFAULT_MAX_DEPTH: usize = 1_000_000_000;

fn atom(value: &str) -> Node {
    Node::Leaf(value.to_string())
}
fn tagged(tag: &str, items: Vec<Node>) -> Node {
    let mut out = vec![atom(tag)];
    out.extend(items);
    Node::List(out)
}
fn tag<'a>(node: &'a Node, expected: &str, length: usize) -> Result<&'a [Node], String> {
    match node {
        Node::List(parts) if parts.len() == length && parts[0] == atom(expected) => Ok(parts),
        _ => Err(format!("invalid Horn link-substitution {expected}")),
    }
}
fn unary(count: usize) -> Result<Node, String> {
    if count > 4096 {
        return Err("Horn link-substitution fuel must be an integer from 0 to 4096".into());
    }
    Ok((0..count).fold(atom("zero"), |tail, _| tagged("successor", vec![tail])))
}
fn count_unary(mut value: &Node) -> Result<usize, String> {
    let mut count = 0;
    while let Node::List(parts) = value {
        if parts.len() != 2 || parts[0] != atom("successor") {
            break;
        }
        count += 1;
        value = &parts[1];
    }
    if value != &atom("zero") {
        return Err("invalid Horn link-substitution count".into());
    }
    Ok(count)
}

/// Lambda terms as Horn data; binder names become injective binary codes.
#[derive(Default)]
struct Transcriber {
    codes: BTreeMap<String, Node>,
}
impl Transcriber {
    fn code(&mut self, name: &str) -> Node {
        if let Some(code) = self.codes.get(name) {
            return code.clone();
        }
        let mut value = self.codes.len();
        let mut bits = atom("end");
        loop {
            bits = Node::List(vec![atom(if value & 1 == 1 { "one" } else { "zero" }), bits]);
            value /= 2;
            if value == 0 {
                break;
            }
        }
        self.codes.insert(name.to_string(), bits.clone());
        bits
    }
    /// Probe terms: strings are opaque markers, `[f, a]` applications, and
    /// objects `{"variable": x}` or `{"lambda": x, "body": t}`.
    fn json(&mut self, term: &serde_json::Value) -> Result<Node, String> {
        match term {
            serde_json::Value::String(name) => Ok(tagged("marker", vec![atom(name)])),
            serde_json::Value::Array(items) if items.len() == 2 => Ok(tagged(
                "application",
                vec![self.json(&items[0])?, self.json(&items[1])?],
            )),
            serde_json::Value::Object(fields) => {
                if let Some(serde_json::Value::String(name)) = fields.get("variable") {
                    return Ok(tagged("variable", vec![self.code(name)]));
                }
                match (fields.get("lambda"), fields.get("body")) {
                    (Some(serde_json::Value::String(name)), Some(body)) => {
                        let code = self.code(name);
                        Ok(tagged("lambda", vec![code, self.json(body)?]))
                    }
                    _ => Err("invalid lambda probe term".into()),
                }
            }
            _ => Err("invalid lambda probe term".into()),
        }
    }
}

pub struct Transcription {
    pub roots: Node,
    pub node_count: usize,
    pub root_count: usize,
    pub names: usize,
}

/// Transcribe a validated lambda source DAG for linked binder resolution.
pub fn transcribe_lambda_source(source: &str) -> Result<Transcription, String> {
    // The existing loader performs every structural and closedness check.
    let validated = rml::lambda_kernel::Kernel::from_source(source)?;
    let flattened = source
        .lines()
        .map(|line| line.trim_start_matches([' ', '\t']))
        .collect::<Vec<_>>()
        .join("\n");
    let mut descriptors: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut root_forms = Vec::new();
    for form in parse_lino(&flattened).map_err(|error| error.to_string())? {
        let Node::List(items) = parse_one(&tokenize_one(&form))? else {
            return Err("invalid lambda source form".into());
        };
        let leaves = |node: &Node| -> Vec<String> {
            match node {
                Node::Leaf(value) => vec![value.clone()],
                Node::List(values) => values
                    .iter()
                    .filter_map(|value| match value {
                        Node::Leaf(text) => Some(text.clone()),
                        Node::List(_) => None,
                    })
                    .collect(),
            }
        };
        match (items.first(), items.get(1), items.get(2)) {
            (Some(Node::Leaf(kind)), Some(Node::Leaf(id)), Some(descriptor))
                if kind == "bootstrap-source-node" =>
            {
                descriptors.insert(id.clone(), leaves(descriptor));
            }
            (Some(Node::Leaf(kind)), Some(Node::Leaf(name)), Some(Node::Leaf(reference)))
                if kind == "bootstrap-source-root" =>
            {
                root_forms.push((name.clone(), reference.clone()));
            }
            _ => {}
        }
    }
    fn transcribe(
        reference: &str,
        descriptors: &BTreeMap<String, Vec<String>>,
        roots: &BTreeMap<String, Node>,
        memo: &mut BTreeMap<String, Node>,
        transcriber: &mut Transcriber,
    ) -> Result<Node, String> {
        if let Some(name) = reference.strip_prefix('r') {
            return roots
                .get(name)
                .cloned()
                .ok_or_else(|| format!("unknown earlier lambda root {reference}"));
        }
        if let Some(node) = memo.get(reference) {
            return Ok(node.clone());
        }
        let descriptor = descriptors
            .get(reference)
            .ok_or_else(|| format!("unknown lambda source node {reference}"))?;
        let node = match descriptor.as_slice() {
            [kind, name] if kind == "variable" => tagged("variable", vec![transcriber.code(name)]),
            [kind, name, body] if kind == "lambda" => {
                let code = transcriber.code(name);
                let body = transcribe(body, descriptors, roots, memo, transcriber)?;
                tagged("lambda", vec![code, body])
            }
            [kind, left, right] if kind == "application" => {
                let left = transcribe(left, descriptors, roots, memo, transcriber)?;
                let right = transcribe(right, descriptors, roots, memo, transcriber)?;
                tagged("application", vec![left, right])
            }
            _ => return Err("invalid lambda source expression".into()),
        };
        memo.insert(reference.to_string(), node.clone());
        Ok(node)
    }
    let mut transcriber = Transcriber::default();
    let mut roots = BTreeMap::new();
    let mut memo = BTreeMap::new();
    let mut entries = Vec::new();
    for (name, reference) in &root_forms {
        let term = transcribe(reference, &descriptors, &roots, &mut memo, &mut transcriber)?;
        roots.insert(name.clone(), term.clone());
        entries.push(tagged("root-source", vec![atom(name), term]));
    }
    Ok(Transcription {
        roots: encode_list(entries),
        node_count: validated.node_count,
        root_count: validated.root_count,
        names: transcriber.codes.len(),
    })
}

fn split_origin(bits: &Node) -> Result<(String, String), String> {
    let text = decode_bits(bits)?;
    let (program, name) = text
        .split_once('\0')
        .ok_or("linked rule name lacks its program separator")?;
    Ok((program.to_string(), name.to_string()))
}
fn decode_proof(value: &Node) -> Result<LinkedProof, String> {
    let parts = tag(value, "proof", 4)?;
    let (program, rule) = split_origin(&parts[1])?;
    Ok(LinkedProof {
        judgement: decode_node(&parts[2])?,
        program,
        rule,
        premises: decode_list(&parts[3])?
            .iter()
            .map(decode_proof)
            .collect::<Result<_, _>>()?,
    })
}
fn optional_proof(value: &Node) -> Result<Option<LinkedProof>, String> {
    if value == &atom("none") {
        return Ok(None);
    }
    Ok(Some(decode_proof(&tag(value, "some", 2)?[1])?))
}

#[derive(Clone, Debug, PartialEq)]
pub struct Reduction {
    pub term: Node,
    pub trace: Vec<(String, String)>,
    pub steps: usize,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Proved {
    pub derivations: Vec<(Node, LinkedProof)>,
    pub proof: Option<LinkedProof>,
    pub absent_proof: Option<LinkedProof>,
    pub known: usize,
    pub steps: usize,
}

pub struct HornLinkSubstitution {
    resolver: HornResolution,
    transcription: Transcription,
    lambda_source_sha256: String,
    horn_source_sha256: String,
}

/// Bounds large enough for the shared workload; callers may lower them.
pub fn default_options() -> Options {
    Options {
        max_steps: DEFAULT_MAX_STEPS,
        max_depth: DEFAULT_MAX_DEPTH,
        capture_proof: false,
        ..Options::default()
    }
}

impl HornLinkSubstitution {
    pub fn new(lambda_source: &str) -> Result<Self, String> {
        Self::from_sources(lambda_source, SOURCE)
    }
    pub fn from_sources(lambda_source: &str, horn_source: &str) -> Result<Self, String> {
        let transcription = transcribe_lambda_source(lambda_source)?;
        let base = HornResolution::from_source(horn_source)?;
        let conversion = base.query(
            &Node::List(vec![
                atom("convert-roots"),
                transcription.roots.clone(),
                atom("?table"),
            ]),
            &default_options(),
        )?;
        let [answer] = conversion.answers.as_slice() else {
            return Err("linked binder resolution rejected the lambda source".into());
        };
        let Node::List(goal) = &answer.goal else {
            return Err("invalid linked binder resolution answer".into());
        };
        let mut clauses = base.clauses().to_vec();
        for entry in decode_list(goal.last().ok_or("empty binder resolution answer")?)? {
            let parts = tag(&entry, "root-term", 3)?;
            let Node::Leaf(name) = &parts[1] else {
                return Err("invalid linked root name".into());
            };
            clauses.push(Clause {
                name: format!("root-term-{name}"),
                head: entry.clone(),
                body: Vec::new(),
            });
        }
        Ok(Self {
            resolver: HornResolution::new(clauses)?,
            transcription,
            lambda_source_sha256: hex(lambda_source),
            horn_source_sha256: hex(horn_source),
        })
    }
    pub fn resolver(&self) -> &HornResolution {
        &self.resolver
    }
    fn run(&self, goal: Node, options: &Options) -> Result<(Node, usize), String> {
        let options = Options {
            capture_proof: false,
            ..options.clone()
        };
        let result = self.resolver.query(&goal, &options)?;
        let [answer] = result.answers.as_slice() else {
            return Err("linked Horn workflow has no answer within the declared search".into());
        };
        let Node::List(goal) = &answer.goal else {
            return Err("invalid linked Horn workflow answer".into());
        };
        Ok((goal.last().cloned().ok_or("empty Horn workflow answer")?, result.steps))
    }
    /// Evaluate a closed probe term (strings are opaque markers) to weak head form.
    pub fn evaluate(&self, term: &serde_json::Value, options: &Options) -> Result<Option<String>, String> {
        let term = Transcriber::default().json(term)?;
        let (value, _) = self.run(
            Node::List(vec![atom("evaluate-term"), term, atom("?result")]),
            options,
        )?;
        match &value {
            Node::List(parts) if parts.len() == 3 && parts[0] == atom("marked") && parts[2] == atom("end") => {
                match &parts[1] {
                    Node::Leaf(name) => Ok(Some(name.clone())),
                    Node::List(_) => Ok(None),
                }
            }
            _ => Ok(None),
        }
    }
    /// Reduce to normal form with the linked one-step rewrite root; fuel bounds the loop.
    pub fn reduce(
        &self,
        programs: &BTreeMap<String, LinkedProgram>,
        name: &str,
        input: &Node,
        fuel: usize,
        options: &Options,
    ) -> Result<Reduction, String> {
        let (value, steps) = self.run(
            Node::List(vec![
                atom("rml-reduce"),
                encode_programs(programs),
                encode_bits(name),
                encode_node(input, false),
                unary(fuel)?,
                atom("?result"),
            ]),
            options,
        )?;
        if value == atom("missing-program") {
            return Err(format!("linked-program {name} is missing"));
        }
        if value == atom("bound-exceeded") {
            return Err("Horn link-substitution reduction fuel exhausted".into());
        }
        let parts = tag(&value, "reduced", 3)?;
        Ok(Reduction {
            term: decode_node(&parts[1])?,
            trace: decode_list(&parts[2])?
                .iter()
                .map(split_origin)
                .collect::<Result<_, _>>()?,
            steps,
        })
    }
    /// Saturate inference and look up an exact proof and an absent judgement.
    pub fn prove(
        &self,
        programs: &BTreeMap<String, LinkedProgram>,
        name: &str,
        goal: &Node,
        absent: &Node,
        fuel: usize,
        options: &Options,
    ) -> Result<Proved, String> {
        let (value, steps) = self.run(
            Node::List(vec![
                atom("rml-prove"),
                encode_programs(programs),
                encode_bits(name),
                encode_node(goal, false),
                encode_node(absent, false),
                unary(fuel)?,
                atom("?result"),
            ]),
            options,
        )?;
        if value == atom("missing-program") {
            return Err(format!("linked-program {name} is missing"));
        }
        let parts = tag(&value, "proved", 5)?;
        let derivations = decode_list(&parts[2])?
            .iter()
            .map(|item| {
                let derived = tag(item, "derived", 3)?;
                Ok((decode_node(&derived[1])?, decode_proof(&derived[2])?))
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Proved {
            known: count_unary(&parts[1])? + derivations.len(),
            derivations,
            proof: optional_proof(&parts[3])?,
            absent_proof: optional_proof(&parts[4])?,
            steps,
        })
    }
    pub fn trust_report(&self) -> serde_json::Value {
        serde_json::json!({
            "schema": "rml-horn-link-substitution-trust/v1",
            "foundation": "first-order-horn-resolution",
            "upperSemantics": "unchanged lambda-link meta-semantics (fixed-point-source.lino schema)",
            "lambdaSourceSha256": self.lambda_source_sha256,
            "linkSubstitutionSourceSha256": self.horn_source_sha256,
            "linkedMechanisms": [
                "binder resolution (named lambda links to positional environment links)",
                "substitution by environment extension and closure entry",
                "variable lookup by positional environment links",
                "Scott value construction from linked roots",
                "observation of values by marker application",
                "reduce/prove workflow orchestration and fuel"
            ],
            "externalFoundationLaws": crate::horn_resolution::trust_report()["externalSemanticAuthority"].clone(),
            "externalBoundaryServices": [
                "lambda-source LiNo parsing, addressed-DAG validation and closed-root check",
                "injective per-source binder-name interning (equality preserving)",
                "caching of the linked binder-resolution answer as root facts",
                "first-order RML input encoding, UTF-8 bit decoding and program/rule-name splitting",
                "step/depth bounds, allocation, Rust runtime and processor"
            ],
            "roots": self.transcription.root_count,
            "sourceNodes": self.transcription.node_count,
            "internedNames": self.transcription.names,
            "bracketAbstraction": false,
            "combinatorContraction": false,
            "lambdaMachineHostBranches": false,
            "fullImplementationClosure": false
        })
    }
}

fn hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
