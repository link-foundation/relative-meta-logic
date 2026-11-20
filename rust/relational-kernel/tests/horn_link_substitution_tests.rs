use rml::lambda_kernel::{self as lambda, Kernel, KernelOptions};
use rml_relational::horn_link_substitution::{self as link, HornLinkSubstitution};
use rml_relational::horn_resolution::{Options, OPERATIONS};
use rml_relational::linked_program::{LinkedProgram, LinkedProgramRegistry, LinkedProof};
use rml_relational::Node;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const SOURCE: &str = include_str!("../../../lib/meta-theory/fixed-point-source.lino");
const WORKLOAD: &str = include_str!("../../../test-corpus/lambda-kernel/workload.lino");
const CASES: &str = include_str!("../../../test-corpus/lambda-kernel/cases.json");
const REPLACEMENTS: &str =
    include_str!("../../../test-corpus/kernel-replacement/mechanism-replacements.json");
const OBSERVATIONS: &str =
    include_str!("../../../test-corpus/kernel-replacement/mechanism-observations.json");
const LINK_REPLACEMENTS: &str =
    include_str!("../../../test-corpus/kernel-replacement/link-substitution-replacements.json");
const RESOLVER: &str = include_str!("../src/horn_resolution.rs");
const HOST: &str = include_str!("../src/horn_link_substitution.rs");

/// The linked machines allocate deep immutable environments; run each witness
/// on a thread whose stack is large enough to drop them recursively.
fn with_stack<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(512 * 1024 * 1024)
        .spawn(work)
        .unwrap()
        .join()
        .unwrap()
}
fn node(value: &Value) -> Node {
    match value {
        Value::String(value) => Node::Leaf(value.clone()),
        Value::Array(items) => Node::List(items.iter().map(node).collect()),
        _ => panic!("invalid shared fixture node"),
    }
}
fn node_json(node: &Node) -> Value {
    match node {
        Node::Leaf(value) => Value::String(value.clone()),
        Node::List(items) => Value::Array(items.iter().map(node_json).collect()),
    }
}
fn proof_json(proof: &LinkedProof) -> Value {
    json!({
        "judgement": node_json(&proof.judgement),
        "program": proof.program,
        "rule": proof.rule,
        "premises": proof.premises.iter().map(proof_json).collect::<Vec<_>>(),
    })
}
fn optional_proof_json(proof: &Option<LinkedProof>) -> Value {
    proof.as_ref().map(proof_json).unwrap_or(Value::Null)
}
fn programs() -> BTreeMap<String, LinkedProgram> {
    let registry = LinkedProgramRegistry::from_rml(WORKLOAD).unwrap();
    registry
        .names()
        .iter()
        .map(|name| (name.to_string(), registry.program(name).unwrap().clone()))
        .collect()
}

/// Mirrors `applyLinkedSourceReplacement` in mechanism-matrix.mjs.
fn apply_replacement(text: &str, replacement: &Value) -> Result<String, String> {
    let start = text.find("(node-count ").ok_or("linked source lacks one node-count declaration")?;
    let end = start + text[start..].find(')').ok_or("invalid node-count declaration")?;
    let declared = &text[start..=end];
    if text.matches(declared).count() != 1 {
        return Err("linked source lacks one node-count declaration".into());
    }
    let count: usize = declared["(node-count ".len()..declared.len() - 1]
        .parse()
        .map_err(|_| "invalid node-count declaration")?;
    let mut changed = text.to_string();
    for edit in replacement["replace"].as_array().unwrap() {
        let [node, before, after] = [0, 1, 2].map(|index| edit[index].as_str().unwrap());
        let original = format!("(bootstrap-source-node {node} {before})");
        if changed.matches(&original).count() != 1 {
            return Err(format!(
                "replacement {} no longer matches {node}",
                replacement["id"].as_str().unwrap()
            ));
        }
        changed = changed.replacen(&original, &format!("(bootstrap-source-node {node} {after})"), 1);
    }
    let added = replacement["add"].as_array().unwrap();
    changed = changed.replacen(declared, &format!("(node-count {})", count + added.len()), 1);
    for item in added {
        changed.push_str(&format!(
            "(bootstrap-source-node {} {})\n",
            item[0].as_str().unwrap(),
            item[1].as_str().unwrap()
        ));
    }
    Ok(changed)
}

fn lambda_observations(text: &str) -> Value {
    let run = || -> Result<Value, String> {
        let cases: Value = serde_json::from_str(CASES).unwrap();
        let kernel = Kernel::from_source(text)?;
        let disabled = BTreeSet::new();
        let options = KernelOptions {
            kernel: Some(&kernel),
            disabled: &disabled,
            max_transitions: 100_000_000,
        };
        let programs = programs();
        let mut reductions = Vec::new();
        for case in cases["reductions"].as_array().unwrap() {
            let rules = lambda::resolve_rewrites(&programs, case["program"].as_str().unwrap(), options)?;
            let mut term = node(&case["input"]);
            let mut trace = Vec::new();
            let mut finished = false;
            for _ in 0..16 {
                match lambda::rewrite_once(&term, &rules, options)?.step {
                    None => {
                        finished = true;
                        break;
                    }
                    Some((output, program, rule)) => {
                        term = output;
                        trace.push(json!({"program": program, "name": rule}));
                    }
                }
            }
            if !finished {
                return Err("workload reduction bound exceeded".into());
            }
            reductions.push(json!({"name": case["name"], "term": node_json(&term), "trace": trace}));
        }
        let mut state = lambda::create_proof_state(&programs, "proof", &[], options)?.state;
        let mut derivations = Vec::new();
        let mut fixed_point = false;
        for _ in 0..8 {
            let result = lambda::infer_once(state, options)?;
            state = result.state;
            match result.derivation {
                None => {
                    fixed_point = true;
                    break;
                }
                Some((judgement, proof)) => derivations
                    .push(json!({"judgement": node_json(&judgement), "proof": proof_json(&proof)})),
            }
        }
        if !fixed_point {
            return Err("workload inference bound exceeded".into());
        }
        let proof = lambda::find_proof(&state, &node(&cases["goal"]), options)?.proof;
        let absent = lambda::find_proof(&state, &node(&cases["absentGoal"]), options)?.proof;
        Ok(json!({
            "reductions": reductions, "derivations": derivations,
            "proof": optional_proof_json(&proof), "absentProof": optional_proof_json(&absent),
            "known": state.size, "fixedPoint": fixed_point,
        }))
    };
    run().unwrap_or_else(|error| json!({"error": error}))
}

fn horn_observations(text: &str, horn_source: &str) -> Value {
    let run = || -> Result<Value, String> {
        let cases: Value = serde_json::from_str(CASES).unwrap();
        let kernel = HornLinkSubstitution::from_sources(text, horn_source)?;
        let options = link::default_options();
        let programs = programs();
        let mut reductions = Vec::new();
        for case in cases["reductions"].as_array().unwrap() {
            let result = kernel.reduce(
                &programs,
                case["program"].as_str().unwrap(),
                &node(&case["input"]),
                16,
                &options,
            )?;
            let trace = result
                .trace
                .iter()
                .map(|(program, name)| json!({"program": program, "name": name}))
                .collect::<Vec<_>>();
            reductions.push(json!({"name": case["name"], "term": node_json(&result.term), "trace": trace}));
        }
        let proved = kernel.prove(
            &programs,
            cases["program"].as_str().unwrap(),
            &node(&cases["goal"]),
            &node(&cases["absentGoal"]),
            8,
            &options,
        )?;
        let derivations = proved
            .derivations
            .iter()
            .map(|(judgement, proof)| json!({"judgement": node_json(judgement), "proof": proof_json(proof)}))
            .collect::<Vec<_>>();
        Ok(json!({
            "reductions": reductions, "derivations": derivations,
            "proof": optional_proof_json(&proved.proof), "absentProof": optional_proof_json(&proved.absent_proof),
            "known": proved.known, "fixedPoint": true,
        }))
    };
    run().unwrap_or_else(|error| json!({"error": error}))
}

fn replace_clauses(text: &str, replacement: &Value) -> Result<String, String> {
    let mut changed = text.to_string();
    for edit in replacement["replace"].as_array().unwrap() {
        let before = edit[0].as_str().unwrap();
        if changed.matches(before).count() != 1 {
            return Err(format!("stale linked clause in {}", replacement["id"].as_str().unwrap()));
        }
        changed = changed.replacen(before, edit[1].as_str().unwrap(), 1);
    }
    Ok(changed)
}
fn probe(kernel: &HornLinkSubstitution, term: &Value) -> Value {
    let options = Options {
        max_steps: 100_000,
        ..link::default_options()
    };
    match kernel.evaluate(term, &options) {
        Ok(Some(head)) => Value::String(head),
        Ok(None) => Value::Null,
        Err(error) if error == "Horn resolution step bound exceeded" => json!("bound-exceeded"),
        Err(error) => panic!("unexpected probe failure {error}"),
    }
}

#[test]
fn horn_foundation_executes_the_unchanged_lambda_link_meta_semantics_with_shared_observations() {
    with_stack(|| {
        let shared: Value = serde_json::from_str(OBSERVATIONS).unwrap();
        let cases: Value = serde_json::from_str(CASES).unwrap();
        let observed = horn_observations(SOURCE, link::SOURCE);
        assert_eq!(observed, shared["baseline"]);
        for (index, case) in cases["reductions"].as_array().unwrap().iter().enumerate() {
            assert_eq!(observed["reductions"][index]["term"], case["output"]);
        }
        assert_eq!(observed["proof"], cases["proof"]);
        assert_eq!(observed["absentProof"], Value::Null);
        assert_eq!(observed["known"], json!(3));
    });
}

#[test]
fn generic_horn_resolver_contains_none_of_the_linked_substitution_or_workflow_predicates() {
    for name in [
        "whnf", "environment-lookup", "resolve-binders", "scope-index", "machine-", "observe-2",
        "encode-node", "decode-node", "REWRITE_ONCE", "FIND_KNOWN_PROOF", "lambda", "closure",
    ] {
        assert!(!RESOLVER.contains(name), "generic resolver mentions {name}");
    }
    for name in ["whnf", "environment-lookup", "scope-index", "machine-", "observe-2", "REWRITE_ONCE"] {
        assert!(!HOST.contains(name), "codec host mentions {name}");
    }
    let report = with_stack(|| HornLinkSubstitution::new(SOURCE).unwrap().trust_report());
    assert_eq!(report["bracketAbstraction"], json!(false));
    assert_eq!(report["combinatorContraction"], json!(false));
    assert_eq!(report["lambdaMachineHostBranches"], json!(false));
    assert_eq!(report["fullImplementationClosure"], json!(false));
    assert_eq!(report["roots"], json!(25));
    assert_eq!(report["linkedMechanisms"].as_array().unwrap().len(), 6);
}

#[test]
fn linked_binder_resolution_and_machine_obey_lexical_scope_and_call_by_name() {
    with_stack(|| {
        let fixture: Value = serde_json::from_str(LINK_REPLACEMENTS).unwrap();
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        for item in fixture["probes"].as_array().unwrap() {
            let name = item["name"].as_str().unwrap();
            assert_eq!(probe(&kernel, &item["term"]), fixture["baseline"][name], "{name}");
        }
    });
}

#[test]
fn replacing_linked_link_substitution_clauses_changes_execution_on_the_unchanged_resolver() {
    with_stack(|| {
        let fixture: Value = serde_json::from_str(LINK_REPLACEMENTS).unwrap();
        let original = HornLinkSubstitution::new(SOURCE).unwrap();
        for replacement in fixture["replacements"].as_array().unwrap() {
            let horn_source = replace_clauses(link::SOURCE, replacement).unwrap();
            assert_ne!(horn_source, link::SOURCE);
            let changed = HornLinkSubstitution::from_sources(SOURCE, &horn_source).unwrap();
            let mut observed = serde_json::Map::new();
            for item in fixture["probes"].as_array().unwrap() {
                observed.insert(item["name"].as_str().unwrap().to_string(), probe(&changed, &item["term"]));
            }
            let observed = Value::Object(observed);
            assert_eq!(observed, replacement["probes"], "{}", replacement["id"]);
            assert_ne!(observed, fixture["baseline"], "{}", replacement["id"]);
        }
        for item in fixture["probes"].as_array().unwrap() {
            let name = item["name"].as_str().unwrap();
            assert_eq!(probe(&original, &item["term"]), fixture["baseline"][name]);
        }
    });
}

#[test]
fn open_probe_terms_stale_clause_edits_and_removed_linked_clauses_are_rejected() {
    with_stack(|| {
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        let options = link::default_options();
        assert!(kernel
            .evaluate(&json!({"variable": "free"}), &options)
            .unwrap_err()
            .contains("no answer"));
        assert!(kernel
            .evaluate(&json!({"lambda": "x", "body": {"variable": "y"}}), &options)
            .unwrap_err()
            .contains("no answer"));
        assert!(replace_clauses(
            link::SOURCE,
            &json!({"id": "stale", "replace": [["(horn-clause missing (missing))", ""]]})
        )
        .unwrap_err()
        .contains("stale linked clause"));
        let without_lookup = link::SOURCE.replace(
            "(horn-clause lookup-here (environment-lookup zero (cons ?closure ?environment) ?closure))",
            "",
        );
        assert_ne!(without_lookup, link::SOURCE);
        let broken = HornLinkSubstitution::from_sources(SOURCE, &without_lookup).unwrap();
        let bounded = Options {
            max_steps: 2_000_000,
            ..link::default_options()
        };
        let error = broken
            .reduce(&programs(), "rules", &node(&json!(["choose", "a"])), 16, &bounded)
            .unwrap_err();
        assert!(error.contains("no answer") || error.contains("step bound"), "{error}");
        let without_binders =
            link::SOURCE.replace("(horn-clause scope-here (scope-choice yes ?name ?scope zero))", "");
        assert!(HornLinkSubstitution::from_sources(SOURCE, &without_binders)
            .err()
            .unwrap()
            .contains("binder resolution rejected"));
        assert!(kernel
            .reduce(&programs(), "missing", &node(&json!(["choose", "a"])), 16, &options)
            .unwrap_err()
            .contains("missing"));
        assert!(kernel
            .reduce(&programs(), "rules", &node(&json!(["choose", "a"])), 5000, &options)
            .unwrap_err()
            .contains("fuel"));
    });
}

#[test]
fn each_generic_horn_operation_is_required_by_the_linked_substitution_workflow() {
    with_stack(|| {
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        for operation in OPERATIONS {
            let options = Options {
                disabled: BTreeSet::from([operation.to_string()]),
                ..link::default_options()
            };
            let error = kernel
                .reduce(&programs(), "rules", &node(&json!(["choose", "a"])), 16, &options)
                .unwrap_err();
            assert_eq!(error, format!("disabled host semantic operation {operation}"));
        }
        let bounded = Options {
            max_steps: 1000,
            ..link::default_options()
        };
        assert!(kernel
            .reduce(&programs(), "rules", &node(&json!(["choose", "a"])), 16, &bounded)
            .unwrap_err()
            .contains("step bound"));
    });
}

#[test]
fn linked_mechanism_replacements_change_lambda_and_horn_execution_identically() {
    with_stack(|| {
        let matrix: Value = serde_json::from_str(REPLACEMENTS).unwrap();
        let shared: Value = serde_json::from_str(OBSERVATIONS).unwrap();
        assert_eq!(lambda_observations(SOURCE), shared["baseline"]);
        let levels = matrix["replacements"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["level"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            levels,
            [
                "matching",
                "substitution",
                "rule-selection-and-application",
                "definition-import-and-rebinding",
                "verification"
            ]
        );
        for (index, replacement) in matrix["replacements"].as_array().unwrap().iter().enumerate() {
            let changed = apply_replacement(SOURCE, replacement).unwrap();
            let expected = &shared["rows"][index];
            assert_eq!(expected["id"], replacement["id"]);
            let lambda = lambda_observations(&changed);
            let horn = horn_observations(&changed, link::SOURCE);
            assert_eq!(lambda, expected["observations"], "{}", replacement["id"]);
            assert_eq!(horn, expected["observations"], "{}", replacement["id"]);
            assert_ne!(lambda, shared["baseline"], "{}", replacement["id"]);
        }
    });
}

#[test]
fn stale_or_open_mechanism_replacements_are_rejected() {
    with_stack(|| {
        let matrix: Value = serde_json::from_str(REPLACEMENTS).unwrap();
        let first = &matrix["replacements"][0];
        let stale = SOURCE.replace("(lambda previous n752)", "(lambda previous n751)");
        assert!(apply_replacement(&stale, first)
            .unwrap_err()
            .contains("no longer matches n753"));
        assert!(apply_replacement(&SOURCE.replace("(node-count 1446)", ""), first)
            .unwrap_err()
            .contains("node-count"));
        let open = json!({"id": "open",
            "replace": [["n753", "(lambda previous n752)", "(lambda previous n1446)"]],
            "add": [["n1446", "(variable unbound-name)"]]});
        let changed = apply_replacement(SOURCE, &open).unwrap();
        assert!(Kernel::from_source(&changed).unwrap_err().contains("unbound"));
        assert!(lambda_observations(&changed)["error"].as_str().unwrap().contains("unbound"));
        assert!(horn_observations(&changed, link::SOURCE)["error"]
            .as_str()
            .unwrap()
            .contains("unbound"));
    });
}
