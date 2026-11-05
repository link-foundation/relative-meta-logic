//! Mirrors js/tests/runtime-trust-coverage.test.mjs: the executed bootstrap
//! probe trace compared with the kernel trust graph, and injected or
//! de-documented paths, operations and segments reported as undocumented.

use rml::linked_program::{BootstrapObservedPathSegment, LinkedProgramRegistry};

const SOURCE: &str = include_str!("../../lib/meta-theory/universal.lino");

fn segment(path: &str, operation: &str) -> BootstrapObservedPathSegment {
    BootstrapObservedPathSegment {
        path: path.to_string(),
        operation: operation.to_string(),
    }
}

#[test]
fn runtime_trace_documents_every_path_operation_and_segment() {
    let report = LinkedProgramRegistry::bootstrap_metrics_report(SOURCE).unwrap();
    let kernel = LinkedProgramRegistry::bootstrap_kernel_report();
    let coverage = LinkedProgramRegistry::runtime_trust_graph_coverage(
        &report.runtime_trust_graph_coverage.trace,
        &kernel,
    );
    assert_eq!(coverage.total_observed_paths, 4);
    assert_eq!(coverage.total_observed_path_segments, 10);
    assert!(coverage.undocumented_paths.is_empty());
    assert!(coverage.undocumented_operations.is_empty());
    assert!(coverage.undocumented_path_segments.is_empty());
    assert_eq!(coverage, report.runtime_trust_graph_coverage);
}

#[test]
fn runtime_trace_injection_is_reported_as_undocumented() {
    let report = LinkedProgramRegistry::bootstrap_metrics_report(SOURCE).unwrap();
    let kernel = LinkedProgramRegistry::bootstrap_kernel_report();
    let mut trace = report.runtime_trust_graph_coverage.trace.clone();
    let documented_path = trace.observed_paths[0].clone();
    trace.observed_paths.push("host-shortcut-path".to_string());
    trace
        .observed_operations
        .push("host-shortcut-operation".to_string());
    trace
        .observed_path_segments
        .push(segment(&documented_path, "host-shortcut-operation"));
    trace
        .observed_path_segments
        .push(segment("host-shortcut-path", kernel.operations[0]));
    let coverage = LinkedProgramRegistry::runtime_trust_graph_coverage(&trace, &kernel);
    assert_eq!(
        coverage.undocumented_paths,
        vec!["host-shortcut-path".to_string()]
    );
    assert_eq!(
        coverage.undocumented_operations,
        vec!["host-shortcut-operation".to_string()]
    );
    assert_eq!(
        coverage.undocumented_path_segments,
        vec![
            segment(&documented_path, "host-shortcut-operation"),
            segment("host-shortcut-path", kernel.operations[0]),
        ]
    );
    assert_eq!(
        coverage.documented_observed_paths,
        coverage.total_observed_paths - 1
    );
    assert_eq!(
        coverage.documented_observed_path_segments,
        coverage.total_observed_path_segments - 2
    );
}

#[test]
fn runtime_trace_path_without_node_or_edge_is_reported() {
    let report = LinkedProgramRegistry::bootstrap_metrics_report(SOURCE).unwrap();
    let kernel = LinkedProgramRegistry::bootstrap_kernel_report();
    let observed = &report.runtime_trust_graph_coverage.trace;
    let path = observed.observed_paths[0].clone();

    let mut without_node = kernel.clone();
    without_node
        .trust_graph
        .nodes
        .retain(|node| node.id != path);
    let missing = LinkedProgramRegistry::runtime_trust_graph_coverage(observed, &without_node);
    assert_eq!(missing.undocumented_paths, vec![path.clone()]);
    assert!(missing
        .undocumented_path_segments
        .iter()
        .any(|item| item.path == path));

    let mut without_edges = kernel.clone();
    for node in &mut without_edges.trust_graph.nodes {
        if node.id == path {
            node.depends_on.clear();
        }
    }
    let unreachable = LinkedProgramRegistry::runtime_trust_graph_coverage(observed, &without_edges);
    assert!(unreachable.undocumented_paths.is_empty());
    assert!(unreachable
        .undocumented_path_segments
        .iter()
        .any(|item| item.path == path && item.operation != path));

    let mut without_operation = kernel.clone();
    let operation = observed.observed_operations[0].clone();
    without_operation
        .operations
        .retain(|item| *item != operation);
    without_operation
        .derived_host_services
        .retain(|item| *item != operation);
    assert_eq!(
        LinkedProgramRegistry::runtime_trust_graph_coverage(observed, &without_operation)
            .undocumented_operations,
        vec![operation]
    );
}
