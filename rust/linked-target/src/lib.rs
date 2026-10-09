//! Actual RML execution through the generated portable memory ABI.
pub mod abi;
use rml::linked_program::LinkedProgramRegistry;
use rml::linked_proof::{linked_proof_trace, replay_linked_proof, LinkedProofOptions, LinkedProofReceipt};
use rml::Node;
use serde_json::{json, Value};

pub fn node(value: &Value) -> Result<Node, String> {
    match value {
        Value::String(v) => Ok(Node::Leaf(v.clone())),
        Value::Array(v) => Ok(Node::List(v.iter().map(node).collect::<Result<_, _>>()?)),
        _ => Err("target requires terms".into()),
    }
}
pub fn value(node: &Node) -> Value {
    match node {
        Node::Leaf(v) => Value::String(v.clone()),
        Node::List(v) => Value::Array(v.iter().map(value).collect()),
    }
}
fn program() -> Result<String, String> {
    abi::execute_program("program", &[])?.as_str().map(str::to_owned).ok_or_else(|| "target program must be text".into())
}
pub fn verify_target_frame(registry: &LinkedProgramRegistry, frame: &[u8], max_steps: usize) -> Result<Vec<u8>, String> {
    let data = abi::decode_frame(frame)?;
    let args = data.as_array().filter(|v| v.len() == 3).ok_or("target proof expects context, goal, candidate")?;
    let request = abi::execute_program("request", args)?;
    let program = program()?;
    let result = registry.reduce(&program, &node(&request)?, max_steps)?;
    let receipt = abi::execute_program("receipt", &[Value::String(program), request, value(&result.term), value(&linked_proof_trace(&result.trace)), Value::String(result.trace.len().to_string())])?;
    abi::encode_frame(&receipt)
}
pub fn receipt_from_target_frame(frame: &[u8]) -> Result<LinkedProofReceipt, String> {
    let data = abi::decode_frame(frame)?;
    let fields = data.as_array().filter(|v| v.len() == 7).ok_or("invalid target receipt")?;
    let string = |i: usize| fields[i].as_str().ok_or("invalid target receipt text");
    let steps = string(6)?.parse::<u32>().map_err(|_| "invalid target receipt steps")?;
    if steps.to_string() != string(6)? { return Err("invalid target receipt steps".into()); }
    let accepted = match string(2)? { "true" => true, "false" => false, _ => return Err("invalid target receipt verdict".into()) };
    Ok(LinkedProofReceipt { schema: string(0)?.into(), program: string(1)?.into(), accepted, request: node(&fields[3])?, result: node(&fields[4])?, trace: node(&fields[5])?, steps: steps as usize })
}
pub fn replay_target_frame(registry: &LinkedProgramRegistry, context: &[u8], goal: &[u8], receipt: &[u8], max_steps: usize) -> Result<Vec<u8>, String> {
    let options = LinkedProofOptions { program: program()?, max_steps, ..LinkedProofOptions::default() };
    let replay = replay_linked_proof(registry, &node(&abi::decode_frame(context)?)?, &node(&abi::decode_frame(goal)?)?, &receipt_from_target_frame(receipt)?, &options)?;
    abi::encode_frame(&json!([replay.accepted.to_string(), replay.matches.to_string(), value(&replay.result), value(&replay.trace), replay.steps.to_string()]))
}
pub fn parse_target_frame(frame: &[u8]) -> Result<Vec<u8>, String> {
    let data = abi::decode_frame(frame)?;
    let source = data.as_str().ok_or("target parser expects text")?;
    let forms = rml::parse_lino_document(source).map_err(|e| e.to_string())?;
    abi::encode_frame(&Value::Array(forms.iter().map(|f| json!([f.text, f.line.to_string(), f.col.to_string(), f.length.to_string()])).collect()))
}
