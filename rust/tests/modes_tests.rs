// Tests for mode declarations (issue #43, D15).
// Mirrors js/tests/modes.test.mjs so any drift between the two
// implementations fails both test suites.

use rml::{evaluate, ModeFlag};

#[test]
fn mode_declaration_records_per_argument_flag_list() {
    // We need access to the same Env across the declaration to inspect the
    // recorded modes; `evaluate` builds an env internally, so we use it for
    // call-site behaviour and assert via a follow-up E031 test below. The
    // simplest direct check: declare modes and confirm the diagnostics list
    // is empty.
    let out = evaluate("(mode plus +input +input -output)", None, None);
    assert_eq!(out.diagnostics.len(), 0);
}

#[test]
fn mode_flag_token_round_trip() {
    assert_eq!(ModeFlag::from_token("+input"), Some(ModeFlag::In));
    assert_eq!(ModeFlag::from_token("-output"), Some(ModeFlag::Out));
    assert_eq!(ModeFlag::from_token("*either"), Some(ModeFlag::Either));
    assert_eq!(ModeFlag::from_token("+other"), None);
}

#[test]
fn mode_declaration_accepts_either_flag() {
    let out = evaluate("(mode lookup +input *either -output)", None, None);
    assert_eq!(out.diagnostics.len(), 0);
}

#[test]
fn mode_declaration_rejects_unknown_flag_with_e030() {
    let out = evaluate("(mode plus +input ~maybe -output)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E030");
    assert!(
        d.message.contains("unknown flag \"~maybe\""),
        "msg was: {}",
        d.message
    );
}

#[test]
fn mode_declaration_with_no_flags_is_e030() {
    let out = evaluate("(mode plus)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E030");
    assert!(
        d.message.contains("at least one mode flag"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn mode_declaration_with_non_symbolic_name_is_e030() {
    let out = evaluate("(mode (foo bar) +input -output)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E030");
    assert!(
        d.message.contains("must be a bare symbol"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn mode_arity_mismatch_at_call_site_is_e031() {
    let out = evaluate(
        "(mode plus +input +input -output)\n(? (plus 1 2))",
        None,
        None,
    );
    let e031: Vec<_> = out.diagnostics.iter().filter(|d| d.code == "E031").collect();
    assert_eq!(e031.len(), 1);
    assert!(
        e031[0].message.contains("expected 3 arguments, got 2"),
        "msg was: {}",
        e031[0].message
    );
}

#[test]
fn mode_input_with_unbound_variable_is_e031() {
    let out = evaluate(
        "(mode plus +input +input -output)\n(? (plus 1 unbound result))",
        None,
        None,
    );
    let e031: Vec<_> = out.diagnostics.iter().filter(|d| d.code == "E031").collect();
    assert_eq!(e031.len(), 1);
    assert!(
        e031[0]
            .message
            .contains("argument 2 (+input) is not ground"),
        "msg was: {}",
        e031[0].message
    );
}

#[test]
fn mode_call_with_only_ground_inputs_is_accepted() {
    let out = evaluate(
        "(Natural: Type Natural)\n\
         (zero: Natural zero)\n\
         (mode plus +input +input -output)\n\
         (? (plus zero zero result))",
        None,
        None,
    );
    let e031: Vec<_> = out.diagnostics.iter().filter(|d| d.code == "E031").collect();
    assert!(
        e031.is_empty(),
        "unexpected E031 diagnostics: {:?}",
        e031.iter().map(|d| &d.message).collect::<Vec<_>>()
    );
}

#[test]
fn mode_input_accepts_numeric_literals_as_ground() {
    let out = evaluate(
        "(mode plus +input +input -output)\n(? (plus 1 2 result))",
        None,
        None,
    );
    let e031: Vec<_> = out.diagnostics.iter().filter(|d| d.code == "E031").collect();
    assert!(e031.is_empty());
}

#[test]
fn mode_either_accepts_anything_including_unbound_names() {
    let out = evaluate(
        "(mode lookup *either *either)\n(? (lookup whatever else))",
        None,
        None,
    );
    let e031: Vec<_> = out.diagnostics.iter().filter(|d| d.code == "E031").collect();
    assert!(e031.is_empty());
}

#[test]
fn mode_does_not_flag_relations_without_a_declaration() {
    let out = evaluate("(? (mystery a b c))", None, None);
    let e031: Vec<_> = out.diagnostics.iter().filter(|d| d.code == "E031").collect();
    assert!(e031.is_empty());
}
