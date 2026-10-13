use rml_relational::horn_resolution::Options;
use rml_relational::linked_program::RewriteRule;
use rml_relational::relational_kernel::{self as rel, RelationalKernel, SOURCE};
use rml_relational::{parse_one, tokenize_one, Node};
fn node(source: &str) -> Node {
    if source.starts_with('(') {
        parse_one(&tokenize_one(source)).unwrap()
    } else {
        Node::Leaf(source.into())
    }
}
#[test]
fn recursive_substitution_replacement_changes_execution_through_the_quoted_source_image() {
    let source=SOURCE.replace("(horn-clause substitute-head (substitute-items (cons ?head ?tail) ?environment (cons ?result ?rest))\n  (substitute ?head ?environment ?result) (substitute-items ?tail ?environment ?rest))","(horn-clause substitute-head (substitute-items (cons ?head ?tail) ?environment ?output)\n  (substitute ?head ?environment ?result) (substitute-items ?tail ?environment ?rest)\n  (append ?rest (cons ?result end) ?output))");
    let original = RelationalKernel::from_source(SOURCE).unwrap();
    let changed = RelationalKernel::from_source(&source).unwrap();
    let options = Options {
        self_interpret: true,
        capture_proof: false,
        max_steps: 100_000_000,
        ..Options::default()
    };
    let rules = rel::encode_rules(&[RewriteRule {
        program: "p".into(),
        name: "r".into(),
        pattern: node("(i ?x)"),
        replacement: node("(pair (nested ?x) done)"),
    }]);
    assert_eq!(
        original
            .rewrite_once(&node("(i v)"), &rules, &options)
            .unwrap()
            .step
            .unwrap()
            .0,
        node("(pair (nested v) done)")
    );
    assert_eq!(
        changed
            .rewrite_once(&node("(i v)"), &rules, &options)
            .unwrap()
            .step
            .unwrap()
            .0,
        node("(done (v nested) pair)")
    );
}
#[test]
fn quoted_interpreter_obeys_replaced_linked_occurs_check() {
    let source=SOURCE.replace("(horn-clause meta-bind-cycle (meta-bind-choice yes ?key ?value ?environment failed))","(horn-clause meta-bind-cycle (meta-bind-choice yes ?key ?value ?environment (unified ?environment)))");
    let original = RelationalKernel::from_source(SOURCE).unwrap();
    let changed = RelationalKernel::from_source(&source).unwrap();
    let options = Options {
        self_interpret: true,
        capture_proof: false,
        max_steps: 100_000_000,
        ..Options::default()
    };
    let key = Node::List(vec![node("key"), node("end"), rel::encode_bits("x")]);
    let variable = Node::List(vec![node("meta-variable"), key]);
    let query = Node::List(vec![
        node("meta-unify"),
        variable.clone(),
        Node::List(vec![node("meta-list"), rel::encode_list(vec![variable])]),
        node("end"),
        node("?out"),
    ]);
    let original = original.self_query(&query, &options).unwrap();
    let changed = changed.self_query(&query, &options).unwrap();
    let Node::List(original) = original else {
        panic!()
    };
    let Node::List(changed) = changed else {
        panic!()
    };
    assert_eq!(original.last().unwrap(), &node("failed"));
    assert_eq!(changed.last().unwrap(), &node("(unified end)"));
}
#[test]
fn replaced_linked_interpreter_unifier_blocks_quoted_execution_but_not_direct_execution() {
    let changed=SOURCE.replace("(horn-clause meta-unify-yes (meta-unify-decision yes ?environment (unified ?environment)))","(horn-clause meta-unify-yes (meta-unify-decision yes ?environment failed))");
    assert_ne!(changed, SOURCE);
    let kernel = RelationalKernel::from_source(&changed).unwrap();
    let rules = rel::encode_rules(&[RewriteRule {
        program: "p".into(),
        name: "r".into(),
        pattern: node("(i ?x)"),
        replacement: node("(o ?x)"),
    }]);
    assert_eq!(
        kernel
            .rewrite_once(&node("(i v)"), &rules, &Options::default())
            .unwrap()
            .step
            .unwrap()
            .0,
        node("(o v)")
    );
    assert!(kernel
        .rewrite_once(
            &node("(i v)"),
            &rules,
            &Options {
                self_interpret: true,
                max_steps: 100_000_000,
                ..Options::default()
            }
        )
        .unwrap_err()
        .contains("has no answer"));
}
