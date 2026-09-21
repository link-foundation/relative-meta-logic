use std::fs;
use std::path::PathBuf;

use rml::linked_program::LinkedProgramRegistry;
use rml::{parse_one, tokenize_one, Node};

fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).expect("test term must parse")
}

fn source() -> String {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent().expect("repository root");
    fs::read_to_string(root.join("lib/meta-theory/universal.lino"))
        .expect("universal linked program")
}

fn registry(extra: &str) -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml(&format!("{}\n{}", source(), extra))
        .expect("linked programs must load")
}

#[test]
fn performs_binding_substitution_and_beta_reduction_without_a_host_adapter() {
    let programs = registry("");
    let result = programs
        .reduce(
            "lambda-calculus",
            &node("(beta (lambda (bound zero)) (free a))"),
            10_000,
        )
        .expect("identity reduces");
    assert_eq!(result.term, node("(free a)"));

    let capture_safe = node(
        "(evaluate (apply (apply (lambda (lambda (bound (successor zero)))) (free a)) (free b)) empty-environment)",
    );
    let result = programs
        .reduce("lambda-calculus", &capture_safe, 10_000)
        .expect("nested binders reduce");
    assert_eq!(result.term, node("(free a)"));
}

#[test]
fn loads_a_new_logic_from_links_without_a_rust_callback() {
    let programs = registry(
        "(linked-program user-logic)\n\
         (linked-rewrite user-logic eliminate-double-negation\n\
           (from (negate (negate ?proposition)))\n\
           (to ?proposition))",
    );
    let result = programs
        .reduce("user-logic", &node("(negate (negate p))"), 10_000)
        .expect("custom logic reduces");
    assert_eq!(result.term, Node::Leaf("p".to_string()));
    assert_eq!(result.trace[0].rule, "eliminate-double-negation");
}

#[test]
fn derives_judgements_through_user_defined_inference() {
    let programs = registry(
        "(linked-program user-proof-system)\n\
         (linked-fact user-proof-system premise-p (judgement (holds p)))\n\
         (linked-fact user-proof-system premise-p-implies-q (judgement (implies p q)))\n\
         (linked-inference user-proof-system modus-ponens\n\
           (premise (holds ?antecedent))\n\
           (premise (implies ?antecedent ?consequent))\n\
           (conclusion (holds ?consequent)))",
    );
    let proof = programs
        .prove("user-proof-system", &node("(holds q)"), &[], 128, 10_000)
        .expect("proof search succeeds");
    assert_eq!(proof.rule, "modus-ponens");
    assert_eq!(proof.premises[0].rule, "premise-p");
}

#[test]
fn defines_sets_graphs_relations_and_types_as_linked_programs() {
    let programs = registry("");
    let set = node("(cons a (cons b (empty)))");
    let result = programs
        .reduce("set-theory", &node(&format!("(member b {set})")), 10_000)
        .expect("membership reduces");
    assert_eq!(result.term, Node::Leaf("true".to_string()));

    assert!(programs
        .prove(
            "graph-theory",
            &node("(reachable a c)"),
            &[node("(edge a b)"), node("(edge b c)")],
            128,
            10_000,
        )
        .is_some());
    assert!(programs
        .prove(
            "relational-algebra",
            &node("(relates (compose left right) a c)"),
            &[node("(relates left a b)"), node("(relates right b c)"),],
            128,
            10_000,
        )
        .is_some());
    assert!(programs
        .prove(
            "dependent-type-theory",
            &node("(has-type (apply (lambda Nat (bound zero)) zero) Nat)"),
            &[],
            128,
            10_000,
        )
        .is_some());
}

#[test]
fn rejects_unbound_replacements_and_rewrite_cycles() {
    let invalid = format!(
        "{}\n(linked-program invalid)\n\
         (linked-rewrite invalid unbound (from (f ?x)) (to (g ?missing)))",
        source()
    );
    assert!(LinkedProgramRegistry::from_rml(&invalid)
        .expect_err("unbound replacement must fail")
        .contains("unbound variable ?missing"));

    let programs = registry(
        "(linked-program looping)\n\
         (linked-rewrite looping left (from left) (to right))\n\
         (linked-rewrite looping right (from right) (to left))",
    );
    assert!(programs
        .reduce("looping", &Node::Leaf("left".to_string()), 10_000)
        .expect_err("cycle must fail")
        .contains("rewrite cycle"));

    let invalid_import = format!(
        "{}\n(linked-program parent)\n\
         (linked-program invalid-import\n\
           (uses parent (rebind ?pattern-variable concrete)))",
        source()
    );
    assert!(LinkedProgramRegistry::from_rml(&invalid_import)
        .expect_err("pattern variable rebind must fail")
        .contains("cannot rebind pattern variables"));
}

#[test]
fn applies_proof_fact_bound_to_declared_and_input_facts() {
    let programs = registry(
        "(linked-program bounded-proof)\n\
         (linked-fact bounded-proof first (judgement (holds a)))\n\
         (linked-fact bounded-proof second (judgement (holds b)))",
    );
    assert!(programs
        .prove("bounded-proof", &node("(holds b)"), &[], 128, 1)
        .is_none());

    let input_only = registry("(linked-program bounded-input)");
    assert!(input_only
        .prove(
            "bounded-input",
            &node("(holds b)"),
            &[node("(holds a)"), node("(holds b)")],
            128,
            1,
        )
        .is_none());
}

#[test]
fn instantiates_one_unchanged_theory_over_replaceable_foundations() {
    let programs = registry(
        "(linked-program portable-classifier)\n\
         (linked-rewrite portable-classifier classify\n\
           (from (classify ?value))\n\
           (to (foundation-decision ?value)))\n\
         (linked-program strict-foundation)\n\
         (linked-rewrite strict-foundation decide-unknown\n\
           (from (strict-decision unknown))\n\
           (to reject))\n\
         (linked-program permissive-foundation)\n\
         (linked-rewrite permissive-foundation decide-unknown\n\
           (from (permissive-decision unknown))\n\
           (to accept))\n\
         (linked-program classifier-interface\n\
           (uses portable-classifier\n\
             (rebind foundation-decision selected-decision)))\n\
         (linked-program classifier-over-strict\n\
           (uses classifier-interface\n\
             (rebind selected-decision strict-decision))\n\
           (uses strict-foundation))\n\
         (linked-program classifier-over-permissive\n\
           (uses portable-classifier\n\
             (rebind foundation-decision permissive-decision))\n\
           (uses permissive-foundation))\n\
         (linked-program portable-entailment)\n\
         (linked-fact portable-entailment premise\n\
           (judgement (abstract-holds p)))\n\
         (linked-fact portable-entailment implication\n\
           (judgement (abstract-implies p q)))\n\
         (linked-inference portable-entailment modus-ponens\n\
           (premise (abstract-holds ?antecedent))\n\
           (premise (abstract-implies ?antecedent ?consequent))\n\
           (conclusion (abstract-holds ?consequent)))\n\
         (linked-program selected-entailment\n\
           (uses portable-entailment\n\
             (rebind abstract-holds holds)\n\
             (rebind abstract-implies implies)))",
    );

    let strict = programs
        .reduce(
            "classifier-over-strict",
            &node("(classify unknown)"),
            10_000,
        )
        .expect("strict instance reduces");
    assert_eq!(strict.term, Node::Leaf("reject".to_string()));

    let permissive = programs
        .reduce(
            "classifier-over-permissive",
            &node("(classify unknown)"),
            10_000,
        )
        .expect("permissive instance reduces");
    assert_eq!(permissive.term, Node::Leaf("accept".to_string()));

    assert!(programs
        .prove("selected-entailment", &node("(holds q)"), &[], 128, 10_000,)
        .is_some());

    let traditional = programs
        .reduce(
            "set-theory-over-traditional-sequences",
            &node("(member b (sequence-cons a (sequence-cons b (sequence-empty))))"),
            10_000,
        )
        .expect("traditional set instance reduces");
    assert_eq!(traditional.term, Node::Leaf("true".to_string()));

    let associative = programs
        .reduce(
            "set-theory-over-associative-links",
            &node("(member b (link-cons a (link-cons b (link-empty))))"),
            10_000,
        )
        .expect("associative set instance reduces");
    assert_eq!(associative.term, Node::Leaf("true".to_string()));
}

#[test]
fn executes_a_links_defined_meta_interpreter_above_an_explicit_k0_boundary() {
    let programs = registry("");
    let request = node(
        "(meta-verify\n\
           (atom a)\n\
           (meta-rewrite\n\
             (rules\n\
               (rewrite\n\
                 (pair (atom identity) (meta-variable argument))\n\
                 (meta-variable argument))\n\
               (no-rules))\n\
             (pair (atom identity) (atom a))))",
    );
    let result = programs
        .reduce("links-meta-foundation", &request, 10_000)
        .expect("meta-interpreter reduces");
    assert_eq!(result.term, Node::Leaf("verified".to_string()));
    assert!(result
        .trace
        .iter()
        .any(|step| step.rule == "match-unbound-variable"));
    assert!(result
        .trace
        .iter()
        .any(|step| step.rule == "substitute-bound-variable"));

    let report = LinkedProgramRegistry::bootstrap_kernel_report();
    assert_eq!(report.name, "K0");
    assert_eq!(report.status, "current-bootstrap-boundary");
    assert!(!report.claims_irreducible);
    assert_eq!(
        report.operations,
        [
            "parse-linked-forms",
            "compare-link-structure",
            "bind-pattern-variables",
            "substitute-bound-structures",
            "select-and-traverse-rewrite-rules",
            "enforce-cycle-and-resource-bounds",
        ]
    );
    assert_eq!(
        report.derived_host_services,
        [
            "resolve-and-rebind-program-imports",
            "saturate-inference-rules",
        ]
    );
    assert!(report.object_semantics.is_empty());
    assert_eq!(report.minimization_experiments.len(), 8);
    assert!(report
        .trust_graph
        .nodes
        .iter()
        .filter(|node| node.layer == "bootstrap")
        .all(|node| !node.primitive_reason.is_empty()));

    assert!(LinkedProgramRegistry::audit_bootstrap_kernel(None).is_ok());
    let mut hidden = report.operations.clone();
    hidden.extend(report.derived_host_services.iter().copied());
    hidden.push("hidden-object-evaluator");
    assert_eq!(
        LinkedProgramRegistry::audit_bootstrap_kernel(Some(&hidden)).unwrap_err(),
        "unreported host semantic operation hidden-object-evaluator"
    );
}

#[test]
fn measures_the_complete_host_semantic_surface_and_self_hosting_distance() {
    let report = LinkedProgramRegistry::bootstrap_metrics_report(&source())
        .expect("bootstrap metrics must be reproducible");

    assert_eq!(report.schema, "rml-bootstrap-metrics/v1");
    assert_eq!(
        report.removal_classifications,
        vec![
            "INDEPENDENT",
            "DERIVABLE",
            "EQUIVALENT_REENCODING",
            "UNKNOWN",
        ]
    );
    assert_eq!(report.current.total_host_semantic_operations, 8);
    assert_eq!(report.current.independent_host_primitives.confirmed, 0);
    assert_eq!(report.current.independent_host_primitives.unknown, 8);
    assert_eq!(report.current.derived_host_semantic_services, 2);
    assert_eq!(report.current.duplicated_semantic_capabilities, 3);
    assert_eq!(report.current.object_specific_host_semantics, 0);
    assert_eq!(report.current.undocumented_semantic_paths, 0);
    assert_eq!(report.current.self_hosting_closure.linked_capabilities, 4);
    assert_eq!(
        report.current.self_hosting_closure.task,
        "textual-load-through-links-meta-foundation-verification"
    );
    assert_eq!(
        report.current.self_hosting_closure.linked_capability_names,
        vec![
            "matching",
            "substitution",
            "rule-selection",
            "result-verification",
        ]
    );
    assert_eq!(report.current.self_hosting_closure.host_capabilities, 7);
    assert_eq!(
        report.current.self_hosting_closure.host_capability_names,
        vec![
            "bind-pattern-variables",
            "compare-link-structure",
            "enforce-cycle-and-resource-bounds",
            "parse-linked-forms",
            "resolve-and-rebind-program-imports",
            "select-and-traverse-rewrite-rules",
            "substitute-bound-structures",
        ]
    );
    assert_eq!(report.current.self_hosting_closure.total_capabilities, 11);
    assert_eq!(report.current.self_hosting_closure.numerator, 4);
    assert_eq!(report.current.self_hosting_closure.denominator, 11);
    assert_eq!(
        report
            .current
            .foundation_compression
            .smallest_sufficient_host_operations,
        8
    );
    assert_eq!(
        report.current.foundation_compression.basis,
        "host-operation fault injection over the declared acceptance probe"
    );
    assert_eq!(
        report.current.foundation_compression.candidate_operations,
        report.current.foundation_compression.sufficient_operations
    );
    assert_eq!(
        report.current.foundation_compression.candidate_operations,
        vec![
            "parse-linked-forms",
            "compare-link-structure",
            "bind-pattern-variables",
            "substitute-bound-structures",
            "select-and-traverse-rewrite-rules",
            "enforce-cycle-and-resource-bounds",
            "resolve-and-rebind-program-imports",
            "saturate-inference-rules",
        ]
    );
    assert_eq!(
        report
            .current
            .foundation_compression
            .original_host_operations,
        8
    );
    assert_eq!(report.current.foundation_compression.numerator, 8);
    assert_eq!(report.current.foundation_compression.denominator, 8);

    assert_eq!(
        report
            .host_semantic_layers
            .iter()
            .map(|layer| (layer.layer, layer.count))
            .collect::<Vec<_>>(),
        vec![
            ("semantic-bootstrap", 4),
            ("derived-host-semantics", 2),
            ("representation-parsing", 1),
            ("execution-control-resource-bounds", 1),
            ("debugging-observability", 0),
            ("object-specific-host-semantics", 0),
        ]
    );
    assert_eq!(
        report
            .host_semantic_layers
            .iter()
            .flat_map(|layer| layer.operations.iter().copied())
            .collect::<std::collections::BTreeSet<_>>(),
        LinkedProgramRegistry::bootstrap_kernel_report()
            .operations
            .iter()
            .chain(
                LinkedProgramRegistry::bootstrap_kernel_report()
                    .derived_host_services
                    .iter()
            )
            .copied()
            .collect::<std::collections::BTreeSet<_>>()
    );
    assert_eq!(report.removal_experiments.len(), 8);
    assert!(report.removal_experiments.iter().all(|experiment| {
        experiment.classification == "UNKNOWN"
            && !experiment.baseline_preserved
            && !experiment.observed_failure.is_empty()
    }));
    assert_eq!(
        report
            .host_linked_duplications
            .iter()
            .map(|duplication| duplication.capability)
            .collect::<Vec<_>>(),
        vec!["matching", "substitution", "rule-selection"]
    );
    assert!(report
        .runtime_trust_graph_coverage
        .undocumented_paths
        .is_empty());
    assert!(report
        .runtime_trust_graph_coverage
        .undocumented_operations
        .is_empty());
    assert!(report
        .runtime_trust_graph_coverage
        .undocumented_path_segments
        .is_empty());
    assert_eq!(report.runtime_trust_graph_coverage.total_observed_paths, 4);
    assert_eq!(
        report
            .runtime_trust_graph_coverage
            .total_observed_path_segments,
        19
    );
    assert_eq!(
        report
            .runtime_trust_graph_coverage
            .documented_observed_paths,
        report.runtime_trust_graph_coverage.total_observed_paths
    );
    assert_eq!(
        report
            .runtime_trust_graph_coverage
            .documented_observed_path_segments,
        report
            .runtime_trust_graph_coverage
            .total_observed_path_segments
    );

    let total = &report.comparison[0];
    assert_eq!(total.metric, "total-host-semantic-operations");
    assert_eq!(total.previous.as_deref(), Some("8"));
    assert_eq!(total.current, "8");
    assert_eq!(total.delta.as_deref(), Some("0"));
    assert_eq!(
        report.previous_revision,
        "e2e9f7b2a87d4b128bb736d693d5512509974860"
    );
    assert_eq!(
        report
            .comparison
            .iter()
            .map(|entry| (
                entry.metric,
                entry.previous.as_deref(),
                entry.current.as_str(),
                entry.delta.as_deref(),
            ))
            .collect::<Vec<_>>(),
        vec![
            ("total-host-semantic-operations", Some("8"), "8", Some("0"),),
            (
                "independent-host-primitives",
                None,
                "0 confirmed; 8 unknown",
                None,
            ),
            ("derived-host-semantic-services", Some("2"), "2", Some("0"),),
            ("host-linked-duplicated-semantics", None, "3", None),
            ("object-specific-host-semantics", Some("0"), "0", Some("0")),
            ("undocumented-semantic-paths", None, "0", None),
            ("self-hosting-closure", None, "4/11", None),
            ("foundation-compression-ratio", None, "8/8", None),
        ]
    );
}

fn encode_object(term: &Node, variables: bool) -> Node {
    match term {
        Node::Leaf(value) if variables && value.starts_with('?') => Node::List(vec![
            Node::Leaf("meta-variable".to_string()),
            Node::Leaf(value[1..].to_string()),
        ]),
        Node::Leaf(value) => Node::List(vec![
            Node::Leaf("atom".to_string()),
            Node::Leaf(value.clone()),
        ]),
        Node::List(children) => children
            .iter()
            .rev()
            .fold(node("(atom nil)"), |tail, item| {
                Node::List(vec![
                    Node::Leaf("pair".to_string()),
                    encode_object(item, variables),
                    tail,
                ])
            }),
    }
}

#[test]
fn self_interprets_a_non_trivial_fragment_of_its_own_matching_semantics() {
    let programs = registry("");
    let own_pattern = node("(meta-match (atom ?value) (atom ?value) ?bindings)");
    let own_replacement = node("(match-ok ?bindings)");
    let direct_request = node("(meta-match (atom same) (atom same) (no-bindings))");
    let direct = programs
        .reduce("links-meta-foundation", &direct_request, 10_000)
        .expect("direct execution succeeds");
    let self_request = Node::List(vec![
        Node::Leaf("meta-apply".to_string()),
        Node::List(vec![
            Node::Leaf("rewrite".to_string()),
            encode_object(&own_pattern, true),
            encode_object(&own_replacement, true),
        ]),
        encode_object(&direct_request, false),
    ]);
    let self_interpreted = programs
        .reduce("links-meta-foundation", &self_request, 10_000)
        .expect("self-interpretation succeeds");

    assert_eq!(
        self_interpreted.term,
        Node::List(vec![
            Node::Leaf("rewrite-result".to_string()),
            encode_object(&direct.term, false),
        ])
    );
    assert!(self_interpreted
        .trace
        .iter()
        .any(|step| step.rule == "match-repeated-variable"));
    assert!(self_interpreted
        .trace
        .iter()
        .any(|step| step.rule == "substitute-bound-variable"));
}
