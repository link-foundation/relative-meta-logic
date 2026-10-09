use rml_control_flow::ControlFlowProgram;
use serde_json::{json, Value};
#[test]
fn shared_semantic_programs_execute_and_reload_without_source() {
    let corpus: Value =
        serde_json::from_str(include_str!("../../../test-corpus/control-flow/cases.json")).unwrap();
    for fixture in corpus["cases"].as_array().unwrap() {
        let program = ControlFlowProgram::new(fixture["program"].clone()).unwrap();
        assert_eq!(
            program.to_rml(),
            fixture["rml"].as_str().unwrap(),
            "{}",
            fixture["name"]
        );
        let network = program.to_network().unwrap();
        let reloaded = ControlFlowProgram::from_network(&network).unwrap();
        assert_eq!(program.value(), reloaded.value());
        let outcome = reloaded
            .execute(
                fixture["arguments"].as_array().unwrap(),
                fixture["fuel"].as_u64().unwrap(),
            )
            .unwrap();
        assert_eq!(outcome, fixture["expected"], "{}", fixture["name"]);
    }
}
fn base() -> Value {
    json!({"schema":"rml-control-flow/v1","modules":[{"id":"m","imports":[],"exports":["f"]}],"entry":"m.f","functions":[{"module":"m","name":"f","parameters":[["n","int"]],"result":"int","effects":[],"locals":[["v","int"]],"entry":"entry","blocks":[{"id":"entry","instructions":[["copy","v","n"]],"terminator":["return","v"]}]}]})
}
#[test]
fn malformed_programs_cannot_claim_elaboration() {
    let mutations: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
        (
            "BINDING",
            Box::new(|p| {
                p["functions"][0]["locals"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(["n", "int"]))
            }),
        ),
        (
            "BINDING",
            Box::new(|p| {
                p["functions"][0]["blocks"][0]["instructions"] =
                    json!([["call", "v", "m.missing", "n"]])
            }),
        ),
        (
            "UNINITIALIZED",
            Box::new(|p| p["functions"][0]["blocks"][0]["instructions"] = json!([])),
        ),
        (
            "TYPE",
            Box::new(|p| {
                p["functions"][0]["blocks"][0]["instructions"] = json!([["const", "v", true]])
            }),
        ),
        (
            "BINDING",
            Box::new(|p| p["functions"][0]["blocks"][0]["terminator"] = json!(["jump", "missing"])),
        ),
        (
            "EFFECT",
            Box::new(|p| {
                p["functions"][0]["blocks"][0]["instructions"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(["emit", "v"]))
            }),
        ),
        (
            "UNSUPPORTED",
            Box::new(|p| {
                p["functions"][0]["blocks"][0]["instructions"] = json!([["delete", "v", "n"]])
            }),
        ),
        ("SCHEMA", Box::new(|p| p["proof"] = json!("trusted"))),
        (
            "BINDING",
            Box::new(|p| p["modules"][0]["exports"] = json!(["missing"])),
        ),
        (
            "TYPE",
            Box::new(|p| p["functions"][0]["result"] = json!("proof")),
        ),
        (
            "TYPE",
            Box::new(|p| {
                p["functions"][0]["blocks"][0]["instructions"] =
                    json!([["const", "v", 9007199254740992_i64]])
            }),
        ),
    ];
    for (code, mutation) in mutations {
        let mut p = base();
        mutation(&mut p);
        assert_eq!(ControlFlowProgram::new(p).unwrap_err().code, code);
    }
}
#[test]
fn arithmetic_failures_are_not_proofs_or_exhaustion() {
    let mut p = base();
    p["functions"][0]["locals"]
        .as_array_mut()
        .unwrap()
        .push(json!(["z", "int"]));
    p["functions"][0]["blocks"][0]["instructions"] =
        json!([["const", "z", 0], ["div", "v", "n", "z"]]);
    let program = ControlFlowProgram::new(p.clone()).unwrap();
    assert_eq!(
        program.execute(&[json!(5)], 10).unwrap()["diagnostic"],
        "DIVISION_BY_ZERO"
    );
    assert_eq!(
        program.execute(&[json!(5)], 0).unwrap()["status"],
        "fuel-exhausted"
    );
    assert_eq!(
        program.execute(&[json!(true)], 10).unwrap_err().code,
        "TYPE"
    );
    p["functions"][0]["blocks"][0]["instructions"][0][2] = json!(2);
    let program = ControlFlowProgram::new(p.clone()).unwrap();
    assert_eq!(program.execute(&[json!(-7)], 10).unwrap()["value"], -3);
    p["functions"][0]["blocks"][0]["instructions"][1][0] = json!("mod");
    let program = ControlFlowProgram::new(p).unwrap();
    assert_eq!(program.execute(&[json!(-7)], 10).unwrap()["value"], -1);
}
#[test]
fn shared_negative_semantic_corpus_rejects_exact_obligations() {
    let corpus: Value =
        serde_json::from_str(include_str!("../../../test-corpus/control-flow/cases.json")).unwrap();
    for fixture in corpus["negativeCases"].as_array().unwrap() {
        assert_eq!(
            ControlFlowProgram::new(fixture["program"].clone())
                .unwrap_err()
                .code,
            fixture["code"].as_str().unwrap(),
            "{}",
            fixture["name"]
        );
    }
}
#[test]
fn lowered_rust_syntax_uses_the_same_native_machine() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../test-corpus/control-flow/rust-syntax.json"
    ))
    .unwrap();
    for fixture in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f.get("program").is_some())
    {
        let program = ControlFlowProgram::new(fixture["program"].clone()).unwrap();
        assert_eq!(
            program
                .execute(fixture["arguments"].as_array().unwrap(), 10000)
                .unwrap(),
            fixture["expected"],
            "{}",
            fixture["name"]
        );
    }
}
#[test]
fn replacing_a_linked_instruction_changes_native_execution() {
    use meta_language::{LinkMetadata, LinkType, SubstitutionRule};
    let mut p = base();
    p["functions"][0]["blocks"][0]["instructions"] = json!([["const", "v", 17]]);
    let mut network = ControlFlowProgram::new(p).unwrap().to_network().unwrap();
    let old = network
        .links()
        .find(|link| {
            link.metadata().definition() == Some("rml:structure:1:reference")
                && link.metadata().term() == Some("17")
        })
        .unwrap()
        .id();
    let references = network
        .links()
        .find(|link| link.references().contains(&old))
        .unwrap()
        .references()
        .to_vec();
    let replacement = network.insert_link(
        [],
        LinkMetadata::new()
            .with_link_type(LinkType::Syntax)
            .with_language("RML")
            .with_definition("rml:structure:1:reference")
            .with_term("23"),
    );
    let changed: Vec<_> = references
        .iter()
        .map(|id| if *id == old { replacement } else { *id })
        .collect();
    network.apply_substitution(&SubstitutionRule::new(
        [references[0], references[1], references[2]],
        [changed[0], changed[1], changed[2]],
    ));
    assert_eq!(
        ControlFlowProgram::from_network(&network)
            .unwrap()
            .execute(&[json!(0)], 100)
            .unwrap()["value"],
        23
    );
}
#[test]
fn companion_cli_runs_without_main_crate_exports() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new(env!("CARGO_BIN_EXE_rml-control-flow"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let request = json!({"program":base(),"arguments":[41],"fuel":100});
    child
        .stdin
        .take()
        .unwrap()
        .write_all(request.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["status"], "returned");
    assert_eq!(result["value"], 41);
}
#[test]
fn every_scalar_operation_matches_shared_expected_values() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../test-corpus/control-flow/operations.json"
    ))
    .unwrap();
    for fixture in corpus["cases"].as_array().unwrap() {
        let program = ControlFlowProgram::new(fixture["program"].clone()).unwrap();
        assert_eq!(
            program
                .execute(
                    fixture["arguments"].as_array().unwrap(),
                    fixture["fuel"].as_u64().unwrap()
                )
                .unwrap(),
            fixture["expected"],
            "{}",
            fixture["name"]
        );
    }
}
