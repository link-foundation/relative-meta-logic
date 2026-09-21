//! Complete linked source content from independently contracted formal sources.

use crate::meta_language_support::{
    parse_rml_to_meta_language, reconstruct_rml_from_meta_language,
};
use crate::{parse_lino, parse_one, tokenize_one, Node};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};

const SCHEMA: &str = "linked-source-v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormalToken {
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormalModule {
    pub corpus: String,
    pub language: String,
    pub name: String,
    pub tokens: Vec<FormalToken>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormalDeclaration {
    pub corpus: String,
    pub address: String,
    pub language: String,
    pub module: String,
    pub kind: String,
    pub symbol: String,
    pub proof_status: String,
    pub recursive: bool,
    pub syntax_range: [usize; 2],
    pub signature_range: [usize; 2],
    pub body_range: [usize; 2],
    pub proof_range: [usize; 2],
    pub syntax: Vec<FormalToken>,
    pub signature: Vec<FormalToken>,
    pub body: Vec<FormalToken>,
    pub proof: Vec<FormalToken>,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormalCorpus {
    meta_language_round_trip_ok: bool,
    trusted_foundation_round_trip_ok: bool,
    name: String,
    upstream: String,
    revision: String,
    schema: String,
    formal_modules: Vec<FormalModule>,
    declarations: Vec<FormalDeclaration>,
    semantic_token_count: usize,
    dependency_count: usize,
    fingerprint: String,
}

#[derive(Debug)]
struct Contract {
    name: String,
    upstream: String,
    revision: String,
    schema: String,
    module_count: usize,
    declaration_count: usize,
    token_count: usize,
    dependency_count: usize,
    fingerprint: String,
}

fn leaf<'a>(node: &'a Node, context: &str) -> Result<&'a str, String> {
    match node {
        Node::Leaf(value) if !value.is_empty() => Ok(value),
        _ => Err(format!("{context} must be a non-empty reference")),
    }
}

fn list<'a>(node: &'a Node, context: &str) -> Result<&'a [Node], String> {
    match node {
        Node::List(children) => Ok(children),
        _ => Err(format!("{context} must be a link")),
    }
}

fn natural(node: &Node, context: &str) -> Result<usize, String> {
    let value = leaf(node, context)?;
    if value != "0" && (value.starts_with('0') || !value.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(format!("{context} must be a natural number"));
    }
    value
        .parse::<usize>()
        .map_err(|_| format!("{context} must be a natural number"))
}

fn parse_forms(source: &str, context: &str) -> Result<(String, Vec<Node>), String> {
    let encoded = parse_rml_to_meta_language(source);
    let reconstructed = reconstruct_rml_from_meta_language(&encoded);
    let forms = parse_lino(&reconstructed)
        .into_iter()
        .map(|link| {
            parse_one(&tokenize_one(&link))
                .map_err(|error| format!("invalid {context} link {link}: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((reconstructed, forms))
}

fn clauses(
    form: &[Node],
    context: &str,
    expected: &[&str],
) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for node in &form[2..] {
        let clause = list(node, context)?;
        if clause.len() != 2 {
            return Err(format!("{context} clauses must have the form (name value)"));
        }
        let name = leaf(&clause[0], &format!("{context} clause name"))?;
        if !expected.contains(&name) {
            return Err(format!("{context} has unsupported clause {name}"));
        }
        let value = leaf(&clause[1], &format!("{context} {name}"))?.to_string();
        if result.insert(name.to_string(), value).is_some() {
            return Err(format!("{context} repeats clause {name}"));
        }
    }
    for name in expected {
        if !result.contains_key(*name) {
            return Err(format!("{context} is missing {name}"));
        }
    }
    Ok(result)
}

fn parse_count(
    data: &BTreeMap<String, String>,
    name: &str,
    context: &str,
) -> Result<usize, String> {
    let node = Node::Leaf(data[name].clone());
    natural(&node, &format!("{context} {name}"))
}

fn parse_contract(forms: Vec<Node>) -> Result<Contract, String> {
    let mut contract = None;
    for form in forms {
        let children = list(&form, "trusted formal corpus form")?;
        let head = children
            .first()
            .ok_or_else(|| "trusted formal corpus form is empty".to_string())?;
        if leaf(head, "trusted formal corpus form")? != "formal-corpus-contract" {
            return Err(format!(
                "trusted formal corpus foundation has unsupported form {}",
                leaf(head, "trusted formal corpus form")?
            ));
        }
        if contract.is_some() {
            return Err("trusted formal corpus foundation repeats its contract".to_string());
        }
        if children.len() < 3 {
            return Err("formal-corpus-contract must have a name and clauses".to_string());
        }
        let name = leaf(&children[1], "formal-corpus-contract name")?.to_string();
        let context = format!("formal-corpus-contract {name}");
        let data = clauses(
            children,
            &context,
            &[
                "upstream",
                "revision",
                "schema",
                "module-count",
                "declaration-count",
                "semantic-token-count",
                "dependency-count",
                "sha256",
            ],
        )?;
        let fingerprint = data["sha256"].clone();
        if fingerprint.len() != 64
            || !fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(format!(
                "formal-corpus-contract {name} sha256 must be 64 lowercase hex digits"
            ));
        }
        contract = Some(Contract {
            name,
            upstream: data["upstream"].clone(),
            revision: data["revision"].clone(),
            schema: data["schema"].clone(),
            module_count: parse_count(&data, "module-count", &context)?,
            declaration_count: parse_count(&data, "declaration-count", &context)?,
            token_count: parse_count(&data, "semantic-token-count", &context)?,
            dependency_count: parse_count(&data, "dependency-count", &context)?,
            fingerprint,
        });
    }
    let contract = contract
        .ok_or_else(|| "trusted formal corpus foundation is missing its contract".to_string())?;
    if contract.schema != SCHEMA {
        return Err(format!(
            "trusted formal corpus foundation uses unsupported schema {}",
            contract.schema
        ));
    }
    Ok(contract)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn token_hex(text: &str) -> String {
    bytes_to_hex(text.as_bytes())
}

fn decode_token(node: &Node, context: &str) -> Result<FormalToken, String> {
    let form = list(node, context)?;
    if form.len() != 3 || leaf(&form[0], context)? != "token" {
        return Err(format!(
            "{context} entries must have the form (token kind utf8-hex)"
        ));
    }
    let kind = leaf(&form[1], &format!("{context} token kind"))?;
    if !matches!(
        kind,
        "identifier" | "keyword" | "numeral" | "string" | "symbol"
    ) {
        return Err(format!("{context} has unsupported token kind {kind}"));
    }
    let hex = leaf(&form[2], &format!("{context} token utf8-hex"))?;
    if hex.is_empty()
        || hex.len() % 2 != 0
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(format!(
            "{context} token utf8-hex must contain lowercase byte pairs"
        ));
    }
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| format!("{context} token utf8-hex must contain lowercase byte pairs"))?;
    let text = String::from_utf8(bytes)
        .map_err(|_| format!("{context} token utf8-hex is not valid UTF-8"))?;
    if token_hex(&text) != hex {
        return Err(format!("{context} token utf8-hex is not canonical UTF-8"));
    }
    Ok(FormalToken {
        kind: kind.to_string(),
        text,
    })
}

fn parse_range(node: &Node, name: &str, context: &str) -> Result<[usize; 2], String> {
    let form = list(node, &format!("{context} {name}"))?;
    if form.len() != 3 || leaf(&form[0], &format!("{context} {name}"))? != name {
        return Err(format!(
            "{context} {name} must have the form ({name} start end)"
        ));
    }
    let start = natural(&form[1], &format!("{context} {name} start"))?;
    let end = natural(&form[2], &format!("{context} {name} end"))?;
    if start > end {
        return Err(format!("{context} {name} start must not exceed end"));
    }
    Ok([start, end])
}

fn range_within(inner: [usize; 2], outer: [usize; 2]) -> bool {
    inner[0] >= outer[0] && inner[1] <= outer[1]
}

fn range_slice(tokens: &[FormalToken], range: [usize; 2]) -> Vec<FormalToken> {
    tokens[range[0]..range[1]].to_vec()
}

fn canonical_module(module: &FormalModule) -> String {
    let tokens = module
        .tokens
        .iter()
        .map(|token| format!("{}:{}", token.kind, token_hex(&token.text)))
        .collect::<Vec<_>>()
        .join(",");
    format!("module|{}|{}|{tokens}", module.language, module.name)
}

fn canonical_declaration(declaration: &FormalDeclaration) -> String {
    let range = |value: [usize; 2]| format!("{}:{}", value[0], value[1]);
    format!(
        "declaration|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        declaration.language,
        declaration.module,
        declaration.kind,
        declaration.symbol,
        declaration.proof_status,
        if declaration.recursive {
            "recursive"
        } else {
            "non-recursive"
        },
        range(declaration.syntax_range),
        range(declaration.signature_range),
        range(declaration.body_range),
        range(declaration.proof_range),
        declaration.dependencies.join(",")
    )
}

fn semantic_lines(modules: &[FormalModule], declarations: &[FormalDeclaration]) -> Vec<String> {
    let mut lines = modules.iter().map(canonical_module).collect::<Vec<_>>();
    lines.extend(declarations.iter().map(canonical_declaration));
    lines.sort();
    lines
}

fn sha256(lines: &[String]) -> String {
    let mut hash = Sha256::new();
    hash.update(format!("{}\n", lines.join("\n")).as_bytes());
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn parse_declaration(
    node: &Node,
    module: &FormalModule,
    owner: &str,
    seen: &mut HashSet<String>,
) -> Result<FormalDeclaration, String> {
    let form = list(
        node,
        &format!(
            "formal-module {}.{} declaration",
            module.language, module.name
        ),
    )?;
    if form.len() < 8 || leaf(&form[0], "formal declaration")? != "declaration" {
        return Err(format!(
            "formal-module {}.{} has invalid declaration",
            module.language, module.name
        ));
    }
    let kind = leaf(&form[1], "formal declaration kind")?.to_string();
    let symbol = leaf(&form[2], "formal declaration symbol")?.to_string();
    if !matches!(
        kind.as_str(),
        "abbreviation"
            | "definition"
            | "recursive-definition"
            | "inductive"
            | "structure"
            | "theorem"
    ) {
        return Err(format!(
            "formal declaration {}.{}.{} has unsupported kind {kind}",
            module.language, module.name, symbol
        ));
    }
    let context = format!(
        "formal declaration {}.{}.{}",
        module.language, module.name, symbol
    );
    let mut singular: BTreeMap<String, &Node> = BTreeMap::new();
    let mut dependencies = Vec::new();
    let clause_names = [
        "syntax-range",
        "signature-range",
        "body-range",
        "proof-range",
        "proof-status",
        "recursion",
    ];
    for node in &form[3..] {
        let clause = list(node, &context)?;
        let name = clause
            .first()
            .ok_or_else(|| format!("{context} has an empty clause"))
            .and_then(|head| leaf(head, &context))?;
        if name == "dependency" {
            if clause.len() != 2 {
                return Err(format!("{context} dependency must contain one address"));
            }
            dependencies.push(leaf(&clause[1], &format!("{context} dependency"))?.to_string());
            continue;
        }
        if !clause_names.contains(&name) {
            return Err(format!("{context} has unsupported clause {name}"));
        }
        if singular.insert(name.to_string(), node).is_some() {
            return Err(format!("{context} repeats clause {name}"));
        }
    }
    for name in clause_names {
        if !singular.contains_key(name) {
            return Err(format!("{context} is missing {name}"));
        }
    }
    let syntax_range = parse_range(singular["syntax-range"], "syntax-range", &context)?;
    let signature_range = parse_range(singular["signature-range"], "signature-range", &context)?;
    let body_range = parse_range(singular["body-range"], "body-range", &context)?;
    let proof_range = parse_range(singular["proof-range"], "proof-range", &context)?;
    if syntax_range[1] > module.tokens.len() {
        return Err(format!("{context} syntax-range exceeds its module"));
    }
    for (name, range) in [
        ("signature-range", signature_range),
        ("body-range", body_range),
        ("proof-range", proof_range),
    ] {
        if !range_within(range, syntax_range) {
            return Err(format!("{context} {name} is outside syntax-range"));
        }
    }
    let status_form = list(singular["proof-status"], &context)?;
    let recursion_form = list(singular["recursion"], &context)?;
    if status_form.len() != 2 {
        return Err(format!("{context} proof-status must contain one value"));
    }
    if recursion_form.len() != 2 {
        return Err(format!("{context} recursion must contain one value"));
    }
    let proof_status = leaf(&status_form[1], &format!("{context} proof-status"))?.to_string();
    let recursion = leaf(&recursion_form[1], &format!("{context} recursion"))?;
    if !matches!(
        proof_status.as_str(),
        "verified" | "admitted" | "not-applicable"
    ) {
        return Err(format!(
            "{context} has unsupported proof status {proof_status}"
        ));
    }
    if !matches!(recursion, "recursive" | "non-recursive") {
        return Err(format!(
            "{context} has unsupported recursion value {recursion}"
        ));
    }
    dependencies.sort();
    if dependencies.windows(2).any(|window| window[0] == window[1]) {
        return Err(format!("{context} repeats a dependency"));
    }
    let address = format!("rml.formal.{}.{}.{}", module.language, module.name, symbol);
    if !seen.insert(address.clone()) {
        return Err(format!(
            "duplicate formal declaration {}.{}.{}",
            module.language, module.name, symbol
        ));
    }
    let declaration = FormalDeclaration {
        corpus: owner.to_string(),
        address,
        language: module.language.clone(),
        module: module.name.clone(),
        kind,
        symbol,
        proof_status,
        recursive: recursion == "recursive",
        syntax_range,
        signature_range,
        body_range,
        proof_range,
        syntax: range_slice(&module.tokens, syntax_range),
        signature: range_slice(&module.tokens, signature_range),
        body: range_slice(&module.tokens, body_range),
        proof: range_slice(&module.tokens, proof_range),
        dependencies,
    };
    if declaration.syntax.len() < 2 || declaration.syntax[1].text != declaration.symbol {
        return Err(format!(
            "{context} syntax-range does not name {}",
            declaration.symbol
        ));
    }
    if declaration.kind == "theorem" {
        if declaration.proof_status == "not-applicable" {
            return Err(format!("{context} theorem proof status is required"));
        }
        if declaration.signature.is_empty() {
            return Err(format!("{context} theorem judgement is empty"));
        }
        if declaration.proof.is_empty() {
            return Err(format!("{context} theorem proof object is empty"));
        }
        let admitted = declaration
            .proof
            .iter()
            .any(|token| matches!(token.text.as_str(), "sorry" | "Admitted"));
        if (declaration.proof_status == "admitted") != admitted {
            return Err(format!(
                "{context} proof status disagrees with its proof object"
            ));
        }
    } else {
        if declaration.proof_status != "not-applicable" {
            return Err(format!("{context} non-theorem has a proof status"));
        }
        if declaration.body.is_empty() {
            return Err(format!("{context} definition body is empty"));
        }
        if !declaration.proof.is_empty() {
            return Err(format!("{context} non-theorem has a proof object"));
        }
    }
    Ok(declaration)
}

impl FormalCorpus {
    pub fn from_rml(source: &str, trusted_foundation: &str) -> Result<Self, String> {
        let (reconstructed, candidate_forms) = parse_forms(source, "formal corpus")?;
        let (trusted_reconstructed, trusted_forms) =
            parse_forms(trusted_foundation, "trusted formal corpus foundation")?;
        let contract = parse_contract(trusted_forms)?;

        let mut header: Option<(String, String, String, String)> = None;
        let mut module_nodes = Vec::new();
        for form in candidate_forms {
            let children = list(&form, "formal corpus form")?;
            let Some(head_node) = children.first() else {
                continue;
            };
            match leaf(head_node, "formal corpus form")? {
                "formal-corpus-contract" => return Err(
                    "candidate formal corpus cannot declare trusted formal-corpus-contract forms"
                        .to_string(),
                ),
                "formal-corpus" => {
                    if header.is_some() {
                        return Err("candidate formal corpus repeats its header".to_string());
                    }
                    if children.len() < 3 {
                        return Err("formal-corpus must have a name and clauses".to_string());
                    }
                    let name = leaf(&children[1], "formal-corpus name")?.to_string();
                    let data = clauses(
                        children,
                        &format!("formal-corpus {name}"),
                        &["upstream", "revision", "schema"],
                    )?;
                    header = Some((
                        name,
                        data["upstream"].clone(),
                        data["revision"].clone(),
                        data["schema"].clone(),
                    ));
                }
                "formal-module" => module_nodes.push(form),
                head => {
                    return Err(format!(
                        "candidate formal corpus has unsupported form {head}"
                    ))
                }
            }
        }
        let (name, upstream, revision, schema) =
            header.ok_or_else(|| "candidate formal corpus is missing its header".to_string())?;
        if name != contract.name
            || upstream != contract.upstream
            || revision != contract.revision
            || schema != contract.schema
        {
            return Err(
                "candidate formal corpus metadata does not match trusted contract".to_string(),
            );
        }

        let mut formal_modules = Vec::new();
        let mut declarations = Vec::new();
        let mut seen_modules = HashSet::new();
        let mut seen_declarations = HashSet::new();
        for module_node in module_nodes {
            let children = list(&module_node, "formal-module")?;
            if children.len() < 6 {
                return Err("formal-module must contain syntax and declarations".to_string());
            }
            let owner = leaf(&children[1], "formal-module corpus")?.to_string();
            let language = leaf(&children[2], "formal-module language")?.to_string();
            let module_name = leaf(&children[3], "formal-module name")?.to_string();
            if !matches!(language.as_str(), "lean" | "rocq") {
                return Err(format!(
                    "formal-module {module_name} has unsupported language {language}"
                ));
            }
            if owner != name {
                return Err(format!(
                    "formal module {language}.{module_name} belongs to {owner}, not {name}"
                ));
            }
            if !seen_modules.insert((language.clone(), module_name.clone())) {
                return Err(format!("duplicate formal module {language}.{module_name}"));
            }
            let mut tokens = None;
            let mut declaration_nodes = Vec::new();
            for node in &children[4..] {
                let child = list(node, &format!("formal-module {language}.{module_name}"))?;
                let child_head = child
                    .first()
                    .ok_or_else(|| {
                        format!("formal-module {language}.{module_name} has empty content")
                    })
                    .and_then(|head| leaf(head, "formal-module content"))?;
                match child_head {
                    "syntax" => {
                        if tokens.is_some() {
                            return Err(format!(
                                "formal-module {language}.{module_name} repeats syntax"
                            ));
                        }
                        tokens = Some(
                            child[1..]
                                .iter()
                                .enumerate()
                                .map(|(index, token)| {
                                    decode_token(
                                        token,
                                        &format!(
                                            "formal-module {language}.{module_name} syntax {index}"
                                        ),
                                    )
                                })
                                .collect::<Result<Vec<_>, _>>()?,
                        );
                    }
                    "declaration" => declaration_nodes.push(node),
                    other => {
                        return Err(format!(
                            "formal-module {language}.{module_name} has unsupported content {other}"
                        ))
                    }
                }
            }
            let tokens = tokens.ok_or_else(|| {
                format!("formal-module {language}.{module_name} has empty syntax")
            })?;
            if tokens.is_empty() {
                return Err(format!(
                    "formal-module {language}.{module_name} has empty syntax"
                ));
            }
            if declaration_nodes.is_empty() {
                return Err(format!(
                    "formal-module {language}.{module_name} has no declarations"
                ));
            }
            let module = FormalModule {
                corpus: owner,
                language,
                name: module_name,
                tokens,
            };
            for node in declaration_nodes {
                declarations.push(parse_declaration(
                    node,
                    &module,
                    &name,
                    &mut seen_declarations,
                )?);
            }
            formal_modules.push(module);
        }
        formal_modules.sort_by(|left, right| {
            (&left.language, &left.name).cmp(&(&right.language, &right.name))
        });
        declarations.sort_by_key(canonical_declaration);

        for declaration in &declarations {
            for dependency in &declaration.dependencies {
                if !seen_declarations.contains(dependency) {
                    return Err(format!(
                        "formal declaration {} has unknown dependency {dependency}",
                        declaration.address
                    ));
                }
            }
            let self_recursive = declaration.dependencies.contains(&declaration.address);
            if declaration.recursive != self_recursive {
                return Err(format!(
                    "formal declaration {} recursion disagrees with its dependencies",
                    declaration.address
                ));
            }
        }
        let semantic_token_count = formal_modules
            .iter()
            .map(|module| module.tokens.len())
            .sum::<usize>();
        let dependency_count = declarations
            .iter()
            .map(|declaration| declaration.dependencies.len())
            .sum::<usize>();
        for (label, actual, expected) in [
            ("module count", formal_modules.len(), contract.module_count),
            (
                "declaration count",
                declarations.len(),
                contract.declaration_count,
            ),
            (
                "semantic token count",
                semantic_token_count,
                contract.token_count,
            ),
            (
                "dependency count",
                dependency_count,
                contract.dependency_count,
            ),
        ] {
            if actual != expected {
                return Err(format!(
                    "formal corpus {label} {actual} does not match trusted {label} {expected}"
                ));
            }
        }
        let fingerprint = sha256(&semantic_lines(&formal_modules, &declarations));
        if fingerprint != contract.fingerprint {
            return Err(format!(
                "formal corpus fingerprint {fingerprint} does not match trusted fingerprint {}",
                contract.fingerprint
            ));
        }
        Ok(Self {
            meta_language_round_trip_ok: reconstructed == source,
            trusted_foundation_round_trip_ok: trusted_reconstructed == trusted_foundation,
            name,
            upstream,
            revision,
            schema,
            formal_modules,
            declarations,
            semantic_token_count,
            dependency_count,
            fingerprint,
        })
    }

    pub fn meta_language_round_trip_ok(&self) -> bool {
        self.meta_language_round_trip_ok
    }

    pub fn trusted_foundation_round_trip_ok(&self) -> bool {
        self.trusted_foundation_round_trip_ok
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn upstream(&self) -> &str {
        &self.upstream
    }

    pub fn revision(&self) -> &str {
        &self.revision
    }

    pub fn schema(&self) -> &str {
        &self.schema
    }

    pub fn formal_modules(&self) -> &[FormalModule] {
        &self.formal_modules
    }

    pub fn declarations(&self) -> &[FormalDeclaration] {
        &self.declarations
    }

    pub fn semantic_token_count(&self) -> usize {
        self.semantic_token_count
    }

    pub fn dependency_count(&self) -> usize {
        self.dependency_count
    }

    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    pub fn languages(&self) -> Vec<&str> {
        self.formal_modules
            .iter()
            .map(|module| module.language.as_str())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    pub fn modules(&self, language: &str) -> Vec<&str> {
        self.formal_modules
            .iter()
            .filter(|module| module.language == language)
            .map(|module| module.name.as_str())
            .collect::<Vec<_>>()
    }

    pub fn module(&self, language: &str, name: &str) -> Option<&FormalModule> {
        self.formal_modules
            .iter()
            .find(|module| module.language == language && module.name == name)
    }

    pub fn declaration(
        &self,
        language: &str,
        module: &str,
        symbol: &str,
    ) -> Option<&FormalDeclaration> {
        self.declarations.iter().find(|entry| {
            entry.language == language && entry.module == module && entry.symbol == symbol
        })
    }

    pub fn declaration_at(&self, address: &str) -> Option<&FormalDeclaration> {
        self.declarations
            .iter()
            .find(|declaration| declaration.address == address)
    }

    pub fn dependency_closure(&self, address: &str) -> Result<Vec<&str>, String> {
        fn visit<'a>(
            corpus: &'a FormalCorpus,
            root: &str,
            current: &str,
            visited: &mut BTreeSet<&'a str>,
        ) -> Result<(), String> {
            let declaration = corpus
                .declaration_at(current)
                .ok_or_else(|| format!("unknown formal declaration {current}"))?;
            for dependency in &declaration.dependencies {
                if dependency == root || visited.contains(dependency.as_str()) {
                    continue;
                }
                visited.insert(dependency);
                visit(corpus, root, dependency, visited)?;
            }
            Ok(())
        }
        let mut visited = BTreeSet::new();
        visit(self, address, address, &mut visited)?;
        Ok(visited.into_iter().collect())
    }

    pub fn counterpart(&self, declaration: &FormalDeclaration) -> Option<&FormalDeclaration> {
        let language = if declaration.language == "lean" {
            "rocq"
        } else {
            "lean"
        };
        self.declaration(language, &declaration.module, &declaration.symbol)
    }
}
