//! RML syntax links over the published meta-language public API.
//! Parsing is separate from name resolution, elaboration, execution, and verification.
use crate::lino_frontend::{
    format_parsed_link, parse_lino_link_document, LinoForm, LinoParseError, ParsedLink,
    MAX_LINO_NESTING_DEPTH,
};
use meta_language::{LanguageProfile, Link, LinkId, LinkMetadata, LinkNetwork, LinkType};
use std::collections::{BTreeMap, BTreeSet};

pub const RML_STRUCTURE_SCHEMA: &str = "rml:structure:1";
const KINDS: &[&str] = &[
    "document",
    "form",
    "location",
    "reference",
    "link",
    "compound",
    "diagnostic",
];

fn definition(kind: &str) -> String {
    format!("{RML_STRUCTURE_SCHEMA}:{kind}")
}

/// Register this extension as inspectable upstream language-profile links.
pub fn register_rml_extension(network: &mut LinkNetwork) {
    let mut profile = LanguageProfile::new(RML_STRUCTURE_SCHEMA, "RML");
    for kind in [
        LinkType::Syntax,
        LinkType::Semantic,
        LinkType::Token,
        LinkType::Trivia,
    ] {
        profile = profile.with_link_type(kind);
    }
    for kind in KINDS {
        profile = profile.with_concept(definition(kind));
    }
    profile.declare_in(network);
}

fn insert(
    network: &mut LinkNetwork,
    kind: &str,
    term: Option<&str>,
    references: &[LinkId],
) -> LinkId {
    let mut metadata = LinkMetadata::new()
        .with_link_type(LinkType::Syntax)
        .with_language("RML")
        .with_definition(definition(kind));
    if let Some(term) = term {
        metadata = metadata.with_term(term);
    }
    network.insert_dynamic_link(references, metadata)
}

fn insert_tree(network: &mut LinkNetwork, tree: &ParsedLink) -> LinkId {
    let kind = if tree.compound {
        "compound"
    } else if tree.id.is_some() && tree.values.is_empty() {
        "reference"
    } else {
        "link"
    };
    let references: Vec<_> = tree
        .values
        .iter()
        .map(|child| insert_tree(network, child))
        .collect();
    insert(network, kind, tree.id.as_deref(), &references)
}

fn category(tree: &ParsedLink) -> &'static str {
    if tree.id.is_some() {
        return "declaration";
    }
    match tree.values.first().and_then(|child| child.id.as_deref()) {
        Some("namespace" | "theory" | "linked-program" | "foundation") => "theory",
        Some("rule" | "linked-rewrite" | "linked-inference") => "rule",
        Some("assumption" | "proof-assumption" | "linked-fact" | "axiom") => "assumption",
        Some("proof" | "proof-object" | "theorem") => "proof",
        Some("substitution" | "substitute" | "rebind") => "substitution",
        _ => "form",
    }
}

fn insert_forms(network: &mut LinkNetwork, forms: &[(LinoForm, ParsedLink)]) -> LinkId {
    let roots: Vec<_> = forms
        .iter()
        .map(|(form, tree)| {
            let root = insert_tree(network, tree);
            let position = format!("{}:{}:{}", form.line, form.col, form.length);
            let location = insert(network, "location", Some(&position), &[]);
            insert(network, "form", Some(category(tree)), &[root, location])
        })
        .collect();
    insert(network, "document", Some(RML_STRUCTURE_SCHEMA), &roots)
}

/// Retain invalid input in the source plane and attach a diagnostic instead of a parsed document.
pub fn attach_rml_structure(network: &mut LinkNetwork, source: &str) -> LinkId {
    register_rml_extension(network);
    match parse_lino_link_document(source) {
        Ok(forms) => insert_forms(network, &forms),
        Err(error) => {
            let position = format!("{}:{}:{}", error.line, error.col, error.length);
            let location = insert(network, "location", Some(&position), &[]);
            insert(network, "diagnostic", Some(&error.detail), &[location])
        }
    }
}

fn invalid(detail: impl Into<String>) -> LinoParseError {
    LinoParseError {
        detail: detail.into(),
        line: 1,
        col: 1,
        length: 0,
    }
}

fn locate<'a>(
    network: &'a LinkNetwork,
    id: LinkId,
    kind: Option<&str>,
) -> Result<&'a Link, LinoParseError> {
    let link = network
        .link(id)
        .ok_or_else(|| invalid("Dangling RML structure reference"))?;
    let metadata = link.metadata();
    if metadata.link_type() != Some(LinkType::Syntax)
        || metadata.language() != Some("RML")
        || kind.is_some_and(|kind| metadata.definition() != Some(definition(kind).as_str()))
    {
        return Err(invalid("Invalid RML structure node"));
    }
    Ok(link)
}

fn location_of(network: &LinkNetwork, id: LinkId) -> Result<(usize, usize, usize), LinoParseError> {
    let link = locate(network, id, Some("location"))?;
    let parts: Result<Vec<usize>, _> = link
        .metadata()
        .term()
        .unwrap_or_default()
        .split(':')
        .map(str::parse)
        .collect();
    match parts {
        Ok(parts)
            if parts.len() == 3 && parts[0] > 0 && parts[1] > 0 && link.references().is_empty() =>
        {
            Ok((parts[0], parts[1], parts[2]))
        }
        _ => Err(invalid("Invalid RML source location")),
    }
}

struct ExpansionBudget {
    nodes: usize,
    units: usize,
}

fn read_tree(
    network: &LinkNetwork,
    id: LinkId,
    active: &mut BTreeSet<LinkId>,
    depth: usize,
    budget: &mut ExpansionBudget,
) -> Result<ParsedLink, LinoParseError> {
    if depth > MAX_LINO_NESTING_DEPTH + 2 || !active.insert(id) {
        return Err(invalid("Cyclic or over-deep RML syntax network"));
    }
    let link = locate(network, id, None)?;
    let metadata = link.metadata();
    budget.nodes = budget
        .nodes
        .checked_sub(1)
        .ok_or_else(|| invalid("RML syntax expansion limit exceeded"))?;
    let units = metadata
        .term()
        .map_or(0, |term| term.encode_utf16().count())
        .saturating_add(1);
    budget.units = budget
        .units
        .checked_sub(units)
        .ok_or_else(|| invalid("RML syntax expansion limit exceeded"))?;
    let kind = KINDS
        .iter()
        .find(|kind| metadata.definition() == Some(definition(kind).as_str()));
    if !matches!(kind, Some(&"reference" | &"link" | &"compound"))
        || kind == Some(&"reference")
            && (metadata.term().is_none() || !link.references().is_empty())
    {
        return Err(invalid("Invalid RML syntax node"));
    }
    let values = link
        .references()
        .iter()
        .map(|id| read_tree(network, *id, active, depth + 1, budget))
        .collect::<Result<Vec<_>, _>>()?;
    active.remove(&id);
    Ok(ParsedLink {
        id: metadata.term().map(str::to_string),
        values,
        compound: kind == Some(&"compound"),
    })
}

/// Decode from ordered graph links. Never consult source tokens or invoke a parser.
///
/// # Errors
/// Returns the retained source diagnostic or a malformed-network error.
pub fn rml_structured_document(
    network: &LinkNetwork,
) -> Result<Vec<(LinoForm, ParsedLink)>, LinoParseError> {
    let links: Vec<_> = network
        .links()
        .filter(|link| {
            link.metadata().language() == Some("RML")
                && link.metadata().link_type() == Some(LinkType::Syntax)
        })
        .collect();
    if let Some(error) = links
        .iter()
        .find(|link| link.metadata().definition() == Some(definition("diagnostic").as_str()))
    {
        let id = error
            .references()
            .first()
            .ok_or_else(|| invalid("Invalid RML diagnostic"))?;
        let (line, col, length) = location_of(network, *id)?;
        return Err(LinoParseError {
            detail: error.metadata().term().unwrap_or_default().to_string(),
            line,
            col,
            length,
        });
    }
    let documents: Vec<_> = links
        .iter()
        .filter(|link| link.metadata().definition() == Some(definition("document").as_str()))
        .collect();
    if documents.len() != 1 || documents[0].metadata().term() != Some(RML_STRUCTURE_SCHEMA) {
        return Err(invalid(
            "Expected exactly one supported RML structure document",
        ));
    }
    let syntax: Vec<_> = links
        .iter()
        .filter(|link| {
            link.metadata().definition().is_some_and(|definition| {
                definition.starts_with(&format!("{RML_STRUCTURE_SCHEMA}:"))
            })
        })
        .collect();
    let units = syntax.iter().fold(0usize, |total, link| {
        total.saturating_add(
            link.metadata()
                .term()
                .map_or(0, |term| term.encode_utf16().count())
                .saturating_add(1),
        )
    });
    let mut budget = ExpansionBudget {
        nodes: syntax.len().saturating_mul(4).max(1024),
        units: units.saturating_mul(4).max(4096),
    };
    documents[0]
        .references()
        .iter()
        .map(|id| {
            let form = locate(network, *id, Some("form"))?;
            if form.references().len() != 2 {
                return Err(invalid("Invalid RML form arity"));
            }
            let link = read_tree(
                network,
                form.references()[0],
                &mut BTreeSet::new(),
                0,
                &mut budget,
            )?;
            let (line, col, length) = location_of(network, form.references()[1])?;
            Ok((
                LinoForm {
                    text: format_parsed_link(&link),
                    line,
                    col,
                    length,
                },
                link,
            ))
        })
        .collect()
}

/// Canonical top-level forms generated solely from syntax links.
/// # Errors
/// Returns the retained source diagnostic or a malformed-network error.
pub fn rml_structured_forms(network: &LinkNetwork) -> Result<Vec<String>, LinoParseError> {
    Ok(rml_structured_document(network)?
        .into_iter()
        .map(|(form, _)| form.text)
        .collect())
}

/// Canonical LiNo generated without source bytes. Original formatting remains in the source plane.
/// # Errors
/// Returns the retained source diagnostic or a malformed-network error.
pub fn emit_rml_from_structure(network: &LinkNetwork) -> Result<String, LinoParseError> {
    let forms = rml_structured_forms(network)?;
    Ok(if forms.is_empty() {
        String::new()
    } else {
        format!("{}\n", forms.join("\n"))
    })
}

/// Construct an independent syntax network with no source tokens or original buffer.
/// # Errors
/// Returns the retained source diagnostic or a malformed-network error.
pub fn rml_structure_only(network: &LinkNetwork) -> Result<LinkNetwork, LinoParseError> {
    let forms = rml_structured_document(network)?;
    let mut structured = LinkNetwork::new();
    register_rml_extension(&mut structured);
    insert_forms(&mut structured, &forms);
    Ok(structured)
}

/// Serialize the versioned shared JS/Rust graph snapshot, retaining node metadata.
/// # Errors
/// Rejects an invalid source or malformed structure.
pub fn serialize_rml_structure(network: &LinkNetwork) -> Result<String, LinoParseError> {
    let structured = rml_structure_only(network)?;
    let records: Vec<_> = structured.links().map(|link| {
        let metadata = link.metadata();
        let mut record = serde_json::json!({ "id": link.id().as_u64(),
            "references": link.references().iter().map(|id| id.as_u64()).collect::<Vec<_>>(),
            "metadata": { "linkType": if metadata.link_type() == Some(LinkType::Syntax) { "Syntax" } else { "Semantic" },
                "language": "RML", "definition": metadata.definition() } });
        if let Some(term) = metadata.term() { record["metadata"]["term"] = term.into(); }
        record
    }).collect();
    Ok(
        serde_json::json!({ "schema": RML_STRUCTURE_SCHEMA, "language": "RML", "links": records })
            .to_string(),
    )
}

/// Read the shared JS/Rust graph snapshot. IDs may be reindexed; sharing is preserved.
/// # Errors
/// Rejects invalid schemas, dangling references, cycles, depths, and malformed nodes.
pub fn deserialize_rml_structure(serialized: &str) -> Result<LinkNetwork, String> {
    let snapshot: serde_json::Value =
        serde_json::from_str(serialized).map_err(|error| error.to_string())?;
    if snapshot["schema"] != RML_STRUCTURE_SCHEMA || snapshot["language"] != "RML" {
        return Err("Unsupported RML structure snapshot".into());
    }
    let records = snapshot["links"]
        .as_array()
        .ok_or("Invalid RML structure records")?;
    let mut by_id = BTreeMap::new();
    for record in records {
        let id = record["id"]
            .as_u64()
            .filter(|id| *id > 0 && *id <= 9_007_199_254_740_991)
            .ok_or("Invalid RML structure ID")?;
        if by_id.insert(id, record).is_some() {
            return Err("Duplicate RML structure ID".into());
        }
    }
    fn restore(
        id: u64,
        records: &BTreeMap<u64, &serde_json::Value>,
        mapped: &mut BTreeMap<u64, LinkId>,
        active: &mut BTreeSet<u64>,
        network: &mut LinkNetwork,
    ) -> Result<LinkId, String> {
        if let Some(id) = mapped.get(&id) {
            return Ok(*id);
        }
        if active.len() > MAX_LINO_NESTING_DEPTH + 5 || !active.insert(id) {
            return Err("Cyclic or over-deep RML syntax network".into());
        }
        let record = records.get(&id).ok_or("Dangling RML structure reference")?;
        let data = &record["metadata"];
        let kind = match data["linkType"].as_str() {
            Some("Syntax") => LinkType::Syntax,
            Some("Semantic") => LinkType::Semantic,
            _ => return Err("Invalid RML structure metadata".into()),
        };
        if data["language"] != "RML" {
            return Err("Invalid RML structure language".into());
        }
        let mut metadata = LinkMetadata::new()
            .with_link_type(kind)
            .with_language("RML")
            .with_definition(
                data["definition"]
                    .as_str()
                    .ok_or("Invalid RML structure definition")?,
            );
        if let Some(term) = data.get("term") {
            metadata = metadata.with_term(term.as_str().ok_or("Invalid RML structure term")?);
        }
        let references = record["references"]
            .as_array()
            .ok_or("Invalid RML structure references")?
            .iter()
            .map(|value| {
                let id = value.as_u64().ok_or("Invalid RML structure reference")?;
                restore(id, records, mapped, active, network)
            })
            .collect::<Result<Vec<_>, String>>()?;
        let new_id = network.insert_dynamic_link(&references, metadata);
        mapped.insert(id, new_id);
        active.remove(&id);
        Ok(new_id)
    }
    let mut network = LinkNetwork::new();
    let mut mapped = BTreeMap::new();
    for id in by_id.keys() {
        restore(*id, &by_id, &mut mapped, &mut BTreeSet::new(), &mut network)?;
    }
    rml_structured_document(&network).map_err(|error| error.to_string())?;
    Ok(network)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlRepresentationStages {
    pub schema: &'static str,
    pub preservation: &'static str,
    pub parsing: &'static str,
    pub resolution: &'static str,
    pub elaboration: &'static str,
    pub execution: &'static str,
    pub verification: &'static str,
    pub diagnostic: Option<String>,
}

pub fn rml_representation_stages(network: &LinkNetwork) -> RmlRepresentationStages {
    let diagnostic = rml_structured_document(network)
        .err()
        .map(|error| error.to_string());
    RmlRepresentationStages {
        schema: RML_STRUCTURE_SCHEMA,
        preservation: if network
            .links()
            .any(|link| link.metadata().link_type() == Some(LinkType::Token))
        {
            "source-token-plane"
        } else {
            "canonical-structure"
        },
        parsing: if diagnostic.is_some() {
            "rejected"
        } else {
            "parsed"
        },
        resolution: "not-run",
        elaboration: "not-run",
        execution: "not-run",
        verification: "not-run",
        diagnostic,
    }
}

/// Explicit pending translation obligation; target source is never fabricated or relabelled.
/// # Errors
/// Requires two distinct language names from the audited four-language inventory.
pub fn language_translation_obligation(
    source: &str,
    source_language: &str,
    target_language: &str,
) -> Result<serde_json::Value, String> {
    let languages = ["JavaScript", "Rust", "Rocq", "Lean"];
    if !languages.contains(&source_language)
        || !languages.contains(&target_language)
        || source_language == target_language
    {
        return Err(
            "Expected two distinct supported language names: JavaScript, Rust, Rocq, Lean".into(),
        );
    }
    Ok(serde_json::json!({
        "schema": "rml:translation-obligation:1", "status": "unsupported",
        "sourceLanguage": source_language, "targetLanguage": target_language,
        "preservedSource": source, "targetSource": null,
        "obligations": [{ "code": "RML_TRANSLATION_UNIMPLEMENTED", "stage": "semantic-lowering",
            "description": format!("No full-language {source_language}-to-{target_language} translation is implemented; the portable-natural fragment is separate"),
            "requires": ["complete-source-structure", "binding-and-type-resolution", "faithful-target-encoding", "behavior-or-proof-preservation"] }]
    }))
}
