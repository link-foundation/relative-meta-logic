use std::fs;
use std::path::PathBuf;

use rml::linked_program::{ExecutionBasis, GoalNormalization, LinkedProgramRegistry, SearchEnd};
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
fn preserves_proof_round_capacity_and_unnormalized_proof_witnesses() {
    let programs = registry(
        "(linked-program normalized-proofs)\n\
         (linked-rewrite normalized-proofs unwrap\n\
           (from (wrapped ?value))\n\
           (to ?value))\n\
         (linked-fact normalized-proofs seed (judgement (wrapped seed)))\n\
         (linked-inference normalized-proofs first\n\
           (premise seed)\n\
           (conclusion (wrapped intermediate)))\n\
         (linked-inference normalized-proofs second\n\
           (premise intermediate)\n\
           (conclusion (wrapped goal)))",
    );
    let proof = programs
        .prove(
            "normalized-proofs",
            &Node::Leaf("goal".to_string()),
            &[],
            1,
            10_000,
        )
        .expect("one legacy round retains capacity for multiple derivations");

    assert_eq!(proof.judgement, node("(wrapped goal)"));
    assert_eq!(proof.premises[0].judgement, node("(wrapped intermediate)"));
    assert_eq!(
        proof.premises[0].premises[0].judgement,
        node("(wrapped seed)")
    );
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
fn reports_why_a_proof_search_ended_in_every_execution_basis() {
    let source = "(linked-program graph)\n\
         (linked-fact graph ab (judgement (edge a b)))\n\
         (linked-fact graph bc (judgement (edge b c)))\n\
         (linked-inference graph base (premise (edge ?x ?y)) (conclusion (path ?x ?y)))\n\
         (linked-inference graph step\n\
           (premise (edge ?x ?y)) (premise (path ?y ?z)) (conclusion (path ?x ?z)))\n\
         (linked-program counter)\n\
         (linked-fact counter zero (judgement (count z)))\n\
         (linked-inference counter next (premise (count ?n)) (conclusion (count (s ?n))))\n\
         (linked-program loops)\n\
         (linked-rewrite loops flip (from (flip ?x)) (to (flop ?x)))\n\
         (linked-rewrite loops flop (from (flop ?x)) (to (flip ?x)))";
    let closure = vec![node("(path a b)"), node("(path b c)"), node("(path a c)")];
    for basis in [
        ExecutionBasis::ClosedSk,
        ExecutionBasis::DirectStructural,
        ExecutionBasis::HornRelational,
    ] {
        let programs = LinkedProgramRegistry::from_rml_with_basis(source, basis, &[])
            .expect("search programs load");
        let search = |name: &str, goals: &[Node], rounds: usize, facts: usize| {
            programs
                .search(name, goals, &[], rounds, facts, 10_000)
                .expect("search runs")
        };

        let found = search(
            "graph",
            &[node("(path a c)"), node("(path b c)")],
            128,
            10_000,
        );
        assert_eq!(found.execution_basis, basis);
        assert_eq!(found.ended, SearchEnd::Found);
        assert_eq!(found.ended.as_str(), "found");
        let rules = found
            .goals
            .iter()
            .map(|goal| {
                assert_eq!(goal.normalization, GoalNormalization::Normal);
                goal.proof.as_ref().expect("goal proved").rule.as_str()
            })
            .collect::<Vec<_>>();
        assert_eq!(rules, ["step", "base"]);
        let derived = |outcome: &rml::linked_program::LinkedSearch| {
            outcome
                .derived
                .iter()
                .map(|entry| entry.judgement.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(derived(&found), closure);

        // A fixed point without the goal is not the same outcome as a spent bound.
        let saturated = search("graph", &[node("(path c a)")], 128, 10_000);
        assert_eq!(saturated.ended, SearchEnd::Saturated);
        assert!(saturated.goals[0].proof.is_none());
        assert_eq!(saturated.facts, 5);
        let whole = search("graph", &[], 128, 10_000);
        assert_eq!(whole.ended, SearchEnd::Saturated);
        assert_eq!(derived(&whole), closure);

        let facts = search("counter", &[node("(count never)")], 64, 3);
        assert_eq!(facts.ended, SearchEnd::FactLimit);
        assert_eq!(facts.facts, 4);
        // The closed kernel spends one transition per derived fact, so it meets
        // the fact bound where a direct round runs out first.
        let rounds = search("counter", &[node("(count never)")], 1, 3);
        let expected = if basis == ExecutionBasis::ClosedSk {
            SearchEnd::FactLimit
        } else {
            SearchEnd::InferenceLimit
        };
        assert_eq!(rounds.ended, expected);
        assert!(rounds.goals[0].proof.is_none());

        // The Horn control has no ordered reduction, so only the other two bases
        // can fail to normalize a goal.
        if basis != ExecutionBasis::HornRelational {
            let cycle = search("loops", &[node("(flip a)")], 128, 10_000);
            assert_eq!(cycle.ended, SearchEnd::Saturated);
            assert_eq!(
                cycle.goals[0].normalization,
                GoalNormalization::RewriteCycle
            );
            assert!(cycle.goals[0].normalized.is_none());
            assert!(cycle.goals[0]
                .detail
                .as_deref()
                .is_some_and(|detail| detail.contains("rewrite cycle after")));
        }
    }
    let programs = LinkedProgramRegistry::from_rml(source).expect("search programs load");
    assert!(programs.search("graph", &[], &[], 128, 10_000, 0).is_err());
    assert!(programs.search("graph", &[], &[], 128, 0, 10_000).is_err());

    // `reduce_or_stop` reports a reduction without a normal form as a value.
    let stopped = programs
        .reduce_or_stop("loops", &node("(flip a)"), 10_000)
        .expect("reduction runs")
        .expect_err("the rewrites cycle");
    assert_eq!(stopped.normalization, GoalNormalization::RewriteCycle);
    assert!(stopped.detail.contains("rewrite cycle after"));
    let limited = programs
        .reduce_or_stop("loops", &node("(flip a)"), 1)
        .expect("reduction runs")
        .expect_err("one step is not enough");
    assert_eq!(limited.normalization, GoalNormalization::RewriteLimit);
    let normal = programs
        .reduce_or_stop("graph", &node("(edge a b)"), 10_000)
        .expect("reduction runs")
        .expect("no rewrite applies");
    assert_eq!(normal.term, node("(edge a b)"));
    assert!(programs
        .reduce_or_stop("missing", &node("(edge a b)"), 10_000)
        .is_err());
}

#[test]
fn reports_a_fact_without_a_normal_form_as_a_stopped_search() {
    // Direct saturation normalizes every input and derived fact with the
    // ordered rewrites. `search_or_stop` returns a fact without a normal form
    // as a value, like `reduce_or_stop`, and `search` keeps it an error.
    let source = "(linked-program loops)\n\
         (linked-rewrite loops flip (from (flip ?x)) (to (flop ?x)))\n\
         (linked-rewrite loops flop (from (flop ?x)) (to (flip ?x)))\n\
         (linked-program spinner (uses loops))\n\
         (linked-fact spinner seed (judgement (start a)))\n\
         (linked-inference spinner spin (premise (start ?x)) (conclusion (flip ?x)))";
    let programs =
        LinkedProgramRegistry::from_rml_with_basis(source, ExecutionBasis::DirectStructural, &[])
            .expect("programs load");
    for (name, facts) in [("loops", vec![node("(flip a)")]), ("spinner", Vec::new())] {
        let stopped = programs
            .search_or_stop(name, &[], &facts, 128, 10_000, 10_000)
            .expect("search runs")
            .expect_err("the fact has no normal form");
        assert_eq!(stopped.normalization, GoalNormalization::RewriteCycle);
        assert_eq!(stopped.detail, "rewrite cycle after 2 steps at (flip a)");
        assert_eq!(
            programs
                .search(name, &[], &facts, 128, 10_000, 10_000)
                .expect_err("search reports the failure as an error"),
            stopped.detail
        );
    }
    let normal = programs
        .search_or_stop("loops", &[], &[node("(edge a b)")], 128, 10_000, 10_000)
        .expect("search runs")
        .expect("every fact is normal");
    assert_eq!(normal.ended, SearchEnd::Saturated);
    assert!(programs
        .search_or_stop("missing", &[], &[], 128, 10_000, 10_000)
        .is_err());
}

#[test]
fn bounds_each_closed_kernel_call_by_a_contraction_budget() {
    let source = "(linked-program counter)\n\
         (linked-fact counter zero (judgement (count z)))\n\
         (linked-inference counter next (premise (count ?n)) (conclusion (seen ?n)))";
    let budget = |basis, max_contractions| {
        LinkedProgramRegistry::from_rml_with_basis(source, basis, &[])
            .expect("programs load")
            .with_max_contractions(max_contractions)
    };
    let programs = LinkedProgramRegistry::from_rml(source).expect("programs load");
    assert_eq!(programs.max_contractions(), 100_000_000);
    assert_eq!(
        budget(ExecutionBasis::ClosedSk, 0).expect_err("a zero budget is rejected"),
        "max_contractions must be positive"
    );

    // `reduce` reports a kernel call that spends the budget as an error and
    // `reduce_or_stop` as a reduction without a normal form.
    let tiny = budget(ExecutionBasis::ClosedSk, 100).expect("the budget is positive");
    let stopped = tiny
        .reduce_or_stop("counter", &node("(count z)"), 10_000)
        .expect("reduction runs")
        .expect_err("the budget is spent");
    assert_eq!(stopped.normalization, GoalNormalization::ContractionLimit);
    assert_eq!(stopped.normalization.as_str(), "contraction-limit");
    assert_eq!(stopped.detail, "combinator contraction limit 100 exceeded");
    assert_eq!(
        tiny.reduce("counter", &node("(count z)"), 10_000)
            .expect_err("the budget is spent"),
        stopped.detail
    );

    // The budget applies to each kernel call separately. The reduction of a
    // wide goal spends it and is reported like a goal without a normal form,
    // while the saturation that finds the other goal fits.
    let wide = Node::List(
        std::iter::once(Node::Leaf("row".to_string()))
            .chain(std::iter::repeat_n(Node::Leaf("item".to_string()), 200))
            .collect(),
    );
    let goals = [wide, node("(seen z)")];
    let bounded = budget(ExecutionBasis::ClosedSk, 60_000).expect("the budget is positive");
    let found = bounded
        .search("counter", &goals, &[], 128, 10_000, 10_000)
        .expect("search runs");
    assert_eq!(found.ended, SearchEnd::Found);
    assert_eq!(
        found.goals[0].normalization,
        GoalNormalization::ContractionLimit
    );
    assert!(found.goals[0].normalized.is_none());
    assert_eq!(
        found.goals[0].detail.as_deref(),
        Some("combinator contraction limit 60000 exceeded")
    );
    assert_eq!(
        found.goals[1].proof.as_ref().expect("goal proved").rule,
        "next"
    );

    // A saturation call that spends the budget stops the whole search.
    let small = budget(ExecutionBasis::ClosedSk, 20_000).expect("the budget is positive");
    assert!(small.reduce("counter", &node("(seen z)"), 10_000).is_ok());
    let spent = small
        .search_or_stop("counter", &[node("(seen z)")], &[], 128, 10_000, 10_000)
        .expect("search runs")
        .expect_err("the saturation spends the budget");
    assert_eq!(spent.normalization, GoalNormalization::ContractionLimit);
    assert_eq!(spent.detail, "combinator contraction limit 20000 exceeded");
    assert_eq!(
        small
            .search("counter", &[node("(seen z)")], &[], 128, 10_000, 10_000)
            .expect_err("search reports the budget as an error"),
        spent.detail
    );

    // The direct basis makes no kernel call, so the budget does not bound it:
    // the wide goal normalizes and is searched for without a proof.
    let direct = budget(ExecutionBasis::DirectStructural, 1).expect("the budget is positive");
    let searched = direct
        .search("counter", &goals, &[], 128, 10_000, 10_000)
        .expect("search runs");
    assert_eq!(searched.ended, SearchEnd::Saturated);
    let rules = searched
        .goals
        .iter()
        .map(|goal| {
            assert_eq!(goal.normalization, GoalNormalization::Normal);
            goal.proof.as_ref().map(|proof| proof.rule.as_str())
        })
        .collect::<Vec<_>>();
    assert_eq!(rules, [None, Some("next")]);
}

#[test]
fn loads_the_forms_a_layer_derives_from_the_same_parse() {
    let layered = "(linked-program base)\n\
         (linked-rewrite base finish (from (start ?x)) (to (done ?x)))\n\
         (wrapped-program wrapper base)";
    let mut heads = Vec::new();
    let programs =
        LinkedProgramRegistry::from_rml_expanded(layered, ExecutionBasis::ClosedSk, &[], |forms| {
            let mut derived = Vec::new();
            for form in forms {
                let Node::List(children) = form else {
                    continue;
                };
                heads.push(children[0].clone());
                if children[0] == Node::Leaf("wrapped-program".to_string()) {
                    derived.push(Node::List(vec![
                        Node::Leaf("linked-program".to_string()),
                        children[1].clone(),
                        Node::List(vec![Node::Leaf("uses".to_string()), children[2].clone()]),
                    ]));
                }
            }
            Ok(derived)
        })
        .expect("layered source loads");
    assert_eq!(
        heads,
        ["linked-program", "linked-rewrite", "wrapped-program"]
            .map(|head| Node::Leaf(head.to_string()))
    );
    assert_eq!(programs.names(), ["base", "wrapper"]);
    assert_eq!(
        programs
            .reduce("wrapper", &node("(start a)"), 10_000)
            .expect("wrapper reduces")
            .term,
        node("(done a)")
    );
    assert!(programs
        .runtime_semantic_trace()
        .observed_operations
        .contains(&"parse-linked-forms".to_string()));
    let base = programs.program("base").expect("base is loaded");
    assert_eq!(base.rewrites[0].name, "finish");
    assert_eq!(
        programs.program("wrapper").expect("wrapper").uses[0].program,
        "base"
    );
    assert!(programs.program("missing").is_none());
    assert_eq!(programs.execution_basis(), ExecutionBasis::ClosedSk);

    // Derived forms are validated like parsed ones, and a failing layer stops the load.
    let unknown =
        LinkedProgramRegistry::from_rml_expanded(layered, ExecutionBasis::ClosedSk, &[], |_| {
            Ok(vec![node("(linked-program broken (uses missing))")])
        })
        .expect_err("unknown dependency");
    assert!(unknown.contains("linked-program broken uses unknown program missing"));
    let rejected =
        LinkedProgramRegistry::from_rml_expanded(layered, ExecutionBasis::ClosedSk, &[], |_| {
            Err("layer rejected the source".to_string())
        })
        .expect_err("layer error");
    assert_eq!(rejected, "layer rejected the source");
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
            "contract-s-link",
            "contract-k-link",
            "parse-linked-forms",
            "enforce-cycle-and-resource-bounds",
        ]
    );
    assert!(report.derived_host_services.is_empty());
    assert!(report.object_semantics.is_empty());
    assert_eq!(
        report.semantic_source.artifact,
        "lib/meta-theory/fixed-point-source.lino"
    );
    assert_eq!(report.semantic_source.schema, "rml-lambda-link-dag-v1");
    assert_eq!(
        report.semantic_source.representation,
        "addressed-doublet-network"
    );
    assert_eq!(
        report.semantic_source.upstream_model,
        "network-duplet-function"
    );
    assert_eq!(report.semantic_source.source_nodes, 1446);
    assert_eq!(report.semantic_source.runtime_nodes, 35674);
    assert_eq!(report.semantic_source.roots, 25);
    assert_eq!(
        report.semantic_source.provenance,
        "represented-as-addressed-links"
    );
    assert!(
        !report
            .semantic_source
            .compiled_from_external_semantic_description
    );
    assert_eq!(
        report
            .semantic_law_provenance
            .iter()
            .map(|item| (item.operation, item.provenance, item.law))
            .collect::<Vec<_>>(),
        vec![
            (
                "contract-s-link",
                "externally-primitive",
                "S x y z -> x z (y z)",
            ),
            ("contract-k-link", "externally-primitive", "K x y -> x",),
        ]
    );
    assert_eq!(report.minimization_experiments.len(), 4);
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

    assert_eq!(report.schema, "rml-bootstrap-metrics/v4");
    assert_eq!(
        report.provenance_classifications,
        vec![
            "represented-as-addressed-links",
            "derived-inside-system",
            "compiled-from-external-semantic-description",
            "externally-primitive",
        ]
    );
    assert_eq!(
        report.removal_classifications,
        vec![
            "INDEPENDENT",
            "DERIVABLE",
            "EQUIVALENT_REENCODING",
            "UNKNOWN",
        ]
    );
    assert_eq!(report.current.total_host_semantic_operations, 2);
    assert_eq!(report.current.independent_host_primitives.confirmed, 2);
    assert_eq!(report.current.independent_host_primitives.unknown, 0);
    assert_eq!(report.current.derived_host_semantic_services, 0);
    assert_eq!(report.current.duplicated_semantic_capabilities, 0);
    assert_eq!(report.current.object_specific_host_semantics, 0);
    assert_eq!(report.current.undocumented_semantic_paths, 0);
    assert_eq!(
        report
            .current
            .external_semantic_information
            .independent_laws,
        2
    );
    assert_eq!(
        report.current.external_semantic_information.law_names,
        vec!["contract-s-link", "contract-k-link"]
    );
    assert_eq!(
        report.current.external_semantic_information.provenance,
        "externally-primitive"
    );
    assert_eq!(
        report.semantic_provenance.authoritative_source.provenance,
        "represented-as-addressed-links"
    );
    assert!(
        !report
            .semantic_provenance
            .authoritative_source
            .compiled_from_external_semantic_description
    );
    assert!(report
        .semantic_provenance
        .derived_capabilities
        .iter()
        .all(|item| item.provenance == "derived-inside-system"));
    assert_eq!(report.semantic_provenance.derived_capabilities.len(), 6);
    assert_eq!(
        report.semantic_provenance.eliminated_external_sources.len(),
        1
    );
    assert_eq!(
        report.semantic_provenance.eliminated_external_sources[0].id,
        "buildSourceKernel"
    );
    assert!(!report.semantic_provenance.eliminated_external_sources[0].present);
    assert_eq!(report.foundation_search_experiments.len(), 3);
    assert_eq!(
        report.foundation_search_experiments[0].candidate,
        "zero-semantic-transition"
    );
    assert_eq!(report.foundation_search_experiments[0].surface_law_count, 0);
    assert_eq!(
        report.foundation_search_experiments[0].residual_external_semantic_law_count,
        0
    );
    assert_eq!(
        report.foundation_search_experiments[0].baseline_preserved,
        Some(false)
    );
    assert!(!report.foundation_search_experiments[0]
        .observed_failure
        .is_empty());
    let iota = &report.foundation_search_experiments[2];
    assert_eq!(iota.candidate, "iota");
    assert_eq!(iota.classification, "EQUIVALENT_REENCODING");
    assert_eq!(iota.surface_law_count, 1);
    assert_eq!(iota.residual_external_semantic_law_count, 2);
    assert_eq!(iota.baseline_preserved, Some(true));
    assert_eq!(
        iota.experiment_scope,
        Some("residual-basis-equivalence-witness")
    );
    assert_eq!(
        iota.observed_external_operations,
        vec!["contract-k-link", "contract-s-link"]
    );
    assert_eq!(iota.semantic_information_reduced, Some(false));
    assert_eq!(report.current.self_hosting_closure.linked_capabilities, 6);
    assert_eq!(
        report.current.self_hosting_closure.task,
        "linked-load-import-reduce-infer-and-self-verify-above-residual-basis"
    );
    assert_eq!(
        report.current.self_hosting_closure.linked_capability_names,
        vec![
            "matching",
            "substitution",
            "rule-selection-and-traversal",
            "import-and-rebinding",
            "inference-saturation",
            "result-verification",
        ]
    );
    assert_eq!(report.current.self_hosting_closure.host_capabilities, 0);
    assert!(report
        .current
        .self_hosting_closure
        .host_capability_names
        .is_empty());
    assert_eq!(report.current.self_hosting_closure.total_capabilities, 6);
    assert_eq!(report.current.self_hosting_closure.numerator, 6);
    assert_eq!(report.current.self_hosting_closure.denominator, 6);
    assert_eq!(
        report
            .current
            .foundation_compression
            .smallest_sufficient_host_operations,
        2
    );
    assert_eq!(
        report.current.foundation_compression.basis,
        "semantic-operation fault injection over the complete acceptance probe"
    );
    assert_eq!(
        report.current.foundation_compression.candidate_operations,
        report.current.foundation_compression.sufficient_operations
    );
    assert_eq!(
        report.current.foundation_compression.candidate_operations,
        vec!["contract-s-link", "contract-k-link"]
    );
    assert_eq!(
        report
            .current
            .foundation_compression
            .original_host_operations,
        8
    );
    assert_eq!(report.current.foundation_compression.numerator, 2);
    assert_eq!(report.current.foundation_compression.denominator, 8);
    assert_eq!(
        report.current.residual_semantic_basis.operations,
        vec!["contract-s-link", "contract-k-link"]
    );
    assert_eq!(
        report
            .current
            .residual_semantic_basis
            .experimentally_necessary,
        2
    );
    assert_eq!(
        report
            .current
            .residual_semantic_basis
            .equivalent_one_rule_bases,
        vec!["iota"]
    );

    assert_eq!(
        report
            .host_semantic_layers
            .iter()
            .map(|layer| (layer.layer, layer.count))
            .collect::<Vec<_>>(),
        vec![
            ("semantic-bootstrap", 2),
            ("derived-host-semantics", 0),
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
    assert_eq!(report.removal_experiments.len(), 4);
    assert!(report.removal_experiments.iter().all(|experiment| {
        !experiment.baseline_preserved && !experiment.observed_failure.is_empty()
    }));
    assert_eq!(
        report
            .removal_experiments
            .iter()
            .map(|experiment| (experiment.operation, experiment.classification))
            .collect::<std::collections::BTreeMap<_, _>>(),
        std::collections::BTreeMap::from([
            ("contract-s-link", "INDEPENDENT"),
            ("contract-k-link", "INDEPENDENT"),
            ("parse-linked-forms", "UNKNOWN"),
            ("enforce-cycle-and-resource-bounds", "UNKNOWN"),
        ])
    );
    assert!(report.host_linked_duplications.is_empty());
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
        10
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
    assert_eq!(total.previous.as_deref(), Some("2"));
    assert_eq!(total.current, "2");
    assert_eq!(total.delta.as_deref(), Some("0"));
    assert_eq!(
        report.previous_revision,
        "8b39df510a083e5cbe2a56a72e6595aae7b48146"
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
            ("total-host-semantic-operations", Some("2"), "2", Some("0"),),
            (
                "independent-host-primitives",
                Some("2 confirmed; 0 unknown"),
                "2 confirmed; 0 unknown",
                None,
            ),
            ("derived-host-semantic-services", Some("0"), "0", Some("0"),),
            (
                "host-linked-duplicated-semantics",
                Some("0"),
                "0",
                Some("0")
            ),
            ("object-specific-host-semantics", Some("0"), "0", Some("0")),
            ("undocumented-semantic-paths", Some("0"), "0", Some("0")),
            ("self-hosting-closure", Some("6/6"), "6/6", None),
            ("foundation-compression-ratio", Some("2/8"), "2/8", None),
            ("independent-external-semantic-laws", None, "2", None),
            (
                "external-semantic-source-descriptions",
                Some("1"),
                "0",
                Some("-1")
            ),
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

/// Swaps the body of one `links-meta-foundation` rule in the source text; the
/// runtime crate stays the same, so any change in the answer comes from D'.
fn replace_meta_foundation_rule(text: &str, name: &str, body: &str) -> String {
    let header = format!("(linked-rewrite links-meta-foundation {name}\n");
    let start = text
        .find(&header)
        .unwrap_or_else(|| panic!("universal.lino defines {name}"));
    let end = start + text[start..].find("\n\n").expect("rule ends");
    format!("{}{}{}{}", &text[..start], header, body, &text[end..])
}

const MIRRORED_SUBSTITUTE_PAIR: &str = "  (from
    (meta-substitute (pair ?left ?right) ?bindings))
  (to
    (pair
      (meta-substitute ?right ?bindings)
      (meta-substitute ?left ?bindings))))";

#[test]
fn executes_a_replaced_linked_definition_of_k1_on_the_unchanged_runtime() {
    let original_source = source();
    let run = |text: &str, request: &Node| {
        let programs = LinkedProgramRegistry::from_rml(text).expect("linked programs load");
        let result = programs
            .reduce("links-meta-foundation", request, 10_000)
            .expect("request reduces");
        let rules: Vec<String> = result.trace.iter().map(|step| step.rule.clone()).collect();
        (
            result.term,
            rules,
            programs.runtime_semantic_trace().observed_operations,
        )
    };
    let cases = [
        (
            "matching",
            "match-repeated-variable",
            "  (from
    (match-variable (binding-found ?previous) ?name ?candidate ?bindings))
  (to (match-ok ?bindings)))",
            "(meta-rewrite
               (rules (rewrite (pair (meta-variable x) (meta-variable x)) (atom same)) (no-rules))
               (pair (atom a) (atom b)))",
            "(pair (atom a) (atom b))",
            "(atom same)",
        ),
        (
            "substitution",
            "substitute-pair",
            MIRRORED_SUBSTITUTE_PAIR,
            "(meta-rewrite
               (rules
                 (rewrite
                   (pair (atom identity) (meta-variable argument))
                   (pair (meta-variable argument) (atom done)))
                 (no-rules))
               (pair (atom identity) (atom a)))",
            "(pair (atom a) (atom done))",
            "(pair (atom done) (atom a))",
        ),
        (
            "rule selection",
            "select-next-object-rule",
            "  (from
    (select-meta-rewrite rewrite-miss ?remaining-rules ?candidate))
  (to ?candidate))",
            "(meta-rewrite
               (rules (rewrite (atom other) (atom first))
                 (rules (rewrite (atom a) (atom second)) (no-rules)))
               (atom a))",
            "(atom second)",
            "(atom a)",
        ),
        (
            "verification",
            "verify-object-result",
            "  (from (meta-verify ?result ?result))
  (to (verified ?result)))",
            "(meta-verify
               (atom a)
               (meta-rewrite
                 (rules
                   (rewrite (pair (atom identity) (meta-variable argument)) (meta-variable argument))
                   (no-rules))
                 (pair (atom identity) (atom a))))",
            "verified",
            "(verified (atom a))",
        ),
    ];

    for (mechanism, rule, body, request, before, after) in cases {
        let request = node(request);
        let (original_term, _, original_operations) = run(&original_source, &request);
        let replaced_source = replace_meta_foundation_rule(&original_source, rule, body);
        let (replaced_term, replaced_rules, replaced_operations) = run(&replaced_source, &request);
        let expected = |text: &str| {
            if text.starts_with('(') {
                node(text)
            } else {
                Node::Leaf(text.to_string())
            }
        };
        assert_eq!(original_term, expected(before), "{mechanism} under D");
        assert_eq!(replaced_term, expected(after), "{mechanism} under D'");
        assert!(
            replaced_rules.iter().any(|fired| fired == rule),
            "{mechanism} fires the replaced {rule}"
        );
        assert_eq!(
            replaced_operations, original_operations,
            "{mechanism} host operations"
        );
        assert_eq!(
            original_operations,
            [
                "contract-k-link",
                "contract-s-link",
                "enforce-cycle-and-resource-bounds",
                "parse-linked-forms",
            ]
        );
    }

    // The runtime names none of the constructors these rule bodies use, so
    // no host branch can decide what the replaced definitions do.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let runtime = [
        "src/linked_program.rs",
        "src/linked_program/combinator_kernel.rs",
    ]
    .iter()
    .map(|file| fs::read_to_string(manifest.join(file)).expect("runtime source"))
    .chain(std::iter::once(
        fs::read_to_string(manifest.join("../lib/meta-theory/fixed-point.ski"))
            .expect("kernel artifact"),
    ))
    .collect::<Vec<_>>()
    .join("\n");
    for constructor in [
        "meta-substitute",
        "finish-meta-apply",
        "select-meta-rewrite",
        "rewrite-miss",
        "binding-found",
        "match-ok",
    ] {
        assert!(
            original_source.contains(constructor),
            "universal.lino uses {constructor}"
        );
        assert!(
            !runtime.contains(constructor),
            "the runtime names {constructor}"
        );
    }
}

#[test]
fn keeps_k0_substitution_fixed_when_k1_substitution_is_replaced() {
    // K1 interprets an encoded copy of its own rule through its linked
    // substitution, while direct execution substitutes inside the compiled
    // S/K kernel. Replacing the linked rule therefore reaches the first and
    // not the second, and the two stop agreeing.
    let original_source = source();
    let mirrored_source = replace_meta_foundation_rule(
        &original_source,
        "substitute-pair",
        MIRRORED_SUBSTITUTE_PAIR,
    );
    let direct_request = node("(meta-match (atom same) (atom same) (no-bindings))");
    let self_request = Node::List(vec![
        Node::Leaf("meta-apply".to_string()),
        Node::List(vec![
            Node::Leaf("rewrite".to_string()),
            encode_object(
                &node("(meta-match (atom ?value) (atom ?value) ?bindings)"),
                true,
            ),
            encode_object(&node("(match-ok ?bindings)"), true),
        ]),
        encode_object(&direct_request, false),
    ]);
    let original = LinkedProgramRegistry::from_rml(&original_source).expect("D loads");
    let replaced = LinkedProgramRegistry::from_rml(&mirrored_source).expect("D' loads");
    let reduce = |programs: &LinkedProgramRegistry, request: &Node| {
        programs
            .reduce("links-meta-foundation", request, 10_000)
            .expect("request reduces")
            .term
    };
    let direct = node("(match-ok (no-bindings))");

    assert_eq!(reduce(&original, &direct_request), direct);
    assert_eq!(reduce(&replaced, &direct_request), direct);
    assert_eq!(
        reduce(&original, &self_request),
        Node::List(vec![
            Node::Leaf("rewrite-result".to_string()),
            encode_object(&direct, false),
        ])
    );
    assert_eq!(
        reduce(&replaced, &self_request),
        node(
            "(rewrite-result
               (pair
                 (pair (atom nil) (pair (atom no-bindings) (atom nil)))
                 (atom match-ok)))"
        )
    );
}
