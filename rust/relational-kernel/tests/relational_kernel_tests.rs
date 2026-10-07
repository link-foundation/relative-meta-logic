use rml_relational::horn_resolution::{HornResolution, Options, OPERATIONS};
use rml_relational::linked_program::{LinkedProgram, LinkedProgramRegistry, LinkedProof};
use rml_relational::relational_kernel::{self as rel, RelationalKernel, SOURCE};
use rml_relational::{parse_one, tokenize_one, Node};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
const WORKLOAD: &str = include_str!("../../../test-corpus/relational-kernel/workload.lino");
const CASES: &str = include_str!("../../../test-corpus/relational-kernel/cases.json");
fn term(source: &str) -> Node {
    if source.starts_with('(') {
        parse_one(&tokenize_one(source)).unwrap()
    } else {
        Node::Leaf(source.to_string())
    }
}
fn node(value: &Value) -> Node {
    match value {
        Value::String(value) => Node::Leaf(value.clone()),
        Value::Array(items) => Node::List(items.iter().map(node).collect()),
        _ => panic!("invalid fixture node"),
    }
}
fn parts(node: &Node) -> &[Node] {
    let Node::List(items) = node else {
        panic!("expected list")
    };
    items
}
fn programs() -> BTreeMap<String, LinkedProgram> {
    let r = LinkedProgramRegistry::from_rml(WORKLOAD).unwrap();
    r.names()
        .iter()
        .map(|name| (name.to_string(), r.program(name).unwrap().clone()))
        .collect()
}
fn proof(value: &Value) -> LinkedProof {
    LinkedProof {
        judgement: node(&value["judgement"]),
        program: value["program"].as_str().unwrap().into(),
        rule: value["rule"].as_str().unwrap().into(),
        premises: value["premises"]
            .as_array()
            .unwrap()
            .iter()
            .map(proof)
            .collect(),
    }
}
fn replacement() -> String {
    SOURCE.replace("(horn-clause substitute-head (substitute-items (cons ?head ?tail) ?environment (cons ?result ?rest))\n  (substitute ?head ?environment ?result) (substitute-items ?tail ?environment ?rest))",
    "(horn-clause substitute-head (substitute-items (cons ?head ?tail) ?environment ?output)\n  (substitute ?head ?environment ?result) (substitute-items ?tail ?environment ?rest)\n  (append ?rest (cons ?result end) ?output))")
}
#[test]
fn relational_source_preserves_shared_sk_reductions_and_independently_replays_each_step() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let options = Options::default();
    let cases: Value = serde_json::from_str(CASES).unwrap();
    let programs = programs();
    let baseline = LinkedProgramRegistry::from_rml(WORKLOAD).unwrap();
    for case in cases["reductions"].as_array().unwrap() {
        let name = case["program"].as_str().unwrap();
        let rules = k.resolve(&programs, name, "rewrites", &options).unwrap();
        let rules = parts(&rules.value)[1].clone();
        let mut current = node(&case["input"]);
        let mut finished = false;
        for _ in 0..16 {
            let result = k.rewrite_once(&current, &rules, &options).unwrap();
            assert!(
                k.resolver()
                    .replay(
                        &result.call.query,
                        result.call.proof.as_ref().unwrap(),
                        &options
                    )
                    .unwrap()
                    .accepted
            );
            match result.step {
                Some((output, _, _)) => current = output,
                None => {
                    finished = true;
                    break;
                }
            }
        }
        assert!(finished);
        assert_eq!(current, node(&case["output"]));
        assert_eq!(
            current,
            baseline
                .reduce(name, &node(&case["input"]), 16)
                .unwrap()
                .term
        );
    }
}
#[test]
fn relational_source_preserves_imported_facts_two_inferences_fixed_point_and_complete_proofs() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let options = Options::default();
    let cases: Value = serde_json::from_str(CASES).unwrap();
    let state = k
        .create_proof_state(&programs(), "proof", &[], &options)
        .unwrap();
    assert_eq!(state.size, 1);
    assert!(k
        .find_proof(&state, &node(&cases["goal"]), &options)
        .unwrap()
        .is_none());
    let first = k.infer_once(state, &options).unwrap();
    assert_eq!(first.derivation.as_ref().unwrap().0, term("(arrived seed)"));
    let second = k.infer_once(first.state, &options).unwrap();
    assert_eq!(
        second.derivation.as_ref().unwrap().0,
        term("(finished seed)")
    );
    let last = k.infer_once(second.state, &options).unwrap();
    assert!(last.derivation.is_none());
    assert!(last.execution.exhausted);
    assert_eq!(last.state.size, 3);
    let found = k
        .find_proof(&last.state, &node(&cases["goal"]), &options)
        .unwrap()
        .unwrap();
    assert_eq!(found, proof(&cases["proof"]));
    assert_eq!(
        found,
        LinkedProgramRegistry::from_rml(WORKLOAD)
            .unwrap()
            .prove("proof", &node(&cases["goal"]), &[], 8, 16)
            .unwrap()
    );
    assert!(k
        .find_proof(&last.state, &node(&cases["absentGoal"]), &options)
        .unwrap()
        .is_none());
}
#[test]
fn source_replacement_changes_recursive_substitution_on_the_unchanged_horn_machine() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let changed = RelationalKernel::from_source(&replacement()).unwrap();
    let options = Options::default();
    let rules = rel::encode_rules(&programs()["rules"].rewrites);
    let before = k
        .rewrite_once(&term("(input value)"), &rules, &options)
        .unwrap();
    let after = changed
        .rewrite_once(&term("(input value)"), &rules, &options)
        .unwrap();
    assert_eq!(
        before.step.as_ref().unwrap().0,
        term("(pair (nested value) done)")
    );
    assert_eq!(
        after.step.as_ref().unwrap().0,
        term("(done (value nested) pair)")
    );
    assert_eq!(
        before.call.execution.observed_operations,
        after.call.execution.observed_operations
    );
    assert_eq!(
        k.rewrite_once(&term("(input value)"), &rules, &options)
            .unwrap()
            .step,
        before.step
    );
    assert!(
        changed
            .resolver()
            .replay(
                &after.call.query,
                after.call.proof.as_ref().unwrap(),
                &options
            )
            .unwrap()
            .accepted
    );
    assert!(
        !k.resolver()
            .replay(
                &after.call.query,
                after.call.proof.as_ref().unwrap(),
                &options
            )
            .unwrap()
            .accepted
    );
}
#[test]
fn horn_unifier_freshens_scopes_rejects_occurs_cycles_and_backtracks() {
    let r=HornResolution::from_source("(horn-clause first (edge a b))\n(horn-clause second (edge b c))\n(horn-clause path (path ?x ?z) (edge ?x ?y) (edge ?y ?z))\n(horn-clause repeat (repeated ?x ?x))\n(horn-clause cycle (cycle ?x (f ?x)))").unwrap();
    let options = Options::default();
    assert_eq!(
        r.query(&term("(path a ?out)"), &options).unwrap().answers[0].goal,
        term("(path a c)")
    );
    assert!(r
        .query(&term("(repeated a b)"), &options)
        .unwrap()
        .answers
        .is_empty());
    assert!(r
        .query(&term("(cycle ?x ?x)"), &options)
        .unwrap()
        .answers
        .is_empty());
    let options = Options {
        max_answers: 3,
        ..options
    };
    let answer = r.query(&term("(edge ?x ?y)"), &options).unwrap();
    assert!(answer.exhausted);
    assert_eq!(answer.answers.len(), 2);
}
#[test]
fn independent_horn_replay_rejects_goal_clause_premise_and_context_tampering() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let options = Options::default();
    let result = k
        .rewrite_once(
            &term("(input value)"),
            &rel::encode_rules(&programs()["rules"].rewrites),
            &options,
        )
        .unwrap()
        .call;
    let original = result.proof.unwrap();
    let mut changed = original.clone();
    changed.clause = "forged".into();
    assert!(
        !k.resolver()
            .replay(&result.query, &changed, &options)
            .unwrap()
            .accepted
    );
    let mut changed = original.clone();
    changed.goal = term("(wrong query)");
    assert!(
        !k.resolver()
            .replay(&result.query, &changed, &options)
            .unwrap()
            .accepted
    );
    let mut changed = original.clone();
    changed.premises.pop();
    assert!(
        !k.resolver()
            .replay(&result.query, &changed, &options)
            .unwrap()
            .accepted
    );
    let mut changed = original.clone();
    changed.premises[0].goal = term("(wrong child)");
    assert!(
        !k.resolver()
            .replay(&result.query, &changed, &options)
            .unwrap()
            .accepted
    );
    assert!(
        !k.resolver()
            .replay(&term("(other query)"), &original, &options)
            .unwrap()
            .accepted
    );
}
#[test]
fn each_explicit_horn_host_operation_has_a_removal_witness() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    for operation in OPERATIONS {
        let options = Options {
            disabled: BTreeSet::from([operation.to_string()]),
            ..Options::default()
        };
        let error = k
            .call(
                "nodes-equal",
                vec![
                    rel::encode_node(&term("x"), false),
                    rel::encode_node(&term("x"), false),
                ],
                &options,
            )
            .unwrap_err();
        assert_eq!(
            error,
            format!("disabled host semantic operation {operation}")
        );
    }
}
#[test]
fn linked_horn_interpreter_executes_the_actual_source_image() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let options = Options {
        max_steps: 10_000_000,
        capture_proof: false,
        ..Options::default()
    };
    let goal = term("(bits-equal (zero end) (zero end) ?out)");
    assert_eq!(
        k.self_query(&goal, &options).unwrap(),
        k.resolver().query(&goal, &options).unwrap().answers[0].goal
    );
}
#[test]
fn linked_meta_occurs_check_can_be_replaced_as_source_without_changing_host_unification() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let options = Options::default();
    let key = Node::List(vec![term("key"), term("end"), rel::encode_bits("x")]);
    let variable = Node::List(vec![term("meta-variable"), key]);
    let cyclic = Node::List(vec![
        term("meta-list"),
        rel::encode_list(vec![variable.clone()]),
    ]);
    assert_eq!(
        k.call(
            "meta-unify",
            vec![variable.clone(), cyclic.clone(), term("end")],
            &options
        )
        .unwrap()
        .value,
        term("failed")
    );
    let source=SOURCE.replace("(horn-clause meta-bind-cycle (meta-bind-choice yes ?key ?value ?environment failed))","(horn-clause meta-bind-cycle (meta-bind-choice yes ?key ?value ?environment (unified ?environment)))");
    let changed = RelationalKernel::from_source(&source).unwrap();
    assert_eq!(
        changed
            .call("meta-unify", vec![variable, cyclic, term("end")], &options)
            .unwrap()
            .value,
        term("(unified end)")
    );
}
#[test]
fn linked_description_generation_preserves_and_executes_the_real_clause_image() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let options = Options {
        max_steps: 10_000_000,
        capture_proof: false,
        ..Options::default()
    };
    let image = k.describe_program();
    let described = k
        .call("describe-program", vec![image.clone()], &options)
        .unwrap()
        .value;
    let generated = k
        .call("generate-program", vec![described], &options)
        .unwrap()
        .value;
    assert_eq!(generated, image);
    let result = k
        .call(
            "self-query",
            vec![
                generated,
                rel::encode_node(&term("(bits-equal end end ?out)"), true),
            ],
            &options,
        )
        .unwrap()
        .value;
    assert_eq!(
        rel::decode_node(&parts(&result)[1]).unwrap(),
        term("(bits-equal end end yes)")
    );
}
#[test]
fn horn_source_and_resolution_bounds_reject_instead_of_claiming_success() {
    assert!(HornResolution::from_source("").is_err());
    assert!(HornResolution::from_source("(not-a-clause x)").is_err());
    assert!(
        HornResolution::from_source("(horn-clause x (p a))\n(horn-clause x (q a))")
            .unwrap_err()
            .contains("duplicate")
    );
    let r = HornResolution::from_source("(horn-clause loop (loop unit) (loop unit))").unwrap();
    assert!(r
        .query(
            &term("(loop unit)"),
            &Options {
                max_depth: 10,
                ..Options::default()
            }
        )
        .unwrap_err()
        .contains("depth bound"));
    assert!(r
        .query(
            &term("(loop unit)"),
            &Options {
                max_steps: 1,
                ..Options::default()
            }
        )
        .unwrap_err()
        .contains("step bound"));
}

#[test]
fn immutable_ground_shortcut_follows_aliases_backtracks_and_owns_input_terms() {
    let source="(horn-clause alias-cycle (cycle ?a ?b (f ?a)))\n(horn-clause trial (picked ?x) (same ?x bad) (missing ?x))\n(horn-clause success (picked good))\n(horn-clause same (same ?v ?v))\n(horn-clause owned (owned (f a)))";
    let resolver = HornResolution::from_source(source).unwrap();
    let options = Options::default();
    assert!(resolver
        .query(&term("(cycle ?x ?x ?x)"), &options)
        .unwrap()
        .answers
        .is_empty());
    assert_eq!(
        resolver
            .query(&term("(picked ?out)"), &options)
            .unwrap()
            .answers[0]
            .goal,
        term("(picked good)")
    );
    let mut query = term("(owned (f a))");
    let answer = resolver.query(&query, &options).unwrap().answers.remove(0);
    if let Node::List(items) = &mut query {
        if let Node::List(fields) = &mut items[1] {
            fields[1] = term("b");
        }
    }
    assert!(resolver.query(&query, &options).unwrap().answers.is_empty());
    assert_eq!(answer.goal, term("(owned (f a))"));
    assert!(
        resolver
            .replay(
                &term("(owned (f a))"),
                answer.proof.as_ref().unwrap(),
                &options
            )
            .unwrap()
            .accepted
    );
    assert!(
        !resolver
            .replay(&query, answer.proof.as_ref().unwrap(), &options)
            .unwrap()
            .accepted
    );
}

#[test]
fn source_replay_binds_atom_codes_to_expected_source_context() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let options = Options {
        self_interpret: true,
        include_source_proof: true,
        max_steps: 100_000_000,
        ..Options::default()
    };
    let goal = term("(bits-equal (zero end) (zero end) ?out)");
    let result = k.run_query(&goal, &options).unwrap();
    let proof = result.answers[0].source_proof.as_ref().unwrap();
    assert_eq!(
        k.self_replay(&goal, proof, &options).unwrap().unwrap(),
        term("(bits-equal (zero end) (zero end) yes)")
    );
    let mut wrong = proof.clone();
    if let Node::List(fields) = &mut wrong {
        fields[1] = term("forged");
    }
    assert!(k.self_replay(&goal, &wrong, &options).unwrap().is_none());
    let mut wrong = proof.clone();
    if let Node::List(fields) = &mut wrong {
        if let Node::List(names) = &mut fields[2] {
            names[0] = term("forged");
        }
    }
    assert!(k.self_replay(&goal, &wrong, &options).unwrap().is_none());
    let mut wrong = proof.clone();
    if let Node::List(fields) = &mut wrong {
        fields[3] = term("end");
    }
    assert!(k.self_replay(&goal, &wrong, &options).unwrap().is_none());
    assert!(k
        .self_replay(&term("(bits-equal end (zero end) ?out)"), proof, &options)
        .unwrap()
        .is_none());
}

#[test]
fn actual_quoted_horn_image_preserves_the_entire_six_capability_workload() {
    let k = RelationalKernel::from_source(SOURCE).unwrap();
    let programs = programs();
    let cases: Value = serde_json::from_str(CASES).unwrap();
    let options = Options {
        self_interpret: true,
        capture_proof: false,
        max_steps: 100_000_000,
        ..Options::default()
    };
    let mut rules_by_program = BTreeMap::new();
    for case in cases["reductions"].as_array().unwrap() {
        let name = case["program"].as_str().unwrap();
        if !rules_by_program.contains_key(name) {
            let call = k.resolve(&programs, name, "rewrites", &options).unwrap();
            rules_by_program.insert(name.to_string(), parts(&call.value)[1].clone());
            println!("self interpreted import {name}");
        }
        let rules = &rules_by_program[name];
        let mut output = node(&case["input"]);
        let mut finished = false;
        for _ in 0..16 {
            let result = k.rewrite_once(&output, rules, &options).unwrap();
            match result.step {
                None => {
                    finished = true;
                    break;
                }
                Some((term, _, _)) => output = term,
            }
        }
        assert!(finished);
        assert_eq!(output, node(&case["output"]));
        println!("self interpreted reduction {}", case["name"]);
    }
    let mut state = k
        .create_proof_state(&programs, "proof", &[], &options)
        .unwrap();
    assert_eq!(state.size, 1);
    for expected in [term("(arrived seed)"), term("(finished seed)")] {
        let result = k.infer_once(state, &options).unwrap();
        assert_eq!(result.derivation.as_ref().unwrap().0, expected);
        state = result.state;
    }
    let end = k.infer_once(state, &options).unwrap();
    assert!(end.derivation.is_none());
    assert!(end.execution.exhausted);
    assert_eq!(end.state.size, 3);
    assert_eq!(
        k.find_proof(&end.state, &node(&cases["goal"]), &options)
            .unwrap()
            .unwrap(),
        proof(&cases["proof"])
    );
    assert!(k
        .find_proof(&end.state, &node(&cases["absentGoal"]), &options)
        .unwrap()
        .is_none());
}

#[test]
fn conditional_trailing_and_constructor_discrimination_preserve_all_branch_answers() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../../test-corpus/relational-kernel/branch-cases.json"
    ))
    .unwrap();
    for case in cases["cases"].as_array().unwrap() {
        let resolver = HornResolution::from_source(case["source"].as_str().unwrap()).unwrap();
        let query = node(&case["query"]);
        for capture_proof in [false, true] {
            let options = Options {
                max_answers: 100,
                capture_proof,
                ..Options::default()
            };
            let result = resolver.query(&query, &options).unwrap();
            assert!(result.exhausted);
            assert_eq!(
                result
                    .answers
                    .iter()
                    .map(|answer| answer.goal.clone())
                    .collect::<Vec<_>>(),
                case["answers"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(node)
                    .collect::<Vec<_>>()
            );
            if capture_proof {
                for answer in result.answers {
                    assert!(
                        resolver
                            .replay(&query, answer.proof.as_ref().unwrap(), &options)
                            .unwrap()
                            .accepted
                    );
                }
            }
        }
    }
}
