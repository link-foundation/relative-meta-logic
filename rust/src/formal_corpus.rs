//! Complete, independently contracted inventories of external formal sources.

use crate::meta_language_support::{
    parse_rml_to_meta_language, reconstruct_rml_from_meta_language,
};
use crate::{parse_lino, parse_one, tokenize_one, Node};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormalDeclaration {
    pub corpus: String,
    pub language: String,
    pub module: String,
    pub kind: String,
    pub symbol: String,
    pub proof_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormalCorpus {
    meta_language_round_trip_ok: bool,
    trusted_foundation_round_trip_ok: bool,
    name: String,
    upstream: String,
    revision: String,
    declarations: Vec<FormalDeclaration>,
}

#[derive(Debug)]
struct Contract {
    name: String,
    upstream: String,
    revision: String,
    count: usize,
    fingerprint: String,
}

fn leaf<'a>(node: &'a Node, context: &str) -> Result<&'a str, String> {
    match node {
        Node::Leaf(value) if !value.is_empty() => Ok(value),
        _ => Err(format!("{context} must be a non-empty reference")),
    }
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
        let Node::List(clause) = node else {
            return Err(format!("{context} clauses must have the form (name value)"));
        };
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

fn canonical(declaration: &FormalDeclaration) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        declaration.language,
        declaration.module,
        declaration.kind,
        declaration.symbol,
        declaration.proof_status
    )
}

fn sha256(lines: &[String]) -> String {
    let mut hash = Sha256::new();
    let input = format!("{}\n", lines.join("\n"));
    hash.update(input.as_bytes());
    format!("{:x}", hash.finalize())
}

impl FormalCorpus {
    pub fn from_rml(source: &str, trusted_foundation: &str) -> Result<Self, String> {
        let (reconstructed, candidate_forms) = parse_forms(source, "formal corpus")?;
        let (trusted_reconstructed, trusted_forms) =
            parse_forms(trusted_foundation, "trusted formal corpus foundation")?;

        let mut contract = None;
        for form in trusted_forms {
            let Node::List(children) = form else { continue };
            let Some(head) = children.first() else {
                continue;
            };
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
            let data = clauses(
                &children,
                &format!("formal-corpus-contract {name}"),
                &["upstream", "revision", "declaration-count", "sha256"],
            )?;
            let count = data["declaration-count"].parse::<usize>().map_err(|_| {
                format!("formal-corpus-contract {name} declaration-count must be a natural number")
            })?;
            if data["sha256"].len() != 64
                || !data["sha256"]
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
                count,
                fingerprint: data["sha256"].clone(),
            });
        }
        let contract = contract.ok_or_else(|| {
            "trusted formal corpus foundation is missing its contract".to_string()
        })?;

        let mut header: Option<(String, String, String)> = None;
        let mut declarations = Vec::new();
        let mut seen = HashSet::new();
        for form in candidate_forms {
            let Node::List(children) = form else { continue };
            let Some(head_node) = children.first() else {
                continue;
            };
            let head = leaf(head_node, "formal corpus form")?;
            match head {
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
                        &children,
                        &format!("formal-corpus {name}"),
                        &["upstream", "revision"],
                    )?;
                    header = Some((name, data["upstream"].clone(), data["revision"].clone()));
                }
                "formal-module" => {
                    if children.len() < 5 {
                        return Err("formal-module must contain declarations".to_string());
                    }
                    let owner = leaf(&children[1], "formal-module corpus")?.to_string();
                    let language = leaf(&children[2], "formal-module language")?.to_string();
                    let module = leaf(&children[3], "formal-module name")?.to_string();
                    if !matches!(language.as_str(), "lean" | "rocq") {
                        return Err(format!(
                            "formal-module {module} has unsupported language {language}"
                        ));
                    }
                    for node in &children[4..] {
                        let Node::List(declaration) = node else {
                            return Err(format!(
                                "formal-module {language}.{module} has invalid declaration"
                            ));
                        };
                        if declaration.len() < 2 {
                            return Err(format!(
                                "formal-module {language}.{module} has invalid declaration"
                            ));
                        }
                        let kind = leaf(&declaration[0], "formal declaration kind")?.to_string();
                        let symbol =
                            leaf(&declaration[1], "formal declaration symbol")?.to_string();
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
                                "formal declaration {language}.{module}.{symbol} has unsupported kind {kind}"
                            ));
                        }
                        let expected_len = if kind == "theorem" { 3 } else { 2 };
                        if declaration.len() != expected_len {
                            return Err(format!(
                                "formal declaration {language}.{module}.{symbol} has invalid shape"
                            ));
                        }
                        let proof_status = if kind == "theorem" {
                            let status = leaf(&declaration[2], "formal theorem proof status")?;
                            if !matches!(status, "verified" | "admitted") {
                                return Err(format!(
                                    "formal theorem {language}.{module}.{symbol} has unsupported proof status {status}"
                                ));
                            }
                            status.to_string()
                        } else {
                            "not-applicable".to_string()
                        };
                        let key = (language.clone(), module.clone(), symbol.clone());
                        if !seen.insert(key) {
                            return Err(format!(
                                "duplicate formal declaration {language}.{module}.{symbol}"
                            ));
                        }
                        declarations.push(FormalDeclaration {
                            corpus: owner.clone(),
                            language: language.clone(),
                            module: module.clone(),
                            kind,
                            symbol,
                            proof_status,
                        });
                    }
                }
                _ => {
                    return Err(format!(
                        "candidate formal corpus has unsupported form {head}"
                    ))
                }
            }
        }
        let (name, upstream, revision) =
            header.ok_or_else(|| "candidate formal corpus is missing its header".to_string())?;
        if name != contract.name || upstream != contract.upstream || revision != contract.revision {
            return Err(
                "candidate formal corpus metadata does not match trusted contract".to_string(),
            );
        }
        if let Some(wrong) = declarations.iter().find(|entry| entry.corpus != name) {
            return Err(format!(
                "formal module {}.{} belongs to {}, not {name}",
                wrong.language, wrong.module, wrong.corpus
            ));
        }
        declarations.sort_by_key(canonical);
        if declarations.len() != contract.count {
            return Err(format!(
                "formal corpus declaration count {} does not match trusted count {}",
                declarations.len(),
                contract.count
            ));
        }
        let fingerprint = sha256(&declarations.iter().map(canonical).collect::<Vec<_>>());
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
            declarations,
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

    pub fn declarations(&self) -> &[FormalDeclaration] {
        &self.declarations
    }

    pub fn languages(&self) -> Vec<&str> {
        self.declarations
            .iter()
            .map(|entry| entry.language.as_str())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    pub fn modules(&self, language: &str) -> Vec<&str> {
        self.declarations
            .iter()
            .filter(|entry| entry.language == language)
            .map(|entry| entry.module.as_str())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
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
}
