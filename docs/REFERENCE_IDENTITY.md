# Exact reference identities in type and proof APIs

A decoded LiNo reference is one atom even when its text contains whitespace,
parentheses, quotes, a literal-looking `~1{...}` prefix, control characters, or
Unicode. The atom `(a b)`, the list `(a b)`, and the two leaves `a` and `b` are
different terms.

`keyOf`, `key_of`, and Rust's `Node` display remain legacy human-readable
printers. Their output is not an identity key or serialization format. Use
`emitLinoTerm` / `emit_lino_term` for lossless term transport. Type-map keys
and values, proof-report judgement fields, and `formalization.lino` use this
canonical spelling. Simple identifiers and lists retain their usual spelling.
To decode one serialized term with the low-level list parser, parse it as the
only child of a wrapper list; `parseOne` / `parse_one` expect lists.

## JavaScript

`Env.setTypeNode(exprNode, typeNode)` and `Env.getTypeNode(exprNode)` accept
exact AST nodes: strings are decoded atoms and arrays are lists. The getter
returns canonical serialized LiNo or `null` for an unknown type. Storage
captures independent semantic values, so later array mutations cannot change
a registered key or type.

Existing `Env.setType(expr, typeExpr)` and `Env.getType(expr)` retain their
serialized-string convenience. Valid LiNo strings denote parsed terms;
arrays remain AST nodes. A string that is not one complete serialized term
falls back to a raw atom. Thus `setType('(a b)', '(Type 0)')` still records a
list's type, while `setTypeNode('(a b)', ['Type', '0'])` records the type of
one literal atom. New AST consumers should use the Node methods.

`Env.setTypeSource(exprSource, typeSource)` and
`Env.getTypeSource(exprSource)` are strict serialized-input variants. They
require exactly one valid term and reject malformed or multiple terms.

`synthNode(termNode, env)` and `checkNode(termNode, typeNode, env)` provide
unambiguous AST entrypoints. Existing `synth` and `check` retain source-string
convenience: strings beginning with `(`, a quote, or `~1{` are parsed when
valid serialized LiNo; arrays remain AST nodes. Internal checker recursion
uses the Node entrypoints, so a decoded leaf is never reparsed as source.

## Rust

Use `Env::set_type_node(&Node, &Node)` and `Env::get_type_node(&Node)` for
exact typed inputs. `get_type_node` returns canonical serialized LiNo, as
does the compatibility `get_type` method.

Existing `set_type(&str, &str)` and `get_type(&str)` retain serialized-input
semantics: `(a b)` denotes a list, and `'a b'` denotes one atom. A string that
is not one complete serialized term falls back to a raw atom, preserving
legacy convenience for unquoted ordinary text. Use the Node methods when
an actual atom's text itself looks like valid LiNo. Kernel `synth` and
`check` already accept `Node` values.

## Namespaces, binding, and export

Namespace and alias resolution operates on decoded atomic names before
encoding. Compound expressions are never interpreted as namespace names.
Scoped checker bindings and named-lambda declarations restore the exact
previous local binding; a namespace fallback does not become a local binding.
Empty names and trailing punctuation keep their identities during capture
avoidance. Inferred Pi binders use colon form when an arbitrary type atom
cannot be represented unambiguously in prefix form; ordinary prefix spelling
is preserved. Direct access to the public `types` map requires canonical keys
and values; the typed methods are preferable.

TPTP identifiers use an injective encoding. Already legal identifiers of the
correct case retain their spelling unless they use the reserved escape
prefix. Other names become `rml_hex_` plus hexadecimal UTF-8 bytes; variables
use `V_rml_hex_`. Encoding the reserved prefixes avoids collisions with user
names. Atomic type predicates and named predicates share an exact identity;
compound type expressions and singleton lists remain distinct from atoms
with the same legacy display. This preserves the existing first-order
translation boundary rather than adding unsupported language constructs.

Prefix type binders use the Unicode derived `Uppercase` property in both runtimes, matching Rust `char::is_uppercase`. This includes uppercase letters outside ASCII and uppercase symbols such as Roman numerals. Lowercase type atoms require colon-form binders. This syntax decision does not fold case or normalize references; uppercase/lowercase and composed/decomposed spellings retain distinct identities.
