//! JSON transport for the checked semantic API; not a source-language parser.
use rml_control_flow::ControlFlowProgram;
use serde_json::Value;
use std::io::{self, Read};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin()
        .take(16 * 1024 * 1024 + 1)
        .read_to_string(&mut input)?;
    if input.len() > 16 * 1024 * 1024 {
        return Err("Control-flow input size exceeded".into());
    }
    let request: Value = serde_json::from_str(&input)?;
    let object = request.as_object().ok_or("Expected a request record")?;
    if object.len() != 3
        || !["program", "arguments", "fuel"]
            .iter()
            .all(|key| object.contains_key(*key))
    {
        return Err("Expected exactly program, arguments and fuel".into());
    }
    let program = ControlFlowProgram::new(request["program"].clone())?;
    let arguments = request["arguments"]
        .as_array()
        .ok_or("Expected argument array")?;
    let fuel = request["fuel"]
        .as_u64()
        .ok_or("Expected nonnegative fuel")?;
    println!("{}", program.execute(arguments, fuel)?);
    Ok(())
}
