use rml::linked_program::{BootstrapKernelReport, BootstrapTrustNode, LinkedProgramRegistry};
use serde_json::Value;

const OPERATIONS: &[&str] = &[
    "contract-s-link",
    "contract-k-link",
    "parse-linked-forms",
    "enforce-cycle-and-resource-bounds",
];
const FIXTURE: &str = include_str!("../../test-corpus/bootstrap-boundary/cases.json");

fn node<'a>(report: &'a mut BootstrapKernelReport, id: &str) -> &'a mut BootstrapTrustNode {
    report
        .trust_graph
        .nodes
        .iter_mut()
        .find(|node| node.id == id)
        .unwrap()
}

fn corrupt(
    report: &mut BootstrapKernelReport,
    implemented: &mut Vec<&'static str>,
    id: &str,
    variant: usize,
) {
    match id {
        "missing_primitive_reasons" => {
            node(report, OPERATIONS[variant / 2]).primitive_reason =
                if variant % 2 == 0 { "" } else { " \n " };
        }
        "missing_dependency_targets" => node(report, "matching")
            .depends_on
            .push("missing-dependency"),
        "dependency_cycles" => {
            let id = ["matching", "contract-s-link"][variant];
            node(report, id).depends_on = vec![id];
        }
        "unterminated_public_paths" => {
            node(report, "reduce-linked-program")
                .depends_on
                .push("detached-terminal");
            report.trust_graph.nodes.push(BootstrapTrustNode {
                id: "detached-terminal",
                layer: "links-defined-service",
                depends_on: vec![],
                primitive_reason: "",
            });
        }
        "forged_primitive_reasons" => {
            node(report, "matching").depends_on.clear();
            node(report, "matching").primitive_reason = "A reason is not membership in K0.";
        }
        "missing_public_paths" => report
            .trust_graph
            .nodes
            .retain(|node| node.id != "load-linked-program"),
        "missing_boundary_nodes" => report
            .trust_graph
            .nodes
            .retain(|node| node.id != "contract-s-link"),
        "unreported_operations" => implemented.push("hidden-object-evaluator"),
        "unimplemented_operations" => {
            implemented.remove(0);
        }
        "unsupported_irreducibility" => {
            report.claims_irreducible = true;
            if variant == 1 {
                report.fixed_point_criterion = "";
            }
        }
        "missing_criterion" => report.fixed_point_criterion = " \n ",
        "missing_experiments" => report
            .minimization_experiments
            .retain(|item| item.operation != "contract-s-link"),
        "duplicate_nodes" => {
            let duplicate = node(report, "contract-s-link").clone();
            report.trust_graph.nodes.push(duplicate);
        }
        "duplicate_operations" => {
            if variant == 0 {
                report.operations.push("contract-s-link");
            } else {
                implemented.push("contract-s-link");
            }
        }
        "unreported_bootstrap_nodes" => report.trust_graph.nodes.push(BootstrapTrustNode {
            id: "hidden-object-evaluator",
            layer: "bootstrap",
            depends_on: vec![],
            primitive_reason: "Forged authority.",
        }),
        "unsupported_scope" => report.trust_graph.schema = "unrecognized",
        _ => panic!("unknown corruption {id}"),
    }
}

fn rejects_case(id: &str) {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    let sample = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|sample| sample["id"] == id)
        .unwrap();
    let count = match id {
        "missing_primitive_reasons" => 8,
        "dependency_cycles" | "unsupported_irreducibility" | "duplicate_operations" => 2,
        _ => 1,
    };
    let original = LinkedProgramRegistry::bootstrap_kernel_report();
    for variant in 0..count {
        let mut report = original.clone();
        let mut implemented = OPERATIONS.to_vec();
        corrupt(&mut report, &mut implemented, id, variant);
        let error =
            LinkedProgramRegistry::audit_bootstrap_report(&report, &implemented).unwrap_err();
        assert!(
            error.contains(sample["error"].as_str().unwrap()),
            "{id}[{variant}]: {error}"
        );
    }
}

#[test]
fn accepts_the_current_k0_report_against_an_independent_boundary_inventory() {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    let expected: Vec<&str> = fixture["operations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap())
        .collect();
    assert_eq!(expected, OPERATIONS);
    let report = LinkedProgramRegistry::bootstrap_kernel_report();
    assert_eq!(report.operations, OPERATIONS);
    assert!(!report.claims_irreducible);
    assert!(!report.fixed_point_criterion.trim().is_empty());
    assert!(LinkedProgramRegistry::audit_bootstrap_report(&report, OPERATIONS).is_ok());
    assert!(LinkedProgramRegistry::audit_bootstrap_kernel(None).is_ok());
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 16);
}

#[test]
fn rejects_missing_primitive_reasons_for_every_declared_boundary_operation() {
    rejects_case("missing_primitive_reasons");
}
#[test]
fn rejects_missing_trust_graph_dependency_targets() {
    rejects_case("missing_dependency_targets");
}
#[test]
fn rejects_trust_graph_dependency_cycles_including_bootstrap_nodes() {
    rejects_case("dependency_cycles");
}
#[test]
fn rejects_public_paths_with_a_branch_that_does_not_terminate_in_k0() {
    rejects_case("unterminated_public_paths");
}
#[test]
fn rejects_a_nonprimitive_terminal_despite_a_forged_primitive_reason() {
    rejects_case("forged_primitive_reasons");
}
#[test]
fn rejects_an_omitted_public_bootstrap_path() {
    rejects_case("missing_public_paths");
}
#[test]
fn rejects_a_declared_boundary_operation_missing_from_the_trust_graph() {
    rejects_case("missing_boundary_nodes");
}
#[test]
fn rejects_an_implemented_operation_absent_from_the_supplied_report() {
    rejects_case("unreported_operations");
}
#[test]
fn rejects_a_reported_operation_absent_from_the_independent_implementation_list() {
    rejects_case("unimplemented_operations");
}
#[test]
fn rejects_irreducibility_claims_with_or_without_a_written_criterion() {
    rejects_case("unsupported_irreducibility");
}
#[test]
fn rejects_a_current_boundary_report_without_a_fixed_point_criterion() {
    rejects_case("missing_criterion");
}
#[test]
fn rejects_a_boundary_operation_without_a_minimization_experiment() {
    rejects_case("missing_experiments");
}
#[test]
fn rejects_duplicate_trust_graph_node_identities() {
    rejects_case("duplicate_nodes");
}
#[test]
fn rejects_duplicate_report_and_implementation_operation_identities() {
    rejects_case("duplicate_operations");
}
#[test]
fn rejects_a_bootstrap_graph_node_absent_from_the_boundary_inventory() {
    rejects_case("unreported_bootstrap_nodes");
}
#[test]
fn rejects_a_report_from_an_unsupported_bootstrap_scope() {
    rejects_case("unsupported_scope");
}

#[test]
fn the_default_audit_rejects_an_unreported_implementation_operation() {
    let mut implemented = OPERATIONS.to_vec();
    implemented.push("hidden-object-evaluator");
    assert_eq!(
        LinkedProgramRegistry::audit_bootstrap_kernel(Some(&implemented)).unwrap_err(),
        "unreported host semantic operation hidden-object-evaluator"
    );
}
