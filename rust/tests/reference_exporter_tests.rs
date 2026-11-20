use rml::lean_export::{export_lean, lean_ident};
use rml::rocq::export_rocq;
use rml::{emit_lino_term, Node};
use serde_json::Value;
#[test]
fn target_names_are_injective_and_declarations_preserve_labels() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../test-corpus/lino-frontend/reference-literals.json"
    ))
    .unwrap();
    let mut names = std::collections::HashMap::new();
    for value in fixture["labels"]
        .as_array()
        .unwrap()
        .iter()
        .chain(fixture["exportNames"].as_array().unwrap())
    {
        let label = value.as_str().unwrap();
        if matches!(label, "Type" | "Prop") {
            continue;
        }
        let expected = format!(
            "rml_ref_{}",
            label
                .bytes()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        assert_eq!(lean_ident(label), expected);
        if let Some(previous) = names.insert(expected.clone(), label) {
            assert_eq!(previous, label);
        }
        let s = emit_lino_term(&Node::Leaf(label.to_string()));
        let source = format!("(Carrier: (Type 0) Carrier)\n({s}: Carrier {s})\n(choose: lambda (Carrier {s}) {s})");
        let lean = export_lean(&source, None);
        assert!(
            lean.diagnostics.is_empty(),
            "{label:?}: {:?}",
            lean.diagnostics
        );
        assert!(lean
            .source
            .contains(&format!("axiom {expected} : rml_ref_43617272696572")));
        assert!(lean.source.contains(&format!(":= fun {expected} => {expected}")));
        assert!(export_rocq(&source, None)
            .unwrap()
            .contains(&format!("Parameter {expected} : rml_ref_43617272696572.")));
    }
}
#[test]
fn builtin_redeclarations_are_rejected() {
    for name in ["Type", "Prop"] {
        for source in [
            format!("({name}: (Type 0) {name})"),
            format!("(inductive {name} (constructor item))"),
            format!("(inductive Other (constructor {name}))"),
        ] {
            assert!(!export_lean(&source, None).diagnostics.is_empty());
            assert!(export_rocq(&source, None).is_err());
        }
    }
}
#[test]
fn nested_binders_with_display_collisions_remain_distinct() {
    let source="(Carrier: (Type 0) Carrier)\n(choose: lambda ('a b': Carrier) (lambda (a_b: Carrier) 'a b'))";
    let lean = export_lean(source, None);
    assert!(lean.diagnostics.is_empty());
    assert!(
        lean.source.contains(
            "fun rml_ref_612062 => fun (rml_ref_615f62 : rml_ref_43617272696572) => rml_ref_612062"
        ),
        "{}",
        lean.source
    );
    let rocq = export_rocq(source, None).unwrap();
    assert!(rocq.contains("fun rml_ref_612062 : rml_ref_43617272696572 => fun rml_ref_615f62 : rml_ref_43617272696572 => rml_ref_612062"),"{rocq}");
}

#[test]
fn lean_axiom_dependencies_preserve_computable_shadowing() {
    let source = "(Carrier: (Type 0) Carrier)\n(sentinel: Carrier sentinel)\n(keep: lambda (Carrier x) sentinel)\n(forward: lambda (Carrier x) (apply keep x))\n(shadow: lambda (Carrier sentinel) sentinel)";
    let result = export_lean(source, None);
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    for name in ["keep", "forward"] {
        assert!(result.source.contains(&format!("noncomputable def {} :", lean_ident(name))));
    }
    assert!(result.source.lines().any(|line| line.starts_with(&format!("def {} :", lean_ident("shadow")))));
}
