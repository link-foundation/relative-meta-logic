//! Mirrors js/tests/meta-foundation-comparison.test.mjs against the shared
//! report test-corpus/foundation-comparison/report.json.
use rml::linked_program::ExecutionBasis;
use rml_relational::horn_link_substitution::{self as link, HornLinkSubstitution};
use rml_relational::horn_resolution::{Clause, HornResolution, Options, LAWS};
use rml_relational::linked_program::{LinkedProgram, LinkedProgramRegistry, LinkedProof};
use rml_relational::relational_kernel::RelationalKernel;
use rml_relational::{parse_one, tokenize_one, Node};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const SOURCE: &str = include_str!("../../../lib/meta-theory/fixed-point-source.lino");
const WORKLOAD: &str = include_str!("../../../test-corpus/lambda-kernel/workload.lino");
const CASES: &str = include_str!("../../../test-corpus/lambda-kernel/cases.json");
const REPORT: &str = include_str!("../../../test-corpus/foundation-comparison/report.json");
const OBSERVATIONS: &str =
    include_str!("../../../test-corpus/kernel-replacement/mechanism-observations.json");
const SK_LAWS: &str = include_str!("../../../test-corpus/foundation-comparison/sk-laws.lino");
const RELATIONAL: &str = include_str!("../../../lib/meta-theory/relational-kernel.lino");
const REMOVAL_MARGIN: f64 = 1.1;

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
fn text(source: &str) -> Node {
    parse_one(&tokenize_one(source)).unwrap()
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
fn programs_of(source: &str) -> BTreeMap<String, LinkedProgram> {
    let registry = LinkedProgramRegistry::from_rml(source).unwrap();
    registry
        .names()
        .iter()
        .map(|name| (name.to_string(), registry.program(name).unwrap().clone()))
        .collect()
}
fn report() -> Value {
    serde_json::from_str(REPORT).unwrap()
}

#[derive(Clone, Default)]
struct Bounds {
    reduce: Vec<usize>,
    prove: usize,
}
/// The shared workload through the Horn link-substitution kernel; returns the
/// observations and the resolution steps each query used.
fn horn_workload(
    kernel: &HornLinkSubstitution,
    ablated: &[&str],
    bounds: Option<&Bounds>,
) -> Result<(Value, Bounds), String> {
    let cases: Value = serde_json::from_str(CASES).unwrap();
    let programs = programs_of(WORKLOAD);
    let base = Options {
        ablated: ablated.iter().map(|law| law.to_string()).collect(),
        ..link::default_options()
    };
    let mut steps = Bounds::default();
    let mut reductions = Vec::new();
    for (index, case) in cases["reductions"].as_array().unwrap().iter().enumerate() {
        let options = Options {
            max_steps: bounds.map(|b| b.reduce[index]).unwrap_or(base.max_steps),
            ..base.clone()
        };
        let result = kernel.reduce(
            &programs,
            case["program"].as_str().unwrap(),
            &node(&case["input"]),
            16,
            &options,
        )?;
        steps.reduce.push(result.steps);
        let trace = result
            .trace
            .iter()
            .map(|(program, name)| json!({"program": program, "name": name}))
            .collect::<Vec<_>>();
        reductions.push(json!({"name": case["name"], "term": node_json(&result.term), "trace": trace}));
    }
    let options = Options {
        max_steps: bounds.map(|b| b.prove).unwrap_or(base.max_steps),
        ..base.clone()
    };
    let proved = kernel.prove(
        &programs,
        cases["program"].as_str().unwrap(),
        &node(&cases["goal"]),
        &node(&cases["absentGoal"]),
        8,
        &options,
    )?;
    steps.prove = proved.steps;
    let optional = |proof: &Option<LinkedProof>| proof.as_ref().map(proof_json).unwrap_or(Value::Null);
    let derivations = proved
        .derivations
        .iter()
        .map(|(judgement, proof)| json!({"judgement": node_json(judgement), "proof": proof_json(proof)}))
        .collect::<Vec<_>>();
    Ok((
        json!({
            "reductions": reductions, "derivations": derivations,
            "proof": optional(&proved.proof), "absentProof": optional(&proved.absent_proof),
            "known": proved.known, "fixedPoint": true,
        }),
        steps,
    ))
}
fn classify(result: Result<(Value, Bounds), String>, baseline: &Value) -> String {
    match result {
        Ok((observed, _)) if &observed == baseline => "PRESERVED".into(),
        Ok(_) => "CHANGED".into(),
        Err(error) if error.contains("disabled host semantic operation") => {
            "FAILED_DISABLED_OPERATION".into()
        }
        Err(error) if error.contains("step bound") => "FAILED_SEARCH_BOUND".into(),
        Err(error) if error.contains("depth bound") => "FAILED_DEPTH_BOUND".into(),
        Err(_) => "FAILED_NO_ANSWER".into(),
    }
}

#[test]
fn two_foundations_execute_one_byte_identical_upper_layer_with_the_same_observations() {
    let report = report();
    let digest: String = Sha256::digest(SOURCE.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(report["upperLayer"]["sha256"], json!(digest));
    let shared: Value = serde_json::from_str(OBSERVATIONS).unwrap();
    let cases: Value = serde_json::from_str(CASES).unwrap();
    let registry = LinkedProgramRegistry::from_rml(WORKLOAD).unwrap();
    for (index, case) in cases["reductions"].as_array().unwrap().iter().enumerate() {
        let result = registry
            .reduce(case["program"].as_str().unwrap(), &node(&case["input"]), 16)
            .unwrap();
        let expected = &shared["baseline"]["reductions"][index];
        assert_eq!(node_json(&result.term), expected["term"]);
        let trace = result
            .trace
            .iter()
            .map(|step| json!({"program": step.program, "name": step.rule}))
            .collect::<Vec<_>>();
        assert_eq!(Value::Array(trace), expected["trace"]);
    }
    let proof = registry
        .prove("proof", &node(&cases["goal"]), &[], 8, 16)
        .unwrap();
    assert_eq!(proof_json(&proof), shared["baseline"]["proof"]);
    assert!(registry
        .prove("proof", &node(&cases["absentGoal"]), &[], 8, 16)
        .is_none());
    let horn = with_stack(|| {
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        horn_workload(&kernel, &[], None).unwrap().0
    });
    assert_eq!(horn, shared["baseline"]);
    assert_eq!(report["foundations"]["closed-s-k"]["linkSubstitution"]["linked"], json!(false));
    assert_eq!(report["foundations"]["horn-resolution"]["linkSubstitution"]["linked"], json!(true));
}

#[test]
fn single_and_reduced_basis_law_removal_reproduces_the_recorded_minimality_table() {
    let report = report();
    let recorded = report["foundations"]["horn-resolution"]["removal"].clone();
    let removal = with_stack(move || {
        let shared: Value = serde_json::from_str(OBSERVATIONS).unwrap();
        let baseline = shared["baseline"].clone();
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        let (_, steps) = horn_workload(&kernel, &[], None).unwrap();
        let bound = |count: usize| (count as f64 * REMOVAL_MARGIN).ceil() as usize;
        let bounds = Bounds {
            reduce: steps.reduce.iter().map(|count| bound(*count)).collect(),
            prove: bound(steps.prove),
        };
        let run = |laws: &[&str]| classify(horn_workload(&kernel, laws, Some(&bounds)), &baseline);
        let single = LAWS
            .iter()
            .map(|law| (law.to_string(), run(&[*law])))
            .collect::<BTreeMap<_, _>>();
        let removable = LAWS
            .iter()
            .copied()
            .filter(|law| single[*law] == "PRESERVED")
            .collect::<Vec<_>>();
        let joint = run(&removable);
        let reduced = LAWS
            .iter()
            .copied()
            .filter(|law| !removable.contains(law))
            .map(|law| {
                let mut laws = removable.clone();
                laws.push(law);
                (law.to_string(), run(&laws))
            })
            .collect::<BTreeMap<_, _>>();
        (single, removable.iter().map(|law| law.to_string()).collect::<Vec<_>>(), joint, reduced)
    });
    let (single, removable, joint, reduced) = removal;
    for (law, result) in &single {
        let expected = recorded["singleRemoval"][law].as_str().unwrap();
        assert_eq!(result == "PRESERVED", expected == "PRESERVED", "{law}: {result} vs {expected}");
        assert!(result == "PRESERVED" || result.starts_with("FAILED"), "{law}: {result}");
    }
    assert_eq!(json!(removable), recorded["removable"]);
    assert_eq!(joint, "PRESERVED");
    for (law, result) in &reduced {
        assert_ne!(result, "PRESERVED", "{law}");
        assert!(result.starts_with("FAILED"), "{law}: {result}");
    }
    for operation in ["contract-s-link", "contract-k-link"] {
        let registry =
            LinkedProgramRegistry::from_rml_with_basis(WORKLOAD, ExecutionBasis::ClosedSk, &[operation])
                .unwrap();
        let error = registry
            .reduce("rules", &text("(choose a)"), 16)
            .unwrap_err();
        assert!(error.contains("disabled host semantic operation"), "{error}");
    }
}

#[test]
fn unknown_law_names_are_rejected_and_the_default_relation_is_unchanged() {
    let resolver = HornResolution::new(vec![Clause {
        name: "fact".into(),
        head: text("(p a)"),
        body: Vec::new(),
    }])
    .unwrap();
    let unknown = Options {
        ablated: BTreeSet::from(["not-a-law".to_string()]),
        ..Options::default()
    };
    assert!(resolver
        .query(&text("(p ?x)"), &unknown)
        .unwrap_err()
        .contains("unknown Horn law"));
    assert_eq!(
        resolver.query(&text("(p ?x)"), &Options::default()).unwrap().answers[0].goal,
        text("(p a)")
    );
    assert_eq!(LAWS.len(), 10);
    let no_decomposition = Options {
        ablated: BTreeSet::from(["constructor-decomposition".to_string()]),
        ..Options::default()
    };
    assert!(resolver
        .query(&text("(p ?x)"), &no_decomposition)
        .unwrap()
        .answers
        .is_empty());
}

#[test]
fn sk_laws_as_linked_rules_are_interpreted_on_both_foundations_and_a_replaced_k_law_changes_both() {
    let report = report();
    let changed = SK_LAWS.replace(
        "(linked-rewrite sk k (from ((K ?x) ?y)) (to ?x))",
        "(linked-rewrite sk k (from ((K ?x) ?y)) (to ?y))",
    );
    assert_ne!(changed, SK_LAWS);
    let inputs = ["(((S K) K) a)", "((K (K a)) b)", "(((S K) a) b)"];
    let expected_baseline = json!(["a", ["K", "a"], "b"]);
    let expected_replacement = json!([["K", "a"], "b", ["a", "b"]]);
    for (laws, expected) in [(SK_LAWS, &expected_baseline), (changed.as_str(), &expected_replacement)] {
        let registry = LinkedProgramRegistry::from_rml(laws).unwrap();
        let sk = inputs
            .iter()
            .map(|input| node_json(&registry.reduce("sk", &text(input), 10_000).unwrap().term))
            .collect::<Vec<_>>();
        assert_eq!(&Value::Array(sk), expected);
        let laws = laws.to_string();
        let horn = with_stack(move || {
            let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
            let programs = programs_of(&laws);
            inputs
                .iter()
                .map(|input| {
                    node_json(
                        &kernel
                            .reduce(&programs, "sk", &text(input), 16, &link::default_options())
                            .unwrap()
                            .term,
                    )
                })
                .collect::<Vec<_>>()
        });
        assert_eq!(&Value::Array(horn), expected);
    }
    assert_eq!(report["foundations"]["closed-s-k"]["selfInterpretation"]["baseline"], expected_baseline);
    assert_eq!(report["foundations"]["horn-resolution"]["selfInterpretation"]["replacement"], expected_replacement);
}

#[test]
fn quoted_linked_horn_interpreter_runs_the_linked_substitution_clauses_and_regenerates_its_image() {
    with_stack(|| {
        let kernel = RelationalKernel::from_source(&format!("{RELATIONAL}\n{}", link::SOURCE)).unwrap();
        let cases = [
            ("(code-equal (zero end) (zero end) ?out)", "yes"),
            ("(code-equal (zero end) (one end) ?out)", "no"),
            (
                "(evaluate-term (application (application (lambda (zero end) (lambda (one end) (variable (zero end)))) (marker outer)) (marker inner)) ?out)",
                "(marked outer end)",
            ),
            (
                "(evaluate-term (application (application (lambda (zero end) (lambda (zero end) (variable (zero end)))) (marker outer)) (marker inner)) ?out)",
                "(marked inner end)",
            ),
        ];
        let options = Options {
            max_steps: 100_000_000,
            max_depth: 10_000_000,
            capture_proof: false,
            ..Options::default()
        };
        for (goal, expected) in cases {
            let expected = if expected.starts_with('(') { text(expected) } else { Node::Leaf(expected.into()) };
            let interpreted = kernel.self_query(&text(goal), &options).unwrap();
            let Node::List(parts) = interpreted else { panic!("invalid interpreted answer") };
            assert_eq!(parts.last().unwrap(), &expected, "{goal}");
            let direct = kernel.run_query(&text(goal), &options).unwrap();
            let Node::List(parts) = &direct.answers[0].goal else { panic!("invalid direct answer") };
            assert_eq!(parts.last().unwrap(), &expected, "{goal}");
        }
        let image = kernel.describe_program();
        let described = kernel
            .call("describe-program", vec![image.clone()], &options)
            .unwrap()
            .value;
        let generated = kernel
            .call("generate-program", vec![described], &options)
            .unwrap()
            .value;
        assert_eq!(generated, image);
    });
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Combinator {
    Leaf(&'static str),
    App(Box<Combinator>, Box<Combinator>),
}
fn combinators(leaves: &[&'static str], size: usize) -> Vec<Combinator> {
    if size == 1 {
        return leaves.iter().map(|leaf| Combinator::Leaf(*leaf)).collect();
    }
    let mut out = Vec::new();
    for left in 1..size {
        for f in combinators(leaves, left) {
            for a in combinators(leaves, size - left) {
                out.push(Combinator::App(Box::new(f.clone()), Box::new(a)));
            }
        }
    }
    out
}
/// Every contraction at every redex position, each position once.
fn successors(term: &Combinator, s: &str, k: &str) -> Vec<Combinator> {
    let Combinator::App(f, a) = term else { return Vec::new() };
    let mut out = Vec::new();
    if let Combinator::App(head, x) = f.as_ref() {
        if matches!(head.as_ref(), Combinator::Leaf(name) if *name == k) {
            out.push(x.as_ref().clone());
        }
        if let Combinator::App(inner, sx) = head.as_ref() {
            if matches!(inner.as_ref(), Combinator::Leaf(name) if *name == s) {
                let app = |l: &Combinator, r: &Combinator| Combinator::App(Box::new(l.clone()), Box::new(r.clone()));
                out.push(app(&app(sx.as_ref(), a.as_ref()), &app(x.as_ref(), a.as_ref())));
            }
        }
    }
    for left in successors(f, s, k) {
        out.push(Combinator::App(Box::new(left), a.clone()));
    }
    for right in successors(a, s, k) {
        out.push(Combinator::App(f.clone(), Box::new(right)));
    }
    out
}
fn explore(s: &'static str, k: &'static str, max_leaves: usize, max_states: usize) -> Value {
    let (mut terms, mut explored, mut branching, mut max_normal_forms) = (0, 0, 0, 0);
    for size in 1..=max_leaves {
        for term in combinators(&[s, k, "x"], size) {
            terms += 1;
            let mut seen = BTreeSet::from([term.clone()]);
            let mut pending = vec![term];
            let mut normal = BTreeSet::new();
            let mut complete = true;
            while let Some(state) = pending.pop() {
                let next = successors(&state, s, k);
                if next.len() > 1 {
                    branching += 1;
                }
                if next.is_empty() {
                    normal.insert(state.clone());
                }
                for successor in next {
                    if seen.contains(&successor) {
                        continue;
                    }
                    if seen.len() >= max_states {
                        complete = false;
                        break;
                    }
                    seen.insert(successor.clone());
                    pending.push(successor);
                }
                if !complete {
                    break;
                }
            }
            if !complete {
                continue;
            }
            explored += 1;
            max_normal_forms = max_normal_forms.max(normal.len());
        }
    }
    json!({"leaves": max_leaves, "terms": terms, "explored": explored,
        "branchingStates": branching, "maxNormalForms": max_normal_forms, "failureStates": false})
}

#[test]
fn lockstep_criterion_separates_horn_from_sk_but_not_a_renamed_sk_control() {
    let report = report();
    let sk = explore("S", "K", 6, 256);
    let renamed = explore("S-renamed", "K-renamed", 6, 256);
    assert_eq!(sk, report["nonEquivalence"]["sk"]);
    assert_eq!(renamed, report["nonEquivalence"]["renamed"]);
    assert_eq!(sk["maxNormalForms"], json!(1));
    assert!(sk["branchingStates"].as_u64().unwrap() > 0);
    let resolver = HornResolution::new(vec![
        Clause { name: "left".into(), head: text("(choice left)"), body: Vec::new() },
        Clause { name: "right".into(), head: text("(choice right)"), body: Vec::new() },
    ])
    .unwrap();
    let options = Options {
        max_answers: 8,
        capture_proof: false,
        ..Options::default()
    };
    let branching = resolver.query(&text("(choice ?x)"), &options).unwrap();
    let answers = branching
        .answers
        .iter()
        .map(|answer| answer.goal.clone())
        .collect::<Vec<_>>();
    assert_eq!(answers, vec![text("(choice left)"), text("(choice right)")]);
    let failing = resolver.query(&text("(choice middle)"), &options).unwrap();
    assert!(failing.answers.is_empty() && failing.exhausted);
    assert_eq!(report["nonEquivalence"]["horn"]["distinctAnswers"], json!(2));
    let classes = report["nonEquivalence"]["pairs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| pair["classification"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(classes, ["NOT_A_LOCKSTEP_RE_ENCODING", "RE_ENCODING_NOT_EXCLUDED"]);
}

#[test]
fn report_keeps_the_full_closure_gate_open_and_claims_no_ranking_or_global_minimality() {
    let report = report();
    assert_eq!(report["gate"]["genuinelyDifferentFoundations"], json!(2));
    assert_eq!(report["gate"]["r149Satisfied"], json!(false));
    assert_eq!(report["globalMinimalityClaimed"], json!(false));
    assert_eq!(report["rankingClaimed"], json!(false));
    assert!(report["gate"]["openReasons"].as_array().unwrap().len() >= 4);
}
