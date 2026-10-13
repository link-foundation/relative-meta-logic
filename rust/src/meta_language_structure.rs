//! RML structure links over the published meta-language public API.
//! Syntax links carry LiNo structure. Layout links carry every source character,
//! bound to the syntax occurrence it spells, so exact source is emitted without a
//! source buffer. Semantic links carry checked RML declarations, binders, roles and
//! reference resolutions; they are recomputed from syntax on every read and never
//! trusted as authority. Parsing is separate from resolution, elaboration,
//! execution, and verification.
use crate::lino_frontend::{
    escape_reference, format_parsed_link, parse_lino_link_document, prepare_lino_source,
    LinoForm, LinoParseError, LogicalLine, ParsedLink, PreparedLino, QuoteReference,
    MAX_LINO_NESTING_DEPTH,
};
use meta_language::{LanguageProfile, Link, LinkId, LinkMetadata, LinkNetwork, LinkType};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const RML_STRUCTURE_SCHEMA: &str = "rml:structure:1";
const SYNTAX_KINDS: &[&str] = &[
    "document",
    "form",
    "location",
    "reference",
    "link",
    "compound",
    "diagnostic",
];
const LAYOUT_KINDS: &[&str] = &["layout", "trivia", "token", "token-value"];
const SEMANTIC_KINDS: &[&str] = &[
    "provenance",
    "layout-refusal",
    "semantics",
    "declaration",
    "binder",
    "role",
    "resolution",
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
    for kind in SYNTAX_KINDS
        .iter()
        .chain(LAYOUT_KINDS.iter())
        .chain(SEMANTIC_KINDS.iter())
    {
        profile = profile.with_concept(definition(kind));
    }
    profile.declare_in(network);
}

fn insert_as(
    network: &mut LinkNetwork,
    link_type: LinkType,
    kind: &str,
    term: Option<&str>,
    references: &[LinkId],
) -> LinkId {
    let mut metadata = LinkMetadata::new()
        .with_link_type(link_type)
        .with_language("RML")
        .with_definition(definition(kind));
    if let Some(term) = term {
        metadata = metadata.with_term(term);
    }
    network.insert_dynamic_link(references, metadata)
}

fn insert(
    network: &mut LinkNetwork,
    kind: &str,
    term: Option<&str>,
    references: &[LinkId],
) -> LinkId {
    insert_as(network, LinkType::Syntax, kind, term, references)
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

fn source_provenance(raw: &str, derived_from: Option<&str>) -> String {
    let digest: String = Sha256::digest(raw.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let mut term = format!("source-sha256:{digest} utf8-bytes:{}", raw.len());
    if let Some(parent) = derived_from {
        term.push_str(&format!(" derived-from:{parent}"));
    }
    term
}

/// Retain invalid input in the source plane and attach a diagnostic instead of a parsed document.
pub fn attach_rml_structure(network: &mut LinkNetwork, source: &str) -> LinkId {
    register_rml_extension(network);
    match parse_lino_link_document(source) {
        Ok(forms) => {
            let document = insert_forms(network, &forms);
            attach_layout(network, source, document);
            document
        }
        Err(error) => {
            let position = format!("{}:{}:{}", error.line, error.col, error.length);
            let location = insert(network, "location", Some(&position), &[]);
            insert(network, "diagnostic", Some(&error.detail), &[location])
        }
    }
}

// ---------- Exact source layout ----------

/// One layout segment: trivia (whitespace, comments, punctuation, BOM) or a
/// reference token, optionally bound to the syntax occurrence it spells.
#[derive(Debug, Clone)]
struct Segment {
    token: bool,
    start: Option<usize>,
    text: String,
    value: Option<String>,
    node: Option<LinkId>,
}

/// Normalized byte offset to raw byte offset: a leading BOM is dropped and
/// CRLF or a lone CR reads as one LF, exactly as `normalize_lino_source` does.
fn raw_offsets(raw: &str) -> Vec<usize> {
    let bytes = raw.as_bytes();
    let mut map = Vec::with_capacity(bytes.len() + 1);
    let mut at = if raw.starts_with('\u{feff}') { 3 } else { 0 };
    while at < bytes.len() {
        map.push(at);
        at += if bytes[at] == b'\r' && bytes.get(at + 1) == Some(&b'\n') {
            2
        } else {
            1
        };
    }
    map.push(bytes.len());
    map
}

/// Lex every source character into trivia, punctuation, and reference tokens.
fn lex_layout(raw: &str) -> Result<(Vec<Segment>, Vec<LogicalLine>), LinoParseError> {
    let PreparedLino {
        source,
        prepared,
        lines,
        quotes,
    } = prepare_lino_source(raw)?;
    let at = raw_offsets(raw);
    let quoted: BTreeMap<usize, &QuoteReference> =
        quotes.iter().map(|quote| (quote.start, quote)).collect();
    let bytes = prepared.as_bytes();
    let space = |byte: u8| matches!(byte, b' ' | b'\t' | b'\n');
    let boundary = |byte: u8| matches!(byte, b' ' | b'\t' | b'\n' | b'(' | b')' | b':');
    let mut segments = Vec::new();
    if raw.starts_with('\u{feff}') {
        segments.push(Segment {
            token: false,
            start: None,
            text: "\u{feff}".to_string(),
            value: None,
            node: None,
        });
    }
    let mut index = 0;
    while index < source.len() {
        if let Some(quote) = quoted.get(&index) {
            segments.push(Segment {
                token: true,
                start: Some(index),
                text: raw[at[index]..at[quote.end]].to_string(),
                value: Some(quote.value.clone()),
                node: None,
            });
            index = quote.end;
            continue;
        }
        let byte = bytes[index];
        let mut end = index + 1;
        let token = if space(byte) {
            while end < source.len() && !quoted.contains_key(&end) && space(bytes[end]) {
                end += 1;
            }
            false
        } else if matches!(byte, b'(' | b')' | b':') {
            false
        } else {
            while end < source.len() && !quoted.contains_key(&end) && !boundary(bytes[end]) {
                end += 1;
            }
            true
        };
        segments.push(Segment {
            token,
            start: Some(index),
            text: raw[at[index]..at[end]].to_string(),
            value: token.then(|| source[index..end].to_string()),
            node: None,
        });
        index = end;
    }
    Ok((segments, lines))
}

// Profile capability links name each concept as their definition; they are vocabulary, not records.
fn is_profile(metadata: &LinkMetadata) -> bool {
    metadata
        .term()
        .is_some_and(|term| term.starts_with("language-profile"))
}

fn own(link: Option<&Link>, link_type: LinkType, kind: &str) -> bool {
    link.is_some_and(|link| {
        let metadata = link.metadata();
        metadata.language() == Some("RML")
            && metadata.link_type() == Some(link_type)
            && metadata.definition() == Some(definition(kind).as_str())
            && !is_profile(metadata)
    })
}

fn own_links<'a>(network: &'a LinkNetwork, link_type: LinkType, kind: &str) -> Vec<&'a Link> {
    network
        .links()
        .filter(|link| own(Some(*link), link_type, kind))
        .collect()
}

/// The syntax occurrences a source token spells: pre-order, skipping the
/// repeated path prefix that a compound link shares with an earlier line.
fn bindable_occurrences(network: &LinkNetwork, id: LinkId, out: &mut Vec<(LinkId, String)>) {
    let Some(link) = network.link(id) else {
        return;
    };
    let metadata = link.metadata();
    if let Some(term) = metadata.term() {
        out.push((id, term.to_string()));
    }
    let compound = metadata.definition() == Some(definition("compound").as_str());
    for (index, child) in link.references().iter().enumerate() {
        if !(compound && index == 0) {
            bindable_occurrences(network, *child, out);
        }
    }
}

fn json_string(value: &str) -> String {
    serde_json::Value::String(value.to_string()).to_string()
}

fn plan_layout(raw: &str, network: &LinkNetwork, document: LinkId) -> Result<Vec<Segment>, String> {
    let (mut segments, lines) = lex_layout(raw).map_err(|error| error.to_string())?;
    let offsets: BTreeMap<(usize, usize), usize> = lines
        .iter()
        .map(|line| ((line.line, line.col), line.offset))
        .collect();
    let forms: Vec<LinkId> = network
        .link(document)
        .map(|link| link.references().to_vec())
        .unwrap_or_default();
    let mut roots = Vec::new();
    let mut starts: Vec<usize> = Vec::new();
    for form in &forms {
        let untraced = || format!("form {} has no traced source position", roots.len() + 1);
        let form = network.link(*form).ok_or_else(untraced)?;
        let location = form
            .references()
            .get(1)
            .and_then(|id| network.link(*id))
            .and_then(|link| link.metadata().term())
            .ok_or_else(untraced)?;
        let parts: Vec<usize> = location
            .split(':')
            .map(|part| part.parse().unwrap_or(0))
            .collect();
        let start = (parts.len() == 3 && parts[2] != 0)
            .then(|| offsets.get(&(parts[0], parts[1])).copied())
            .flatten()
            .filter(|start| starts.last().is_none_or(|last| start > last));
        match start {
            Some(start) => {
                starts.push(start);
                roots.push(form.references()[0]);
            }
            None => return Err(untraced()),
        }
    }
    let tokens: Vec<usize> = segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| segment.token)
        .map(|(index, _)| index)
        .collect();
    let start_of = |segments: &[Segment], index: usize| segments[tokens[index]].start.unwrap_or(0);
    let mut next = 0;
    for (index, root) in roots.iter().enumerate() {
        let mut expected = Vec::new();
        bindable_occurrences(network, *root, &mut expected);
        while next < tokens.len() && start_of(&segments, next) < starts[index] {
            next += 1;
        }
        let end = starts.get(index + 1).copied().unwrap_or(usize::MAX);
        let mut region = Vec::new();
        let mut at = next;
        while at < tokens.len() && start_of(&segments, at) < end && region.len() < expected.len() {
            region.push(tokens[at]);
            at += 1;
        }
        for (occurrence, (id, term)) in expected.iter().enumerate() {
            let found = region
                .get(occurrence)
                .and_then(|segment| segments[*segment].value.clone());
            if found.as_deref() != Some(term.as_str()) {
                return Err(format!(
                    "form {} occurrence {} expected {} but the source token reads {}",
                    index + 1,
                    occurrence + 1,
                    json_string(term),
                    found.map_or_else(|| "null".to_string(), |value| json_string(&value))
                ));
            }
            segments[region[occurrence]].node = Some(*id);
        }
    }
    Ok(segments)
}

fn insert_layout(network: &mut LinkNetwork, segments: &[Segment]) -> LinkId {
    let ids: Vec<LinkId> = segments
        .iter()
        .map(|segment| {
            if !segment.token {
                return insert_as(network, LinkType::Trivia, "trivia", Some(&segment.text), &[]);
            }
            let value = insert_as(
                network,
                LinkType::Trivia,
                "token-value",
                Some(segment.value.as_deref().unwrap_or_default()),
                &[],
            );
            let references = match segment.node {
                Some(node) => vec![value, node],
                None => vec![value],
            };
            insert_as(network, LinkType::Trivia, "token", Some(&segment.text), &references)
        })
        .collect();
    insert_as(network, LinkType::Trivia, "layout", Some(RML_STRUCTURE_SCHEMA), &ids)
}

fn attach_layout(network: &mut LinkNetwork, raw: &str, document: LinkId) {
    match plan_layout(raw, network, document) {
        Ok(segments) => {
            insert_layout(network, &segments);
        }
        Err(refusal) => {
            insert_as(network, LinkType::Semantic, "layout-refusal", Some(&refusal), &[document]);
        }
    }
    let provenance = source_provenance(raw, None);
    insert_as(network, LinkType::Semantic, "provenance", Some(&provenance), &[document]);
}

struct Layout {
    segments: Vec<Segment>,
    edited: bool,
}

/// Read the layout plane without any parser. Bound tokens must spell every
/// bindable syntax occurrence exactly once, in order; they follow edits to it.
fn read_layout(network: &LinkNetwork, bindable: &[LinkId]) -> Result<Option<Layout>, String> {
    let layouts = own_links(network, LinkType::Trivia, "layout");
    if layouts.is_empty() {
        return Ok(None);
    }
    if layouts.len() > 1 || layouts[0].metadata().term() != Some(RML_STRUCTURE_SCHEMA) {
        return Err("Expected at most one supported RML exact source layout".into());
    }
    let occurrences: BTreeSet<LinkId> = bindable.iter().copied().collect();
    let mut order = Vec::new();
    let mut edited = false;
    let mut segments = Vec::new();
    for id in layouts[0].references() {
        let link = network.link(*id);
        let term = link.and_then(|link| link.metadata().term());
        if own(link, LinkType::Trivia, "trivia")
            && link.is_some_and(|link| link.references().is_empty())
        {
            if let Some(term) = term {
                segments.push(Segment {
                    token: false,
                    start: None,
                    text: term.to_string(),
                    value: None,
                    node: None,
                });
                continue;
            }
        }
        let references = link.map(Link::references).unwrap_or_default();
        let value = references.first().and_then(|value| network.link(*value));
        let value_term = value.and_then(|value| value.metadata().term());
        let (Some(term), Some(value_term)) = (term, value_term) else {
            return Err(format!("Invalid RML layout segment {}", id.as_u64()));
        };
        if !own(link, LinkType::Trivia, "token")
            || references.is_empty()
            || references.len() > 2
            || !own(value, LinkType::Trivia, "token-value")
            || value.is_some_and(|value| !value.references().is_empty())
        {
            return Err(format!("Invalid RML layout segment {}", id.as_u64()));
        }
        if references.len() == 1 {
            segments.push(Segment {
                token: true,
                start: None,
                text: term.to_string(),
                value: Some(value_term.to_string()),
                node: None,
            });
            continue;
        }
        let node = references[1];
        if !occurrences.contains(&node) {
            return Err(format!(
                "Dangling or forged RML layout binding {} -> {}",
                id.as_u64(),
                node.as_u64()
            ));
        }
        order.push(node);
        let current = network
            .link(node)
            .and_then(|link| link.metadata().term())
            .unwrap_or_default();
        let changed = current != value_term;
        edited |= changed;
        segments.push(Segment {
            token: true,
            start: None,
            text: if changed {
                escape_reference(current)
            } else {
                term.to_string()
            },
            value: Some(value_term.to_string()),
            node: Some(node),
        });
    }
    if order.as_slice() != bindable {
        return Err(
            "Dangling or forged RML layout binding: tokens do not spell the syntax occurrences in order"
                .into(),
        );
    }
    Ok(Some(Layout { segments, edited }))
}

fn layout_refusal(network: &LinkNetwork) -> Option<String> {
    own_links(network, LinkType::Semantic, "layout-refusal")
        .first()
        .and_then(|link| link.metadata().term())
        .map(str::to_string)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlProvenance {
    pub source_sha256: String,
    pub utf8_bytes: usize,
    pub derived_from: Option<String>,
}

fn is_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// Source fingerprint recorded when the structure was produced.
/// # Errors
/// Rejects duplicate or malformed provenance records.
pub fn rml_provenance(network: &LinkNetwork) -> Result<Option<RmlProvenance>, String> {
    let records = own_links(network, LinkType::Semantic, "provenance");
    let Some(record) = records.first() else {
        return Ok(None);
    };
    let invalid = || "Invalid RML source provenance".to_string();
    if records.len() > 1 {
        return Err(invalid());
    }
    let parts: Vec<&str> = record.metadata().term().unwrap_or_default().split(' ').collect();
    if !(2..=3).contains(&parts.len()) {
        return Err(invalid());
    }
    let source_sha256 = parts[0]
        .strip_prefix("source-sha256:")
        .filter(|digest| is_digest(digest))
        .ok_or_else(invalid)?;
    let utf8_bytes = parts[1]
        .strip_prefix("utf8-bytes:")
        .filter(|count| !count.is_empty() && count.bytes().all(|byte| byte.is_ascii_digit()))
        .and_then(|count| count.parse::<usize>().ok())
        .ok_or_else(invalid)?;
    let derived_from = match parts.get(2) {
        Some(part) => Some(
            part.strip_prefix("derived-from:")
                .filter(|digest| is_digest(digest))
                .ok_or_else(invalid)?
                .to_string(),
        ),
        None => None,
    };
    Ok(Some(RmlProvenance {
        source_sha256: source_sha256.to_string(),
        utf8_bytes,
        derived_from,
    }))
}

// ---------- Syntax decoding ----------

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
    let kind = SYNTAX_KINDS
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

/// Decode from ordered Link references. Never consult source tokens or invoke a parser.
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

/// Canonical LiNo generated without source bytes. Exact formatting lives in the layout plane.
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

/// One addressed syntax occurrence.
struct Occurrence {
    id: LinkId,
    address: String,
    term: Option<String>,
    children: Vec<usize>,
}

/// Address-indexed occurrence tree. Every occurrence must have exactly one
/// address; a shared syntax DAG has none and cannot carry identities.
struct Occurrences {
    nodes: Vec<Occurrence>,
    by_id: BTreeMap<LinkId, usize>,
    by_address: BTreeMap<String, usize>,
    forms: Vec<(usize, String)>,
}

impl Occurrences {
    fn node(&self, index: usize) -> &Occurrence {
        &self.nodes[index]
    }

    fn address(&self, index: usize) -> &str {
        &self.nodes[index].address
    }

    fn term(&self, index: usize) -> &str {
        self.nodes[index].term.as_deref().unwrap_or_default()
    }

    fn is_plain(&self, index: usize) -> bool {
        self.nodes[index].term.is_some() && self.nodes[index].children.is_empty()
    }

    fn id_at(&self, address: &str) -> Option<LinkId> {
        self.by_address
            .get(address)
            .map(|index| self.nodes[*index].id)
    }
}

fn visit_occurrence(
    network: &LinkNetwork,
    id: LinkId,
    address: String,
    occurrences: &mut Occurrences,
) -> Result<usize, String> {
    if occurrences.by_id.contains_key(&id) {
        return Err(format!(
            "Shared RML syntax occurrence {} has no unique address",
            id.as_u64()
        ));
    }
    let link = network
        .link(id)
        .ok_or("Dangling RML structure reference")?;
    let index = occurrences.nodes.len();
    occurrences.nodes.push(Occurrence {
        id,
        address: address.clone(),
        term: link.metadata().term().map(str::to_string),
        children: Vec::new(),
    });
    occurrences.by_id.insert(id, index);
    occurrences.by_address.insert(address.clone(), index);
    let mut children = Vec::new();
    for (position, child) in link.references().iter().enumerate() {
        children.push(visit_occurrence(
            network,
            *child,
            format!("{address}.{position}"),
            occurrences,
        )?);
    }
    occurrences.nodes[index].children = children;
    Ok(index)
}

fn syntax_occurrences(network: &LinkNetwork) -> Result<Occurrences, String> {
    rml_structured_document(network).map_err(|error| error.to_string())?;
    let document = network
        .links()
        .find(|link| own(Some(*link), LinkType::Syntax, "document"))
        .ok_or("Expected exactly one supported RML structure document")?;
    let mut occurrences = Occurrences {
        nodes: Vec::new(),
        by_id: BTreeMap::new(),
        by_address: BTreeMap::new(),
        forms: Vec::new(),
    };
    for (index, form) in document.references().iter().enumerate() {
        let form = network.link(*form).ok_or("Dangling RML structure reference")?;
        let category = form.metadata().term().unwrap_or_default().to_string();
        let root = visit_occurrence(
            network,
            form.references()[0],
            index.to_string(),
            &mut occurrences,
        )?;
        occurrences.forms.push((root, category));
    }
    Ok(occurrences)
}

fn bindable_list(network: &LinkNetwork, occurrences: &Occurrences) -> Vec<LinkId> {
    let mut out = Vec::new();
    for (root, _) in &occurrences.forms {
        bindable_occurrences(network, occurrences.node(*root).id, &mut out);
    }
    out.into_iter().map(|(id, _)| id).collect()
}

/// Exact original source, emitted from layout links alone; edited occurrences use their new spelling.
/// # Errors
/// Rejects a missing, refused, malformed, or forged layout plane.
pub fn emit_rml_exact_source(network: &LinkNetwork) -> Result<String, String> {
    let occurrences = syntax_occurrences(network)?;
    match read_layout(network, &bindable_list(network, &occurrences))? {
        Some(layout) => Ok(layout
            .segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect()),
        None => Err(match layout_refusal(network) {
            Some(refusal) => format!("RML exact source layout refused: {refusal}"),
            None => "No RML exact source layout".to_string(),
        }),
    }
}

/// 1-based line and code-point column where each bound token starts.
fn layout_positions(layout: &Layout) -> BTreeMap<LinkId, (usize, usize)> {
    let mut positions = BTreeMap::new();
    let mut line = 1;
    let mut col = 1;
    for (index, segment) in layout.segments.iter().enumerate() {
        if index == 0 && segment.text == "\u{feff}" {
            continue;
        }
        if let Some(node) = segment.node {
            positions.insert(node, (line, col));
        }
        let chars: Vec<char> = segment.text.chars().collect();
        for at in 0..chars.len() {
            if chars[at] == '\r' && chars.get(at + 1) == Some(&'\n') {
                continue;
            }
            if chars[at] == '\n' || chars[at] == '\r' {
                line += 1;
                col = 1;
            } else {
                col += 1;
            }
        }
    }
    positions
}

/// Construct an independent network with no source tokens or original buffer.
/// Layout and provenance are carried by occurrence address; checked semantics are recomputed.
/// # Errors
/// Returns the retained source diagnostic or a malformed-network error.
pub fn rml_structure_only(network: &LinkNetwork) -> Result<LinkNetwork, LinoParseError> {
    let forms = rml_structured_document(network)?;
    let mut structured = LinkNetwork::new();
    register_rml_extension(&mut structured);
    let document = insert_forms(&mut structured, &forms);
    let has_layout = !own_links(network, LinkType::Trivia, "layout").is_empty();
    let semantics = rml_semantic_identities(network).map_err(invalid)?;
    if has_layout {
        let before = syntax_occurrences(network).map_err(invalid)?;
        let layout = read_layout(network, &bindable_list(network, &before))
            .map_err(invalid)?
            .ok_or_else(|| invalid("No RML exact source layout"))?;
        let after = syntax_occurrences(&structured).map_err(invalid)?;
        let segments: Vec<Segment> = layout
            .segments
            .iter()
            .map(|segment| {
                let node = segment.node.and_then(|node| {
                    before
                        .by_id
                        .get(&node)
                        .and_then(|index| after.id_at(before.address(*index)))
                });
                Segment {
                    node,
                    ..segment.clone()
                }
            })
            .collect();
        insert_layout(&mut structured, &segments);
    }
    if let Some(refusal) = layout_refusal(network) {
        insert_as(&mut structured, LinkType::Semantic, "layout-refusal", Some(&refusal), &[document]);
    }
    if let Some(record) = own_links(network, LinkType::Semantic, "provenance").first() {
        rml_provenance(network).map_err(invalid)?;
        let term = record.metadata().term().unwrap_or_default().to_string();
        insert_as(&mut structured, LinkType::Semantic, "provenance", Some(&term), &[document]);
    }
    if semantics.is_some() {
        resolve_rml_structure(&mut structured).map_err(invalid)?;
    }
    Ok(structured)
}

/// Serialize the versioned shared JS/Rust links-network snapshot, retaining node metadata.
/// # Errors
/// Rejects an invalid source or malformed structure.
pub fn serialize_rml_structure(network: &LinkNetwork) -> Result<String, LinoParseError> {
    let structured = rml_structure_only(network)?;
    let records: Vec<_> = structured.links().map(|link| {
        let metadata = link.metadata();
        let link_type = match metadata.link_type() {
            Some(LinkType::Syntax) => "Syntax",
            Some(LinkType::Trivia) => "Trivia",
            _ => "Semantic",
        };
        let mut record = serde_json::json!({ "id": link.id().as_u64(),
            "references": link.references().iter().map(|id| id.as_u64()).collect::<Vec<_>>(),
            "metadata": { "linkType": link_type, "language": "RML", "definition": metadata.definition() } });
        if let Some(term) = metadata.term() { record["metadata"]["term"] = term.into(); }
        record
    }).collect();
    Ok(
        serde_json::json!({ "schema": RML_STRUCTURE_SCHEMA, "language": "RML", "links": records })
            .to_string(),
    )
}

/// Read the shared JS/Rust links-network snapshot. IDs may be reindexed; sharing is preserved.
/// Every plane is checked: syntax, layout bindings, provenance, and semantic identities.
/// # Errors
/// Rejects invalid schemas, dangling references, cycles, depths, malformed nodes,
/// forged identities, and unaccounted extension links.
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
            Some("Trivia") => LinkType::Trivia,
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
    check_rml_planes(&network)?;
    Ok(network)
}

/// What a plane check found: addressed occurrences and the layout state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlPlaneCheck {
    pub occurrences: Option<usize>,
    pub layout: Option<&'static str>,
}

fn mark_reachable(network: &LinkNetwork, id: LinkId, reachable: &mut BTreeSet<LinkId>) {
    if !reachable.insert(id) {
        return;
    }
    if let Some(link) = network.link(id) {
        let metadata = link.metadata();
        if metadata
            .definition()
            .is_some_and(|definition| definition.starts_with(&format!("{RML_STRUCTURE_SCHEMA}:")))
            && metadata.link_type() != Some(LinkType::Syntax)
        {
            for child in link.references() {
                mark_reachable(network, *child, reachable);
            }
        }
    }
}

/// Validate syntax, layout, provenance and semantics, and reject unaccounted extension links.
/// # Errors
/// Returns the first invalid, dangling, forged or unaccounted plane.
pub fn check_rml_planes(network: &LinkNetwork) -> Result<RmlPlaneCheck, String> {
    rml_structured_document(network).map_err(|error| error.to_string())?;
    let declared = |kind: &str| {
        network.links().any(|link| {
            link.metadata().language() == Some("RML")
                && link.metadata().definition() == Some(definition(kind).as_str())
                && !is_profile(link.metadata())
        })
    };
    // Identity planes need an occurrence tree; a bare shared syntax DAG carries none.
    let occurrences = if declared("layout") || declared("semantics") {
        Some(syntax_occurrences(network)?)
    } else {
        None
    };
    let layout = match &occurrences {
        Some(occurrences) => read_layout(network, &bindable_list(network, occurrences))?,
        None => None,
    };
    rml_provenance(network)?;
    rml_semantic_identities(network)?;
    let mut reachable = BTreeSet::new();
    for kind in ["layout", "provenance", "layout-refusal", "semantics"] {
        let roots: Vec<LinkId> = network
            .links()
            .filter(|link| {
                link.metadata().language() == Some("RML")
                    && link.metadata().definition() == Some(definition(kind).as_str())
                    && !is_profile(link.metadata())
            })
            .map(Link::id)
            .collect();
        for root in roots {
            mark_reachable(network, root, &mut reachable);
        }
    }
    for link in network.links() {
        let metadata = link.metadata();
        let extension = LAYOUT_KINDS
            .iter()
            .chain(SEMANTIC_KINDS.iter())
            .any(|kind| metadata.definition() == Some(definition(kind).as_str()));
        if metadata.language() == Some("RML")
            && metadata.link_type() != Some(LinkType::Syntax)
            && !is_profile(metadata)
            && extension
            && !reachable.contains(&link.id())
        {
            return Err(format!(
                "Unaccounted RML {} link {}",
                metadata.definition().unwrap_or_default(),
                link.id().as_u64()
            ));
        }
    }
    Ok(RmlPlaneCheck {
        occurrences: occurrences.map(|occurrences| occurrences.nodes.len()),
        layout: layout.map(|layout| if layout.edited { "edited" } else { "exact" }),
    })
}

// ---------- Semantic identities: declarations, binders, roles, resolutions ----------

const RML_KEYWORDS: &[&str] = &[
    "lambda", "Pi", "fresh", "in", "subst", "apply", "type", "of", "has", "probability", "with",
    "proof", "range", "valence", "namespace", "import", "as", "is", "?", "mode", "relation",
    "total", "coverage", "world", "inductive", "coinductive", "constructor", "define", "case",
    "measure", "lex", "terminating", "whnf", "nf", "normal-form", "template", "+", "-", "*", "/",
    "<", "<=", "=", "!=", "and", "or", "not", "both", "neither", "nor", "rule", "premise",
    "conclusion", "assumption", "proof-assumption", "linked-fact", "axiom", "proof-object",
    "theorem", "step", "substitution", "substitute", "rebind", "theory", "linked-program",
    "foundation", "linked-rewrite", "linked-inference", "forall", "exists", "Type", "Prop",
];

fn is_literal(term: &str) -> bool {
    let unsigned = term.strip_prefix('-').unwrap_or(term);
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    match unsigned.split_once('.') {
        None => digits(unsigned),
        Some((whole, fraction)) => (whole.is_empty() || digits(whole)) && digits(fraction),
    }
}

fn is_name(term: &str) -> bool {
    !RML_KEYWORDS.contains(&term) && !is_literal(term)
}

// `/^\?./u`: a question mark followed by a code point other than a line terminator.
fn is_pattern_name(term: &str) -> bool {
    term.strip_prefix('?')
        .and_then(|rest| rest.chars().next())
        .is_some_and(|next| !matches!(next, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
}

fn starts_uppercase(term: &str) -> bool {
    term.chars().next().is_some_and(char::is_uppercase)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlDeclaration {
    pub kind: String,
    pub name: String,
    pub site: String,
    pub form: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlBinder {
    pub kind: String,
    pub name: String,
    pub site: String,
    pub scope: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlRole {
    pub role: String,
    pub owner: String,
    pub nodes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlResolution {
    pub address: String,
    pub name: String,
    pub status: String,
    pub targets: Vec<String>,
}

/// Address-keyed RML identities, identical in shape to the JavaScript description.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RmlSemantics {
    pub declarations: Vec<RmlDeclaration>,
    pub binders: Vec<RmlBinder>,
    pub roles: Vec<RmlRole>,
    pub references: Vec<RmlResolution>,
}

impl RmlDeclaration {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({ "kind": self.kind, "name": self.name, "site": self.site, "form": self.form })
    }
}

impl RmlBinder {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({ "kind": self.kind, "name": self.name, "site": self.site, "scope": self.scope })
    }
}

impl RmlRole {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({ "role": self.role, "owner": self.owner, "nodes": self.nodes })
    }
}

impl RmlResolution {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({ "address": self.address, "name": self.name, "status": self.status, "targets": self.targets })
    }
}

impl RmlSemantics {
    /// The shared JSON description used by both runtimes' corpus tests.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "declarations": self.declarations.iter().map(RmlDeclaration::to_json).collect::<Vec<_>>(),
            "binders": self.binders.iter().map(RmlBinder::to_json).collect::<Vec<_>>(),
            "roles": self.roles.iter().map(RmlRole::to_json).collect::<Vec<_>>(),
            "references": self.references.iter().map(RmlResolution::to_json).collect::<Vec<_>>(),
        })
    }

    fn sections(&self) -> Vec<(&'static str, Vec<serde_json::Value>)> {
        vec![
            ("declarations", self.declarations.iter().map(RmlDeclaration::to_json).collect()),
            ("binders", self.binders.iter().map(RmlBinder::to_json).collect()),
            ("roles", self.roles.iter().map(RmlRole::to_json).collect()),
            ("references", self.references.iter().map(RmlResolution::to_json).collect()),
        ]
    }
}

struct Param {
    site: usize,
    name: String,
    types: Vec<usize>,
}

struct Shape {
    kind: String,
    params: Vec<Param>,
    body: usize,
}

struct RuleScope {
    scope: String,
    binders: BTreeMap<String, String>,
}

struct Resolver<'a> {
    occurrences: &'a Occurrences,
    declaration_sites: BTreeSet<String>,
    named: BTreeMap<String, Vec<String>>,
    binders: Vec<RmlBinder>,
    references: Vec<RmlResolution>,
}

impl Resolver<'_> {
    fn binding_params(&self, binding: usize) -> Option<Vec<Param>> {
        let occurrences = self.occurrences;
        let node = occurrences.node(binding);
        let children = &node.children;
        if let Some(term) = &node.term {
            return (children.len() == 1).then(|| {
                vec![Param {
                    site: binding,
                    name: term.clone(),
                    types: vec![children[0]],
                }]
            });
        }
        if children.len() == 2
            && occurrences.is_plain(children[1])
            && !occurrences.term(children[1]).ends_with(',')
        {
            let typed = if occurrences.is_plain(children[0]) {
                starts_uppercase(occurrences.term(children[0]))
            } else {
                true
            };
            if typed {
                return Some(vec![Param {
                    site: children[1],
                    name: occurrences.term(children[1]).to_string(),
                    types: vec![children[0]],
                }]);
            }
        }
        if children.len() >= 4
            && children.len() % 2 == 0
            && children.iter().all(|child| occurrences.is_plain(*child))
        {
            let mut params = Vec::new();
            for index in (0..children.len()).step_by(2) {
                let (kind, name) = (children[index], children[index + 1]);
                let last = index + 2 == children.len();
                let term = occurrences.term(name);
                if !starts_uppercase(occurrences.term(kind)) || term.ends_with(',') == last {
                    return None;
                }
                params.push(Param {
                    site: name,
                    name: if last {
                        term.to_string()
                    } else {
                        term[..term.len() - 1].to_string()
                    },
                    types: vec![kind],
                });
            }
            return Some(params);
        }
        None
    }

    fn binder_shape(&self, index: usize) -> Option<Shape> {
        let occurrences = self.occurrences;
        let node = occurrences.node(index);
        let head = *node.children.first()?;
        if node.term.is_some() || !occurrences.is_plain(head) {
            return None;
        }
        let head_term = occurrences.term(head);
        let rest = &node.children[1..];
        if ["lambda", "Pi", "forall", "exists"].contains(&head_term) && rest.len() == 2 {
            if let Some(params) = self.binding_params(rest[0]) {
                if params.iter().all(|param| is_name(&param.name)) {
                    return Some(Shape {
                        kind: head_term.to_string(),
                        params,
                        body: rest[1],
                    });
                }
            }
        }
        if head_term == "fresh"
            && rest.len() == 3
            && occurrences.is_plain(rest[0])
            && is_name(occurrences.term(rest[0]))
            && occurrences.is_plain(rest[1])
            && occurrences.term(rest[1]) == "in"
        {
            return Some(Shape {
                kind: "fresh".to_string(),
                params: vec![Param {
                    site: rest[0],
                    name: occurrences.term(rest[0]).to_string(),
                    types: Vec::new(),
                }],
                body: rest[2],
            });
        }
        None
    }

    fn resolve_name(
        &mut self,
        index: usize,
        scope: &[(String, String)],
        rule: Option<&mut RuleScope>,
    ) {
        let occurrences = self.occurrences;
        let address = occurrences.address(index).to_string();
        let term = occurrences.term(index).to_string();
        if self.declaration_sites.contains(&address) || !is_name(&term) {
            return;
        }
        let lexical = scope
            .iter()
            .rev()
            .find(|(name, _)| *name == term)
            .map(|(_, site)| site.clone());
        if let Some(rule) = rule {
            if is_pattern_name(&term) {
                let Some(site) = lexical.or_else(|| rule.binders.get(&term).cloned()) else {
                    self.binders.push(RmlBinder {
                        kind: "pattern".to_string(),
                        name: term.clone(),
                        site: address.clone(),
                        scope: rule.scope.clone(),
                    });
                    rule.binders.insert(term, address);
                    return;
                };
                self.references.push(RmlResolution {
                    address,
                    name: term,
                    status: "bound".to_string(),
                    targets: vec![site],
                });
                return;
            }
        }
        if let Some(site) = lexical {
            self.references.push(RmlResolution {
                address,
                name: term,
                status: "bound".to_string(),
                targets: vec![site],
            });
            return;
        }
        let sites = self.named.get(&term).cloned().unwrap_or_default();
        let status = match sites.len() {
            0 => "free",
            1 => "global",
            _ => "ambiguous",
        };
        self.references.push(RmlResolution {
            address,
            name: term,
            status: status.to_string(),
            targets: sites,
        });
    }

    fn visit(&mut self, index: usize, scope: &[(String, String)], mut rule: Option<&mut RuleScope>) {
        let occurrences = self.occurrences;
        let node = occurrences.node(index);
        if node.children.is_empty() {
            if node.term.is_some() {
                self.resolve_name(index, scope, rule);
            }
            return;
        }
        if let Some(shape) = self.binder_shape(index) {
            let mut inner = scope.to_vec();
            for param in shape.params {
                for kind in &param.types {
                    self.visit(*kind, scope, rule.as_deref_mut());
                }
                let site = occurrences.address(param.site).to_string();
                self.binders.push(RmlBinder {
                    kind: shape.kind.clone(),
                    name: param.name.clone(),
                    site: site.clone(),
                    scope: occurrences.address(index).to_string(),
                });
                inner.push((param.name, site));
            }
            self.visit(shape.body, &inner, rule);
            return;
        }
        for child in &node.children {
            self.visit(*child, scope, rule.as_deref_mut());
        }
    }
}

/// Recompute RML semantic identities from the occurrence tree. Pure; deterministic in both runtimes.
fn resolve_occurrences(occurrences: &Occurrences) -> RmlSemantics {
    let mut declarations = Vec::new();
    let mut declaration_sites = BTreeSet::new();
    for (root, kind) in &occurrences.forms {
        let node = occurrences.node(*root);
        if let Some(term) = &node.term {
            declarations.push(RmlDeclaration {
                kind: "definition".to_string(),
                name: term.clone(),
                site: node.address.clone(),
                form: node.address.clone(),
            });
            declaration_sites.insert(node.address.clone());
        } else if ["theory", "rule", "assumption", "proof"].contains(&kind.as_str()) {
            if let Some(&name) = node.children.get(1) {
                if occurrences.is_plain(name) && is_name(occurrences.term(name)) {
                    declarations.push(RmlDeclaration {
                        kind: kind.clone(),
                        name: occurrences.term(name).to_string(),
                        site: occurrences.address(name).to_string(),
                        form: node.address.clone(),
                    });
                    declaration_sites.insert(occurrences.address(name).to_string());
                }
            }
        }
    }
    let mut roles = Vec::new();
    let mut theory: Option<usize> = None;
    let role = |role: &str, owner: &str, nodes: Vec<String>| RmlRole {
        role: role.to_string(),
        owner: owner.to_string(),
        nodes,
    };
    for (root, kind) in &occurrences.forms {
        let node = occurrences.node(*root);
        if kind == "theory" {
            theory = Some(*root);
        } else if let Some(theory) = theory {
            roles.push(role(
                "theory-member",
                occurrences.address(theory),
                vec![node.address.clone()],
            ));
        }
        let after = if node
            .children
            .get(1)
            .is_some_and(|child| declaration_sites.contains(occurrences.address(*child)))
        {
            2
        } else {
            1
        };
        for child in node.children.iter().skip(after) {
            let child_node = occurrences.node(*child);
            let address = child_node.address.clone();
            match kind.as_str() {
                "rule" => {
                    let head = child_node
                        .children
                        .first()
                        .filter(|head| occurrences.is_plain(**head))
                        .map(|head| occurrences.term(*head));
                    let name = match head {
                        Some("premise") => "premise",
                        Some("conclusion") => "conclusion",
                        _ => "component",
                    };
                    roles.push(role(name, &node.address, vec![address]));
                }
                "proof" => roles.push(role("proof-step", &node.address, vec![address])),
                "assumption" => roles.push(role("statement", &node.address, vec![address])),
                "substitution" => {
                    if child_node.term.is_none() && child_node.children.len() == 2 {
                        roles.push(role(
                            "substitution-entry",
                            &node.address,
                            child_node
                                .children
                                .iter()
                                .map(|entry| occurrences.address(*entry).to_string())
                                .collect(),
                        ));
                    } else {
                        roles.push(role("component", &node.address, vec![address]));
                    }
                }
                _ => {}
            }
        }
    }
    let mut named: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for declaration in &declarations {
        named
            .entry(declaration.name.clone())
            .or_default()
            .push(declaration.site.clone());
    }
    let mut resolver = Resolver {
        occurrences,
        declaration_sites,
        named,
        binders: Vec::new(),
        references: Vec::new(),
    };
    for (root, kind) in &occurrences.forms {
        let mut rule = (kind == "rule").then(|| RuleScope {
            scope: occurrences.address(*root).to_string(),
            binders: BTreeMap::new(),
        });
        resolver.visit(*root, &[], rule.as_mut());
    }
    RmlSemantics {
        declarations,
        binders: resolver.binders,
        roles,
        references: resolver.references,
    }
}

/// Compute semantic identities from syntax without writing them.
/// # Errors
/// Rejects malformed syntax or a shared syntax DAG without unique addresses.
pub fn compute_rml_semantics(network: &LinkNetwork) -> Result<RmlSemantics, String> {
    Ok(resolve_occurrences(&syntax_occurrences(network)?))
}

fn materialize(network: &mut LinkNetwork, occurrences: &Occurrences, semantics: &RmlSemantics) -> LinkId {
    let node = |address: &str| occurrences.id_at(address).expect("resolved address");
    let mut records: BTreeMap<String, LinkId> = BTreeMap::new();
    let mut ids = Vec::new();
    for item in &semantics.declarations {
        let term = format!("{}:{}", item.kind, item.name);
        let id = insert_as(network, LinkType::Semantic, "declaration", Some(&term), &[node(&item.site), node(&item.form)]);
        records.insert(item.site.clone(), id);
        ids.push(id);
    }
    for item in &semantics.binders {
        let term = format!("{}:{}", item.kind, item.name);
        let id = insert_as(network, LinkType::Semantic, "binder", Some(&term), &[node(&item.site), node(&item.scope)]);
        records.insert(item.site.clone(), id);
        ids.push(id);
    }
    for item in &semantics.roles {
        let mut references = vec![node(&item.owner)];
        references.extend(item.nodes.iter().map(|address| node(address)));
        ids.push(insert_as(network, LinkType::Semantic, "role", Some(&item.role), &references));
    }
    for item in &semantics.references {
        let mut references = vec![node(&item.address)];
        references.extend(item.targets.iter().filter_map(|site| records.get(site).copied()));
        ids.push(insert_as(network, LinkType::Semantic, "resolution", Some(&item.status), &references));
    }
    insert_as(network, LinkType::Semantic, "semantics", Some(RML_STRUCTURE_SCHEMA), &ids)
}

/// Resolution stage: write checked declaration, binder, role and resolution identities.
/// # Errors
/// Rejects malformed syntax, a shared syntax DAG, or an already resolved network.
pub fn resolve_rml_structure(network: &mut LinkNetwork) -> Result<RmlSemantics, String> {
    if !own_links(network, LinkType::Semantic, "semantics").is_empty() {
        return Err("RML semantic identities are already attached".into());
    }
    let occurrences = syntax_occurrences(network)?;
    let semantics = resolve_occurrences(&occurrences);
    materialize(network, &occurrences, &semantics);
    Ok(semantics)
}

fn first_difference(stored: &RmlSemantics, expected: &RmlSemantics) -> Option<String> {
    for ((section, left), (_, right)) in stored.sections().into_iter().zip(expected.sections()) {
        for index in 0..left.len().max(right.len()) {
            let stored = left.get(index).cloned().unwrap_or(serde_json::Value::Null);
            let required = right.get(index).cloned().unwrap_or(serde_json::Value::Null);
            if stored != required {
                return Some(format!(
                    "{section}[{index}]: stored {stored}, resolution requires {required}"
                ));
            }
        }
    }
    None
}

/// Read stored identities and check them against fresh resolution of the syntax.
/// Returns `None` when the resolution stage has not run. Never trusts stored links.
/// # Errors
/// Rejects dangling, forged, contradictory, or wrong-binder identities.
pub fn rml_semantic_identities(network: &LinkNetwork) -> Result<Option<RmlSemantics>, String> {
    let roots = own_links(network, LinkType::Semantic, "semantics");
    if roots.is_empty() {
        return Ok(None);
    }
    if roots.len() > 1 || roots[0].metadata().term() != Some(RML_STRUCTURE_SCHEMA) {
        return Err("Expected one supported RML semantic root".into());
    }
    let occurrences = syntax_occurrences(network)?;
    let address = |id: LinkId, record: LinkId| -> Result<String, String> {
        occurrences
            .by_id
            .get(&id)
            .map(|index| occurrences.address(*index).to_string())
            .ok_or_else(|| {
                format!(
                    "Dangling or forged RML semantic identity {}: {} is not a syntax occurrence",
                    record.as_u64(),
                    id.as_u64()
                )
            })
    };
    let mut stored = RmlSemantics::default();
    let mut sites: BTreeMap<LinkId, (&'static str, String)> = BTreeMap::new();
    let records = roots[0].references().to_vec();
    for id in &records {
        let link = network.link(*id);
        let references = link.map(Link::references).unwrap_or_default();
        let term = link.and_then(|link| link.metadata().term()).unwrap_or_default();
        if own(link, LinkType::Semantic, "declaration") || own(link, LinkType::Semantic, "binder") {
            let declaration = own(link, LinkType::Semantic, "declaration");
            let kind_name = term.find(':').filter(|at| *at >= 1).map(|at| (&term[..at], &term[at + 1..]));
            let Some((kind, name)) = kind_name.filter(|_| references.len() == 2) else {
                return Err(format!(
                    "Invalid RML {} identity {}",
                    if declaration { "declaration" } else { "binder" },
                    id.as_u64()
                ));
            };
            let site = address(references[0], *id)?;
            let other = address(references[1], *id)?;
            if declaration {
                sites.insert(*id, ("declaration", site.clone()));
                stored.declarations.push(RmlDeclaration {
                    kind: kind.to_string(),
                    name: name.to_string(),
                    site,
                    form: other,
                });
            } else {
                sites.insert(*id, ("binder", site.clone()));
                stored.binders.push(RmlBinder {
                    kind: kind.to_string(),
                    name: name.to_string(),
                    site,
                    scope: other,
                });
            }
        } else if own(link, LinkType::Semantic, "role") {
            if references.len() < 2 {
                return Err(format!("Invalid RML role identity {}", id.as_u64()));
            }
            stored.roles.push(RmlRole {
                role: term.to_string(),
                owner: address(references[0], *id)?,
                nodes: references[1..]
                    .iter()
                    .map(|reference| address(*reference, *id))
                    .collect::<Result<Vec<_>, _>>()?,
            });
        } else if !own(link, LinkType::Semantic, "resolution") {
            return Err(format!("Unsupported RML semantic record {}", id.as_u64()));
        }
    }
    for id in &records {
        let link = network.link(*id);
        if !own(link, LinkType::Semantic, "resolution") {
            continue;
        }
        let references = link.map(Link::references).unwrap_or_default();
        let status = link.and_then(|link| link.metadata().term()).unwrap_or_default();
        let Some(occurrence) = references.first() else {
            return Err(format!("Invalid RML resolution identity {}", id.as_u64()));
        };
        let at = address(*occurrence, *id)?;
        let mut targets = Vec::new();
        for reference in &references[1..] {
            let Some((kind, site)) = sites.get(reference) else {
                return Err(format!(
                    "Dangling or forged RML semantic identity {}: {} is not a declaration or binder record",
                    id.as_u64(),
                    reference.as_u64()
                ));
            };
            if (status == "bound") != (*kind == "binder") {
                return Err(format!(
                    "RML resolution {} status {status} contradicts its {kind} target",
                    id.as_u64()
                ));
            }
            targets.push(site.clone());
        }
        let name = occurrences
            .by_address
            .get(&at)
            .map(|index| occurrences.term(*index).to_string())
            .unwrap_or_default();
        stored.references.push(RmlResolution {
            address: at,
            name,
            status: status.to_string(),
            targets,
        });
    }
    let expected = resolve_occurrences(&occurrences);
    if let Some(difference) = first_difference(&stored, &expected) {
        return Err(format!("RML semantic identity mismatch in {difference}"));
    }
    Ok(Some(expected))
}

// ---------- Stages ----------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlRepresentationStages {
    pub schema: &'static str,
    pub preservation: &'static str,
    pub exact_source: &'static str,
    pub provenance: Option<RmlProvenance>,
    pub parsing: &'static str,
    pub resolution: &'static str,
    pub open_references: usize,
    pub elaboration: &'static str,
    pub execution: &'static str,
    pub verification: &'static str,
    pub diagnostic: Option<String>,
}

fn exact_source_state(
    network: &LinkNetwork,
    provenance: Option<&RmlProvenance>,
) -> Result<&'static str, String> {
    if layout_refusal(network).is_some() {
        return Ok("refused");
    }
    if own_links(network, LinkType::Trivia, "layout").is_empty() {
        return Ok("absent");
    }
    let occurrences = syntax_occurrences(network)?;
    let layout = read_layout(network, &bindable_list(network, &occurrences))?
        .ok_or("No RML exact source layout")?;
    let exact: String = layout
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect();
    Ok(match provenance {
        None => "unverified",
        Some(provenance)
            if source_provenance(&exact, None)
                .starts_with(&format!("source-sha256:{} ", provenance.source_sha256)) =>
        {
            "verified"
        }
        Some(_) if layout.edited => "edited",
        Some(_) => "provenance-mismatch",
    })
}

pub fn rml_representation_stages(network: &LinkNetwork) -> RmlRepresentationStages {
    let mut diagnostic = rml_structured_document(network)
        .err()
        .map(|error| error.to_string());
    let parsing = if diagnostic.is_some() {
        "rejected"
    } else {
        "parsed"
    };
    let source_tokens = network
        .links()
        .any(|link| link.metadata().link_type() == Some(LinkType::Token));
    let mut exact_source = "absent";
    let mut resolution = "not-run";
    let mut open_references = 0;
    let mut provenance = None;
    if parsing == "parsed" {
        match rml_provenance(network)
            .and_then(|found| exact_source_state(network, found.as_ref()).map(|state| (state, found)))
        {
            Ok((state, found)) => {
                exact_source = state;
                provenance = found;
            }
            Err(error) => {
                exact_source = "rejected";
                provenance = rml_provenance(network).ok().flatten();
                if diagnostic.is_none() {
                    diagnostic = Some(error);
                }
            }
        }
        match rml_semantic_identities(network) {
            Ok(Some(semantics)) => {
                open_references = semantics
                    .references
                    .iter()
                    .filter(|item| item.status == "free" || item.status == "ambiguous")
                    .count();
                resolution = if open_references > 0 {
                    "resolved-with-open-references"
                } else {
                    "resolved"
                };
            }
            Ok(None) => {}
            Err(error) => {
                resolution = "rejected";
                if diagnostic.is_none() {
                    diagnostic = Some(error);
                }
            }
        }
    }
    let preservation = if source_tokens {
        "source-token-plane"
    } else if matches!(
        exact_source,
        "verified" | "edited" | "unverified" | "provenance-mismatch"
    ) {
        "exact-source-structure"
    } else {
        "canonical-structure"
    };
    RmlRepresentationStages {
        schema: RML_STRUCTURE_SCHEMA,
        preservation,
        exact_source,
        provenance,
        parsing,
        resolution,
        open_references,
        elaboration: "not-run",
        execution: "not-run",
        verification: "not-run",
        diagnostic,
    }
}

// ---------- Capture-checked binding rename ----------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlRenameError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RmlBindingEdit {
    pub address: String,
    pub from: String,
    pub to: String,
    pub line: Option<usize>,
    pub col: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct RmlRename {
    pub network: LinkNetwork,
    pub source: Option<String>,
    pub canonical: String,
    pub edits: Vec<RmlBindingEdit>,
    pub semantics: RmlSemantics,
}

fn rename_error(code: &'static str, message: impl Into<String>) -> RmlRenameError {
    RmlRenameError {
        code,
        message: message.into(),
    }
}

fn compare_address(left: &str, right: &str) -> std::cmp::Ordering {
    let parse = |address: &str| -> Vec<u64> {
        address
            .split('.')
            .map(|part| part.parse().unwrap_or(0))
            .collect()
    };
    parse(left).cmp(&parse(right))
}

fn renamed_tree(tree: &ParsedLink, address: &str, renames: &BTreeMap<String, String>) -> ParsedLink {
    ParsedLink {
        id: renames.get(address).cloned().or_else(|| tree.id.clone()),
        values: tree
            .values
            .iter()
            .enumerate()
            .map(|(index, child)| renamed_tree(child, &format!("{address}.{index}"), renames))
            .collect(),
        compound: tree.compound,
    }
}

/// Rename one declaration or binder (by occurrence address) and every reference resolved to it.
/// The result is accepted only when fresh resolution of the edited structure assigns every
/// occurrence the same status and targets: capture and ambiguity are refused, never repaired.
/// # Errors
/// `RML_RENAME_NOT_BINDING`, `RML_RENAME_INVALID_NAME`, `RML_RENAME_AMBIGUOUS`,
/// `RML_RENAME_CAPTURE`, or `RML_RENAME_INVALID_STRUCTURE`.
pub fn rename_rml_binding(
    network: &LinkNetwork,
    site: &str,
    replacement: &str,
) -> Result<RmlRename, RmlRenameError> {
    let structure = |error: String| rename_error("RML_RENAME_INVALID_STRUCTURE", error);
    let occurrences = syntax_occurrences(network).map_err(structure)?;
    let semantics = match rml_semantic_identities(network).map_err(structure)? {
        Some(semantics) => semantics,
        None => resolve_occurrences(&occurrences),
    };
    let target = semantics
        .binders
        .iter()
        .find(|item| item.site == site)
        .map(|item| (item.kind.clone(), item.name.clone()))
        .or_else(|| {
            semantics
                .declarations
                .iter()
                .find(|item| item.site == site)
                .map(|item| (item.kind.clone(), item.name.clone()))
        });
    let Some((kind, old_name)) = target else {
        return Err(rename_error(
            "RML_RENAME_NOT_BINDING",
            format!("No RML declaration or binder at {site}"),
        ));
    };
    let pattern = kind == "pattern";
    let name = replacement.to_string();
    if name.is_empty() || !is_name(&name) || is_pattern_name(&name) != pattern || name.ends_with(',') {
        return Err(rename_error(
            "RML_RENAME_INVALID_NAME",
            format!(
                "{} cannot name {}",
                json_string(&name),
                if pattern { "a rule pattern variable" } else { "an RML binding" }
            ),
        ));
    }
    if semantics
        .references
        .iter()
        .any(|item| item.status == "ambiguous" && item.targets.iter().any(|target| target == site))
    {
        return Err(rename_error(
            "RML_RENAME_AMBIGUOUS",
            format!("References to {old_name} are ambiguous"),
        ));
    }
    let site_term = occurrences
        .by_address
        .get(site)
        .map(|index| occurrences.term(*index).to_string())
        .unwrap_or_default();
    let mut renames: BTreeMap<String, String> = BTreeMap::new();
    let site_name = if site_term.strip_suffix(',') == Some(old_name.as_str()) {
        format!("{name},")
    } else {
        name.clone()
    };
    renames.insert(site.to_string(), site_name);
    for item in &semantics.references {
        if item.targets.len() == 1 && item.targets[0] == site {
            renames.insert(item.address.clone(), name.clone());
        }
    }
    let forms = rml_structured_document(network).map_err(|error| structure(error.to_string()))?;
    let renamed: Vec<(LinoForm, ParsedLink)> = forms
        .iter()
        .enumerate()
        .map(|(index, (form, link))| (form.clone(), renamed_tree(link, &index.to_string(), &renames)))
        .collect();
    let mut edited = LinkNetwork::new();
    register_rml_extension(&mut edited);
    let document = insert_forms(&mut edited, &renamed);
    let after = syntax_occurrences(&edited).map_err(structure)?;
    let resolved = resolve_occurrences(&after);
    let mut expected = semantics.clone();
    for item in &mut expected.declarations {
        if item.site == site {
            item.name = name.clone();
        }
    }
    for item in &mut expected.binders {
        if item.site == site {
            item.name = name.clone();
        }
    }
    for item in &mut expected.references {
        if renames.contains_key(&item.address) {
            item.name = name.clone();
        }
    }
    if resolved != expected {
        let captured = resolved
            .references
            .iter()
            .enumerate()
            .find(|(index, item)| expected.references.get(*index) != Some(*item))
            .map(|(_, item)| format!("{} at {}", item.name, item.address));
        return Err(rename_error(
            "RML_RENAME_CAPTURE",
            format!(
                "Renaming {old_name} to {name} changes the binding of {}",
                captured.unwrap_or_else(|| "an occurrence".to_string())
            ),
        ));
    }
    let layout_before = if own_links(network, LinkType::Trivia, "layout").is_empty() {
        None
    } else {
        read_layout(network, &bindable_list(network, &occurrences)).map_err(structure)?
    };
    let positions = layout_before
        .as_ref()
        .map(layout_positions)
        .unwrap_or_default();
    let provenance = rml_provenance(network).map_err(structure)?;
    let mut source = None;
    if let Some(layout) = &layout_before {
        let segments: Vec<Segment> = layout
            .segments
            .iter()
            .map(|segment| {
                let Some(node) = segment.node else {
                    return segment.clone();
                };
                let at = occurrences
                    .by_id
                    .get(&node)
                    .map(|index| occurrences.address(*index).to_string())
                    .unwrap_or_default();
                let new_node = after.id_at(&at);
                match renames.get(&at) {
                    None => Segment {
                        node: new_node,
                        ..segment.clone()
                    },
                    Some(term) => Segment {
                        token: true,
                        start: None,
                        text: escape_reference(term),
                        value: Some(term.clone()),
                        node: new_node,
                    },
                }
            })
            .collect();
        insert_layout(&mut edited, &segments);
        let exact = emit_rml_exact_source(&edited).map_err(structure)?;
        let term = source_provenance(
            &exact,
            provenance.as_ref().map(|provenance| provenance.source_sha256.as_str()),
        );
        insert_as(&mut edited, LinkType::Semantic, "provenance", Some(&term), &[document]);
        source = Some(exact);
    }
    materialize(&mut edited, &after, &resolved);
    let mut edits: Vec<RmlBindingEdit> = renames
        .iter()
        .filter_map(|(address, term)| {
            let index = *occurrences.by_address.get(address)?;
            let from = occurrences.term(index).to_string();
            if from == *term {
                return None;
            }
            let position = positions.get(&occurrences.node(index).id).copied();
            Some(RmlBindingEdit {
                address: address.clone(),
                from,
                to: term.clone(),
                line: position.map(|(line, _)| line),
                col: position.map(|(_, col)| col),
            })
        })
        .collect();
    edits.sort_by(|left, right| compare_address(&left.address, &right.address));
    let canonical = emit_rml_from_structure(&edited).map_err(|error| structure(error.to_string()))?;
    Ok(RmlRename {
        network: edited,
        source,
        canonical,
        edits,
        semantics: resolved,
    })
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
