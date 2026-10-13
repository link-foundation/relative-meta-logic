//! Rust mirror of the RML translation-certificate checker's integrity layer.
//!
//! The JavaScript checker (`js/src/rml-certified-translation.mjs`) re-derives a
//! certificate from the preserved source through the temporarily vendored
//! meta-language PR #201 frontends. Those frontends are not vendored in Rust,
//! so this mirror checks everything that does not need re-import: the Links
//! syntax and canonical digest, authority grants, translator pin, source,
//! target and intermediate identities, span hashes of every correspondence,
//! the seven preservation dimensions, the observation digest, the discharge
//! rules of every obligation and the verdict counts. It never consults a Lean
//! or Rocq kernel and never upgrades an oracle result to an RML discharge.
use crate::lino_frontend::{parse_lino_link_document, ParsedLink};
use sha2::{Digest, Sha256};

pub const CERTIFIED_TRANSLATION_SCHEMA: &str = "rml:translation-certificate:1";
pub const TRANSLATION_REFUSAL_SCHEMA: &str = "rml:translation-refusal:1";
pub const CERTIFIED_LANGUAGES: &[&str] = &["JavaScript", "Rust", "Lean", "Rocq"];
pub const PRESERVATION_DIMENSIONS: &[&str] = &[
    "behavior",
    "effects",
    "ownership",
    "types",
    "universes",
    "assumptions",
    "proof-obligations",
];
pub const CERTIFIED_AUTHORITY: &[(&str, &str)] = &[
    ("macros", "none"),
    ("traits", "none"),
    ("runtime", "none"),
    ("external-kernels", "oracle-only"),
    ("proof-authority", "rml"),
];
const OBLIGATION_STATUSES: &[&str] = &["discharged", "open", "assumed", "refuted"];
const ORACLE_ONLY: &[&str] = &[
    "target-kernel-oracle",
    "bounded-runtime-check-not-proof",
    "native-oracle-ci",
    "unevaluated",
];

/// A Links value as the certificate reader sees it: an atom or an ordered list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinksNode {
    Atom(String),
    List(Vec<LinksNode>),
}

impl LinksNode {
    pub fn atom(&self) -> Option<&str> {
        match self {
            LinksNode::Atom(text) => Some(text),
            LinksNode::List(_) => None,
        }
    }

    pub fn items(&self) -> &[LinksNode] {
        match self {
            LinksNode::List(items) => items,
            LinksNode::Atom(_) => &[],
        }
    }

    /// The list's first atom, the section name in a certificate.
    pub fn head(&self) -> Option<&str> {
        self.items().first().and_then(LinksNode::atom)
    }

    /// The first nested list whose head is `name`.
    pub fn section(&self, name: &str) -> Option<&LinksNode> {
        self.items().iter().find(|item| item.head() == Some(name))
    }

    /// Every nested list whose head is `name`.
    pub fn sections<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a LinksNode> + 'a {
        self.items().iter().filter(move |item| item.head() == Some(name))
    }

    /// The single atom value of `(name value)`.
    pub fn field(&self, name: &str) -> Option<&str> {
        let section = self.section(name)?;
        match section.items() {
            [_, value] => value.atom(),
            _ => None,
        }
    }
}

/// One rejection reason, with the same codes as the JavaScript checker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CertificateError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CertificateReport {
    pub valid: bool,
    pub errors: Vec<CertificateError>,
}

impl CertificateReport {
    pub fn codes(&self) -> Vec<&'static str> {
        self.errors.iter().map(|error| error.code).collect()
    }
}

/// The external facts an integrity check compares a certificate with.
#[derive(Debug, Clone, Copy)]
pub struct CertificateInputs<'a> {
    pub source: &'a str,
    pub target: Option<&'a str>,
    pub intermediate: Option<&'a str>,
    pub translator_commit: &'a str,
    pub translator_lock_sha256: &'a str,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(bytes);
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// JavaScript `encodeURIComponent`.
fn encode_uri_component(text: &str) -> String {
    let mut encoded = String::new();
    for byte in text.bytes() {
        let character = byte as char;
        if byte.is_ascii_alphanumeric() || "-_.!~*'()".contains(character) {
            encoded.push(character);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// JavaScript `decodeURIComponent` for well-formed UTF-8 escapes.
fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = text.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(pair, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn atom_text(text: &str) -> String {
    let plain = !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-');
    if plain {
        return text.to_string();
    }
    let newline = text.contains('\r') || text.contains('\n');
    if !text.contains('"') && !newline {
        return format!("\"{text}\"");
    }
    if !text.contains('\'') && !newline {
        return format!("'{text}'");
    }
    // encodeURIComponent keeps parentheses, which would unbalance the Links form.
    let encoded = encode_uri_component(text).replace('(', "%28").replace(')', "%29");
    format!("(percent-encoded {encoded})")
}

fn serialize_indented(node: &LinksNode, indent: &str) -> String {
    match node {
        LinksNode::Atom(text) => atom_text(text),
        LinksNode::List(items) => {
            let flat = format!(
                "({})",
                items
                    .iter()
                    .map(|item| serialize_indented(item, ""))
                    .collect::<Vec<_>>()
                    .join(" ")
            );
            if utf16_len(&flat) <= 100 || items.iter().all(|item| item.atom().is_some()) {
                return flat;
            }
            let inner = format!("{indent}  ");
            let head = serialize_indented(&items[0], "");
            let rest = items[1..]
                .iter()
                .map(|item| format!("{inner}{}", serialize_indented(item, &inner)))
                .collect::<Vec<_>>()
                .join("\n");
            format!("({head}\n{rest})")
        }
    }
}

/// Canonical Links serialization, byte-identical to the JavaScript `serializeLinks`.
pub fn serialize_links(node: &LinksNode) -> String {
    serialize_indented(node, "")
}

fn plain(link: &ParsedLink) -> LinksNode {
    if link.values.is_empty() {
        return LinksNode::Atom(link.id.clone().unwrap_or_default());
    }
    let mut items = Vec::with_capacity(link.values.len() + 1);
    if let Some(id) = &link.id {
        items.push(LinksNode::Atom(id.clone()));
    }
    items.extend(link.values.iter().map(plain));
    if let [LinksNode::Atom(head), LinksNode::Atom(value)] = items.as_slice() {
        if head == "percent-encoded" {
            if let Some(decoded) = decode_uri_component(value) {
                return LinksNode::Atom(decoded);
            }
        }
    }
    LinksNode::List(items)
}

/// Parse a Links document into nested lists of atoms.
pub fn read_links_document(text: &str) -> Result<Vec<LinksNode>, String> {
    parse_lino_link_document(text)
        .map(|forms| forms.iter().map(|(_, link)| plain(link)).collect())
        .map_err(|error| error.to_string())
}

fn digest_ok(form: &LinksNode) -> bool {
    let items = form.items();
    let Some(last) = items.last() else {
        return false;
    };
    if last.head() != Some("digest") {
        return false;
    }
    let digest = last.items();
    if digest.len() != 3 || digest[1].atom() != Some("sha256") {
        return false;
    }
    let body = LinksNode::List(items[..items.len() - 1].to_vec());
    digest[2].atom() == Some(sha256_hex(serialize_links(&body).as_bytes()).as_str())
}

fn authority_ok(form: &LinksNode) -> bool {
    let Some(authority) = form.section("authority") else {
        return false;
    };
    let grants = &authority.items()[1..];
    grants.len() == CERTIFIED_AUTHORITY.len()
        && grants
            .iter()
            .zip(CERTIFIED_AUTHORITY)
            .all(|(grant, (key, value))| {
                grant.items().len() == 2
                    && grant.head() == Some(*key)
                    && grant.items()[1].atom() == Some(*value)
            })
}

fn utf16_slice(units: &[u16], start: usize, end: usize) -> Option<String> {
    if start > end || end > units.len() {
        return None;
    }
    String::from_utf16(&units[start..end]).ok()
}

fn parse_index(node: Option<&LinksNode>) -> Option<usize> {
    node.and_then(LinksNode::atom)?.parse().ok()
}

/// Check a span record `(span start end) (bytes start end) (span-sha256 hash)` against the source.
fn span_ok(owner: &LinksNode, source: &str, units: &[u16]) -> bool {
    let Some(span) = owner.section("span") else {
        return true;
    };
    if span.items().get(1).and_then(LinksNode::atom) == Some("unlocated") {
        return true;
    }
    let (Some(start), Some(end)) = (parse_index(span.items().get(1)), parse_index(span.items().get(2))) else {
        return false;
    };
    let Some(text) = utf16_slice(units, start, end) else {
        return false;
    };
    let Some(prefix) = utf16_slice(units, 0, start) else {
        return false;
    };
    let bytes = owner.section("bytes");
    let byte_start = parse_index(bytes.and_then(|node| node.items().get(1)));
    let byte_end = parse_index(bytes.and_then(|node| node.items().get(2)));
    byte_start == Some(prefix.len())
        && byte_end == Some(prefix.len() + text.len())
        && owner.field("span-sha256") == Some(sha256_hex(text.as_bytes()).as_str())
}

fn source_ok(form: &LinksNode, source: &str) -> bool {
    let Some(section) = form.section("source") else {
        return false;
    };
    section.field("sha256") == Some(sha256_hex(source.as_bytes()).as_str())
        && section.field("bytes") == Some(source.len().to_string().as_str())
        && section.field("utf16") == Some(utf16_len(source).to_string().as_str())
}

fn reject(errors: &mut Vec<CertificateError>, code: &'static str, message: &str) {
    if !errors.iter().any(|error| error.code == code) {
        errors.push(CertificateError {
            code,
            message: message.to_string(),
        });
    }
}

fn read_single(text: &str, syntax: &'static str) -> Result<LinksNode, CertificateReport> {
    match read_links_document(text) {
        Ok(mut forms) if forms.len() == 1 && matches!(forms[0], LinksNode::List(_)) => Ok(forms.remove(0)),
        Ok(_) => Err(CertificateReport {
            valid: false,
            errors: vec![CertificateError {
                code: syntax,
                message: "expected exactly one form".to_string(),
            }],
        }),
        Err(message) => Err(CertificateReport {
            valid: false,
            errors: vec![CertificateError {
                code: syntax,
                message,
            }],
        }),
    }
}

/// Integrity-check a translation certificate against its source, target and intermediate.
pub fn check_certificate_integrity(certificate: &str, inputs: CertificateInputs<'_>) -> CertificateReport {
    let form = match read_single(certificate, "RML_CERT_SYNTAX") {
        Ok(form) => form,
        Err(report) => return report,
    };
    let mut errors = Vec::new();
    if form.head() != Some("translation-certificate") || form.field("schema") != Some(CERTIFIED_TRANSLATION_SCHEMA) {
        reject(&mut errors, "RML_CERT_SCHEMA", "not an rml:translation-certificate:1 document");
        return CertificateReport { valid: false, errors };
    }
    if !digest_ok(&form) {
        reject(&mut errors, "RML_CERT_DIGEST", "certificate digest does not match its canonical body");
    }
    if !authority_ok(&form) {
        reject(&mut errors, "RML_CERT_AUTHORITY", "certificate grants authority beyond none/oracle-only/rml");
    }
    let translator = form.section("translator");
    if translator.and_then(|node| node.field("commit")) != Some(inputs.translator_commit)
        || translator.and_then(|node| node.field("lock-sha256")) != Some(inputs.translator_lock_sha256)
    {
        reject(&mut errors, "RML_CERT_TRANSLATOR", "certificate was produced by a different or stale translator pin");
    }
    let source_language = form.section("source").and_then(|node| node.field("language"));
    let target_language = form.section("target").and_then(|node| node.field("language"));
    let pair_ok = matches!((source_language, target_language), (Some(from), Some(to))
        if from != to && CERTIFIED_LANGUAGES.contains(&from) && CERTIFIED_LANGUAGES.contains(&to));
    if !pair_ok {
        reject(&mut errors, "RML_CERT_LANGUAGE", "certificate names an unsupported language pair");
        return CertificateReport { valid: false, errors };
    }
    let intermediate = form.section("intermediate");
    if intermediate.and_then(|node| node.field("source-language")) != source_language {
        reject(&mut errors, "RML_CERT_SOURCE_LANGUAGE", "the intermediate records a different source language");
    }
    if !source_ok(&form, inputs.source) {
        reject(&mut errors, "RML_CERT_SOURCE_HASH", "the supplied source is not the certified source");
    }
    if let Some(target) = inputs.target {
        let section = form.section("target");
        if section.and_then(|node| node.field("sha256")) != Some(sha256_hex(target.as_bytes()).as_str())
            || section.and_then(|node| node.field("bytes")) != Some(target.len().to_string().as_str())
        {
            reject(&mut errors, "RML_CERT_TARGET_HASH", "the supplied target is not the certified target");
        }
    }
    if let Some(lino) = inputs.intermediate {
        if intermediate.and_then(|node| node.field("sha256")) != Some(sha256_hex(lino.as_bytes()).as_str()) {
            reject(&mut errors, "RML_CERT_INTERMEDIATE", "the supplied Links archive is not the certified intermediate");
        }
    }
    let units: Vec<u16> = inputs.source.encode_utf16().collect();
    let correspondence = form.section("correspondence");
    let constructs: Vec<&LinksNode> = correspondence
        .map(|node| node.sections("construct").collect())
        .unwrap_or_default();
    if constructs.is_empty() || constructs.iter().any(|construct| !span_ok(construct, inputs.source, &units)) {
        reject(&mut errors, "RML_CERT_CORRESPONDENCE", "a correspondence span does not identify the certified source text");
    }
    let declared: Vec<&str> = form
        .section("preservation")
        .map(|node| node.items()[1..].iter().filter_map(LinksNode::head).collect())
        .unwrap_or_default();
    if declared != PRESERVATION_DIMENSIONS {
        reject(&mut errors, "RML_CERT_PRESERVATION", "preservation contract must declare exactly the seven dimensions");
    }
    if let Some(observation) = form.section("observation") {
        let lines: Vec<&str> = observation
            .sections("line")
            .filter_map(|line| line.items().get(1).and_then(LinksNode::atom))
            .collect();
        if observation.field("lines-sha256") != Some(sha256_hex(lines.join("\n").as_bytes()).as_str()) {
            reject(&mut errors, "RML_CERT_OBSERVATION", "observation lines do not match their digest");
        }
    } else {
        reject(&mut errors, "RML_CERT_OBSERVATION", "certificate has no observation");
    }
    let obligations: Vec<&LinksNode> = form
        .section("obligations")
        .map(|node| node.sections("obligation").collect())
        .unwrap_or_default();
    let mut counts = [0usize; 4];
    for obligation in &obligations {
        let status = obligation.field("status").unwrap_or("");
        let by = obligation.field("by").unwrap_or("");
        let Some(index) = OBLIGATION_STATUSES.iter().position(|known| *known == status) else {
            reject(&mut errors, "RML_CERT_OBLIGATION_FORGED", "an obligation has an unknown status");
            continue;
        };
        counts[index] += 1;
        let discharged_by_rml = status != "discharged" || (by == "rml-evaluation" && obligation.field("closed") == Some("true"));
        let oracle_stays_open = !ORACLE_ONLY.contains(&by) || status == "open";
        let trust_stays_open = obligation.field("id") != Some("emitter-faithfulness") || status == "open";
        if !discharged_by_rml || !oracle_stays_open || !trust_stays_open {
            reject(&mut errors, "RML_CERT_OBLIGATION_FORGED", "an obligation claims a discharge RML did not perform");
        }
    }
    if !obligations.iter().any(|obligation| obligation.field("id") == Some("emitter-faithfulness")) {
        reject(&mut errors, "RML_CERT_OBLIGATION_DROPPED", "the emitter-faithfulness trust obligation is missing");
    }
    for construct in &constructs {
        if construct.field("kind") == Some("theorem") {
            let id = format!("theorem:{}", construct.field("source").unwrap_or(""));
            if !obligations.iter().any(|obligation| obligation.field("id") == Some(id.as_str())) {
                reject(&mut errors, "RML_CERT_OBLIGATION_DROPPED", "a source theorem has no obligation");
            }
        }
    }
    let verdict = form.section("verdict");
    let verdict_ok = OBLIGATION_STATUSES
        .iter()
        .zip(counts)
        .all(|(status, count)| verdict.and_then(|node| node.field(status)) == Some(count.to_string().as_str()));
    if !verdict_ok {
        reject(&mut errors, "RML_CERT_VERDICT", "verdict counts differ from the listed obligations");
    }
    CertificateReport {
        valid: errors.is_empty(),
        errors,
    }
}

/// Integrity-check a first-refusal receipt against the retained source.
pub fn check_refusal_integrity(receipt: &str, source: &str, translator_lock_sha256: &str) -> CertificateReport {
    let form = match read_single(receipt, "RML_REFUSAL_SYNTAX") {
        Ok(form) => form,
        Err(report) => return report,
    };
    let mut errors = Vec::new();
    if form.head() != Some("translation-refusal") || form.field("schema") != Some(TRANSLATION_REFUSAL_SCHEMA) {
        reject(&mut errors, "RML_REFUSAL_SCHEMA", "not a refusal receipt");
        return CertificateReport { valid: false, errors };
    }
    if !digest_ok(&form) {
        reject(&mut errors, "RML_REFUSAL_MISMATCH", "receipt digest does not match its canonical body");
    }
    if !authority_ok(&form) {
        reject(&mut errors, "RML_REFUSAL_MISMATCH", "receipt grants authority");
    }
    if form.section("translator").and_then(|node| node.field("lock-sha256")) != Some(translator_lock_sha256) {
        reject(&mut errors, "RML_REFUSAL_MISMATCH", "receipt was produced by a different translator pin");
    }
    let preserved = form.section("preserved-source");
    if !source_ok(&form, source)
        || preserved.and_then(|node| node.field("sha256")) != Some(sha256_hex(source.as_bytes()).as_str())
        || preserved.and_then(|node| node.field("status")) != Some("retained-unchanged")
    {
        reject(&mut errors, "RML_REFUSAL_MISMATCH", "the receipt does not retain this exact source");
    }
    if form.section("target").and_then(|node| node.field("status")) != Some("not-emitted") {
        reject(&mut errors, "RML_REFUSAL_MISMATCH", "a refusal must not emit a target");
    }
    let losses = form.section("losses");
    if losses.and_then(|node| node.section("whole-program")).is_none() {
        reject(&mut errors, "RML_REFUSAL_MISMATCH", "the receipt does not name the whole-program loss");
    }
    let units: Vec<u16> = source.encode_utf16().collect();
    match form.section("diagnostic") {
        Some(diagnostic) if diagnostic.field("message").is_some() && span_ok(diagnostic, source, &units) => {}
        _ => reject(&mut errors, "RML_REFUSAL_MISMATCH", "the diagnostic span does not identify the retained source"),
    }
    CertificateReport {
        valid: errors.is_empty(),
        errors,
    }
}
