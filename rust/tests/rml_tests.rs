use rml::*;
fn approx(actual: f64, expected: f64) {
    let epsilon = 1e-9;
    assert!(
        (actual - expected).abs() < epsilon,
        "Expected {}, got {} (diff: {})",
        expected,
        actual,
        (actual - expected).abs()
    );
}

// ===== tokenize_one =====

#[test]
fn tokenize_simple_link() {
    let tokens = tokenize_one("(a: a is a)");
    assert_eq!(tokens, vec!["(", "a:", "a", "is", "a", ")"]);
}

#[test]
fn tokenize_nested_link() {
    let tokens = tokenize_one("((a = a) has probability 1)");
    assert_eq!(
        tokens,
        vec!["(", "(", "a", "=", "a", ")", "has", "probability", "1", ")"]
    );
}

#[test]
fn tokenize_strip_inline_comments() {
    let tokens = tokenize_one("(and: avg) # this is a comment");
    assert_eq!(tokens, vec!["(", "and:", "avg", ")"]);
}

#[test]
fn tokenize_balance_parens_after_stripping_comments() {
    let tokens = tokenize_one("((and: avg) # comment)");
    assert_eq!(tokens, vec!["(", "(", "and:", "avg", ")", ")"]);
}

// ===== parse_one =====

#[test]
fn parse_simple_link() {
    let tokens: Vec<String> = vec!["(", "a:", "a", "is", "a", ")"]
        .into_iter()
        .map(String::from)
        .collect();
    let ast = parse_one(&tokens).unwrap();
    assert_eq!(
        ast,
        Node::List(vec![
            Node::Leaf("a:".into()),
            Node::Leaf("a".into()),
            Node::Leaf("is".into()),
            Node::Leaf("a".into()),
        ])
    );
}

#[test]
fn parse_nested_link() {
    let tokens: Vec<String> = vec!["(", "(", "a", "=", "a", ")", "has", "probability", "1", ")"]
        .into_iter()
        .map(String::from)
        .collect();
    let ast = parse_one(&tokens).unwrap();
    assert_eq!(
        ast,
        Node::List(vec![
            Node::List(vec![
                Node::Leaf("a".into()),
                Node::Leaf("=".into()),
                Node::Leaf("a".into()),
            ]),
            Node::Leaf("has".into()),
            Node::Leaf("probability".into()),
            Node::Leaf("1".into()),
        ])
    );
}

#[test]
fn parse_deeply_nested_link() {
    let tokens: Vec<String> = vec![
        "(", "?", "(", "(", "a", "=", "a", ")", "and", "(", "a", "!=", "a", ")", ")", ")",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    let ast = parse_one(&tokens).unwrap();
    assert_eq!(
        ast,
        Node::List(vec![
            Node::Leaf("?".into()),
            Node::List(vec![
                Node::List(vec![
                    Node::Leaf("a".into()),
                    Node::Leaf("=".into()),
                    Node::Leaf("a".into()),
                ]),
                Node::Leaf("and".into()),
                Node::List(vec![
                    Node::Leaf("a".into()),
                    Node::Leaf("!=".into()),
                    Node::Leaf("a".into()),
                ]),
            ]),
        ])
    );
}

// ===== Env =====

#[test]
fn env_default_operators() {
    let env = Env::new(None);
    assert!(env.ops.contains_key("not"));
    assert!(env.ops.contains_key("and"));
    assert!(env.ops.contains_key("or"));
    assert!(env.ops.contains_key("="));
    assert!(env.ops.contains_key("!="));
}

#[test]
fn env_define_new_operators() {
    let mut env = Env::new(None);
    env.define_op("test", Op::Agg(Aggregator::Min));
    assert!(env.ops.contains_key("test"));
    assert_eq!(env.apply_op("test", &[0.5, 1.0]), 0.5);
}

#[test]
fn env_store_expression_probabilities() {
    let mut env = Env::new(None);
    let expr = Node::List(vec![
        Node::Leaf("a".into()),
        Node::Leaf("=".into()),
        Node::Leaf("a".into()),
    ]);
    env.set_expr_prob(&expr, 1.0);
    assert_eq!(env.assign.get("(a = a)"), Some(&1.0));
}

// ===== eval_node =====

#[test]
fn eval_numeric_literals() {
    let mut env = Env::new(None);
    assert_eq!(eval_node(&Node::Leaf("1".into()), &mut env).as_f64(), 1.0);
    assert_eq!(eval_node(&Node::Leaf("0.5".into()), &mut env).as_f64(), 0.5);
    assert_eq!(eval_node(&Node::Leaf("0".into()), &mut env).as_f64(), 0.0);
}

#[test]
fn eval_term_definitions() {
    let mut env = Env::new(None);
    eval_node(
        &Node::List(vec![
            Node::Leaf("a:".into()),
            Node::Leaf("a".into()),
            Node::Leaf("is".into()),
            Node::Leaf("a".into()),
        ]),
        &mut env,
    );
    assert!(env.terms.contains("a"));
}

#[test]
fn eval_operator_redefinitions() {
    let mut env = Env::new(None);
    eval_node(
        &Node::List(vec![
            Node::Leaf("!=:".into()),
            Node::Leaf("not".into()),
            Node::Leaf("=".into()),
        ]),
        &mut env,
    );
    assert!(env.ops.contains_key("!="));
}

#[test]
fn eval_aggregator_selection() {
    let mut env = Env::new(None);
    eval_node(
        &Node::List(vec![Node::Leaf("and:".into()), Node::Leaf("min".into())]),
        &mut env,
    );
    assert_eq!(env.apply_op("and", &[0.3, 0.7]), 0.3);
}

#[test]
fn eval_probability_assignments() {
    let mut env = Env::new(None);
    let result = eval_node(
        &Node::List(vec![
            Node::List(vec![
                Node::Leaf("a".into()),
                Node::Leaf("=".into()),
                Node::Leaf("a".into()),
            ]),
            Node::Leaf("has".into()),
            Node::Leaf("probability".into()),
            Node::Leaf("1".into()),
        ]),
        &mut env,
    );
    assert_eq!(result.as_f64(), 1.0);
    assert_eq!(env.assign.get("(a = a)"), Some(&1.0));
}

#[test]
fn eval_equality_operator() {
    let mut env = Env::new(None);
    let result = eval_node(
        &Node::List(vec![
            Node::Leaf("a".into()),
            Node::Leaf("=".into()),
            Node::Leaf("a".into()),
        ]),
        &mut env,
    );
    assert_eq!(result.as_f64(), 1.0);
}

#[test]
fn eval_inequality_operator() {
    let mut env = Env::new(None);
    let result = eval_node(
        &Node::List(vec![
            Node::Leaf("a".into()),
            Node::Leaf("!=".into()),
            Node::Leaf("a".into()),
        ]),
        &mut env,
    );
    assert_eq!(result.as_f64(), 0.0);
}

#[test]
fn eval_not_operator() {
    let mut env = Env::new(None);
    let result = eval_node(
        &Node::List(vec![Node::Leaf("not".into()), Node::Leaf("1".into())]),
        &mut env,
    );
    assert_eq!(result.as_f64(), 0.0);
}

#[test]
fn eval_and_operator_avg() {
    let mut env = Env::new(None);
    let result = eval_node(
        &Node::List(vec![
            Node::Leaf("1".into()),
            Node::Leaf("and".into()),
            Node::Leaf("0".into()),
        ]),
        &mut env,
    );
    assert_eq!(result.as_f64(), 0.5);
}

#[test]
fn eval_or_operator_max() {
    let mut env = Env::new(None);
    let result = eval_node(
        &Node::List(vec![
            Node::Leaf("1".into()),
            Node::Leaf("or".into()),
            Node::Leaf("0".into()),
        ]),
        &mut env,
    );
    assert_eq!(result.as_f64(), 1.0);
}

#[test]
fn eval_queries() {
    let mut env = Env::new(None);
    let result = eval_node(
        &Node::List(vec![Node::Leaf("?".into()), Node::Leaf("1".into())]),
        &mut env,
    );
    assert!(result.is_query());
    assert_eq!(result.as_f64(), 1.0);
}

// ===== run =====

#[test]
fn run_demo_example() {
    let text = r#"
(a: a is a)
(!=: not =)
(and: avg)
(or: max)
((a = a) has probability 1)
((a != a) has probability 0)
(? ((a = a) and (a != a)))
(? ((a = a) or  (a != a)))
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 0.5);
    assert_eq!(results[1], 1.0);
}

#[test]
fn run_flipped_axioms_example() {
    let text = r#"
(a: a is a)
(!=: not =)
(and: avg)
(or: max)
((a = a) has probability 0)
((a != a) has probability 1)
(? ((a = a) and (a != a)))
(? ((a = a) or  (a != a)))
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 0.5);
    assert_eq!(results[1], 1.0);
}

#[test]
fn run_different_aggregators_for_and() {
    let text = r#"
(a: a is a)
(and: min)
((a = a) has probability 1)
((a != a) has probability 0)
(? ((a = a) and (a != a)))
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 0.0);
}

#[test]
fn run_product_aggregator_full_name() {
    let text = r#"
(and: product)
(? (0.5 and 0.5))
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 0.25);
}

#[test]
fn run_product_aggregator_short_name_backward_compatible() {
    let text = r#"
(and: prod)
(? (0.5 and 0.5))
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 0.25);
}

#[test]
fn run_probabilistic_sum_aggregator_full_name() {
    let text = r#"
(or: probabilistic_sum)
(? (0.5 or 0.5))
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 0.75);
}

#[test]
fn run_probabilistic_sum_aggregator_short_name_backward_compatible() {
    let text = r#"
(or: ps)
(? (0.5 or 0.5))
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 0.75);
}

#[test]
fn run_ignore_comment_only_links() {
    let text = r#"
# This is a comment
(# This is also a comment)
(a: a is a)
(? (a = a))
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 1.0);
}

#[test]
fn run_handle_inline_comments() {
    let text = r#"
(a: a is a) # define term a
((a = a) has probability 1) # axiom
(? (a = a)) # query
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 1.0);
}

#[test]
fn run_inline_comment_containing_colon() {
    // Regression: a `:` inside an inline comment used to be passed through
    // to the LiNo parser and parsed as a binding, silently dropping every
    // statement in the file. See docs/case-studies/issue-68.
    let text = r#"
(? true)                  # comment with: colon
(? false)                 # another: comment
"#;
    let results = run(text, None);
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 0.0);
}

// ===== meta-expression adapter API =====

#[test]
fn meta_expression_adapter_arithmetic_equality() {
    let formalization = formalize_selected_interpretation(FormalizationRequest {
        text: "0.1 + 0.2 = 0.3".to_string(),
        interpretation: Interpretation::arithmetic_equality("0.1 + 0.2 = 0.3"),
        formal_system: "rml-arithmetic".to_string(),
        dependencies: vec![],
    });

    assert!(formalization.computable);
    assert_eq!(formalization.formalization_level, 3);
    assert!(formalization.unknowns.is_empty());

    let result = evaluate_formalization(&formalization);
    assert!(result.computable);
    assert!(result.unknowns.is_empty());
    assert_eq!(result.result, FormalizationResultValue::TruthValue(1.0));
}

#[test]
fn meta_expression_adapter_arithmetic_question_is_not_query_clamped() {
    let formalization = formalize_selected_interpretation(FormalizationRequest {
        text: "What is 0.1 + 0.2?".to_string(),
        interpretation: Interpretation::arithmetic_question("0.1 + 0.2"),
        formal_system: "rml-arithmetic".to_string(),
        dependencies: vec![],
    });

    let result = evaluate_formalization(&formalization);
    assert!(result.computable);
    assert_eq!(result.result, FormalizationResultValue::Number(0.3));
}

#[test]
fn meta_expression_adapter_real_world_claim_stays_partial() {
    let formalization = formalize_selected_interpretation(FormalizationRequest {
        text: "moon orbits the Sun".to_string(),
        interpretation: Interpretation::real_world_claim(
            "Treat \"moon orbits the Sun\" as a factual claim that needs evidence.",
        ),
        formal_system: "rml".to_string(),
        dependencies: vec![Dependency::missing(
            "wikidata",
            "No selected entity and relation ids were provided.",
        )],
    });

    assert!(!formalization.computable);
    assert_eq!(formalization.formalization_level, 2);
    assert!(formalization
        .unknowns
        .contains(&"selected-subject".to_string()));
    assert!(formalization
        .unknowns
        .contains(&"selected-relation".to_string()));

    let result = evaluate_formalization(&formalization);
    assert!(!result.computable);
    assert_eq!(
        result.result,
        FormalizationResultValue::Partial("unknown".to_string())
    );
}

// ===== quantize =====

#[test]
fn quantize_continuous() {
    assert_eq!(quantize(0.33, 0, 0.0, 1.0), 0.33);
    assert_eq!(quantize(0.33, 1, 0.0, 1.0), 0.33);
}

#[test]
fn quantize_binary_boolean() {
    assert_eq!(quantize(0.3, 2, 0.0, 1.0), 0.0);
    assert_eq!(quantize(0.7, 2, 0.0, 1.0), 1.0);
    assert_eq!(quantize(0.5, 2, 0.0, 1.0), 1.0); // round up at midpoint
}

#[test]
fn quantize_ternary() {
    assert_eq!(quantize(0.1, 3, 0.0, 1.0), 0.0);
    assert_eq!(quantize(0.4, 3, 0.0, 1.0), 0.5);
    assert_eq!(quantize(0.5, 3, 0.0, 1.0), 0.5);
    assert_eq!(quantize(0.8, 3, 0.0, 1.0), 1.0);
}

#[test]
fn quantize_5_levels() {
    assert_eq!(quantize(0.1, 5, 0.0, 1.0), 0.0);
    assert_eq!(quantize(0.3, 5, 0.0, 1.0), 0.25);
    assert_eq!(quantize(0.6, 5, 0.0, 1.0), 0.5);
    assert_eq!(quantize(0.7, 5, 0.0, 1.0), 0.75);
    assert_eq!(quantize(0.9, 5, 0.0, 1.0), 1.0);
}

#[test]
fn quantize_balanced_ternary() {
    assert_eq!(quantize(-0.8, 3, -1.0, 1.0), -1.0);
    assert_eq!(quantize(-0.2, 3, -1.0, 1.0), 0.0);
    assert_eq!(quantize(0.0, 3, -1.0, 1.0), 0.0);
    assert_eq!(quantize(0.6, 3, -1.0, 1.0), 1.0);
}

#[test]
fn quantize_binary_balanced() {
    assert_eq!(quantize(-0.5, 2, -1.0, 1.0), -1.0);
    assert_eq!(quantize(0.5, 2, -1.0, 1.0), 1.0);
}

// ===== Env with options =====

#[test]
fn env_custom_range() {
    let env = Env::new(Some(EnvOptions {
        lo: -1.0,
        hi: 1.0,
        valence: 0,
    }));
    assert_eq!(env.lo, -1.0);
    assert_eq!(env.hi, 1.0);
    assert_eq!(env.mid(), 0.0);
}

#[test]
fn env_custom_valence() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 3,
    }));
    assert_eq!(env.valence, 3);
}

#[test]
fn env_clamp_to_range() {
    let env = Env::new(Some(EnvOptions {
        lo: -1.0,
        hi: 1.0,
        valence: 0,
    }));
    assert_eq!(env.clamp(2.0), 1.0);
    assert_eq!(env.clamp(-2.0), -1.0);
    assert_eq!(env.clamp(0.5), 0.5);
}

#[test]
fn env_clamp_and_quantize() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 2,
    }));
    assert_eq!(env.clamp(0.3), 0.0);
    assert_eq!(env.clamp(0.7), 1.0);
}

#[test]
fn env_midpoint_both_ranges() {
    let env01 = Env::new(None);
    assert_eq!(env01.mid(), 0.5);
    let env_bal = Env::new(Some(EnvOptions {
        lo: -1.0,
        hi: 1.0,
        valence: 0,
    }));
    assert_eq!(env_bal.mid(), 0.0);
}

#[test]
fn env_default_symbol_probability() {
    let env = Env::new(Some(EnvOptions {
        lo: -1.0,
        hi: 1.0,
        valence: 0,
    }));
    assert_eq!(env.get_symbol_prob("unknown"), 0.0);
}

#[test]
fn not_operator_mirror_balanced() {
    let env = Env::new(Some(EnvOptions {
        lo: -1.0,
        hi: 1.0,
        valence: 0,
    }));
    assert_eq!(env.apply_op("not", &[1.0]), -1.0);
    assert_eq!(env.apply_op("not", &[-1.0]), 1.0);
    assert_eq!(env.apply_op("not", &[0.0]), 0.0);
}

#[test]
fn not_operator_mirror_standard() {
    let env = Env::new(None);
    assert_eq!(env.apply_op("not", &[1.0]), 0.0);
    assert_eq!(env.apply_op("not", &[0.0]), 1.0);
    assert_eq!(env.apply_op("not", &[0.5]), 0.5);
}

// ===== Unary logic (1-valued) =====

#[test]
fn unary_collapse_values() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 1,
    }));
    assert_eq!(env.clamp(0.5), 0.5);
    assert_eq!(env.clamp(1.0), 1.0);
    assert_eq!(env.clamp(0.0), 0.0);
}

#[test]
fn unary_via_run() {
    let results = run(
        r#"
(valence: 1)
(a: a is a)
(? (a = a))
"#,
        Some(EnvOptions {
            lo: 0.0,
            hi: 1.0,
            valence: 1,
        }),
    );
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 1.0);
}

// ===== Binary logic (2-valued, Boolean) =====

#[test]
fn binary_quantize_01() {
    let results = run(
        r#"
(valence: 2)
(a: a is a)
(!=: not =)
(and: avg)
(or: max)
((a = a) has probability 1)
((a != a) has probability 0)
(? (a = a))
(? (a != a))
(? ((a = a) and (a != a)))
(? ((a = a) or (a != a)))
"#,
        None,
    );
    assert_eq!(results.len(), 4);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 0.0);
    assert_eq!(results[2], 1.0);
    assert_eq!(results[3], 1.0);
}

#[test]
fn binary_quantize_balanced() {
    let results = run(
        r#"
(range: -1 1)
(valence: 2)
(a: a is a)
((a = a) has probability 1)
(? (a = a))
(? (not (a = a)))
"#,
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 2,
        }),
    );
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], -1.0);
}

#[test]
fn binary_law_excluded_middle() {
    let results = run(
        r#"
(valence: 2)
(a: a is a)
(or: max)
((a = a) has probability 1)
(? ((a = a) or (not (a = a))))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn binary_law_non_contradiction() {
    let results = run(
        r#"
(valence: 2)
(a: a is a)
(and: min)
((a = a) has probability 1)
(? ((a = a) and (not (a = a))))
"#,
        None,
    );
    assert_eq!(results[0], 0.0);
}

// ===== Ternary logic (3-valued) =====

#[test]
fn ternary_quantize_01() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 3,
    }));
    assert_eq!(env.clamp(0.0), 0.0);
    assert_eq!(env.clamp(0.3), 0.5);
    assert_eq!(env.clamp(0.5), 0.5);
    assert_eq!(env.clamp(0.8), 1.0);
    assert_eq!(env.clamp(1.0), 1.0);
}

#[test]
fn ternary_quantize_balanced() {
    let env = Env::new(Some(EnvOptions {
        lo: -1.0,
        hi: 1.0,
        valence: 3,
    }));
    assert_eq!(env.clamp(-1.0), -1.0);
    assert_eq!(env.clamp(-0.4), 0.0);
    assert_eq!(env.clamp(0.0), 0.0);
    assert_eq!(env.clamp(0.6), 1.0);
    assert_eq!(env.clamp(1.0), 1.0);
}

#[test]
fn ternary_kleene_logic() {
    let results = run(
        r#"
(valence: 3)
(and: min)
(or: max)
(? (0.5 and 1))
(? (0.5 or 0))
(? (not 0.5))
"#,
        None,
    );
    assert_eq!(results.len(), 3);
    assert_eq!(results[0], 0.5);
    assert_eq!(results[1], 0.5);
    assert_eq!(results[2], 0.5);
}

#[test]
fn ternary_kleene_unknown_and_false() {
    let results = run(
        r#"
(valence: 3)
(and: min)
(? (0.5 and 0))
"#,
        None,
    );
    assert_eq!(results[0], 0.0);
}

#[test]
fn ternary_kleene_unknown_or_true() {
    let results = run(
        r#"
(valence: 3)
(or: max)
(? (0.5 or 1))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn ternary_excluded_middle_fails() {
    let results = run(
        r#"
(valence: 3)
(or: max)
(? (0.5 or (not 0.5)))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

#[test]
fn ternary_liar_paradox_01() {
    let results = run(
        r#"
(valence: 3)
(and: avg)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

#[test]
fn ternary_liar_paradox_balanced() {
    let results = run(
        r#"
(range: -1 1)
(valence: 3)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
"#,
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 3,
        }),
    );
    assert_eq!(results[0], 0.0);
}

// ===== Quaternary logic (4-valued) =====

#[test]
fn quaternary_quantize_01() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 4,
    }));
    approx(env.clamp(0.0), 0.0);
    approx(env.clamp(0.2), 1.0 / 3.0);
    approx(env.clamp(0.5), 2.0 / 3.0);
    approx(env.clamp(0.6), 2.0 / 3.0);
    approx(env.clamp(1.0), 1.0);
}

#[test]
fn quaternary_quantize_balanced() {
    let env = Env::new(Some(EnvOptions {
        lo: -1.0,
        hi: 1.0,
        valence: 4,
    }));
    approx(env.clamp(-1.0), -1.0);
    approx(env.clamp(-0.5), -1.0 / 3.0);
    approx(env.clamp(0.0), 1.0 / 3.0);
    approx(env.clamp(0.5), 1.0 / 3.0);
    approx(env.clamp(1.0), 1.0);
}

#[test]
fn quaternary_via_run() {
    let results = run(
        r#"
(valence: 4)
(and: min)
(or: max)
(? (0.33 and 0.66))
(? (0.33 or 0.66))
"#,
        None,
    );
    assert_eq!(results.len(), 2);
    approx(results[0], 1.0 / 3.0);
    approx(results[1], 2.0 / 3.0);
}

// ===== Quinary logic (5-valued) =====

#[test]
fn quinary_quantize_01() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 5,
    }));
    assert_eq!(env.clamp(0.0), 0.0);
    assert_eq!(env.clamp(0.1), 0.0);
    assert_eq!(env.clamp(0.2), 0.25);
    assert_eq!(env.clamp(0.4), 0.5);
    assert_eq!(env.clamp(0.6), 0.5);
    assert_eq!(env.clamp(0.7), 0.75);
    assert_eq!(env.clamp(0.9), 1.0);
    assert_eq!(env.clamp(1.0), 1.0);
}

#[test]
fn quinary_paradox_at_05() {
    let results = run(
        r#"
(valence: 5)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

// ===== Higher N-valued logics =====

#[test]
fn seven_valued_logic() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 7,
    }));
    approx(env.clamp(0.0), 0.0);
    approx(env.clamp(0.5), 0.5);
    approx(env.clamp(1.0), 1.0);
}

#[test]
fn ten_valued_logic() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 10,
    }));
    approx(env.clamp(0.0), 0.0);
    approx(env.clamp(1.0), 1.0);
    approx(env.clamp(0.5), 5.0 / 9.0);
}

#[test]
fn hundred_valued_logic() {
    let env = Env::new(Some(EnvOptions {
        lo: 0.0,
        hi: 1.0,
        valence: 100,
    }));
    approx(env.clamp(0.0), 0.0);
    approx(env.clamp(1.0), 1.0);
    let actual = env.clamp(0.5);
    assert!(
        (actual - 0.5).abs() < 0.02,
        "100-valued 0.5 should be close to 0.5, got {}",
        actual
    );
}

// ===== Continuous probabilistic logic =====

#[test]
fn continuous_preserve_values_01() {
    let results = run(
        r#"
(a: a is a)
(and: avg)
((a = a) has probability 0.7)
(? (a = a))
(? (not (a = a)))
"#,
        None,
    );
    assert_eq!(results.len(), 2);
    approx(results[0], 0.7);
    approx(results[1], 0.3);
}

#[test]
fn continuous_preserve_values_balanced() {
    let results = run(
        r#"
(range: -1 1)
(a: a is a)
((a = a) has probability 0.4)
(? (a = a))
(? (not (a = a)))
"#,
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results.len(), 2);
    approx(results[0], 0.4);
    approx(results[1], -0.4);
}

#[test]
fn continuous_liar_paradox_01() {
    let results = run(
        r#"
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
"#,
        None,
    );
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 0.5);
    assert_eq!(results[1], 0.5);
}

#[test]
fn continuous_liar_paradox_balanced() {
    let results = run(
        r#"
(range: -1 1)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
(? (not (s = false)))
"#,
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 0.0);
    assert_eq!(results[1], 0.0);
}

#[test]
fn continuous_fuzzy_membership() {
    let results = run(
        r#"
(and: min)
(or: max)
(a: a is a)
(b: b is b)
((a = tall) has probability 0.8)
((b = tall) has probability 0.3)
(? ((a = tall) and (b = tall)))
(? ((a = tall) or (b = tall)))
"#,
        None,
    );
    assert_eq!(results.len(), 2);
    approx(results[0], 0.3);
    approx(results[1], 0.8);
}

// ===== Range and valence configuration via LiNo syntax =====

#[test]
fn config_range_via_lino() {
    let results = run(
        r#"
(range: -1 1)
(a: a is a)
(? (a = a))
(? (not (a = a)))
"#,
        None,
    );
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], -1.0);
}

#[test]
fn config_valence_via_lino() {
    let results = run(
        r#"
(valence: 3)
(? (not 0.5))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

#[test]
fn config_both_range_and_valence() {
    let results = run(
        r#"
(range: -1 1)
(valence: 3)
(a: a is a)
(? (a = a))
(? (not (a = a)))
(? (0 and 0))
"#,
        None,
    );
    assert_eq!(results.len(), 3);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], -1.0);
    assert_eq!(results[2], 0.0);
}

// ===== Liar paradox resolution across logic types =====

#[test]
fn liar_paradox_ternary_01() {
    let results = run(
        r#"
(valence: 3)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

#[test]
fn liar_paradox_ternary_balanced() {
    let results = run(
        r#"
(range: -1 1)
(valence: 3)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
"#,
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 3,
        }),
    );
    assert_eq!(results[0], 0.0);
}

#[test]
fn liar_paradox_continuous_01() {
    let results = run(
        r#"
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
    assert_eq!(results[1], 0.5);
}

#[test]
fn liar_paradox_continuous_balanced() {
    let results = run(
        r#"
(range: -1 1)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
(? (not (s = false)))
"#,
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results[0], 0.0);
    assert_eq!(results[1], 0.0);
}

#[test]
fn liar_paradox_5valued_01() {
    let results = run(
        r#"
(valence: 5)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

#[test]
fn liar_paradox_5valued_balanced() {
    let results = run(
        r#"
(range: -1 1)
(valence: 5)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
"#,
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 5,
        }),
    );
    assert_eq!(results[0], 0.0);
}

// ===== Decimal-precision arithmetic =====

#[test]
fn dec_round_01_plus_02() {
    assert_eq!(dec_round(0.1_f64 + 0.2_f64), 0.3);
}

#[test]
fn dec_round_03_minus_01() {
    assert_eq!(dec_round(0.3_f64 - 0.1_f64), 0.2);
}

#[test]
fn dec_round_exact_values() {
    assert_eq!(dec_round(1.0), 1.0);
    assert_eq!(dec_round(0.0), 0.0);
    assert_eq!(dec_round(0.5), 0.5);
}

#[test]
fn dec_round_non_finite() {
    assert_eq!(dec_round(f64::INFINITY), f64::INFINITY);
    assert_eq!(dec_round(f64::NEG_INFINITY), f64::NEG_INFINITY);
    assert!(dec_round(f64::NAN).is_nan());
}

#[test]
fn arith_add() {
    let results = run("(? (0.1 + 0.2))", None);
    assert_eq!(results[0], 0.3);
}

#[test]
fn arith_sub() {
    let results = run("(? (0.3 - 0.1))", None);
    assert_eq!(results[0], 0.2);
}

#[test]
fn arith_mul() {
    let results = run("(? (0.1 * 0.2))", None);
    assert_eq!(results[0], 0.02);
}

#[test]
fn arith_div() {
    let results = run("(? (1 / 3))", None);
    approx(results[0], 1.0 / 3.0);
}

#[test]
fn arith_div_by_zero() {
    let results = run("(? (0 / 0))", None);
    assert_eq!(results[0], 0.0);
}

#[test]
fn arith_add_eq_03() {
    let results = run("(? ((0.1 + 0.2) = 0.3))", None);
    assert_eq!(results[0], 1.0);
}

#[test]
fn arith_add_neq_03() {
    let results = run("(? ((0.1 + 0.2) != 0.3))", None);
    assert_eq!(results[0], 0.0);
}

#[test]
fn arith_sub_eq_02() {
    let results = run("(? ((0.3 - 0.1) = 0.2))", None);
    assert_eq!(results[0], 1.0);
}

#[test]
fn arith_nested() {
    let results = run("(? ((0.1 + 0.2) + (0.3 + 0.1)))", None);
    assert_eq!(results[0], 0.7);
}

#[test]
fn arith_clamps_in_query() {
    // 2 + 3 = 5, but query clamps to [0,1], so result is 1
    let results = run("(? (2 + 3))", None);
    assert_eq!(results[0], 1.0);
}

#[test]
fn arith_equality_across_expressions() {
    let results = run("(? ((0.1 + 0.2) = (0.5 - 0.2)))", None);
    assert_eq!(results[0], 1.0);
}

// ===== Truth constants: true, false, unknown, undefined =====
// These are predefined symbol probabilities based on the current range.
// By default: (false: min(range)), (true: max(range)),
//             (unknown: mid(range)), (undefined: mid(range))
// They can be redefined by the user via (true: <value>), (false: <value>), etc.
// See: https://github.com/link-foundation/associative-dependent-logic/issues/11

// --- Default values in [0,1] range ---

#[test]
fn truth_const_true_default_01() {
    let results = run("(? true)", None);
    assert_eq!(results[0], 1.0);
}

#[test]
fn truth_const_false_default_01() {
    let results = run("(? false)", None);
    assert_eq!(results[0], 0.0);
}

#[test]
fn truth_const_unknown_default_01() {
    let results = run("(? unknown)", None);
    assert_eq!(results[0], 0.5);
}

#[test]
fn truth_const_undefined_default_01() {
    let results = run("(? undefined)", None);
    assert_eq!(results[0], 0.5);
}

// --- Default values in [-1,1] range ---

#[test]
fn truth_const_true_default_balanced() {
    let results = run(
        "(range: -1 1)\n(? true)",
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn truth_const_false_default_balanced() {
    let results = run(
        "(range: -1 1)\n(? false)",
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results[0], -1.0);
}

#[test]
fn truth_const_unknown_default_balanced() {
    let results = run(
        "(range: -1 1)\n(? unknown)",
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results[0], 0.0);
}

#[test]
fn truth_const_undefined_default_balanced() {
    let results = run(
        "(range: -1 1)\n(? undefined)",
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results[0], 0.0);
}

// --- Redefinition ---

#[test]
fn truth_const_redefine_true() {
    let results = run("(true: 0.8)\n(? true)", None);
    assert_eq!(results[0], 0.8);
}

#[test]
fn truth_const_redefine_false() {
    let results = run("(false: 0.2)\n(? false)", None);
    assert_eq!(results[0], 0.2);
}

#[test]
fn truth_const_redefine_unknown() {
    let results = run("(unknown: 0.3)\n(? unknown)", None);
    assert_eq!(results[0], 0.3);
}

#[test]
fn truth_const_redefine_undefined() {
    let results = run("(undefined: 0.7)\n(? undefined)", None);
    assert_eq!(results[0], 0.7);
}

#[test]
fn truth_const_redefine_in_balanced_range() {
    let results = run(
        "(range: -1 1)\n(true: 0.5)\n(false: -0.5)\n(? true)\n(? false)",
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results[0], 0.5);
    assert_eq!(results[1], -0.5);
}

// --- Range change re-initializes defaults ---

#[test]
fn truth_const_range_change_reinit() {
    let results = run(
        "(? true)\n(? false)\n(range: -1 1)\n(? true)\n(? false)\n(? unknown)",
        None,
    );
    assert_eq!(results.len(), 5);
    assert_eq!(results[0], 1.0); // true in [0,1]
    assert_eq!(results[1], 0.0); // false in [0,1]
    assert_eq!(results[2], 1.0); // true in [-1,1]
    assert_eq!(results[3], -1.0); // false in [-1,1]
    assert_eq!(results[4], 0.0); // unknown in [-1,1]
}

// --- Use in expressions ---

#[test]
fn truth_const_not_true() {
    let results = run("(? (not true))", None);
    assert_eq!(results[0], 0.0);
}

#[test]
fn truth_const_not_false() {
    let results = run("(? (not false))", None);
    assert_eq!(results[0], 1.0);
}

#[test]
fn truth_const_not_unknown() {
    let results = run("(? (not unknown))", None);
    assert_eq!(results[0], 0.5);
}

#[test]
fn truth_const_true_and_false_avg() {
    let results = run("(? (true and false))", None);
    assert_eq!(results[0], 0.5);
}

#[test]
fn truth_const_true_or_false_max() {
    let results = run("(? (true or false))", None);
    assert_eq!(results[0], 1.0);
}

#[test]
fn truth_const_true_and_false_min() {
    let results = run("(and: min)\n(? (true and false))", None);
    assert_eq!(results[0], 0.0);
}

#[test]
fn truth_const_balanced_not() {
    let results = run(
        "(range: -1 1)\n(? (not true))\n(? (not false))\n(? (not unknown))",
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 0,
        }),
    );
    assert_eq!(results[0], -1.0); // not(1) = -1
    assert_eq!(results[1], 1.0); // not(-1) = 1
    assert_eq!(results[2], 0.0); // not(0) = 0
}

// --- With quantization ---

#[test]
fn truth_const_binary_valence() {
    let results = run("(valence: 2)\n(? true)\n(? false)\n(? unknown)", None);
    assert_eq!(results[0], 1.0); // true = 1
    assert_eq!(results[1], 0.0); // false = 0
    assert_eq!(results[2], 1.0); // unknown = 0.5, quantized to 1
}

#[test]
fn truth_const_ternary_valence() {
    let results = run("(valence: 3)\n(? true)\n(? false)\n(? unknown)", None);
    assert_eq!(results[0], 1.0); // true = 1
    assert_eq!(results[1], 0.0); // false = 0
    assert_eq!(results[2], 0.5); // unknown = 0.5
}

#[test]
fn truth_const_ternary_balanced() {
    let results = run(
        "(range: -1 1)\n(valence: 3)\n(? true)\n(? false)\n(? unknown)",
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 3,
        }),
    );
    assert_eq!(results[0], 1.0); // true = 1
    assert_eq!(results[1], -1.0); // false = -1
    assert_eq!(results[2], 0.0); // unknown = 0
}

// --- Env API ---

#[test]
fn truth_const_env_api_01() {
    let env = Env::new(None);
    assert_eq!(env.get_symbol_prob("true"), 1.0);
    assert_eq!(env.get_symbol_prob("false"), 0.0);
    assert_eq!(env.get_symbol_prob("unknown"), 0.5);
    assert_eq!(env.get_symbol_prob("undefined"), 0.5);
}

#[test]
fn truth_const_env_api_balanced() {
    let env = Env::new(Some(EnvOptions {
        lo: -1.0,
        hi: 1.0,
        valence: 0,
    }));
    assert_eq!(env.get_symbol_prob("true"), 1.0);
    assert_eq!(env.get_symbol_prob("false"), -1.0);
    assert_eq!(env.get_symbol_prob("unknown"), 0.0);
    assert_eq!(env.get_symbol_prob("undefined"), 0.0);
}

#[test]
fn truth_const_survive_op_redef() {
    let results = run("(and: min)\n(or: max)\n(? true)\n(? false)", None);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 0.0);
}

// --- Liar paradox with truth constants ---

#[test]
fn truth_const_liar_paradox_01() {
    let results = run(
        r#"
(valence: 3)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

#[test]
fn truth_const_liar_paradox_balanced() {
    let results = run(
        r#"
(range: -1 1)
(valence: 3)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
"#,
        Some(EnvOptions {
            lo: -1.0,
            hi: 1.0,
            valence: 3,
        }),
    );
    assert_eq!(results[0], 0.0);
}

// ===== Belnap's four-valued logic operators: both, neither =====
// https://en.wikipedia.org/wiki/Four-valued_logic#Belnap

#[test]
fn operator_both_default_avg() {
    let results = run("(? (true both false))", None);
    assert_eq!(results[0], 0.5); // avg(1, 0) = 0.5
}

#[test]
fn operator_neither_default_product() {
    let results = run("(? (true neither false))", None);
    assert_eq!(results[0], 0.0); // product(1, 0) = 0
}

#[test]
fn operator_both_redefine_aggregator() {
    let results = run(
        r#"
(both: min)
(? (true both false))
"#,
        None,
    );
    assert_eq!(results[0], 0.0); // min(1, 0) = 0
}

#[test]
fn operator_neither_redefine_aggregator() {
    let results = run(
        r#"
(neither: max)
(? (true neither false))
"#,
        None,
    );
    assert_eq!(results[0], 1.0); // max(1, 0) = 1
}

#[test]
fn operator_both_env_has_op() {
    let env = Env::new(None);
    assert!(env.ops.contains_key("both"));
    assert!(env.ops.contains_key("neither"));
}

#[test]
fn operator_both_same_values() {
    let results = run(
        r#"
(? (true both true))
(? (false both false))
"#,
        None,
    );
    assert_eq!(results[0], 1.0); // avg(1, 1) = 1
    assert_eq!(results[1], 0.0); // avg(0, 0) = 0
}

#[test]
fn operator_neither_same_values() {
    let results = run(
        r#"
(? (true neither true))
(? (false neither false))
"#,
        None,
    );
    assert_eq!(results[0], 1.0); // product(1, 1) = 1
    assert_eq!(results[1], 0.0); // product(0, 0) = 0
}

#[test]
fn operator_both_fuzzy_values() {
    let results = run(
        r#"
(a: a is a)
(b: b is b)
((a = tall) has probability 0.8)
((b = tall) has probability 0.4)
(? ((a = tall) both (b = tall)))
"#,
        None,
    );
    assert_eq!(results[0], 0.6); // avg(0.8, 0.4) = 0.6
}

#[test]
fn operator_neither_fuzzy_values() {
    let results = run(
        r#"
(a: a is a)
(b: b is b)
((a = tall) has probability 0.8)
((b = tall) has probability 0.5)
(? ((a = tall) neither (b = tall)))
"#,
        None,
    );
    assert_eq!(results[0], 0.4); // product(0.8, 0.5) = 0.4
}

#[test]
fn operator_both_prefix_form() {
    let results = run("(? (both true false))", None);
    assert_eq!(results[0], 0.5); // avg(1, 0) = 0.5
}

#[test]
fn operator_neither_prefix_form() {
    let results = run("(? (neither true false))", None);
    assert_eq!(results[0], 0.0); // product(1, 0) = 0
}

#[test]
fn operator_both_composite_natural_language() {
    let results = run(
        r#"
(? (both true and false))
(? (both true and true))
(? (both false and false))
"#,
        None,
    );
    assert_eq!(results[0], 0.5); // avg(1, 0) = 0.5
    assert_eq!(results[1], 1.0); // avg(1, 1) = 1
    assert_eq!(results[2], 0.0); // avg(0, 0) = 0
}

#[test]
fn operator_neither_composite_natural_language() {
    let results = run(
        r#"
(? (neither true nor false))
(? (neither true nor true))
(? (neither false nor false))
"#,
        None,
    );
    assert_eq!(results[0], 0.0); // product(1, 0) = 0
    assert_eq!(results[1], 1.0); // product(1, 1) = 1
    assert_eq!(results[2], 0.0); // product(0, 0) = 0
}

#[test]
fn operator_both_composite_variadic() {
    let results = run("(? (both true and true and false))", None);
    assert!((results[0] - 0.666666666667).abs() < 0.0001); // avg(1, 1, 0)
}

#[test]
fn operator_neither_composite_variadic() {
    let results = run("(? (neither true nor true nor false))", None);
    assert_eq!(results[0], 0.0); // product(1, 1, 0) = 0
}

#[test]
fn operator_both_composite_redefinable() {
    let results = run(
        r#"
(both: min)
(? (both true and false))
"#,
        None,
    );
    assert_eq!(results[0], 0.0); // min(1, 0) = 0
}

#[test]
fn operator_neither_composite_redefinable() {
    let results = run(
        r#"
(neither: max)
(? (neither true nor false))
"#,
        None,
    );
    assert_eq!(results[0], 1.0); // max(1, 0) = 1
}

#[test]
fn operator_both_composite_issue_scenario() {
    let results = run(
        r#"
(a: a is a)
((a = a) has probability 1)
((a != a) has probability 0)
(? (both (a = a) and (a != a)))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

#[test]
fn operator_neither_composite_issue_scenario() {
    let results = run(
        r#"
(a: a is a)
((a = a) has probability 1)
((a != a) has probability 0)
(? (neither (a = a) nor (a != a)))
"#,
        None,
    );
    assert_eq!(results[0], 0.0);
}

#[test]
fn operator_both_range_change() {
    let results = run(
        r#"
(? (true both false))
(range: -1 1)
(? (true both false))
"#,
        None,
    );
    assert_eq!(results[0], 0.5); // avg(1, 0) = 0.5 in [0,1]
    assert_eq!(results[1], 0.0); // avg(1, -1) = 0 in [-1,1]
}

#[test]
fn operator_both_issue_scenario() {
    let results = run(
        r#"
(a: a is a)
((a = a) has probability 1)
((a != a) has probability 0)
(? ((a = a) both (a != a)))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

#[test]
fn operator_neither_issue_scenario() {
    let results = run(
        r#"
(a: a is a)
((a = a) has probability 1)
((a != a) has probability 0)
(? ((a = a) neither (a != a)))
"#,
        None,
    );
    assert_eq!(results[0], 0.0);
}

// ===== Standard logic examples =====

#[test]
fn example_classical_logic() {
    let results = run(
        r#"
(valence: 2)
(and: min)
(or: max)
(p: p is p)
(q: q is q)
((p = true) has probability 1)
((q = true) has probability 0)
(? (p = true))
(? (q = true))
(? (not (p = true)))
(? (not (q = true)))
(? ((p = true) and (q = true)))
(? ((p = true) or (q = true)))
(? ((p = true) or (not (p = true))))
(? ((p = true) and (not (p = true))))
(? (not (not (p = true))))
"#,
        None,
    );
    assert_eq!(results.len(), 9);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 0.0);
    assert_eq!(results[2], 0.0);
    assert_eq!(results[3], 1.0);
    assert_eq!(results[4], 0.0);
    assert_eq!(results[5], 1.0);
    assert_eq!(results[6], 1.0);
    assert_eq!(results[7], 0.0);
    assert_eq!(results[8], 1.0);
}

#[test]
fn example_propositional_logic() {
    let results = run(
        r#"
(and: product)
(or: probabilistic_sum)
(rain: rain is rain)
(umbrella: umbrella is umbrella)
(wet: wet is wet)
((rain = true) has probability 0.3)
((umbrella = true) has probability 0.6)
((wet = true) has probability 0.4)
(? (rain = true))
(? (umbrella = true))
(? ((rain = true) and (umbrella = true)))
(? ((rain = true) or (umbrella = true)))
(? (not (rain = true)))
(? (and (rain = true) (umbrella = true) (wet = true)))
(? (or (rain = true) (umbrella = true) (wet = true)))
"#,
        None,
    );
    assert_eq!(results.len(), 7);
    approx(results[0], 0.3);
    approx(results[1], 0.6);
    approx(results[2], 0.18);
    approx(results[3], 0.72);
    approx(results[4], 0.7);
    approx(results[5], 0.072);
    approx(results[6], 0.832);
}

#[test]
fn example_fuzzy_logic() {
    let results = run(
        r#"
(and: min)
(or: max)
(a: a is a)
(b: b is b)
(c: c is c)
((a = tall) has probability 0.8)
((b = tall) has probability 0.3)
((c = tall) has probability 0.6)
(? (a = tall))
(? (b = tall))
(? ((a = tall) and (b = tall)))
(? ((a = tall) or (b = tall)))
(? (not (a = tall)))
(? ((a = tall) and ((b = tall) or (c = tall))))
"#,
        None,
    );
    assert_eq!(results.len(), 6);
    approx(results[0], 0.8);
    approx(results[1], 0.3);
    approx(results[2], 0.3);
    approx(results[3], 0.8);
    approx(results[4], 0.2);
    approx(results[5], 0.6);
}

#[test]
fn example_belnap_four_valued() {
    let results = run(
        r#"
(and: min)
(or: max)
(? true)
(? false)
(? (not true))
(? (not false))
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
(? (true both false))
(? (true neither false))
(? (true both true))
(? (false both false))
(? (true neither true))
(? (false neither false))
"#,
        None,
    );
    assert_eq!(results.len(), 12);
    assert_eq!(results[0], 1.0); // true
    assert_eq!(results[1], 0.0); // false
    assert_eq!(results[2], 0.0); // not true
    assert_eq!(results[3], 1.0); // not false
    assert_eq!(results[4], 0.5); // liar paradox
    assert_eq!(results[5], 0.5); // not liar paradox
    assert_eq!(results[6], 0.5); // true both false = 0.5 (contradiction)
    assert_eq!(results[7], 0.0); // true neither false = 0 (gap)
    assert_eq!(results[8], 1.0); // true both true = 1
    assert_eq!(results[9], 0.0); // false both false = 0
    assert_eq!(results[10], 1.0); // true neither true = 1
    assert_eq!(results[11], 0.0); // false neither false = 0
}

// ===== Type System: "everything is a link" =====
// Dependent types as links: types are stored as associations in the link network.
// See: https://github.com/link-foundation/associative-dependent-logic/issues/13

// --- substitute (beta-reduction helper) ---

#[test]
fn subst_alias_matches_kernel_substitution_primitive() {
    let result = subst(&Node::Leaf("x".into()), "x", &Node::Leaf("y".into()));
    assert_eq!(result, Node::Leaf("y".into()));
}

#[test]
fn subst_variable_in_leaf() {
    let result = substitute(&Node::Leaf("x".into()), "x", &Node::Leaf("y".into()));
    assert_eq!(result, Node::Leaf("y".into()));
}

#[test]
fn subst_different_variable() {
    let result = substitute(&Node::Leaf("y".into()), "x", &Node::Leaf("z".into()));
    assert_eq!(result, Node::Leaf("y".into()));
}

#[test]
fn subst_in_list() {
    let result = substitute(
        &Node::List(vec![
            Node::Leaf("x".into()),
            Node::Leaf("+".into()),
            Node::Leaf("1".into()),
        ]),
        "x",
        &Node::Leaf("5".into()),
    );
    assert_eq!(
        result,
        Node::List(vec![
            Node::Leaf("5".into()),
            Node::Leaf("+".into()),
            Node::Leaf("1".into()),
        ])
    );
}

#[test]
fn subst_recursive_nested() {
    let result = substitute(
        &Node::List(vec![
            Node::Leaf("+".into()),
            Node::Leaf("x".into()),
            Node::List(vec![
                Node::Leaf("+".into()),
                Node::Leaf("x".into()),
                Node::Leaf("1".into()),
            ]),
        ]),
        "x",
        &Node::Leaf("5".into()),
    );
    assert_eq!(
        result,
        Node::List(vec![
            Node::Leaf("+".into()),
            Node::Leaf("5".into()),
            Node::List(vec![
                Node::Leaf("+".into()),
                Node::Leaf("5".into()),
                Node::Leaf("1".into()),
            ]),
        ])
    );
}

#[test]
fn subst_shadow_lambda_colon() {
    let expr = Node::List(vec![
        Node::Leaf("lambda".into()),
        Node::List(vec![Node::Leaf("x:".into()), Node::Leaf("Natural".into())]),
        Node::Leaf("x".into()),
    ]);
    let result = substitute(&expr, "x", &Node::Leaf("5".into()));
    assert_eq!(result, expr); // shadowed, no substitution
}

#[test]
fn subst_shadow_lambda_prefix() {
    let expr = Node::List(vec![
        Node::Leaf("lambda".into()),
        Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("x".into())]),
        Node::Leaf("x".into()),
    ]);
    let result = substitute(&expr, "x", &Node::Leaf("5".into()));
    assert_eq!(result, expr); // shadowed, no substitution
}

#[test]
fn subst_shadow_pi() {
    let expr = Node::List(vec![
        Node::Leaf("Pi".into()),
        Node::List(vec![Node::Leaf("x:".into()), Node::Leaf("Natural".into())]),
        Node::Leaf("x".into()),
    ]);
    let result = substitute(&expr, "x", &Node::Leaf("Boolean".into()));
    assert_eq!(result, expr); // shadowed
}

#[test]
fn subst_free_var_in_lambda() {
    let expr = Node::List(vec![
        Node::Leaf("lambda".into()),
        Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("y".into())]),
        Node::Leaf("x".into()),
    ]);
    let result = substitute(&expr, "x", &Node::Leaf("5".into()));
    assert_eq!(
        result,
        Node::List(vec![
            Node::Leaf("lambda".into()),
            Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("y".into()),]),
            Node::Leaf("5".into()),
        ])
    );
}

#[test]
fn subst_alpha_renames_lambda_binder_to_avoid_capture() {
    let expr = Node::List(vec![
        Node::Leaf("lambda".into()),
        Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("y".into())]),
        Node::List(vec![
            Node::Leaf("x".into()),
            Node::Leaf("+".into()),
            Node::Leaf("y".into()),
        ]),
    ]);
    let result = subst(&expr, "x", &Node::Leaf("y".into()));
    assert_eq!(
        result,
        Node::List(vec![
            Node::Leaf("lambda".into()),
            Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("y_1".into())]),
            Node::List(vec![
                Node::Leaf("y".into()),
                Node::Leaf("+".into()),
                Node::Leaf("y_1".into()),
            ]),
        ])
    );
}

#[test]
fn subst_alpha_renames_pi_binder_to_avoid_capture() {
    let expr = Node::List(vec![
        Node::Leaf("Pi".into()),
        Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("y".into())]),
        Node::List(vec![
            Node::Leaf("Vec".into()),
            Node::Leaf("x".into()),
            Node::Leaf("y".into()),
        ]),
    ]);
    let result = subst(&expr, "x", &Node::Leaf("y".into()));
    assert_eq!(
        result,
        Node::List(vec![
            Node::Leaf("Pi".into()),
            Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("y_1".into())]),
            Node::List(vec![
                Node::Leaf("Vec".into()),
                Node::Leaf("y".into()),
                Node::Leaf("y_1".into()),
            ]),
        ])
    );
}

#[test]
fn subst_alpha_renames_fresh_binder_to_avoid_capture() {
    let expr = Node::List(vec![
        Node::Leaf("fresh".into()),
        Node::Leaf("y".into()),
        Node::Leaf("in".into()),
        Node::List(vec![
            Node::Leaf("x".into()),
            Node::Leaf("+".into()),
            Node::Leaf("y".into()),
        ]),
    ]);
    let result = subst(&expr, "x", &Node::Leaf("y".into()));
    assert_eq!(
        result,
        Node::List(vec![
            Node::Leaf("fresh".into()),
            Node::Leaf("y_1".into()),
            Node::Leaf("in".into()),
            Node::List(vec![
                Node::Leaf("y".into()),
                Node::Leaf("+".into()),
                Node::Leaf("y_1".into()),
            ]),
        ])
    );
}

// --- Universe sorts ---

#[test]
fn type_universe_eval() {
    let mut env = Env::new(None);
    let result = eval_node(
        &Node::List(vec![Node::Leaf("Type".into()), Node::Leaf("0".into())]),
        &mut env,
    );
    assert_eq!(result.as_f64(), 1.0);
}

#[test]
fn type_universe_stores_type() {
    let mut env = Env::new(None);
    eval_node(
        &Node::List(vec![Node::Leaf("Type".into()), Node::Leaf("0".into())]),
        &mut env,
    );
    assert_eq!(env.get_type("(Type 0)"), Some(&"(Type 1)".to_string()));
}

#[test]
fn type_universe_level_1() {
    let mut env = Env::new(None);
    eval_node(
        &Node::List(vec![Node::Leaf("Type".into()), Node::Leaf("1".into())]),
        &mut env,
    );
    assert_eq!(env.get_type("(Type 1)"), Some(&"(Type 2)".to_string()));
}

#[test]
fn type_universe_via_run() {
    let results = run("(? (Type 0))", None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 1.0);
}

// --- Typed variable declarations ---

#[test]
fn typed_var_declare() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(x: Natural x)
(? (x of Natural))
"#,
        None,
    );
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 1.0);
}

#[test]
fn typed_var_wrong_type() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(x: Natural x)
(? (x of Boolean))
"#,
        None,
    );
    assert_eq!(results[0], 0.0);
}

#[test]
fn typed_var_multiple() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(x: Natural x)
(y: Boolean y)
(? (x of Natural))
(? (y of Boolean))
(? (x of Boolean))
"#,
        None,
    );
    assert_eq!(results.len(), 3);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
    assert_eq!(results[2], 0.0);
}

// --- Pi-types ---

#[test]
fn pi_type_eval() {
    let results = run("(? (Pi (Natural x) Natural))", None);
    assert_eq!(results[0], 1.0);
}

#[test]
fn pi_type_registers_in_env() {
    let mut env = Env::new(None);
    eval_node(
        &Node::List(vec![
            Node::Leaf("Pi".into()),
            Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("x".into())]),
            Node::Leaf("Natural".into()),
        ]),
        &mut env,
    );
    assert!(env.get_type("(Pi (Natural x) Natural)").is_some());
}

#[test]
fn pi_type_registers_param() {
    let mut env = Env::new(None);
    eval_node(
        &Node::List(vec![
            Node::Leaf("Pi".into()),
            Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("n".into())]),
            Node::List(vec![
                Node::Leaf("Vec".into()),
                Node::Leaf("n".into()),
                Node::Leaf("Boolean".into()),
            ]),
        ]),
        &mut env,
    );
    assert!(env.terms.contains("n"));
    assert_eq!(env.get_type("n"), Some(&"Natural".to_string()));
}

#[test]
fn pi_type_non_dependent() {
    let results = run("(? (Pi (Natural _) Boolean))", None);
    assert_eq!(results[0], 1.0);
}

// --- Lambda abstraction ---

#[test]
fn lambda_eval_valid() {
    let results = run("(? (lambda (Natural x) x))", None);
    assert_eq!(results[0], 1.0);
}

#[test]
fn lambda_stores_pi_type() {
    let mut env = Env::new(None);
    eval_node(
        &Node::List(vec![
            Node::Leaf("lambda".into()),
            Node::List(vec![Node::Leaf("Natural".into()), Node::Leaf("x".into())]),
            Node::Leaf("x".into()),
        ]),
        &mut env,
    );
    let t = env.get_type("(lambda (Natural x) x)");
    assert!(t.is_some());
    assert!(t.unwrap().contains("Pi"));
}

// --- Application with beta-reduction ---

#[test]
fn apply_beta_identity() {
    let results = run("(? (apply (lambda (Natural x) x) 0.5))", None);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], 0.5);
}

#[test]
fn apply_beta_arithmetic() {
    let results = run("(? (apply (lambda (Natural x) (x + 0.1)) 0.2))", None);
    assert_eq!(results[0], 0.3);
}

#[test]
fn apply_named_lambda() {
    let results = run(
        r#"
(identity: lambda (Natural x) x)
(? (apply identity 0.7))
"#,
        None,
    );
    assert_eq!(results[0], 0.7);
}

#[test]
fn apply_named_lambda_prefix() {
    let results = run(
        r#"
(identity: lambda (Natural x) x)
(? (identity 0.7))
"#,
        None,
    );
    assert_eq!(results[0], 0.7);
}

#[test]
fn apply_const_function() {
    let results = run("(? (apply (lambda (Natural x) 0.5) 0.9))", None);
    assert_eq!(results[0], 0.5);
}

// --- type check: (expr of Type) ---

#[test]
fn type_check_confirm() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(x: Natural x)
(? (x of Natural))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn type_check_reject() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(x: Natural x)
(? (x of Boolean))
"#,
        None,
    );
    assert_eq!(results[0], 0.0);
}

#[test]
fn type_check_universe() {
    let results = run(
        r#"
(Type 0)
(? ((Type 0) of (Type 1)))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

// --- type of query: (type of expr) ---

#[test]
fn type_of_query_typed_var() {
    let results = run_typed(
        r#"
(Natural: (Type 0) Natural)
(x: Natural x)
(? (type of x))
"#,
        None,
    );
    assert_eq!(results.len(), 1);
    assert_eq!(results[0], RunResult::Type("Natural".to_string()));
}

#[test]
fn type_of_query_untyped() {
    let results = run_typed(
        r#"
(a: a is a)
(? (type of a))
"#,
        None,
    );
    assert_eq!(results[0], RunResult::Type("unknown".to_string()));
}

// --- Encoding Lean/Rocq core concepts ---

#[test]
fn lean_natural_type_constructors() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(zero: Natural zero)
(succ: (Pi (Natural n) Natural))
(? (zero of Natural))
(? (Natural of (Type 0)))
"#,
        None,
    );
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
}

#[test]
fn lean_boolean_type_constructors() {
    let results = run(
        r#"
(Boolean: (Type 0) Boolean)
(true-val: Boolean true-val)
(false-val: Boolean false-val)
(? (true-val of Boolean))
(? (false-val of Boolean))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
}

#[test]
fn lean_identity_function_type() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(identity: (Pi (Natural x) Natural))
(? (identity of (Pi (Natural x) Natural)))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn types_with_probabilities() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(zero: Natural zero)
(? (zero of Natural))
((zero = zero) has probability 1)
(? (zero = zero))
"#,
        None,
    );
    assert_eq!(results.len(), 2);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
}

#[test]
fn define_and_apply_identity() {
    let results = run(
        r#"
(identity: lambda (Natural x) x)
(? (apply identity 0.5))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
}

// --- Backward compatibility ---

#[test]
fn backward_compat_term_defs() {
    let results = run(
        r#"
(a: a is a)
(? (a = a))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn backward_compat_probs() {
    let results = run(
        r#"
(a: a is a)
((a = a) has probability 0.7)
(? (a = a))
"#,
        None,
    );
    approx(results[0], 0.7);
}

#[test]
fn backward_compat_operators() {
    let results = run(
        r#"
(and: min)
(or: max)
(? (0.3 and 0.7))
(? (0.3 or 0.7))
"#,
        None,
    );
    assert_eq!(results[0], 0.3);
    assert_eq!(results[1], 0.7);
}

#[test]
fn backward_compat_liar() {
    let results = run(
        r#"
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
"#,
        None,
    );
    assert_eq!(results[0], 0.5);
    assert_eq!(results[1], 0.5);
}

#[test]
fn backward_compat_arithmetic() {
    let results = run("(? (0.1 + 0.2))", None);
    assert_eq!(results[0], 0.3);
}

#[test]
fn mixed_types_and_probabilistic() {
    let results = run(
        r#"
(a: a is a)
(Natural: (Type 0) Natural)
(x: Natural x)
((a = a) has probability 1)
(? (a = a))
(? (x of Natural))
(? (Type 0))
"#,
        None,
    );
    assert_eq!(results.len(), 3);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
    assert_eq!(results[2], 1.0);
}

// -------- Prefix type notation tests --------

#[test]
fn prefix_type_zero_natural() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(zero: Natural zero)
(? (zero of Natural))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn prefix_type_complex_type() {
    let results = run(
        r#"
(Type 0)
(Boolean: (Type 0) Boolean)
(? (Boolean of (Type 0)))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn prefix_type_multiple_constructors() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(zero: Natural zero)
(true-val: Boolean true-val)
(? (zero of Natural))
(? (true-val of Boolean))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
}

#[test]
fn prefix_type_with_pi_constructor() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(zero: Natural zero)
(succ: (Pi (Natural n) Natural))
(? (zero of Natural))
(? (succ of (Pi (Natural n) Natural)))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
}

#[test]
fn prefix_type_hierarchy() {
    let results = run(
        r#"
(Type 0)
(Type: (Type 0) Type)
(Boolean: Type Boolean)
(True: Boolean True)
(False: Boolean False)
(? (Boolean of Type))
(? (True of Boolean))
(? (False of Boolean))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
    assert_eq!(results[2], 1.0);
}

#[test]
fn lambda_multi_param() {
    let results = run(
        r#"
(Natural: (Type 0) Natural)
(? (lambda (Natural x, Natural y) (x + y)))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

// ===== Self-referential (Type: Type Type) — dynamic axiomatic system =====

#[test]
fn self_referential_type_type() {
    let results = run(
        r#"
(Type: Type Type)
(? (Type of Type))
"#,
        None,
    );
    assert_eq!(results[0], 1.0);
}

#[test]
fn self_referential_type_full_hierarchy() {
    let results = run(
        r#"
(Type: Type Type)
(Natural: Type Natural)
(Boolean: Type Boolean)
(zero: Natural zero)
(true-val: Boolean true-val)
(? (zero of Natural))
(? (Natural of Type))
(? (Boolean of Type))
(? (Type of Type))
"#,
        None,
    );
    assert_eq!(results.len(), 4);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
    assert_eq!(results[2], 1.0);
    assert_eq!(results[3], 1.0);
}

#[test]
fn self_referential_type_of_query() {
    let results = run_typed(
        r#"
(Type: Type Type)
(Natural: Type Natural)
(? (type of Natural))
(? (type of Type))
"#,
        None,
    );
    assert_eq!(results[0], RunResult::Type("Type".to_string()));
    assert_eq!(results[1], RunResult::Type("Type".to_string()));
}

#[test]
fn self_referential_type_coexists_with_universe_hierarchy() {
    let results = run(
        r#"
(Type: Type Type)
(Type 0)
(Type 1)
(Natural: (Type 0) Natural)
(Boolean: Type Boolean)
(zero: Natural zero)
(? (Type of Type))
(? (Natural of (Type 0)))
(? (Boolean of Type))
(? (zero of Natural))
(? ((Type 0) of (Type 1)))
"#,
        None,
    );
    assert_eq!(results.len(), 5);
    assert_eq!(results[0], 1.0);
    assert_eq!(results[1], 1.0);
    assert_eq!(results[2], 1.0);
    assert_eq!(results[3], 1.0);
    assert_eq!(results[4], 1.0);
}

#[test]
fn self_referential_type_liar_paradox_alongside() {
    let results = run(
        r#"
(Type: Type Type)
(Natural: Type Natural)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
(? (Natural of Type))
"#,
        None,
    );
    approx(results[0], 0.5);
    approx(results[1], 0.5);
    assert_eq!(results[2], 1.0);
}

#[test]
fn self_referential_type_paradox_resolution() {
    let results = run(
        r#"
(Type: Type Type)
(R: R is R)
((R = R) has probability 0.5)
(? (R = R))
(? (not (R = R)))
"#,
        None,
    );
    approx(results[0], 0.5);
    approx(results[1], 0.5);
}

// ──────────────────────────────────────────────────────────────
// Bayesian Inference and Bayesian Networks
// ──────────────────────────────────────────────────────────────

#[test]
fn bayesian_bayes_theorem_medical_diagnosis() {
    let results = run(
        r#"
(? (0.95 * 0.01))
(? ((0.95 * 0.01) + (0.05 * 0.99)))
(? ((0.95 * 0.01) / ((0.95 * 0.01) + (0.05 * 0.99))))
"#,
        None,
    );
    approx(results[0], 0.0095);
    approx(results[1], 0.059);
    assert!((results[2] - 0.161017).abs() < 1e-6);
}

#[test]
fn bayesian_probabilistic_and_product() {
    let results = run(
        r#"
(and: product)
(a: a is a)
(b: b is b)
(((a) = true) has probability 0.3)
(((b) = true) has probability 0.7)
(? (((a) = true) and ((b) = true)))
"#,
        None,
    );
    approx(results[0], 0.21);
}

#[test]
fn bayesian_probabilistic_or_probabilistic_sum() {
    let results = run(
        r#"
(or: probabilistic_sum)
(a: a is a)
(b: b is b)
(((a) = true) has probability 0.3)
(((b) = true) has probability 0.7)
(? (((a) = true) or ((b) = true)))
"#,
        None,
    );
    approx(results[0], 0.79);
}

#[test]
fn bayesian_joint_probability_product_and_probabilistic_sum() {
    let results = run(
        r#"
(and: product)
(or: probabilistic_sum)
(a: a is a)
(b: b is b)
(c: c is c)
(((a) = true) has probability 0.5)
(((b) = true) has probability 0.3)
(((c) = true) has probability 0.5)
(? (((a) = true) and ((b) = true)))
(? (((a) = true) or ((b) = true)))
(? (and ((a) = true) ((b) = true) ((c) = true)))
"#,
        None,
    );
    approx(results[0], 0.15);
    approx(results[1], 0.65);
    approx(results[2], 0.075);
}

#[test]
fn bayesian_network_chain_rule() {
    let results = run(
        r#"
(? (((0.99 * 0.15) + (0.9 * 0.15)) + ((0.9 * 0.35) + (0.01 * 0.35))))
"#,
        None,
    );
    assert!((results[0] - 0.602).abs() < 1e-6);
}

#[test]
fn bayesian_law_of_total_probability() {
    let results = run(
        r#"
(? ((0.8 * 0.4) + (0.3 * 0.6)))
"#,
        None,
    );
    approx(results[0], 0.5);
}

#[test]
fn bayesian_conditional_probability() {
    let results = run(
        r#"
(? ((0.8 * 0.4) / 0.5))
"#,
        None,
    );
    approx(results[0], 0.64);
}

#[test]
fn bayesian_independent_events() {
    let results = run(
        r#"
(and: product)
(coin1: coin1 is coin1)
(coin2: coin2 is coin2)
(((coin1) = heads) has probability 0.5)
(((coin2) = heads) has probability 0.5)
(? (((coin1) = heads) and ((coin2) = heads)))
"#,
        None,
    );
    approx(results[0], 0.25);
}

#[test]
fn bayesian_complement_rule() {
    let results = run(
        r#"
(a: a is a)
(((a) = true) has probability 0.7)
(? ((a) = true))
(? (not ((a) = true)))
"#,
        None,
    );
    approx(results[0], 0.7);
    approx(results[1], 0.3);
}

#[test]
fn bayesian_multi_node_prefix_and() {
    let results = run(
        r#"
(and: product)
(a: a is a)
(b: b is b)
(c: c is c)
(d: d is d)
(((a) = true) has probability 0.9)
(((b) = true) has probability 0.8)
(((c) = true) has probability 0.7)
(((d) = true) has probability 0.6)
(? (and ((a) = true) ((b) = true) ((c) = true) ((d) = true)))
"#,
        None,
    );
    approx(results[0], 0.3024);
}

// ──────────────────────────────────────────────────────────────
// Self-Reasoning (Meta-Logic)
// ──────────────────────────────────────────────────────────────

#[test]
fn self_reasoning_logic_properties() {
    let results = run_typed(
        r#"
(Type: Type Type)
(Logic: Type Logic)
(Property: Type Property)
(RML: Logic RML)
(supports_many_valued: Property supports_many_valued)
(((RML supports_many_valued) = true) has probability 1)
(? ((RML supports_many_valued) = true))
(? (RML of Logic))
(? (Logic of Type))
(? (type of RML))
"#,
        None,
    );
    assert_eq!(results[0], RunResult::Num(1.0));
    assert_eq!(results[1], RunResult::Num(1.0));
    assert_eq!(results[2], RunResult::Num(1.0));
    assert_eq!(results[3], RunResult::Type("Logic".to_string()));
}

#[test]
fn self_reasoning_compare_logics() {
    let results = run(
        r#"
(Type: Type Type)
(Logic: Type Logic)
(RML: Logic RML)
(Classical: Logic Classical)
(((RML supports_self_reference) = true) has probability 1)
(((Classical supports_self_reference) = true) has probability 0)
(? ((RML supports_self_reference) = true))
(? ((Classical supports_self_reference) = true))
"#,
        None,
    );
    approx(results[0], 1.0);
    approx(results[1], 0.0);
}

#[test]
fn self_reasoning_paradox_resolution() {
    let results = run(
        r#"
(Type: Type Type)
(Logic: Type Logic)
(RML: Logic RML)
(liar: liar is liar)
((liar = false) has probability 0.5)
(? (liar = false))
(? (not (liar = false)))
(? (RML of Logic))
"#,
        None,
    );
    approx(results[0], 0.5);
    approx(results[1], 0.5);
    approx(results[2], 1.0);
}

// ──────────────────────────────────────────────────────────────
// Comprehensive valence coverage (0 to ∞)
// ──────────────────────────────────────────────────────────────

#[test]
fn valence_0_continuous() {
    let results = run(
        r#"
(valence: 0)
(a: a is a)
(((a) = true) has probability 0.123456)
(? ((a) = true))
"#,
        None,
    );
    approx(results[0], 0.123456);
}

#[test]
fn valence_1_unary() {
    let results = run(
        r#"
(valence: 1)
(a: a is a)
(((a) = true) has probability 0.7)
(? ((a) = true))
"#,
        None,
    );
    approx(results[0], 0.7);
}

#[test]
fn valence_6_six_valued() {
    let results = run(
        r#"
(valence: 6)
(a: a is a)
(((a) = true) has probability 0.33)
(? ((a) = true))
(((a) = true) has probability 0.71)
(? ((a) = true))
"#,
        None,
    );
    approx(results[0], 0.4);
    approx(results[1], 0.8);
}

#[test]
fn valence_7_seven_valued() {
    let results = run(
        r#"
(valence: 7)
(a: a is a)
(((a) = true) has probability 0.5)
(? ((a) = true))
"#,
        None,
    );
    approx(results[0], 0.5);
}

#[test]
fn valence_10_ten_valued() {
    let results = run(
        r#"
(valence: 10)
(a: a is a)
(((a) = true) has probability 0.3)
(? ((a) = true))
(((a) = true) has probability 0.77)
(? ((a) = true))
"#,
        None,
    );
    assert!((results[0] - 1.0 / 3.0).abs() < 1e-6);
    assert!((results[1] - 7.0 / 9.0).abs() < 1e-6);
}

#[test]
fn valence_100_hundred_valued() {
    let results = run(
        r#"
(valence: 100)
(a: a is a)
(((a) = true) has probability 0.505)
(? ((a) = true))
"#,
        None,
    );
    assert!((results[0] - 50.0 / 99.0).abs() < 1e-4);
}

#[test]
fn valence_1000_thousand_valued() {
    let results = run(
        r#"
(valence: 1000)
(a: a is a)
(((a) = true) has probability 0.333)
(? ((a) = true))
"#,
        None,
    );
    assert!((results[0] - 333.0 / 999.0).abs() < 1e-3);
}

#[test]
fn valence_6_balanced_range() {
    let results = run(
        r#"
(range: -1 1)
(valence: 6)
(a: a is a)
(((a) = true) has probability 0.15)
(? ((a) = true))
"#,
        None,
    );
    approx(results[0], 0.2);
}

#[test]
fn valence_2_binary_with_product_and_probabilistic_sum() {
    let results = run(
        r#"
(valence: 2)
(and: product)
(or: probabilistic_sum)
(a: a is a)
(b: b is b)
(((a) = true) has probability 0.8)
(((b) = true) has probability 0.6)
(? (((a) = true) and ((b) = true)))
(? (((a) = true) or ((b) = true)))
"#,
        None,
    );
    approx(results[0], 1.0);
    approx(results[1], 1.0);
}

#[test]
fn valence_3_ternary_with_bayesian_product() {
    let results = run(
        r#"
(valence: 3)
(and: product)
(a: a is a)
(b: b is b)
(((a) = true) has probability 0.5)
(((b) = true) has probability 0.5)
(? (((a) = true) and ((b) = true)))
"#,
        None,
    );
    approx(results[0], 0.5);
}

// ──────────────────────────────────────────────────────────────
// Markov Chains with Dependent Probabilities
// ──────────────────────────────────────────────────────────────

#[test]
fn markov_chain_one_step_sunny() {
    // P(Sunny at t+1) = P(S→S)*P(S) + P(R→S)*P(R) = 0.8*0.7 + 0.4*0.3
    let results = run("(? ((0.8 * 0.7) + (0.4 * 0.3)))", None);
    approx(results[0], 0.68);
}

#[test]
fn markov_chain_one_step_rainy() {
    // P(Rainy at t+1) = P(S→R)*P(S) + P(R→R)*P(R) = 0.2*0.7 + 0.6*0.3
    let results = run("(? ((0.2 * 0.7) + (0.6 * 0.3)))", None);
    approx(results[0], 0.32);
}

#[test]
fn markov_chain_two_step() {
    // Two-step transition
    let results = run(
        r#"
(? ((0.8 * 0.68) + (0.4 * 0.32)))
(? ((0.2 * 0.68) + (0.6 * 0.32)))
"#,
        None,
    );
    approx(results[0], 0.672);
    approx(results[1], 0.328);
}

#[test]
fn markov_chain_joint_probability() {
    // P(Sunny_t, Sunny_t+1) = P(S→S) * P(S_t) = 0.8 * 0.7
    let results = run(
        r#"
(and: product)
(? (0.8 and 0.7))
"#,
        None,
    );
    approx(results[0], 0.56);
}

#[test]
fn markov_chain_stationary_distribution() {
    // Stationary: pi(S) = 2/3, pi(R) = 1/3
    // Verify: pi(S)*P(S→S) + pi(R)*P(R→S) = pi(S)
    let results = run(
        r#"
(? ((0.8 * 0.666667) + (0.4 * 0.333333)))
(? ((0.2 * 0.666667) + (0.6 * 0.333333)))
"#,
        None,
    );
    assert!((results[0] - 2.0 / 3.0).abs() < 1e-4);
    assert!((results[1] - 1.0 / 3.0).abs() < 1e-4);
}

#[test]
fn markov_chain_conditional_transitions_with_links() {
    // Model transitions using linked probabilities
    let results = run(
        r#"
(and: product)
(or: probabilistic_sum)
(sunny: sunny is sunny)
(rainy: rainy is rainy)
(((sunny) = true) has probability 0.7)
(((rainy) = true) has probability 0.3)

# Joint: P(sunny AND rainy) should be 0.7*0.3 = 0.21
(? (((sunny) = true) and ((rainy) = true)))

# Union: P(sunny OR rainy) = 1-(1-0.7)*(1-0.3) = 0.79
(? (((sunny) = true) or ((rainy) = true)))
"#,
        None,
    );
    approx(results[0], 0.21);
    approx(results[1], 0.79);
}

// ──────────────────────────────────────────────────────────────
// Cyclic Markov Networks
// ──────────────────────────────────────────────────────────────

#[test]
fn markov_network_pairwise_joint() {
    // Three nodes forming a cycle: Alice—Bob—Carol—Alice
    let results = run(
        r#"
(and: product)
(alice: alice is alice)
(bob: bob is bob)
(carol: carol is carol)
(((alice) = agree) has probability 0.7)
(((bob) = agree) has probability 0.5)
(((carol) = agree) has probability 0.6)
(? (((alice) = agree) and ((bob) = agree)))
(? (((bob) = agree) and ((carol) = agree)))
(? (((carol) = agree) and ((alice) = agree)))
"#,
        None,
    );
    approx(results[0], 0.35);
    approx(results[1], 0.3);
    approx(results[2], 0.42);
}

#[test]
fn markov_network_three_way_clique() {
    let results = run(
        r#"
(and: product)
(alice: alice is alice)
(bob: bob is bob)
(carol: carol is carol)
(((alice) = agree) has probability 0.7)
(((bob) = agree) has probability 0.5)
(((carol) = agree) has probability 0.6)
(? (and ((alice) = agree) ((bob) = agree) ((carol) = agree)))
"#,
        None,
    );
    approx(results[0], 0.21);
}

#[test]
fn markov_network_union() {
    let results = run(
        r#"
(or: probabilistic_sum)
(alice: alice is alice)
(bob: bob is bob)
(carol: carol is carol)
(((alice) = agree) has probability 0.7)
(((bob) = agree) has probability 0.5)
(((carol) = agree) has probability 0.6)
(? (or ((alice) = agree) ((bob) = agree) ((carol) = agree)))
"#,
        None,
    );
    approx(results[0], 0.94);
}

#[test]
fn markov_network_unnormalized_clique_potential() {
    // φ(A,B) * φ(B,C) * φ(C,A) = 0.8 * 0.7 * 0.6
    let results = run("(? ((0.8 * 0.7) * 0.6))", None);
    approx(results[0], 0.336);
}

#[test]
fn markov_network_normalized_probability() {
    // P(config) = unnormalized / Z = 0.336 / 2.5
    let results = run("(? (0.336 / 2.5))", None);
    approx(results[0], 0.1344);
}
