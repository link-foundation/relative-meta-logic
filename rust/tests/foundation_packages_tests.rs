use rml::foundation_packages::{
    FoundationPackages, LinkedFoundationPackage, PackageImport, PackageSelection,
};
use rml::foundation_workspace::{FoundationBounds, FoundationChange};
use rml::linked_program::ExecutionBasis;
use rml::{parse_one, tokenize_one, Node};

fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).unwrap()
}
fn manifests() -> Vec<LinkedFoundationPackage> {
    vec![
        LinkedFoundationPackage {
            name: "sample-logic".to_string(),
            version: "1".to_string(),
            source: include_str!("../../test-corpus/foundation-packages/version-one.lino")
                .to_string(),
            imports: vec![],
        },
        LinkedFoundationPackage {
            name: "sample-logic".to_string(),
            version: "2".to_string(),
            source: include_str!("../../test-corpus/foundation-packages/version-two.lino")
                .to_string(),
            imports: vec![],
        },
    ]
}
fn selection(version: &str) -> PackageSelection {
    PackageSelection {
        name: "sample-logic".to_string(),
        version: version.to_string(),
        instance: "study".to_string(),
    }
}
fn direct() -> FoundationPackages {
    FoundationPackages::from_packages_with_basis(&manifests(), ExecutionBasis::DirectStructural)
        .unwrap()
}
fn ask(
    loaded: &FoundationPackages,
    selection: &PackageSelection,
) -> rml::foundation_packages::PackageResult {
    loaded
        .ask(
            selection,
            &node("(accepted rules)"),
            &[],
            FoundationBounds::default(),
        )
        .unwrap()
}
fn consumer(name: &str, version: &str, dependency: &str) -> LinkedFoundationPackage {
    LinkedFoundationPackage { name: name.to_string(), version: version.to_string(),
        imports: vec![PackageImport { name: "sample-logic".to_string(), version: dependency.to_string(), program: None, alias: None }],
        source: format!("(linked-program theory)\n(linked-fact theory seed (judgement (input rules)))\n(linked-foundation {name} (version {version}) (depends-on sample-logic (version {dependency})) (cycle-policy inductive))\n(linked-instance study (theory theory) (foundation {name} (version {version})))"),
    }
}

#[test]
fn loads_repeated_local_programs_rules_and_instances_without_renaming_terms() {
    let loaded = direct();
    let first = ask(&loaded, &selection("1"));
    let second = ask(&loaded, &selection("2"));
    assert_eq!(first.result.status, "proved");
    assert_eq!(second.result.status, "refuted");
    assert_eq!(first.result.normalized, Some(node("(accepted rules)")));
    assert_eq!(second.result.normalized, Some(node("(accepted rules)")));
    assert_eq!(first.result.instance, "study");
    assert_eq!(second.result.theory.name, "theory");
    assert_eq!(first.result.foundation.version, "1");
    assert_eq!(second.result.foundation.version, "2");
    let origin = first
        .programs
        .iter()
        .find(|item| item.address == first.result.proof.as_ref().unwrap().program)
        .unwrap();
    assert_eq!(
        (&*origin.name, &*origin.version, &*origin.program),
        ("sample-logic", "1", "rules")
    );
    let opposite = second
        .programs
        .iter()
        .find(|item| {
            item.address
                == second
                    .result
                    .refutation
                    .as_ref()
                    .unwrap()
                    .proof
                    .as_ref()
                    .unwrap()
                    .program
        })
        .unwrap();
    assert_eq!(
        (&*opposite.name, &*opposite.version, &*opposite.program),
        ("sample-logic", "2", "rules")
    );
    assert_ne!(origin.address, opposite.address);
}

#[test]
fn pins_imported_foundations_explicitly_keeping_dependency_versions_isolated() {
    let mut packages = manifests();
    packages.push(consumer("dependent", "1", "1"));
    packages.push(consumer("dependent", "2", "2"));
    let loaded =
        FoundationPackages::from_packages_with_basis(&packages, ExecutionBasis::DirectStructural)
            .unwrap();
    for (version, status) in [("1", "proved"), ("2", "refuted")] {
        let selection = PackageSelection {
            name: "dependent".to_string(),
            version: version.to_string(),
            instance: "study".to_string(),
        };
        assert_eq!(ask(&loaded, &selection).result.status, status);
    }
    let mut item = consumer("dependent", "1", "1");
    item.imports.clear();
    let mut invalid = manifests();
    invalid.push(item);
    assert!(FoundationPackages::from_packages(&invalid)
        .unwrap_err()
        .contains("undeclared foundation import"));
    let mut item = consumer("dependent", "1", "1");
    item.source = item.source.replace(
        "(depends-on sample-logic (version 1))",
        "(depends-on sample-logic)",
    );
    let mut invalid = manifests();
    invalid.push(item);
    assert!(FoundationPackages::from_packages(&invalid)
        .unwrap_err()
        .contains("explicit version"));
}

#[test]
fn imports_same_named_programs_from_two_versions_through_distinct_aliases_only() {
    let source = "(linked-program rules (uses old) (uses new))
(linked-program theory)
(linked-fact theory seed (judgement (input rules)))
(linked-program proof)
(linked-rewrite proof contrary (from (refutation-of (accepted ?x))) (to (rejected ?x)))
(linked-foundation compare (version 1) (inference rules) (proof proof) (cycle-policy inductive))
(linked-instance study (theory theory) (foundation compare (version 1)))";
    let item = LinkedFoundationPackage {
        name: "compare".to_string(),
        version: "1".to_string(),
        source: source.to_string(),
        imports: vec![
            PackageImport {
                name: "sample-logic".to_string(),
                version: "1".to_string(),
                program: Some("rules".to_string()),
                alias: Some("old".to_string()),
            },
            PackageImport {
                name: "sample-logic".to_string(),
                version: "2".to_string(),
                program: Some("rules".to_string()),
                alias: Some("new".to_string()),
            },
        ],
    };
    let mut packages = manifests();
    packages.push(item.clone());
    let loaded =
        FoundationPackages::from_packages_with_basis(&packages, ExecutionBasis::DirectStructural)
            .unwrap();
    let selection = PackageSelection {
        name: "compare".to_string(),
        version: "1".to_string(),
        instance: "study".to_string(),
    };
    assert_eq!(ask(&loaded, &selection).result.status, "contradictory");
    for alias in ["rules", "old"] {
        let mut invalid_item = item.clone();
        invalid_item.imports[1].alias = Some(alias.to_string());
        let mut invalid = manifests();
        invalid.push(invalid_item);
        assert!(FoundationPackages::from_packages(&invalid)
            .unwrap_err()
            .contains("collides"));
    }
    let mut invalid_item = item;
    invalid_item.imports.clear();
    let mut invalid = manifests();
    invalid.push(invalid_item);
    assert!(FoundationPackages::from_packages(&invalid)
        .unwrap_err()
        .contains("declared or imported"));
}

#[test]
fn scopes_assumption_revision_and_rule_mutation_without_crossing_versions() {
    let loaded = direct();
    let fact = node("(accepted extra)");
    let first = loaded
        .ask(
            &selection("1"),
            &fact,
            &[fact.clone()],
            FoundationBounds::default(),
        )
        .unwrap();
    let second = loaded
        .ask(
            &selection("2"),
            &fact,
            &[fact.clone()],
            FoundationBounds::default(),
        )
        .unwrap();
    let revision = loaded
        .revise(
            &[first, second],
            &selection("1"),
            &FoundationChange::ReplaceAssumption {
                from: fact.clone(),
                to: node("(accepted other)"),
            },
        )
        .unwrap();
    assert_eq!(revision.revisions[0].after.result.status, "unknown");
    assert_eq!(revision.revisions[1].action, "kept");
    assert_eq!(revision.revisions[1].after.result.status, "proved");
    assert_eq!(revision.revisions[1].after.result.assumptions, vec![fact]);
    let derived = vec![ask(&loaded, &selection("1")), ask(&loaded, &selection("2"))];
    let change = FoundationChange::ReplaceRule(node(
        "(linked-inference rules step (premise (input ?x)) (conclusion (different ?x)))",
    ));
    let changed = loaded.revise(&derived, &selection("1"), &change).unwrap();
    assert_eq!(changed.revisions[0].after.result.status, "unknown");
    assert_eq!(changed.revisions[1].action, "kept");
    assert_eq!(changed.revisions[1].after.result.status, "refuted");
}

#[test]
fn rejects_duplicate_mismatched_missing_and_foreign_package_contexts() {
    let package = manifests().remove(0);
    assert!(
        FoundationPackages::from_packages(&[package.clone(), package.clone()])
            .unwrap_err()
            .contains("duplicate package")
    );
    let mut mismatched = package;
    mismatched.version = "2".to_string();
    assert!(FoundationPackages::from_packages(&[mismatched])
        .unwrap_err()
        .contains("matching linked-foundation"));
    let mut invalid = manifests();
    invalid.push(consumer("dependent", "1", "3"));
    assert!(FoundationPackages::from_packages(&invalid)
        .unwrap_err()
        .contains("unloaded package"));
    let mut malformed = manifests().remove(0);
    malformed.source = malformed
        .source
        .replace("(cycle-policy inductive)", "(cycle-policy)");
    assert!(FoundationPackages::from_packages(&[malformed])
        .unwrap_err()
        .contains("cycle policy"));
    let loaded = direct();
    let mut missing = selection("1");
    missing.instance = "absent".to_string();
    assert!(loaded
        .ask(
            &missing,
            &node("(accepted rules)"),
            &[],
            FoundationBounds::default()
        )
        .unwrap_err()
        .contains("no instance"));
    let foreign = ask(&direct(), &selection("1"));
    assert!(loaded
        .revise(
            &[foreign],
            &selection("1"),
            &FoundationChange::RemoveRule {
                program: "rules".to_string(),
                rule: "step".to_string()
            }
        )
        .unwrap_err()
        .contains("returned by this package workspace"));
}

#[test]
fn executes_independent_package_versions_on_default_closed_s_k_public_path() {
    let loaded = FoundationPackages::from_packages(&manifests()).unwrap();
    assert_eq!(ask(&loaded, &selection("1")).result.status, "proved");
    assert_eq!(ask(&loaded, &selection("2")).result.status, "refuted");
    let execution = loaded
        .execute(
            &selection("1"),
            &node("(refutation-of (accepted rules))"),
            10_000,
        )
        .unwrap();
    assert_eq!(execution.result.output, Some(node("(rejected rules)")));
    assert!(execution.result.assumptions.is_empty());
    assert_eq!(execution.result.theory.name, "theory");
}
