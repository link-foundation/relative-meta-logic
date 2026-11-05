use rml::{
    check, emit_lino_term, eval_node, evaluate, formalize_selected_interpretation, goal_to_tptp,
    key_of, parse_binding, parse_bindings, parse_one, subst, synth, tokenize_one, Env, FormalizationRequest,
    Interpretation, Node, ProofAssumption, ProofGoal, ProofObject, ProofRule, RunResult,
};

fn leaf(s: &str) -> Node {
    Node::Leaf(s.to_string())
}
fn list(nodes: Vec<Node>) -> Node {
    Node::List(nodes)
}
fn read(source: &str) -> Node {
    match parse_one(&tokenize_one(&format!("({source})"))).unwrap() {
        Node::List(mut nodes) if nodes.len() == 1 => nodes.remove(0),
        other => panic!("not one term: {other:?}"),
    }
}
fn labels() -> [&'static str; 14] {
    [
        "(a b)",
        "a b",
        "\"a\"",
        "'a'",
        "~1{61}",
        "",
        "\0",
        "\r\n",
        "😀",
        "é",
        "label:",
        "label::",
        "label,",
        "text#inside",
    ]
}

#[test]
fn typed_environment_preserves_ast_shape_and_independent_type_values() {
    let mut env = Env::new(None);
    assert_eq!(key_of(&leaf("(a b)")), key_of(&read("(a b)")));
    for label in labels() {
        let name = leaf(label);
        let typ = list(vec![leaf("TypeOf"), leaf(label)]);
        env.set_type_node(&name, &typ);
        assert_eq!(read(env.get_type_node(&name).unwrap()), typ);
        assert!(env.get_type_node(&list(vec![name.clone()])).is_none());
        assert_eq!(synth(&name, &mut env).typ, Some(typ));
        assert!(
            !check(
                &name,
                &list(vec![leaf("TypeOf"), list(vec![name.clone()])]),
                &mut env
            )
            .ok
        );
        env.set_type_node(&leaf("holder"), &name);
        let result = synth(&leaf("holder"), &mut env);
        assert_eq!(result.typ, Some(name.clone()));
        assert!(result.diagnostics.is_empty());
        assert!(check(&leaf("holder"), &name, &mut env).ok);
        assert!(!check(&leaf("holder"), &list(vec![name.clone()]), &mut env).ok);
    }
    assert!(env.get_type_node(&read("(a b)")).is_none());
    let term = list(vec![leaf("pair"), leaf("a b")]);
    env.set_type_node(&term, &leaf("(Type 0)"));
    assert!(env.get_type_node(&read("(pair a b)")).is_none());
    assert_eq!(synth(&term, &mut env).typ, Some(leaf("(Type 0)")));
    assert!(!check(&term, &read("(Type 0)"), &mut env).ok);
    let mut term = read("(mutable (before))");
    let mut typ = read("(Result (before))");
    env.set_type_node(&term, &typ);
    if let Node::List(nodes) = &mut term {
        nodes[1] = read("(after)");
    }
    if let Node::List(nodes) = &mut typ {
        nodes[1] = read("(after)");
    }
    assert!(env.get_type_node(&term).is_none());
    assert_eq!(
        read(env.get_type_node(&read("(mutable (before))")).unwrap()),
        read("(Result (before))")
    );
}

#[test]
fn serialized_compatibility_api_retains_source_semantics() {
    let mut env = Env::new(None);
    env.set_type("(a b)", "(Type 0)");
    assert!(env.get_type_node(&leaf("(a b)")).is_none());
    assert_eq!(env.get_type("(a b)").map(String::as_str), Some("(Type 0)"));
    assert_eq!(synth(&read("(a b)"), &mut env).typ, Some(read("(Type 0)")));
    assert!(synth(&leaf("(a b)"), &mut env).typ.is_none());
    env.set_type("'quoted atom'", "~1{546167}");
    assert_eq!(
        env.get_type_node(&leaf("quoted atom")).map(String::as_str),
        Some("Tag")
    );
    env.set_type("not one term", "Raw type");
    assert_eq!(
        read(env.get_type_node(&leaf("not one term")).unwrap()),
        leaf("Raw type")
    );
}

#[test]
fn declarations_reject_display_colliding_source_mutations() {
    for label in labels() {
        let reference = emit_lino_term(&leaf(label));
        let source = format!("({reference}: (Tag {reference}) {reference})\n(? ({reference} of (Tag {reference})))\n(? (({reference}) of (Tag {reference})))\n(? ({reference} of (Tag ({reference}))))");
        let result = evaluate(&source, None, None);
        assert!(
            result.diagnostics.is_empty(),
            "{label:?}: {:?}",
            result.diagnostics
        );
        assert_eq!(
            result.results,
            vec![
                RunResult::Num(1.0),
                RunResult::Num(0.0),
                RunResult::Num(0.0)
            ],
            "{label:?}"
        );
    }
    let result = evaluate(
        "('(a b)': (Type 0) '(a b)')\n(? ('(a b)' of (Type 0)))\n(? ((a b) of (Type 0)))",
        None,
        None,
    );
    assert_eq!(
        result.results,
        vec![RunResult::Num(1.0), RunResult::Num(0.0)]
    );
}

#[test]
fn lambda_and_pi_preserve_exact_binders_domains_and_scopes() {
    for label in labels() {
        let mut env = Env::new(None);
        let domain = leaf("(Domain x)");
        let original = list(vec![leaf("Original"), leaf(label)]);
        env.set_type_node(&leaf(label), &original);
        env.set_type_node(&read("(a b)"), &leaf("Other"));
        let lambda = list(vec![
            leaf("lambda"),
            list(vec![leaf(&format!("{label}:")), domain.clone()]),
            leaf(label),
        ]);
        let expected = list(vec![
            leaf("Pi"),
            list(vec![leaf(&format!("{label}:")), domain.clone()]),
            domain,
        ]);
        assert_eq!(
            synth(&lambda, &mut env).typ,
            Some(expected.clone()),
            "{label:?}"
        );
        let wrong = list(vec![
            leaf("Pi"),
            list(vec![leaf(&format!("{label}:")), read("(Domain x)")]),
            read("(Domain x)"),
        ]);
        assert!(!check(&lambda, &wrong, &mut env).ok);
        assert_eq!(read(env.get_type_node(&leaf(label)).unwrap()), original);
        let Node::List(parts) = &lambda else {
            unreachable!()
        };
        let mut definition = vec![leaf("fn:")];
        definition.extend(parts.clone());
        eval_node(&list(definition), &mut env);
        assert_eq!(read(env.get_type_node(&leaf("fn")).unwrap()), expected);
        assert_eq!(read(env.get_type_node(&leaf(label)).unwrap()), original);
        assert_eq!(env.get_type("(a b)").map(String::as_str), Some("Other"));
        eval_node(&lambda, &mut env);
        assert_eq!(read(env.get_type_node(&lambda).unwrap()), expected);
    }
}

#[test]
fn proof_reports_and_formalization_reconstruct_exact_ast() {
    for label in labels() {
        let mut env = Env::new(None);
        let claim = list(vec![leaf("holds"), leaf(label)]);
        env.register_proof_rule(ProofRule {
            name: "copy".into(),
            premises: vec![claim.clone()],
            conclusion: claim.clone(),
        });
        env.register_proof_assumption(ProofAssumption {
            name: "given".into(),
            kind: "axiom".into(),
            judgement: claim.clone(),
        });
        env.register_proof_object(ProofObject {
            name: "proof".into(),
            rule: "copy".into(),
            premises: vec![claim.clone()],
            premise_refs: vec!["given".into()],
            conclusion: claim.clone(),
        });
        let snapshot = env.foundation_report();
        let report = env.proof_report("proof");
        assert!(report.verdict.ok);
        for source in [
            &snapshot.proof_rules[0].conclusion,
            &snapshot.proof_rules[0].premises[0],
            &snapshot.proof_assumptions[0].judgement,
            &snapshot.proof_objects[0].conclusion,
            report.conclusion.as_ref().unwrap(),
            &report.premises[0],
            report.dependencies[0].judgement.as_ref().unwrap(),
        ] {
            assert_eq!(read(source), claim);
        }
        let ast = list(vec![
            leaf("?"),
            list(vec![leaf(label), leaf("="), leaf(label)]),
        ]);
        let source = emit_lino_term(&ast);
        let formal = formalize_selected_interpretation(FormalizationRequest {
            text: "exact references".into(),
            interpretation: Interpretation::lino(&source),
            formal_system: "rml".into(),
            dependencies: vec![],
        });
        assert!(formal.computable);
        assert_eq!(formal.ast, Some(ast.clone()));
        assert_eq!(read(formal.lino.as_ref().unwrap()), ast);
        assert_eq!(
            evaluate(formal.lino.as_ref().unwrap(), None, None).results,
            vec![RunResult::Num(1.0)]
        );
    }
}

#[test]
fn tptp_preserves_symbols_terms_and_bound_variable_identity() {
    let export = |node| {
        goal_to_tptp(&ProofGoal {
            goal: node,
            context: vec![],
        })
        .unwrap()
    };
    for (left, right) in [
        (leaf("a b"), leaf("a_b")),
        (leaf("P"), leaf("p")),
        (leaf("x"), leaf("X")),
        (leaf(""), leaf("_")),
        (leaf("😀"), leaf("é")),
        (leaf("rml_hex_50"), leaf("P")),
        (leaf("num_1"), leaf("1")),
        (leaf("(a b)"), read("(a b)")),
        (leaf("(a)"), read("(a)")),
    ] {
        let output = export(list(vec![left, leaf("="), right]));
        let equation = output
            .split("conjecture, (")
            .nth(1)
            .unwrap()
            .split(")).")
            .next()
            .unwrap();
        let (lhs, rhs) = equation.split_once(" = ").unwrap();
        assert_ne!(lhs, rhs, "{output}");
    }
    for label in labels() {
        let atom = export(list(vec![leaf("value"), leaf("of"), leaf(label)]));
        let compound = export(list(vec![
            leaf("value"),
            leaf("of"),
            list(vec![leaf(label)]),
        ]));
        assert_ne!(atom, compound);
        assert_eq!(export(list(vec![leaf(label), leaf("value")])), atom);
    }
    let output = export(read("(forall (T x) (exists (T X) (x = X)))"));
    assert!(output.contains("![V_rml_hex_78]"));
    assert!(output.contains("?[X]"));
    assert!(output.contains("V_rml_hex_78 = X"));
}

#[test]
fn namespace_aliases_and_nested_scopes_preserve_atomic_keys() {
    for label in labels() {
        let mut env = Env::new(None);
        env.namespace = Some("ns".into());
        env.aliases.insert("alias".into(), "ns".into());
        let original = list(vec![leaf("Original"), leaf(label)]);
        env.set_type_node(&leaf(&format!("ns.{label}")), &original);
        assert_eq!(read(env.get_type_node(&leaf(label)).unwrap()), original);
        assert_eq!(
            read(env.get_type_node(&leaf(&format!("alias.{label}"))).unwrap()),
            original
        );
        assert!(env.get_type_node(&list(vec![leaf(label)])).is_none());
        assert_eq!(
            env.get_type(&emit_lino_term(&leaf(&format!("alias.{label}")))),
            env.get_type_node(&leaf(label))
        );
        let inner = list(vec![
            leaf("lambda"),
            list(vec![leaf(&format!("{label}:")), leaf("Inner")]),
            leaf(label),
        ]);
        let outer = list(vec![
            leaf("lambda"),
            list(vec![leaf(&format!("{label}:")), leaf("Outer")]),
            inner,
        ]);
        let expected_inner = list(vec![
            leaf("Pi"),
            list(vec![leaf("Inner"), leaf(label)]),
            leaf("Inner"),
        ]);
        assert_eq!(
            synth(&outer, &mut env).typ,
            Some(list(vec![
                leaf("Pi"),
                list(vec![leaf("Outer"), leaf(label)]),
                expected_inner
            ]))
        );
        assert_eq!(read(env.get_type_node(&leaf(label)).unwrap()), original);
        assert!(
            !env.types.contains_key(&emit_lino_term(&leaf(label))),
            "unqualified binding leaked"
        );
        eval_node(
            &list(vec![
                leaf("named:"),
                leaf("lambda"),
                list(vec![leaf(&format!("{label}:")), leaf("Local")]),
                leaf(label),
            ]),
            &mut env,
        );
        assert!(
            !env.types.contains_key(&emit_lino_term(&leaf(label))),
            "namespace fallback leaked"
        );
        assert_eq!(read(env.get_type_node(&leaf(label)).unwrap()), original);
    }
}

#[test]
fn capture_avoidance_preserves_arbitrary_names_and_external_type_atoms() {
    for name in labels() {
        let binder = list(vec![
            leaf("lambda"),
            list(vec![leaf(&format!("{name}:")), leaf(name)]),
            leaf("free"),
        ]);
        let result = subst(&binder, "free", &leaf(name));
        let Node::List(parts) = &result else {
            panic!("lambda expected")
        };
        let Node::List(binding) = &parts[1] else {
            panic!("binding expected")
        };
        assert_eq!(binding[1], leaf(name), "external type changed");
        assert_eq!(parts[2], leaf(name), "replacement captured");
        assert_ne!(
            binding[0],
            leaf(&format!("{name}:")),
            "binder must avoid capture"
        );
        assert_eq!(read(&emit_lino_term(&result)), result);
    }
}

#[test]
fn inferred_pi_types_remain_usable_with_arbitrary_domain_atoms_and_punctuation_names() {
    for domain in labels().into_iter().chain(["Carrier:", "Carrier"]) {
        for name in [
            "parameter:",
            "parameter::",
            if domain.is_empty() {
                "empty-domain-parameter:"
            } else {
                ""
            },
        ] {
            let mut env = Env::new(None);
            let lambda = list(vec![
                leaf("lambda"),
                list(vec![leaf(&format!("{name}:")), leaf(domain)]),
                leaf(name),
            ]);
            let inferred = synth(&lambda, &mut env);
            assert!(inferred.diagnostics.is_empty());
            let typ = inferred.typ.unwrap();
            assert!(check(&lambda, &typ, &mut env).ok);
            env.set_type_node(&leaf("argument"), &leaf(domain));
            env.set_type_node(&leaf("function"), &typ);
            let application = list(vec![leaf("apply"), leaf("function"), leaf("argument")]);
            assert_eq!(synth(&application, &mut env).typ, Some(leaf(domain)));
            env.set_type_node(&leaf("argument"), &list(vec![leaf(domain)]));
            assert!(synth(&application, &mut env).typ.is_none());
        }
    }
}

#[test]
fn generated_corecursor_accepts_a_literal_state_type_without_capture_or_aliasing() {
    let mut env = Env::new(None);
    let result = rml::evaluate_with_env("(Natural: (Type 0) Natural)\n(coinductive Stream (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))", None, &mut env);
    assert!(result.diagnostics.is_empty());
    env.set_type_node(&leaf("State:"), &read("(Type 0)"));
    let partial = list(vec![leaf("apply"), leaf("Stream-corec"), leaf("State:")]);
    let inferred = synth(&partial, &mut env);
    assert!(inferred.diagnostics.is_empty());
    let Node::List(parts) = inferred.typ.unwrap() else {
        panic!("Pi expected")
    };
    let step_type = read(&parse_binding(&parts[1]).unwrap().1);
    let Node::List(step_parts) = &step_type else {
        panic!("step Pi expected")
    };
    assert_eq!(
        read(&parse_binding(&step_parts[1]).unwrap().1),
        leaf("State:")
    );
    env.set_type_node(&leaf("step"), &step_type);
    env.set_type_node(&leaf("seed"), &leaf("State:"));
    let application = list(vec![
        leaf("apply"),
        list(vec![leaf("apply"), partial, leaf("step")]),
        leaf("seed"),
    ]);
    let result = synth(&application, &mut env);
    assert!(result.diagnostics.is_empty());
    assert_eq!(result.typ, Some(leaf("Stream")));
    env.set_type_node(&leaf("seed"), &list(vec![leaf("State:")]));
    assert!(synth(&application, &mut env).typ.is_none());
}

#[test]
fn unicode_prefix_type_binders_preserve_exact_names_and_match_javascript() {
    let cases: serde_json::Value = serde_json::from_str(include_str!("../../test-corpus/lino-frontend/unicode-type-bindings.json")).unwrap();
    let parameter = cases["parameter"].as_str().unwrap();
    let upper = cases["uppercase"].as_array().unwrap();
    let lower = cases["lowercase"].as_array().unwrap();
    for (index, domain) in upper.iter().enumerate() {
        let domain = domain.as_str().unwrap();
        assert_eq!(parse_binding(&list(vec![leaf(domain), leaf(parameter)])), Some((parameter.to_string(), emit_lino_term(&leaf(domain)))));
        assert_eq!(parse_bindings(&list(vec![leaf(domain), leaf("x,"), leaf(domain), leaf("y")])), Some(vec![("x".to_string(), emit_lino_term(&leaf(domain))), ("y".to_string(), emit_lino_term(&leaf(domain)))]));
        let lambda = list(vec![leaf("lambda"), list(vec![leaf(domain), leaf(parameter)]), leaf(parameter)]);
        assert_eq!(read(&emit_lino_term(&lambda)), lambda);
        let mut env = Env::new(None);
        let inferred = synth(&lambda, &mut env);
        assert!(inferred.diagnostics.is_empty(), "{domain}");
        let typ = inferred.typ.unwrap();
        assert!(check(&lambda, &typ, &mut env).ok);
        env.set_type_node(&leaf("function"), &typ);
        env.set_type_node(&leaf("argument"), &leaf(domain));
        let application = list(vec![leaf("apply"), leaf("function"), leaf("argument")]);
        assert_eq!(synth(&application, &mut env).typ, Some(leaf(domain)));
        env.set_type_node(&leaf("argument"), &leaf(lower[index].as_str().unwrap()));
        assert!(synth(&application, &mut env).typ.is_none());
    }
    for domain in lower {
        let domain = domain.as_str().unwrap();
        assert!(parse_binding(&list(vec![leaf(domain), leaf(parameter)])).is_none());
        assert!(parse_bindings(&list(vec![leaf(domain), leaf("x,"), leaf(domain), leaf("y")])).is_none());
    }
    for domain in upper.iter().chain(lower) {
        let domain = domain.as_str().unwrap();
        let binding = list(vec![leaf(&format!("{parameter}:")), leaf(domain)]);
        assert_eq!(parse_binding(&binding), Some((parameter.to_string(), emit_lino_term(&leaf(domain)))));
        let lambda = list(vec![leaf("lambda"), binding, leaf(parameter)]);
        let mut env = Env::new(None);
        let inferred = synth(&read(&emit_lino_term(&lambda)), &mut env);
        assert!(inferred.diagnostics.is_empty());
        let typ = inferred.typ.unwrap();
        assert!(check(&lambda, &typ, &mut env).ok);
        let Node::List(parts) = typ else { panic!("Pi expected") };
        assert_eq!(read(&parse_binding(&parts[1]).unwrap().1), leaf(domain));
    }
}
