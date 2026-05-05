# Core Concept Comparison

This document compares Relative Meta-Logic (RML) with the systems named in
[issue #22](https://github.com/link-foundation/relative-meta-logic/issues/22)
by core logical and metatheoretic concepts. Product and workflow capabilities
are compared separately in [FEATURE-COMPARISION.md](./FEATURE-COMPARISION.md).

The goal is positioning, not a claim that every system has the same design
target. Several entries are logical frameworks, some are full proof assistants,
some are libraries inside a host prover, and Pecan is a domain-specific
automated prover.

## Legend

| Mark | Meaning |
|------|---------|
| Yes | First-class or central capability |
| Part | Partial, prototype, limited, indirect, or available by encoding |
| Host | Inherited from the host proof assistant rather than implemented by the project itself |
| Theory | Theoretical framework rather than a standalone product implementation |
| N/A | Not applicable to the system's role |
| No | No evidence of support or outside the system's design goal |

## Systems

| System | Primary role |
|--------|--------------|
| RML | Link-based probabilistic and many-valued meta-logic with JS and Rust implementations |
| Twelf | LF implementation with type checking, logic programming, and metatheorem checking |
| Edinburgh LF | Dependently typed logical framework for representing deductive systems |
| HELF | Haskell implementation of an LF/Twelf subset for parsing and type checking `.elf` files |
| Isabelle | Generic interactive theorem prover, especially Isabelle/Pure and Isabelle/HOL |
| Coq/Rocq | Interactive theorem prover based on the Calculus of Inductive Constructions |
| Lean | Interactive theorem prover and programming language based on dependent type theory |
| Foundation | Lean 4 library formalizing mathematical logic |
| AFP | Isabelle Archive of Formal Proofs, a checked archive of Isabelle developments |
| Abella | Interactive prover for lambda-tree syntax and two-level logic reasoning |
| lambda Prolog | Higher-order hereditary Harrop logic programming language |
| Pecan | Automated theorem prover for automatic sequences and Buchi automata |

## Foundations and Representation

| Core concept | RML | Twelf | Edinburgh LF | HELF | Isabelle | Coq/Rocq | Lean | Foundation | AFP | Abella | lambda Prolog | Pecan |
|--------------|-----|-------|--------------|------|----------|----------|------|------------|-----|--------|---------------|-------|
| General meta-logic for object logics | Yes: link substrate can encode many logics | Yes | Yes | Part | Yes: Pure framework | Part: can encode logics in CIC | Part: can encode logics in DTT | Yes: logic formalizations in Lean | Host: Isabelle entries | Yes | Part: specification language | No |
| Uniform representation of syntax and judgments | Yes: links | Yes: LF terms | Yes: LF terms | Yes: LF terms | Part: Pure/HOL terms | Yes: CIC terms | Yes: dependent terms | Host | Host | Yes: two-level terms | Yes: lambda terms | Part: formulas and automata |
| One syntactic category for terms/propositions/proofs | Part: links are uniform; proof terms are prototype only | Yes in LF style | Yes in LF style | Yes in LF subset | Part: terms/propositions distinct in HOL layer | Yes | Yes | Host | Host | Part | Part | No |
| Explicit object-language encodings | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Part |
| Adequacy-oriented encodings | Part | Yes | Yes | Part | Yes by proof development | Yes by proof development | Yes by proof development | Host | Host | Yes | Part | No |
| Links or tuples as primitive notation | Yes | No | No | No | No | No | No | No | No | No | No | No |
| Named constants and declarations | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Host | Host | Yes | Yes | Yes |
| Definitions as first-class source entries | Yes | Yes | Theory | Yes | Yes | Yes | Yes | Host | Host | Yes | Yes | Yes |
| Structural equality over expressions | Yes | Yes: type theory equality/convertibility | Yes | Yes | Yes | Yes | Yes | Host | Host | Part | Part | Domain-specific equality |
| Numeric truth values in the core | Yes | No | No | No | No | No | No | No | No | No | No | Part: arithmetic domains |
| Configurable semantic range | Yes: `[0,1]` or `[-1,1]` | No | No | No | No | No | No | No | No | No | No | No |
| Configurable valence | Yes: unary, Boolean, N-valued, continuous | No | No | No | No | No | No | No | No | No | No | No |
| Self-reference accepted by default | Yes: midpoint/paradox-tolerant evaluation | No | No | No | No | No | No | Host constraints | Host constraints | Part: coinductive reasoning only | No | No |
| Circular definitions as ordinary data | Part | No | No | No | Guarded/fixed-point mechanisms | Guarded/termination rules | Guarded/termination rules | Host | Host | Coinductive predicates | Recursive programs with restrictions | Automata fixed points |

## Type Theory and Binding

| Core concept | RML | Twelf | Edinburgh LF | HELF | Isabelle | Coq/Rocq | Lean | Foundation | AFP | Abella | lambda Prolog | Pecan |
|--------------|-----|-------|--------------|------|----------|----------|------|------------|-----|--------|---------------|-------|
| Dependent types | Part: prototype type layer | Yes | Yes | Yes | No: HOL is simply typed; Pure is higher-order | Yes | Yes | Host | Host | No: simply typed reasoning/spec logics | No: polymorphic/simple typed | No |
| Dependent products / Pi-types | Part | Yes | Yes | Yes | Part: meta-level universal quantification | Yes | Yes | Host | Host | No | No | No |
| Lambda abstraction | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Host | Host | Yes | Yes | No |
| Function application | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Host | Host | Yes | Yes | No |
| Beta reduction | Part: beta for link lambdas | Yes | Yes | Yes | Yes | Yes | Yes | Host | Host | Part | Yes | No |
| Definitional equality / conversion | Yes: beta convertibility; eta opt-in API | Yes | Yes | Yes | Yes | Yes | Yes | Host | Host | Part | Part: beta conversion | No |
| Full normalization | No: evaluator is not a normalizer | Yes for LF canonical forms | Yes in theory | Part | Yes where defined by logic/tools | Yes | Yes | Host | Host | Part | Part | No |
| Universe hierarchy | Part: `(Type 0)`, `(Type 1)` | No: LF has kinds/types | No | No | No in HOL; object theories possible | Yes | Yes | Host | Host | No | No | No |
| Sorts / kinds | Part | Yes | Yes | Yes | Yes: types/classes/logics | Yes | Yes | Host | Host | Yes: type declarations | Yes | Domain sorts |
| Type annotations | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Host | Host | Yes | Yes | Yes: domain declarations |
| Type inference | Part | Part: reconstruction | Theory | No reconstruction | Yes | Yes | Yes | Host | Host | Part | Yes | Part |
| Type checking | Part | Yes | Theory | Yes | Yes | Yes | Yes | Host | Host | Yes | Yes | Yes: domain/formula checking |
| Higher-order abstract syntax | Part: encodable as links | Yes | Yes | Yes | Part | Part | Part | Host | Host | Yes | Yes | No |
| Lambda-tree syntax | Part | Yes/related | Yes/related | Yes/related | Encodable | Encodable | Encodable | Host | Host | Yes | Yes | No |
| Binding-aware substitution | Part | Yes | Yes | Yes | Yes | Yes | Yes | Host | Host | Yes | Yes | No |
| Variable freshness support | Part | Part | Part | Part | Yes by libraries/packages | Yes by libraries/packages | Yes by libraries/packages | Host/libraries | Host/libraries | Yes: nabla/generic judgments | Part | No |
| Polymorphism | No dedicated system | Part | Part | Part | Yes | Yes | Yes | Host | Host | Schematic polymorphism | Yes | Domain-specific |
| Type classes | No | No | No | No | Yes | Yes | Yes | Host | Host | No | No | No |
| Inductive families | Part: encodable only | Encoded as LF families | Encodable | Encodable | Yes | Yes | Yes | Host | Host | Yes: inductive definitions | Encodable | No |
| Coinductive types/predicates | Part: encodable only | Limited/encoded | No | No | Yes | Yes | Yes | Host | Host | Yes: coinductive predicates | Encodable | Automata over infinite words |

## Logic and Semantics

| Core concept | RML | Twelf | Edinburgh LF | HELF | Isabelle | Coq/Rocq | Lean | Foundation | AFP | Abella | lambda Prolog | Pecan |
|--------------|-----|-------|--------------|------|----------|----------|------|------------|-----|--------|---------------|-------|
| Classical logic | Yes | Encodable | Encodable | Encodable | Yes: HOL/FOL libraries | Yes | Yes | Yes | Yes | Encodable | Encodable | Part: decidable fragments |
| Intuitionistic logic | Part | Yes: LF foundation | Yes | Yes | Encodable / FOL library | Yes | Yes | Yes | Yes | Yes | Yes | No |
| Constructive type theory | Part | LF-style | LF-style | LF-style | Object theories possible | Yes | Yes | Host | Host | No | No | No |
| Higher-order logic | Part | Encodable | Encodable | Encodable | Yes | Encodable in CIC | Encodable in DTT | Host/encodable | Host | Part | Yes: higher-order programming logic | No |
| First-order logic | Part | Encodable | Encodable | Encodable | Yes | Encodable | Encodable | Yes | Yes | Encodable | Encodable | Part: arithmetic/word formulas |
| Modal logic | Part: link encoding | Encodable | Encodable | Encodable | Encodable | Encodable | Encodable | Yes | Yes | Encodable | Encodable | No |
| Provability logic | Part: encodable | Encodable | Encodable | Encodable | Encodable | Encodable | Encodable | Yes | Yes | Encodable | Encodable | No |
| Interpretability logic | Part: encodable | Encodable | Encodable | Encodable | Encodable | Encodable | Encodable | Yes | Yes | Encodable | Encodable | No |
| Set theory | Part: encodable | Encodable | Encodable | Encodable | Yes: ZF object logic | Encodable/libraries | Encodable/libraries | Yes | Yes | Encodable | Encodable | No |
| Many-valued logic | Yes: native valence/range | No | No | No | Encodable | Encodable | Encodable | Part | Part | Encodable | Encodable | No |
| Fuzzy logic | Yes: continuous truth values and aggregators | No | No | No | Encodable | Encodable | Encodable | No | Part | Encodable | No | No |
| Probabilistic truth values | Yes: native probabilities | No | No | No | Encodable | Encodable | Encodable | No | Part | Encodable | No | No |
| Probabilistic operators | Yes: product/probabilistic sum | No | No | No | Encodable | Encodable | Encodable | No | Part | Encodable | No | No |
| Redefinable logical operators | Yes | Part: notation and constants | Theory | Limited | Yes | Yes | Yes | Host | Host | Part | Yes | Part |
| Paraconsistent semantics | Yes: paradox-tolerant midpoint behavior | No | No | No | Encodable | Encodable with axioms/libraries | Encodable with axioms/libraries | Part: logic zoo focus | Part | Encodable | No | No |
| Liar/self-reference examples | Yes | No | No | No | Encodable with care | Encodable with restrictions | Encodable with restrictions | Part | Part | Part | No | No |
| Arithmetic reasoning | Part: decimal arithmetic in evaluator | Constraint domains possible | Encodable | Encodable | Yes | Yes | Yes | Yes | Yes | Encodable | Encodable | Yes: numeration systems |
| Automated sequence reasoning | No | No | No | No | Encodable with effort | Encodable with effort | Encodable with effort | No | Some entries possible | No | No | Yes |
| Automata-theoretic semantics | No | No | No | No | External/libraries possible | External/libraries possible | External/libraries possible | No | Part | No | No | Yes |
| Decidable complete target fragment | No: general meta-logic evaluator | No | No | No | Some procedures | Some procedures/tactics | Some procedures/tactics | Host | Host | No | No | Yes |

## Metatheory and Proof Objects

| Core concept | RML | Twelf | Edinburgh LF | HELF | Isabelle | Coq/Rocq | Lean | Foundation | AFP | Abella | lambda Prolog | Pecan |
|--------------|-----|-------|--------------|------|----------|----------|------|------------|-----|--------|---------------|-------|
| Machine-checked proof terms | Part: not yet first-class derivation objects | Yes | Theory | Yes: LF type checking | Yes | Yes | Yes | Host | Host | Yes | Part: proof/search witnesses | No general proof terms |
| Small trusted kernel/checker | Part: small evaluator, prototype type layer | Yes: LF checker | Theory | Yes: LF checker | Yes: LCF-style kernel | Yes | Yes | Host | Host | Yes | No: language implementation | Domain-specific automata checker |
| Metatheorem checking about encoded systems | Part | Yes | Theory goal | No | Yes | Yes | Yes | Yes | Yes | Yes | Part | No |
| Totality checking | No | Yes | No | No | Part: function package/tools | Yes | Yes | Host | Host | Part | No | N/A |
| Termination checking | No | Yes | No | No | Yes for recursive definitions/tools | Yes | Yes | Host | Host | Part | No | N/A |
| Coverage checking | No | Yes | No | No | Part | Yes | Yes | Host | Host | Part | No | N/A |
| Mode checking | No | Yes | No | No | No direct equivalent | Tactic/program mechanisms | Tactic/program mechanisms | Host | Host | Part | Modes in implementations/ecosystem | N/A |
| World declarations / regular worlds | No | Yes | No | No | No | No | No | No | No | No | No | N/A |
| Proof search | Part: query evaluation | Yes | No | No | Yes | Yes via tactics/plugins | Yes via tactics | Host | Host | Yes | Yes | Yes: decision procedure |
| Tactic-level proof construction | No | Part: theorem prover/proof search | No | No | Yes | Yes | Yes | Host | Host | Yes | Logic programming search | No |
| Rewriting as proof principle | Part: operators/evaluator | Encodable | Encodable | Encodable | Yes | Yes | Yes | Host | Host | Part | Part | No |
| Countermodel/counterexample support | No | No | No | No | Yes: tools such as Nitpick/Quickcheck | Plugins/tools | Ecosystem/tools | Host | Host | No | No | Automata emptiness gives domain feedback |
| Executable specifications | Yes | Yes | No | Part: typecheck examples | Part | Yes: Gallina programs | Yes: functional programs | Host | Host | Yes: executable specification logic | Yes | Yes |
| Proof-producing evaluator | No | Yes for logic programming/type checking | Theory | Type-checking only | Yes | Yes | Yes | Host | Host | Yes | Part | No general derivation object |
| Independent proof replay | No | Yes via LF checking | Theory | Yes for LF terms | Yes | Yes | Yes | Host | Host | Yes | No standard independent replay | Domain-specific rerun |
| Library-scale theorem reuse | No | Examples only | Theory | No | Yes | Yes | Yes | Yes | Yes | Examples | Examples | Domain libraries |
| Soundness story documented | Part | Yes through LF/Twelf literature | Yes | Part | Yes | Yes | Yes | Host | Host | Yes | Yes | Domain-specific/paper |
| Proof irrelevance / propositions | No dedicated support | No general universe feature | No | No | Logic-dependent | Yes | Yes | Host | Host | No | No | No |
| Reflection/metatheory inside the system | Part: links can encode rules | Part | Theory | No | Isabelle/ML and object encodings | Ltac/MetaCoq/plugins | Lean metaprogramming | Host | Host | Part | Program-level | No |
| External certification bridge | No | No | N/A | No | Can import/export through ecosystem | Plugins/tools | Ecosystem/tools | Host | Host | No | No | No |

## RML Positioning From the Concept Matrix

| Area | RML advantage | RML gap |
|------|---------------|---------|
| Semantic flexibility | Native many-valued, probabilistic, fuzzy, and paradox-tolerant evaluation | No mature proof-producing semantics or independent proof replay |
| Representation | Links give one low-friction substrate for terms, propositions, probabilities, graph structures, and prototype type constructs | No mature elaborator, module system, or binding discipline comparable to LF/DTT systems |
| Logic diversity | Operators and truth ranges can be changed at runtime | Encoded object logics lack machine-checked metatheory infrastructure |
| Type theory | Universe, Pi, lambda, application, type-query experiments, totality (`(total ...)`), and coverage (`(coverage ...)`) checks exist | No full normalization, inductive families, or termination checking |
| Automation | Query evaluation is small and easy to inspect | No tactic language, simplifier, SMT/ATP bridge, or complete domain decision procedure |
| Ecosystem | JS/Rust parity and concise implementation surface | No large library corpus comparable to AFP, mathlib, Rocq libraries, or Foundation |

## Source Notes

| System | Source notes |
|--------|--------------|
| RML | This repository's [README.md](../README.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) describe the current syntax, evaluator, truth ranges, valence, operators, type features, examples, and tests. |
| Twelf and LF | The Twelf LF page describes LF as a dependently typed lambda calculus for representing deductive systems and lists Twelf's LF checker, logic programming language, and metatheorem checker: <https://twelf.org/wiki/lf/>. The Twelf logic programming page describes `%solve`, `%query`, tabled queries, and dependently typed higher-order logic programming: <https://twelf.org/wiki/logic-programming/>. The Twelf guide lists reconstruction, modes, termination, coverage, totality, theorem prover, ML interface, server, and Emacs interface chapters: <https://www.cs.cmu.edu/~twelf/guide-1-4/twelf_toc.html>. |
| HELF | Hackage describes HELF as a Haskell implementation of LF that parses and typechecks Twelf-style `.elf` files, implements a subset of Twelf, and omits type reconstruction/unification: <https://hackage.haskell.org/package/helf>. |
| Isabelle | The Isabelle documentation index lists Isabelle2025-2 manuals for locales, classes, datatypes, functions, code generation, Nitpick, Sledgehammer, Eisbach, Isabelle/Isar, implementation, system, and jEdit: <https://isabelle.in.tum.de/documentation.html>. |
| Coq/Rocq | The Rocq reference manual documents core language constructs, conversion, typing rules, inductive/coinductive types, modules, universes, proof mode, tactics, and extraction-related material: <https://docs.rocq-prover.org/master/refman/>. |
| Lean | The Lean reference describes Lean as an interactive theorem prover based on dependent type theory with a minimal kernel, tactics, simplifier, macros, modules, and build tools: <https://lean-lang.org/doc/reference/latest/>. |
| Foundation | The Foundation README describes a Lean 4 mathematical logic library covering propositional, first-order, modal, provability, interpretability, arithmetic, set theory, proof automation, and logic zoo material: <https://github.com/FormalizedFormalLogic/Foundation>. |
| AFP | The Archive of Formal Proofs describes itself as proof libraries, examples, and larger scientific developments mechanically checked by Isabelle and organized like a scientific journal: <https://www.isa-afp.org/>. |
| Abella | The Abella site describes an interactive theorem prover based on lambda-tree syntax and two-level logic for reasoning about specifications with binding: <https://abella-prover.org/index.html>. The reference guide documents induction, coinduction, search, apply, and other tactics: <https://abella-prover.org/reference-guide.html>. |
| lambda Prolog | The Teyjus documentation describes lambda Prolog as a higher-order hereditary Harrop logic programming language with higher-order programming, polymorphic typing, scoping, modules, abstract data types, and lambda terms as data: <https://teyjus.cs.umn.edu/old/language/teyjus_1.html>. |
| Pecan | The Pecan repository describes it as an automated theorem prover for Buchi automata, numeration systems, and automatic words, with batch and interactive modes: <https://github.com/ReedOei/Pecan>. The Pecan paper describes automated theorem proving for automatic sequences using Buchi automata: <https://arxiv.org/abs/2102.01727>. |
