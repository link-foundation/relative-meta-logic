use std::borrow::Cow;
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use rml::foundation_workspace::{
    FoundationBounds, FoundationChange, FoundationProof, FoundationRef, FoundationResult,
    FoundationWorkspace, Guard, InstanceSummary, Rebinding, TheoryRef,
};
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry, SearchEnd};
use rml::{key_of, parse_one, tokenize_one, Node};

fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).expect("test term must parse")
}

fn nodes(sources: &[&str]) -> Vec<Node> {
    sources.iter().map(|source| node(source)).collect()
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn packages() -> String {
    fs::read_to_string(root().join("lib/foundations/packages.lino"))
        .expect("linked foundation packages")
}

fn direct() -> FoundationWorkspace {
    FoundationWorkspace::from_rml_with_basis(&packages(), ExecutionBasis::DirectStructural, &[])
        .expect("foundation packages must load")
}

fn unary(count: usize) -> String {
    let mut term = "z".to_string();
    for _ in 0..count {
        term = format!("(s {term})");
    }
    term
}

fn ratio(part: usize, whole: usize) -> Node {
    node(&format!("(ratio {} {})", unary(part), unary(whole)))
}

fn contradiction() -> Vec<Node> {
    nodes(&["(holds rain)", "(holds (not rain))"])
}

fn weather() -> Vec<Node> {
    nodes(&[
        "(value rain (ratio three four))",
        "(value sprinkler (ratio two four))",
        "(value dark (ratio two four))",
    ])
}

// A logic none of the packages mentions, supplied only as links: necessity
// holds in every reachable world, and the second foundation adds
// reflexive access.
const UNSEEN_LOGIC: &str = "\
(linked-program necessity)
(linked-inference necessity necessity-elimination
  (premise (true-at ?world (box ?statement)))
  (premise (reaches ?world ?other))
  (conclusion (true-at ?other ?statement)))
(linked-program reflexive-access)
(linked-inference reflexive-access reflexivity
  (premise (world ?world))
  (conclusion (reaches ?world ?world)))
(linked-foundation necessity-logic (version 1)
  (inference necessity)
  (signature (true-at ?world ?statement) (reaches ?world ?other) (world ?world))
  (cycle-policy inductive))
(linked-foundation reflexive-necessity-logic (version 1)
  (depends-on necessity-logic (version 1))
  (inference reflexive-access)
  (cycle-policy inductive))
(linked-program forecast)
(linked-fact forecast now-is-a-world (judgement (world now)))
(linked-fact forecast cold-is-necessary-now (judgement (true-at now (box cold))))
(linked-instance forecast-with-necessity (theory forecast) (foundation necessity-logic))
(linked-instance forecast-with-reflexive-necessity
  (theory forecast)
  (foundation reflexive-necessity-logic (version 1)))";

fn ask(workspace: &FoundationWorkspace, instance: &str, query: &str) -> FoundationResult {
    ask_with(workspace, instance, query, &[])
}

fn ask_with(
    workspace: &FoundationWorkspace,
    instance: &str,
    query: &str,
    assumptions: &[Node],
) -> FoundationResult {
    workspace
        .ask(
            instance,
            &node(query),
            assumptions,
            FoundationBounds::default(),
        )
        .expect("foundation question must run")
}

fn summary(result: &FoundationResult) -> (&'static str, &'static str, Option<&'static str>) {
    (
        result.status,
        result.reason,
        result
            .refutation
            .as_ref()
            .map(|refutation| refutation.status),
    )
}

fn answers(result: &FoundationResult) -> Vec<String> {
    result
        .answers
        .as_ref()
        .expect("a pattern result has answers")
        .iter()
        .map(|answer| key_of(&answer.judgement))
        .collect()
}

fn bindings(result: &FoundationResult) -> Vec<(String, Node)> {
    result
        .answers
        .as_ref()
        .expect("a pattern result has answers")[0]
        .bindings
        .clone()
}

fn degree(value: Node) -> Vec<(String, Node)> {
    vec![("?degree".to_string(), value)]
}

fn proof_rules(proof: &FoundationProof, output: &mut BTreeSet<String>) {
    output.insert(format!("{}.{}", proof.program, proof.rule));
    for premise in &proof.premises {
        proof_rules(premise, output);
    }
}

fn premise_rules(proof: &FoundationProof) -> Vec<&str> {
    proof
        .premises
        .iter()
        .map(|premise| premise.rule.as_str())
        .collect()
}

fn foundation(name: &str, version: &str) -> FoundationRef {
    FoundationRef {
        name: name.to_string(),
        version: version.to_string(),
    }
}

fn role_programs(roles: impl IntoIterator<Item = (&'static str, String)>) -> Vec<String> {
    roles
        .into_iter()
        .map(|(role, program)| format!("{role}:{program}"))
        .collect()
}

fn remove_rule(program: &str, rule: &str) -> FoundationChange {
    FoundationChange::RemoveRule {
        program: program.to_string(),
        rule: rule.to_string(),
    }
}

fn assert_error<T: std::fmt::Debug>(result: Result<T, String>, expected: &str) {
    let error = result.expect_err("the call must fail");
    assert!(
        error.contains(expected),
        "expected an error containing {expected:?}, got {error:?}"
    );
}

fn assert_inside_k0(result: &FoundationResult) {
    let operations: BTreeSet<&str> = LinkedProgramRegistry::bootstrap_kernel_report()
        .operations
        .into_iter()
        .collect();
    for operation in &result.host_operations {
        assert!(
            operations.contains(operation.as_str()),
            "{operation} is outside K0"
        );
    }
}

#[test]
fn reads_versioned_foundations_roles_and_instances_as_inspectable_data() {
    let direct = direct();
    assert_eq!(
        direct
            .foundations()
            .into_iter()
            .filter(|item| item.name == "resource-logic")
            .collect::<Vec<_>>(),
        vec![
            foundation("resource-logic", "1"),
            foundation("resource-logic", "2")
        ]
    );
    assert_error(direct.describe("resource-logic", None), "ambiguous");

    let classical = direct
        .describe("classical-logic", None)
        .expect("classical package");
    assert_eq!(classical.schema, "rml-foundation-package/v1");
    assert_eq!(
        classical.depends_on,
        vec![foundation("intuitionistic-logic", "1")]
    );
    assert_eq!(
        classical
            .closure
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>(),
        vec!["classical-logic", "intuitionistic-logic", "minimal-logic"]
    );
    assert_eq!(
        role_programs(
            classical
                .roles
                .iter()
                .map(|role| (role.role, role.program.clone()))
        ),
        vec![
            "inference:excluded-middle",
            "equality:double-negation",
            "inference:explosion",
            "inference:natural-deduction",
            "proof:refutation-by-negation",
        ]
    );
    assert_eq!(
        classical.signature,
        nodes(&["(holds ?p)", "(proposition ?p)"])
    );
    assert_eq!(classical.cycle_policy.kind, "inductive");
    assert!(classical.cycle_policy.guards.is_empty());
    assert!(classical
        .rules
        .iter()
        .any(|rule| rule.program == "double-negation"
            && rule.role == "equality"
            && rule.kind == "rewrite"));
    assert_eq!(classical.bootstrap.kernel, "K0");
    assert_eq!(
        classical.bootstrap.operations,
        LinkedProgramRegistry::bootstrap_kernel_report().operations
    );

    let resources = direct
        .describe("resource-logic", Some("2"))
        .expect("second resource package");
    assert_eq!(
        resources.depends_on,
        vec![foundation("unary-arithmetic", "1")]
    );
    assert_eq!(
        role_programs(
            resources
                .roles
                .iter()
                .map(|role| (role.role, role.program.clone()))
        ),
        vec![
            "inference:budgeting",
            "truth:consumable-resources",
            "proof:unaffordability",
            "reduction:unary-calculation",
        ]
    );
    let productive = direct
        .describe("productive-streams", None)
        .expect("productive streams package");
    assert_eq!(productive.cycle_policy.kind, "guarded-coinductive");
    assert_eq!(
        productive.cycle_policy.guards,
        vec![Guard {
            program: "stream-typing".to_string(),
            rule: "productive-stream".to_string(),
        }]
    );

    let garden = direct
        .instances()
        .into_iter()
        .find(|item| item.name == "garden-in-classical-logic");
    assert_eq!(
        garden,
        Some(InstanceSummary {
            name: "garden-in-classical-logic".to_string(),
            theory: TheoryRef {
                name: "lawn".to_string(),
                rebind: vec![
                    Rebinding {
                        from: "wet-lawn".to_string(),
                        to: "wet-garden".to_string(),
                    },
                    Rebinding {
                        from: "rain".to_string(),
                        to: "storm".to_string(),
                    },
                ],
            },
            foundation: foundation("classical-logic", "1"),
        })
    );
    assert_eq!(
        FoundationWorkspace::roles()
            .iter()
            .map(|item| format!("{}:{}", item.role, item.kind))
            .collect::<Vec<_>>(),
        vec![
            "axioms:fact",
            "inference:inference",
            "typing:inference",
            "reduction:rewrite",
            "equality:rewrite",
            "truth:rewrite",
            "proof:rewrite",
        ]
    );
    assert_eq!(
        FoundationWorkspace::result_statuses()
            .iter()
            .map(|item| item.status)
            .collect::<Vec<_>>(),
        vec![
            "proved",
            "refuted",
            "contradictory",
            "unknown",
            "exhausted",
            "unsupported"
        ]
    );
}

#[test]
fn treats_one_unchanged_theory_classically_intuitionistically_and_minimally() {
    let direct = direct();
    let unknown = ("unknown", "saturated-without-proof", Some("not-derived"));

    let classical = ask(&direct, "lawn-in-classical-logic", "(holds wet-lawn)");
    assert_eq!(
        summary(&classical),
        ("proved", "goal-derived", Some("not-derived"))
    );
    let mut rules = BTreeSet::new();
    proof_rules(classical.proof.as_ref().expect("proof"), &mut rules);
    assert!(rules.contains("excluded-middle.excluded-middle-for-proposition"));
    assert_eq!(classical.foundation.version, "1");
    assert_eq!(classical.theory.name, "lawn");
    assert_eq!(
        classical
            .refutation
            .as_ref()
            .and_then(|item| item.judgement.clone()),
        Some(node("(holds (not wet-lawn))"))
    );
    assert_eq!(
        summary(&ask(
            &direct,
            "lawn-in-intuitionistic-logic",
            "(holds wet-lawn)"
        )),
        unknown
    );
    assert_eq!(
        summary(&ask(&direct, "lawn-in-minimal-logic", "(holds wet-lawn)")),
        unknown
    );

    // Double negation is an equality of the classical foundation only, so
    // only there does the refutation of "not wet" become "wet".
    let refuted = ask(&direct, "lawn-in-classical-logic", "(holds (not wet-lawn))");
    assert_eq!(
        summary(&refuted),
        ("refuted", "refutation-derived", Some("derived"))
    );
    assert_eq!(
        refuted
            .refutation
            .as_ref()
            .and_then(|item| item.judgement.clone()),
        Some(node("(holds wet-lawn)"))
    );
    assert_eq!(
        summary(&ask(
            &direct,
            "lawn-in-intuitionistic-logic",
            "(holds (not wet-lawn))"
        )),
        unknown
    );

    let garden = ask(&direct, "garden-in-classical-logic", "(holds wet-garden)");
    assert_eq!(garden.status, "proved");
    assert_eq!(
        garden.theory.rebind,
        vec![
            Rebinding {
                from: "wet-lawn".to_string(),
                to: "wet-garden".to_string(),
            },
            Rebinding {
                from: "rain".to_string(),
                to: "storm".to_string(),
            },
        ]
    );
    assert_eq!(
        ask(&direct, "garden-in-classical-logic", "(holds wet-lawn)").status,
        "unknown"
    );
}

#[test]
fn keeps_contradictions_local_where_the_foundation_has_no_explosion() {
    let direct = direct();
    for instance in [
        "lawn-in-minimal-logic",
        "lawn-in-intuitionistic-logic",
        "lawn-in-classical-logic",
    ] {
        let result = ask_with(&direct, instance, "(holds rain)", &contradiction());
        assert_eq!(result.status, "contradictory", "{instance}");
        assert_eq!(
            result.proof.as_ref().expect("proof").program,
            "<assumption>"
        );
        assert_eq!(
            result
                .refutation
                .as_ref()
                .and_then(|item| item.proof.as_ref())
                .expect("refutation proof")
                .rule,
            "assumption-2"
        );
        assert_eq!(result.dependencies.scope, "evidence");
    }
    let frost = |instance: &str| ask_with(&direct, instance, "(holds frost)", &contradiction());
    assert_eq!(frost("lawn-in-minimal-logic").status, "unknown");
    let exploded = frost("lawn-in-intuitionistic-logic");
    assert_eq!(exploded.status, "proved");
    let proof = exploded.proof.as_ref().expect("proof");
    assert_eq!(proof.rule, "ex-falso");
    assert_eq!(proof.role, "inference");
    assert_eq!(exploded.assumptions, contradiction());
    assert_eq!(frost("lawn-in-classical-logic").status, "proved");

    // Assumptions belong to one question and never leak into the next.
    assert_eq!(
        ask(&direct, "lawn-in-intuitionistic-logic", "(holds frost)").status,
        "unknown"
    );
}

#[test]
fn compares_two_versions_of_a_resource_sensitive_foundation() {
    let direct = direct();
    let query = "(affordable (both coffee cake) yes)";
    let ask_budget = |instance: &str, budget: &str| {
        ask_with(
            &direct,
            instance,
            query,
            &[node(&format!("(budget {budget})"))],
        )
    };

    let reusable = ask_budget("cafe-with-reusable-resources", "one");
    assert_eq!(reusable.status, "proved");
    assert_eq!(reusable.foundation, foundation("resource-logic", "1"));
    let consumable = ask_budget("cafe-with-consumable-resources", "one");
    assert_eq!(consumable.status, "refuted");
    assert_eq!(consumable.foundation, foundation("resource-logic", "2"));
    assert_eq!(
        consumable
            .refutation
            .as_ref()
            .and_then(|item| item.judgement.clone()),
        Some(node("(affordable (both coffee cake) no)"))
    );
    assert_eq!(
        ask_budget("cafe-with-consumable-resources", "two").status,
        "proved"
    );
    assert_eq!(
        consumable
            .dependencies
            .rules
            .iter()
            .filter(|rule| rule.kind == "rewrite")
            .map(|rule| format!("{}:{}.{}", rule.role, rule.program, rule.rule))
            .collect::<Vec<_>>(),
        vec![
            "proof:unaffordability.refute-affordability",
            "reduction:unary-calculation.one-numeral",
        ]
    );

    let term = node("(at-most (combine one one) two)");
    let execution = direct
        .execute("cafe-with-consumable-resources", &term, 10_000)
        .expect("execution");
    assert_eq!(execution.schema, "rml-foundation-execution/v1");
    assert_eq!(execution.status, "normal");
    assert_eq!(execution.output, Some(Node::Leaf("yes".to_string())));
    let trace = execution.trace.as_ref().expect("trace");
    assert_eq!(trace[0].program, "consumable-resources");
    assert_eq!(trace[0].rule, "combine-consumable");
    assert_eq!(trace[0].role, "truth");
    assert_eq!(trace[0].before, term);
    assert_eq!(trace[0].after, node("(at-most (plus one one) two)"));
    assert!(trace[1..].iter().all(|step| step.role == "reduction"));
    assert_eq!(execution.steps, Some(trace.len()));
    let stopped = direct
        .execute("cafe-with-consumable-resources", &term, 2)
        .expect("stopped execution");
    assert_eq!(stopped.status, "exhausted");
    assert_eq!(stopped.reason, "rewrite-limit");
    assert_eq!(stopped.output, None);
}

#[test]
fn combines_user_supplied_degrees_by_the_selected_truth_policy() {
    let direct = direct();
    let degrees = |instance: &str, statement: &str, assumptions: &[Node]| {
        ask_with(
            &direct,
            instance,
            &format!("(value {statement} ?degree)"),
            assumptions,
        )
    };

    let minimum = degrees("weather-in-minimum-fuzzy-logic", "wet-grass", &weather());
    assert_eq!(minimum.status, "proved");
    assert_eq!(minimum.complete, Some(true));
    assert_eq!(bindings(&minimum), degree(ratio(3, 4)));
    assert_eq!(
        bindings(&degrees(
            "weather-in-minimum-fuzzy-logic",
            "slippery",
            &weather()
        )),
        degree(ratio(2, 4))
    );
    assert_eq!(
        bindings(&degrees(
            "weather-in-bounded-sum-fuzzy-logic",
            "wet-grass",
            &weather()
        )),
        degree(ratio(4, 4))
    );
    assert_eq!(
        bindings(&degrees(
            "weather-in-bounded-sum-fuzzy-logic",
            "slippery",
            &weather()
        )),
        degree(ratio(2, 4))
    );
    assert_eq!(
        bindings(&degrees(
            "weather-as-independent-probability",
            "wet-grass",
            &weather()
        )),
        degree(ratio(14, 16))
    );

    // Degrees are never built in: without supplied values nothing follows.
    let empty = degrees("weather-in-minimum-fuzzy-logic", "wet-grass", &[]);
    assert_eq!(empty.status, "unknown");
    assert_eq!(empty.complete, Some(true));
    assert_eq!(empty.answers, Some(Vec::new()));

    let results = vec![
        degrees(
            "weather-in-bounded-sum-fuzzy-logic",
            "wet-grass",
            &weather(),
        ),
        degrees("weather-in-bounded-sum-fuzzy-logic", "slippery", &weather()),
        ask_with(
            &direct,
            "weather-in-bounded-sum-fuzzy-logic",
            "(value dark (ratio two four))",
            &weather(),
        ),
    ];
    assert_eq!(results[2].status, "proved");
    assert_eq!(results[2].dependencies.scope, "evidence");
    assert_eq!(
        results[2].dependencies.assumptions,
        vec![weather()[2].clone()]
    );

    let drizzle = node("(value rain (ratio one four))");
    let revision = direct
        .revise(
            &results,
            &FoundationChange::ReplaceAssumption {
                from: weather()[0].clone(),
                to: drizzle.clone(),
            },
        )
        .expect("revision");
    assert!(
        matches!(revision.workspace, Cow::Borrowed(workspace) if std::ptr::eq(workspace, &direct))
    );
    let revisions = &revision.revisions;
    assert_eq!(
        revisions
            .iter()
            .map(|item| format!("{}:{}", item.action, item.changed))
            .collect::<Vec<_>>(),
        vec!["rechecked:true", "rechecked:true", "kept:false"]
    );
    assert_eq!(bindings(&revisions[0].after), degree(ratio(3, 4)));
    assert_eq!(bindings(&revisions[1].after), degree(ratio(1, 4)));
    assert_eq!(
        revisions[2].after.assumptions,
        vec![drizzle, weather()[1].clone(), weather()[2].clone()]
    );
}

#[test]
fn types_a_self_unfolding_stream_only_under_guarded_coinduction() {
    let direct = direct();
    let ask_stream =
        |instance: &str, stream: &str| ask(&direct, instance, &format!("(stream {stream})"));
    assert_eq!(
        ask_stream("finite-stream-examples", "countdown").status,
        "proved"
    );
    assert_eq!(
        ask_stream("productive-stream-examples", "countdown").status,
        "proved"
    );

    let finite = ask_stream("finite-stream-examples", "ones");
    assert_eq!(finite.status, "unknown");
    assert_eq!(finite.coinduction, None);

    let productive = ask_stream("productive-stream-examples", "ones");
    assert_eq!(productive.status, "proved");
    assert_eq!(productive.reason, "guarded-coinduction");
    assert_eq!(
        productive.coinduction.as_ref().expect("coinduction").guards,
        vec![Guard {
            program: "stream-typing".to_string(),
            rule: "productive-stream".to_string(),
        }]
    );
    let proof = productive.proof.as_ref().expect("proof");
    assert_eq!(proof.program, "stream-typing");
    assert_eq!(proof.rule, "productive-stream");
    assert_eq!(proof.judgement, node("(stream ones)"));
    assert_eq!(
        premise_rules(proof),
        vec!["ones-unfolds-into-itself", "coinductive-hypothesis"]
    );
    assert_eq!(productive.dependencies.scope, "evidence");

    // A bare alias loop never passes the guard, so no foundation types it.
    for instance in ["finite-stream-examples", "productive-stream-examples"] {
        assert_eq!(ask_stream(instance, "loop").status, "unknown", "{instance}");
    }
    let looped = ask_stream("productive-stream-examples", "loop");
    let coinduction = looped.coinduction.as_ref().expect("coinduction");
    assert_eq!(coinduction.status, "not-derived");
    assert_eq!(coinduction.search.ended, SearchEnd::Saturated);

    let typed = ask(&direct, "productive-stream-examples", "(stream ?stream)");
    assert_eq!(answers(&typed), vec!["(stream countdown)", "(stream nil)"]);
    assert_eq!(typed.complete, Some(false));
}

#[test]
fn runs_a_logic_supplied_only_as_links_through_the_same_interface() {
    let workspace = FoundationWorkspace::from_rml_with_basis(
        UNSEEN_LOGIC,
        ExecutionBasis::DirectStructural,
        &[],
    )
    .expect("unseen logic must load");
    let cold = "(true-at now cold)";
    assert_eq!(
        ask(&workspace, "forecast-with-necessity", cold).status,
        "unknown"
    );
    let reflexive = ask(&workspace, "forecast-with-reflexive-necessity", cold);
    assert_eq!(reflexive.status, "proved");
    assert_eq!(
        premise_rules(reflexive.proof.as_ref().expect("proof")),
        vec!["cold-is-necessary-now", "reflexivity"]
    );
    assert_eq!(
        reflexive.refutation.as_ref().map(|item| item.status),
        Some("undefined")
    );
    assert_eq!(
        workspace
            .describe("reflexive-necessity-logic", None)
            .expect("package")
            .closure,
        vec![
            foundation("reflexive-necessity-logic", "1"),
            foundation("necessity-logic", "1"),
        ]
    );

    let source = fs::read_to_string(root().join("rust/src/foundation_workspace.rs"))
        .expect("foundation workspace source")
        .to_lowercase();
    for name in [
        "classical",
        "intuitionis",
        "minimal",
        "modal",
        "necess",
        "fuzzy",
        "probab",
        "resource",
        "stream",
        "paraconsist",
        "excluded",
        "explosion",
        "negation",
        "łukasiewicz",
        "lukasiewicz",
        "gödel",
        "godel",
    ] {
        assert!(
            !source.contains(name),
            "the foundation workspace must not name {name}"
        );
    }
}

#[test]
fn reports_unknown_exhaustion_and_unsupported_outcomes_separately() {
    let direct = direct();
    let outside = ask(&direct, "lawn-in-classical-logic", "(stream ones)");
    assert_eq!(outside.status, "unsupported");
    assert_eq!(outside.reason, "outside-signature");
    assert!(outside
        .detail
        .as_deref()
        .is_some_and(|detail| detail.starts_with("signature: (stream ones)")));
    let pattern = ask(&direct, "lawn-in-classical-logic", "(holds ?statement)");
    assert_eq!(pattern.status, "proved");
    assert!(answers(&pattern).contains(&"(holds wet-lawn)".to_string()));
    assert_eq!(
        ask_with(
            &direct,
            "lawn-in-classical-logic",
            "(holds wet-lawn)",
            &[node("(weather rain)")]
        )
        .reason,
        "outside-signature"
    );

    let limited = direct
        .ask(
            "lawn-in-classical-logic",
            &node("(holds wet-lawn)"),
            &[],
            FoundationBounds {
                max_facts: 3,
                ..FoundationBounds::default()
            },
        )
        .expect("limited question");
    assert_eq!(limited.status, "exhausted");
    assert_eq!(limited.reason, "fact-limit");
    assert_eq!(
        limited.refutation.as_ref().map(|item| item.status),
        Some("not-derived-within-bounds")
    );

    let steps = direct
        .ask(
            "cafe-with-consumable-resources",
            &node("(costs coffee (plus two two))"),
            &[],
            FoundationBounds {
                max_steps: 2,
                ..FoundationBounds::default()
            },
        )
        .expect("bounded question");
    assert_eq!(steps.status, "exhausted");
    assert_eq!(steps.reason, "rewrite-limit");
    assert!(steps
        .detail
        .as_deref()
        .is_some_and(|detail| detail.starts_with("goal: ")));

    let cycle = FoundationWorkspace::from_rml_with_basis(
        "\
(linked-program flip-flop)
(linked-rewrite flip-flop flip (from flip) (to flop))
(linked-rewrite flip-flop flop (from flop) (to flip))
(linked-foundation flip-flop-logic (version 1)
  (equality flip-flop)
  (cycle-policy inductive))
(linked-program switch)
(linked-fact switch on (judgement (state on)))
(linked-instance switch-in-flip-flop-logic
  (theory switch)
  (foundation flip-flop-logic))",
        ExecutionBasis::DirectStructural,
        &[],
    )
    .expect("flip-flop foundation");
    let cyclic = ask(&cycle, "switch-in-flip-flop-logic", "(state flip)");
    assert_eq!(cyclic.status, "unsupported");
    assert_eq!(cyclic.reason, "rewrite-cycle");
    assert!(cyclic
        .detail
        .as_deref()
        .is_some_and(|detail| detail.starts_with("goal: rewrite cycle")));
    assert_eq!(
        ask(&cycle, "switch-in-flip-flop-logic", "(state on)").status,
        "proved"
    );

    assert_error(
        direct.ask(
            "lawn-in-classical-logic",
            &node("(holds rain)"),
            &[node("(holds ?anything)")],
            FoundationBounds::default(),
        ),
        "must be ground",
    );
    assert_error(
        direct.ask(
            "lawn-in-classical-logic",
            &node("(holds lawn-in-classical-logic--answer)"),
            &[],
            FoundationBounds::default(),
        ),
        "reserves lawn-in-classical-logic--answer",
    );
    assert_error(
        direct.ask(
            "missing-instance",
            &node("(holds rain)"),
            &[],
            FoundationBounds::default(),
        ),
        "unknown linked-instance",
    );
    assert_error(
        direct.ask(
            "lawn-in-classical-logic",
            &node("(holds rain)"),
            &[],
            FoundationBounds {
                max_rounds: 0,
                ..FoundationBounds::default()
            },
        ),
        "max_rounds must be positive",
    );
}

#[test]
fn tells_which_results_a_change_of_a_rule_or_an_assumption_affects() {
    let direct = direct();
    let countdown = ask(&direct, "productive-stream-examples", "(stream countdown)");
    let looped = ask(&direct, "productive-stream-examples", "(stream loop)");
    let wet = ask(&direct, "lawn-in-classical-logic", "(holds wet-lawn)");
    let outside = ask(&direct, "lawn-in-classical-logic", "(stream ones)");

    assert_eq!(countdown.dependencies.scope, "evidence");
    assert_eq!(
        countdown
            .dependencies
            .rules
            .iter()
            .map(|rule| format!("{}:{}.{}", rule.kind, rule.program, rule.rule))
            .collect::<Vec<_>>(),
        vec![
            "fact:stream-examples.countdown-unfolds-into-nil",
            "fact:stream-examples.nil-is-empty",
            "inference:stream-typing.empty-stream",
            "inference:stream-typing.productive-stream",
        ]
    );
    let affected = |result: &FoundationResult, change: &FoundationChange| {
        direct
            .affected_by(result, change)
            .expect("the change must be valid")
    };
    let remove_alias = remove_rule("stream-examples", "loop-aliases-itself");
    assert!(!affected(&countdown, &remove_alias));
    assert!(affected(&looped, &remove_alias));
    assert!(affected(
        &countdown,
        &remove_rule("stream-examples", "nil-is-empty")
    ));
    let add_fact = FoundationChange::AddRule(node(
        "(linked-fact stream-examples more (judgement (empty more)))",
    ));
    assert!(!affected(&countdown, &add_fact));
    assert!(affected(&looped, &add_fact));
    assert!(!affected(&wet, &add_fact));
    let add_rewrite = FoundationChange::AddRule(node(
        "(linked-rewrite stream-examples rename (from nil) (to empty-list))",
    ));
    assert!(affected(&countdown, &add_rewrite));
    assert!(!affected(
        &outside,
        &remove_rule("lawn", "rain-wets-the-lawn")
    ));
    assert!(!affected(
        &wet,
        &FoundationChange::ReplaceAssumption {
            from: node("(holds rain)"),
            to: node("(holds frost)"),
        }
    ));

    let revision = direct
        .revise(
            &[wet.clone(), countdown.clone()],
            &remove_rule("excluded-middle", "excluded-middle-for-proposition"),
        )
        .expect("revision");
    assert!(matches!(revision.workspace, Cow::Owned(_)));
    assert_eq!(
        revision
            .revisions
            .iter()
            .map(|item| format!("{}:{}", item.action, item.changed))
            .collect::<Vec<_>>(),
        vec!["rechecked:true", "kept:false"]
    );
    assert_eq!(revision.revisions[0].after.status, "unknown");
    assert_eq!(
        ask(&direct, "lawn-in-classical-logic", "(holds wet-lawn)").status,
        "proved"
    );
    assert_error(
        direct.revise(
            std::slice::from_ref(&wet),
            &remove_rule("lawn", "no-such-rule"),
        ),
        "no linked rule lawn.no-such-rule",
    );
    assert_error(
        direct.revise(
            std::slice::from_ref(&wet),
            &FoundationChange::AddRule(node(
                "(linked-rewrite natural-deduction tidy (from x) (to y))",
            )),
        ),
        "admits only inference rules",
    );
}

#[test]
fn rejects_malformed_foundations_and_instances() {
    let load = |lines: &[&str]| {
        let base = [
            "(linked-program rules)",
            "(linked-inference rules step (premise (a ?x)) (conclusion (b ?x)))",
            "(linked-program facts)",
            "(linked-fact facts one (judgement (a one)))",
        ];
        let source = base
            .iter()
            .chain(lines)
            .copied()
            .collect::<Vec<_>>()
            .join("\n");
        FoundationWorkspace::from_rml_with_basis(&source, ExecutionBasis::DirectStructural, &[])
    };
    let cases: &[(&[&str], &str)] = &[
        (
            &["(linked-foundation f (inference rules) (cycle-policy inductive))"],
            "requires (version value)",
        ),
        (
            &["(linked-foundation f (version 1) (inference rules))"],
            "requires (cycle-policy",
        ),
        (
            &["(linked-foundation f (version 1) (magic rules) (cycle-policy inductive))"],
            "unsupported clause magic",
        ),
        (
            &["(linked-foundation f (version 1) (inference missing) (cycle-policy inductive))"],
            "inference program missing is not a linked-program",
        ),
        (
            &["(linked-foundation f (version 1) (reduction rules) (cycle-policy inductive))"],
            "admits only rewrite rules",
        ),
        (
            &["(linked-foundation f (version 1) (inference rules) (cycle-policy guarded-coinductive (guard facts one)))"],
            "must name a rule of an inference or typing program",
        ),
        (
            &[
                "(linked-foundation f (version 1) (depends-on g (version 1)) (cycle-policy inductive))",
                "(linked-foundation g (version 1) (depends-on f (version 1)) (cycle-policy inductive))",
            ],
            "dependency cycle",
        ),
        (
            &[
                "(linked-foundation f (version 1) (cycle-policy inductive))",
                "(linked-foundation f (version 2) (cycle-policy inductive))",
                "(linked-instance i (theory facts) (foundation f))",
            ],
            "ambiguous among versions 1, 2",
        ),
        (
            &[
                "(linked-foundation f (version 1) (inference rules) (cycle-policy inductive))",
                "(linked-instance i (theory rules) (foundation f))",
            ],
            "is the inference program of its foundation",
        ),
        (
            &[
                "(linked-program i--answer)",
                "(linked-foundation f (version 1) (inference rules) (cycle-policy inductive))",
                "(linked-instance i (theory facts) (foundation f))",
            ],
            "needs the program name i--answer",
        ),
        (
            &[
                "(linked-fact facts two (judgement (a i--guarded)))",
                "(linked-foundation f (version 1) (inference rules) (cycle-policy inductive))",
                "(linked-instance i (theory facts) (foundation f))",
            ],
            "reserves i--guarded",
        ),
    ];
    for (lines, expected) in cases {
        assert_error(load(lines), expected);
    }
    assert_error(
        FoundationWorkspace::from_rml_with_basis(&packages(), ExecutionBasis::HornRelational, &[]),
        "does not perform",
    );
}

#[test]
fn runs_the_same_witnesses_on_the_closed_s_k_basis_inside_k0() {
    let workspace = FoundationWorkspace::from_rml(&packages()).expect("closed S/K packages");
    assert_eq!(workspace.execution_basis(), ExecutionBasis::ClosedSk);
    assert_eq!(workspace.max_contractions(), 100_000_000);

    let streams: Vec<FoundationResult> = ["countdown", "ones", "loop"]
        .iter()
        .map(|stream| {
            ask(
                &workspace,
                "productive-stream-examples",
                &format!("(stream {stream})"),
            )
        })
        .collect();
    assert_eq!(
        streams
            .iter()
            .map(|result| result.reason)
            .collect::<Vec<_>>(),
        vec![
            "goal-derived",
            "guarded-coinduction",
            "saturated-without-proof"
        ]
    );
    assert_eq!(
        ask_with(
            &workspace,
            "lawn-in-minimal-logic",
            "(holds rain)",
            &contradiction()
        )
        .status,
        "contradictory"
    );
    assert_eq!(
        ask_with(
            &workspace,
            "lawn-in-minimal-logic",
            "(holds frost)",
            &contradiction()
        )
        .status,
        "unknown"
    );
    let outside = ask(&workspace, "productive-stream-examples", "(holds rain)");
    assert_eq!(outside.reason, "outside-signature");
    // Pattern variables pass the signature check as opaque leaves.
    let typed = ask(&workspace, "productive-stream-examples", "(stream ?stream)");
    assert_eq!(answers(&typed), vec!["(stream countdown)", "(stream nil)"]);

    let unseen = FoundationWorkspace::from_rml(UNSEEN_LOGIC).expect("unseen logic on S/K");
    let cold = "(true-at now cold)";
    assert_eq!(
        ask(&unseen, "forecast-with-necessity", cold).status,
        "unknown"
    );
    assert_eq!(
        ask(&unseen, "forecast-with-reflexive-necessity", cold).status,
        "proved"
    );

    for result in streams.iter().chain([&outside, &typed]) {
        assert_inside_k0(result);
        assert_eq!(result.execution_basis, ExecutionBasis::ClosedSk);
    }
    assert!(streams[1]
        .host_operations
        .contains(&"contract-s-link".to_string()));
}

#[test]
fn reports_a_spent_contraction_budget_of_the_closed_kernel_as_exhaustion() {
    let bounded = |max_contractions| {
        FoundationWorkspace::from_rml(&packages())
            .expect("closed S/K packages")
            .with_max_contractions(max_contractions)
    };
    assert_error(bounded(0), "max_contractions must be positive");
    // Each closed kernel call of a question has the whole budget, so a larger
    // budget moves the stage that spends it from the signature check through
    // the assumptions, the goal, and the derivation to the guarded cycle.
    let stages = [
        (
            1000,
            "lawn-in-classical-logic",
            "(holds wet-lawn)",
            Vec::new(),
            "signature",
        ),
        (
            200_000,
            "lawn-in-minimal-logic",
            "(holds frost)",
            contradiction(),
            "assumption 1",
        ),
        (
            250_000,
            "lawn-in-classical-logic",
            "(holds wet-lawn)",
            Vec::new(),
            "goal",
        ),
        (
            450_000,
            "lawn-in-minimal-logic",
            "(holds wet-lawn)",
            Vec::new(),
            "derivation",
        ),
        (
            1_000_000,
            "productive-stream-examples",
            "(stream ones)",
            Vec::new(),
            "hypothesis",
        ),
    ];
    for (max_contractions, instance, query, assumptions, stage) in stages {
        let workspace = bounded(max_contractions).expect("the budget is positive");
        let result = ask_with(&workspace, instance, query, &assumptions);
        assert_eq!(result.status, "exhausted");
        assert_eq!(result.reason, "contraction-limit");
        assert_eq!(
            result.detail,
            Some(format!(
                "{stage}: combinator contraction limit {max_contractions} exceeded"
            ))
        );
        assert!(result.proof.is_none());
        assert_inside_k0(&result);
    }

    let tight = bounded(3000).expect("the budget is positive");
    let execution = tight
        .execute(
            "cafe-with-consumable-resources",
            &node("(at-most (combine one one) two)"),
            10_000,
        )
        .expect("execution");
    assert_eq!(execution.status, "exhausted");
    assert_eq!(execution.reason, "contraction-limit");
    assert_eq!(
        execution.detail.as_deref(),
        Some("combinator contraction limit 3000 exceeded")
    );
    assert_eq!(execution.output, None);

    // A rule change builds the revised workspace with the same budget.
    let workspace = bounded(250_000).expect("the budget is positive");
    let wet = ask(&workspace, "lawn-in-classical-logic", "(holds wet-lawn)");
    let revision = workspace
        .revise(
            std::slice::from_ref(&wet),
            &remove_rule("excluded-middle", "excluded-middle-for-proposition"),
        )
        .expect("revision");
    assert_eq!(revision.workspace.max_contractions(), 250_000);
    let revised = &revision.revisions[0];
    assert_eq!((revised.action, revised.changed), ("rechecked", false));
    assert_eq!(revised.after.detail, wet.detail);
}
