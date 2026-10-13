use rml::lino_frontend::{parse_lino_link_document, format_parsed_link};
use links_notation::{decode_reference_literal, encode_reference_literal, LiNo};
use serde_json::Value;
fn fixture() -> Value { serde_json::from_str(include_str!("../../test-corpus/lino-frontend/reference-literals.json")).unwrap() }
#[test]
fn released_reference_literals_preserve_exact_values() {
    for value in fixture()["labels"].as_array().unwrap() {
        let label = value.as_str().unwrap();
        let literal = encode_reference_literal(label);
        assert_eq!(decode_reference_literal(&literal).unwrap(), label);
        for spelling in [literal, LiNo::Ref(label.to_string()).to_string()] {
            let parsed = parse_lino_link_document(&format!("(head {spelling} tail)")).unwrap();
            assert_eq!(parsed[0].1.values[1].id.as_deref(), Some(label));
            let named = parse_lino_link_document(&format!("({spelling}: tail)")).unwrap();
            assert_eq!(named[0].1.id.as_deref(), Some(label));
            let replay = parse_lino_link_document(&format_parsed_link(&parsed[0].1)).unwrap();
            assert_eq!(replay[0].1, parsed[0].1);
        }
    }
}
#[test]
fn malformed_literals_are_located_errors() {
    for literal in fixture()["invalid"].as_array().unwrap() {
        let literal = literal.as_str().unwrap();
        assert!(decode_reference_literal(literal).is_err());
        let error = parse_lino_link_document(&format!("(a {literal})")).unwrap_err();
        assert_eq!((error.line, error.col), (1, 4), "{literal}");
    }
}
#[test]
fn decoded_references_never_alias_internal_placeholders() {
    for label in ["\u{e000}\u{e000}q0", "\u{e000}\u{e000}g0"] {
        let literal = encode_reference_literal(label);
        let parsed = parse_lino_link_document(&format!("({literal} (a (b c)))")).unwrap();
        assert_eq!(parsed[0].1.values[0].id.as_deref(), Some(label));
        assert_eq!(parsed[0].1.values[1].values[0].id.as_deref(), Some("a"));
    }
}

use rml::{emit_lino_term, evaluate_with_options, EvaluateOptions, parse_one, tokenize_one, match_proof_pattern, Node};
use rml::check::check_program;
fn leaf(value: &str) -> Node { Node::Leaf(value.to_string()) }
#[test]
fn semantic_lexer_and_emitter_preserve_reference_identity() {
    for label in fixture()["labels"].as_array().unwrap() {
        let label = label.as_str().unwrap();
        let ast = Node::List(vec![leaf("head"), leaf(label), Node::List(vec![leaf(label), leaf("tail")])]);
        assert_eq!(parse_one(&tokenize_one(&emit_lino_term(&ast))).unwrap(), ast);
    }
    assert_ne!(emit_lino_term(&leaf("(a b)")), emit_lino_term(&Node::List(vec![leaf("a"),leaf("b")])));
    for literal in fixture()["invalid"].as_array().unwrap() {
        assert!(rml::lino_frontend::tokenize_lino_form(&format!("(head {})", literal.as_str().unwrap())).is_err());
    }
}
#[test]
fn evaluations_and_proof_replay_retain_exact_references() {
    for label in fixture()["labels"].as_array().unwrap() {
        let spelling = encode_reference_literal(label.as_str().unwrap());
        let source = format!("(? ({spelling} = {spelling}))");
        let result = evaluate_with_options(&source, None, EvaluateOptions { with_proofs: true, ..Default::default() });
        assert!(result.diagnostics.is_empty(), "{label}: {:?}", result.diagnostics);
        assert_eq!(result.results, vec![rml::RunResult::Num(1.0)], "{label}");
        let proof = result.proofs.iter().flatten().map(emit_lino_term).collect::<Vec<_>>().join("\n");
        assert!(check_program(&source, &proof).is_ok(), "{label}");
    }
}
#[test]
fn display_collisions_cannot_grant_assignment_or_repeated_variable_authority() {
    let source = "(('(a b)' = '(a b)') has probability 0.25)\n(? ((a b) = (a b)))\n(? ('(a b)' = '(a b)'))";
    let result = evaluate_with_options(source, None, EvaluateOptions { with_proofs: true, ..Default::default() });
    assert_eq!(result.results, vec![rml::RunResult::Num(1.0),rml::RunResult::Num(0.25)]);
    let proofs = result.proofs.iter().flatten().map(emit_lino_term).collect::<Vec<_>>().join("\n");
    assert!(check_program(source, &proofs).is_ok());
    assert!(!check_program(source, &proofs.replacen("structural-equality", "assigned-equality", 1)).is_ok());
    let pattern = Node::List(vec![leaf("?x"), leaf("?x")]);
    let candidate = Node::List(vec![leaf("(a b)"),Node::List(vec![leaf("a"),leaf("b")])]);
    assert!(!match_proof_pattern(&pattern,&candidate,&mut std::collections::HashMap::new()));
}
#[test]
fn mixed_provider_structure_transport_retains_literals_without_old_text_decoding() {
    use rml::meta_language_structure::{rml_structure_only,serialize_rml_structure,deserialize_rml_structure,emit_rml_from_structure};
    use rml::meta_language_support::{parse_rml_to_meta_language,reconstruct_rml_from_meta_language};
    for label in fixture()["labels"].as_array().unwrap() {
        let source = format!("(head {} tail)\n", encode_reference_literal(label.as_str().unwrap()));
        let network = parse_rml_to_meta_language(&source);
        assert_eq!(reconstruct_rml_from_meta_language(&network),source);
        let stripped = rml_structure_only(&network).unwrap();
        let restored = deserialize_rml_structure(&serialize_rml_structure(&stripped).unwrap()).unwrap();
        let canonical = emit_rml_from_structure(&restored).unwrap();
        assert_eq!(parse_one(&tokenize_one(&canonical)).unwrap(), Node::List(vec![leaf("head"),leaf(label.as_str().unwrap()),leaf("tail")]));
    }
}
#[test]
fn lossless_emitter_rejects_overdeep_caller_trees_explicitly() {
    let mut node=leaf("value");
    for _ in 0..65 {node=Node::List(vec![node]);}
    assert!(rml::try_emit_lino_term(&node).unwrap_err().contains("nesting limit"));
    let mut env = rml::Env::new(None);
    env.set_expr_prob(&leaf("known"), 0.5);
    let before = env.assign.clone();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| env.set_expr_prob(&node, 1.0))).is_err());
    assert_eq!(env.assign, before);
}
