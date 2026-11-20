//! Conservative lexical-block identifier renaming. Unsupported binding syntax fails closed.
use crate::cst::CstNode;
use crate::cst_js::parse_js;
use std::collections::BTreeMap;
use std::sync::LazyLock;

const RESERVED: &str = "break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await async";
const UNSUPPORTED: &str = "break case catch class continue debugger default delete do else enum export extends finally for function if implements import in interface package private protected public return static super switch throw try var while with yield await async eval";
static IDENTIFIER: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^[$_\p{ID_Start}][$\u{200C}\u{200D}_\p{ID_Continue}]*$")
        .expect("valid Unicode identifier regex")
});

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceLocation {
    pub offset: usize,
    pub line: usize,
    pub column: usize,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentifierReplacement {
    pub from: String,
    pub to: String,
    pub start: SourceLocation,
    pub end: SourceLocation,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteReport {
    pub source: String,
    pub match_count: usize,
    pub changed: bool,
    pub matches: Vec<IdentifierReplacement>,
    pub scope_model: &'static str,
    pub syntax_validated: bool,
}
struct Token {
    text: String,
    tag: String,
    start: SourceLocation,
    end: SourceLocation,
    byte_start: usize,
    byte_end: usize,
}
struct Scope {
    parent: Option<usize>,
    bindings: BTreeMap<String, usize>,
}
fn contains(words: &str, word: &str) -> bool {
    words.split(' ').any(|item| item == word)
}
fn fail(code: &str, detail: &str, offset: usize) -> String {
    format!("{code}: {detail} at UTF-16 offset {offset}")
}
fn advance(location: &SourceLocation, text: &str, previous: Option<char>) -> SourceLocation {
    let mut next = location.clone();
    let mut characters = text.chars().peekable();
    let mut first = true;
    while let Some(character) = characters.next() {
        if first && character == '\n' && previous == Some('\r') {
            next.offset += 1;
        } else if character == '\r' && characters.peek() == Some(&'\n') {
            characters.next();
            next.offset += 2;
            next.line += 1;
            next.column = 1;
        } else if character == '\r' || character == '\n' {
            next.offset += 1;
            next.line += 1;
            next.column = 1;
        } else {
            next.offset += character.len_utf16();
            next.column += 1;
        }
        first = false;
    }
    next
}
fn resolve(name: &str, mut scope: Option<usize>, scopes: &[Scope]) -> Option<usize> {
    while let Some(id) = scope {
        if let Some(binding) = scopes[id].bindings.get(name) {
            return Some(*binding);
        }
        scope = scopes[id].parent;
    }
    None
}

/// Rename one top-level (or sole nested) binding and its references, preserving shadowed bindings.
/// # Errors
/// Returns precise unsupported, ambiguous, capture, or lexical-invalid obligations before editing.
pub fn rewrite_javascript_identifier(
    source: &str,
    from: &str,
    to: &str,
) -> Result<RewriteReport, String> {
    for (role, value) in [("from", from), ("to", to)] {
        if !IDENTIFIER.is_match(value) || contains(RESERVED, value) {
            return Err(format!("{role} must be a JavaScript identifier"));
        }
    }
    let cst = parse_js(source);
    let mut tokens = Vec::new();
    let mut location = SourceLocation {
        offset: 0,
        line: 1,
        column: 1,
    };
    let mut byte = 0;
    let mut previous = None;
    for leaf in cst.leaves() {
        let start = location.clone();
        location = advance(&location, leaf.text(), previous);
        previous = leaf.text().chars().last().or(previous);
        if let CstNode::Token { text, tag } = leaf {
            tokens.push(Token {
                text: text.clone(),
                tag: tag.clone().unwrap_or_default(),
                start,
                end: location.clone(),
                byte_start: byte,
                byte_end: byte + text.len(),
            });
        }
        byte += leaf.text().len();
    }
    let mut scopes = vec![Scope {
        parent: None,
        bindings: BTreeMap::new(),
    }];
    let mut at = Vec::new();
    let mut brackets = Vec::new();
    let mut scope = 0;
    let mut parentheses = 0;
    for (index, token) in tokens.iter().enumerate() {
        let word = token.text.as_str();
        let after = |delta: usize| tokens.get(index + delta).map(|token| token.text.as_str());
        at.push(scope);
        if contains(UNSUPPORTED, word)
            || token.tag.ends_with("template_literal")
            || token.tag.ends_with("regexp_literal")
            || ["\\", ":", "?", "/"].contains(&word)
            || word == "=" && after(1) == Some(">")
            || token.tag.ends_with(".ident") && !IDENTIFIER.is_match(word)
        {
            return Err(fail(
                "RML_RENAME_UNSUPPORTED",
                "binding or lexical form requires a full JavaScript scope parser",
                token.start.offset,
            ));
        }
        if token.tag.ends_with("string_literal")
            && (word.len() < 2 || word.chars().last() != word.chars().next())
        {
            return Err(fail(
                "RML_RENAME_INVALID",
                "unterminated string",
                token.start.offset,
            ));
        }
        if ["(", "[", "{"].contains(&word) {
            if word == "{" {
                if index > 0 && ![";", "{", "}"].contains(&tokens[index - 1].text.as_str()) {
                    return Err(fail(
                        "RML_RENAME_UNSUPPORTED",
                        "only standalone lexical blocks are supported",
                        token.start.offset,
                    ));
                }
                scopes.push(Scope {
                    parent: Some(scope),
                    bindings: BTreeMap::new(),
                });
                scope = scopes.len() - 1;
            } else {
                parentheses += 1;
            }
            brackets.push(word);
        } else if [")", "]", "}"].contains(&word) {
            let expected = match word {
                ")" => "(",
                "]" => "[",
                _ => "{",
            };
            if brackets.pop() != Some(expected) {
                return Err(fail(
                    "RML_RENAME_INVALID",
                    "unbalanced delimiter",
                    token.start.offset,
                ));
            }
            if word == "}" {
                scope = scopes[scope].parent.expect("a matched block has a parent");
            } else {
                parentheses -= 1;
            }
        } else if word == "," && parentheses == 0 {
            return Err(fail(
                "RML_RENAME_UNSUPPORTED",
                "multiple declarations or comma expressions require a full parser",
                token.start.offset,
            ));
        }
        if word == "const" || word == "let" {
            let binding = after(1);
            if !binding.is_some_and(|name| IDENTIFIER.is_match(name) && !contains(RESERVED, name))
                || !matches!(after(2), Some("=" | ";"))
                || word == "const" && after(2) != Some("=")
            {
                return Err(fail(
                    "RML_RENAME_UNSUPPORTED",
                    "only simple lexical declarations are supported",
                    token.start.offset,
                ));
            }
            if after(2) == Some("=") && matches!(after(3), None | Some(";" | "}")) {
                return Err(fail(
                    "RML_RENAME_INVALID",
                    "missing initializer",
                    token.start.offset,
                ));
            }
            let name = binding.expect("binding was validated");
            if scopes[scope]
                .bindings
                .insert(name.to_string(), index + 1)
                .is_some()
            {
                return Err(fail(
                    "RML_RENAME_INVALID",
                    "duplicate lexical binding",
                    tokens[index + 1].start.offset,
                ));
            }
        }
    }
    if !brackets.is_empty() {
        return Err(fail(
            "RML_RENAME_INVALID",
            "unbalanced delimiter",
            source.encode_utf16().count(),
        ));
    }
    let is_reference = |index: usize| {
        tokens[index].tag.ends_with(".ident") && (index == 0 || tokens[index - 1].text != ".")
    };
    let bindings: Vec<_> = scopes
        .iter()
        .filter_map(|scope| scope.bindings.get(from).copied())
        .collect();
    let target = scopes[0].bindings.get(from).copied().or_else(|| {
        if bindings.len() == 1 {
            Some(bindings[0])
        } else {
            None
        }
    });
    if bindings.len() > 1 && target.is_none() {
        return Err(fail(
            "RML_RENAME_AMBIGUOUS",
            "selecting among shadowed bindings is ambiguous",
            0,
        ));
    }
    let selected: Vec<_> = (0..tokens.len())
        .filter(|index| {
            is_reference(*index)
                && tokens[*index].text == from
                && resolve(from, Some(at[*index]), &scopes) == target
        })
        .collect();
    if !selected.is_empty()
        && from != to
        && tokens
            .iter()
            .enumerate()
            .any(|(index, token)| token.text == to && is_reference(index))
    {
        return Err(fail(
            "RML_RENAME_CAPTURE",
            "target name is already present in the lexical environment",
            0,
        ));
    }
    let mut rewritten = source.to_string();
    let mut matches = Vec::new();
    if from != to {
        for index in &selected {
            let token = &tokens[*index];
            matches.push(IdentifierReplacement {
                from: from.to_string(),
                to: to.to_string(),
                start: token.start.clone(),
                end: token.end.clone(),
            });
        }
        for index in selected.iter().rev() {
            let token = &tokens[*index];
            rewritten.replace_range(token.byte_start..token.byte_end, to);
        }
    }
    Ok(RewriteReport {
        source: rewritten,
        match_count: matches.len(),
        changed: !matches.is_empty(),
        matches,
        scope_model: "lexical-blocks-v1",
        syntax_validated: false,
    })
}
