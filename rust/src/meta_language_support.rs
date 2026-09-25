use crate::{evaluate, parse_lino, Diagnostic, LinoParseError, RunResult};
use meta_language::{
    LinkMetadata, LinkNetwork, LinkQuery, LinkType, ParseConfiguration, ProbabilisticTruthValue,
    Probability, ReplacementRule, SubstitutionRule, TranslationRule, TranslationRuleSet,
    TruthValue,
};

pub const RML_META_LANGUAGE: &str = "RML";
const JAVA_SCRIPT_LANGUAGE: &str = "JavaScript";

#[derive(Debug, Clone, PartialEq)]
pub struct RmlMetaLanguageParityReport {
    pub language: &'static str,
    pub reconstructed: String,
    pub network_link_count: usize,
    pub round_trip_ok: bool,
    pub direct_links: Vec<String>,
    pub meta_links: Vec<String>,
    pub link_parity_ok: bool,
    pub direct_results: Vec<RunResult>,
    pub meta_results: Vec<RunResult>,
    pub direct_diagnostics: Vec<Diagnostic>,
    pub meta_diagnostics: Vec<Diagnostic>,
    pub evaluation_parity_ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteReport {
    pub source: String,
    pub match_count: usize,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubstitutionSmokeReport {
    pub updated: usize,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TruthSmokeReport {
    pub conjunction: String,
    pub probability_basis_points: u16,
    pub probabilistic_and_basis_points: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MetaLanguageFeatureReport {
    pub package_name: &'static str,
    pub rml: RmlMetaLanguageParityReport,
    pub substitution: SubstitutionSmokeReport,
    pub translation: String,
    pub truth: TruthSmokeReport,
}

pub fn parse_rml_to_meta_language(source: &str) -> LinkNetwork {
    LinkNetwork::parse(source, RML_META_LANGUAGE, ParseConfiguration::default())
}

pub fn reconstruct_rml_from_meta_language(network: &LinkNetwork) -> String {
    network.reconstruct_text()
}

/// The top-level forms of RML source read back from its meta-language network.
///
/// # Errors
///
/// A [`LinoParseError`] when the reconstructed source is not valid LiNo.
pub fn parse_rml_links_via_meta_language(source: &str) -> Result<Vec<String>, LinoParseError> {
    parse_lino(&reconstruct_rml_from_meta_language(
        &parse_rml_to_meta_language(source),
    ))
}

/// Compare RML source read directly with the same source read back from its
/// meta-language network: forms, results, and diagnostics.
///
/// # Errors
///
/// A [`LinoParseError`] when either source is not valid LiNo.
pub fn rml_meta_language_parity_report(
    source: &str,
) -> Result<RmlMetaLanguageParityReport, LinoParseError> {
    let network = parse_rml_to_meta_language(source);
    let reconstructed = reconstruct_rml_from_meta_language(&network);
    let direct_links = parse_lino(source)?;
    let meta_links = parse_lino(&reconstructed)?;
    let direct = evaluate(source, None, None);
    let meta = evaluate(&reconstructed, None, None);
    let link_parity_ok = direct_links == meta_links;
    let evaluation_parity_ok =
        direct.results == meta.results && direct.diagnostics == meta.diagnostics;

    Ok(RmlMetaLanguageParityReport {
        language: RML_META_LANGUAGE,
        network_link_count: network.len(),
        round_trip_ok: reconstructed == source,
        reconstructed,
        direct_links,
        meta_links,
        link_parity_ok,
        direct_results: direct.results,
        meta_results: meta.results,
        direct_diagnostics: direct.diagnostics,
        meta_diagnostics: meta.diagnostics,
        evaluation_parity_ok,
    })
}

pub fn rewrite_javascript_identifier_via_meta_language(
    source: &str,
    from: &str,
    to: &str,
) -> Result<RewriteReport, String> {
    validate_javascript_identifier(from, "from")?;
    validate_javascript_identifier(to, "to")?;

    let mut network =
        LinkNetwork::parse(source, JAVA_SCRIPT_LANGUAGE, ParseConfiguration::default());
    let query =
        LinkQuery::from_sexpression(&format!("(identifier) @target\n(#eq? @target \"{from}\")"))
            .map_err(|error| error.to_string())?;
    let matches = network.find(&query);
    let report = network.replace(&matches, &ReplacementRule::captured_text("target", to));

    Ok(RewriteReport {
        source: network.reconstruct_text(),
        match_count: matches.len(),
        changed: !report.is_empty(),
    })
}

pub fn meta_language_substitution_smoke() -> SubstitutionSmokeReport {
    let mut network = LinkNetwork::new();
    let a = network.insert_point("a");
    let b = network.insert_point("b");
    let relation = network.insert_link([a], LinkMetadata::new().with_link_type(LinkType::Relation));
    let report = network.apply_substitution(&SubstitutionRule::new([a], [b]));
    let changed = network
        .link(relation)
        .and_then(|link| link.references().first().copied())
        .is_some_and(|reference| reference == b);

    SubstitutionSmokeReport {
        updated: report.updated().len(),
        changed,
    }
}

pub fn render_meta_language_translation_smoke(source: &str) -> String {
    let network = parse_rml_to_meta_language(source);
    let rules = TranslationRuleSet::new("rml-smoke").with_rule(
        TranslationRule::new(
            "any-token",
            LinkQuery::by_type(LinkType::Token).with_term("("),
        )
        .with_template("text", "translated"),
    );

    network.reconstruct_text_as_with_rules("text", ParseConfiguration::default(), &rules)
}

pub fn meta_language_truth_smoke() -> TruthSmokeReport {
    let half = ProbabilisticTruthValue::from_ratio(1, 2).expect("valid probability ratio");

    TruthSmokeReport {
        conjunction: format!("{:?}", TruthValue::True.and(TruthValue::Unknown)),
        probability_basis_points: Probability::from_ratio(1, 4)
            .expect("valid probability ratio")
            .basis_points(),
        probabilistic_and_basis_points: half.and(half).true_probability().basis_points(),
    }
}

/// Exercise the meta-language features RML relies on against `source`.
///
/// # Errors
///
/// A [`LinoParseError`] when `source` is not valid LiNo.
pub fn meta_language_feature_report(
    source: &str,
) -> Result<MetaLanguageFeatureReport, LinoParseError> {
    Ok(MetaLanguageFeatureReport {
        package_name: "meta-language",
        rml: rml_meta_language_parity_report(source)?,
        substitution: meta_language_substitution_smoke(),
        translation: render_meta_language_translation_smoke("(namespace self)"),
        truth: meta_language_truth_smoke(),
    })
}

fn validate_javascript_identifier(value: &str, role: &str) -> Result<(), String> {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(format!("{role} must be a JavaScript identifier"));
    };
    if !(first == '_' || first == '$' || first.is_ascii_alphabetic()) {
        return Err(format!("{role} must be a JavaScript identifier"));
    }
    if chars
        .all(|character| character == '_' || character == '$' || character.is_ascii_alphanumeric())
    {
        Ok(())
    } else {
        Err(format!("{role} must be a JavaScript identifier"))
    }
}
