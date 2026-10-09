//! A generic Rust syntax adapter. It contains no RML semantic cases.
//! Parsing is used only for explicit capture and consistency verification.
//! Generation deserializes a structured Syn AST and prints that structure.
use std::io::{self, Read};
use syn::visit::Visit;
use quote::ToTokens;
use syn::visit_mut::VisitMut;

// Syn-serde stores Punctuated lists as values, omitting a trailing separator.
// These Rust grammar positions require that separator. Reconstruct grammar,
// not an RML rule, before Syn's otherwise structure-preserving token printer.
struct RequiredPunctuation;
fn trailing<T, P: Default>(values: &mut syn::punctuated::Punctuated<T, P>) {
    if !values.is_empty() && !values.trailing_punct() { values.push_punct(P::default()); }
}
impl VisitMut for RequiredPunctuation {
    fn visit_expr_struct_mut(&mut self, node: &mut syn::ExprStruct) {
        if node.rest.is_some() { trailing(&mut node.fields); }
        syn::visit_mut::visit_expr_struct_mut(self, node);
    }
    fn visit_pat_struct_mut(&mut self, node: &mut syn::PatStruct) {
        if node.rest.is_some() { trailing(&mut node.fields); }
        syn::visit_mut::visit_pat_struct_mut(self, node);
    }
    fn visit_expr_tuple_mut(&mut self, node: &mut syn::ExprTuple) {
        if node.elems.len() == 1 { trailing(&mut node.elems); }
        syn::visit_mut::visit_expr_tuple_mut(self, node);
    }
    fn visit_type_tuple_mut(&mut self, node: &mut syn::TypeTuple) {
        if node.elems.len() == 1 { trailing(&mut node.elems); }
        syn::visit_mut::visit_type_tuple_mut(self, node);
    }
    fn visit_pat_tuple_mut(&mut self, node: &mut syn::PatTuple) {
        if node.elems.len() == 1 { trailing(&mut node.elems); }
        syn::visit_mut::visit_pat_tuple_mut(self, node);
    }
}

#[derive(Default)]
struct SyntaxAudit {
    verbatim: usize,
    macros: usize,
}

impl<'ast> Visit<'ast> for SyntaxAudit {
    fn visit_expr(&mut self, node: &'ast syn::Expr) {
        if matches!(node, syn::Expr::Verbatim(_)) { self.verbatim += 1; }
        syn::visit::visit_expr(self, node);
    }
    fn visit_item(&mut self, node: &'ast syn::Item) {
        if matches!(node, syn::Item::Verbatim(_)) { self.verbatim += 1; }
        syn::visit::visit_item(self, node);
    }
    fn visit_type(&mut self, node: &'ast syn::Type) {
        if matches!(node, syn::Type::Verbatim(_)) { self.verbatim += 1; }
        syn::visit::visit_type(self, node);
    }
    fn visit_pat(&mut self, node: &'ast syn::Pat) {
        if matches!(node, syn::Pat::Verbatim(_)) { self.verbatim += 1; }
        syn::visit::visit_pat(self, node);
    }
    fn visit_impl_item(&mut self, node: &'ast syn::ImplItem) {
        if matches!(node, syn::ImplItem::Verbatim(_)) { self.verbatim += 1; }
        syn::visit::visit_impl_item(self, node);
    }
    fn visit_trait_item(&mut self, node: &'ast syn::TraitItem) {
        if matches!(node, syn::TraitItem::Verbatim(_)) { self.verbatim += 1; }
        syn::visit::visit_trait_item(self, node);
    }
    fn visit_foreign_item(&mut self, node: &'ast syn::ForeignItem) {
        if matches!(node, syn::ForeignItem::Verbatim(_)) { self.verbatim += 1; }
        syn::visit::visit_foreign_item(self, node);
    }
    fn visit_macro(&mut self, node: &'ast syn::Macro) {
        self.macros += 1;
        syn::visit::visit_macro(self, node);
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mode = std::env::args().nth(1).ok_or("expected parse, emit, or audit")?;
    let mut input = String::new();
    io::stdin().take(64 * 1024 * 1024 + 1).read_to_string(&mut input)?;
    if input.len() > 64 * 1024 * 1024 { return Err("Rust syntax input bound exceeded".into()); }
    let mut syntax: syn::File = match mode.as_str() {
        "parse" => syn::parse_file(&input)?,
        "emit" | "audit" => syn_serde::json::from_str(&input)?,
        _ => return Err("expected parse, emit, or audit".into()),
    };
    let mut audit = SyntaxAudit::default();
    audit.visit_file(&syntax);
    if audit.verbatim != 0 { return Err("unstructured Verbatim syntax is outside the authority archive".into()); }
    match mode.as_str() {
        "parse" => println!("{}", syn_serde::json::to_string(&syntax)),
        "emit" => {
            RequiredPunctuation.visit_file_mut(&mut syntax);
            if let Some(shebang) = &syntax.shebang { println!("{shebang}"); }
            println!("{}", syntax.to_token_stream());
        }
        "audit" => println!("{}", serde_json::json!({"verbatimNodes": audit.verbatim, "macroInvocations": audit.macros})),
        _ => unreachable!(),
    }
    Ok(())
}
