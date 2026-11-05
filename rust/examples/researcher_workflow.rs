//! Run a researcher lifecycle through the public Rust APIs.
use rml::address_sequence::AddressSequence;
use rml::foundation_packages::{
    FoundationPackages, LinkedFoundationPackage, PackageResult, PackageSelection,
};
use rml::foundation_workspace::{FoundationBounds, FoundationChange, FoundationProof};
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::linked_proof::{replay_linked_proof, verify_linked_proof, LinkedProofOptions};
use rml::meta_language_support::{
    deserialize_rml_structure, emit_rml_from_structure, parse_rml_to_meta_language,
    serialize_rml_structure,
};
use rml::portable_natural::{
    evaluate_portable_natural, parse_portable_natural, translate_portable_natural,
};
use rml::semantic_archive::TypedSemanticArchive;
use rml::theory_network::TypedLinkNetwork;
use rml::upstream_language::{
    analyze_program, language_support, ProgramProjectContext, ProgramRepresentation,
    RepresentationLevel,
};
use rml::{key_of, Node};
use serde_json::{json, Value};

pub fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(items) => Node::List(items.iter().map(node).collect()),
        _ => panic!("workflow link data must contain only strings and lists"),
    }
}
fn value(term: &Node) -> Value {
    match term {
        Node::Leaf(text) => json!(text),
        Node::List(items) => Value::Array(items.iter().map(value).collect()),
    }
}
pub fn selection(version: &str) -> PackageSelection {
    PackageSelection {
        name: "review-policy".into(),
        version: version.into(),
        instance: "review".into(),
    }
}
pub fn packages() -> Vec<LinkedFoundationPackage> {
    [include_str!("../../test-corpus/researcher-workflow/foundation-one.lino"), include_str!("../../test-corpus/researcher-workflow/foundation-two.lino")].iter().enumerate().map(|(index, source)| {
        let version = (index + 1).to_string();
        LinkedFoundationPackage { name: "review-policy".into(), version: version.clone(), imports: vec![],
            source: format!("{source}\n{}\n(linked-instance review (theory submissions) (foundation review-policy (version {version})))", include_str!("../../test-corpus/researcher-workflow/theory.lino")) }
    }).collect()
}
pub fn proof_registry(basis: ExecutionBasis) -> Result<LinkedProgramRegistry, String> {
    LinkedProgramRegistry::from_rml_with_basis(
        &format!(
            "{}\n{}",
            include_str!("../../lib/meta-theory/universal.lino"),
            include_str!("../../lib/meta-theory/proof-verifier.lino")
        ),
        basis,
        &[],
    )
}
#[derive(Clone)]
struct Rule {
    id: String,
    premises: Vec<Node>,
    conclusion: Node,
}
fn variable(term: &Node) -> Value {
    match term {
        Node::Leaf(text) if text.starts_with('?') => json!(["variable", &text[1..]]),
        Node::Leaf(text) => json!(text),
        Node::List(items) => Value::Array(items.iter().map(variable).collect()),
    }
}
// Data-only binding extraction; every binding is independently checked by linked rules.
fn match_term(pattern: &Node, term: &Node, bindings: &mut Vec<(String, Node)>) -> bool {
    match (pattern, term) {
        (Node::Leaf(name), _) if name.starts_with('?') => {
            if let Some((_, previous)) = bindings.iter().find(|(key, _)| key == name) {
                previous == term
            } else {
                bindings.push((name.clone(), term.clone()));
                true
            }
        }
        (Node::Leaf(left), Node::Leaf(right)) => left == right,
        (Node::List(left), Node::List(right)) if left.len() == right.len() => left
            .iter()
            .zip(right)
            .all(|(a, b)| match_term(a, b, bindings)),
        _ => false,
    }
}
fn visit(
    proof: &FoundationProof,
    answer: &PackageResult,
    rules: &[Rule],
    nodes: &mut Vec<Value>,
) -> Result<(String, Vec<String>), String> {
    let index = nodes.len();
    let id = format!("n{index}");
    nodes.push(Value::Null);
    let origin = answer
        .programs
        .iter()
        .find(|item| item.address == proof.program)
        .ok_or("proof program is outside selected source")?;
    let rule = rules
        .iter()
        .find(|item| item.id == format!("{}.{}", origin.program, proof.rule))
        .ok_or("proof rule is absent from selected source")?;
    if rule.premises.len() != proof.premises.len() {
        return Err("proof premise count differs".into());
    }
    let mut bindings = vec![];
    for (pattern, premise) in rule.premises.iter().zip(&proof.premises) {
        if !match_term(pattern, &premise.judgement, &mut bindings) {
            return Err("proof premise needs unsupported conversion".into());
        }
    }
    let mut dependencies = vec![rule.id.clone()];
    let mut children = vec![];
    for child in &proof.premises {
        let (child_id, child_dependencies) = visit(child, answer, rules, nodes)?;
        children.push(child_id);
        for dependency in child_dependencies {
            if !dependencies.contains(&dependency) {
                dependencies.push(dependency);
            }
        }
    }
    let binding_values: Vec<_> = bindings
        .iter()
        .rev()
        .map(|(name, term)| json!([&name[1..], value(term)]))
        .collect();
    nodes[index] = json!([
        "node",
        id,
        rule.id,
        value(&proof.judgement),
        binding_values,
        children,
        dependencies
    ]);
    Ok((id, dependencies))
}
/// Export the same finite, assumption-free inductive certificate subset as the JS recipe.
/// This adapter does not decide acceptance; the linked verifier receives caller-owned context.
pub fn certificate(
    manifest: &LinkedFoundationPackage,
    answer: &PackageResult,
) -> Result<(Node, Node, Node), String> {
    if answer.package.name != manifest.name
        || answer.package.version != manifest.version
        || !answer.result.assumptions.is_empty()
        || answer.result.proof.is_none()
        || answer.result.cycle_policy.kind != "inductive"
        || !manifest.imports.is_empty()
    {
        return Err("certificate export requires a matching unimported inductive source and assumption-free proof".into());
    }
    let registry = LinkedProgramRegistry::from_rml_with_basis(
        &manifest.source,
        ExecutionBasis::DirectStructural,
        &[],
    )?;
    let mut rules = vec![];
    let forms: Vec<Value> = rml::parse_lino(&manifest.source)
        .map_err(|error| error.to_string())?
        .iter()
        .map(|form| rml::parse_one(&rml::tokenize_one(form)).map(|term| value(&term)))
        .collect::<Result<_, _>>()?;
    let foundation = forms
        .iter()
        .find(|form| {
            form[0] == "linked-foundation"
                && form[1] == manifest.name
                && form.as_array().is_some_and(|clauses| {
                    clauses
                        .iter()
                        .any(|clause| clause[0] == "version" && clause[1] == manifest.version)
                })
        })
        .ok_or("missing selected foundation")?;
    let instance = forms
        .iter()
        .find(|form| form[0] == "linked-instance" && form[1] == answer.result.instance)
        .ok_or("missing selected instance")?;
    let theory = instance
        .as_array()
        .unwrap()
        .iter()
        .find(|clause| clause[0] == "theory")
        .ok_or("missing theory clause")?;
    let selected = instance
        .as_array()
        .unwrap()
        .iter()
        .find(|clause| clause[0] == "foundation")
        .ok_or("missing foundation clause")?;
    if theory.as_array().map(Vec::len) != Some(2)
        || selected[1] != manifest.name
        || selected
            .as_array()
            .unwrap()
            .iter()
            .any(|clause| clause[0] == "version" && clause[1] != manifest.version)
        || foundation
            .as_array()
            .unwrap()
            .iter()
            .any(|clause| clause[0] == "depends-on")
    {
        return Err("certificate source needs a direct, unbound theory and foundation".into());
    }
    let mut permitted = vec![theory[1].as_str().ok_or("invalid theory")?.to_string()];
    for clause in foundation.as_array().unwrap() {
        if matches!(clause[0].as_str(), Some("axioms" | "inference" | "typing")) {
            permitted.push(clause[1].as_str().ok_or("invalid role")?.to_string());
        }
    }
    // Context is derived from caller-owned source, never claimed proof dependencies.
    // Retain declaration order, independently of host map enumeration.
    for form in &forms {
        if form[0] != "linked-program" {
            continue;
        }
        let name = form[1].as_str().ok_or("invalid program")?;
        if !permitted.iter().any(|item| item == name) {
            continue;
        }
        if form.as_array().map(Vec::len) != Some(2) {
            return Err("certificate source imports need an explicit exporter".into());
        }
        let program = registry.program(name).ok_or("missing program")?;
        for fact in &program.facts {
            rules.push(Rule {
                id: format!("{name}.{}", fact.name),
                premises: vec![],
                conclusion: fact.judgement.clone(),
            });
        }
        for inference in &program.inferences {
            rules.push(Rule {
                id: format!("{name}.{}", inference.name),
                premises: inference.premises.clone(),
                conclusion: inference.conclusion.clone(),
            });
        }
    }
    let context = json!([
        "proof-context",
        [manifest.name, manifest.version],
        rules
            .iter()
            .map(|rule| json!([
                "rule",
                rule.id,
                rule.premises.iter().map(variable).collect::<Vec<_>>(),
                variable(&rule.conclusion)
            ]))
            .collect::<Vec<_>>()
    ]);
    let mut nodes = vec![];
    let (root, dependencies) = visit(
        answer.result.proof.as_ref().unwrap(),
        answer,
        &rules,
        &mut nodes,
    )?;
    let goal = value(&answer.result.query);
    Ok((
        node(&context),
        node(&goal),
        node(&json!(["proof", context, goal, root, nodes, dependencies])),
    ))
}
pub fn construct_objects() -> Result<(Value, AddressSequence, TypedLinkNetwork), String> {
    let mut snapshot = TypedLinkNetwork::with_default_ontology().snapshot();
    for name in ["Submission", "SubmissionPair", "Set", "OrderedSet"] {
        snapshot
            .links
            .push((name.into(), "Type".into(), name.into()));
    }
    for (address, source, target) in [
        ("specimen", "specimen", "specimen"),
        ("archive", "archive", "archive"),
        ("submitted-edge", "specimen", "archive"),
    ] {
        snapshot
            .links
            .push((address.into(), source.into(), target.into()));
    }
    let mut typed = TypedLinkNetwork::from_snapshot(&snapshot, true)?;
    for name in ["Submission", "SubmissionPair", "Set", "OrderedSet"] {
        typed.declare(name, "Type")?;
    }
    typed.declare("specimen", "Submission")?;
    typed.declare("archive", "Submission")?;
    typed.declare("submitted-edge", "SubmissionPair")?;
    let mut collections = AddressSequence::new("research-collections")?;
    for (address, source, target) in &typed.snapshot().links {
        collections.define_link(address, source, target)?;
    }
    let values = |input: &[&str]| input.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let set_root = collections.encode_set(
        &values(&["submitted-edge", "specimen", "submitted-edge"]),
        "accepted-objects",
        "balanced",
    )?;
    let nested_root = collections.encode_set(
        &[set_root.clone(), set_root.clone()],
        "collection-of-collections",
        "balanced",
    )?;
    let ordered_root = collections.encode_ordered_set(
        &values(&["submitted-edge", "specimen"]),
        "review-order",
        "balanced",
    )?;
    let mut combined = typed.snapshot();
    for row in collections.snapshot()["links"].as_array().unwrap() {
        let address = row["address"].as_str().unwrap();
        if typed.doublet(address).is_none() {
            combined.links.push((
                address.into(),
                row["source"].as_str().unwrap().into(),
                row["target"].as_str().unwrap().into(),
            ));
        }
    }
    typed = TypedLinkNetwork::from_snapshot(&combined, true)?;
    typed.declare(&set_root, "Set")?;
    typed.declare(&nested_root, "Set")?;
    typed.declare(&ordered_root, "OrderedSet")?;
    let roots = vec![
        set_root.clone(),
        nested_root.clone(),
        ordered_root.clone(),
        "submitted-edge".into(),
        "Submission".into(),
    ];
    let archive = TypedSemanticArchive::from_network(&typed, &roots)?;
    let mut restored =
        TypedSemanticArchive::deserialize(&archive.serialize()?)?.to_typed_network()?;
    restored.clear_type_index();
    let source_free = AddressSequence::from_snapshot(&collections.snapshot())?;
    let edge = restored
        .doublet("submitted-edge")
        .ok_or("missing constructed edge")?;
    let summary = json!({"setRoot":set_root,"nestedRoot":nested_root,"orderedRoot":ordered_root,
        "setMembers":source_free.decode_set(&set_root, 10000, 100000)?, "nestedMembers":source_free.decode_set(&nested_root, 10000, 100000)?, "orderedMembers":source_free.decode_ordered_set(&ordered_root, 10000, 100000)?,
        "nestedDistinct":nested_root != set_root, "closed":restored.validate_closure().closed,
        "edge":{"source":edge.0,"target":edge.1},"edgeTypes":restored.types_of("submitted-edge"),"setTypes":restored.types_of(&set_root)});
    Ok((summary, source_free, restored))
}
pub fn execute_algorithm(
    workspace: &FoundationPackages,
    members: &[Value],
) -> Result<rml::foundation_packages::PackageExecution, String> {
    let mut list = node(&json!("nil"));
    for member in members.iter().rev() {
        list = Node::List(vec![node(&json!("cons")), node(member), list]);
    }
    workspace.execute(
        &selection("1"),
        &Node::List(vec![node(&json!("length")), list]),
        10_000,
    )
}

pub fn run(basis: ExecutionBasis) -> Result<Value, String> {
    let manifests: Vec<_> = packages()
        .into_iter()
        .map(|mut manifest| {
            let snapshot = serialize_rml_structure(&parse_rml_to_meta_language(&manifest.source))
                .map_err(|e| e.to_string())?;
            manifest.source = emit_rml_from_structure(&deserialize_rml_structure(&snapshot)?)
                .map_err(|e| e.to_string())?;
            Ok(manifest)
        })
        .collect::<Result<_, String>>()?;
    let workspace = FoundationPackages::from_packages_with_basis(&manifests, basis)?;
    let query = node(&json!(["publishable", "specimen"]));
    let first = workspace.ask(&selection("1"), &query, &[], FoundationBounds::default())?;
    let second = workspace.ask(&selection("2"), &query, &[], FoundationBounds::default())?;
    let (context, goal, candidate) = certificate(&manifests[0], &first)?;
    let options = LinkedProofOptions::default();
    let receipt = verify_linked_proof(
        &proof_registry(basis)?,
        &context,
        &goal,
        &candidate,
        &options,
    )?;
    let replay = replay_linked_proof(&proof_registry(basis)?, &context, &goal, &receipt, &options)?;
    let (objects, _, _) = construct_objects()?;
    let execution = execute_algorithm(&workspace, objects["setMembers"].as_array().unwrap())?;
    let revision = workspace.revise(
        &[first.clone(), second.clone()],
        &selection("1"),
        &FoundationChange::ReplaceRule(node(&json!([
            "linked-fact",
            "submissions",
            "submitted",
            ["judgement", ["input", "other"]]
        ]))),
    )?;
    let sources: Vec<Value> = serde_json::from_str(include_str!(
        "../../test-corpus/researcher-workflow/languages.json"
    ))
    .map_err(|e| e.to_string())?;
    let mut languages = vec![];
    let mut translations = vec![];
    for item in &sources {
        let language = item["language"].as_str().unwrap();
        let source = item["source"].as_str().unwrap();
        let program = analyze_program(source, language, ProgramProjectContext::default())
            .map_err(|e| e.to_string())?;
        let exported = ProgramRepresentation::from_snapshot(&program.serialize_snapshot())
            .map_err(|e| e.to_string())?
            .emit();
        let unavailable = language_support(language).unwrap().type_elaboration
            == RepresentationLevel::Unavailable;
        languages.push(json!({"language":language,"sourcePreserved":exported == source,"syntaxClean":program.network().verify_full_match(None).is_clean(),"typeElaboration":if unavailable {"unavailable"} else {"represented"}}));
        for target in &sources {
            let to = target["language"].as_str().unwrap();
            if to == language {
                continue;
            }
            let result = translate_portable_natural(source, language, to);
            let translated = result
                .target_source
                .as_ref()
                .ok_or_else(|| format!("{:?}", result.obligations))?;
            let imported = parse_portable_natural(translated, to).map_err(|e| e.to_string())?;
            let observation = evaluate_portable_natural(&imported, "successor", &[7])
                .map_err(|e| e.to_string())?;
            translations.push(json!({"from":language,"to":to,"status":result.status,"observation":observation.to_string(),"verification":result.stages["verification"]}));
        }
    }
    let candidate_value = value(&candidate);
    Ok(json!({
        "schema":"rml-researcher-workflow/v1", "executionBasis":match basis { ExecutionBasis::DirectStructural => "direct-structural", ExecutionBasis::ClosedSk => "s-k", _ => "unsupported" },
        "foundations":workspace.packages().iter().map(|item| json!({"name":item.name,"version":item.version})).collect::<Vec<_>>(),
        "theory":first.result.theory.name,"assumptions":first.result.assumptions.iter().map(value).collect::<Vec<_>>(),"objects":objects,
        "comparison":[{"version":"1","status":first.result.status},{"version":"2","status":second.result.status}],
        "proof":{"accepted":receipt.accepted,"replayMatches":replay.matches,"dependencies":candidate_value[5],"nodes":candidate_value[4].as_array().unwrap().len()},
        "execution":{"status":execution.result.status,"output":key_of(execution.result.output.as_ref().ok_or("execution stopped")?)},
        "invalidation":revision.revisions.iter().map(|item| json!({"action":item.action,"changed":item.changed,"status":item.after.result.status})).collect::<Vec<_>>(),
        "originalStatus":workspace.ask(&selection("1"), &query, &[], FoundationBounds::default())?.result.status,
        "languages":languages,"translations":translations,
    }))
}
#[allow(dead_code)]
fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let basis = match args.as_slice() {
        [] => ExecutionBasis::ClosedSk,
        [arg] if arg == "--direct" => ExecutionBasis::DirectStructural,
        _ => return Err("Usage: researcher_workflow [--direct]".into()),
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&run(basis)?).map_err(|e| e.to_string())?
    );
    Ok(())
}
