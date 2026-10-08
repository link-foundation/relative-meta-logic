// Test-only original direct reducer, frozen before dispatch integration.
// It intentionally uses the owned matcher and unindexed ordered traversal.
use super::*;

fn original_rewrite(
    registry: &LinkedProgramRegistry,
    term: &Node,
    rules: &[RewriteRule],
    paths: &[&str],
) -> Result<Option<(Node, usize)>, String> {
    registry.observe(paths, "select-and-traverse-rewrite-rules")?;
    for (index, rule) in rules.iter().enumerate() {
        let mut substitution = BTreeMap::new();
        let mut observe = |operation| registry.observe(paths, operation);
        if direct_match_term(&rule.pattern, term, &mut substitution, &mut observe)? {
            return direct_instantiate(&rule.replacement, &substitution, &mut observe)
                .map(|next| Some((next, index)));
        }
    }
    if let Node::List(children) = term {
        for (index, child) in children.iter().enumerate() {
            if let Some((rewritten, rule)) = original_rewrite(registry, child, rules, paths)? {
                let mut next = children.clone();
                next[index] = rewritten;
                return Ok(Some((Node::List(next), rule)));
            }
        }
    }
    Ok(None)
}

fn original_reduce(
    registry: &LinkedProgramRegistry,
    name: &str,
    input: &Node,
    max_steps: usize,
) -> Result<ReductionResult, ReduceFailure> {
    let mut paths = vec!["reduce-linked-program"];
    if name == "links-meta-foundation" {
        paths.push("execute-links-meta-foundation");
    }
    registry.observe(&paths, "enforce-cycle-and-resource-bounds")?;
    if max_steps == 0 {
        return Err(ReduceFailure::Other(
            "max_steps must be positive".to_string(),
        ));
    }
    let rules = registry.effective_rewrites(name, &paths, &mut BTreeSet::new(), &[])?;
    let mut term = input.clone();
    let mut trace = Vec::new();
    let mut seen = BTreeSet::from([key_of(&term)]);
    while trace.len() < max_steps {
        let Some((next, index)) = original_rewrite(registry, &term, &rules, &paths)? else {
            return Ok(ReductionResult { term, trace });
        };
        let rule = &rules[index];
        if next == term {
            return Err(ReduceFailure::Stalled(format!(
                "linked rewrite {}.{} made no progress",
                rule.program, rule.name
            )));
        }
        trace.push(RewriteTraceStep {
            program: rule.program.clone(),
            rule: rule.name.clone(),
            before: term,
            after: next.clone(),
        });
        term = next;
        let key = key_of(&term);
        if !seen.insert(key.clone()) {
            return Err(ReduceFailure::Cycle(format!(
                "rewrite cycle after {} steps at {key}",
                trace.len()
            )));
        }
    }
    Err(ReduceFailure::Limit(format!(
        "rewrite step limit {max_steps} exceeded"
    )))
}

fn error_key(error: ReduceFailure) -> (&'static str, String) {
    match error {
        ReduceFailure::Limit(message) => ("limit", message),
        ReduceFailure::Cycle(message) => ("cycle", message),
        ReduceFailure::Stalled(message) => ("stalled", message),
        ReduceFailure::ContractionLimit(message) => ("contraction-limit", message),
        ReduceFailure::Other(message) => ("other", message),
    }
}

fn node(source: &str) -> Node {
    if source.starts_with('(') {
        parse_one(&tokenize_one(source)).unwrap()
    } else {
        Node::Leaf(source.to_string())
    }
}
fn compare(source: &str, program: &str, input: &Node, max_steps: usize, disabled: &[&str]) {
    let before = LinkedProgramRegistry::from_rml_with_basis(
        source,
        ExecutionBasis::DirectStructural,
        disabled,
    )
    .unwrap();
    let after = LinkedProgramRegistry::from_rml_with_basis(
        source,
        ExecutionBasis::DirectStructural,
        disabled,
    )
    .unwrap();
    assert_eq!(
        after
            .reduce_classified(program, input, max_steps)
            .map_err(error_key),
        original_reduce(&before, program, input, max_steps).map_err(error_key)
    );
    assert_eq!(
        after.runtime_semantic_trace(),
        before.runtime_semantic_trace()
    );
}

const SOURCE: &str = r#"
  (linked-program p)
  (linked-rewrite p ignored (from (unmatched ?x)) (to unused))
  (linked-rewrite p repeated (from (pair ?x ?x)) (to (same ?x)))
  (linked-rewrite p fallback (from (pair ?x ?y)) (to (different ?x ?y)))
  (linked-rewrite p literal (from ("?quoted" ?x)) (to (quoted ?x)))
  (linked-rewrite p question (from (? ?x)) (to (question ?x)))
  (linked-rewrite p child (from (inner ?x)) (to (out ?x)))
  (linked-rewrite p stall (from (stall ?x)) (to (stall ?x)))
  (linked-rewrite p cycle-a (from a) (to b))
  (linked-rewrite p cycle-b (from b) (to a))
  (linked-program q (uses p (rebind pair changed)))
  (linked-rewrite q local (from (changed local ?x)) (to local-first))
  (linked-program wild)
  (linked-rewrite wild ignored (from (different ?x)) (to unused))
  (linked-rewrite wild all (from ?all) (to stopped))
  (linked-program variable-head)
  (linked-rewrite variable-head head (from (?head x)) (to (out ?head)))
"#;

#[test]
fn exact_full_traces_errors_observers_and_rule_priority() {
    let fixtures = [
        ("p", "(pair (x) (x))"),
        ("p", "(pair (x) (y))"),
        ("p", "(\"?quoted\" x)"),
        ("p", "(? x)"),
        ("p", "(outer (inner x))"),
        ("p", "(stall x)"),
        ("p", "a"),
        ("p", "(unknown x)"),
        ("p", "()"),
        ("p", "((pair) x x)"),
        ("q", "(changed local x)"),
        ("q", "(changed (x) (x))"),
        ("wild", "(input x)"),
        ("variable-head", "(arbitrary x)"),
    ];
    let operations = [
        "resolve-and-rebind-program-imports",
        "enforce-cycle-and-resource-bounds",
        "select-and-traverse-rewrite-rules",
        "compare-link-structure",
        "bind-pattern-variables",
        "substitute-bound-structures",
    ];
    for (program, input) in fixtures {
        let input = node(input);
        for limit in [0, 1, 2, 8] {
            compare(SOURCE, program, &input, limit, &[]);
        }
        for first in operations {
            for second in operations {
                compare(SOURCE, program, &input, 8, &[first, second]);
            }
        }
    }
}

#[test]
fn mutation_rebinding_and_owned_results_remain_independent() {
    let source = "(linked-program p)\n(linked-rewrite p copy (from (old ?x)) (to (out ?x ?x)))";
    let mut registry =
        LinkedProgramRegistry::from_rml_with_basis(source, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    let mut input = node("(old (original))");
    let mut output = registry.reduce("p", &input, 8).unwrap();
    let snapshot = output.clone();
    input = node("(input changed)");
    let rule = &mut registry.programs.get_mut("p").unwrap().rewrites[0];
    rule.pattern = node("(new ?x)");
    rule.replacement = node("(new-out ?x)");
    assert_eq!(output, snapshot);
    if let Node::List(children) = &mut output.term {
        children[1] = node("changed");
    }
    assert_eq!(output.trace, snapshot.trace);
    assert_eq!(
        registry.reduce("p", &node("(new x)"), 8).unwrap().term,
        node("(new-out x)")
    );
    assert_eq!(
        registry.reduce("p", &node("(old x)"), 8).unwrap().term,
        node("(old x)")
    );
    assert_eq!(input, node("(input changed)"));
    let forbidden = "(linked-program base)\n(linked-rewrite base h (from (fixed x)) (to done))\n(linked-program p (uses base (rebind fixed ?head)))";
    let error = LinkedProgramRegistry::from_rml_with_basis(
        forbidden,
        ExecutionBasis::DirectStructural,
        &[],
    )
    .unwrap_err();
    assert_eq!(error, "linked-program p cannot rebind pattern variables");
}

#[test]
fn borrowed_matching_keeps_exact_observation_sequence() {
    for (pattern, candidate) in [
        ("(pair ?x ?x)", "(pair (large x) (large x))"),
        ("(pair ?x ?x)", "(pair (large x) (different y))"),
        ("(pair ?x fixed)", "(pair (large x) wrong)"),
    ] {
        let pattern = node(pattern);
        let candidate = node(candidate);
        let mut owned = BTreeMap::new();
        let mut borrowed = BTreeMap::new();
        let mut first = Vec::new();
        let mut second = Vec::new();
        assert_eq!(
            direct_match_term(&pattern, &candidate, &mut owned, &mut |operation| {
                first.push(operation);
                Ok(())
            })
            .unwrap(),
            direct_match_borrowed(&pattern, &candidate, &mut borrowed, &mut |operation| {
                second.push(operation);
                Ok(())
            })
            .unwrap()
        );
        assert_eq!(first, second);
        for (key, value) in owned {
            assert_eq!(&value, *borrowed.get(key.as_str()).unwrap());
        }
    }
}

#[test]
fn complete_typed_recursion_corpus_matches_original_trace_and_observer() {
    use std::fs;
    use std::path::Path;
    use std::time::Instant;
    fn json_node(value: &serde_json::Value) -> Node {
        match value {
            serde_json::Value::String(value) => Node::Leaf(value.clone()),
            serde_json::Value::Array(values) => Node::List(values.iter().map(json_node).collect()),
            _ => panic!("fixture term must be a string or array"),
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let cases: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(root.join("test-corpus/linked-dispatch/typed-recursion-cases.json"))
            .unwrap(),
    )
    .unwrap();
    let source =
        fs::read_to_string(root.join("test-corpus/linked-dispatch/typed-recursion-source.lino"))
            .unwrap();
    let program = cases["program"].as_str().unwrap();
    let mut reports = Vec::new();
    for case in cases["cases"].as_array().unwrap() {
        let before = LinkedProgramRegistry::from_rml_with_basis(
            &source,
            ExecutionBasis::DirectStructural,
            &[],
        )
        .unwrap();
        let after = LinkedProgramRegistry::from_rml_with_basis(
            &source,
            ExecutionBasis::DirectStructural,
            &[],
        )
        .unwrap();
        let input = json_node(&case["request"]);
        let limit = cases["maxSteps"].as_u64().unwrap() as usize;
        let start = Instant::now();
        let expected = original_reduce(&before, program, &input, limit)
            .map_err(error_key)
            .unwrap();
        let baseline_ms = start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        let actual = after
            .reduce_classified(program, &input, limit)
            .map_err(error_key)
            .unwrap();
        let candidate_ms = start.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(actual, expected, "{}", case["name"]);
        assert_eq!(
            after.runtime_semantic_trace(),
            before.runtime_semantic_trace(),
            "{}",
            case["name"]
        );
        eprintln!(
            "exact native {}: {} steps; baseline {:.3} ms, candidate {:.3} ms",
            case["name"],
            actual.trace.len(),
            baseline_ms,
            candidate_ms
        );
        reports.push(serde_json::json!({"name":case["name"], "steps": actual.trace.len(), "baselineMs":baseline_ms, "candidateMs":candidate_ms, "exactResultAndFullTrace":true,"exactObserver":true}));
    }
    if let Ok(report) = std::env::var("RML_DISPATCH_RUST_REPORT") {
        fs::write(report, serde_json::to_string_pretty(&serde_json::json!({"expectedCases":cases["cases"].as_array().unwrap().len(),"completedCases":reports.len(),"cases":reports})).unwrap()).unwrap();
    }
}
