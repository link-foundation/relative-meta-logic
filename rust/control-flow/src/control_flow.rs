//! Typed source-free control-flow execution. Host validation and execution are
//! explicit trust boundaries, not theorem or full-language authority.
use crate::lino_frontend::ParsedLink;
use crate::meta_language_support::{attach_rml_structure, rml_structured_document};
use meta_language::LinkNetwork;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const CONTROL_FLOW_SCHEMA: &str = "rml-control-flow/v1";
const MAX: i128 = 9_007_199_254_740_991;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ControlFlowError {
    pub code: &'static str,
    pub message: String,
    pub location: String,
}
impl std::fmt::Display for ControlFlowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {} at {}", self.code, self.message, self.location)
    }
}
impl std::error::Error for ControlFlowError {}
type Result<T> = std::result::Result<T, ControlFlowError>;
fn err(code: &'static str, message: impl Into<String>, location: &str) -> ControlFlowError {
    ControlFlowError {
        code,
        message: message.into(),
        location: location.to_owned(),
    }
}
fn require(test: bool, code: &'static str, message: &str, at: &str) -> Result<()> {
    if test {
        Ok(())
    } else {
        Err(err(code, message, at))
    }
}
fn array<'a>(v: &'a Value, at: &str) -> Result<&'a Vec<Value>> {
    v.as_array()
        .ok_or_else(|| err("SCHEMA", "Expected an array", at))
}
fn text<'a>(v: &'a Value, at: &str) -> Result<&'a str> {
    v.as_str()
        .ok_or_else(|| err("SCHEMA", "Expected an identifier", at))
}
fn fields(value: &Value, expected: &str, at: &str) -> Result<()> {
    let object = value
        .as_object()
        .ok_or_else(|| err("SCHEMA", "Expected a record", at))?;
    require(
        object.keys().map(String::as_str).collect::<BTreeSet<_>>() == expected.split(' ').collect(),
        "SCHEMA",
        "Unexpected or missing fields",
        at,
    )
}
fn name(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        if s.len() > 256 {
            return false;
        }
        let mut c = s.chars();
        c.next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && c.all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c))
    })
}
fn ty(v: &Value) -> Option<&str> {
    v.as_str().filter(|s| ["int", "bool", "unit"].contains(s))
}
fn literal_type(v: &Value) -> Option<&'static str> {
    if v.is_null() {
        Some("unit")
    } else if v.is_boolean() {
        Some("bool")
    } else if v.as_i64().is_some_and(|n| i128::from(n).abs() <= MAX) {
        Some("int")
    } else {
        None
    }
}
fn identity(f: &Value) -> String {
    format!(
        "{}.{}",
        f["module"].as_str().unwrap_or(""),
        f["name"].as_str().unwrap_or("")
    )
}
fn successors(b: &Value) -> Vec<&str> {
    let t = b["terminator"].as_array().unwrap();
    match t[0].as_str() {
        Some("jump") => vec![t[1].as_str().unwrap()],
        Some("branch") => vec![t[2].as_str().unwrap(), t[3].as_str().unwrap()],
        _ => vec![],
    }
}
fn reads(i: &[Value]) -> &[Value] {
    match i[0].as_str() {
        Some("const") => &[],
        Some("emit") => &i[1..],
        Some("call") => &i[3..],
        _ => &i[2..],
    }
}
fn destination(i: &[Value]) -> Option<&str> {
    if i[0] == "emit" {
        None
    } else {
        i[1].as_str()
    }
}

#[derive(Clone, Debug)]
pub struct ControlFlowProgram {
    value: Value,
    effects: BTreeMap<String, BTreeSet<String>>,
}
impl ControlFlowProgram {
    /// Resolve exact project identities, types, definite assignment and transitive effects.
    pub fn new(value: Value) -> Result<Self> {
        let effects = validate(&value)?;
        Ok(Self { value, effects })
    }
    pub fn value(&self) -> &Value {
        &self.value
    }
    pub fn effects(&self) -> &BTreeMap<String, BTreeSet<String>> {
        &self.effects
    }
    pub fn execute(&self, arguments: &[Value], fuel: u64) -> Result<Value> {
        self.execute_entry(self.value["entry"].as_str().unwrap(), arguments, fuel)
    }
    pub fn execute_entry(&self, entry: &str, arguments: &[Value], fuel: u64) -> Result<Value> {
        require(
            fuel <= 1_000_000,
            "LIMIT",
            "Fuel must be between zero and one million",
            entry,
        )?;
        let functions: BTreeMap<_, _> = self.value["functions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| (identity(f), f))
            .collect();
        let function = functions
            .get(entry)
            .copied()
            .ok_or_else(|| err("TYPE", "Entry argument types or arity do not match", entry))?;
        let parameters = function["parameters"].as_array().unwrap();
        require(
            arguments.len() == parameters.len()
                && arguments
                    .iter()
                    .zip(parameters)
                    .all(|(v, p)| literal_type(v) == p[1].as_str()),
            "TYPE",
            "Entry argument types or arity do not match",
            entry,
        )?;
        struct Frame<'a> {
            function: &'a Value,
            environment: BTreeMap<String, Value>,
            block: &'a Value,
            index: usize,
            destination: Option<String>,
        }
        fn frame<'a>(
            function: &'a Value,
            arguments: Vec<Value>,
            destination: Option<String>,
        ) -> Frame<'a> {
            let environment = function["parameters"]
                .as_array()
                .unwrap()
                .iter()
                .zip(arguments)
                .map(|(p, v)| (p[0].as_str().unwrap().to_owned(), v))
                .collect();
            let block = function["blocks"]
                .as_array()
                .unwrap()
                .iter()
                .find(|b| b["id"] == function["entry"])
                .unwrap();
            Frame {
                function,
                environment,
                block,
                index: 0,
                destination,
            }
        }
        let mut stack = vec![frame(function, arguments.to_vec(), None)];
        let mut effects = Vec::new();
        let mut steps = 0_u64;
        macro_rules! outcome { ($status:expr, $value:expr, $diagnostic:expr) => { json!({"status": $status, "value": $value, "effects": effects, "steps": steps, "diagnostic": $diagnostic}) }; }
        loop {
            if steps == fuel {
                return Ok(outcome!("fuel-exhausted", Value::Null, Value::Null));
            }
            steps += 1;
            let current = stack.last_mut().unwrap();
            let instructions = current.block["instructions"].as_array().unwrap();
            if current.index < instructions.len() {
                let instruction = instructions[current.index].as_array().unwrap();
                current.index += 1;
                let op = instruction[0].as_str().unwrap();
                let dest = instruction[1].as_str().unwrap();
                if op == "const" {
                    current
                        .environment
                        .insert(dest.to_owned(), instruction[2].clone());
                    continue;
                }
                if op == "emit" {
                    effects.push(current.environment[dest].clone());
                    continue;
                }
                if op == "call" {
                    let callee = functions[instruction[2].as_str().unwrap()];
                    let args = instruction[3..]
                        .iter()
                        .map(|v| current.environment[v.as_str().unwrap()].clone())
                        .collect();
                    stack.push(frame(callee, args, Some(dest.to_owned())));
                    continue;
                }
                let left = &current.environment[instruction[2].as_str().unwrap()];
                let right = instruction
                    .get(3)
                    .map(|v| &current.environment[v.as_str().unwrap()]);
                let value = match op {
                    "copy" => left.clone(),
                    "not" => json!(!left.as_bool().unwrap()),
                    "eq" => json!(Some(left) == right),
                    "lt" => json!(left.as_i64().unwrap() < right.unwrap().as_i64().unwrap()),
                    "le" => json!(left.as_i64().unwrap() <= right.unwrap().as_i64().unwrap()),
                    "and" => json!(left.as_bool().unwrap() && right.unwrap().as_bool().unwrap()),
                    "or" => json!(left.as_bool().unwrap() || right.unwrap().as_bool().unwrap()),
                    _ => {
                        let a = i128::from(left.as_i64().unwrap());
                        let b = i128::from(right.unwrap().as_i64().unwrap());
                        if (op == "div" || op == "mod") && b == 0 {
                            return Ok(outcome!("domain-error", Value::Null, "DIVISION_BY_ZERO"));
                        }
                        let result = match op {
                            "add" => a + b,
                            "sub" => a - b,
                            "mul" => a * b,
                            "div" => a / b,
                            "mod" => a % b,
                            _ => unreachable!(),
                        };
                        if result.abs() > MAX {
                            return Ok(outcome!("domain-error", Value::Null, "INTEGER_OVERFLOW"));
                        }
                        json!(result as i64)
                    }
                };
                current.environment.insert(dest.to_owned(), value);
            } else {
                let term = current.block["terminator"].as_array().unwrap();
                let op = term[0].as_str().unwrap();
                if op == "return" {
                    let value = current.environment[term[1].as_str().unwrap()].clone();
                    let dest = current.destination.clone();
                    stack.pop();
                    if let Some(parent) = stack.last_mut() {
                        parent.environment.insert(dest.unwrap(), value);
                    } else {
                        return Ok(outcome!("returned", value, Value::Null));
                    }
                } else {
                    let target = if op == "jump" {
                        &term[1]
                    } else if current.environment[term[1].as_str().unwrap()]
                        .as_bool()
                        .unwrap()
                    {
                        &term[2]
                    } else {
                        &term[3]
                    };
                    current.block = current.function["blocks"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|b| &b["id"] == target)
                        .unwrap();
                    current.index = 0;
                }
            }
        }
    }
    pub fn to_rml(&self) -> String {
        program_rml(&self.value)
    }
    pub fn to_network(&self) -> Result<LinkNetwork> {
        let mut network = LinkNetwork::new();
        attach_rml_structure(&mut network, &self.to_rml());
        rml_structured_document(&network).map_err(|e| err("SCHEMA", e.to_string(), "network"))?;
        Ok(network)
    }
    pub fn from_network(network: &LinkNetwork) -> Result<Self> {
        let documents = rml_structured_document(network)
            .map_err(|e| err("SCHEMA", e.to_string(), "network"))?;
        require(
            documents.len() == 1,
            "SCHEMA",
            "Expected one control-flow root",
            "network",
        )?;
        Self::new(program_from_form(&decode_link(&documents[0].1)?)?)
    }
}

fn validate(program: &Value) -> Result<BTreeMap<String, BTreeSet<String>>> {
    fields(program, "schema modules functions entry", "program")?;
    require(
        program["schema"] == CONTROL_FLOW_SCHEMA,
        "SCHEMA",
        "Unsupported control-flow schema",
        "program",
    )?;
    let raw_modules = array(&program["modules"], "program")?;
    let raw_functions = array(&program["functions"], "program")?;
    require(
        !raw_modules.is_empty()
            && raw_modules.len() <= 1000
            && !raw_functions.is_empty()
            && raw_functions.len() <= 1000,
        "LIMIT",
        "Project limit exceeded",
        "program",
    )?;
    let mut modules = BTreeMap::new();
    let mut functions = BTreeMap::new();
    for module in raw_modules {
        fields(module, "id imports exports", "module")?;
        require(
            name(&module["id"]),
            "BINDING",
            "Invalid module identity",
            "module",
        )?;
        let id = module["id"].as_str().unwrap();
        require(
            modules.insert(id, module).is_none(),
            "BINDING",
            "Duplicate module identity",
            id,
        )?;
        let mut aliases = BTreeSet::new();
        for item in array(&module["imports"], id)? {
            let pair = array(item, id)?;
            require(
                pair.len() == 2 && pair.iter().all(name),
                "BINDING",
                "Invalid import binding",
                id,
            )?;
            require(
                aliases.insert(pair[0].as_str().unwrap()),
                "BINDING",
                "Duplicate import binding",
                id,
            )?;
        }
        let exports = array(&module["exports"], id)?;
        require(
            exports.iter().all(name)
                && exports
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect::<BTreeSet<_>>()
                    .len()
                    == exports.len(),
            "BINDING",
            "Invalid or duplicate export",
            id,
        )?;
    }
    for function in raw_functions {
        fields(
            function,
            "module name parameters result effects locals entry blocks",
            "function",
        )?;
        let id = identity(function);
        require(
            name(&function["name"]) && modules.contains_key(text(&function["module"], &id)?),
            "BINDING",
            "Invalid function identity",
            &id,
        )?;
        require(
            functions.insert(id.clone(), function).is_none(),
            "BINDING",
            "Duplicate function identity",
            &id,
        )?;
        require(
            ty(&function["result"]).is_some(),
            "TYPE",
            "Unsupported result type",
            &id,
        )?;
        let effects = array(&function["effects"], &id)?;
        require(
            effects.iter().all(|v| v == "output") && effects.len() <= 1,
            "EFFECT",
            "Unsupported or duplicate effect declaration",
            &id,
        )?;
    }
    require(
        functions.contains_key(text(&program["entry"], "program")?),
        "BINDING",
        "Unresolved project entry",
        "program",
    )?;
    for (id, module) in &modules {
        for exported in module["exports"].as_array().unwrap() {
            require(
                functions.contains_key(&format!("{id}.{}", exported.as_str().unwrap())),
                "BINDING",
                "Unresolved export",
                id,
            )?;
        }
        for item in module["imports"].as_array().unwrap() {
            let target = text(&item[1], id)?;
            let alias = text(&item[0], id)?;
            let callee = functions
                .get(target)
                .copied()
                .ok_or_else(|| err("BINDING", "Unresolved import", id))?;
            require(
                modules[callee["module"].as_str().unwrap()]["exports"]
                    .as_array()
                    .unwrap()
                    .contains(&callee["name"])
                    && !functions.contains_key(&format!("{id}.{alias}")),
                "BINDING",
                "Private or conflicting import",
                id,
            )?;
        }
    }
    let mut actual_effects: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut calls: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut total = 0;
    let mut analysis_work = 0usize;
    for (id, function) in &functions {
        let mut types = BTreeMap::new();
        let mut parameters = BTreeSet::new();
        for (parameter, group) in [(true, "parameters"), (false, "locals")] {
            for value in array(&function[group], id)? {
                let binding = array(value, id)?;
                require(
                    binding.len() == 2 && name(&binding[0]) && ty(&binding[1]).is_some(),
                    "BINDING",
                    "Invalid register binding",
                    id,
                )?;
                let register = binding[0].as_str().unwrap();
                require(
                    types
                        .insert(register, binding[1].as_str().unwrap())
                        .is_none(),
                    "BINDING",
                    "Duplicate register identity",
                    id,
                )?;
                if parameter {
                    parameters.insert(register);
                }
            }
        }
        require(types.len() <= 10000, "LIMIT", "Register limit exceeded", id)?;
        let mut blocks = BTreeMap::new();
        for block in array(&function["blocks"], id)? {
            fields(block, "id instructions terminator", id)?;
            require(name(&block["id"]), "BINDING", "Invalid block identity", id)?;
            require(
                blocks
                    .insert(block["id"].as_str().unwrap(), block)
                    .is_none(),
                "BINDING",
                "Duplicate block identity",
                id,
            )?;
        }
        let entry = text(&function["entry"], id)?;
        require(
            !blocks.is_empty() && blocks.len() <= 10000 && blocks.contains_key(entry),
            "BINDING",
            "Unresolved function entry",
            id,
        )?;
        let expect_type = |value: &Value, expected: Option<&str>, at: &str| -> Result<()> {
            require(
                value.as_str().is_some_and(|r| {
                    types
                        .get(r)
                        .is_some_and(|t| expected.is_none_or(|e| *t == e))
                }),
                "TYPE",
                "Unresolved or wrongly typed register",
                at,
            )
        };
        let mut effect = BTreeSet::new();
        let mut edges = BTreeSet::new();
        for block in blocks.values() {
            let at = format!("{id}/{}", block["id"].as_str().unwrap());
            for instruction in array(&block["instructions"], &at)? {
                total += 1;
                require(total <= 100000, "LIMIT", "Instruction limit exceeded", &at)?;
                let i = array(instruction, &at)?;
                require(i.len() >= 2, "SCHEMA", "Incomplete instruction", &at)?;
                let op = text(&i[0], &at)?;
                if op == "emit" {
                    require(i.len() == 2, "SCHEMA", "Invalid output instruction", &at)?;
                    expect_type(&i[1], None, &at)?;
                    effect.insert("output".to_owned());
                    continue;
                }
                expect_type(&i[1], None, &at)?;
                let dest_type = types[i[1].as_str().unwrap()];
                match op {
                    "const" => require(
                        i.len() == 3 && literal_type(&i[2]) == Some(dest_type),
                        "TYPE",
                        "Invalid constant type",
                        &at,
                    )?,
                    "copy" => {
                        require(i.len() == 3, "SCHEMA", "Invalid copy", &at)?;
                        expect_type(&i[2], Some(dest_type), &at)?;
                    }
                    "add" | "sub" | "mul" | "div" | "mod" | "lt" | "le" | "eq" | "and" | "or" => {
                        require(i.len() == 4, "SCHEMA", "Invalid binary instruction", &at)?;
                        let arithmetic = ["add", "sub", "mul", "div", "mod"].contains(&op);
                        let operand = if ["and", "or"].contains(&op) {
                            Some("bool")
                        } else if op == "eq" {
                            i[2].as_str().and_then(|r| types.get(r).copied())
                        } else {
                            Some("int")
                        };
                        expect_type(&i[2], operand, &at)?;
                        expect_type(&i[3], operand, &at)?;
                        expect_type(&i[1], Some(if arithmetic { "int" } else { "bool" }), &at)?;
                    }
                    "not" => {
                        require(i.len() == 3, "SCHEMA", "Invalid negation", &at)?;
                        expect_type(&i[1], Some("bool"), &at)?;
                        expect_type(&i[2], Some("bool"), &at)?;
                    }
                    "call" => {
                        require(i.len() >= 3, "SCHEMA", "Invalid call", &at)?;
                        let target = text(&i[2], &at)?;
                        let callee = functions
                            .get(target)
                            .copied()
                            .ok_or_else(|| err("BINDING", "Unresolved call", &at))?;
                        let args = array(&callee["parameters"], &at)?;
                        require(
                            i.len() == args.len() + 3,
                            "BINDING",
                            "Wrong call arity",
                            &at,
                        )?;
                        require(
                            callee["module"] == function["module"]
                                || modules[function["module"].as_str().unwrap()]["imports"]
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .any(|v| v[1] == target),
                            "BINDING",
                            "Call crosses module without import",
                            &at,
                        )?;
                        expect_type(&i[1], callee["result"].as_str(), &at)?;
                        for (argument, parameter) in i[3..].iter().zip(args) {
                            let binding = array(parameter, &at)?;
                            require(binding.len() == 2, "BINDING", "Invalid parameter", &at)?;
                            expect_type(argument, binding[1].as_str(), &at)?;
                        }
                        edges.insert(target.to_owned());
                    }
                    _ => return Err(err("UNSUPPORTED", "Unsupported instruction", &at)),
                }
            }
            let term = array(&block["terminator"], &at)?;
            require(!term.is_empty(), "SCHEMA", "Missing terminator", &at)?;
            match term[0].as_str() {
                Some("return") => {
                    require(term.len() == 2, "SCHEMA", "Invalid return", &at)?;
                    expect_type(&term[1], function["result"].as_str(), &at)?;
                }
                Some("jump") => {
                    require(term.len() == 2, "SCHEMA", "Invalid jump", &at)?;
                }
                Some("branch") => {
                    require(term.len() == 4, "SCHEMA", "Invalid branch", &at)?;
                    expect_type(&term[1], Some("bool"), &at)?;
                }
                _ => return Err(err("UNSUPPORTED", "Unsupported terminator", &at)),
            }
            let targets: &[Value] = if term[0] == "jump" {
                &term[1..]
            } else if term[0] == "branch" {
                &term[2..]
            } else {
                &[]
            };
            for target in targets {
                require(
                    target.as_str().is_some_and(|s| blocks.contains_key(s)),
                    "BINDING",
                    "Unresolved branch target",
                    &at,
                )?;
            }
        }
        let mut reachable = BTreeSet::new();
        let mut queue = vec![entry];
        while let Some(next) = queue.pop() {
            if reachable.insert(next) {
                queue.extend(successors(blocks[next]));
            }
        }
        require(
            reachable.len() == blocks.len(),
            "UNREACHABLE",
            "Unreachable blocks must be removed explicitly",
            id,
        )?;
        require(
            blocks.len() * types.len() <= 1_000_000,
            "LIMIT",
            "Definite-assignment state budget exceeded",
            id,
        )?;
        let mut predecessors: BTreeMap<_, Vec<_>> =
            blocks.keys().map(|key| (*key, vec![])).collect();
        for (key, block) in &blocks {
            for target in successors(block) {
                predecessors.get_mut(target).unwrap().push(*key);
            }
        }
        let all: BTreeSet<_> = types.keys().copied().collect();
        let mut incoming: BTreeMap<_, _> = blocks
            .keys()
            .map(|key| {
                (
                    *key,
                    if *key == entry {
                        parameters.clone()
                    } else {
                        all.clone()
                    },
                )
            })
            .collect();
        loop {
            let mut changed = false;
            for key in blocks.keys() {
                analysis_work += 1 + types.len() * (1 + predecessors[key].len());
                require(
                    analysis_work <= 10_000_000,
                    "LIMIT",
                    "Definite-assignment work budget exceeded",
                    id,
                )?;
                let mut next = if *key == entry {
                    parameters.clone()
                } else {
                    all.clone()
                };
                for pred in &predecessors[key] {
                    let mut outgoing = incoming[pred].clone();
                    for instruction in blocks[pred]["instructions"].as_array().unwrap() {
                        if let Some(dest) = destination(instruction.as_array().unwrap()) {
                            outgoing.insert(dest);
                        }
                    }
                    next = next.intersection(&outgoing).copied().collect();
                }
                if next != incoming[key] {
                    incoming.insert(*key, next);
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        for (key, block) in &blocks {
            let mut defined = incoming[key].clone();
            let at = format!("{id}/{key}");
            for instruction in block["instructions"].as_array().unwrap() {
                let i = instruction.as_array().unwrap();
                for r in reads(i) {
                    require(
                        r.as_str().is_some_and(|r| defined.contains(r)),
                        "UNINITIALIZED",
                        "Register is not definitely initialized",
                        &at,
                    )?;
                }
                if let Some(dest) = destination(i) {
                    defined.insert(dest);
                }
            }
            let term = block["terminator"].as_array().unwrap();
            if term[0] == "return" || term[0] == "branch" {
                require(
                    defined.contains(term[1].as_str().unwrap()),
                    "UNINITIALIZED",
                    "Terminator reads an uninitialized register",
                    &at,
                )?;
            }
        }
        actual_effects.insert(id.clone(), effect);
        calls.insert(id.clone(), edges);
    }
    loop {
        let mut changed = false;
        for (id, edges) in &calls {
            let inherited: Vec<_> = edges
                .iter()
                .flat_map(|target| actual_effects[target].iter().cloned())
                .collect();
            for effect in inherited {
                if actual_effects.get_mut(id).unwrap().insert(effect) {
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    for (id, effects) in &actual_effects {
        require(
            effects.iter().all(|effect| {
                functions[id]["effects"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|v| v == effect)
            }),
            "EFFECT",
            "Undeclared transitive output effect",
            id,
        )?;
    }
    Ok(actual_effects)
}

fn form(parts: Vec<String>) -> String {
    format!("({})", parts.join(" "))
}
fn scalar(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        s.to_owned()
    } else if v.is_null() {
        "unit".to_owned()
    } else {
        v.to_string()
    }
}
fn group(tag: &str, parts: impl IntoIterator<Item = String>) -> String {
    form(std::iter::once(tag.to_owned()).chain(parts).collect())
}
fn array_form(v: &Value) -> String {
    form(v.as_array().unwrap().iter().map(scalar).collect())
}
fn program_rml(p: &Value) -> String {
    let modules = p["modules"].as_array().unwrap().iter().map(|m| {
        form(vec![
            "module".into(),
            scalar(&m["id"]),
            group(
                "imports",
                m["imports"].as_array().unwrap().iter().map(array_form),
            ),
            group(
                "exports",
                m["exports"].as_array().unwrap().iter().map(scalar),
            ),
        ])
    });
    let functions = p["functions"].as_array().unwrap().iter().map(|f| {
        let blocks = f["blocks"].as_array().unwrap().iter().map(|b| {
            form(vec![
                "block".into(),
                scalar(&b["id"]),
                group(
                    "instructions",
                    b["instructions"].as_array().unwrap().iter().map(array_form),
                ),
                array_form(&b["terminator"]),
            ])
        });
        form(vec![
            "function".into(),
            scalar(&f["module"]),
            scalar(&f["name"]),
            group(
                "parameters",
                f["parameters"].as_array().unwrap().iter().map(array_form),
            ),
            group("result", [scalar(&f["result"])]),
            group(
                "effects",
                f["effects"].as_array().unwrap().iter().map(scalar),
            ),
            group(
                "locals",
                f["locals"].as_array().unwrap().iter().map(array_form),
            ),
            group("entry", [scalar(&f["entry"])]),
            group("blocks", blocks),
        ])
    });
    form(
        [
            vec![
                "control-flow-v1".into(),
                group("entry", [scalar(&p["entry"])]),
                group("modules", modules),
            ],
            functions.collect(),
        ]
        .concat(),
    )
}
fn decode_link(link: &ParsedLink) -> Result<Value> {
    require(
        !link.compound && (link.id.is_none() || link.values.is_empty()),
        "SCHEMA",
        "Unexpected named or compound link",
        "network",
    )?;
    if let Some(id) = &link.id {
        Ok(json!(id))
    } else {
        Ok(Value::Array(
            link.values.iter().map(decode_link).collect::<Result<_>>()?,
        ))
    }
}
fn tagged<'a>(v: &'a Value, tag: &str, len: Option<usize>) -> Result<&'a [Value]> {
    let a = array(v, "network")?;
    require(
        !a.is_empty() && a[0] == tag && len.is_none_or(|n| a.len() == n),
        "SCHEMA",
        "Malformed tagged form",
        tag,
    )?;
    Ok(&a[1..])
}
fn program_from_form(v: &Value) -> Result<Value> {
    let root = tagged(v, "control-flow-v1", None)?;
    require(
        root.len() >= 2,
        "SCHEMA",
        "Incomplete control-flow root",
        "network",
    )?;
    let entry = &tagged(&root[0], "entry", Some(2))?[0];
    let modules = tagged(&root[1], "modules", None)?.iter().map(|m| { let a = tagged(m, "module", Some(4))?; Ok(json!({"id":a[0], "imports":tagged(&a[1], "imports", None)?, "exports":tagged(&a[2], "exports", None)?})) }).collect::<Result<Vec<_>>>()?;
    let functions = root[2..].iter().map(|f| {
        let a = tagged(f, "function", Some(9))?;
        let blocks = tagged(&a[7], "blocks", None)?.iter().map(|b| {
            let b = tagged(b, "block", Some(4))?;
            let instructions = tagged(&b[1], "instructions", None)?.iter().map(|i| {
                let mut i = array(i, "network")?.clone();
                if i.first().is_some_and(|v| v == "const") {
                    require(i.len() == 3, "SCHEMA", "Malformed constant", "network")?; let s = text(&i[2], "network")?;
                    i[2] = match s { "unit" => Value::Null, "true" => json!(true), "false" => json!(false), _ => {
                        let n: i64 = s.parse().map_err(|_| err("TYPE", "Invalid constant", "network"))?;
                        require(n.to_string() == s, "TYPE", "Noncanonical constant", "network")?; json!(n)
                    } };
                }
                Ok(Value::Array(i))
            }).collect::<Result<Vec<_>>>()?;
            Ok(json!({"id":b[0], "instructions":instructions, "terminator":b[2]}))
        }).collect::<Result<Vec<_>>>()?;
        Ok(json!({"module":a[0], "name":a[1], "parameters":tagged(&a[2], "parameters", None)?, "result":tagged(&a[3], "result", Some(2))?[0], "effects":tagged(&a[4], "effects", None)?, "locals":tagged(&a[5], "locals", None)?, "entry":tagged(&a[6], "entry", Some(2))?[0], "blocks":blocks}))
    }).collect::<Result<Vec<_>>>()?;
    Ok(json!({"schema":CONTROL_FLOW_SCHEMA,"modules":modules,"functions":functions,"entry":entry}))
}
