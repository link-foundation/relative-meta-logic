#!/usr/bin/env node
// RML — minimal relative meta-logic over LiNo (Links Notation)
// Supports many-valued logics from unary (1-valued) through continuous probabilistic (∞-valued).
// See: https://en.wikipedia.org/wiki/Many-valued_logic
//
// - Uses official links-notation parser to parse links
// - Terms are defined via (x: x is x)
// - Probabilities are assigned ONLY via: ((<expr>) has probability <p>)
// - Redefinable ops: (=: ...), (!=: not =), (and: avg|min|max|product|probabilistic_sum), (or: ...), (not: ...), (both: ...), (neither: ...)
// - Range: (range: 0 1) for [0,1] or (range: -1 1) for [-1,1] (balanced/symmetric)
// - Valence: (valence: N) to restrict truth values to N discrete levels (N=2 → Boolean, N=3 → ternary, etc.)
// - Query: (? <expr>)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Parser } from 'links-notation';

// ---------- Structured Diagnostics ----------
// Every parser/evaluator error is reported as a `Diagnostic` with an error
// code, human-readable message, and source span (file/line/col, 1-based).
// See `docs/DIAGNOSTICS.md` for the full code list.
/**
 * Structured parser, evaluator, or type-checker diagnostic with a stable code
 * and 1-based source span.
 */
class Diagnostic {
  constructor({ code, message, span }) {
    this.code = code;
    this.message = message;
    this.span = span || { file: null, line: 1, col: 1, length: 0 };
  }
}

// Internal error class used to carry a code + span across throw sites so the
// outer `evaluate()` boundary can convert them into Diagnostics.
class RmlError extends Error {
  constructor(code, message, span) {
    super(message);
    this.name = 'RmlError';
    this.code = code;
    this.span = span || null;
  }
}

// ---------- Trace events ----------
// When `trace: true` is passed to `evaluate()` the evaluator records a
// deterministic sequence of `TraceEvent` objects describing operator
// resolutions, assignment lookups, and reduction steps. The CLI's `--trace`
// flag prints each one as `[span <file>:<line>:<col>] <kind> <details>`.
/**
 * Trace record emitted when `evaluate()` or the CLI runs with tracing enabled.
 */
class TraceEvent {
  constructor({ kind, detail, span }) {
    this.kind = kind;
    this.detail = detail;
    this.span = span || { file: null, line: 1, col: 1, length: 0 };
  }
}

function formatTraceEvent(event) {
  const span = event.span || { file: null, line: 1, col: 1, length: 0 };
  const file = span.file || '<input>';
  return `[span ${file}:${span.line}:${span.col}] ${event.kind} ${event.detail}`;
}

// Format a diagnostic for human-readable CLI output:
//   <file>:<line>:<col>: <CODE>: <message>
//       <source line>
//       ^
function formatDiagnostic(diag, sourceText) {
  const span = diag.span || { file: null, line: 1, col: 1, length: 0 };
  const file = span.file || '<input>';
  const lines = [`${file}:${span.line}:${span.col}: ${diag.code}: ${diag.message}`];
  if (typeof sourceText === 'string') {
    const srcLines = sourceText.split('\n');
    const lineText = srcLines[span.line - 1];
    if (lineText !== undefined) {
      lines.push(lineText);
      const caretCount = Math.max(1, span.length || 1);
      lines.push(' '.repeat(Math.max(0, span.col - 1)) + '^'.repeat(caretCount));
    }
  }
  return lines.join('\n');
}

// ---------- helpers: canonical keys & tokenization of a single link string ----------
function tokenizeOne(s) {
  // s is a single-link string like "( (a = a) has probability 1 )"
  // Strip inline comments (everything after #) but balance parens
  const commentIdx = s.indexOf('#');
  if (commentIdx !== -1) {
    s = s.substring(0, commentIdx);
    // Count unmatched opening parens and add closing parens to balance
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
    }
    // Add missing closing parens
    while (depth > 0) {
      s += ')';
      depth--;
    }
  }

  const out = [];
  let i = 0;
  const isWS = c => /\s/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (isWS(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push(c); i++; continue; }
    let j = i;
    while (j < s.length && !isWS(s[j]) && s[j] !== '(' && s[j] !== ')') j++;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}
function parseOne(tokens) {
  let i = 0;
  function read() {
    if (tokens[i] !== '(') throw new RmlError('E002', 'expected "("');
    i++;
    const arr = [];
    while (i < tokens.length && tokens[i] !== ')') {
      if (tokens[i] === '(') arr.push(read());
      else { arr.push(tokens[i]); i++; }
    }
    if (tokens[i] !== ')') throw new RmlError('E002', 'expected ")"');
    i++;
    return arr;
  }
  const ast = read();
  if (i !== tokens.length) throw new RmlError('E002', 'extra tokens after link');
  return ast;
}
const isNum = s => /^-?(\d+(\.\d+)?|\.\d+)$/.test(s);
const clamp01 = x => Math.max(0, Math.min(1, x));

// ---------- Decimal-precision arithmetic ----------
// Round to at most `digits` significant decimal places to eliminate
// IEEE-754 floating-point artefacts (e.g. 0.1+0.2 → 0.3, not 0.30000000000000004).
const DECIMAL_PRECISION = 12;
function decRound(x) {
  if (!Number.isFinite(x)) return x;
  return +(Math.round(x + 'e' + DECIMAL_PRECISION) + 'e-' + DECIMAL_PRECISION);
}
function keyOf(node) {
  if (Array.isArray(node)) return '(' + node.map(keyOf).join(' ') + ')';
  return String(node);
}
function isStructurallySame(a,b){
  if (Array.isArray(a) && Array.isArray(b)){
    if (a.length !== b.length) return false;
    for (let i=0;i<a.length;i++) if (!isStructurallySame(a[i],b[i])) return false;
    return true;
  }
  return String(a) === String(b);
}

function parseUniverseLevelToken(token) {
  if (typeof token !== 'string' || !/^(0|[1-9]\d*)$/.test(token)) return null;
  const level = Number(token);
  return Number.isSafeInteger(level) ? level : null;
}

function universeTypeKey(node) {
  if (!Array.isArray(node) || node.length !== 2 || node[0] !== 'Type') return null;
  const level = parseUniverseLevelToken(node[1]);
  return level === null ? null : `(Type ${level + 1})`;
}

function inferTypeKey(node, env) {
  const recorded = env.getType(node);
  if (recorded) return recorded;

  const universeType = universeTypeKey(node);
  if (universeType) {
    env.setType(node, universeType);
    return universeType;
  }

  return null;
}

// ---------- Quantization for N-valued logics ----------
// Given N discrete levels and a range [lo, hi], quantize a value to the nearest level.
// For N=2 (Boolean): levels are {lo, hi} (e.g. {0, 1} or {-1, 1})
// For N=3 (ternary): levels are {lo, mid, hi} (e.g. {0, 0.5, 1} or {-1, 0, 1})
// For N=0 or Infinity (continuous): no quantization
// See: https://en.wikipedia.org/wiki/Many-valued_logic
function quantize(x, valence, lo, hi) {
  if (valence < 2) return x; // unary or continuous — no quantization
  const step = (hi - lo) / (valence - 1);
  const level = Math.round((x - lo) / step);
  return lo + Math.max(0, Math.min(valence - 1, level)) * step;
}

// ---------- Environment ----------
/**
 * Mutable evaluator environment that stores terms, assignments, operators,
 * namespaces, imports, and type-checking context.
 */
class Env {
  constructor(options){
    const opts = options || {};
    this.terms = new Set();                     // declared terms (via (x: x is x))
    this.assign = new Map();                    // key(expr) -> truth value
    this.symbolProb = new Map();                // optional symbol priors if you want (x: 0.7)
    this.types = new Map();                     // key(expr) -> type expression (as string)
    this.lambdas = new Map();                   // name -> { param, paramType, body } for named lambdas
    this.templates = new Map();                 // name -> { name, params, body } for pre-evaluation templates
    // Mode declarations (issue #43, D15): each relation may declare an
    // argument mode pattern via `(mode <name> +input -output ...)`. The
    // map records the per-argument flag list (`'in'`, `'out'`, `'either'`)
    // used by the call-site checker to reject mode mismatches.
    this.modes = new Map();                     // name -> [flag, flag, ...]
    // Relation declarations (issue #44, D12): a relation is a list of
    // clauses, each shaped `(<name> arg1 arg2 ... result)`. The totality
    // checker reads the clauses to verify structural decrease on recursive
    // calls. Stored as `name -> [clauseNode, clauseNode, ...]`, where each
    // clauseNode is the original AST list including the head symbol.
    this.relations = new Map();                 // name -> [clause, clause, ...]
    // World declarations (issue #54, D16): each relation may declare an
    // allow-list of constants permitted to appear free in its arguments
    // via `(world <name> (<const>...))`. Relations without a recorded
    // world are unconstrained (the feature is opt-in per relation).
    this.worlds = new Map();                    // name -> [const, const, ...]
    // Inductive declarations (issue #45, D10): `(inductive Name (constructor ...) ...)`
    // records a first-class inductive datatype. Each entry stores the type
    // name, the ordered list of constructors (each `{ name, type }`), and
    // the name and Pi-type of the generated eliminator (`Name-rec`). The
    // declaration form also installs the type, every constructor, and the
    // eliminator into the standard term/type/lambda maps so existing kernel
    // forms (`type of`, `of`, `apply`) work without further plumbing.
    this.inductives = new Map();                // name -> { name, constructors, elimName, elimType }
    // Definition declarations (issue #49, D13): `(define <name> [(measure ...)] (case <pat> <body>) ...)`
    // records a recursive definition with case-clause-based pattern matching.
    // The termination checker (`isTerminating`) reads each entry to verify
    // that recursive calls structurally decrease either the implicit
    // first-argument structural order or, when supplied, an explicit
    // lexicographic measure.
    this.definitions = new Map();               // name -> { name, measure, clauses }
    // Coinductive declarations (issue #53, D11): `(coinductive Name (constructor ...) ...)`
    // records a first-class coinductive datatype dual to the inductive form.
    // Each entry stores the type name, the ordered list of constructors, and
    // the name and Pi-type of the generated corecursor (`Name-corec`). The
    // declaration also installs the type, every constructor, and the
    // corecursor into the standard term/type maps so existing kernel forms
    // (`type of`, `of`, `apply`) work without further plumbing. The kernel
    // additionally enforces a syntactic productivity check: at least one
    // constructor must take a recursive argument so non-productive types
    // (which cannot generate any infinite values) are rejected at declaration
    // time.
    this.coinductives = new Map();              // name -> { name, constructors, corecName, corecType }
    // Domain plugins (issue #63): domain-specific decision procedures keyed
    // by `(domain <name> ...)`. The default registry ships the
    // automatic-sequences plugin below; callers may register additional
    // plugin functions on their Env instance.
    this.domainPlugins = new Map();             // name -> (forms, env) => number
    this.automaticSequenceDecisions = new Map();// theorem -> decision record
    // Namespace state (issue #34): a file can declare `(namespace foo)`, which
    // prefixes every name it subsequently introduces with `foo.`. Imports can
    // be aliased via `(import "x.lino" as a)`, which records `a` -> the
    // imported file's declared namespace so `a.name` resolves to that name.
    // `imported` tracks names that came from an import (not declared in the
    // importing file) so we can emit a shadowing warning (E008) when a later
    // top-level definition rebinds them.
    this.namespace = null;
    this.aliases = new Map();
    this.imported = new Set();
    // Root-construct registry (issue #97): every construct the host evaluator,
    // type checker, proof replay checker, tactic engine, or metatheorem
    // checker relies on can carry a machine-readable descriptor declaring its
    // status (`host-primitive`, `host-derived`, `links-encoded`,
    // `links-defined`, `user-configurable`, `external-trusted`, `planned`),
    // its kind, the host symbol that implements it, the constructs it depends
    // on, and whether it is "pure-links-ready". Descriptors are *data only*;
    // they never change evaluator behaviour. They are consumed by the
    // foundation report (`(foundation-report)`) and the trust audit so users
    // can inspect what the prover is actually trusting.
    this.rootConstructs = new Map();            // name -> descriptor record
    // Foundation registry (issue #97): a foundation bundles a coherent set of
    // root-construct interpretations. `default-rml` is preregistered with the
    // current host-implemented semantics; user files can register alternative
    // foundations (e.g. `boolean-links`) and select them with
    // `(with-foundation <name> ...)`. Foundations may rebind operators inside
    // their scope; backward compatibility is preserved by always defaulting
    // to `default-rml` and restoring the previous bindings on exit.
    this.foundations = new Map();
    this.activeFoundation = 'default-rml';
    this._foundationStack = [];                 // for nested (with-foundation ...)
    this.activeImplementations = new Map();     // construct -> active scoped implementation descriptor
    // Proof-object substrate (issue #97, Phase 3 of netkeep80's punch-list).
    // `proofRules` maps a declared rule name to its pattern (an array of
    // premise nodes + a conclusion node, with `?meta` leaves as
    // metavariables). `proofObjects` maps a derivation name to the rule it
    // applies and the concrete premise/conclusion judgements. Both are
    // data-only: declaring a rule never changes evaluator behaviour. They
    // are consumed by `(check-proof <name>)` and surfaced on
    // `foundationReport()` so the trust audit can inspect them.
    this.proofRules = new Map();
    this.proofAssumptions = new Map();
    this.proofObjects = new Map();
    // Carrier enforcement state (issue #97, Section 2). Off by default so
    // legacy programs are not constrained; flipped on by an enclosing
    // `(with-foundation <name>)` whose descriptor includes `(strict-carrier)`.
    this._strictCarrier = false;
    this._carrier = null;
    this._carrierLabel = null;
    // Pure-links strict mode (issue #97, Phase 6 of netkeep80's punch-list).
    // When enabled, every queried expression is scanned and any operator leaf
    // resolving to a root construct whose status is `host-primitive` or
    // `host-derived` triggers an E065 diagnostic — unless the construct name
    // is in the explicit allow list. Off by default so legacy programs run
    // unchanged.
    this.strictPureLinks = false;
    this.allowedHostPrimitives = new Set();
    this._registerDefaultFoundation();
    // Optional tracer: when set, key evaluation events (operator resolutions,
    // assignment lookups, top-level reductions) are pushed via `trace(kind, detail)`.
    // The current top-level form span is stashed on the Env so leaf hooks can
    // attach a location without threading spans through every helper.
    this._tracer = null;
    this._currentSpan = null;

    // Range: [lo, hi] — default [0, 1] (standard probabilistic)
    // Use [-1, 1] for balanced/symmetric range
    // See: https://en.wikipedia.org/wiki/Balanced_ternary
    this.lo = opts.lo !== undefined ? opts.lo : 0;
    this.hi = opts.hi !== undefined ? opts.hi : 1;

    // Valence: number of discrete truth values (0 or Infinity = continuous)
    // N=1: unary logic (trivial, only one truth value)
    // N=2: binary/Boolean logic — https://en.wikipedia.org/wiki/Boolean_algebra
    // N=3: ternary logic — https://en.wikipedia.org/wiki/Three-valued_logic
    // N=4+: N-valued logic — https://en.wikipedia.org/wiki/Many-valued_logic
    // N=0/Infinity: continuous probabilistic / fuzzy logic — https://en.wikipedia.org/wiki/Fuzzy_logic
    this.valence = opts.valence !== undefined ? opts.valence : 0;

    // ops (redefinable)
    this.ops = new Map(Object.entries({
      'not': (x)=> this.hi - (x - this.lo),  // negation: mirrors around midpoint
      'and': (...xs)=> xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : this.lo, // avg
      'or' : (...xs)=> xs.length ? Math.max(...xs) : this.lo,
      // Belnap operators: AND-altering operators for four-valued logic
      // "both" (gullibility): avg — contradiction resolves to midpoint
      'both': (...xs)=> xs.length ? decRound(xs.reduce((a,b)=>a+b,0)/xs.length) : this.lo,
      // "neither" (consensus): product — gap resolves to zero (no info propagates)
      'neither': (...xs)=> xs.length ? decRound(xs.reduce((a,b)=>a*b,1)) : this.lo,
      '='  : (L,R,ctx)=> {
        // If assigned explicitly, use that (check both prefix and infix key forms)
        const kPrefix = keyOf(['=',L,R]);
        if (this.assign.has(kPrefix)) {
          const v = this.assign.get(kPrefix);
          this.trace('lookup', `${kPrefix} → ${formatTraceValue(v)}`);
          return v;
        }
        const kInfix = keyOf([L,'=',R]);
        if (this.assign.has(kInfix)) {
          const v = this.assign.get(kInfix);
          this.trace('lookup', `${kInfix} → ${formatTraceValue(v)}`);
          return v;
        }
        // Default: syntactic equality of terms/trees
        return isStructurallySame(L,R) ? this.hi : this.lo;
      },
    }));
    // sugar: "!=" as not of "=" (can be redefined)
    this.defineOp('!=', (...args)=> this.getOp('not')( this.getOp('=')(...args) ));

    // Arithmetic operators (decimal-precision by default)
    this.defineOp('+', (a,b)=> decRound(a + b));
    this.defineOp('-', (a,b)=> decRound(a - b));
    this.defineOp('*', (a,b)=> decRound(a * b));
    this.defineOp('/', (a,b)=> b === 0 ? 0 : decRound(a / b));
    this.defineOp('<', (a,b)=> a < b ? this.hi : this.lo);
    this.defineOp('<=', (a,b)=> a <= b ? this.hi : this.lo);

    // Initialize truth constants: true, false, unknown, undefined
    // These are predefined symbol probabilities based on the current range.
    // By default: (false: min(range)), (true: max(range)),
    //             (unknown: mid(range)), (undefined: mid(range))
    // They can be redefined by the user via (true: <value>), (false: <value>), etc.
    this._initTruthConstants();
    this.registerDomainPlugin('automatic-sequences', automaticSequencesDomainPlugin);
  }

  // Clamp and optionally quantize a value to the valid range
  clamp(x) {
    const clamped = Math.max(this.lo, Math.min(this.hi, x));
    if (this.valence >= 2) return quantize(clamped, this.valence, this.lo, this.hi);
    return clamped;
  }

  // Parse a numeric string respecting current range
  toNum(s) {
    return this.clamp(parseFloat(s));
  }

  // Midpoint of the range (useful for paradox resolution, default symbol prob, etc.)
  get mid() { return (this.lo + this.hi) / 2; }

  // Initialize truth constants based on current range.
  // (false: min(range)), (true: max(range)),
  // (unknown: mid(range)), (undefined: mid(range))
  _initTruthConstants() {
    this.symbolProb.set('true', this.hi);
    this.symbolProb.set('false', this.lo);
    this.symbolProb.set('unknown', this.mid);
    this.symbolProb.set('undefined', this.mid);
    // Belnap's four-valued logic operators:
    // "both" and "neither" are AND-altering operators (not constants).
    // "both" = conjunction under contradiction (gullibility) — default: avg
    //   (true both false) = 0.5 (both true and false → contradiction/paradox)
    // "neither" = conjunction under gap (consensus) — default: product
    //   (true neither false) = 0 (neither true nor false → gap/no info)
    // Both are redefinable via (both: min), (neither: max), etc.
    // See: https://en.wikipedia.org/wiki/Four-valued_logic#Belnap
  }

  getOp(name){
    if (this.ops.has(name)) return this.ops.get(name);
    const resolved = this._resolveQualified(name);
    if (resolved !== name && this.ops.has(resolved)) return this.ops.get(resolved);
    throw new RmlError('E001', `Unknown op: ${name}`);
  }
  hasOp(name){
    if (this.ops.has(name)) return true;
    const resolved = this._resolveQualified(name);
    return resolved !== name && this.ops.has(resolved);
  }
  defineOp(name, fn){ this.ops.set(name, fn); }
  registerDomainPlugin(name, plugin) {
    if (typeof name !== 'string' || name.length === 0 || typeof plugin !== 'function') {
      throw new RmlError('E041', 'Domain plugin registration requires a name and function');
    }
    this.domainPlugins.set(name, plugin);
  }
  getDomainPlugin(name) {
    return this.domainPlugins.get(name) || null;
  }

  setExprProb(exprNode, p){
    this.assign.set(keyOf(exprNode), this.clamp(p));
  }
  setType(exprNode, typeExpr){
    const key = typeof exprNode === 'string' ? exprNode : keyOf(exprNode);
    this.types.set(key, typeof typeExpr === 'string' ? typeExpr : keyOf(typeExpr));
  }
  getType(exprNode){
    const key = typeof exprNode === 'string' ? exprNode : keyOf(exprNode);
    if (this.types.has(key)) return this.types.get(key);
    const resolved = this._resolveQualified(key);
    if (resolved !== key && this.types.has(resolved)) return this.types.get(resolved);
    return null;
  }
  setLambda(name, param, paramType, body){
    this.lambdas.set(name, { param, paramType, body });
  }
  getLambda(name){
    return this.lambdas.get(name) || null;
  }
  setSymbolProb(sym, p){ this.symbolProb.set(sym, this.clamp(p)); }
  getSymbolProb(sym){
    if (this.symbolProb.has(sym)) return this.symbolProb.get(sym);
    const resolved = this._resolveQualified(sym);
    if (resolved !== sym && this.symbolProb.has(resolved)) {
      return this.symbolProb.get(resolved);
    }
    return this.mid;
  }
  trace(kind, detail){
    if (this._tracer) this._tracer(kind, detail, this._currentSpan);
  }

  // ---------- Namespace helpers (issue #34) ----------
  // Apply the active namespace to a freshly declared name, e.g. inside
  // `(namespace classical)` the form `(and: min)` registers `classical.and`,
  // not `and`. Names that already contain a `.` are passed through.
  qualifyName(name) {
    if (typeof name !== 'string') return name;
    if (this.namespace && !name.includes('.')) return `${this.namespace}.${name}`;
    return name;
  }

  // Resolve a possibly-qualified name to its canonical storage key. Order:
  //   1. Alias prefix: `cl.foo` with alias `cl -> classical` becomes
  //      `classical.foo`.
  //   2. Active namespace: an unqualified name lives in `<ns>.<name>`.
  //   3. Bare name: returned unchanged.
  // Used by lookup helpers (operators, symbol probabilities) to find
  // namespaced bindings without forcing every call site to spell them out.
  _resolveQualified(name) {
    if (typeof name !== 'string') return name;
    const dotIdx = name.indexOf('.');
    if (dotIdx > 0) {
      const prefix = name.slice(0, dotIdx);
      const rest = name.slice(dotIdx + 1);
      if (this.aliases.has(prefix)) {
        return `${this.aliases.get(prefix)}.${rest}`;
      }
      return name;
    }
    if (this.namespace) {
      const qualified = `${this.namespace}.${name}`;
      if (
        this.ops.has(qualified) ||
        this.symbolProb.has(qualified) ||
        this.terms.has(qualified) ||
        this.types.has(qualified) ||
        this.lambdas.has(qualified) ||
        this.templates.has(qualified)
      ) {
        return qualified;
      }
    }
    return name;
  }

  // ---------- Foundation / root-construct registry (issue #97) ----------
  // Preregister the default `default-rml` foundation and bake in the
  // built-in root-construct descriptors that describe the current host
  // implementation. These are *data only*; they never change behaviour.
  _registerDefaultFoundation() {
    this.foundations.set('default-rml', {
      name: 'default-rml',
      description: 'Default RML foundation: host-implemented configurable kernel',
      uses: [],
      defines: new Map(),
      extends: null,
      numericDomain: 'decimal-12',
      truthDomain: 'default-truth',
    });
    // Pre-seed the experimental MTC/anum foundation (issue #97, Phase 9).
    // Opt-in only — never activated implicitly. Selecting it via
    // `(with-foundation mtc-anum ...)` does NOT rewire host arithmetic; the
    // profile is descriptive metadata plus a serialization alphabet. Its
    // four abits (`[`, `]`, `0`, `1`) are exposed through `foundationReport`
    // so the trust audit can show what the experimental profile carries.
    this.foundations.set('mtc-anum', {
      name: 'mtc-anum',
      description: 'experimental metatheory-of-links foundation (anum serialization)',
      uses: [],
      defines: new Map(),
      extends: null,
      numericDomain: null,
      truthDomain: 'mtc-abits',
      carrier: null,
      strictCarrier: false,
      truthTables: null,
      experimental: true,
      root: '∞',
      abits: [
        { symbol: '[', meaning: 'start-of-meaning' },
        { symbol: ']', meaning: 'end-of-meaning' },
        { symbol: '1', meaning: 'unit-of-meaning' },
        { symbol: '0', meaning: 'zero-of-meaning' },
      ],
    });
    this.foundations.set('boolean-links', {
      name: 'boolean-links',
      description: 'links-defined two-valued Boolean logic via finite truth tables',
      uses: [],
      defines: new Map(),
      extends: null,
      numericDomain: 'boolean-zero-one',
      truthDomain: 'boolean-two-valued',
      carrier: ['0', '1'],
      strictCarrier: true,
      truthTables: new Map([
        ['and', [
          { inputs: ['1', '1'], output: '1' },
          { inputs: ['1', '0'], output: '0' },
          { inputs: ['0', '1'], output: '0' },
          { inputs: ['0', '0'], output: '0' },
        ]],
        ['or', [
          { inputs: ['1', '1'], output: '1' },
          { inputs: ['1', '0'], output: '1' },
          { inputs: ['0', '1'], output: '1' },
          { inputs: ['0', '0'], output: '0' },
        ]],
        ['not', [
          { inputs: ['1'], output: '0' },
          { inputs: ['0'], output: '1' },
        ]],
      ]),
      experimental: false,
      root: null,
      abits: null,
    });
    // Pre-seed the links-defined typed-kernel foundation (issue #97, Phase 5).
    // Selecting it via `(with-foundation typed-kernel-links ...)` records the
    // proof-substrate rules `pi-formation`, `lambda-introduction`,
    // `application-elimination`, and `beta-conversion` as the canonical
    // links-defined replacements for the host kernel's typing judgements.
    // The host kernel still runs evaluation; the foundation is selected so
    // the trust audit can list the four rules as the active derivations.
    this.foundations.set('typed-kernel-links', {
      name: 'typed-kernel-links',
      description: 'links-defined typed-kernel fragment (Pi/lambda/apply/beta as proof rules)',
      uses: [
        'pi-formation',
        'lambda-introduction',
        'application-elimination',
        'beta-conversion',
      ],
      defines: new Map(),
      extends: 'default-rml',
      numericDomain: 'decimal-12',
      truthDomain: 'default-truth',
      carrier: null,
      strictCarrier: false,
      truthTables: null,
      experimental: false,
      root: null,
      abits: null,
    });
    // Pre-seed the links-defined Peano naturals foundation (issue #97,
    // Phase 12). Selecting it via `(with-foundation nat-links ...)`
    // records the Nat proof-substrate rules, the dedicated `nat-equality`
    // layer, and the rule-driven `eval-nat` normalizer as active
    // foundation dependencies. The host's decimal numeric domain and
    // default equality layers are unaffected.
    this.foundations.set('nat-links', {
      name: 'nat-links',
      description: 'links-defined Peano naturals (zero/succ formation, add by recursion, induction with explicit forall/implication/predicate-application, nat-equality with reflexivity and successor congruence, nat-recursion/nat-eliminator, multiplication, rule-driven eval-nat normalizer)',
      uses: [
        'nat-zero-formation',
        'nat-succ-formation',
        'nat-add-zero',
        'nat-add-succ',
        'nat-induction',
        'nat-equality',
        'nat-refl',
        'nat-cong-succ',
        'forall',
        'implication',
        'predicate-application',
        'nat-recursion',
        'nat-eliminator',
        'nat-rec-zero',
        'nat-rec-succ',
        'mul',
        'nat-mul-zero',
        'nat-mul-succ',
        'eval-nat-normalize',
        'eval-nat',
        'nat-normal-form-to-host-number',
      ],
      defines: new Map(),
      extends: 'default-rml',
      numericDomain: 'decimal-12',
      truthDomain: 'default-truth',
      carrier: null,
      strictCarrier: false,
      truthTables: null,
      experimental: false,
      root: null,
      abits: null,
    });
    seedBuiltinRootConstructs(this);
  }

  registerRootConstruct(descriptor) {
    if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name) {
      throw new RmlError('E060', 'root-construct descriptor requires a name');
    }
    const previous = this.rootConstructs.get(descriptor.name) || null;
    const merged = mergeRootConstructDescriptors(previous, descriptor);
    this.rootConstructs.set(merged.name, merged);
    return merged;
  }

  getRootConstruct(name) {
    return this.rootConstructs.get(name) || null;
  }

  listRootConstructs() {
    return [...this.rootConstructs.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }

  registerFoundation(foundation) {
    if (!foundation || typeof foundation.name !== 'string' || !foundation.name) {
      throw new RmlError('E061', 'foundation declaration requires a name');
    }
    const previous = this.foundations.get(foundation.name) || null;
    const merged = mergeFoundationDescriptors(previous, foundation);
    this.foundations.set(merged.name, merged);
    return merged;
  }

  getFoundation(name) {
    return this.foundations.get(name) || null;
  }

  enterFoundation(name) {
    const foundation = this.foundations.get(name);
    if (!foundation) {
      throw new RmlError('E062', `Unknown foundation: ${name}`);
    }
    // Snapshot the operators that this foundation rebinds so `exitFoundation`
    // can restore them. Only `(defines <op> <aggregator>)` entries that name
    // a known truth aggregator are applied (avg, min, max, product,
    // probabilistic_sum); other entries are data-only.
    const snapshot = new Map();
    const implementationSnapshot = new Map();
    const snapshotImplementation = (opName) => {
      if (implementationSnapshot.has(opName)) return;
      const current = this.activeImplementations.get(opName);
      implementationSnapshot.set(opName, current ? {
        ...current,
        dependsOn: Array.isArray(current.dependsOn) ? current.dependsOn.slice() : [],
      } : null);
    };
    if (foundation.defines && foundation.defines.size > 0) {
      for (const [opName, implName] of foundation.defines.entries()) {
        const fn = aggregatorOpFromName(this, implName);
        if (fn === null) continue;
        snapshotImplementation(opName);
        snapshot.set(opName, this.ops.has(opName) ? this.ops.get(opName) : null);
        this.ops.set(opName, fn);
        this.activeImplementations.set(opName, {
          construct: opName,
          foundation: name,
          implementation: implName,
          status: 'host-primitive',
          semanticStatus: 'host-trusted',
          dependsOn: [implName],
        });
      }
    }
    // Truth tables apply on top of `(defines ...)` bindings so a foundation
    // can pin a finite slice of an operator and leave the rest to the
    // aggregator-based default that was just installed.
    if (foundation.truthTables instanceof Map && foundation.truthTables.size > 0) {
      for (const [opName, rows] of foundation.truthTables.entries()) {
        if (!snapshot.has(opName)) {
          snapshot.set(opName, this.ops.has(opName) ? this.ops.get(opName) : null);
        }
        const previous = this.ops.has(opName) ? this.ops.get(opName) : null;
        const previousImpl = this.activeImplementations.get(opName) || null;
        const fn = truthTableOpFromRows(this, opName, rows, previous);
        if (fn === null) continue;
        snapshotImplementation(opName);
        const isTotal = truthTableRowsCompleteForCarrier(this, rows, foundation);
        const fallbackDeps = isTotal ? [] : truthTableFallbackDependencies(this, opName, previousImpl);
        this.ops.set(opName, fn);
        this.activeImplementations.set(opName, {
          construct: opName,
          foundation: name,
          implementation: `truth-table:${name}/${opName}`,
          status: 'links-defined',
          semanticStatus: 'links-checked',
          dependsOn: fallbackDeps,
        });
      }
    }
    // Carrier snapshot for opt-in enforcement (issue #97, Section 2 of
    // netkeep80's punch-list). `_strictCarrier` is what the evaluator hot
    // path checks; `_carrier` is the resolved numeric set.
    const carrierFrame = {
      strictCarrier: this._strictCarrier === true,
      carrier: this._carrier instanceof Set ? new Set(this._carrier) : null,
      carrierLabel: this._carrierLabel || null,
    };
    if (foundation.strictCarrier === true && Array.isArray(foundation.carrier) && foundation.carrier.length > 0) {
      this._strictCarrier = true;
      this._carrier = new Set();
      this._carrierLabel = foundation.carrier.join(' ');
      for (const tok of foundation.carrier) {
        const num = Number(tok);
        if (Number.isFinite(num)) {
          this._carrier.add(num);
          continue;
        }
        // Symbolic carrier values (`true`, `false`, `unknown`, ...) resolve
        // through `symbolProb` so user-defined truth constants flow in.
        if (this.symbolProb.has(tok)) {
          this._carrier.add(this.symbolProb.get(tok));
        }
      }
    }
    this._foundationStack.push({ name: this.activeFoundation, snapshot, implementationSnapshot, carrierFrame });
    this.activeFoundation = name;
  }

  exitFoundation() {
    if (this._foundationStack.length === 0) {
      this.activeFoundation = 'default-rml';
      this.activeImplementations.clear();
      this._strictCarrier = false;
      this._carrier = null;
      this._carrierLabel = null;
      return;
    }
    const frame = this._foundationStack.pop();
    if (frame && frame.snapshot) {
      for (const [opName, op] of frame.snapshot.entries()) {
        if (op === null) {
          this.ops.delete(opName);
        } else {
          this.ops.set(opName, op);
        }
      }
    }
    if (frame && frame.implementationSnapshot) {
      for (const [opName, impl] of frame.implementationSnapshot.entries()) {
        if (impl === null) {
          this.activeImplementations.delete(opName);
        } else {
          this.activeImplementations.set(opName, impl);
        }
      }
    }
    if (frame && frame.carrierFrame) {
      this._strictCarrier = frame.carrierFrame.strictCarrier === true;
      this._carrier = frame.carrierFrame.carrier instanceof Set ? frame.carrierFrame.carrier : null;
      this._carrierLabel = frame.carrierFrame.carrierLabel || null;
    } else {
      this._strictCarrier = false;
      this._carrier = null;
      this._carrierLabel = null;
    }
    this.activeFoundation = frame && typeof frame.name === 'string' ? frame.name : 'default-rml';
  }

  // Check `value` against the active foundation's carrier. Returns null when
  // the carrier is inactive or the value is legal, or a human-readable
  // message otherwise (consumed by the caller to build an E063 diagnostic).
  checkCarrierValue(value) {
    if (this._strictCarrier !== true || !(this._carrier instanceof Set) || this._carrier.size === 0) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (this._carrier.has(value)) return null;
    const allowed = [...this._carrier].sort((a, b) => a - b).join(', ');
    return `value ${formatTraceValue(value)} is not in active carrier {${allowed}}`;
  }

  // Build a structured trust / foundation report. The shape is intentionally
  // plain so callers can stringify it (CLI, docs) or test against it (unit
  // tests).
  foundationReport() {
    const active = this.activeFoundation || 'default-rml';
    const foundation = this.foundations.get(active) || null;
    const byStatus = new Map();
    const bySemanticStatus = new Map();
    for (const rc of this.listRootConstructs()) {
      const status = rc.status || 'unknown';
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status).push(rc.name);
      const semanticStatus = semanticStatusForDescriptor(rc) || 'unknown';
      if (!bySemanticStatus.has(semanticStatus)) bySemanticStatus.set(semanticStatus, []);
      bySemanticStatus.get(semanticStatus).push(rc.name);
    }
    const buckets = {};
    for (const [status, names] of byStatus.entries()) {
      buckets[status] = names.slice().sort();
    }
    const semanticBuckets = {};
    for (const [status, names] of bySemanticStatus.entries()) {
      semanticBuckets[status] = names.slice().sort();
    }
    return {
      activeFoundation: active,
      description: foundation ? foundation.description : null,
      numericDomain: foundation ? foundation.numericDomain : null,
      truthDomain: foundation ? foundation.truthDomain : null,
      rootConstructs: this.listRootConstructs().map(rc => ({
        name: rc.name,
        kind: rc.kind || null,
        status: rc.status || null,
        semanticStatus: semanticStatusForDescriptor(rc),
        dependsOn: (rc.dependsOn || []).slice(),
        encodedAs: rc.encodedAs || null,
        pureLinksReady: typeof rc.pureLinksReady === 'boolean' ? rc.pureLinksReady : null,
        override: rc.override || null,
        plannedAs: rc.plannedAs || null,
      })),
      byStatus: buckets,
      bySemanticStatus: semanticBuckets,
      foundations: [...this.foundations.values()].map(f => ({
        name: f.name,
        description: f.description || null,
        uses: (f.uses || []).slice(),
        defines: [...(f.defines || new Map()).entries()].map(([k, v]) => ({ construct: k, implementation: v })),
        extends: f.extends || null,
        numericDomain: f.numericDomain || null,
        truthDomain: f.truthDomain || null,
        carrier: Array.isArray(f.carrier) ? f.carrier.slice() : null,
        strictCarrier: f.strictCarrier === true,
        truthTables: f.truthTables instanceof Map && f.truthTables.size > 0
          ? [...f.truthTables.entries()]
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([op, rows]) => ({
              op,
              rows: rows.map(r => ({ inputs: r.inputs.slice(), output: r.output })),
            }))
          : null,
        experimental: f.experimental === true,
        root: f.root || null,
        abits: Array.isArray(f.abits) && f.abits.length > 0
          ? f.abits.map(a => ({ symbol: a.symbol, meaning: a.meaning }))
          : null,
      })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      activeImplementations: [...this.activeImplementations.entries()]
        .map(([construct, impl]) => ({
          construct,
          foundation: impl.foundation || null,
          implementation: impl.implementation || null,
          status: impl.status || null,
          semanticStatus: impl.semanticStatus || semanticStatusForTrustStatus(impl.status) || null,
          dependsOn: Array.isArray(impl.dependsOn) ? impl.dependsOn.slice() : [],
        }))
        .sort((a, b) => a.construct < b.construct ? -1 : a.construct > b.construct ? 1 : 0),
      proofRules: [...this.proofRules.entries()]
        .map(([name, r]) => ({
          name,
          premises: r.premises.map(p => keyOf(p)),
          conclusion: keyOf(r.conclusion),
        }))
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      proofAssumptions: [...this.proofAssumptions.entries()]
        .map(([name, a]) => ({
          name,
          kind: a.kind,
          judgement: keyOf(a.judgement),
        }))
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      proofObjects: [...this.proofObjects.entries()]
        .map(([name, po]) => ({
          name,
          rule: po.rule,
          premises: po.premises.map(p => keyOf(p)),
          premiseRefs: (po.premiseRefs || []).slice(),
          conclusion: keyOf(po.conclusion),
        }))
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      strictPureLinks: this.strictPureLinks === true,
      allowedHostPrimitives: [...this.allowedHostPrimitives].sort(),
      dependencyGraph: buildDependencyGraph(this),
    };
  }

  // Build a per-proof report (issue #97, Phase 13). The shape mirrors the
  // foundation report so a CLI or test can stringify or assert against it.
  // Reported fields:
  //   - kind: 'proof-report'
  //   - name, rule, conclusion, premises, premiseRefs
  //   - verdict { ok, error? }
  //   - dependencies: transitive list of (proof-object | axiom | assumption)
  //     names with their kinds, in topological order
  //   - rules: rule names that this proof transitively applies
  //   - rootConstructsUsed: registered root-construct names that appear as
  //     leaf operators in the proof's premises/conclusion/rule patterns
  //   - bySemanticStatus: rootConstructsUsed bucketed by semantic-status
  //   - byTrustStatus: rootConstructsUsed bucketed by trust status
  //   - activeFoundation
  //   - strictPureLinks
  proofReport(name) {
    if (typeof name !== 'string' || !name) {
      return { kind: 'proof-report', name: null, verdict: { ok: false, error: 'proof name required' } };
    }
    const po = this.getProofObject(name);
    if (!po) {
      return {
        kind: 'proof-report',
        name,
        verdict: { ok: false, error: `unknown proof-object ${name}` },
      };
    }
    const verdict = checkProofObject(this, name);
    const dependencies = [];
    const seen = new Set();
    const rules = new Set();
    const walk = (refName) => {
      if (seen.has(refName)) return;
      seen.add(refName);
      const ax = this.getProofAssumption(refName);
      if (ax) {
        dependencies.push({ name: ax.name, kind: ax.kind, judgement: keyOf(ax.judgement) });
        return;
      }
      const dep = this.getProofObject(refName);
      if (!dep) {
        dependencies.push({ name: refName, kind: 'unknown', judgement: null });
        return;
      }
      for (const sub of dep.premiseRefs || []) walk(sub);
      if (dep.rule) rules.add(dep.rule);
      dependencies.push({
        name: dep.name,
        kind: 'proof-object',
        rule: dep.rule,
        judgement: keyOf(dep.conclusion),
      });
    };
    for (const ref of po.premiseRefs || []) walk(ref);
    if (po.rule) rules.add(po.rule);
    const rootNames = new Set([
      'proof-replay',
      'structural-equality',
      'structural-matcher',
      'substitution',
    ]);
    const collectFromTerm = (term) => {
      if (!Array.isArray(term)) {
        if (typeof term === 'string' && this.rootConstructs.has(term)) rootNames.add(term);
        return;
      }
      for (const t of term) collectFromTerm(t);
    };
    collectFromTerm(po.conclusion);
    for (const p of po.premises || []) collectFromTerm(p);
    for (const ruleName of rules) {
      const rule = this.getProofRule(ruleName);
      if (!rule) continue;
      collectFromTerm(rule.conclusion);
      for (const prem of rule.premises || []) collectFromTerm(prem);
    }
    const rootConstructsUsed = [...rootNames].sort();
    const bySemanticStatus = {};
    const byTrustStatus = {};
    for (const rcName of rootConstructsUsed) {
      const rc = this.rootConstructs.get(rcName);
      if (!rc) continue;
      const semantic = semanticStatusForDescriptor(rc) || 'unknown';
      const trust = rc.status || 'unknown';
      if (!bySemanticStatus[semantic]) bySemanticStatus[semantic] = [];
      bySemanticStatus[semantic].push(rcName);
      if (!byTrustStatus[trust]) byTrustStatus[trust] = [];
      byTrustStatus[trust].push(rcName);
    }
    for (const key of Object.keys(bySemanticStatus)) bySemanticStatus[key].sort();
    for (const key of Object.keys(byTrustStatus)) byTrustStatus[key].sort();
    return {
      kind: 'proof-report',
      name,
      rule: po.rule,
      conclusion: keyOf(po.conclusion),
      premises: (po.premises || []).map(keyOf),
      premiseRefs: (po.premiseRefs || []).slice(),
      verdict: verdict.ok ? { ok: true } : { ok: false, error: verdict.error },
      dependencies,
      rules: [...rules].sort(),
      rootConstructsUsed,
      bySemanticStatus,
      byTrustStatus,
      activeFoundation: this.activeFoundation || 'default-rml',
      strictPureLinks: this.strictPureLinks === true,
    };
  }

  // Return the transitive closure of a construct's dependencies, breadth-first
  // and deterministically sorted at every level. Unknown construct names
  // return `null`. Missing intermediate deps are silently skipped so a
  // foundation that references a construct it has not yet registered can
  // still report cleanly.
  dependencyClosure(name) {
    if (typeof name !== 'string' || !name) return null;
    if (!this.rootConstructs.has(name)) return null;
    return closureFor(this, name);
  }

  // ---------- Proof-object substrate (issue #97, Phase 3) ----------

  registerProofRule(rule) {
    if (!rule || typeof rule.name !== 'string' || !rule.name) {
      throw new RmlError('E064', 'rule declaration requires a name');
    }
    this.proofRules.set(rule.name, {
      name: rule.name,
      premises: rule.premises ? rule.premises.slice() : [],
      conclusion: rule.conclusion,
    });
    return this.proofRules.get(rule.name);
  }

  getProofRule(name) {
    return this.proofRules.get(name) || null;
  }

  registerProofAssumption(assumption) {
    if (!assumption || typeof assumption.name !== 'string' || !assumption.name) {
      throw new RmlError('E064', 'proof assumption declaration requires a name');
    }
    if (assumption.judgement === null || assumption.judgement === undefined) {
      throw new RmlError('E064', `${assumption.kind || 'assumption'} ${assumption.name} requires a judgement`);
    }
    this.proofAssumptions.set(assumption.name, {
      name: assumption.name,
      kind: assumption.kind || 'assumption',
      judgement: assumption.judgement,
    });
    return this.proofAssumptions.get(assumption.name);
  }

  getProofAssumption(name) {
    return this.proofAssumptions.get(name) || null;
  }

  registerProofObject(po) {
    if (!po || typeof po.name !== 'string' || !po.name) {
      throw new RmlError('E064', 'proof-object declaration requires a name');
    }
    if (typeof po.rule !== 'string' || !po.rule) {
      throw new RmlError('E064', `proof-object ${po.name} must include (applies <rule>)`);
    }
    this.proofObjects.set(po.name, {
      name: po.name,
      rule: po.rule,
      premises: po.premises ? po.premises.slice() : [],
      premiseRefs: po.premiseRefs ? po.premiseRefs.slice() : [],
      conclusion: po.conclusion,
    });
    return this.proofObjects.get(po.name);
  }

  getProofObject(name) {
    return this.proofObjects.get(name) || null;
  }
}

// Merge a new root-construct descriptor with the previously stored one. The
// merge prefers explicitly set fields from the new descriptor but preserves
// information that the new descriptor leaves unspecified, so multiple
// `(root-construct foo ...)` forms can build the record incrementally without
// clobbering already-known fields.
function mergeRootConstructDescriptors(previous, next) {
  const base = previous ? { ...previous } : {
    name: next.name,
    status: null,
    semanticStatus: null,
    kind: null,
    dependsOn: [],
    encodedAs: null,
    pureLinksReady: null,
    override: null,
    plannedAs: null,
    foundation: null,
  };
  base.name = next.name;
  if (next.status !== undefined && next.status !== null) base.status = next.status;
  if (next.semanticStatus !== undefined && next.semanticStatus !== null) base.semanticStatus = next.semanticStatus;
  if (next.kind !== undefined && next.kind !== null) base.kind = next.kind;
  if (Array.isArray(next.dependsOn) && next.dependsOn.length > 0) {
    const seen = new Set(base.dependsOn || []);
    const deps = (base.dependsOn || []).slice();
    for (const dep of next.dependsOn) {
      if (!seen.has(dep)) {
        seen.add(dep);
        deps.push(dep);
      }
    }
    base.dependsOn = deps;
  } else if (!Array.isArray(base.dependsOn)) {
    base.dependsOn = [];
  }
  if (next.encodedAs !== undefined && next.encodedAs !== null) base.encodedAs = next.encodedAs;
  if (typeof next.pureLinksReady === 'boolean') base.pureLinksReady = next.pureLinksReady;
  if (next.override !== undefined && next.override !== null) base.override = next.override;
  if (next.plannedAs !== undefined && next.plannedAs !== null) base.plannedAs = next.plannedAs;
  if (next.foundation !== undefined && next.foundation !== null) base.foundation = next.foundation;
  return base;
}

const SEMANTIC_STATUS_ORDER = [
  'host-trusted',
  'links-described',
  'links-checked',
  'links-evaluated',
  'self-hosted',
];

function semanticStatusForTrustStatus(status) {
  switch (status) {
    case 'host-primitive':
    case 'host-derived':
    case 'external-trusted':
    case 'user-configurable':
    case 'user-overridden':
      return 'host-trusted';
    case 'links-encoded':
    case 'planned':
      return 'links-described';
    case 'links-defined':
      return 'links-checked';
    default:
      return null;
  }
}

function semanticStatusForDescriptor(descriptor) {
  if (!descriptor) return null;
  return descriptor.semanticStatus || semanticStatusForTrustStatus(descriptor.status) || null;
}

// ---------- Dependency graph traversal (issue #97, Phase 7) ----------
//
// Compute the transitive closure of a single root-construct's dependencies,
// breadth-first. Missing intermediate deps are silently skipped so a
// foundation that names a construct it has not yet registered still reports
// a clean closure for everything it has registered. Returns `null` if the
// root itself is unknown.
function closureFor(env, name) {
  if (!env.rootConstructs.has(name)) return null;
  const seen = new Set();
  const order = [];
  const queue = [name];
  while (queue.length > 0) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    if (next !== name) order.push(next);
    const rc = env.rootConstructs.get(next);
    if (!rc) continue;
    const deps = Array.isArray(rc.dependsOn) ? rc.dependsOn.slice().sort() : [];
    for (const dep of deps) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return order.sort();
}

// Build a `{ <name>: [<dep>, ...] }` map covering every registered
// root-construct in deterministic, sorted order at every level. Constructs
// with no dependencies map to an empty array so the trust audit can still
// see them in the closure (callers can ignore them or trust them at face
// value). This is the global dependency view, complementing
// `dependencyClosure(name)` which gives a per-construct slice.
function buildDependencyGraph(env) {
  const entries = [...env.rootConstructs.keys()].sort();
  const out = {};
  for (const name of entries) {
    out[name] = closureFor(env, name) || [];
  }
  return out;
}

// ---------- MTC/anum serialization (issue #97, Phase 9) ----------
//
// Encode a link expression into a string using only the four abits of the
// experimental `mtc-anum` foundation: `[`, `]`, `0`, `1`. Each Node is
// wrapped in `[ ... ]`; the first character after `[` is a tag — `0` for a
// leaf, `1` for a list. A leaf's payload is its UTF-8 bytes encoded
// most-significant-bit-first, 8 bits per byte. A list's payload is the
// concatenated encoding of its children. Round-trippable via `decodeAnum`.
function encodeAnum(node) {
  if (Array.isArray(node)) {
    let out = '[1';
    for (const child of node) out += encodeAnum(child);
    return out + ']';
  }
  if (typeof node === 'string') {
    return '[0' + stringToBitstring(node) + ']';
  }
  if (typeof node === 'number') {
    return '[0' + stringToBitstring(String(node)) + ']';
  }
  throw new RmlError('E066', `cannot anum-encode value of type ${typeof node}`);
}

function stringToBitstring(s) {
  const bytes = new TextEncoder().encode(s);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits;
}

function bitstringToString(bits) {
  if (bits.length % 8 !== 0) {
    throw new RmlError(
      'E066',
      `anum-decode: leaf bit-count ${bits.length} is not byte-aligned`,
    );
  }
  const bytes = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  }
  return new TextDecoder().decode(bytes);
}

// Decode an anum-encoded string into a Node. Strictly enforces the
// `[tag payload]` shape; any character outside the four-abit alphabet
// raises an E066 diagnostic. Returns the decoded Node; throws if trailing
// content remains after the top-level frame.
function decodeAnum(s) {
  if (typeof s !== 'string') {
    throw new RmlError('E066', 'anum-decode requires a string input');
  }
  const { node, pos } = decodeAnumAt(s, 0);
  if (pos !== s.length) {
    throw new RmlError('E066', `anum-decode: trailing data at position ${pos}`);
  }
  return node;
}

function decodeAnumAt(s, pos) {
  if (s[pos] !== '[') {
    throw new RmlError('E066', `anum-decode: expected '[' at position ${pos}`);
  }
  pos++;
  const tag = s[pos];
  if (tag === '0') {
    pos++;
    let bits = '';
    while (pos < s.length && s[pos] !== ']') {
      if (s[pos] !== '0' && s[pos] !== '1') {
        throw new RmlError(
          'E066',
          `anum-decode: leaf payload may only contain '0' or '1' (got '${s[pos]}' at ${pos})`,
        );
      }
      bits += s[pos];
      pos++;
    }
    if (s[pos] !== ']') {
      throw new RmlError('E066', `anum-decode: unterminated leaf starting before position ${pos}`);
    }
    pos++;
    return { node: bitstringToString(bits), pos };
  }
  if (tag === '1') {
    pos++;
    const items = [];
    while (pos < s.length && s[pos] !== ']') {
      if (s[pos] !== '[') {
        throw new RmlError(
          'E066',
          `anum-decode: list child must start with '[' (got '${s[pos]}' at ${pos})`,
        );
      }
      const { node, pos: next } = decodeAnumAt(s, pos);
      items.push(node);
      pos = next;
    }
    if (s[pos] !== ']') {
      throw new RmlError('E066', `anum-decode: unterminated list starting before position ${pos}`);
    }
    pos++;
    return { node: items, pos };
  }
  throw new RmlError(
    'E066',
    `anum-decode: expected tag '0' or '1' after '[' at position ${pos}`,
  );
}

function mergeFoundationDescriptors(previous, next) {
  const base = previous ? {
    name: previous.name,
    description: previous.description || null,
    uses: (previous.uses || []).slice(),
    defines: new Map(previous.defines || []),
    extends: previous.extends || null,
    numericDomain: previous.numericDomain || null,
    truthDomain: previous.truthDomain || null,
    carrier: Array.isArray(previous.carrier) ? previous.carrier.slice() : null,
    strictCarrier: previous.strictCarrier === true,
    truthTables: previous.truthTables instanceof Map
      ? new Map([...previous.truthTables.entries()].map(([k, rows]) => [k, rows.map(r => ({ inputs: r.inputs.slice(), output: r.output }))]))
      : null,
    experimental: previous.experimental === true,
    root: previous.root || null,
    abits: Array.isArray(previous.abits)
      ? previous.abits.map(a => ({ symbol: a.symbol, meaning: a.meaning }))
      : null,
  } : {
    name: next.name,
    description: null,
    uses: [],
    defines: new Map(),
    extends: null,
    numericDomain: null,
    truthDomain: null,
    carrier: null,
    strictCarrier: false,
    truthTables: null,
    experimental: false,
    root: null,
    abits: null,
  };
  base.name = next.name;
  if (next.description) base.description = next.description;
  if (Array.isArray(next.uses) && next.uses.length > 0) {
    const seen = new Set(base.uses);
    for (const u of next.uses) {
      if (!seen.has(u)) { seen.add(u); base.uses.push(u); }
    }
  }
  if (next.defines instanceof Map) {
    for (const [k, v] of next.defines.entries()) base.defines.set(k, v);
  }
  if (next.extends) base.extends = next.extends;
  if (next.numericDomain) base.numericDomain = next.numericDomain;
  if (next.truthDomain) base.truthDomain = next.truthDomain;
  // Carrier (issue #97): the explicit set of values legal inside the
  // foundation; opt-in enforcement is controlled by `strictCarrier`. A
  // later registration with the same name replaces the carrier list but
  // only flips `strictCarrier` to true (never silently back off).
  if (Array.isArray(next.carrier) && next.carrier.length > 0) {
    base.carrier = next.carrier.slice();
  }
  if (next.strictCarrier === true) base.strictCarrier = true;
  // Truth tables (issue #97, Section 3 of netkeep80's punch-list). A later
  // registration adds/overwrites table entries operator-by-operator so the
  // user can extend a previously declared foundation with more tables.
  if (next.truthTables instanceof Map && next.truthTables.size > 0) {
    if (!(base.truthTables instanceof Map)) base.truthTables = new Map();
    for (const [k, rows] of next.truthTables.entries()) {
      base.truthTables.set(k, rows.map(r => ({ inputs: r.inputs.slice(), output: r.output })));
    }
  }
  // Experimental foundation profile metadata (issue #97, Phase 9). A later
  // registration can flip `experimental` to true (never silently back to
  // false), set or replace the root symbol, and append additional abits.
  if (next.experimental === true) base.experimental = true;
  if (next.root) base.root = next.root;
  if (Array.isArray(next.abits) && next.abits.length > 0) {
    if (!Array.isArray(base.abits)) base.abits = [];
    const seen = new Set(base.abits.map(a => a.symbol));
    for (const a of next.abits) {
      if (!seen.has(a.symbol)) {
        seen.add(a.symbol);
        base.abits.push({ symbol: a.symbol, meaning: a.meaning });
      }
    }
  }
  return base;
}

// Build a truth-aggregator operator function from its canonical name
// (`avg`, `min`, `max`, `product`/`prod`, `probabilistic_sum`/`ps`). Returns
// `null` for unrecognized names so callers can skip data-only `(defines ...)`
// entries silently. Mirrors the `(<op>: <aggregator>)` resolution path so
// foundation-driven rebindings produce the same semantics as explicit
// operator assignments.
function aggregatorOpFromName(env, sel) {
  if (typeof sel !== 'string') return null;
  const lo = env.lo;
  const agg =
    sel === 'avg' ? xs => xs.reduce((a, b) => a + b, 0) / xs.length :
    sel === 'min' ? xs => xs.length ? Math.min(...xs) : lo :
    sel === 'max' ? xs => xs.length ? Math.max(...xs) : lo :
    sel === 'product' || sel === 'prod' ? xs => xs.reduce((a, b) => a * b, 1) :
    sel === 'probabilistic_sum' || sel === 'ps' ? xs => 1 - xs.reduce((a, b) => a * (1 - b), 1) :
    null;
  if (!agg) return null;
  return (...xs) => xs.length ? agg(xs) : lo;
}

// Resolve a token from a truth-table row (input or output) to a numeric value.
// Numeric literals stay numeric; symbolic constants flow through
// `env.symbolProb` so user-declared truth constants like `(true: 1)` or
// `(unknown: 0.5)` are honoured. Returns `null` when the token cannot be
// resolved so the caller can skip the row gracefully.
function resolveTruthTableValue(env, tok) {
  if (typeof tok !== 'string') return null;
  const num = Number(tok);
  if (Number.isFinite(num)) return num;
  if (env.symbolProb.has(tok)) return env.symbolProb.get(tok);
  return null;
}

// Build a host `Op` function from a finite truth table. When invoked with
// argument vector `xs`, the function looks up the first row whose inputs
// match (within ±1e-12 float tolerance). If no row matches, the function
// delegates to the `previous` op (the snapshot captured at activation),
// which keeps partial tables backward-compatible: a foundation that only
// pins down a few rows still falls through to the host default for the rest.
function truthTableOpFromRows(env, opName, rows, previous) {
  const resolved = [];
  for (const row of rows) {
    const inputs = row.inputs.map(t => resolveTruthTableValue(env, t));
    const output = resolveTruthTableValue(env, row.output);
    if (inputs.some(v => v === null) || output === null) {
      // Skip rows that reference unknown symbols. The user can always
      // re-declare the row once the symbol is bound.
      continue;
    }
    resolved.push({ inputs, output });
  }
  if (resolved.length === 0) return null;
  const fallback = typeof previous === 'function' ? previous : null;
  return (...xs) => {
    for (const row of resolved) {
      if (row.inputs.length !== xs.length) continue;
      let match = true;
      for (let i = 0; i < xs.length; i++) {
        if (typeof xs[i] !== 'number' || !Number.isFinite(xs[i])) { match = false; break; }
        if (Math.abs(xs[i] - row.inputs[i]) > 1e-12) { match = false; break; }
      }
      if (match) return row.output;
    }
    if (fallback) return fallback(...xs);
    // No table row matched and no host fallback exists. Treat as bottom.
    return env.lo;
  };
}

function _truthTableKey(values) {
  return values.map(v => Number(v).toPrecision(15)).join('\u0001');
}

function _resolvedCarrierValues(env, foundation) {
  if (!foundation || foundation.strictCarrier !== true || !Array.isArray(foundation.carrier) || foundation.carrier.length === 0) {
    return null;
  }
  const values = [];
  const seen = new Set();
  for (const tok of foundation.carrier) {
    const value = resolveTruthTableValue(env, tok);
    if (value === null) return null;
    const key = _truthTableKey([value]);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
  }
  return values.length > 0 ? values : null;
}

function truthTableRowsCompleteForCarrier(env, rows, foundation) {
  const carrier = _resolvedCarrierValues(env, foundation);
  if (carrier === null) return false;
  let arity = null;
  const seenRows = new Set();
  for (const row of rows) {
    if (!row || !Array.isArray(row.inputs)) return false;
    if (arity === null) arity = row.inputs.length;
    if (row.inputs.length !== arity) return false;
    const inputs = row.inputs.map(t => resolveTruthTableValue(env, t));
    const output = resolveTruthTableValue(env, row.output);
    if (inputs.some(v => v === null) || output === null) return false;
    seenRows.add(_truthTableKey(inputs));
  }
  if (arity === null) return false;
  const required = carrier.length ** arity;
  if (seenRows.size < required) return false;
  const visit = (prefix, depth) => {
    if (depth === arity) return seenRows.has(_truthTableKey(prefix));
    for (const value of carrier) {
      if (!visit(prefix.concat([value]), depth + 1)) return false;
    }
    return true;
  };
  return visit([], 0);
}

function truthTableFallbackDependencies(env, opName, previousImpl) {
  const deps = [];
  if (previousImpl && Array.isArray(previousImpl.dependsOn) && previousImpl.dependsOn.length > 0) {
    deps.push(...previousImpl.dependsOn);
  } else {
    const rc = env.getRootConstruct(opName);
    if (rc && Array.isArray(rc.dependsOn) && rc.dependsOn.length > 0) {
      deps.push(...rc.dependsOn);
    }
  }
  deps.push('truth-table-fallback');
  return [...new Set(deps)];
}

// Seed the registry with the built-in descriptors that describe what the
// current host implementation actually trusts. Every field is data-only and
// matches the existing implementation: changing this list does not change
// runtime behaviour, only the trust report.
function seedBuiltinRootConstructs(env) {
  const seeds = [
    // Parsing / LiNo layer
    { name: 'lino-parser', kind: 'parser', status: 'external-trusted', encodedAs: 'links-notation', pureLinksReady: false },
    { name: 'canonical-printer', kind: 'printer', status: 'host-primitive', encodedAs: 'keyOf' },
    { name: 'structural-equality', kind: 'equality-layer', status: 'host-primitive', encodedAs: 'isStructurallySame' },
    { name: 'structural-matcher', kind: 'matcher', status: 'external-trusted', semanticStatus: 'host-trusted', encodedAs: 'matchProofPattern' },
    // Numeric layer
    { name: 'decimal-12-arithmetic', kind: 'numeric-domain', status: 'host-primitive', encodedAs: 'decRound', pureLinksReady: false },
    { name: '+', kind: 'arithmetic-operator', status: 'host-primitive', dependsOn: ['decimal-12-arithmetic'] },
    { name: '-', kind: 'arithmetic-operator', status: 'host-primitive', dependsOn: ['decimal-12-arithmetic'] },
    { name: '*', kind: 'arithmetic-operator', status: 'host-primitive', dependsOn: ['decimal-12-arithmetic'] },
    { name: '/', kind: 'arithmetic-operator', status: 'host-primitive', dependsOn: ['decimal-12-arithmetic'] },
    { name: '<', kind: 'comparison-operator', status: 'host-primitive', dependsOn: ['decimal-12-arithmetic'] },
    { name: '<=', kind: 'comparison-operator', status: 'host-primitive', dependsOn: ['decimal-12-arithmetic'] },
    // Truth / aggregator layer
    { name: 'truth-range', kind: 'truth-domain', status: 'user-configurable', encodedAs: 'Env.lo/Env.hi' },
    { name: 'valence', kind: 'truth-domain', status: 'user-configurable', encodedAs: 'Env.valence' },
    { name: 'clamp', kind: 'truth-normalization', status: 'host-primitive', encodedAs: 'Env.clamp' },
    { name: 'quantize', kind: 'truth-normalization', status: 'host-primitive', encodedAs: 'quantize' },
    { name: 'true', kind: 'truth-constant', status: 'user-configurable' },
    { name: 'false', kind: 'truth-constant', status: 'user-configurable' },
    { name: 'unknown', kind: 'truth-constant', status: 'user-configurable' },
    { name: 'undefined', kind: 'truth-constant', status: 'user-configurable' },
    { name: 'avg', kind: 'aggregator', status: 'host-primitive' },
    { name: 'min', kind: 'aggregator', status: 'host-primitive' },
    { name: 'max', kind: 'aggregator', status: 'host-primitive' },
    { name: 'product', kind: 'aggregator', status: 'host-primitive' },
    { name: 'probabilistic_sum', kind: 'aggregator', status: 'host-primitive' },
    { name: 'truth-table-fallback', kind: 'truth-table-fallback', status: 'host-derived' },
    // Logical layer
    { name: 'not', kind: 'truth-operator', status: 'user-configurable', dependsOn: ['truth-range', 'decimal-12-arithmetic'] },
    { name: 'and', kind: 'truth-operator', status: 'user-configurable', dependsOn: ['avg'] },
    { name: 'or', kind: 'truth-operator', status: 'user-configurable', dependsOn: ['max'] },
    { name: 'both', kind: 'truth-operator', status: 'user-configurable', dependsOn: ['avg'] },
    { name: 'neither', kind: 'truth-operator', status: 'user-configurable', dependsOn: ['product'] },
    // Equality layer
    { name: '=', kind: 'equality-layer', status: 'host-primitive', dependsOn: ['structural-equality', 'decimal-12-arithmetic'] },
    { name: '!=', kind: 'equality-layer', status: 'host-derived', dependsOn: ['=', 'not'] },
    { name: 'assigned-equality', kind: 'equality-layer', status: 'host-primitive' },
    { name: 'numeric-equality', kind: 'equality-layer', status: 'host-primitive', dependsOn: ['decimal-12-arithmetic'] },
    { name: 'definitional-equality', kind: 'equality-layer', status: 'host-primitive', dependsOn: ['beta-reduction', 'structural-equality'] },
    // Typed kernel layer
    { name: 'Type', kind: 'universe-form', status: 'host-primitive', pureLinksReady: false, plannedAs: 'links-defined' },
    { name: 'Prop', kind: 'universe-form', status: 'host-primitive', dependsOn: ['Type'] },
    { name: 'Pi', kind: 'binder', status: 'host-primitive', dependsOn: ['Type', 'substitution', 'freshness'] },
    { name: 'lambda', kind: 'binder', status: 'host-primitive', dependsOn: ['Pi', 'substitution'] },
    { name: 'apply', kind: 'eliminator', status: 'host-primitive', dependsOn: ['lambda', 'beta-reduction'] },
    { name: 'beta-reduction', kind: 'reduction-rule', status: 'host-primitive', dependsOn: ['substitution', 'freshness', 'alpha-renaming'] },
    { name: 'substitution', kind: 'meta-operation', status: 'host-primitive', encodedAs: 'substitute' },
    { name: 'freshness', kind: 'meta-operation', status: 'host-primitive', encodedAs: 'evalFresh' },
    { name: 'alpha-renaming', kind: 'meta-operation', status: 'host-primitive' },
    { name: 'normalization', kind: 'reduction-rule', status: 'host-primitive', encodedAs: 'normalizeTerm', dependsOn: ['beta-reduction'] },
    { name: 'whnf', kind: 'reduction-rule', status: 'host-primitive', encodedAs: 'whnfTerm', dependsOn: ['beta-reduction'] },
    { name: 'conversion', kind: 'equality-layer', status: 'host-primitive', dependsOn: ['beta-reduction', 'normalization', 'structural-equality'] },
    // Phase 5 typed-kernel-links proof-substrate rules: links-defined
    // mirrors of `Pi`, `lambda`, `apply`, `beta-reduction` that the
    // `typed-kernel-links` foundation selects. Pre-seeded so the trust
    // audit reports them as `links-defined`/`links-checked` immediately,
    // matching the corresponding declarations in `lib/self/foundations.lino`.
    { name: 'pi-formation', kind: 'typing-rule', status: 'links-defined', dependsOn: ['Pi'] },
    { name: 'lambda-introduction', kind: 'typing-rule', status: 'links-defined', dependsOn: ['lambda'] },
    { name: 'application-elimination', kind: 'typing-rule', status: 'links-defined', dependsOn: ['apply'] },
    { name: 'beta-conversion', kind: 'reduction-rule', status: 'links-defined', dependsOn: ['beta-reduction'] },
    // Inductive / coinductive
    { name: 'inductive', kind: 'declaration', status: 'host-primitive', dependsOn: ['Type', 'Pi'] },
    { name: 'coinductive', kind: 'declaration', status: 'host-primitive', dependsOn: ['Type', 'Pi'] },
    // Proof / tactics layer
    { name: 'proof-replay', kind: 'replay-checker', status: 'host-primitive', encodedAs: 'check.mjs' },
    { name: 'proof-object', kind: 'proof-data', status: 'links-encoded', encodedAs: 'proof-object' },
    { name: 'proof-rule-declaration', kind: 'proof-data', status: 'links-encoded', encodedAs: 'rule' },
    { name: 'proof-checking-relation', kind: 'checking-relation', status: 'links-defined', dependsOn: ['proof-replay', 'structural-equality', 'proof-object'] },
    { name: 'rule-application-check', kind: 'checking-relation', status: 'links-defined', dependsOn: ['proof-replay', 'structural-equality', 'proof-rule-declaration'] },
    { name: 'by', kind: 'proof-rule', status: 'host-primitive' },
    // Links-defined Nat fragment (issue #97). These built-in registry
    // entries let strict mode audit `(eval-nat ...)` even when a program has
    // not loaded `lib/self/foundations.lino`.
    { name: 'Nat', kind: 'inductive-type', status: 'links-defined', semanticStatus: 'links-checked' },
    { name: 'zero', kind: 'constructor', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat'] },
    { name: 'succ', kind: 'constructor', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat'] },
    { name: 'nat-equality', kind: 'equality-layer', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'structural-equality'], encodedAs: 'nat-equals' },
    { name: 'nat-recursion', kind: 'recursor', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'zero', 'succ', 'nat-equality', 'proof-replay', 'structural-equality'] },
    { name: 'add', kind: 'derived-operation', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'zero', 'succ', 'nat-recursion', 'nat-equality'] },
    { name: 'nat-add-zero', kind: 'computation-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['add', 'zero', 'nat-recursion', 'nat-equality'] },
    { name: 'nat-add-succ', kind: 'computation-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['add', 'succ', 'nat-recursion', 'nat-equality'] },
    { name: 'nat-zero-formation', kind: 'typing-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'zero'] },
    { name: 'nat-succ-formation', kind: 'typing-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'succ'] },
    { name: 'forall', kind: 'universal-quantifier', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat'] },
    { name: 'implication', kind: 'logical-connective', status: 'links-defined', semanticStatus: 'links-checked', encodedAs: 'implies' },
    { name: 'predicate-application', kind: 'logical-form', status: 'links-defined', semanticStatus: 'links-checked', encodedAs: 'at' },
    { name: 'nat-induction', kind: 'proof-principle', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'forall', 'implication', 'predicate-application', 'substitution', 'freshness', 'proof-replay', 'structural-equality'] },
    { name: 'nat-refl', kind: 'equality-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'nat-equality'] },
    { name: 'nat-cong-succ', kind: 'equality-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'succ', 'nat-equality'] },
    { name: 'nat-eliminator', kind: 'eliminator', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'nat-recursion', 'nat-induction'] },
    { name: 'nat-rec-zero', kind: 'computation-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['nat-recursion', 'zero', 'nat-equality'] },
    { name: 'nat-rec-succ', kind: 'computation-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['nat-recursion', 'succ', 'nat-equality'] },
    { name: 'mul', kind: 'derived-operation', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['Nat', 'zero', 'succ', 'add', 'nat-recursion', 'nat-equality'] },
    { name: 'nat-mul-zero', kind: 'computation-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['mul', 'zero', 'nat-recursion', 'nat-equality'] },
    { name: 'nat-mul-succ', kind: 'computation-rule', status: 'links-defined', semanticStatus: 'links-checked', dependsOn: ['mul', 'succ', 'add', 'nat-recursion', 'nat-equality'] },
    { name: 'eval-nat-normalize', kind: 'evaluator-fragment', status: 'links-defined', semanticStatus: 'links-evaluated', dependsOn: ['Nat', 'zero', 'succ', 'add', 'mul', 'nat-add-zero', 'nat-add-succ', 'nat-mul-zero', 'nat-mul-succ', 'structural-matcher'] },
    { name: 'eval-nat', kind: 'evaluator', status: 'links-defined', semanticStatus: 'links-evaluated', dependsOn: ['eval-nat-normalize', 'nat-normal-form-to-host-number'] },
    { name: 'nat-normal-form-to-host-number', kind: 'renderer', status: 'host-derived', semanticStatus: 'host-trusted', dependsOn: ['eval-nat-normalize'] },
    { name: 'smt-trusted', kind: 'external-decision', status: 'external-trusted' },
    { name: 'atp-trusted', kind: 'external-decision', status: 'external-trusted' },
    // Metatheorem layer
    { name: 'mode', kind: 'mode-declaration', status: 'host-primitive' },
    { name: 'totality-check', kind: 'metatheorem', status: 'host-primitive' },
    { name: 'coverage-check', kind: 'metatheorem', status: 'host-primitive' },
    { name: 'termination-check', kind: 'metatheorem', status: 'host-primitive' },
    // Self-bootstrap layer
    { name: 'self.evaluator', kind: 'self-bootstrap', status: 'links-encoded', encodedAs: 'lib/self/evaluator.lino' },
    { name: 'self.grammar', kind: 'self-bootstrap', status: 'links-encoded', encodedAs: 'lib/self/grammar.lino' },
    { name: 'self.types', kind: 'self-bootstrap', status: 'links-encoded', encodedAs: 'lib/self/types.lino' },
    { name: 'self.operators', kind: 'self-bootstrap', status: 'links-encoded', encodedAs: 'lib/self/operators.lino' },
    { name: 'self.metatheorem', kind: 'self-bootstrap', status: 'links-encoded', encodedAs: 'lib/self/metatheorem.lino' },
  ];
  for (const seed of seeds) {
    env.rootConstructs.set(seed.name, mergeRootConstructDescriptors(null, seed));
  }
}

// Parse a `(root-construct <name> (status ...) (kind ...) ...)` form into a
// descriptor record. Returns the descriptor or throws an RmlError(E060).
function parseRootConstructForm(node) {
  if (!Array.isArray(node) || node[0] !== 'root-construct' || node.length < 2) {
    throw new RmlError('E060', 'root-construct form must be `(root-construct <name> ...)`');
  }
  const rawName = node[1];
  if (typeof rawName !== 'string' || !rawName) {
    throw new RmlError('E060', 'root-construct name must be a non-empty identifier');
  }
  const descriptor = { name: rawName };
  for (let i = 2; i < node.length; i++) {
    const child = node[i];
    if (!Array.isArray(child) || child.length < 1 || typeof child[0] !== 'string') {
      throw new RmlError('E060', 'root-construct child clauses must be lists led by a keyword');
    }
    const key = child[0];
    const rest = child.slice(1);
    switch (key) {
      case 'status':
        if (rest.length !== 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E060', '(status ...) requires one symbol');
        }
        descriptor.status = rest[0];
        break;
      case 'semantic-status':
        if (rest.length !== 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E060', '(semantic-status ...) requires one symbol');
        }
        descriptor.semanticStatus = rest[0];
        break;
      case 'kind':
        if (rest.length !== 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E060', '(kind ...) requires one symbol');
        }
        descriptor.kind = rest[0];
        break;
      case 'depends-on':
        descriptor.dependsOn = rest.map(t => Array.isArray(t) ? keyOf(t) : String(t));
        break;
      case 'encoded-as':
        descriptor.encodedAs = rest.map(t => Array.isArray(t) ? keyOf(t) : String(t)).join(' ');
        break;
      case 'pure-links-ready':
        if (rest.length !== 1 || (rest[0] !== 'yes' && rest[0] !== 'no')) {
          throw new RmlError('E060', '(pure-links-ready ...) must be `yes` or `no`');
        }
        descriptor.pureLinksReady = rest[0] === 'yes';
        break;
      case 'override':
        descriptor.override = rest.map(t => Array.isArray(t) ? keyOf(t) : String(t)).join(' ');
        break;
      case 'planned-as':
        descriptor.plannedAs = rest.map(t => Array.isArray(t) ? keyOf(t) : String(t)).join(' ');
        break;
      case 'foundation':
        if (rest.length !== 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E060', '(foundation ...) must be a single name');
        }
        descriptor.foundation = rest[0];
        break;
      case 'implemented-by':
        descriptor.encodedAs = rest.map(t => Array.isArray(t) ? keyOf(t) : String(t)).join(' ');
        break;
      case 'surface':
      case 'description':
      case 'used-by':
        // free-form annotation; ignore for now but accept syntactically
        break;
      default:
        // Unknown clause: accept silently to allow forward compatibility.
        break;
    }
  }
  return descriptor;
}

function parseFoundationForm(node) {
  if (!Array.isArray(node) || node[0] !== 'foundation' || node.length < 2) {
    throw new RmlError('E061', 'foundation form must be `(foundation <name> ...)`');
  }
  const rawName = node[1];
  if (typeof rawName !== 'string' || !rawName) {
    throw new RmlError('E061', 'foundation name must be a non-empty identifier');
  }
  const foundation = { name: rawName, uses: [], defines: new Map() };
  for (let i = 2; i < node.length; i++) {
    const child = node[i];
    if (!Array.isArray(child) || child.length < 1 || typeof child[0] !== 'string') {
      throw new RmlError('E061', 'foundation child clauses must be lists led by a keyword');
    }
    const key = child[0];
    const rest = child.slice(1);
    switch (key) {
      case 'uses':
        for (const u of rest) foundation.uses.push(Array.isArray(u) ? keyOf(u) : String(u));
        break;
      case 'defines':
        if (rest.length < 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E061', '(defines <construct> <implementation>) requires a construct name');
        }
        foundation.defines.set(rest[0], rest.slice(1).map(t => Array.isArray(t) ? keyOf(t) : String(t)).join(' ') || 'links-defined');
        break;
      case 'extends':
        if (rest.length !== 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E061', '(extends ...) requires one foundation name');
        }
        foundation.extends = rest[0];
        break;
      case 'numeric-domain':
        if (rest.length !== 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E061', '(numeric-domain ...) requires one name');
        }
        foundation.numericDomain = rest[0];
        break;
      case 'truth-domain':
        if (rest.length !== 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E061', '(truth-domain ...) requires one name');
        }
        foundation.truthDomain = rest[0];
        break;
      case 'carrier':
        // `(carrier <val1> <val2> ...)` — list the values that the active
        // foundation considers legal. Each value is kept as a string so
        // `enterFoundation` can resolve symbolic constants (`true`, `false`,
        // `unknown`) through `env.symbolProb` at activation time. Numeric
        // literals stay literal.
        if (rest.length === 0) {
          throw new RmlError('E061', '(carrier ...) requires at least one value');
        }
        foundation.carrier = rest.map(t => Array.isArray(t) ? keyOf(t) : String(t));
        break;
      case 'strict-carrier':
        // `(strict-carrier)` opts the foundation into runtime enforcement.
        // Without this clause, `(carrier ...)` is informational only and the
        // evaluator stays backward-compatible.
        foundation.strictCarrier = true;
        break;
      case 'truth-table': {
        // `(truth-table <op> (in1 in2 ... -> out) ...)` — links-defined finite
        // truth table that rebinds `<op>` for the duration of the foundation.
        // Each row's inputs and output may be numeric literals or symbolic
        // truth constants (`true`, `false`, `unknown`); the latter are
        // resolved through `env.symbolProb` when the foundation is entered.
        if (rest.length < 1 || typeof rest[0] !== 'string') {
          throw new RmlError('E061', '(truth-table <op> ...) requires an operator name');
        }
        const tableOp = rest[0];
        const rows = [];
        for (const raw of rest.slice(1)) {
          if (!Array.isArray(raw)) {
            throw new RmlError(
              'E061',
              `(truth-table ${tableOp} ...) rows must be lists like (in1 in2 -> out)`,
            );
          }
          const arrowAt = raw.findIndex(t => t === '->');
          if (arrowAt < 1 || arrowAt !== raw.length - 2) {
            throw new RmlError(
              'E061',
              `(truth-table ${tableOp} ...) row must be (input ... -> output)`,
            );
          }
          const inputs = raw.slice(0, arrowAt).map(t => Array.isArray(t) ? keyOf(t) : String(t));
          const output = Array.isArray(raw[arrowAt + 1]) ? keyOf(raw[arrowAt + 1]) : String(raw[arrowAt + 1]);
          rows.push({ inputs, output });
        }
        if (rows.length === 0) {
          throw new RmlError(
            'E061',
            `(truth-table ${tableOp} ...) requires at least one row`,
          );
        }
        if (!(foundation.truthTables instanceof Map)) foundation.truthTables = new Map();
        foundation.truthTables.set(tableOp, rows);
        break;
      }
      case 'description':
        foundation.description = rest.map(t => Array.isArray(t) ? keyOf(t) : String(t)).join(' ');
        break;
      case 'experimental':
        // `(experimental)` flags the foundation as experimental so the trust
        // audit can call it out (issue #97, Phase 9). Data-only.
        foundation.experimental = true;
        break;
      case 'root':
        // `(root <symbol>)` records the foundation's root concept (e.g. `∞`
        // for mtc-anum). Informational; surfaced on the report.
        if (rest.length !== 1) {
          throw new RmlError('E061', '(root <symbol>) requires exactly one value');
        }
        foundation.root = Array.isArray(rest[0]) ? keyOf(rest[0]) : String(rest[0]);
        break;
      case 'abit': {
        // `(abit <symbol> <meaning...>)` records one atomic bit of the
        // foundation's alphabet. The mtc-anum profile lists four abits:
        // `[`, `]`, `1`, `0`. Informational; surfaced on the report.
        if (rest.length < 1) {
          throw new RmlError('E061', '(abit <symbol> <meaning>) requires a symbol');
        }
        const symbol = Array.isArray(rest[0]) ? keyOf(rest[0]) : String(rest[0]);
        const meaning = rest.slice(1).map(t => Array.isArray(t) ? keyOf(t) : String(t)).join(' ');
        if (!Array.isArray(foundation.abits)) foundation.abits = [];
        foundation.abits.push({ symbol, meaning });
        break;
      }
      default:
        break;
    }
  }
  return foundation;
}

// Render the foundation report as a human-readable text block. Used by the
// CLI's `--foundation-report` flag and by the test suite.
function formatFoundationReport(report) {
  const lines = [];
  lines.push(`Foundation report:`);
  lines.push(`  active foundation: ${report.activeFoundation}`);
  if (report.description) {
    lines.push(`  description: ${report.description}`);
  }
  if (report.numericDomain) {
    lines.push(`  numeric domain: ${report.numericDomain}`);
  }
  if (report.truthDomain) {
    lines.push(`  truth domain: ${report.truthDomain}`);
  }
  const orderedStatuses = [
    'host-primitive',
    'host-derived',
    'external-trusted',
    'user-configurable',
    'links-encoded',
    'links-defined',
    'user-overridden',
    'planned',
  ];
  const seen = new Set();
  for (const status of orderedStatuses) {
    const names = report.byStatus[status];
    if (Array.isArray(names) && names.length > 0) {
      lines.push('');
      lines.push(`${status}:`);
      for (const name of names) lines.push(`  - ${name}`);
      seen.add(status);
    }
  }
  for (const [status, names] of Object.entries(report.byStatus)) {
    if (seen.has(status)) continue;
    if (Array.isArray(names) && names.length > 0) {
      lines.push('');
      lines.push(`${status}:`);
      for (const name of names) lines.push(`  - ${name}`);
    }
  }
  if (report.bySemanticStatus && Object.keys(report.bySemanticStatus).length > 0) {
    lines.push('');
    lines.push('semantic statuses:');
    const seenSemantic = new Set();
    for (const status of SEMANTIC_STATUS_ORDER) {
      const names = report.bySemanticStatus[status];
      if (Array.isArray(names) && names.length > 0) {
        lines.push(`  ${status}: ${names.join(', ')}`);
        seenSemantic.add(status);
      }
    }
    for (const [status, names] of Object.entries(report.bySemanticStatus)) {
      if (seenSemantic.has(status)) continue;
      if (Array.isArray(names) && names.length > 0) {
        lines.push(`  ${status}: ${names.join(', ')}`);
      }
    }
  }
  if (report.foundations && report.foundations.length > 0) {
    lines.push('');
    lines.push('foundations:');
    for (const f of report.foundations) {
      const tag = f.experimental === true ? ' [experimental]' : '';
      lines.push(`  - ${f.name}${tag}${f.description ? ` — ${f.description}` : ''}`);
      if (f.numericDomain) lines.push(`      numeric domain: ${f.numericDomain}`);
      if (f.truthDomain) lines.push(`      truth domain: ${f.truthDomain}`);
      if (f.root) lines.push(`      root: ${f.root}`);
      if (Array.isArray(f.abits) && f.abits.length > 0) {
        const abitStrs = f.abits.map(a => `${a.symbol}=${a.meaning}`);
        lines.push(`      abits: ${abitStrs.join(', ')}`);
      }
      if (f.uses && f.uses.length) lines.push(`      uses: ${f.uses.join(', ')}`);
      if (f.defines && f.defines.length) {
        const defStrs = f.defines.map(d => `${d.construct}=${d.implementation}`);
        lines.push(`      defines: ${defStrs.join(', ')}`);
      }
      if (Array.isArray(f.truthTables) && f.truthTables.length > 0) {
        const tt = f.truthTables.map(t => `${t.op}(${t.rows.length} rows)`);
        lines.push(`      truth tables: ${tt.join(', ')}`);
      }
    }
  }
  if (Array.isArray(report.activeImplementations) && report.activeImplementations.length > 0) {
    lines.push('');
    lines.push('active implementations:');
    for (const impl of report.activeImplementations) {
      const parts = [];
      if (impl.status) parts.push(impl.status);
      if (impl.semanticStatus) parts.push(`semantic ${impl.semanticStatus}`);
      if (impl.implementation) parts.push(`via ${impl.implementation}`);
      if (impl.foundation) parts.push(`foundation ${impl.foundation}`);
      if (Array.isArray(impl.dependsOn) && impl.dependsOn.length > 0) {
        parts.push(`depends on ${impl.dependsOn.join(', ')}`);
      }
      lines.push(`  - ${impl.construct}: ${parts.join('; ')}`);
    }
  }
  if (Array.isArray(report.proofRules) && report.proofRules.length > 0) {
    lines.push('');
    lines.push('proof rules:');
    for (const r of report.proofRules) {
      lines.push(`  - ${r.name} (${r.premises.length} premises → ${r.conclusion})`);
    }
  }
  if (Array.isArray(report.proofAssumptions) && report.proofAssumptions.length > 0) {
    lines.push('');
    lines.push('proof assumptions:');
    for (const a of report.proofAssumptions) {
      lines.push(`  - ${a.name} [${a.kind}] : ${a.judgement}`);
    }
  }
  if (Array.isArray(report.proofObjects) && report.proofObjects.length > 0) {
    lines.push('');
    lines.push('proof objects:');
    for (const po of report.proofObjects) {
      const refs = Array.isArray(po.premiseRefs) && po.premiseRefs.length > 0
        ? ` using ${po.premiseRefs.join(', ')}`
        : '';
      lines.push(`  - ${po.name} : applies ${po.rule} (${po.premises.length} premises${refs} → ${po.conclusion})`);
    }
  }
  if (report.strictPureLinks === true) {
    lines.push('');
    lines.push('pure-links strict mode: on');
    if (Array.isArray(report.allowedHostPrimitives) && report.allowedHostPrimitives.length > 0) {
      lines.push(`  allowed host primitives: ${report.allowedHostPrimitives.join(', ')}`);
    }
  }
  if (report.dependencyGraph && typeof report.dependencyGraph === 'object') {
    const names = Object.keys(report.dependencyGraph).sort();
    const nonEmpty = names.filter(n => {
      const deps = report.dependencyGraph[n];
      return Array.isArray(deps) && deps.length > 0;
    });
    if (nonEmpty.length > 0) {
      lines.push('');
      lines.push('dependency graph (transitive):');
      for (const name of nonEmpty) {
        lines.push(`  - ${name} → ${report.dependencyGraph[name].join(', ')}`);
      }
    }
  }
  return lines.join('\n');
}

// ---------- Proof-object substrate parsers (issue #97, Phase 3) ----------
//
// Data-only self-bootstrap files also use `(rule ...)` forms. Route to the
// proof substrate only when every child clause is a proof premise/conclusion
// and at least one conclusion exists.
function isProofRuleShape(node) {
  return Array.isArray(node) &&
    node[0] === 'rule' &&
    typeof node[1] === 'string' &&
    node[1] &&
    node.length >= 3 &&
    node.slice(2).every(c => Array.isArray(c) && (c[0] === 'premise' || c[0] === 'conclusion')) &&
    node.slice(2).some(c => c[0] === 'conclusion');
}

// Parse a `(rule <name> (premise <pat>)... (conclusion <pat>))` declaration.
// Patterns are plain link nodes; leaves whose token starts with `?` are
// metavariables and bind during `(check-proof <name>)` matching. Repeated
// metavariables inside a pattern must structurally match. Any other leaf is
// a literal that must equal the candidate node exactly.
function parseRuleForm(node) {
  if (!Array.isArray(node) || node[0] !== 'rule' || node.length < 2) {
    throw new RmlError('E064', 'rule form must be `(rule <name> (premise <pat>)... (conclusion <pat>))`');
  }
  if (typeof node[1] !== 'string' || !node[1]) {
    throw new RmlError('E064', 'rule name must be a non-empty identifier');
  }
  const rule = { name: node[1], premises: [], conclusion: null };
  for (const child of node.slice(2)) {
    if (!Array.isArray(child) || child.length < 1 || typeof child[0] !== 'string') {
      throw new RmlError('E064', `rule ${rule.name}: clauses must be lists led by a keyword`);
    }
    const key = child[0];
    if (key === 'premise') {
      if (child.length !== 2) {
        throw new RmlError('E064', `rule ${rule.name}: (premise <pat>) requires exactly one pattern`);
      }
      rule.premises.push(child[1]);
    } else if (key === 'conclusion') {
      if (child.length !== 2) {
        throw new RmlError('E064', `rule ${rule.name}: (conclusion <pat>) requires exactly one pattern`);
      }
      if (rule.conclusion !== null) {
        throw new RmlError('E064', `rule ${rule.name}: only one (conclusion ...) clause is allowed`);
      }
      rule.conclusion = child[1];
    } else {
      throw new RmlError('E064', `rule ${rule.name}: unknown clause keyword ${key}`);
    }
  }
  if (rule.conclusion === null) {
    throw new RmlError('E064', `rule ${rule.name}: at least one (conclusion <pat>) clause is required`);
  }
  return rule;
}

// Parse `(assumption <name> (judgement <judgement>))` and
// `(axiom <name> (judgement <judgement>))` proof leaves. These are explicit
// proof dependencies: a proof object may cite them with `(premise-by <name>)`
// or `(uses <name>)`, making assumptions visible instead of letting arbitrary
// premises appear inside a proof object without justification.
function parseProofAssumptionForm(node) {
  if (!Array.isArray(node) || (node[0] !== 'assumption' && node[0] !== 'axiom') || node.length < 2) {
    throw new RmlError('E064', 'proof assumption form must be `(assumption <name> (judgement <j>))` or `(axiom <name> (judgement <j>))`');
  }
  const kind = node[0];
  if (typeof node[1] !== 'string' || !node[1]) {
    throw new RmlError('E064', `${kind} name must be a non-empty identifier`);
  }
  const assumption = { name: node[1], kind, judgement: null };
  for (const child of node.slice(2)) {
    if (!Array.isArray(child) || child.length < 1 || typeof child[0] !== 'string') {
      throw new RmlError('E064', `${kind} ${assumption.name}: clauses must be lists led by a keyword`);
    }
    if (child[0] !== 'judgement') {
      throw new RmlError('E064', `${kind} ${assumption.name}: unknown clause keyword ${child[0]}`);
    }
    if (child.length !== 2) {
      throw new RmlError('E064', `${kind} ${assumption.name}: (judgement <j>) requires one argument`);
    }
    if (assumption.judgement !== null) {
      throw new RmlError('E064', `${kind} ${assumption.name}: only one (judgement ...) clause is allowed`);
    }
    assumption.judgement = child[1];
  }
  if (assumption.judgement === null) {
    throw new RmlError('E064', `${kind} ${assumption.name}: (judgement <j>) clause is required`);
  }
  return assumption;
}

// Parse a `(proof-object <name> (applies <rule>) (premise <judgement>)...
// (premise-by <dependency>)... (conclusion <judgement>))` declaration into a
// descriptor stored on the env.
function parseProofObjectForm(node) {
  if (!Array.isArray(node) || node[0] !== 'proof-object' || node.length < 2) {
    throw new RmlError('E064', 'proof-object form must be `(proof-object <name> (applies <rule>) ...)`');
  }
  if (typeof node[1] !== 'string' || !node[1]) {
    throw new RmlError('E064', 'proof-object name must be a non-empty identifier');
  }
  const po = { name: node[1], rule: null, premises: [], premiseRefs: [], conclusion: null };
  for (const child of node.slice(2)) {
    if (!Array.isArray(child) || child.length < 1 || typeof child[0] !== 'string') {
      throw new RmlError('E064', `proof-object ${po.name}: clauses must be lists led by a keyword`);
    }
    const key = child[0];
    if (key === 'applies') {
      if (child.length !== 2 || typeof child[1] !== 'string') {
        throw new RmlError('E064', `proof-object ${po.name}: (applies <rule>) requires a rule name`);
      }
      po.rule = child[1];
    } else if (key === 'premise') {
      if (child.length !== 2) {
        throw new RmlError('E064', `proof-object ${po.name}: (premise <judgement>) requires one argument`);
      }
      po.premises.push(child[1]);
    } else if (key === 'premise-by') {
      if (child.length !== 2 || typeof child[1] !== 'string' || !child[1]) {
        throw new RmlError('E064', `proof-object ${po.name}: (premise-by <name>) requires a dependency name`);
      }
      po.premiseRefs.push(child[1]);
    } else if (key === 'uses') {
      if (child.length < 2) {
        throw new RmlError('E064', `proof-object ${po.name}: (uses <name>...) requires at least one dependency name`);
      }
      for (const ref of child.slice(1)) {
        if (typeof ref !== 'string' || !ref) {
          throw new RmlError('E064', `proof-object ${po.name}: (uses ...) dependencies must be names`);
        }
        po.premiseRefs.push(ref);
      }
    } else if (key === 'conclusion') {
      if (child.length !== 2) {
        throw new RmlError('E064', `proof-object ${po.name}: (conclusion <judgement>) requires one argument`);
      }
      if (po.conclusion !== null) {
        throw new RmlError('E064', `proof-object ${po.name}: only one (conclusion ...) clause is allowed`);
      }
      po.conclusion = child[1];
    } else {
      throw new RmlError('E064', `proof-object ${po.name}: unknown clause keyword ${key}`);
    }
  }
  if (po.rule === null) {
    throw new RmlError('E064', `proof-object ${po.name}: (applies <rule>) clause is required`);
  }
  if (po.conclusion === null) {
    throw new RmlError('E064', `proof-object ${po.name}: (conclusion <judgement>) clause is required`);
  }
  return po;
}

// Structural matcher: walks `pattern` against `candidate` in parallel. Leaves
// whose token starts with `?` are metavariables and bind into `subs`. Repeated
// metavariables must structurally match. Lists must have equal length and
// match pair-wise. Returns true on success and mutates `subs` in place.
function matchProofPattern(pattern, candidate, subs) {
  if (typeof pattern === 'string') {
    if (pattern.startsWith('?')) {
      if (Object.prototype.hasOwnProperty.call(subs, pattern)) {
        return keyOf(subs[pattern]) === keyOf(candidate);
      }
      subs[pattern] = candidate;
      return true;
    }
    return typeof candidate === 'string' && candidate === pattern;
  }
  if (!Array.isArray(pattern) || !Array.isArray(candidate)) return false;
  if (pattern.length !== candidate.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (!matchProofPattern(pattern[i], candidate[i], subs)) return false;
  }
  return true;
}

function _resolveProofDependency(env, ref, stack) {
  const assumption = env.getProofAssumption(ref);
  if (assumption) {
    return { ok: true, judgement: assumption.judgement, kind: assumption.kind };
  }
  const po = env.getProofObject(ref);
  if (!po) {
    return { ok: false, error: `unknown proof dependency ${ref}` };
  }
  const verdict = checkProofObject(env, ref, stack);
  if (!verdict.ok) return verdict;
  return { ok: true, judgement: po.conclusion, kind: 'proof-object' };
}

// Validate a `(proof-object <name>)` against its declared rule and recursively
// verify every `(premise-by ...)` / `(uses ...)` dependency. Returns
// `{ ok: true }` on success or `{ ok: false, error: '...' }` on failure so the
// caller can decide whether to emit E064 or surface the result differently.
function checkProofObject(env, name, stack = []) {
  if (stack.includes(name)) {
    return { ok: false, error: `cyclic proof dependency: ${stack.concat([name]).join(' -> ')}` };
  }
  const po = env.getProofObject(name);
  if (!po) return { ok: false, error: `unknown proof-object ${name}` };
  const rule = env.getProofRule(po.rule);
  if (!rule) return { ok: false, error: `proof-object ${name} references unknown rule ${po.rule}` };
  const refs = Array.isArray(po.premiseRefs) ? po.premiseRefs : [];
  let effectivePremises = po.premises.slice();
  const dependencyStack = stack.concat([name]);
  if (refs.length > 0) {
    effectivePremises = [];
    for (let i = 0; i < refs.length; i++) {
      const resolved = _resolveProofDependency(env, refs[i], dependencyStack);
      if (!resolved.ok) return resolved;
      effectivePremises.push(resolved.judgement);
      if (po.premises.length > 0 && po.premises[i] !== undefined && !isStructurallySame(po.premises[i], resolved.judgement)) {
        return {
          ok: false,
          error: `proof-object ${name}: premise ${i + 1} does not match referenced judgement ${refs[i]}`,
        };
      }
    }
    if (po.premises.length > 0 && po.premises.length !== refs.length) {
      return {
        ok: false,
        error: `proof-object ${name}: has ${po.premises.length} explicit premise(s) but ${refs.length} proof dependency reference(s)`,
      };
    }
  } else if (po.premises.length > 0) {
    return {
      ok: false,
      error: `proof-object ${name}: premise 1 is unjustified; use (premise-by <name>) or declare an assumption/axiom`,
    };
  }
  if (effectivePremises.length !== rule.premises.length) {
    return {
      ok: false,
      error: `proof-object ${name}: expected ${rule.premises.length} premise(s) for rule ${po.rule}, got ${effectivePremises.length}`,
    };
  }
  const subs = {};
  for (let i = 0; i < rule.premises.length; i++) {
    if (!matchProofPattern(rule.premises[i], effectivePremises[i], subs)) {
      return {
        ok: false,
        error: `proof-object ${name}: premise ${i + 1} does not match rule ${po.rule}`,
      };
    }
  }
  if (!matchProofPattern(rule.conclusion, po.conclusion, subs)) {
    return { ok: false, error: `proof-object ${name}: conclusion does not match rule ${po.rule}` };
  }
  return { ok: true, substitution: subs, dependencies: refs.slice() };
}

// ---------- Links-evaluated Peano fragment (issue #97, Phase 14) ----------
//
// `(eval-nat <term>)` normalizes a closed Peano term by consulting the
// active links-level computation rules. The semantic result is the Peano
// normal form; the host number returned to the legacy result stream is only
// a renderer for that normal form. Custom `(rule nat-add-zero ...)` /
// `(rule nat-add-succ ...)` declarations therefore change evaluation, and a
// scoped foundation that omits a needed rule makes evaluation fail.

const DEFAULT_EVAL_NAT_RULES = new Map([
  ['nat-add-zero', {
    name: 'nat-add-zero',
    premises: [['?n', 'has-type', 'Nat']],
    conclusion: [['add', 'zero', '?n'], 'nat-equals', '?n'],
  }],
  ['nat-add-succ', {
    name: 'nat-add-succ',
    premises: [[['add', '?m', '?n'], 'nat-equals', '?k']],
    conclusion: [['add', ['succ', '?m'], '?n'], 'nat-equals', ['succ', '?k']],
  }],
  ['nat-mul-zero', {
    name: 'nat-mul-zero',
    premises: [['?n', 'has-type', 'Nat']],
    conclusion: [['mul', 'zero', '?n'], 'nat-equals', 'zero'],
  }],
  ['nat-mul-succ', {
    name: 'nat-mul-succ',
    premises: [
      [['mul', '?m', '?n'], 'nat-equals', '?k'],
      [['add', '?n', '?k'], 'nat-equals', '?s'],
    ],
    conclusion: [['mul', ['succ', '?m'], '?n'], 'nat-equals', '?s'],
  }],
]);

function cloneProofTerm(term) {
  return Array.isArray(term) ? term.map(cloneProofTerm) : term;
}

function instantiateProofPattern(pattern, subs) {
  if (typeof pattern === 'string' && pattern.startsWith('?')) {
    return Object.prototype.hasOwnProperty.call(subs, pattern)
      ? cloneProofTerm(subs[pattern])
      : pattern;
  }
  if (Array.isArray(pattern)) return pattern.map(p => instantiateProofPattern(p, subs));
  return pattern;
}

function evalNatFoundationUses(env, foundationName, ruleName, seen = new Set()) {
  if (seen.has(foundationName)) return false;
  seen.add(foundationName);
  const foundation = env && env.getFoundation(foundationName);
  if (!foundation) return false;
  if (Array.isArray(foundation.uses) && foundation.uses.includes(ruleName)) return true;
  return foundation.extends ? evalNatFoundationUses(env, foundation.extends, ruleName, seen) : false;
}

function evalNatActiveFoundationUses(env, name) {
  const active = env && env.activeFoundation ? env.activeFoundation : 'default-rml';
  if (active === 'default-rml') return true;
  return evalNatFoundationUses(env, active, name);
}

function evalNatRule(env, name) {
  if (!evalNatActiveFoundationUses(env, name)) {
    throw new RmlError('E067', `eval-nat requires ${name}, but it is not available in active foundation ${env.activeFoundation || 'default-rml'}`);
  }
  return (env && env.getProofRule(name)) || DEFAULT_EVAL_NAT_RULES.get(name) || null;
}

function evalNatEqualityConclusion(rule, ruleName) {
  const conclusion = rule && rule.conclusion;
  if (!Array.isArray(conclusion) || conclusion.length !== 3 || conclusion[1] !== 'nat-equals') {
    throw new RmlError('E067', `eval-nat rule ${ruleName} must conclude (<term> nat-equals <term>)`);
  }
  return { left: conclusion[0], right: conclusion[2] };
}

function processEvalNatPremises(env, rule, subs, normalize, depth) {
  for (const premise of rule.premises || []) {
    if (Array.isArray(premise) && premise.length === 3 && premise[1] === 'nat-equals') {
      const premiseInput = instantiateProofPattern(premise[0], subs);
      const premiseNormal = normalize(premiseInput, depth + 1);
      if (!matchProofPattern(premise[2], premiseNormal, subs)) {
        throw new RmlError(
          'E067',
          `eval-nat rule ${rule.name} premise ${keyOf(premise)} did not match normal form ${keyOf(premiseNormal)}`,
        );
      }
      continue;
    }
    if (Array.isArray(premise) && premise.length === 3 && premise[1] === 'has-type' && premise[2] === 'Nat') {
      continue;
    }
    throw new RmlError('E067', `eval-nat rule ${rule.name} has unsupported premise ${keyOf(premise)}`);
  }
}

function applyEvalNatRule(env, ruleName, term, steps, normalize, depth) {
  const rule = evalNatRule(env, ruleName);
  if (!rule) throw new RmlError('E067', `eval-nat requires ${ruleName}, but no links-level rule is registered`);
  const { left, right } = evalNatEqualityConclusion(rule, ruleName);
  const subs = {};
  if (!matchProofPattern(left, term, subs)) {
    throw new RmlError('E067', `eval-nat rule ${ruleName} does not apply to ${keyOf(term)}`);
  }
  steps.push(rule.name);
  processEvalNatPremises(env, rule, subs, normalize, depth);
  return normalize(instantiateProofPattern(right, subs), depth + 1);
}

function peanoNormalFormToHostNumber(term) {
  if (term === 'zero') return 0;
  if (Array.isArray(term) && term.length === 2 && term[0] === 'succ') {
    return 1 + peanoNormalFormToHostNumber(term[1]);
  }
  throw new RmlError('E067', `eval-nat produced a non-Peano normal form: ${formatTraceValue(term)}`);
}

function evalNatTerm(env, node) {
  const steps = [];
  const normalize = (t, depth = 0) => {
    if (depth > 10000) {
      throw new RmlError('E067', 'eval-nat exceeded its structural rewrite limit');
    }
    if (t === 'zero') return 'zero';
    if (Array.isArray(t)) {
      if (t.length === 2 && t[0] === 'succ') {
        return ['succ', normalize(t[1], depth + 1)];
      }
      if (t.length === 3 && t[0] === 'add') {
        const left = normalize(t[1], depth + 1);
        const current = ['add', left, cloneProofTerm(t[2])];
        if (left === 'zero') {
          return applyEvalNatRule(env, 'nat-add-zero', current, steps, normalize, depth + 1);
        }
        if (Array.isArray(left) && left.length === 2 && left[0] === 'succ') {
          return applyEvalNatRule(env, 'nat-add-succ', current, steps, normalize, depth + 1);
        }
      }
      if (t.length === 3 && t[0] === 'mul') {
        const left = normalize(t[1], depth + 1);
        const current = ['mul', left, cloneProofTerm(t[2])];
        if (left === 'zero') {
          return applyEvalNatRule(env, 'nat-mul-zero', current, steps, normalize, depth + 1);
        }
        if (Array.isArray(left) && left.length === 2 && left[0] === 'succ') {
          return applyEvalNatRule(env, 'nat-mul-succ', current, steps, normalize, depth + 1);
        }
      }
    }
    throw new RmlError(
      'E067',
      `eval-nat: not a closed Peano term: ${formatTraceValue(t)}`,
    );
  };
  const normalForm = normalize(node);
  const value = peanoNormalFormToHostNumber(normalForm);
  return { value, normalForm, steps };
}

// ---------- Pure-links strict mode (issue #97, Phase 6) ----------
//
// `(strict-foundation pure-links)` turns the strict mode on; everything inside
// a queried form is then audited against the root-construct registry. Any
// operator leaf whose status is `host-primitive` or `host-derived` produces
// an E065 diagnostic — unless the construct name has been explicitly allow-
// listed with `(allow-host-primitive <name>...)`. The mode is sticky for the
// remainder of the file, which mirrors the way `(strict-carrier)` works
// inside `(with-foundation ...)`.

function parseStrictFoundationForm(node) {
  if (!Array.isArray(node) || node[0] !== 'strict-foundation') {
    throw new RmlError('E065', '(strict-foundation <profile>) is required');
  }
  if (node.length !== 2 || typeof node[1] !== 'string' || !node[1]) {
    throw new RmlError('E065', '(strict-foundation <profile>) requires a single profile name');
  }
  if (node[1] !== 'pure-links') {
    throw new RmlError('E065', `unknown strict-foundation profile: ${node[1]} (expected pure-links)`);
  }
  return { profile: node[1] };
}

function parseAllowHostPrimitiveForm(node) {
  if (!Array.isArray(node) || node[0] !== 'allow-host-primitive') {
    throw new RmlError('E065', '(allow-host-primitive <name>...) is required');
  }
  if (node.length < 2) {
    throw new RmlError('E065', '(allow-host-primitive <name>...) requires at least one construct name');
  }
  const names = [];
  for (const tok of node.slice(1)) {
    if (typeof tok !== 'string' || !tok) {
      throw new RmlError('E065', '(allow-host-primitive ...) names must be non-empty identifiers');
    }
    names.push(tok);
  }
  return { names };
}

// Operator leaves that the strict scanner is *not* meant to audit. These are
// either internal proof markers (`by`, `because`, ...) or surface keywords
// that have nothing to do with the host-primitive substrate (`with`, `proof`,
// query head `?`). Adding them here keeps the scanner from emitting false
// positives for forms that are not really "operators" in the registry sense.
const PURE_LINKS_SCANNER_IGNORED = new Set([
  '?', 'with', 'proof',
  'by', 'because',
  'let', 'in', 'where',
  ':', '::',
  'has', 'probability',
  'is', 'a', 'an',
  'sequence', 'normalizes-to',
  'applies', 'premise', 'premise-by', 'conclusion', 'uses', 'judgement',
  'assumption', 'axiom', 'rule', 'proof-object', 'check-proof', 'proof-report',
  'foundation', 'with-foundation', 'foundation-report', 'foundation-report?',
  'root-construct', 'strict-carrier', 'truth-table',
  'strict-foundation', 'allow-host-primitive',
]);

function _isStrictlyOffendingStatus(status) {
  return status === 'host-primitive' || status === 'host-derived';
}

function _strictDependencyOffenders(env, name, path = []) {
  const allow = env.allowedHostPrimitives instanceof Set ? env.allowedHostPrimitives : new Set();
  if (allow.has(name)) return [];
  if (path.includes(name)) return [];
  const currentPath = path.concat([name]);
  const active = env.activeImplementations instanceof Map ? env.activeImplementations.get(name) : null;
  const rc = env.getRootConstruct(name);
  const status = active && active.status ? active.status : (rc && rc.status);
  const deps = active && Array.isArray(active.dependsOn)
    ? active.dependsOn
    : (rc && Array.isArray(rc.dependsOn) ? rc.dependsOn : []);
  if (active && active.status === 'links-defined' && deps.length === 0) {
    return [];
  }
  if (_isStrictlyOffendingStatus(status) && deps.length === 0) {
    return [`${currentPath.join(' -> ')} -> ${status}`];
  }
  const offenders = [];
  for (const dep of deps) {
    if (allow.has(dep)) continue;
    offenders.push(..._strictDependencyOffenders(env, dep, currentPath));
  }
  if (_isStrictlyOffendingStatus(status) && offenders.length === 0) {
    offenders.push(`${currentPath.join(' -> ')} -> ${status}`);
  }
  return offenders;
}

// Walk the queried AST, look up every operator-head leaf in the root-construct
// registry and active-foundation implementation map, and collect transitive
// dependency paths that end at an unallowed host primitive/derived construct.
// Returns a sorted, deduplicated array of paths such as
// `and -> avg -> host-primitive`.
function scanPureLinksOffenders(node, env) {
  if (env.strictPureLinks !== true) return [];
  const offenders = new Set();
  const allow = env.allowedHostPrimitives instanceof Set ? env.allowedHostPrimitives : new Set();
  const check = (name) => {
    if (PURE_LINKS_SCANNER_IGNORED.has(name) || allow.has(name)) return;
    for (const offender of _strictDependencyOffenders(env, name)) offenders.add(offender);
  };
  const visit = (n) => {
    if (Array.isArray(n)) {
      const head = n[0];
      if (typeof head === 'string') check(head);
      // Inspect every list child too — the head may live deeper inside a
      // sublist (e.g. an infix `(L op R)` shape).
      for (let i = 0; i < n.length; i++) visit(n[i]);
      // For infix `(L op R)` the operator is the middle element; check it
      // explicitly so we don't miss it.
      if (n.length === 3 && typeof n[1] === 'string') {
        check(n[1]);
      }
      return;
    }
    if (typeof n === 'string') {
      check(n);
    }
  };
  visit(node);
  return [...offenders].sort();
}

// ---------- HOAS desugarer ----------
// Higher-order abstract syntax (issue #51, D7): the surface keyword `forall`
// is sugar for `Pi`. Both binders share identical structure
// `(<binder> (Type x) body)`, so the desugarer walks the AST and rewrites the
// head leaf in place. Object-language binders are encoded as host-language
// `lambda` and `Pi`/`forall` so substitution and capture-avoidance reuse the
// kernel primitives — no separate object-level binder representation is
// required.
function desugarHoas(node) {
  if (!Array.isArray(node)) return node;
  const mapped = node.map(desugarHoas);
  // Rewrite `(forall (T x) body)` → `(Pi (T x) body)` only when the binder is
  // a pair (HOAS synonym). A bare uppercase name, e.g. `(forall A body)`, is
  // prenex-polymorphism sugar and must reach `synth`/`_isForallNode` intact.
  if (mapped.length === 3 && mapped[0] === 'forall' && Array.isArray(mapped[1])) {
    return ['Pi', mapped[1], mapped[2]];
  }
  return mapped;
}

// ---------- Binding parser ----------
// Parse a binding form in three supported syntaxes:
// 1. Colon form: (x: A) as ['x:', A] — standard LiNo link definition syntax
// 2. Prefix type form: (A x) as ['A', 'x'] — type-first notation for lambda/Pi bindings
//    e.g. (Natural x), used in (lambda (Natural x) body)
// 3. Prefix complex-type form: ((Pi (A x) B) f) — type-first with a list type expression,
//    needed for higher-order parameters such as polymorphic apply / compose where a
//    function parameter is itself function-typed.
// Returns { paramName, paramType } or null if not a valid binding.
function parseBinding(binding) {
  if (!Array.isArray(binding)) return null;
  // ['x:', A] — two elements where first ends with colon (standard LiNo link definition)
  if (binding.length === 2 && typeof binding[0] === 'string' && binding[0].endsWith(':')) {
    return { paramName: binding[0].slice(0, -1), paramType: binding[1] };
  }
  // ['A', 'x'] — prefix type form: type name first, then variable name
  // Type names must start with uppercase (convention from Lean/Rocq)
  if (binding.length === 2 && typeof binding[0] === 'string' && typeof binding[1] === 'string'
      && /^[A-Z]/.test(binding[0]) && !binding[1].endsWith(':')) {
    return { paramName: binding[1], paramType: binding[0] };
  }
  // [<type-expr>, 'x'] — prefix complex-type form: the type is a list expression
  // such as (Pi (A x) B), (Type 0), or (forall A T). The variable name must be a
  // plain identifier (no trailing colon, must not look like a type name itself).
  if (binding.length === 2 && Array.isArray(binding[0]) && typeof binding[1] === 'string'
      && !binding[1].endsWith(':')) {
    return { paramName: binding[1], paramType: binding[0] };
  }
  return null;
}

// ---------- Multi-binding parser ----------
// Parse comma-separated bindings: (Natural x, Natural y) → [{paramName:'x', paramType:'Natural'}, ...]
// Tokens arrive as ['Natural', 'x,', 'Natural', 'y'] or ['Natural', 'x'] (single binding)
function parseBindings(binding) {
  if (!Array.isArray(binding)) return null;
  // Try single binding first
  const single = parseBinding(binding);
  if (single) return [single];
  // Try comma-separated: flatten tokens, split by commas
  const tokens = [];
  for (const tok of binding) {
    if (typeof tok === 'string') {
      // Split tokens that end with comma: 'x,' → 'x', separator
      if (tok.endsWith(',')) {
        tokens.push(tok.slice(0, -1));
        tokens.push(',');
      } else {
        tokens.push(tok);
      }
    } else {
      tokens.push(tok);
    }
  }
  // Group into pairs separated by commas
  const bindings = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === ',') { i++; continue; }
    if (i + 1 < tokens.length && typeof tokens[i] === 'string' && typeof tokens[i+1] === 'string' && tokens[i+1] !== ',') {
      const pair = parseBinding([tokens[i], tokens[i+1]]);
      if (pair) {
        bindings.push(pair);
        i += 2;
        continue;
      }
    }
    return null; // invalid binding format
  }
  return bindings.length > 0 ? bindings : null;
}

// ---------- Substitution (for beta-reduction) ----------
// Capture-avoiding substitution for kernel terms. Both expr and replacement
// can be strings or arrays (AST nodes). The public primitive is `subst`;
// `substitute` remains as the backwards-compatible helper name.
const NON_VARIABLE_TOKENS = new Set([
  'lambda', 'Pi', 'fresh', 'in', 'subst', 'apply', 'type', 'of',
  'has', 'probability', 'with', 'proof', 'range', 'valence',
  'namespace', 'import', 'as', 'is', '?', 'mode', 'relation', 'total', 'coverage', 'world',
  'inductive', 'coinductive', 'constructor',
  'define', 'case', 'measure', 'lex', 'terminating',
  'whnf', 'nf', 'normal-form',
  'template',
  '+', '-', '*', '/', '<', '<=', '=', '!=', 'and', 'or', 'not', 'both', 'neither', 'nor',
]);

function cloneTerm(node) {
  return Array.isArray(node) ? node.map(cloneTerm) : node;
}

function tokenBaseName(token) {
  if (typeof token !== 'string') return null;
  return token.replace(/[:,]+$/g, '');
}

function isVariableToken(token) {
  if (typeof token !== 'string') return false;
  const base = tokenBaseName(token);
  return !!base && base === token && !isNum(base) && !NON_VARIABLE_TOKENS.has(base);
}

function bindingParamNames(binding) {
  const parsed = parseBindings(binding);
  return parsed ? parsed.map(b => b.paramName) : [];
}

function binderInfo(expr) {
  if (!Array.isArray(expr)) return null;
  if (expr.length === 3 && (expr[0] === 'lambda' || expr[0] === 'Pi')) {
    const params = bindingParamNames(expr[1]);
    if (params.length > 0) {
      return { kind: expr[0], params, bodyIndex: 2, bindingIndex: 1 };
    }
  }
  if (expr.length === 4 && expr[0] === 'fresh' && expr[2] === 'in' && typeof expr[1] === 'string') {
    return { kind: 'fresh', params: [expr[1]], bodyIndex: 3, bindingIndex: 1 };
  }
  return null;
}

function freeVariables(expr, bound = new Set()) {
  const out = new Set();
  function addAll(set) {
    for (const v of set) out.add(v);
  }
  if (typeof expr === 'string') {
    if (isVariableToken(expr) && !bound.has(expr)) out.add(expr);
    return out;
  }
  if (!Array.isArray(expr)) return out;

  const binder = binderInfo(expr);
  if (binder) {
    const nested = new Set(bound);
    for (const param of binder.params) nested.add(param);
    if (binder.kind !== 'fresh') {
      const paramSet = new Set(binder.params);
      for (const child of expr[binder.bindingIndex]) {
        if (typeof child === 'string' && paramSet.has(tokenBaseName(child))) continue;
        addAll(freeVariables(child, bound));
      }
    }
    addAll(freeVariables(expr[binder.bodyIndex], nested));
    return out;
  }

  for (const child of expr) addAll(freeVariables(child, bound));
  return out;
}

function containsFree(expr, name) {
  return freeVariables(expr).has(name);
}

function envCanEvaluateName(env, name) {
  if (
    env.symbolProb.has(name) ||
    env.terms.has(name) ||
    env.types.has(name) ||
    env.lambdas.has(name) ||
    env.ops.has(name) ||
    env.templates.has(name)
  ) {
    return true;
  }
  const resolved = env._resolveQualified(name);
  return resolved !== name && (
    env.symbolProb.has(resolved) ||
    env.terms.has(resolved) ||
    env.types.has(resolved) ||
    env.lambdas.has(resolved) ||
    env.ops.has(resolved) ||
    env.templates.has(resolved)
  );
}

function hasUnresolvedFreeVariables(expr, env) {
  for (const name of freeVariables(expr)) {
    if (!envCanEvaluateName(env, name)) return true;
  }
  return false;
}

function collectNames(expr, out = new Set()) {
  if (typeof expr === 'string') {
    const base = tokenBaseName(expr);
    if (base && !isNum(base) && !NON_VARIABLE_TOKENS.has(base)) out.add(base);
    return out;
  }
  if (Array.isArray(expr)) {
    for (const child of expr) collectNames(child, out);
  }
  return out;
}

function freshName(base, avoid) {
  let i = 1;
  let candidate = `${base}_${i}`;
  while (avoid.has(candidate)) {
    i++;
    candidate = `${base}_${i}`;
  }
  return candidate;
}

function renameBindingParam(binding, oldName, newName) {
  if (!Array.isArray(binding)) return binding;
  return binding.map(child => {
    if (typeof child !== 'string') return cloneTerm(child);
    if (child === oldName) return newName;
    if (child === `${oldName},`) return `${newName},`;
    if (child === `${oldName}:`) return `${newName}:`;
    return child;
  });
}

function renameBoundOccurrences(expr, oldName, newName) {
  if (typeof expr === 'string') return expr === oldName ? newName : expr;
  if (!Array.isArray(expr)) return expr;

  const binder = binderInfo(expr);
  if (binder && binder.params.includes(oldName)) {
    return cloneTerm(expr);
  }

  return expr.map(child => renameBoundOccurrences(child, oldName, newName));
}

function renameBinder(expr, binder, oldName, newName) {
  const out = expr.map(cloneTerm);
  if (binder.kind === 'fresh') {
    out[binder.bindingIndex] = newName;
  } else {
    out[binder.bindingIndex] = renameBindingParam(out[binder.bindingIndex], oldName, newName);
  }
  out[binder.bodyIndex] = renameBoundOccurrences(out[binder.bodyIndex], oldName, newName);
  return out;
}

function subst(expr, name, replacement) {
  if (typeof expr === 'string') {
    return expr === name ? replacement : expr;
  }
  if (Array.isArray(expr)) {
    const binder = binderInfo(expr);
    if (binder) {
      if (binder.params.includes(name)) return expr; // shadowed
      let current = expr.map(cloneTerm);
      const replacementFree = freeVariables(replacement);
      if (containsFree(expr[binder.bodyIndex], name)) {
        const avoid = collectNames(current);
        collectNames(replacement, avoid);
        avoid.add(name);
        for (const param of binder.params) {
          if (replacementFree.has(param)) {
            const next = freshName(param, avoid);
            avoid.add(next);
            current = renameBinder(current, binderInfo(current), param, next);
          }
        }
      }
      return current.map(child => subst(child, name, replacement));
    }
    return expr.map(child => subst(child, name, replacement));
  }
  return expr;
}

function substitute(expr, name, replacement) {
  return subst(expr, name, replacement);
}

// ---------- Template expansion (issue #59) ----------
// `(template (<name> <param>...) <body>)` registers a reusable link shape.
// Uses like `(<name> arg...)` are expanded before evaluation, recursively, so
// template bodies can call other templates. Placeholder substitution is
// simultaneous and capture-avoiding: first replace free placeholders with
// fresh sentinels, then use the existing hygienic `subst` primitive to insert
// arguments without letting template-introduced binders capture them.
function _templateKeyFor(env, name) {
  if (env.templates.has(name)) return name;
  const resolved = env._resolveQualified(name);
  if (resolved !== name && env.templates.has(resolved)) return resolved;
  return null;
}

function _validateTemplatePattern(pattern) {
  if (!Array.isArray(pattern) || pattern.length < 1 || typeof pattern[0] !== 'string') {
    throw new RmlError('E040', 'Template declaration must be `(template (<name> <param>...) <body>)`');
  }
  const name = pattern[0];
  if (!isVariableToken(name)) {
    throw new RmlError('E040', `Template name must be a bare identifier (got "${name}")`);
  }
  const params = pattern.slice(1);
  const seen = new Set();
  for (const param of params) {
    if (typeof param !== 'string' || !isVariableToken(param)) {
      throw new RmlError('E040', `Template parameter must be a bare identifier (got "${keyOf(param)}")`);
    }
    if (seen.has(param)) {
      throw new RmlError('E040', `Template parameter "${param}" is declared more than once`);
    }
    seen.add(param);
  }
  return { name, params };
}

function registerTemplateForm(form, env) {
  if (!Array.isArray(form) || form.length !== 3 || form[0] !== 'template') {
    throw new RmlError('E040', 'Template declaration must be `(template (<name> <param>...) <body>)`');
  }
  const { name, params } = _validateTemplatePattern(form[1]);
  const storeName = env.qualifyName(name);
  _maybeWarnShadow(env, storeName);
  env.templates.set(storeName, {
    name: storeName,
    params,
    body: cloneTerm(form[2]),
  });
  return storeName;
}

function substituteTemplatePlaceholders(body, params, args) {
  let current = cloneTerm(body);
  const avoid = collectNames(current);
  for (const arg of args) collectNames(arg, avoid);
  const sentinels = params.map(param => {
    const next = freshName(`__template_${param}`, avoid);
    avoid.add(next);
    return next;
  });
  for (let i = 0; i < params.length; i++) {
    current = subst(current, params[i], sentinels[i]);
  }
  for (let i = 0; i < sentinels.length; i++) {
    current = subst(current, sentinels[i], args[i]);
  }
  return current;
}

function expandTemplates(node, env, stack = []) {
  if (!Array.isArray(node)) return cloneTerm(node);
  if (node.length === 0) return [];

  const head = node[0];
  if (typeof head === 'string') {
    const key = _templateKeyFor(env, head);
    if (key) {
      const decl = env.templates.get(key);
      const argCount = node.length - 1;
      if (argCount !== decl.params.length) {
        throw new RmlError(
          'E040',
          `Template "${head}" expects ${decl.params.length} argument${decl.params.length === 1 ? '' : 's'}, got ${argCount}`,
        );
      }
      const cycleStart = stack.indexOf(key);
      if (cycleStart !== -1) {
        const cycle = stack.slice(cycleStart).concat([key]).join(' -> ');
        throw new RmlError('E040', `Template expansion cycle detected: ${cycle}`);
      }
      const expandedArgs = node.slice(1).map(arg => expandTemplates(arg, env, stack));
      stack.push(key);
      try {
        const instantiated = substituteTemplatePlaceholders(decl.body, decl.params, expandedArgs);
        return expandTemplates(instantiated, env, stack);
      } finally {
        stack.pop();
      }
    }
  }

  return node.map(child => expandTemplates(child, env, stack));
}

// ---------- Eval ----------
// Format a numeric value for trace output — strips trailing zeros so
// `1.000000` reads as `1` and `0.5` stays `0.5`. Used both for assignment
// values and for reduction results to keep trace lines reproducible.
function formatTraceValue(v) {
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return String(v);
  const rounded = +v.toFixed(6);
  const s = String(rounded);
  return s;
}

// ---------- Proof derivations (issue #35) ----------
// A derivation is a Node tree of the form `(by <rule> <subderivation>...)`,
// expressed as a JS array so it round-trips through the existing `keyOf`
// (print) / `parseOne(tokenizeOne(...))` (parse) helpers without needing a
// new format. `buildProof` is invoked by `evaluate()` (and the inline
// `(? expr with proof)` query form) once a top-level form has been
// evaluated; it walks the same structural cases as `evalNode` to attach the
// rule that fired at each step.
//
// The walker is intentionally read-only — it never mutates the env beyond
// the lookups that `evalNode` would have performed during evaluation, so
// enabling proofs cannot change query results. Sub-derivations recurse
// through `buildProof` so every sub-expression carries its own witness
// rather than collapsing into the literal value.
function _wrap(rule, ...subs) {
  return ['by', rule, ...subs];
}

// Pretty-print a numeric value the same way `formatTraceValue` does so
// proof-result links such as `(eq L R 1)` stay stable across runs.
function _proofValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const s = formatTraceValue(v);
    return s;
  }
  return String(v);
}

// Equality-layer provenance (issue #97). Centralises the precedence used by
// `buildProof()` (and surfaced verbatim through `out.provenance`) so JS and
// Rust agree on which equality layer fires for a given `(L = R)` pair.
// Precedence: assigned > structural > definitional > numeric.
function _containsLambdaOrApply(node) {
  if (!Array.isArray(node)) return false;
  if (node[0] === 'lambda' || node[0] === 'apply') return true;
  for (const child of node) if (_containsLambdaOrApply(child)) return true;
  return false;
}

function classifyEqualityRule(L, R, op, env) {
  const isInequality = op === '!=';
  const kPrefix = keyOf(['=', L, R]);
  const kInfix = keyOf([L, '=', R]);
  if (env.assign.has(kPrefix) || env.assign.has(kInfix)) {
    return isInequality ? 'assigned-inequality' : 'assigned-equality';
  }
  if (isStructurallySame(L, R)) {
    return isInequality ? 'structural-inequality' : 'structural-equality';
  }
  // Definitional equality: if one side contains a lambda/apply and both
  // sides normalize to structurally-identical terms, the equality holds by
  // beta-reduction. Wrapped in a try/catch so a pathological normalization
  // never breaks classification (worst case we fall through to numeric).
  if (_containsLambdaOrApply(L) || _containsLambdaOrApply(R)) {
    try {
      const Ln = normalizeTerm(L, env);
      const Rn = normalizeTerm(R, env);
      if (isStructurallySame(Ln, Rn) && !isStructurallySame(L, R)) {
        return isInequality ? 'definitional-inequality' : 'definitional-equality';
      }
    } catch (_) { /* fall through */ }
  }
  return isInequality ? 'numeric-inequality' : 'numeric-equality';
}

// Strip an optional `with proof` keyword pair, then unwrap a singleton
// container so `(? (a = b))` and `(? ((a = b)))` both yield `(a = b)`.
function _queryBody(queryForm) {
  if (!Array.isArray(queryForm) || queryForm[0] !== '?') return null;
  const stripped = _stripWithProof(queryForm.slice(1));
  let body = stripped.length === 1 ? stripped[0] : stripped;
  while (Array.isArray(body) && body.length === 1 && Array.isArray(body[0])) {
    body = body[0];
  }
  return body;
}

// Return the equality-layer rule for a query whose body is a direct
// equality, or null for any other query shape. Composite queries like
// `((a = true) and (b = true))` are intentionally returned as `null`: the
// per-equality rules still appear in the proof witness, but the surface
// provenance describes the query itself.
function equalityProvenanceForQuery(queryForm, env) {
  const body = _queryBody(queryForm);
  if (!Array.isArray(body)) return null;
  if (body.length === 3 && typeof body[1] === 'string' && (body[1] === '=' || body[1] === '!=')) {
    return classifyEqualityRule(body[0], body[2], body[1], env);
  }
  return null;
}

function buildProof(node, env) {
  // Literals
  if (typeof node === 'string') {
    if (isNum(node)) {
      return _wrap('literal', node);
    }
    // Bare symbol: either a declared term/symbol prior or unknown — both are
    // axiomatic at this level so we record the symbol as a leaf witness.
    return _wrap('symbol', node);
  }

  if (!Array.isArray(node)) return _wrap('literal', String(node));

  // Definitions and operator redefs: (head: ...)
  if (typeof node[0] === 'string' && node[0].endsWith(':')) {
    return _wrap('definition', node);
  }

  // Assignment: ((expr) has probability p)
  if (node.length === 4 && node[1] === 'has' && node[2] === 'probability' && isNum(node[3])) {
    return _wrap('assigned-probability', node[0], node[3]);
  }

  // Range / valence configuration directives.
  if (node.length === 3 && node[0] === 'range' && isNum(node[1]) && isNum(node[2])) {
    return _wrap('configuration', 'range', node[1], node[2]);
  }
  if (node.length === 2 && node[0] === 'valence' && isNum(node[1])) {
    return _wrap('configuration', 'valence', node[1]);
  }

  // Query: (? expr) and the per-query proof form (? expr with proof)
  if (node[0] === '?') {
    const inner = _stripWithProof(node.slice(1));
    const target = inner.length === 1 ? inner[0] : inner;
    return _wrap('query', buildProof(target, env));
  }

  // Infix arithmetic: (A + B), (A - B), (A * B), (A / B)
  if (node.length === 3 && typeof node[1] === 'string' && ['+','-','*','/'].includes(node[1])) {
    const ruleByOp = { '+': 'sum', '-': 'difference', '*': 'product', '/': 'quotient' };
    return _wrap(ruleByOp[node[1]], buildProof(node[0], env), buildProof(node[2], env));
  }

  // Infix AND/OR/BOTH/NEITHER
  if (node.length === 3 && typeof node[1] === 'string' && (node[1]==='and' || node[1]==='or' || node[1]==='both' || node[1]==='neither')) {
    return _wrap(node[1], buildProof(node[0], env), buildProof(node[2], env));
  }

  // Composite both/neither chains: (both A and B [and C ...]), (neither A nor B [nor C ...])
  if (node.length >= 4 && typeof node[0] === 'string' && (node[0]==='both' || node[0]==='neither')) {
    const sep = node[0]==='both' ? 'and' : 'nor';
    let valid = node.length % 2 === 0;
    if (valid) {
      for (let i = 2; i < node.length; i += 2) {
        if (node[i] !== sep) { valid = false; break; }
      }
    }
    if (valid) {
      const subs = [];
      for (let i = 1; i < node.length; i += 2) subs.push(buildProof(node[i], env));
      return _wrap(node[0], ...subs);
    }
  }

  // Infix equality / inequality: (L = R), (L != R)
  if (node.length === 3 && typeof node[1] === 'string' && (node[1]==='=' || node[1]==='!=')) {
    const L = node[0];
    const R = node[2];
    const rule = classifyEqualityRule(L, R, node[1], env);
    // Sub-derivations of equality preserve the original operands as links
    // so the witness reads (by structural-equality (a a)) per the issue.
    return _wrap(rule, [L, R]);
  }

  // ---------- Type system witnesses ----------
  if (node.length === 2 && node[0] === 'Type') {
    return _wrap('type-universe', node[1]);
  }
  if (node.length === 1 && node[0] === 'Prop') {
    return _wrap('prop');
  }
  if (node.length === 3 && node[0] === 'Pi') {
    return _wrap('pi-formation', node[1], node[2]);
  }
  if (node.length === 3 && node[0] === 'lambda') {
    return _wrap('lambda-formation', node[1], node[2]);
  }
  if (node.length === 3 && node[0] === 'apply') {
    return _wrap('beta-reduction', buildProof(node[1], env), buildProof(node[2], env));
  }
  if (node.length === 4 && node[0] === 'subst') {
    return _wrap('substitution', node[1], node[2], node[3]);
  }
  if (node.length === 2 && node[0] === 'whnf') {
    return _wrap('whnf-reduction', node[1]);
  }
  if (node.length === 2 && (node[0] === 'nf' || node[0] === 'normal-form')) {
    return _wrap('nf-reduction', node[1]);
  }
  if (node.length === 4 && node[0] === 'fresh' && node[2] === 'in') {
    return _wrap('fresh', node[1], node[3]);
  }
  if (node.length === 3 && node[0] === 'type' && node[1] === 'of') {
    return _wrap('type-query', node[2]);
  }
  if (node.length === 3 && node[1] === 'of') {
    return _wrap('type-check', node[0], node[2]);
  }

  // Prefix operator: (op X Y ...)
  const head = node[0];
  if (typeof head === 'string' && env.hasOp(head)) {
    return _wrap(head, ...node.slice(1).map(arg => buildProof(arg, env)));
  }

  // Fallback for prefix application of named lambdas / unrecognised heads.
  return _wrap('reduce', node);
}

// Strip an optional `with proof` suffix from a query body. Both
// `(? expr with proof)` and `(? (expr) with proof)` are accepted.
function _stripWithProof(parts) {
  if (parts.length >= 3 && parts[parts.length - 2] === 'with' && parts[parts.length - 1] === 'proof') {
    return parts.slice(0, -2);
  }
  return parts;
}

// Detect whether a query body explicitly requested a proof via the inline
// `with proof` keyword pair. Used to populate the per-query proof slot even
// when the global `withProofs` option is off.
function _queryRequestsProof(node) {
  if (!Array.isArray(node) || node[0] !== '?') return false;
  const parts = node.slice(1);
  return parts.length >= 3 && parts[parts.length - 2] === 'with' && parts[parts.length - 1] === 'proof';
}

// ---------- Tactic engine (issues #55 and #56) ----------
// Tactics are represented as ordinary links and operate on an explicit proof
// state. The state shape is intentionally small and serialisable:
//   { goals: [{ goal: Node, context: Node[] }], proof: Node[] }
// Callers may pass bare goal nodes in `goals`; `runTactics` normalises them
// into goal objects before applying tactics.
const DEFAULT_SIMPLIFY_MAX_STEPS = 100;
const DEFAULT_ATP_TIMEOUT_MS = 5000;
const DEFAULT_SMT_TIMEOUT_MS = 5000;
const ATP_PROVED_STATUSES = new Set([
  'Theorem',
  'Unsatisfiable',
  'ContradictoryAxioms',
]);
const ATP_UNKNOWN_STATUSES = new Set([
  'Unknown',
  'GaveUp',
]);
const ATP_TIMEOUT_STATUSES = new Set([
  'Timeout',
  'ResourceOut',
]);

function _normaliseProofGoal(rawGoal, inheritedContext = []) {
  if (
    rawGoal &&
    typeof rawGoal === 'object' &&
    !Array.isArray(rawGoal) &&
    Object.prototype.hasOwnProperty.call(rawGoal, 'goal')
  ) {
    return {
      goal: cloneTerm(rawGoal.goal),
      context: Array.isArray(rawGoal.context)
        ? rawGoal.context.map(cloneTerm)
        : inheritedContext.map(cloneTerm),
    };
  }
  return {
    goal: cloneTerm(rawGoal),
    context: inheritedContext.map(cloneTerm),
  };
}

function _normaliseProofState(state = {}) {
  const inheritedContext = Array.isArray(state.context)
    ? state.context.map(cloneTerm)
    : [];
  const goals = Array.isArray(state.goals)
    ? state.goals.map(goal => _normaliseProofGoal(goal, inheritedContext))
    : [];
  const proof = Array.isArray(state.proof) ? state.proof.map(cloneTerm) : [];
  return { goals, proof };
}

function _cloneProofState(state) {
  return {
    goals: state.goals.map(goal => ({
      goal: cloneTerm(goal.goal),
      context: goal.context.map(cloneTerm),
    })),
    proof: state.proof.map(cloneTerm),
  };
}

function _isTacticNode(value) {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string';
}

function _normaliseTacticList(tactics) {
  if (typeof tactics === 'string') return parseLinoForms(tactics);
  if (tactics === undefined || tactics === null) return [];
  if (_isTacticNode(tactics) || typeof tactics === 'string') return [tactics];
  return Array.isArray(tactics) ? tactics : [tactics];
}

function _tacticName(tactic) {
  if (typeof tactic === 'string') return tactic;
  if (Array.isArray(tactic) && typeof tactic[0] === 'string') return tactic[0];
  return null;
}

function _tacticArgs(tactic) {
  return Array.isArray(tactic) ? tactic.slice(1) : [];
}

function _asEquality(node) {
  if (Array.isArray(node) && node.length === 3 && node[1] === '=') {
    return { left: node[0], right: node[2] };
  }
  return null;
}

function _goalKey(goal) {
  return goal ? keyOf(goal.goal) : '<none>';
}

function _tacticDiagnostic(tactic, goal, reason) {
  return new Diagnostic({
    code: 'E039',
    message: `Tactic ${keyOf(tactic)} failed: ${reason}; current goal: ${_goalKey(goal)}`,
    span: { file: null, line: 1, col: 1, length: 0 },
  });
}

function _replaceCurrentGoal(state, replacementGoals, recordTactic) {
  return {
    goals: [...replacementGoals, ...state.goals.slice(1)],
    proof: [...state.proof, cloneTerm(recordTactic)],
  };
}

function _goalWithContext(current, goal) {
  return {
    goal: cloneTerm(goal),
    context: current.context.map(cloneTerm),
  };
}

function _rewriteError(message) {
  return new RmlError('E039', message);
}

function _normaliseSmtSolverArgs(rawArgs) {
  if (rawArgs === undefined || rawArgs === null) return [];
  if (Array.isArray(rawArgs)) return rawArgs.map(String);
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    return trimmed ? trimmed.split(/\s+/) : [];
  }
  throw _rewriteError('SMT solver args must be an array or whitespace-separated string');
}

function _normaliseSmtTimeoutMs(rawTimeout) {
  const timeout = rawTimeout === undefined || rawTimeout === null || rawTimeout === ''
    ? DEFAULT_SMT_TIMEOUT_MS
    : Number(String(rawTimeout));
  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw _rewriteError(`SMT timeout must be a non-negative integer in milliseconds (got ${String(rawTimeout)})`);
  }
  return timeout;
}

function _normaliseSmtOptions(options = {}) {
  const solver =
    options.smtSolverPath ??
    options.smtSolver ??
    process.env.RML_SMT_SOLVER ??
    null;
  const solverArgs =
    options.smtSolverArgs ??
    options.smtArgs ??
    process.env.RML_SMT_ARGS ??
    [];
  const timeout =
    options.smtTimeoutMs ??
    process.env.RML_SMT_TIMEOUT_MS ??
    DEFAULT_SMT_TIMEOUT_MS;
  return {
    solver: solver === null || solver === undefined || String(solver).trim() === ''
      ? null
      : String(solver),
    args: _normaliseSmtSolverArgs(solverArgs),
    timeoutMs: _normaliseSmtTimeoutMs(timeout),
  };
}

function _smtSolverProofName(smtOptions) {
  if (!smtOptions || !smtOptions.solver) return 'unconfigured';
  const base = path.basename(String(smtOptions.solver)) || String(smtOptions.solver);
  const safe = base.replace(/\s+/g, '_');
  return safe || 'solver';
}

function _smtTrustedNode(smtOptions) {
  return ['by', 'smt-trusted', _smtSolverProofName(smtOptions)];
}

function _smtEscapeSymbol(raw) {
  return `|${String(raw).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')}|`;
}

function _smtDeclare(ctx, raw, sort) {
  const key = String(raw);
  const existing = ctx.declarations.get(key);
  if (existing && existing !== sort) {
    throw _rewriteError(`SMT symbol ${keyOf(key)} is used as both ${existing} and ${sort}`);
  }
  ctx.declarations.set(key, sort);
  return _smtEscapeSymbol(key);
}

function _smtNumber(raw) {
  const text = String(raw);
  if (text.startsWith('-')) return `(- ${text.slice(1)})`;
  return text;
}

function _smtLeaf(node, value) {
  return typeof node === 'string' && node === value;
}

function _smtInfix(node, operators) {
  return Array.isArray(node) &&
    node.length === 3 &&
    typeof node[1] === 'string' &&
    operators.includes(node[1])
    ? node[1]
    : null;
}

function _smtIsBoolish(node) {
  if (typeof node === 'string') return node === 'true' || node === 'false';
  if (!Array.isArray(node) || node.length === 0) return false;
  if (_smtInfix(node, ['=', '!=', 'and', 'or', '=>', 'implies'])) return true;
  return typeof node[0] === 'string' && ['not', 'and', 'or', '=>', 'implies'].includes(node[0]);
}

function _smtTerm(node, ctx) {
  if (typeof node === 'string') {
    if (isNum(node)) return _smtNumber(node);
    if (node === 'true' || node === 'false') {
      throw _rewriteError(`SMT bridge cannot use Boolean constant ${node} as a Real term`);
    }
    return _smtDeclare(ctx, node, 'Real');
  }
  if (!Array.isArray(node) || node.length === 0) {
    throw _rewriteError(`SMT bridge cannot translate term ${keyOf(node)}`);
  }

  const infix = _smtInfix(node, ['+', '-', '*', '/']);
  if (infix) {
    return `(${infix} ${_smtTerm(node[0], ctx)} ${_smtTerm(node[2], ctx)})`;
  }
  const head = node[0];
  if (typeof head === 'string' && ['+', '-', '*', '/'].includes(head) && node.length >= 3) {
    return `(${head} ${node.slice(1).map(arg => _smtTerm(arg, ctx)).join(' ')})`;
  }

  return _smtDeclare(ctx, keyOf(node), 'Real');
}

function _smtEquality(left, right, ctx) {
  if (_smtIsBoolish(left) || _smtIsBoolish(right)) {
    return `(= ${_smtFormula(left, ctx)} ${_smtFormula(right, ctx)})`;
  }
  return `(= ${_smtTerm(left, ctx)} ${_smtTerm(right, ctx)})`;
}

function _smtFormula(node, ctx) {
  if (typeof node === 'string') {
    if (node === 'true') return 'true';
    if (node === 'false') return 'false';
    if (isNum(node)) throw _rewriteError(`SMT bridge cannot use numeric literal ${node} as a Boolean formula`);
    return _smtDeclare(ctx, node, 'Bool');
  }
  if (!Array.isArray(node) || node.length === 0) {
    throw _rewriteError(`SMT bridge cannot translate formula ${keyOf(node)}`);
  }

  const infix = _smtInfix(node, ['=', '!=', 'and', 'or', '=>', 'implies']);
  if (infix === '=') return _smtEquality(node[0], node[2], ctx);
  if (infix === '!=') return `(not ${_smtEquality(node[0], node[2], ctx)})`;
  if (infix === 'and' || infix === 'or') {
    return `(${infix} ${_smtFormula(node[0], ctx)} ${_smtFormula(node[2], ctx)})`;
  }
  if (infix === '=>' || infix === 'implies') {
    return `(=> ${_smtFormula(node[0], ctx)} ${_smtFormula(node[2], ctx)})`;
  }

  const head = node[0];
  if (head === 'not' && node.length === 2) return `(not ${_smtFormula(node[1], ctx)})`;
  if ((head === 'and' || head === 'or') && node.length >= 1) {
    if (node.length === 1) return head === 'and' ? 'true' : 'false';
    return `(${head} ${node.slice(1).map(arg => _smtFormula(arg, ctx)).join(' ')})`;
  }
  if ((head === '=>' || head === 'implies') && node.length === 3) {
    return `(=> ${_smtFormula(node[1], ctx)} ${_smtFormula(node[2], ctx)})`;
  }

  return _smtDeclare(ctx, keyOf(node), 'Bool');
}

function smtLibForGoal(goal) {
  const ctx = { declarations: new Map() };
  const formula = _smtFormula(goal, ctx);
  const declarations = [...ctx.declarations.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, sort]) => `(declare-const ${_smtEscapeSymbol(name)} ${sort})`);
  return [
    ...declarations,
    `(assert (not ${formula}))`,
    '(check-sat)',
    '(exit)',
    '',
  ].join('\n');
}

function _smtProcessSummary(output) {
  const text = String(output || '').trim();
  if (!text) return '<no output>';
  const firstLine = text.split(/\r?\n/)[0];
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}...` : firstLine;
}

function _parseSmtCheckSat(stdout, stderr) {
  const combined = `${stdout || ''}\n${stderr || ''}`;
  for (const line of combined.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === 'unsat' || trimmed === 'sat' || trimmed === 'unknown') return trimmed;
  }
  return null;
}

function _runSmtSolver(smtLib, smtOptions) {
  if (!smtOptions.solver) {
    return { status: 'error', reason: 'SMT solver path is not configured' };
  }
  const solverName = _smtSolverProofName(smtOptions);
  const child = spawnSync(smtOptions.solver, smtOptions.args, {
    input: smtLib,
    encoding: 'utf8',
    timeout: smtOptions.timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  if (child.error) {
    if (child.error.code === 'ETIMEDOUT') {
      return {
        status: 'timeout',
        reason: `SMT solver ${solverName} timed out after ${smtOptions.timeoutMs} ms`,
      };
    }
    return {
      status: 'error',
      reason: `SMT solver ${solverName} failed to start: ${child.error.message}`,
    };
  }
  if (child.status !== 0) {
    return {
      status: 'error',
      reason: `SMT solver ${solverName} exited with status ${child.status}: ${_smtProcessSummary(child.stderr || child.stdout)}`,
    };
  }
  const result = _parseSmtCheckSat(child.stdout, child.stderr);
  if (!result) {
    return {
      status: 'error',
      reason: `SMT solver ${solverName} did not return sat, unsat, or unknown`,
    };
  }
  return { status: result, reason: `SMT solver ${solverName} returned ${result}` };
}

function _tptpIdentifier(raw, role) {
  let cleaned = String(raw).replace(/[^A-Za-z0-9_]/g, '_');
  if (!cleaned) cleaned = role === 'var' ? 'X' : 'rml_symbol';
  if (role === 'var') {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
    if (!/^[A-Z]/.test(cleaned)) cleaned = `V_${cleaned}`;
    return cleaned;
  }
  cleaned = cleaned.toLowerCase();
  if (!/^[a-z]/.test(cleaned)) cleaned = `rml_${cleaned}`;
  return cleaned;
}

function _tptpTerm(node, boundVars) {
  if (typeof node === 'string') {
    if (boundVars.has(node)) return _tptpIdentifier(node, 'var');
    if (isNum(node)) return _tptpIdentifier(`num_${node}`, 'term');
    return _tptpIdentifier(node, 'term');
  }
  if (!Array.isArray(node) || node.length === 0 || typeof node[0] !== 'string') {
    throw _rewriteError(`TPTP export supports first-order terms only (got ${keyOf(node)})`);
  }
  const head = _tptpIdentifier(node[0], 'term');
  const args = node.slice(1).map(arg => _tptpTerm(arg, boundVars)).join(', ');
  return `${head}(${args})`;
}

function _infixOperands(node, op) {
  if (!Array.isArray(node) || node.length < 3 || node.length % 2 === 0) return null;
  const operands = [];
  for (let i = 0; i < node.length; i += 2) {
    if (i > 0 && node[i - 1] !== op) return null;
    operands.push(node[i]);
  }
  return operands;
}

function _tptpJoinFormula(op, operands, boundVars) {
  return operands.map(part => `(${_tptpFormula(part, boundVars)})`).join(` ${op} `);
}

function _quantifierParts(node) {
  if (!Array.isArray(node) || node.length !== 3) return null;
  const [head, binder, body] = node;
  if (head !== 'forall' && head !== 'exists' && head !== 'Pi') return null;
  const parsed = parseBinding(binder);
  if (!parsed) {
    throw _rewriteError(`TPTP export could not parse quantifier binder ${keyOf(binder)}`);
  }
  return {
    quantifier: head === 'exists' ? '?' : '!',
    variable: parsed.paramName,
    body,
  };
}

function _tptpFormula(node, boundVars = new Set()) {
  if (typeof node === 'string') {
    if (node === 'true') return '$true';
    if (node === 'false') return '$false';
    if (boundVars.has(node)) return _tptpIdentifier(node, 'var');
    return _tptpIdentifier(node, 'pred');
  }
  if (!Array.isArray(node) || node.length === 0) {
    throw _rewriteError(`TPTP export supports first-order formulas only (got ${keyOf(node)})`);
  }

  const quantified = _quantifierParts(node);
  if (quantified) {
    const nextBound = new Set(boundVars);
    nextBound.add(quantified.variable);
    const variable = _tptpIdentifier(quantified.variable, 'var');
    return `${quantified.quantifier}[${variable}] : (${_tptpFormula(quantified.body, nextBound)})`;
  }

  const ascription = _typeAscription(node);
  if (ascription) {
    return `${_tptpIdentifier(keyOf(ascription.type), 'pred')}(${_tptpTerm(ascription.term, boundVars)})`;
  }

  const equality = _asEquality(node);
  if (equality) {
    return `${_tptpTerm(equality.left, boundVars)} = ${_tptpTerm(equality.right, boundVars)}`;
  }
  if (node.length === 3 && node[1] === '!=') {
    return `${_tptpTerm(node[0], boundVars)} != ${_tptpTerm(node[2], boundVars)}`;
  }

  const conjunction = _infixOperands(node, 'and');
  if (conjunction) return _tptpJoinFormula('&', conjunction, boundVars);
  const disjunction = _infixOperands(node, 'or');
  if (disjunction) return _tptpJoinFormula('|', disjunction, boundVars);
  const implication = _infixOperands(node, '=>') ?? _infixOperands(node, 'implies');
  if (implication && implication.length === 2) return _tptpJoinFormula('=>', implication, boundVars);
  const equivalence = _infixOperands(node, '<=>') ?? _infixOperands(node, 'iff');
  if (equivalence && equivalence.length === 2) return _tptpJoinFormula('<=>', equivalence, boundVars);

  if (typeof node[0] === 'string') {
    const head = node[0];
    if (head === 'not' && node.length === 2) return `~(${_tptpFormula(node[1], boundVars)})`;
    if (head === 'and' && node.length >= 2) return _tptpJoinFormula('&', node.slice(1), boundVars);
    if (head === 'or' && node.length >= 2) return _tptpJoinFormula('|', node.slice(1), boundVars);
    if ((head === '=>' || head === 'implies') && node.length === 3) {
      return _tptpJoinFormula('=>', node.slice(1), boundVars);
    }
    if ((head === '<=>' || head === 'iff') && node.length === 3) {
      return _tptpJoinFormula('<=>', node.slice(1), boundVars);
    }
    const predicate = _tptpIdentifier(head, 'pred');
    if (node.length === 1) return predicate;
    const args = node.slice(1).map(arg => _tptpTerm(arg, boundVars)).join(', ');
    return `${predicate}(${args})`;
  }

  throw _rewriteError(`TPTP export supports first-order formulas only (got ${keyOf(node)})`);
}

function goalToTptp(goal, context = []) {
  const proofGoal =
    goal &&
    typeof goal === 'object' &&
    !Array.isArray(goal) &&
    Object.prototype.hasOwnProperty.call(goal, 'goal')
      ? _normaliseProofGoal(goal)
      : _normaliseProofGoal({ goal, context });
  const lines = proofGoal.context.map((ctx, index) =>
    `fof(rml_context_${index + 1}, axiom, (${_tptpFormula(ctx)})).`);
  lines.push(`fof(rml_goal, conjecture, (${_tptpFormula(proofGoal.goal)})).`);
  return `${lines.join('\n')}\n`;
}

function parseAtpStatus(output) {
  const match = String(output || '').match(/\bSZS\s+status\s+([A-Za-z][A-Za-z0-9_]*)\b/);
  if (!match) return null;
  const status = match[1];
  let kind = 'failure';
  if (ATP_PROVED_STATUSES.has(status)) kind = 'proved';
  else if (ATP_UNKNOWN_STATUSES.has(status)) kind = 'unknown';
  else if (ATP_TIMEOUT_STATUSES.has(status)) kind = 'timeout';
  return { status, kind };
}

function _normaliseAtpOptions(options = {}) {
  const atp = options.atp && typeof options.atp === 'object' ? options.atp : {};
  const rawArgs = atp.args ?? options.atpArgs ?? [];
  let args;
  if (typeof rawArgs === 'string') {
    args = rawArgs.trim().length === 0 ? [] : rawArgs.trim().split(/\s+/);
  } else {
    args = Array.isArray(rawArgs) ? rawArgs.map(String) : [];
  }
  const timeoutRaw = atp.timeoutMs ?? options.atpTimeoutMs ?? DEFAULT_ATP_TIMEOUT_MS;
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw _rewriteError(`ATP timeout must be a positive integer (got ${String(timeoutRaw)})`);
  }
  const atpPath = atp.path ?? options.atpPath ?? null;
  const name = atp.name ?? options.atpName ?? (atpPath ? path.basename(String(atpPath)) : 'atp');
  return {
    path: atpPath === null || atpPath === undefined || String(atpPath).length === 0
      ? null
      : String(atpPath),
    args,
    name: String(name || 'atp').replace(/[()\s]+/g, '_'),
    timeoutMs,
    maxBuffer: atp.maxBuffer ?? options.atpMaxBuffer ?? 1024 * 1024,
  };
}

function _runAtpProcess(tptp, atpOptions) {
  if (!atpOptions.path) {
    return { ok: false, reason: 'ATP path is not configured' };
  }
  const child = spawnSync(atpOptions.path, atpOptions.args, {
    input: tptp,
    encoding: 'utf8',
    timeout: atpOptions.timeoutMs,
    maxBuffer: atpOptions.maxBuffer,
  });
  const stdout = child.stdout || '';
  const stderr = child.stderr || '';
  const combined = `${stdout}\n${stderr}`;

  if (child.error) {
    if (child.error.code === 'ETIMEDOUT') {
      return { ok: false, reason: `ATP timed out after ${atpOptions.timeoutMs} ms` };
    }
    return { ok: false, reason: `ATP invocation failed: ${child.error.message}` };
  }
  if (child.status !== 0) {
    const detail = stderr.trim() || stdout.trim() || `exit status ${child.status}`;
    return { ok: false, reason: `ATP exited with status ${child.status}: ${detail}` };
  }

  const parsed = parseAtpStatus(combined);
  if (!parsed) {
    return { ok: false, reason: 'ATP output did not contain an SZS status' };
  }
  if (parsed.kind === 'proved') {
    return { ok: true, status: parsed.status, solver: atpOptions.name };
  }
  if (parsed.kind === 'timeout') {
    return { ok: false, reason: `ATP returned ${parsed.status}` };
  }
  if (parsed.kind === 'unknown') {
    return { ok: false, reason: `ATP returned ${parsed.status}` };
  }
  return { ok: false, reason: `ATP returned non-proving status ${parsed.status}` };
}

function _normaliseRewriteDirection(direction = 'forward') {
  if (direction === undefined || direction === null) return 'forward';
  const raw = String(direction);
  if (raw === 'forward' || raw === 'left-to-right' || raw === '->') return 'forward';
  if (raw === 'backward' || raw === 'right-to-left' || raw === '<-' || raw === 'reverse') {
    return 'backward';
  }
  throw _rewriteError(`unknown rewrite direction "${raw}"`);
}

function _normaliseRewriteOccurrence(occurrence = 'all') {
  if (occurrence === undefined || occurrence === null || occurrence === 'all') {
    return { kind: 'all' };
  }
  if (occurrence === 'first') return { kind: 'index', index: 1 };
  const index = typeof occurrence === 'number' ? occurrence : Number(String(occurrence));
  if (Number.isSafeInteger(index) && index >= 1) return { kind: 'index', index };
  throw _rewriteError(`rewrite occurrence must be "all", "first", or a positive integer (got ${keyOf(occurrence)})`);
}

function _rewriteSides(eqNode, direction) {
  const eq = _asEquality(eqNode);
  if (!eq) throw _rewriteError('rewrite expects an equality link');
  if (_normaliseRewriteDirection(direction) === 'backward') {
    return { from: eq.right, to: eq.left };
  }
  return { from: eq.left, to: eq.right };
}

function _rewriteNode(node, from, to, occurrence) {
  const selected = _normaliseRewriteOccurrence(occurrence);
  let seen = 0;
  let count = 0;

  function walk(current) {
    if (isStructurallySame(current, from)) {
      seen += 1;
      if (selected.kind === 'all' || seen === selected.index) {
        count += 1;
        return cloneTerm(to);
      }
    }
    if (!Array.isArray(current)) return cloneTerm(current);
    return current.map(walk);
  }

  const rewritten = walk(node);
  return { node: rewritten, changed: count > 0, count, seen };
}

function _rewriteDetailed(goal, eq, options = {}) {
  const goalNode = parseTermInput(goal);
  const eqNode = parseTermInput(eq);
  const { from, to } = _rewriteSides(eqNode, options.direction);
  return _rewriteNode(goalNode, from, to, options.occurrence);
}

function rewrite(goal, eq, options = {}) {
  return _rewriteDetailed(goal, eq, options).node;
}

function _normaliseRewriteRules(rules) {
  if (rules === undefined || rules === null) return [];
  if (typeof rules === 'string') return parseLinoForms(rules);
  const parsed = parseTermInput(rules);
  if (_asEquality(parsed)) return [parsed];
  if (!Array.isArray(rules)) return [parsed];
  return rules.map(rule => {
    const node = parseTermInput(rule);
    if (!_asEquality(node)) {
      throw _rewriteError(`simplify expects equality rewrite rules (got ${keyOf(node)})`);
    }
    return node;
  });
}

function _normaliseSimplifyMaxSteps(options = {}) {
  const raw = options.maxSteps ?? options.simplifyMaxSteps ?? DEFAULT_SIMPLIFY_MAX_STEPS;
  const maxSteps = typeof raw === 'number' ? raw : Number(String(raw));
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) {
    throw _rewriteError(`simplify maxSteps must be a non-negative integer (got ${String(raw)})`);
  }
  return maxSteps;
}

function _simplifyDetailed(goal, rules, options = {}) {
  const ruleNodes = _normaliseRewriteRules(rules);
  const maxSteps = _normaliseSimplifyMaxSteps(options);
  let node = parseTermInput(goal);
  let changed = false;
  let steps = 0;

  while (true) {
    let applied = false;
    for (const rule of ruleNodes) {
      const rewritten = _rewriteDetailed(node, rule, { direction: options.direction });
      if (!rewritten.changed) continue;
      if (steps >= maxSteps) {
        throw _rewriteError(`simplify termination guard reached after ${maxSteps} rewrite steps`);
      }
      node = rewritten.node;
      steps += 1;
      changed = true;
      applied = true;
      break;
    }
    if (!applied) return { node, changed, steps };
  }
}

function simplify(goal, rules, options = {}) {
  return _simplifyDetailed(goal, rules, options).node;
}

function _normaliseTacticOptions(options = {}) {
  return {
    rewriteRules: _normaliseRewriteRules(options.rewriteRules ?? options.rules ?? []),
    simplifyMaxSteps: _normaliseSimplifyMaxSteps(options),
    atp: _normaliseAtpOptions(options),
    smt: _normaliseSmtOptions(options),
  };
}

function _parseRewriteTactic(args) {
  let index = 0;
  let direction = 'forward';
  if (args[index] === '->' || args[index] === '<-') {
    direction = args[index];
    index += 1;
  }
  if (args.length < index + 3 || args[index + 1] !== 'in' || args[index + 2] !== 'goal') {
    throw _rewriteError('rewrite expects `(rewrite [->|<-] (L = R) in goal [at N])`');
  }
  const eq = args[index];
  index += 3;
  let occurrence = 'all';
  if (index < args.length) {
    if (args[index] !== 'at' || index + 2 !== args.length) {
      throw _rewriteError('rewrite expects optional occurrence selector `at N`');
    }
    occurrence = args[index + 1];
  }
  return { eq, direction, occurrence };
}

function _parseSimplifyTactic(args) {
  if (args.length < 2 || args[0] !== 'in' || args[1] !== 'goal') {
    throw _rewriteError('simplify expects `(simplify in goal)`');
  }
  let index = 2;
  let rules = null;
  let maxSteps = null;
  while (index < args.length) {
    if (args[index] === 'using' && index + 1 < args.length) {
      rules = _normaliseRewriteRules(args[index + 1]);
      index += 2;
      continue;
    }
    if ((args[index] === 'max' || args[index] === 'limit') && index + 1 < args.length) {
      maxSteps = Number(String(args[index + 1]));
      index += 2;
      continue;
    }
    throw _rewriteError('simplify expects optional `using <rules>` and `max <steps>` clauses');
  }
  return { rules, maxSteps };
}

function _typeAscription(node) {
  if (Array.isArray(node) && node.length === 3 && node[1] === 'of') {
    return { term: node[0], type: node[2] };
  }
  return null;
}

function _exactClosesGoal(arg, goal) {
  if (isStructurallySame(arg, goal.goal)) return true;
  const ascription = _typeAscription(arg);
  if (ascription && isStructurallySame(ascription.type, goal.goal)) return true;
  return goal.context.some(ctx => {
    if (isStructurallySame(ctx, arg) && isStructurallySame(arg, goal.goal)) return true;
    if (isStructurallySame(ctx, goal.goal) && isStructurallySame(arg, goal.goal)) return true;
    const ctxAscription = _typeAscription(ctx);
    return !!ctxAscription &&
      isStructurallySame(ctxAscription.term, arg) &&
      isStructurallySame(ctxAscription.type, goal.goal);
  });
}

function _applyTactic(state, tactic, recordTactic = tactic, tacticOptions = _normaliseTacticOptions()) {
  const name = _tacticName(tactic);
  const args = _tacticArgs(tactic);

  if (name === 'by') {
    if (args.length === 1) return _applyTactic(state, args[0], recordTactic, tacticOptions);
    if (args.length > 1) return _applyTactic(state, args, recordTactic, tacticOptions);
    return {
      ok: false,
      state,
      diagnostic: _tacticDiagnostic(recordTactic, state.goals[0] || null, '`by` requires an inner tactic'),
    };
  }

  const current = state.goals[0] || null;
  if (!current) {
    return {
      ok: false,
      state,
      diagnostic: _tacticDiagnostic(recordTactic, null, 'no open goals'),
    };
  }

  if (name === 'reflexivity') {
    const eq = _asEquality(current.goal);
    if (!eq) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'reflexivity expects an equality goal'),
      };
    }
    if (!isStructurallySame(eq.left, eq.right)) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'both sides are not structurally equal'),
      };
    }
    return { ok: true, state: _replaceCurrentGoal(state, [], recordTactic) };
  }

  if (name === 'symmetry') {
    const eq = _asEquality(current.goal);
    if (!eq) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'symmetry expects an equality goal'),
      };
    }
    return {
      ok: true,
      state: _replaceCurrentGoal(
        state,
        [_goalWithContext(current, [eq.right, '=', eq.left])],
        recordTactic,
      ),
    };
  }

  if (name === 'transitivity') {
    const eq = _asEquality(current.goal);
    if (!eq || args.length !== 1) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'transitivity expects an equality goal and one intermediate term'),
      };
    }
    const mid = args[0];
    return {
      ok: true,
      state: _replaceCurrentGoal(
        state,
        [
          _goalWithContext(current, [eq.left, '=', mid]),
          _goalWithContext(current, [mid, '=', eq.right]),
        ],
        recordTactic,
      ),
    };
  }

  if (name === 'suppose') {
    if (args.length !== 1) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'suppose expects one hypothesis link'),
      };
    }
    const next = _cloneProofState(state);
    next.goals[0].context.push(cloneTerm(args[0]));
    next.proof.push(cloneTerm(recordTactic));
    return { ok: true, state: next };
  }

  if (name === 'introduce') {
    if (args.length !== 1 || typeof args[0] !== 'string') {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'introduce expects one variable name'),
      };
    }
    if (!Array.isArray(current.goal) || current.goal.length !== 3 || current.goal[0] !== 'Pi') {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'introduce expects a Pi goal'),
      };
    }
    const binding = parseBinding(current.goal[1]);
    if (!binding) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'introduce could not parse the Pi binder'),
      };
    }
    const variable = args[0];
    const body = subst(current.goal[2], binding.paramName, variable);
    const introduced = _goalWithContext(current, body);
    introduced.context.push([variable, 'of', cloneTerm(binding.paramType)]);
    return {
      ok: true,
      state: _replaceCurrentGoal(state, [introduced], recordTactic),
    };
  }

  if (name === 'rewrite') {
    let parsed;
    try {
      parsed = _parseRewriteTactic(args);
    } catch (err) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, err.message),
      };
    }
    let rewritten;
    try {
      rewritten = _rewriteDetailed(current.goal, parsed.eq, {
        direction: parsed.direction,
        occurrence: parsed.occurrence,
      });
    } catch (err) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, err.message),
      };
    }
    if (!rewritten.changed) {
      const { from } = _rewriteSides(parsed.eq, parsed.direction);
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, `rewrite did not find ${keyOf(from)} in the current goal`),
      };
    }
    return {
      ok: true,
      state: _replaceCurrentGoal(state, [_goalWithContext(current, rewritten.node)], recordTactic),
    };
  }

  if (name === 'simplify') {
    let parsed;
    try {
      parsed = _parseSimplifyTactic(args);
    } catch (err) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, err.message),
      };
    }
    const rules = parsed.rules ?? tacticOptions.rewriteRules;
    if (rules.length === 0) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'simplify expects at least one configured rewrite rule'),
      };
    }
    let simplified;
    try {
      simplified = _simplifyDetailed(current.goal, rules, {
        maxSteps: parsed.maxSteps ?? tacticOptions.simplifyMaxSteps,
      });
    } catch (err) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, err.message),
      };
    }
    return {
      ok: true,
      state: _replaceCurrentGoal(state, [_goalWithContext(current, simplified.node)], recordTactic),
    };
  }

  if (name === 'smt') {
    if (args.length !== 0) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'smt expects no arguments; configure the solver through tactic options'),
      };
    }
    let smtLib;
    try {
      smtLib = smtLibForGoal(current.goal);
    } catch (err) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, err.message),
      };
    }
    const checked = _runSmtSolver(smtLib, tacticOptions.smt);
    if (checked.status !== 'unsat') {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, checked.reason),
      };
    }
    return {
      ok: true,
      state: _replaceCurrentGoal(state, [], _smtTrustedNode(tacticOptions.smt)),
    };
  }

  if (name === 'atp') {
    if (args.length !== 0) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'atp expects no tactic arguments'),
      };
    }
    let tptp;
    try {
      tptp = goalToTptp(current);
    } catch (err) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, err.message),
      };
    }
    const atp = _runAtpProcess(tptp, tacticOptions.atp);
    if (!atp.ok) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, atp.reason),
      };
    }
    return {
      ok: true,
      state: _replaceCurrentGoal(state, [], ['by', 'atp-trusted', atp.solver]),
    };
  }

  if (name === 'exact') {
    if (args.length !== 1) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'exact expects one term or hypothesis'),
      };
    }
    if (!_exactClosesGoal(args[0], current)) {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, `${keyOf(args[0])} does not prove the current goal`),
      };
    }
    return { ok: true, state: _replaceCurrentGoal(state, [], recordTactic) };
  }

  if (name === 'induction') {
    if (args.length < 2 || typeof args[0] !== 'string') {
      return {
        ok: false,
        state,
        diagnostic: _tacticDiagnostic(recordTactic, current, 'induction expects a variable and at least one case'),
      };
    }
    const variable = args[0];
    const cases = args.slice(1);
    const openGoals = [];
    const nestedProofs = [];
    for (const caseNode of cases) {
      if (!Array.isArray(caseNode) || caseNode.length < 2 || caseNode[0] !== 'case') {
        return {
          ok: false,
          state,
          diagnostic: _tacticDiagnostic(recordTactic, current, 'induction cases must be `(case <pattern> <tactic>...)` links'),
        };
      }
      const pattern = caseNode[1];
      const caseGoal = _goalWithContext(current, subst(current.goal, variable, pattern));
      const caseTactics = caseNode.slice(2);
      if (caseTactics.length === 0) {
        openGoals.push(caseGoal);
        continue;
      }
      const nested = _runTacticsInternal({ goals: [caseGoal], proof: [] }, caseTactics, tacticOptions);
      if (nested.diagnostics.length > 0) {
        return { ok: false, state, diagnostic: nested.diagnostics[0] };
      }
      openGoals.push(...nested.state.goals);
      nestedProofs.push(...nested.state.proof);
    }
    return {
      ok: true,
      state: {
        goals: [...openGoals, ...state.goals.slice(1)],
        proof: [...state.proof, cloneTerm(recordTactic), ...nestedProofs.map(cloneTerm)],
      },
    };
  }

  return {
    ok: false,
    state,
    diagnostic: _tacticDiagnostic(recordTactic, current, `unknown tactic "${String(name || keyOf(tactic))}"`),
  };
}

function _runTacticsInternal(state, tactics, tacticOptions = _normaliseTacticOptions()) {
  let next = _cloneProofState(state);
  const diagnostics = [];
  for (const tactic of _normaliseTacticList(tactics)) {
    const applied = _applyTactic(next, tactic, tactic, tacticOptions);
    if (!applied.ok) {
      diagnostics.push(applied.diagnostic);
      break;
    }
    next = applied.state;
  }
  return { state: next, diagnostics };
}

function runTactics(state, tactics, options = {}) {
  return _runTacticsInternal(_normaliseProofState(state), tactics, _normaliseTacticOptions(options));
}

// Evaluate a node in arithmetic context — numeric literals are NOT clamped to the logic range.
function evalArith(node, env){
  if (typeof node === 'string' && isNum(node)) return parseFloat(node);
  const evaluated = evalNode(node, env);
  if (isTermResult(evaluated)) return evalArith(evaluated.term, env);
  return evaluated;
}

function isTermResult(value) {
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'term');
}

function evalTermNode(node, env) {
  if (!Array.isArray(node)) return node;

  if (node.length === 4 && node[0] === 'subst' && typeof node[2] === 'string') {
    return evalTermNode(subst(evalTermNode(node[1], env), node[2], evalTermNode(node[3], env)), env);
  }

  if (node.length === 3 && node[0] === 'apply') {
    const fn = node[1];
    const arg = evalTermNode(node[2], env);
    if (Array.isArray(fn) && fn.length === 3 && fn[0] === 'lambda') {
      const parsed = parseBinding(fn[1]);
      if (parsed) return evalTermNode(subst(fn[2], parsed.paramName, arg), env);
    }
    if (typeof fn === 'string') {
      const lambda = env.getLambda(fn);
      if (lambda) return evalTermNode(subst(lambda.body, lambda.param, arg), env);
    }
  }

  if (Array.isArray(node[0]) && node[0].length === 3 && node[0][0] === 'lambda' && node.length >= 2) {
    const parsed = parseBinding(node[0][1]);
    if (parsed) {
      const reduced = subst(node[0][2], parsed.paramName, evalTermNode(node[1], env));
      return node.length === 2 ? evalTermNode(reduced, env) : evalTermNode([reduced, ...node.slice(2)], env);
    }
  }

  return node;
}

function conversionOptionsFrom(ctx, options) {
  const opts = options || {};
  const ctxOpts = ctx && !(ctx instanceof Env) ? ctx : {};
  return {
    eta: Boolean(opts.eta || opts.etaConversion || ctxOpts.eta || ctxOpts.etaConversion),
  };
}

function parseTermInput(term) {
  if (Array.isArray(term)) return desugarHoas(term);
  if (typeof term !== 'string') return String(term);
  const trimmed = term.trim();
  if (trimmed.startsWith('(')) {
    try {
      return desugarHoas(parseOne(tokenizeOne(trimmed)));
    } catch (_) {
      return term;
    }
  }
  return term;
}

// Weak-head normal form (D4): reduce the spine of `node` — i.e. unfold the
// head as long as there are arguments to apply to it — without descending
// into binders or argument positions. The result's top-level form is either
// a value (lambda, Pi, fresh, a stuck/neutral application, etc.) or a leaf.
//
// "Spine reduction" means: gather the applied arguments, β-reduce them
// against the head one by one, and stop as soon as the spine is exhausted.
// Substitution may leave a new redex in the body, but it is not on the
// original term's spine, so whnf returns it unevaluated. Full normalization
// (`nf`) is the place that descends into those positions.
function whnfTerm(node, env, options = {}) {
  if (!Array.isArray(node)) return node;
  if (node.length === 0) return [];

  if (node.length === 4 && node[0] === 'subst' && typeof node[2] === 'string') {
    const term = whnfTerm(node[1], env, options);
    const replacement = node[3];
    return whnfTerm(subst(term, node[2], replacement), env, options);
  }

  // Collect the leftmost-outermost `apply` spine into [head, arg1, arg2, ...]
  // so the loop below can β-reduce against any number of arguments without
  // re-entering whnfTerm (which would descend into the substituted body's
  // spine and over-reduce — see the test "leaves arguments unevaluated").
  const spineArgs = [];
  let head = node;
  while (Array.isArray(head) && head.length === 3 && head[0] === 'apply') {
    spineArgs.unshift(head[2]);
    head = head[1];
  }

  // Prefix-call shape: `(f arg1 arg2 ...)` where `f` is a lambda value or a
  // bound name. Drain that into the spine before reducing.
  if (spineArgs.length === 0 && Array.isArray(head) && head.length > 1) {
    const isLambdaHead = Array.isArray(head[0]) && head[0].length === 3 && head[0][0] === 'lambda';
    const isNameHead = typeof head[0] === 'string' && head[0] !== 'apply' && head[0] !== 'lambda' && head[0] !== 'Pi' && head[0] !== 'fresh';
    if (isLambdaHead || isNameHead) {
      const [h, ...rest] = head;
      head = h;
      spineArgs.push(...rest);
    }
  }

  // Drain the spine by β-reducing against the head. Stop as soon as the
  // head can no longer reduce (not a lambda, not a bound name) or there
  // are no remaining args.
  while (spineArgs.length > 0) {
    if (Array.isArray(head) && head.length === 3 && head[0] === 'lambda') {
      const parsed = parseBinding(head[1]);
      if (!parsed) break;
      head = subst(head[2], parsed.paramName, spineArgs.shift());
      continue;
    }
    if (typeof head === 'string') {
      const lambda = env.getLambda(head) || env.getLambda(env._resolveQualified(head));
      if (!lambda) break;
      head = subst(lambda.body, lambda.param, spineArgs.shift());
      continue;
    }
    break;
  }

  if (spineArgs.length === 0) return head;

  // Stuck spine: rebuild the unreduced applies around the residual head.
  let stuck = head;
  for (const arg of spineArgs) stuck = ['apply', stuck, arg];
  return stuck;
}

// True for an `(apply head arg)` whose head is a free symbol the env cannot
// reduce further — i.e. an applied constructor or other neutral. The
// printed normal form drops the explicit `apply` keyword for these neutrals
// so `(apply succ zero)` shows as `(succ zero)`, matching the surface
// example in issue #50.
function isNeutralApply(node, env) {
  if (!Array.isArray(node) || node.length !== 3 || node[0] !== 'apply') return false;
  const fn = node[1];
  if (typeof fn !== 'string') return false;
  if (env.getLambda(fn) || env.getLambda(env._resolveQualified(fn))) return false;
  return isVariableToken(fn);
}

// Full normal form (D4): reduce every redex, including those nested inside
// binders and argument positions, until the term is in beta-(eta-)normal
// form. The implementation is a normal-order traversal that piggy-backs on
// the kernel's existing capture-avoiding `subst` helper so substitution
// stays definitionally equal to the rest of the typed kernel.
function normalizeTerm(node, env, options = {}) {
  if (!Array.isArray(node)) return node;
  if (node.length === 0) return [];

  if (node.length === 4 && node[0] === 'subst' && typeof node[2] === 'string') {
    const term = normalizeTerm(node[1], env, options);
    const replacement = normalizeTerm(node[3], env, options);
    return normalizeTerm(subst(term, node[2], replacement), env, options);
  }

  if (node.length === 3 && node[0] === 'apply') {
    const fn = normalizeTerm(node[1], env, options);
    const arg = normalizeTerm(node[2], env, options);
    if (Array.isArray(fn) && fn.length === 3 && fn[0] === 'lambda') {
      const parsed = parseBinding(fn[1]);
      if (parsed) return normalizeTerm(subst(fn[2], parsed.paramName, arg), env, options);
    }
    if (typeof fn === 'string') {
      const lambda = env.getLambda(fn) || env.getLambda(env._resolveQualified(fn));
      if (lambda) return normalizeTerm(subst(lambda.body, lambda.param, arg), env, options);
    }
    return ['apply', fn, arg];
  }

  if (node.length === 3 && node[0] === 'lambda') {
    const candidate = ['lambda', normalizeTerm(node[1], env, options), normalizeTerm(node[2], env, options)];
    return etaContract(candidate, env, options);
  }

  const [head, ...args] = node;
  if (Array.isArray(head) && head.length === 3 && head[0] === 'lambda' && args.length >= 1) {
    const parsed = parseBinding(head[1]);
    if (parsed) {
      const first = normalizeTerm(args[0], env, options);
      const reduced = subst(head[2], parsed.paramName, first);
      if (args.length === 1) return normalizeTerm(reduced, env, options);
      return normalizeTerm([reduced, ...args.slice(1)], env, options);
    }
  }

  if (typeof head === 'string' && args.length >= 1) {
    const lambda = env.getLambda(head) || env.getLambda(env._resolveQualified(head));
    if (lambda) {
      const first = normalizeTerm(args[0], env, options);
      const reduced = subst(lambda.body, lambda.param, first);
      if (args.length === 1) return normalizeTerm(reduced, env, options);
      return normalizeTerm([reduced, ...args.slice(1)], env, options);
    }
  }

  return node.map(child => normalizeTerm(child, env, options));
}

function etaContract(term, env, options) {
  if (!options.eta || !Array.isArray(term) || term.length !== 3 || term[0] !== 'lambda') {
    return term;
  }
  const bindings = parseBindings(term[1]);
  if (!bindings || bindings.length !== 1) return term;
  const param = bindings[0].paramName;
  const body = term[2];
  let fn = null;
  if (Array.isArray(body) && body.length === 3 && body[0] === 'apply' && isStructurallySame(body[2], param)) {
    fn = body[1];
  } else if (Array.isArray(body) && body.length === 2 && isStructurallySame(body[1], param)) {
    fn = body[0];
  }
  if (fn !== null && !freeVariables(fn).has(param)) {
    return normalizeTerm(fn, env, options);
  }
  return term;
}

function lookupAssignedInfix(env, op, left, right) {
  for (const expr of [[op, left, right], [left, op, right]]) {
    const key = keyOf(expr);
    if (env.assign.has(key)) {
      const value = env.assign.get(key);
      env.trace('lookup', `${key} → ${formatTraceValue(value)}`);
      return value;
    }
  }
  return null;
}

function sameNormalizedInput(left, right, leftTerm, rightTerm) {
  return isStructurallySame(left, leftTerm) && isStructurallySame(right, rightTerm);
}

function explicitSymbolNumber(node, env) {
  if (typeof node !== 'string') return null;
  if (env.symbolProb.has(node)) return env.symbolProb.get(node);
  const resolved = env._resolveQualified(node);
  if (resolved !== node && env.symbolProb.has(resolved)) return env.symbolProb.get(resolved);
  return null;
}

function tryEvalNumeric(node, env, options = {}) {
  const term = normalizeTerm(node, env, options);
  if (typeof term === 'string') {
    if (isNum(term)) return parseFloat(term);
    return explicitSymbolNumber(term, env);
  }
  if (!Array.isArray(term) || term.length === 0) return null;

  if (term.length === 3 && typeof term[1] === 'string' && ['+','-','*','/'].includes(term[1])) {
    const left = tryEvalNumeric(term[0], env, options);
    const right = tryEvalNumeric(term[2], env, options);
    if (left === null || right === null) return null;
    return env.getOp(term[1])(left, right);
  }

  if (term.length === 3 && typeof term[1] === 'string' && ['and','or','both','neither'].includes(term[1])) {
    const left = tryEvalNumeric(term[0], env, options);
    const right = tryEvalNumeric(term[2], env, options);
    if (left === null || right === null) return null;
    return env.clamp(env.getOp(term[1])(left, right));
  }

  const [head, ...args] = term;
  if (typeof head === 'string' && env.hasOp(head) && head !== '=' && head !== '!=') {
    const vals = [];
    for (const arg of args) {
      const value = tryEvalNumeric(arg, env, options);
      if (value === null) return null;
      vals.push(value);
    }
    return env.clamp(env.getOp(head)(...vals));
  }

  return null;
}

function equalityTruthValue(left, right, leftTerm, rightTerm, env, options = {}) {
  const assigned = lookupAssignedInfix(env, '=', left, right);
  if (assigned !== null) return env.clamp(assigned);
  if (!sameNormalizedInput(left, right, leftTerm, rightTerm)) {
    const normalizedAssigned = lookupAssignedInfix(env, '=', leftTerm, rightTerm);
    if (normalizedAssigned !== null) return env.clamp(normalizedAssigned);
  }
  if (isStructurallySame(leftTerm, rightTerm)) return env.hi;
  const leftNum = tryEvalNumeric(leftTerm, env, options);
  const rightNum = tryEvalNumeric(rightTerm, env, options);
  if (leftNum !== null && rightNum !== null) {
    return decRound(leftNum) === decRound(rightNum) ? env.hi : env.lo;
  }
  return env.lo;
}

function evalEqualityNode(left, op, right, env, options = {}) {
  const direct = lookupAssignedInfix(env, op, left, right);
  if (direct !== null) return env.clamp(direct);
  const leftTerm = normalizeTerm(left, env, options);
  const rightTerm = normalizeTerm(right, env, options);
  if (!sameNormalizedInput(left, right, leftTerm, rightTerm)) {
    const normalizedDirect = lookupAssignedInfix(env, op, leftTerm, rightTerm);
    if (normalizedDirect !== null) return env.clamp(normalizedDirect);
  }
  if (op === '=') {
    return env.clamp(equalityTruthValue(left, right, leftTerm, rightTerm, env, options));
  }
  const eq = equalityTruthValue(left, right, leftTerm, rightTerm, env, options);
  return env.clamp(env.getOp('not')(eq));
}

/**
 * Check definitional equality by normalizing two terms in the supplied context.
 *
 * @param {*} left - Left AST term.
 * @param {*} right - Right AST term.
 * @param {object} [ctx] - Type-checking context.
 * @param {object} [options] - Conversion options.
 * @returns {boolean} True when the terms are convertible.
 */
function isConvertible(left, right, ctx, options) {
  const env = ctx instanceof Env ? ctx : new Env(ctx && ctx.env ? ctx.env : ctx);
  const opts = conversionOptionsFrom(ctx, options);
  const leftNode = parseTermInput(left);
  const rightNode = parseTermInput(right);
  const assigned = lookupAssignedInfix(env, '=', leftNode, rightNode);
  if (assigned !== null) return env.clamp(assigned) === env.hi;
  const leftTerm = normalizeTerm(leftNode, env, opts);
  const rightTerm = normalizeTerm(rightNode, env, opts);
  if (!sameNormalizedInput(leftNode, rightNode, leftTerm, rightTerm)) {
    const normalizedAssigned = lookupAssignedInfix(env, '=', leftTerm, rightTerm);
    if (normalizedAssigned !== null) return env.clamp(normalizedAssigned) === env.hi;
  }
  return isStructurallySame(leftTerm, rightTerm);
}

// Drop the explicit `apply` keyword on neutral applications, recursively.
// `(apply f a)` whose head is a free constructor-like symbol becomes
// `(f a)` so the printed normal form matches the LiNo surface example
// from issue #50: `(succ (succ zero))` rather than the explicit
// `(apply succ (apply succ zero))`.
function flattenNeutralApplies(node, env) {
  if (!Array.isArray(node)) return node;
  if (node.length === 0) return node;
  const binder = binderInfo(node);
  if (binder) {
    const out = node.slice();
    out[binder.bodyIndex] = flattenNeutralApplies(node[binder.bodyIndex], env);
    return out;
  }
  const flattened = node.map(child => flattenNeutralApplies(child, env));
  if (isNeutralApply(flattened, env)) {
    return [flattened[1], flattened[2]];
  }
  return flattened;
}

// Public weak-head normal form API (issue #50, D4).
// Reduces only the spine of `term` — leaves binders and arguments untouched.
/**
 * Reduce a term to weak-head normal form without descending into arguments.
 */
function whnf(term, ctx, options) {
  const env = ctx instanceof Env ? ctx : new Env(ctx && ctx.env ? ctx.env : ctx);
  const opts = conversionOptionsFrom(ctx, options);
  return whnfTerm(parseTermInput(term), env, opts);
}

// Public full normal form API (issue #50, D4).
// Reduces every redex in `term`, including ones nested under binders and in
// argument positions, until the term is in beta-(eta-)normal form.
/**
 * Reduce a term to normal form.
 */
function nf(term, ctx, options) {
  const env = ctx instanceof Env ? ctx : new Env(ctx && ctx.env ? ctx.env : ctx);
  const opts = conversionOptionsFrom(ctx, options);
  return flattenNeutralApplies(normalizeTerm(parseTermInput(term), env, opts), env);
}

function evalReducedTerm(reduced, env) {
  const term = normalizeTerm(reduced, env);
  if (hasUnresolvedFreeVariables(term, env)) return { term };
  return evalNode(term, env);
}

// ---------- Mode declarations (issue #43, D15) ----------
// `(mode plus +input +input -output)` records the per-argument mode pattern
// for relation `plus`. Each flag is normalised to one of:
//   'in'     — `+input`  : caller must supply a ground argument here
//   'out'    — `-output` : the relation is expected to produce a value here
//   'either' — `*either` : no directionality constraint
// Any other token is rejected with a structured `E030` diagnostic at the
// declaration site so the parser does not silently accept typos.
const MODE_FLAG_TOKENS = {
  '+input': 'in',
  '-output': 'out',
  '*either': 'either',
};

function parseModeFlag(token) {
  if (typeof token !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(MODE_FLAG_TOKENS, token)
    ? MODE_FLAG_TOKENS[token]
    : null;
}

function parseModeForm(node) {
  if (!Array.isArray(node) || node.length < 2) return null;
  if (node[0] !== 'mode') return null;
  if (typeof node[1] !== 'string') {
    throw new RmlError('E030', 'Mode declaration: relation name must be a bare symbol');
  }
  const name = node[1];
  if (node.length < 3) {
    throw new RmlError('E030', `Mode declaration for "${name}" must list at least one mode flag`);
  }
  const flags = [];
  for (let i = 2; i < node.length; i++) {
    const flag = parseModeFlag(node[i]);
    if (flag === null) {
      throw new RmlError('E030', `Mode declaration for "${name}": unknown flag "${node[i]}" (expected +input, -output, or *either)`);
    }
    flags.push(flag);
  }
  return { name, flags };
}

// Decide whether an argument occupying a `+input` slot is "ground" enough.
// A ground argument has no free variables that the env cannot evaluate —
// numeric literals, declared terms, and known symbols are all fine; a fresh
// or otherwise unbound name is not.
function isGroundForMode(arg, env) {
  if (typeof arg === 'string') {
    if (isNum(arg)) return true;
    return contextHasName(env, arg);
  }
  if (!Array.isArray(arg)) return true;
  return !hasUnresolvedFreeVariables(arg, env);
}

// ---------- Relation declarations & totality (issue #44, D12) ----------
// `(relation <name> <clause>...)` records the clause list of a Twelf-style
// relation. Each clause is shaped `(<name> arg1 arg2 ... result)`, where
// `result` is the right-most argument (typically populated for relations
// whose mode declaration ends with `-output`). A single-rule shorthand
// `(relation <name> (<name> arg...) body)` is normalized to that clause shape.
// The body may contain recursive references to `<name>` whose `+input` slots
// must be strictly smaller than the head's; the totality checker enforces
// that decrease.
//
// `(total <name>)` triggers `isTotal(env, name)` and lifts the diagnostics
// it returns into the active diagnostic list. The same `isTotal` helper is
// also exported for programmatic use.
function parseRelationForm(node) {
  if (!Array.isArray(node) || node[0] !== 'relation') return null;
  if (node.length < 2 || typeof node[1] !== 'string') {
    throw new RmlError('E032', 'Relation declaration: relation name must be a bare symbol');
  }
  const name = node[1];
  if (node.length < 3) {
    throw new RmlError('E032', `Relation declaration for "${name}" must list at least one clause`);
  }
  if (node.length === 4) {
    const pattern = node[2];
    const body = node[3];
    const patternMatches = Array.isArray(pattern) && pattern.length >= 2 && pattern[0] === name;
    const bodyLooksLikeClause = Array.isArray(body) && body.length >= 2 && body[0] === name;
    if (patternMatches && !bodyLooksLikeClause) {
      return { name, clauses: [[...pattern, body]] };
    }
  }
  const clauses = [];
  for (let i = 2; i < node.length; i++) {
    const clause = node[i];
    if (!Array.isArray(clause) || clause.length < 2 || clause[0] !== name) {
      throw new RmlError(
        'E032',
        `Relation declaration for "${name}": clause ${i - 1} must be a list whose head is "${name}"`,
      );
    }
    clauses.push(clause);
  }
  return { name, clauses };
}

// True when `inner` is a strict subterm of `outer` — i.e. `outer` contains a
// proper sub-expression structurally identical to `inner`. The relation is
// strict: identical terms are not subterms of themselves. Used as the
// structural-decrease witness on recursive calls.
function isStrictSubterm(inner, outer) {
  if (!Array.isArray(outer)) return false;
  for (const child of outer) {
    if (isStructurallySame(inner, child)) return true;
    if (isStrictSubterm(inner, child)) return true;
  }
  return false;
}

// Walk `node` and collect every recursive call to `relName` (i.e. every
// list whose head is `relName`). The clause head itself is excluded so the
// caller compares recursive calls against the head, not against itself.
function collectRecursiveCalls(node, relName, isHead) {
  const out = [];
  if (!Array.isArray(node)) return out;
  if (!isHead && node[0] === relName) out.push(node);
  for (let i = 0; i < node.length; i++) {
    if (i === 0 && typeof node[i] === 'string') continue;
    out.push(...collectRecursiveCalls(node[i], relName, false));
  }
  return out;
}

// Check a single recursive call against the clause head. Returns null when
// at least one `+input` slot is a strict subterm of the head's; otherwise
// returns a counter-witness description suitable for a diagnostic.
//
// Recursive calls inside a clause's output expression (functional style)
// commonly carry only the `+input` arguments — the output is the sub-tree
// itself. To accommodate that, the call may either:
//   - supply every declared slot (`flags.length` arguments), in which case
//     we compare the corresponding input positions, or
//   - supply just the input slots (`numInputs` arguments), in which case
//     we line them up with the head's input positions in order.
function checkRecursiveDecrease(call, headArgs, flags, relName) {
  const callArgs = call.slice(1);
  const inputIndices = [];
  for (let i = 0; i < flags.length; i++) if (flags[i] === 'in') inputIndices.push(i);

  let inputPairs = null;
  if (callArgs.length === flags.length) {
    inputPairs = inputIndices.map(i => [callArgs[i], headArgs[i]]);
  } else if (callArgs.length === inputIndices.length) {
    inputPairs = inputIndices.map((i, j) => [callArgs[j], headArgs[i]]);
  } else {
    return {
      reason: `recursive call \`${keyOf(call)}\` has ${callArgs.length} argument${callArgs.length === 1 ? '' : 's'}, expected ${flags.length} (or ${inputIndices.length} input${inputIndices.length === 1 ? '' : 's'})`,
      call,
    };
  }

  if (inputIndices.length === 0) {
    return {
      reason: `relation "${relName}" has no \`+input\` slot, so structural decrease is unverifiable`,
      call,
    };
  }
  for (const [callArg, headArg] of inputPairs) {
    if (isStrictSubterm(callArg, headArg)) {
      return null; // decrease witnessed at this input slot
    }
  }
  return {
    reason: `recursive call \`${keyOf(call)}\` does not structurally decrease any \`+input\` slot of \`${keyOf([relName, ...headArgs])}\``,
    call,
  };
}

// Public-facing totality checker: returns `{ ok, diagnostics }`. When the
// relation has no declared modes the check is skipped and a single
// diagnostic is returned so callers can surface the missing prerequisite.
function isTotal(env, relName) {
  const diagnostics = [];
  const clauses = env.relations.get(relName);
  const flags = env.modes.get(relName);
  if (!flags) {
    diagnostics.push({
      code: 'E032',
      message: `Totality check for "${relName}": no \`(mode ${relName} ...)\` declaration found`,
    });
    return { ok: false, diagnostics };
  }
  if (!clauses || clauses.length === 0) {
    diagnostics.push({
      code: 'E032',
      message: `Totality check for "${relName}": no \`(relation ${relName} ...)\` clauses found`,
    });
    return { ok: false, diagnostics };
  }
  for (let ci = 0; ci < clauses.length; ci++) {
    const clause = clauses[ci];
    const headArgs = clause.slice(1);
    if (headArgs.length !== flags.length) {
      diagnostics.push({
        code: 'E032',
        message: `Totality check for "${relName}": clause ${ci + 1} \`${keyOf(clause)}\` has ${headArgs.length} argument${headArgs.length === 1 ? '' : 's'}, mode declares ${flags.length}`,
      });
      continue;
    }
    const calls = collectRecursiveCalls(clause, relName, true);
    for (const call of calls) {
      const witness = checkRecursiveDecrease(call, headArgs, flags, relName);
      if (witness) {
        diagnostics.push({
          code: 'E032',
          message: `Totality check for "${relName}": clause ${ci + 1} \`${keyOf(clause)}\` — ${witness.reason}`,
        });
      }
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

// ---------- Definitions & termination checking (issue #49, D13) ----------
// `(define <name> [(measure (lex <slot>...))] (case <pat-args> <body>) ...)`
// records a recursive definition keyed by `<name>`. Each `case` clause holds
// the pattern argument list (the head's arguments at this clause) and a body
// expression that may reference `<name>` recursively.
//
// `isTerminating(env, name)` returns `{ ok, diagnostics }`. The default
// (measure-less) check requires every recursive call to structurally
// decrease the first argument relative to the matching clause's first
// pattern. The explicit `(measure (lex k1 k2 ...))` form switches to a
// lexicographic measure: a recursive call is accepted when there is some
// position k where slots before k are structurally identical to the head's
// and slot k is a strict subterm. Slots are 1-based argument indices.
function parseDefineForm(node) {
  if (!Array.isArray(node) || node[0] !== 'define') return null;
  if (node.length < 2 || typeof node[1] !== 'string') {
    throw new RmlError('E035', 'Define declaration: name must be a bare symbol');
  }
  const name = node[1];
  if (node.length < 3) {
    throw new RmlError(
      'E035',
      `Define declaration for "${name}" must list at least one \`(case ...)\` clause`,
    );
  }
  let measure = null;
  const clauses = [];
  for (let i = 2; i < node.length; i++) {
    const child = node[i];
    if (Array.isArray(child) && child[0] === 'measure') {
      if (measure !== null) {
        throw new RmlError(
          'E035',
          `Define declaration for "${name}": only one \`(measure ...)\` clause is allowed`,
        );
      }
      if (child.length !== 2 || !Array.isArray(child[1]) || child[1][0] !== 'lex' || child[1].length < 2) {
        throw new RmlError(
          'E035',
          `Define declaration for "${name}": \`(measure ...)\` body must be \`(lex <slot>...)\``,
        );
      }
      const slots = [];
      for (let j = 1; j < child[1].length; j++) {
        const tok = child[1][j];
        if (typeof tok !== 'string' || !/^[0-9]+$/.test(tok)) {
          throw new RmlError(
            'E035',
            `Define declaration for "${name}": measure slot must be a positive integer`,
          );
        }
        const slot = parseInt(tok, 10);
        if (slot < 1) {
          throw new RmlError(
            'E035',
            `Define declaration for "${name}": measure slot must be a positive integer (got ${slot})`,
          );
        }
        slots.push(slot - 1); // store 0-based for direct array indexing
      }
      measure = { kind: 'lex', slots };
      continue;
    }
    if (Array.isArray(child) && child[0] === 'case') {
      if (child.length !== 3) {
        throw new RmlError(
          'E035',
          `Define declaration for "${name}": \`(case <pattern-args> <body>)\` clause must have exactly two children`,
        );
      }
      const patternArgs = child[1];
      if (!Array.isArray(patternArgs)) {
        throw new RmlError(
          'E035',
          `Define declaration for "${name}": \`(case ...)\` pattern must be a parenthesised argument list`,
        );
      }
      clauses.push({ pattern: patternArgs, body: child[2] });
      continue;
    }
    throw new RmlError(
      'E035',
      `Define declaration for "${name}": unexpected clause \`${keyOf(child)}\` (expected \`(measure ...)\` or \`(case ...)\`)`,
    );
  }
  if (clauses.length === 0) {
    throw new RmlError(
      'E035',
      `Define declaration for "${name}" must list at least one \`(case ...)\` clause`,
    );
  }
  return { name, measure, clauses };
}

// Verify a single recursive call's arguments against the matching clause's
// pattern arguments. Returns null on success, or an object describing why
// the call cannot be accepted as decreasing.
function checkDefineDecrease(call, patternArgs, measure, defName) {
  const callArgs = call.slice(1);
  if (callArgs.length !== patternArgs.length) {
    return {
      reason: `recursive call \`${keyOf(call)}\` has ${callArgs.length} argument${callArgs.length === 1 ? '' : 's'}, clause pattern declares ${patternArgs.length}`,
    };
  }
  if (measure && measure.kind === 'lex') {
    for (const slot of measure.slots) {
      if (slot >= patternArgs.length) {
        return {
          reason: `measure slot ${slot + 1} is out of range for ${patternArgs.length}-argument clause`,
        };
      }
    }
    // Lexicographic check: find the first slot where call < pattern; earlier
    // slots must be structurally identical to the corresponding pattern.
    for (const slot of measure.slots) {
      const callArg = callArgs[slot];
      const patArg = patternArgs[slot];
      if (isStrictSubterm(callArg, patArg)) {
        return null; // strict decrease at this slot — earlier slots already equal
      }
      if (!isStructurallySame(callArg, patArg)) {
        // Neither equal nor strictly smaller → no further slot can rescue it.
        return {
          reason: `recursive call \`${keyOf(call)}\` does not lexicographically decrease the declared measure`,
        };
      }
    }
    return {
      reason: `recursive call \`${keyOf(call)}\` does not lexicographically decrease the declared measure`,
    };
  }
  // Default: structural decrease on the first argument.
  if (patternArgs.length === 0) {
    return {
      reason: `definition "${defName}" has no arguments, so structural decrease is unverifiable`,
    };
  }
  if (isStrictSubterm(callArgs[0], patternArgs[0])) {
    return null;
  }
  return {
    reason: `recursive call \`${keyOf(call)}\` does not structurally decrease the first argument of \`${keyOf([defName, ...patternArgs])}\``,
  };
}

// Public-facing termination checker for `(define ...)` declarations.
// Mirrors the shape of `isTotal`. Returns `{ ok, diagnostics }`. Each
// diagnostic uses code `E035`.
function isTerminating(env, defName) {
  const diagnostics = [];
  const decl = env.definitions.get(defName);
  if (!decl) {
    diagnostics.push({
      code: 'E035',
      message: `Termination check for "${defName}": no \`(define ${defName} ...)\` declaration found`,
    });
    return { ok: false, diagnostics };
  }
  for (let ci = 0; ci < decl.clauses.length; ci++) {
    const clause = decl.clauses[ci];
    const calls = collectRecursiveCalls(clause.body, defName, false);
    for (const call of calls) {
      const witness = checkDefineDecrease(call, clause.pattern, decl.measure, defName);
      if (witness) {
        diagnostics.push({
          code: 'E035',
          message: `Termination check for "${defName}": clause ${ci + 1} \`${keyOf(['case', clause.pattern, clause.body])}\` — ${witness.reason}`,
        });
      }
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

// ---------- Coverage checking (issue #46, D14) ----------
// `(coverage <name>)` verifies that, for every `+input` slot of relation
// `<name>`, the union of clause patterns at that slot exhausts every
// constructor of the slot's inductive type. Variables (lowercase names not
// resolvable in the env) act as wildcards covering all constructors. When
// a constructor is missing, an `E037` diagnostic is emitted with an example
// pattern such as `(succ _)`.
//
// The same `isCovered(env, name)` helper is exported for programmatic use.
// Slots whose inductive type cannot be inferred (no concrete constructor
// appears anywhere in the patterns at that slot) are skipped — coverage
// is opt-in per slot, just like world checking is opt-in per relation.

// Find the inductive type whose declared constructors include `ctorName`.
// Returns the type name string, or null when the constructor is unknown.
function inductiveTypeOfConstructor(env, ctorName) {
  for (const [typeName, decl] of env.inductives) {
    for (const ctor of decl.constructors) {
      if (ctor.name === ctorName) return typeName;
    }
  }
  return null;
}

// True when `pat` is a wildcard at this slot — i.e. a bare lowercase symbol
// that is not a registered constructor or other named term in the env.
function isWildcardPattern(pat, env) {
  if (typeof pat !== 'string') return false;
  if (isNum(pat)) return false;
  if (NON_VARIABLE_TOKENS.has(pat)) return false;
  if (inductiveTypeOfConstructor(env, pat) !== null) return false;
  return true;
}

// Extract the constructor name a pattern matches, or null when the pattern
// is a wildcard / does not pin a constructor.
function patternConstructorHead(pat, env) {
  if (typeof pat === 'string') {
    if (inductiveTypeOfConstructor(env, pat) !== null) return pat;
    return null;
  }
  if (Array.isArray(pat) && pat.length >= 1 && typeof pat[0] === 'string') {
    if (inductiveTypeOfConstructor(env, pat[0]) !== null) return pat[0];
  }
  return null;
}

// Infer the inductive type at a single slot by examining every clause's
// pattern at that position. The first clause whose pattern names a
// constructor wins. Returns null when no clause pins a concrete type.
function inferSlotType(env, clauses, slotIndex) {
  for (const clause of clauses) {
    const pat = clause[slotIndex + 1];
    const head = patternConstructorHead(pat, env);
    if (head !== null) return inductiveTypeOfConstructor(env, head);
  }
  return null;
}

// Render a placeholder pattern for a constructor — `zero` for a constant
// constructor, `(succ _)` for a constructor with parameters.
function exampleConstructorPattern(ctor) {
  if (ctor.params.length === 0) return ctor.name;
  return `(${ctor.name}${' _'.repeat(ctor.params.length)})`;
}

function isCovered(env, relName) {
  const diagnostics = [];
  const clauses = env.relations.get(relName);
  const flags = env.modes.get(relName);
  if (!flags) {
    diagnostics.push({
      code: 'E037',
      message: `Coverage check for "${relName}": no \`(mode ${relName} ...)\` declaration found`,
    });
    return { ok: false, diagnostics };
  }
  if (!clauses || clauses.length === 0) {
    diagnostics.push({
      code: 'E037',
      message: `Coverage check for "${relName}": no \`(relation ${relName} ...)\` clauses found`,
    });
    return { ok: false, diagnostics };
  }
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] !== 'in') continue;
    const slotPatterns = clauses.map(c => c[i + 1]);
    if (slotPatterns.some(pat => isWildcardPattern(pat, env))) continue;
    const typeName = inferSlotType(env, clauses, i);
    if (typeName === null) continue;
    const decl = env.inductives.get(typeName);
    if (!decl) continue;
    const covered = new Set();
    for (const pat of slotPatterns) {
      const head = patternConstructorHead(pat, env);
      if (head !== null) covered.add(head);
    }
    const missing = decl.constructors.filter(c => !covered.has(c.name));
    if (missing.length === 0) continue;
    const examples = missing.map(exampleConstructorPattern).join(', ');
    diagnostics.push({
      code: 'E037',
      message: `Coverage check for "${relName}": +input slot ${i + 1} (type "${typeName}") missing case${missing.length === 1 ? '' : 's'} for constructor${missing.length === 1 ? '' : 's'} ${examples}`,
    });
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

// ---------- World declarations (issue #54, D16) ----------
// `(world plus (Natural))` records the allow-list of constants permitted
// to appear free in arguments to relation `plus`. The world checker
// rejects relation calls whose arguments contain any other free constant
// with a structured `E034` diagnostic. Relations without a recorded
// world are unconstrained — the feature is opt-in per relation.
function parseWorldForm(node) {
  if (!Array.isArray(node) || node[0] !== 'world') return null;
  if (node.length < 2 || typeof node[1] !== 'string') {
    throw new RmlError('E034', 'World declaration: relation name must be a bare symbol');
  }
  const name = node[1];
  if (node.length !== 3 || !Array.isArray(node[2])) {
    throw new RmlError(
      'E034',
      `World declaration for "${name}" must have shape \`(world ${name} (<const>...))\``,
    );
  }
  const allowed = [];
  for (const item of node[2]) {
    if (typeof item !== 'string') {
      throw new RmlError(
        'E034',
        `World declaration for "${name}": each allowed constant must be a bare symbol`,
      );
    }
    allowed.push(item);
  }
  return { name, allowed };
}

// Walk an argument expression and collect every free constant — i.e.
// every leaf symbol that is not numeric, not a reserved keyword, and is
// not bound by an enclosing `lambda`/`Pi`/`fresh` binder appearing
// inside the same argument. The collected names are matched against the
// world's `allowed` list to surface E034 violations.
function collectFreeConstants(node, bound, out) {
  if (typeof node === 'string') {
    if (isNum(node)) return;
    if (NON_VARIABLE_TOKENS.has(node)) return;
    if (bound.has(node)) return;
    if (!out.includes(node)) out.push(node);
    return;
  }
  if (!Array.isArray(node)) return;
  if (node.length >= 3 && (node[0] === 'lambda' || node[0] === 'Pi')
      && Array.isArray(node[1]) && node[1].length === 2 && typeof node[1][1] === 'string') {
    const ty = node[1][0];
    if (typeof ty === 'string') {
      if (!isNum(ty) && !NON_VARIABLE_TOKENS.has(ty) && !bound.has(ty) && !out.includes(ty)) {
        out.push(ty);
      }
    } else {
      collectFreeConstants(ty, bound, out);
    }
    const variable = node[1][1];
    const wasBound = bound.has(variable);
    bound.add(variable);
    for (let i = 2; i < node.length; i++) {
      collectFreeConstants(node[i], bound, out);
    }
    if (!wasBound) bound.delete(variable);
    return;
  }
  if (node.length === 4 && node[0] === 'fresh' && node[2] === 'in' && typeof node[1] === 'string') {
    const variable = node[1];
    const wasBound = bound.has(variable);
    bound.add(variable);
    collectFreeConstants(node[3], bound, out);
    if (!wasBound) bound.delete(variable);
    return;
  }
  for (const child of node) {
    collectFreeConstants(child, bound, out);
  }
}

// Validate a relation call's arguments against its world declaration.
// Returns the offending RmlError, or `null` when the call is consistent
// (or no declaration exists).
function checkWorldAtCall(name, args, env) {
  const allowed = env.worlds.get(name);
  if (!allowed) return null;
  const violations = [];
  for (const arg of args) {
    const bound = new Set();
    const found = [];
    collectFreeConstants(arg, bound, found);
    for (const sym of found) {
      if (sym === name) continue;
      if (allowed.includes(sym)) continue;
      if (!violations.includes(sym)) violations.push(sym);
    }
  }
  if (violations.length === 0) return null;
  const listed = violations.map(s => `"${s}"`).join(', ');
  return new RmlError(
    'E034',
    `World violation: "${name}" argument contains free constant${violations.length === 1 ? '' : 's'} ${listed} not in declared world`,
  );
}

// ---------- Inductive declarations (issue #45, D10) ----------
// `(inductive Name (constructor c1) (constructor (c2 (Pi (A x) ... Name))) ...)`
// declares a first-class inductive datatype encoded as link signatures plus
// a generated eliminator `Name-rec`. The declaration:
//
//   1. registers `Name : (Type 0)` as a typed term;
//   2. installs every constructor — bare constants get type `Name`, while
//      constructors written as `(c (Pi (A x) ... Name))` keep their Pi-type
//      so existing `(type of c)` and `(c of (Pi ...))` queries succeed;
//   3. synthesises the eliminator `Name-rec` and its dependent Pi-type from
//      the declared constructors, mirroring the standard induction principle:
//        Name-rec : (Pi (motive (Pi (Name _) (Type 0)))
//                    (Pi (case_c1 (apply motive c1))
//                      ...
//                       (Pi (case_cN (... step type ...))
//                          (Pi (target Name) (apply motive target)))))
//      Each step type for a constructor with one or more recursive `Name`
//      arguments includes one inductive-hypothesis premise `(apply motive arg)`
//      per recursive position.
//   4. records the inductive declaration on `env.inductives` for tooling.
//
// The declaration intentionally only requires a Pi-typed signature where
// every parameter type is either a previously declared type (acceptable as
// a non-recursive constructor argument) or `Name` itself (a recursive
// position used to synthesise the inductive hypothesis). Strict positivity
// beyond this syntactic check is out of scope (see Out of Scope in #45).

function _isPiSig(node) {
  return Array.isArray(node) && node.length === 3 && node[0] === 'Pi';
}

// Walk a (Pi (A x) (Pi (B y) ... R)) chain into an array of binder pairs and
// the final result. Returns `null` when the shape is malformed.
function _flattenPi(typeNode) {
  const params = [];
  let current = typeNode;
  while (_isPiSig(current)) {
    const binding = parseBinding(current[1]);
    if (!binding) return null;
    params.push({ name: binding.paramName, type: binding.paramType });
    current = current[2];
  }
  return { params, result: current };
}

// Build a chain of nested Pi nodes from a list of `{ name, type }` parameters
// and a final result node. With an empty parameter list returns the result
// untouched, so callers can fold a single parameter list into a Pi-type
// without special-casing.
function _buildPi(params, result) {
  let out = result;
  for (let i = params.length - 1; i >= 0; i--) {
    const p = params[i];
    out = ['Pi', [p.type, p.name], out];
  }
  return out;
}

// Parse a single (constructor ...) clause into `{ name, params, type }`.
// Accepts the two surface shapes:
//   - `(constructor c)` — bare constant constructor of type `Name`.
//   - `(constructor (c (Pi ...)))` — constructor with a Pi-typed signature.
function parseConstructorClause(clause, typeName) {
  if (!Array.isArray(clause) || clause[0] !== 'constructor' || clause.length !== 2) {
    throw new RmlError(
      'E033',
      `Inductive declaration for "${typeName}": each clause must be \`(constructor <name>)\` or \`(constructor (<name> <pi-type>))\``,
    );
  }
  const body = clause[1];
  if (typeof body === 'string') {
    return { name: body, params: [], type: typeName };
  }
  if (Array.isArray(body) && body.length === 2 && typeof body[0] === 'string' && _isPiSig(body[1])) {
    const flat = _flattenPi(body[1]);
    if (!flat) {
      throw new RmlError(
        'E033',
        `Inductive declaration for "${typeName}": constructor "${body[0]}" has malformed Pi-type \`${keyOf(body[1])}\``,
      );
    }
    if (typeof flat.result !== 'string' || flat.result !== typeName) {
      throw new RmlError(
        'E033',
        `Inductive declaration for "${typeName}": constructor "${body[0]}" must return "${typeName}" (got "${typeof flat.result === 'string' ? flat.result : keyOf(flat.result)}")`,
      );
    }
    return { name: body[0], params: flat.params, type: body[1] };
  }
  throw new RmlError(
    'E033',
    `Inductive declaration for "${typeName}": malformed constructor clause \`${keyOf(clause)}\``,
  );
}

function parseInductiveForm(node) {
  if (!Array.isArray(node) || node[0] !== 'inductive') return null;
  if (node.length < 2 || typeof node[1] !== 'string') {
    throw new RmlError('E033', 'Inductive declaration: type name must be a bare symbol');
  }
  const name = node[1];
  if (!/^[A-Z]/.test(name)) {
    throw new RmlError(
      'E033',
      `Inductive declaration for "${name}": type name must start with an uppercase letter`,
    );
  }
  if (node.length < 3) {
    throw new RmlError(
      'E033',
      `Inductive declaration for "${name}" must list at least one constructor`,
    );
  }
  const constructors = [];
  const seen = new Set();
  for (let i = 2; i < node.length; i++) {
    const ctor = parseConstructorClause(node[i], name);
    if (seen.has(ctor.name)) {
      throw new RmlError(
        'E033',
        `Inductive declaration for "${name}": constructor "${ctor.name}" is declared more than once`,
      );
    }
    seen.add(ctor.name);
    constructors.push(ctor);
  }
  return { name, constructors };
}

// Build the case (step) type for one constructor under the eliminator's
// motive `m`. For a constructor `c : (Pi (A1 x1) ... (Pi (Ak xk) Name))`
// the case type is:
//
//   (Pi (A1 x1) ... (Pi (Ak xk)
//      (Pi (ih_j1 (apply m xj1)) ... (Pi (ih_jr (apply m xjr))
//          (apply m (c x1 ... xk)))))
//
// where `xj1..xjr` are the parameters whose declared type is `Name` (i.e.
// the recursive arguments). Constant constructors degenerate to
// `(apply m c)`.
function _buildCaseType(ctor, typeName, motiveVar) {
  const recBinders = [];
  for (let i = 0; i < ctor.params.length; i++) {
    const p = ctor.params[i];
    if (typeof p.type === 'string' && p.type === typeName) {
      recBinders.push({
        name: `ih_${p.name}`,
        type: ['apply', motiveVar, p.name],
      });
    }
  }
  let ctorApplied;
  if (ctor.params.length === 0) {
    ctorApplied = ctor.name;
  } else {
    ctorApplied = [ctor.name, ...ctor.params.map(p => p.name)];
  }
  const motiveOnTarget = ['apply', motiveVar, ctorApplied];
  const inner = _buildPi(recBinders, motiveOnTarget);
  return _buildPi(ctor.params, inner);
}

// Compose the dependent eliminator type for `Name-rec`, given the parsed
// inductive declaration. The motive parameter binds the symbol `_motive`
// throughout, and each constructor case parameter binds `case_<ctorName>`.
function buildEliminatorType(decl) {
  const motiveVar = '_motive';
  const motiveType = ['Pi', [decl.name, '_'], ['Type', '0']];
  const caseParams = decl.constructors.map(c => ({
    name: `case_${c.name}`,
    type: _buildCaseType(c, decl.name, motiveVar),
  }));
  const targetVar = '_target';
  const final = ['apply', motiveVar, targetVar];
  const inner = _buildPi([{ name: targetVar, type: decl.name }], final);
  const withCases = _buildPi(caseParams, inner);
  return _buildPi([{ name: motiveVar, type: motiveType }], withCases);
}

// Record an inductive declaration on the environment: install the type, all
// constructors, the eliminator name, and the eliminator's Pi-type.
function registerInductive(env, decl) {
  const storeType = env.qualifyName(decl.name);
  env.terms.add(storeType);
  env.setType(storeType, ['Type', '0']);
  evalNode(['Type', '0'], env);

  for (const ctor of decl.constructors) {
    const storeName = env.qualifyName(ctor.name);
    env.terms.add(storeName);
    env.setType(storeName, ctor.type);
    if (Array.isArray(ctor.type)) evalNode(ctor.type, env);
  }

  const elimName = `${decl.name}-rec`;
  const elimType = buildEliminatorType(decl);
  const storeElim = env.qualifyName(elimName);
  env.terms.add(storeElim);
  env.setType(storeElim, elimType);
  evalNode(elimType, env);

  env.inductives.set(decl.name, {
    name: decl.name,
    constructors: decl.constructors,
    elimName,
    elimType,
  });
  return 1;
}

// ---------- Coinductive declarations (issue #53, D11) ----------
// `(coinductive Name (constructor c1) (constructor (c2 (Pi (A x) ... Name))) ...)`
// declares a first-class coinductive datatype encoded as link signatures plus
// a generated corecursor `Name-corec`. The declaration mirrors `inductive`
// but additionally enforces a syntactic *productivity* check:
//
//   - At least one constructor must take a recursive `Name` argument.
//
// The check captures the essential dual of the inductive case: an inductive
// type with no recursive constructors is just a finite enumeration and works
// fine; a coinductive type with no recursive constructors cannot generate
// any infinite value, so corecursive definitions over it can never make
// progress (i.e. they are non-productive). Declarations failing this check
// raise `E036`.
//
// The generated corecursor `Name-corec` follows the standard coiteration
// principle. For a state type `X`, each constructor case takes the seed
// state and produces the constructor's argument list with recursive `Name`
// positions replaced by `X` (the next-state slot):
//
//   Name-corec : (Pi (X (Type 0))
//                 (Pi (case_c1 (Pi (X _state) <c1 sig with Name → X in args, Name in result>))
//                   ...
//                   (Pi (case_cN ...)
//                     (Pi (_seed X) Name))))
//
// For a constant constructor (no parameters) the case degenerates to
// `(Pi (X _state) Name)`. The corecursor type participates in the
// bidirectional checker just like any other typed term.

// Walk a constructor's parameter list and return the indices whose declared
// type is exactly the inductive type name (the recursive positions). Used
// both by the productivity check and by corecursor-type generation.
function _recursiveParamIndices(ctor, typeName) {
  const indices = [];
  for (let i = 0; i < ctor.params.length; i++) {
    const p = ctor.params[i];
    if (typeof p.type === 'string' && p.type === typeName) indices.push(i);
  }
  return indices;
}

// Build the case (step) type for one constructor under the corecursor's
// state variable `X`. For `c : (Pi (A1 x1) ... (Pi (Ak xk) Name))` the case
// type is:
//
//   (Pi (X _state) (Pi (A1' x1) ... (Pi (Ak' xk) Name)))
//
// where each `Ai' = X` if the original `Ai = Name` (recursive position) and
// otherwise `Ai' = Ai`. A constant constructor degenerates to
// `(Pi (X _state) Name)`.
function _buildCorecCaseType(ctor, typeName, stateVar) {
  const dualParams = ctor.params.map(p => ({
    name: p.name,
    type: (typeof p.type === 'string' && p.type === typeName) ? stateVar : p.type,
  }));
  const inner = _buildPi(dualParams, typeName);
  return _buildPi([{ name: '_state', type: stateVar }], inner);
}

// Compose the dependent corecursor type for `Name-corec`, given the parsed
// coinductive declaration. The state parameter binds the symbol `_state`
// throughout, and each constructor case parameter binds `case_<ctorName>`.
function buildCorecursorType(decl) {
  const stateVar = '_state_type';
  const stateType = ['Type', '0'];
  const caseParams = decl.constructors.map(c => ({
    name: `case_${c.name}`,
    type: _buildCorecCaseType(c, decl.name, stateVar),
  }));
  const seedVar = '_seed';
  const final = decl.name;
  const inner = _buildPi([{ name: seedVar, type: stateVar }], final);
  const withCases = _buildPi(caseParams, inner);
  return _buildPi([{ name: stateVar, type: stateType }], withCases);
}

function parseCoinductiveForm(node) {
  if (!Array.isArray(node) || node[0] !== 'coinductive') return null;
  if (node.length < 2 || typeof node[1] !== 'string') {
    throw new RmlError('E036', 'Coinductive declaration: type name must be a bare symbol');
  }
  const name = node[1];
  if (!/^[A-Z]/.test(name)) {
    throw new RmlError(
      'E036',
      `Coinductive declaration for "${name}": type name must start with an uppercase letter`,
    );
  }
  if (node.length < 3) {
    throw new RmlError(
      'E036',
      `Coinductive declaration for "${name}" must list at least one constructor`,
    );
  }
  const constructors = [];
  const seen = new Set();
  for (let i = 2; i < node.length; i++) {
    const ctor = parseConstructorClauseCo(node[i], name);
    if (seen.has(ctor.name)) {
      throw new RmlError(
        'E036',
        `Coinductive declaration for "${name}": constructor "${ctor.name}" is declared more than once`,
      );
    }
    seen.add(ctor.name);
    constructors.push(ctor);
  }
  // Productivity check (guarded corecursion): at least one constructor must
  // take a recursive `Name` argument so the type can generate progress.
  const anyRecursive = constructors.some(c => _recursiveParamIndices(c, name).length > 0);
  if (!anyRecursive) {
    throw new RmlError(
      'E036',
      `Coinductive declaration for "${name}" is non-productive: at least one constructor must take a recursive "${name}" argument`,
    );
  }
  return { name, constructors };
}

// Parse a single (constructor ...) clause for a coinductive declaration.
// Identical shape rules as the inductive form, but errors are reported with
// E036 so coinductive-specific failures stay distinguishable from E033.
function parseConstructorClauseCo(clause, typeName) {
  if (!Array.isArray(clause) || clause[0] !== 'constructor' || clause.length !== 2) {
    throw new RmlError(
      'E036',
      `Coinductive declaration for "${typeName}": each clause must be \`(constructor <name>)\` or \`(constructor (<name> <pi-type>))\``,
    );
  }
  const body = clause[1];
  if (typeof body === 'string') {
    return { name: body, params: [], type: typeName };
  }
  if (Array.isArray(body) && body.length === 2 && typeof body[0] === 'string' && _isPiSig(body[1])) {
    const flat = _flattenPi(body[1]);
    if (!flat) {
      throw new RmlError(
        'E036',
        `Coinductive declaration for "${typeName}": constructor "${body[0]}" has malformed Pi-type \`${keyOf(body[1])}\``,
      );
    }
    if (typeof flat.result !== 'string' || flat.result !== typeName) {
      throw new RmlError(
        'E036',
        `Coinductive declaration for "${typeName}": constructor "${body[0]}" must return "${typeName}" (got "${typeof flat.result === 'string' ? flat.result : keyOf(flat.result)}")`,
      );
    }
    return { name: body[0], params: flat.params, type: body[1] };
  }
  throw new RmlError(
    'E036',
    `Coinductive declaration for "${typeName}": malformed constructor clause \`${keyOf(clause)}\``,
  );
}

// Record a coinductive declaration on the environment: install the type,
// all constructors, the corecursor name, and the corecursor's Pi-type.
function registerCoinductive(env, decl) {
  const storeType = env.qualifyName(decl.name);
  env.terms.add(storeType);
  env.setType(storeType, ['Type', '0']);
  evalNode(['Type', '0'], env);

  for (const ctor of decl.constructors) {
    const storeName = env.qualifyName(ctor.name);
    env.terms.add(storeName);
    env.setType(storeName, ctor.type);
    if (Array.isArray(ctor.type)) evalNode(ctor.type, env);
  }

  const corecName = `${decl.name}-corec`;
  const corecType = buildCorecursorType(decl);
  const storeCorec = env.qualifyName(corecName);
  env.terms.add(storeCorec);
  env.setType(storeCorec, corecType);
  evalNode(corecType, env);

  env.coinductives.set(decl.name, {
    name: decl.name,
    constructors: decl.constructors,
    corecName,
    corecType,
  });
  return 1;
}

// Check a call site `(name args...)` against any registered mode declaration
// for `name`. Returns the offending RmlError on mismatch, or `null` when the
// call is consistent (or no declaration exists).
function checkModeAtCall(name, args, env) {
  const flags = env.modes.get(name);
  if (!flags) return null;
  if (args.length !== flags.length) {
    return new RmlError(
      'E031',
      `Mode mismatch for "${name}": expected ${flags.length} argument${flags.length === 1 ? '' : 's'}, got ${args.length}`,
    );
  }
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === 'in' && !isGroundForMode(args[i], env)) {
      return new RmlError(
        'E031',
        `Mode mismatch for "${name}": argument ${i + 1} (+input) is not ground`,
      );
    }
  }
  return null;
}

function contextHasName(env, name) {
  if (env.terms.has(name) || env.types.has(name) || env.lambdas.has(name) || env.symbolProb.has(name) || env.ops.has(name)) {
    return true;
  }
  const resolved = env._resolveQualified(name);
  return resolved !== name && (
    env.terms.has(resolved) ||
    env.types.has(resolved) ||
    env.lambdas.has(resolved) ||
    env.symbolProb.has(resolved) ||
    env.ops.has(resolved)
  );
}

function evalFresh(varName, body, env) {
  if (contextHasName(env, varName)) {
    throw new RmlError('E010', `fresh variable "${varName}" already appears in context`);
  }
  const hadTerm = env.terms.has(varName);
  const hadType = env.types.has(varName);
  const previousType = env.types.get(varName);
  const hadLambda = env.lambdas.has(varName);
  const previousLambda = env.lambdas.get(varName);
  const hadSymbol = env.symbolProb.has(varName);
  const previousSymbol = env.symbolProb.get(varName);
  env.terms.add(varName);
  try {
    return evalNode(body, env);
  } finally {
    if (!hadTerm) env.terms.delete(varName);
    if (hadType) env.types.set(varName, previousType);
    else env.types.delete(varName);
    if (hadLambda) env.lambdas.set(varName, previousLambda);
    else env.lambdas.delete(varName);
    if (hadSymbol) env.symbolProb.set(varName, previousSymbol);
    else env.symbolProb.delete(varName);
  }
}

function decideAutomaticSequenceTheorem(name) {
  if (name === 'thue-morse-cube-free') {
    return {
      theorem: name,
      value: true,
      method: 'built-in Buchi emptiness certificate',
      certificate: ['buchi-emptiness', 'thue-morse', 'cube-free'],
    };
  }
  return null;
}

function automaticSequencesDomainPlugin(forms, env) {
  if (!Array.isArray(forms) || forms.length === 0) {
    throw new RmlError('E041', 'automatic-sequences domain requires at least one request');
  }
  for (const form of forms) {
    if (!Array.isArray(form) || form.length !== 2 || form[0] !== 'theorem' || typeof form[1] !== 'string') {
      throw new RmlError('E041', 'automatic-sequences entries must be `(theorem <name>)`');
    }
    const decision = decideAutomaticSequenceTheorem(form[1]);
    if (!decision) {
      throw new RmlError('E041', `unknown automatic-sequences theorem "${form[1]}"`);
    }
    const storeName = env.qualifyName(decision.theorem);
    const truthValue = decision.value ? env.hi : env.lo;
    env.terms.add(storeName);
    env.setType(storeName, 'Theorem');
    env.setSymbolProb(storeName, truthValue);
    env.automaticSequenceDecisions.set(storeName, {
      ...decision,
      theorem: storeName,
      truthValue,
    });
    env.trace('domain', `${storeName} decided by automatic-sequences`);
  }
  return 1;
}

function evalDomainForm(node, env) {
  if (node.length < 3 || typeof node[1] !== 'string') {
    throw new RmlError('E041', 'Domain form must be `(domain <name> <request>...)`');
  }
  const pluginName = node[1];
  const plugin = env.getDomainPlugin(pluginName);
  if (!plugin) {
    throw new RmlError('E041', `Unknown domain plugin "${pluginName}"`);
  }
  return plugin(node.slice(2), env);
}

function evalNode(node, env){
  if (typeof node === 'string') {
    if (isNum(node)) return env.toNum(node);
    // bare symbol → optional prior probability if set; otherwise irrelevant in calc
    return env.getSymbolProb(node);
  }

  // HOAS desugaring (issue #51, D7): rewrite `(forall (A x) body)` to
  // `(Pi (A x) body)` so callers passing AST nodes directly to `evalNode`
  // benefit from the same surface as `evaluate()` / `parseLinoForms`. The
  // recursive walk also handles `forall` nested inside definition RHSs such
  // as `(succ: (forall (Natural n) Natural))`.
  if (Array.isArray(node)) {
    node = desugarHoas(node);
  }

  // Definitions & operator redefs:  (head: ...)
  if (typeof node[0] === 'string' && node[0].endsWith(':')) {
    const head = node[0].slice(0,-1);
    return defineForm(head, node.slice(1), env);
  }
  // Note: (x : A) with spaces as a standalone colon separator is NOT supported.
  // Use (x: A) instead — the colon must be part of the link name.

  // Mode declaration (issue #43, D15): (mode <name> +input -output ...)
  // Records the per-argument mode pattern for a relation. Validation lives
  // in `parseModeForm`, which throws `E030` on a malformed declaration.
  if (node[0] === 'mode') {
    const decl = parseModeForm(node);
    if (decl) {
      env.modes.set(decl.name, decl.flags);
      return 1;
    }
  }

  // Relation declaration (issue #44, D12): (relation <name> <clause>...)
  // Stores the clause list keyed by relation name. `parseRelationForm`
  // throws E032 on a malformed declaration so the call sites do not have
  // to handle absent or shape-broken clauses defensively.
  if (node[0] === 'relation') {
    const decl = parseRelationForm(node);
    if (decl) {
      env.relations.set(decl.name, decl.clauses);
      return 1;
    }
  }

  // World declaration (issue #54, D16): (world <name> (<const>...))
  // Records the allow-list of constants permitted to appear free in
  // arguments of a relation. `parseWorldForm` throws E034 on a
  // malformed declaration so the call sites do not have to handle
  // shape-broken declarations defensively.
  if (node[0] === 'world') {
    const decl = parseWorldForm(node);
    if (decl) {
      env.worlds.set(decl.name, decl.allowed);
      return 1;
    }
  }

  // Inductive declaration (issue #45, D10): (inductive Name (constructor ...) ...)
  // Records the inductive datatype, installs every constructor, and
  // generates the eliminator `Name-rec` with a dependent Pi-type.
  // `parseInductiveForm` throws E033 on a malformed declaration.
  if (node[0] === 'inductive') {
    const decl = parseInductiveForm(node);
    if (decl) {
      return registerInductive(env, decl);
    }
  }

  // Coinductive declaration (issue #53, D11): (coinductive Name (constructor ...) ...)
  // Records the coinductive datatype, installs every constructor, and
  // generates the corecursor `Name-corec` with a dependent Pi-type. The
  // declaration also enforces a syntactic productivity check (at least one
  // constructor must take a recursive argument). `parseCoinductiveForm`
  // throws E036 on a malformed or non-productive declaration.
  if (node[0] === 'coinductive') {
    const decl = parseCoinductiveForm(node);
    if (decl) {
      return registerCoinductive(env, decl);
    }
  }

  // Domain plugin driver (issue #63): (domain <name> <request>...)
  // Dispatches the block body to a registered domain-specific decision
  // procedure. The default Env registers `automatic-sequences`.
  if (node[0] === 'domain') {
    return evalDomainForm(node, env);
  }

  // Totality check (issue #44, D12): (total <name>) runs `isTotal` over
  // the recorded relation and turns each returned diagnostic into an
  // E032 RmlError. The first error short-circuits, mirroring how the
  // mode checker surfaces a single failure per evaluator step.
  if (node[0] === 'total' && node.length === 2 && typeof node[1] === 'string') {
    const result = isTotal(env, node[1]);
    if (!result.ok && result.diagnostics.length > 0) {
      const first = result.diagnostics[0];
      throw new RmlError(first.code || 'E032', first.message);
    }
    return 1;
  }
  if (node[0] === 'total') {
    throw new RmlError('E032', 'Totality declaration must be `(total <relation-name>)`');
  }

  // Definition declaration (issue #49, D13): (define <name> [(measure ...)] (case ...) ...)
  // Records the definition on `env.definitions` so termination can be
  // queried later via `isTerminating` or via the `(terminating <name>)`
  // driver form. Malformed declarations raise E035 from the parser.
  if (node[0] === 'define') {
    const decl = parseDefineForm(node);
    if (decl) {
      env.definitions.set(decl.name, decl);
      return 1;
    }
  }

  // Termination check (issue #49, D13): (terminating <name>) runs
  // `isTerminating` and surfaces the first diagnostic via the existing
  // diagnostic pipeline.
  if (node[0] === 'terminating' && node.length === 2 && typeof node[1] === 'string') {
    const result = isTerminating(env, node[1]);
    if (!result.ok && result.diagnostics.length > 0) {
      const first = result.diagnostics[0];
      throw new RmlError(first.code || 'E035', first.message);
    }
    return 1;
  }
  if (node[0] === 'terminating') {
    throw new RmlError('E035', 'Termination declaration must be `(terminating <definition-name>)`');
  }

  // Coverage check (issue #46, D14): (coverage <name>) runs `isCovered`
  // and surfaces every returned diagnostic. The first becomes the thrown
  // RmlError so the surrounding form gets a diagnostic span; any extras
  // are appended to `env._shadowDiagnostics` so each missing case (e.g.
  // for a relation with multiple `+input` slots) reaches the user.
  if (node[0] === 'coverage' && node.length === 2 && typeof node[1] === 'string') {
    const result = isCovered(env, node[1]);
    if (!result.ok && result.diagnostics.length > 0) {
      const [first, ...rest] = result.diagnostics;
      if (rest.length > 0 && Array.isArray(env._shadowDiagnostics)) {
        for (const d of rest) {
          env._shadowDiagnostics.push(new Diagnostic({
            code: d.code || 'E037',
            message: d.message,
            span: env._currentSpan || null,
          }));
        }
      }
      throw new RmlError(first.code || 'E037', first.message);
    }
    return 1;
  }
  if (node[0] === 'coverage') {
    throw new RmlError('E037', 'Coverage declaration must be `(coverage <relation-name>)`');
  }

  // Mode-mismatch check (issue #43, D15): a call `(name args...)` whose
  // head has a registered mode declaration must agree with the declared
  // flags. The check runs before the head's evaluation so the diagnostic
  // points at the call rather than at a downstream beta-reduction.
  if (typeof node[0] === 'string' && env.modes.has(node[0])) {
    const err = checkModeAtCall(node[0], node.slice(1), env);
    if (err) throw err;
  }

  // World-violation check (issue #54, D16): a call `(name args...)`
  // whose head has a registered world declaration must only contain
  // declared constants free in its arguments.
  if (typeof node[0] === 'string' && env.worlds.has(node[0])) {
    const err = checkWorldAtCall(node[0], node.slice(1), env);
    if (err) throw err;
  }

  // Assignment: ((expr) has probability p)
  if (node.length === 4 && node[1] === 'has' && node[2] === 'probability' && isNum(node[3])) {
    const p = parseFloat(node[3]);
    // Carrier enforcement (issue #97, Section 2): if an enclosing
    // `(with-foundation ...)` declared a strict carrier, the assigned value
    // must belong to that carrier. Violations surface as E063 instead of
    // being silently clamped.
    const carrierErr = env.checkCarrierValue(env.clamp(p));
    if (carrierErr) {
      throw new RmlError(
        'E063',
        `Probability assignment ${keyOf(node[0])} = ${formatTraceValue(env.clamp(p))} violates active foundation carrier: ${carrierErr}`,
      );
    }
    env.setExprProb(node[0], p);
    env.trace('assign', `${keyOf(node[0])} ← ${formatTraceValue(env.clamp(p))}`);
    return env.toNum(node[3]);
  }

  // Range configuration: (range: lo hi) — sets the truth value range
  // (range: 0 1) for standard [0,1] or (range: -1 1) for balanced [-1,1]
  // See: https://en.wikipedia.org/wiki/Balanced_ternary
  // Must be checked in evalNode for (range lo hi) prefix form
  if (node.length === 3 && node[0] === 'range' && isNum(node[1]) && isNum(node[2])) {
    env.lo = parseFloat(node[1]);
    env.hi = parseFloat(node[2]);
    // Re-initialize ops for new range
    _reinitOps(env);
    return 1;
  }

  // Valence configuration: (valence N) prefix form
  if (node.length === 2 && node[0] === 'valence' && isNum(node[1])) {
    env.valence = parseInt(node[1], 10);
    return 1;
  }

  // Query: (? expr) with optional `with proof` suffix (issue #35).
  // The suffix is a per-query opt-in for derivation output; the actual proof
  // is built by `buildProof` in `evaluate()`. Stripping it here keeps the
  // legacy evaluation path unchanged regardless of whether proofs are
  // requested.
  if (node[0] === '?') {
    const parts = _stripWithProof(node.slice(1));
    const target = parts.length === 1 ? parts[0] : parts;
    const v = evalNode(target, env);
    // If inner result is already a query (e.g. from (type of x)), pass it through
    if (v && typeof v === 'object' && v.query) return v;
    if (isTermResult(v)) return { query:true, value: keyOf(v.term), typeQuery: true };
    return { query:true, value: env.clamp(v) };
  }

  // Kernel substitution primitive: (subst term x replacement)
  if (node.length === 4 && node[0] === 'subst' && typeof node[2] === 'string') {
    return { term: evalTermNode(node, env) };
  }

  // Weak-head normal form (issue #50, D4): (whnf expr) reduces only the
  // spine of `expr` — leaves binders and arguments untouched. Returned as a
  // term result so callers can keep reducing or print the form directly.
  if (node.length === 2 && node[0] === 'whnf') {
    return { term: whnfTerm(node[1], env) };
  }
  if (node[0] === 'whnf') {
    throw new RmlError('E038', 'Normalization form must be `(whnf <expr>)`');
  }

  // Full normal form (issue #50, D4): (nf expr) and the long alias
  // (normal-form expr). Returns the beta-normal form as a term result.
  if (node.length === 2 && node[0] === 'nf') {
    return { term: flattenNeutralApplies(normalizeTerm(node[1], env), env) };
  }
  if (node[0] === 'nf') {
    throw new RmlError('E038', 'Normalization form must be `(nf <expr>)`');
  }
  if (node.length === 2 && node[0] === 'normal-form') {
    return { term: flattenNeutralApplies(normalizeTerm(node[1], env), env) };
  }
  if (node[0] === 'normal-form') {
    throw new RmlError('E038', 'Normalization form must be `(normal-form <expr>)`');
  }

  // Freshness binder: (fresh x in body)
  if (node.length === 4 && node[0] === 'fresh' && node[2] === 'in' && typeof node[1] === 'string') {
    return evalFresh(node[1], node[3], env);
  }

  // Infix arithmetic: (A + B), (A - B), (A * B), (A / B)
  // Arithmetic uses raw numeric values (not clamped to the logic range)
  if (node.length === 3 && typeof node[1] === 'string' && ['+','-','*','/'].includes(node[1])) {
    const op = env.getOp(node[1]);
    const L = evalArith(node[0], env);
    const R = evalArith(node[2], env);
    return op(L,R);
  }

  // Numeric comparisons: (A < B), (A <= B)
  if (node.length === 3 && typeof node[1] === 'string' && ['<','<='].includes(node[1])) {
    const op = env.getOp(node[1]);
    const L = evalArith(node[0], env);
    const R = evalArith(node[2], env);
    return env.clamp(op(L,R));
  }

  // Infix AND/OR/BOTH/NEITHER: ((A) and (B))  /  ((A) or (B))  /  ((A) both (B))  /  ((A) neither (B))
  if (node.length === 3 && typeof node[1] === 'string' && (node[1]==='and' || node[1]==='or' || node[1]==='both' || node[1]==='neither')) {
    const op = env.getOp(node[1]);
    const L = evalNode(node[0], env);
    const R = evalNode(node[2], env);
    return env.clamp(op(L,R));
  }

  // Composite natural language operators: (both A and B [and C ...]), (neither A nor B [nor C ...])
  if (node.length >= 4 && typeof node[0] === 'string' && (node[0]==='both' || node[0]==='neither')) {
    const sep = node[0]==='both' ? 'and' : 'nor';
    // Validate pattern: operator, value, sep, value [, sep, value ...]
    let valid = node.length % 2 === 0; // both + (n values) + (n-1 seps) = 1 + n + (n-1) = 2n, always even
    if (valid) {
      for (let i = 2; i < node.length; i += 2) {
        if (node[i] !== sep) { valid = false; break; }
      }
    }
    if (valid) {
      const op = env.getOp(node[0]);
      const vals = [];
      for (let i = 1; i < node.length; i += 2) {
        vals.push(evalNode(node[i], env));
      }
      return env.clamp(op(...vals));
    }
  }

  // Infix equality/inequality: (L = R), (L != R)
  if (node.length === 3 && typeof node[1] === 'string' && (node[1]==='=' || node[1]==='!=')) {
    return evalEqualityNode(node[0], node[1], node[2], env);
  }

  // ---------- Type System: "everything is a link" ----------

  // Type universe: (Type N) — the sort at universe level N
  if (node.length === 2 && node[0] === 'Type') {
    const level = parseUniverseLevelToken(node[1]);
    if (level === null) return 0;
    // (Type N) has type (Type N+1)
    env.setType(node, ['Type', String(level + 1)]);
    return 1; // valid expression
  }

  // Prop: (Prop) is sugar for (Type 0) in the propositions-as-types interpretation
  if (node.length === 1 && node[0] === 'Prop') {
    env.setType(['Prop'], ['Type', '1']);
    return 1;
  }

  // Dependent product (Pi-type): (Pi (A x) B) or (Pi (x: A) B)
  if (node.length === 3 && node[0] === 'Pi') {
    const binding = node[1];
    const parsed = parseBinding(binding);
    if (parsed) {
      const { paramName, paramType } = parsed;
      env.terms.add(paramName);
      env.setType(paramName, paramType);
      env.setType(node, ['Type', '0']);
    }
    return 1;
  }

  // Lambda abstraction: (lambda (A x) body) or (lambda (x: A) body)
  // Also supports multi-param: (lambda (A x, B y) body)
  if (node.length === 3 && node[0] === 'lambda') {
    const binding = node[1];
    const bindings = parseBindings(binding);
    if (bindings && bindings.length > 0) {
      // For single binding — standard case
      const { paramName, paramType } = bindings[0];
      const body = node[2];
      env.terms.add(paramName);
      env.setType(paramName, paramType);
      // Register additional bindings
      for (let i = 1; i < bindings.length; i++) {
        env.terms.add(bindings[i].paramName);
        env.setType(bindings[i].paramName, bindings[i].paramType);
      }
      const bodyType = env.getType(body);
      const paramTypeKey = typeof paramType === 'string' ? paramType : keyOf(paramType);
      const bodyTypeKey = bodyType || 'unknown';
      env.setType(node, '(Pi (' + paramTypeKey + ' ' + paramName + ') ' + bodyTypeKey + ')');
    }
    return 1;
  }

  // Application: (apply f x) — explicit application with beta-reduction
  if (node.length === 3 && node[0] === 'apply') {
    const fn = node[1];
    const arg = node[2];

    // Check if fn is a lambda: (lambda (A x) body)
    if (Array.isArray(fn) && fn.length === 3 && fn[0] === 'lambda') {
      const parsed = parseBinding(fn[1]);
      if (parsed) {
        const body = fn[2];
        const result = subst(body, parsed.paramName, arg);
        return evalReducedTerm(result, env);
      }
    }

    // Check if fn is a named lambda
    if (typeof fn === 'string') {
      const lambda = env.getLambda(fn);
      if (lambda) {
        const result = subst(lambda.body, lambda.param, arg);
        return evalReducedTerm(result, env);
      }
    }

    // Otherwise evaluate fn and arg normally
    const fVal = evalNode(fn, env);
    const aVal = evalNode(arg, env);
    return typeof fVal === 'number' ? fVal : (fVal && fVal.value !== undefined ? fVal.value : 0);
  }

  // Type query: (type of expr) — returns the type of an expression
  // e.g. (? (type of x)) → returns the type string
  if (node.length === 3 && node[0] === 'type' && node[1] === 'of') {
    const expr = node[2];
    const typeStr = inferTypeKey(expr, env);
    if (typeStr) {
      return { query: true, value: typeStr, typeQuery: true };
    }
    return { query: true, value: 'unknown', typeQuery: true };
  }

  // Type check query: (expr of Type) — checks if expr has the given type
  // e.g. (? (x of Natural)) → returns 1 or 0
  if (node.length === 3 && node[1] === 'of') {
    const expr = node[0];
    const expectedType = node[2];
    const actualType = inferTypeKey(expr, env);
    if (actualType) {
      const expectedKey = typeof expectedType === 'string' ? expectedType : keyOf(expectedType);
      return actualType === expectedKey ? env.hi : env.lo;
    }
    return env.lo;
  }

  // Prefix: (not X), (and X Y ...), (or X Y ...)
  const [head, ...args] = node;
  if (typeof head === 'string' && (head === '=' || head === '!=') && args.length === 2) {
    return evalEqualityNode(args[0], head, args[1], env);
  }
  if (typeof head === 'string' && env.hasOp(head)) {
    const op = env.getOp(head);
    const vals = args.map(a => evalNode(a, env));
    return env.clamp(op(...vals));
  }

  // Fall through: prefix application (f x y ...) for named lambdas
  if (typeof head === 'string' && args.length >= 1) {
    const lambda = env.getLambda(head) || env.getLambda(env._resolveQualified(head));
    if (lambda) {
      // Apply first argument, then recursively apply rest
      let result = subst(lambda.body, lambda.param, args[0]);
      if (args.length === 1) {
        return evalReducedTerm(result, env);
      }
      return evalReducedTerm([result, ...args.slice(1)], env);
    }
  }

  // Prefix application with an inline lambda head: ((lambda (A x) body) arg)
  if (Array.isArray(head) && head.length === 3 && head[0] === 'lambda' && args.length >= 1) {
    const parsed = parseBinding(head[1]);
    if (parsed) {
      const result = subst(head[2], parsed.paramName, args[0]);
      if (args.length === 1) return evalReducedTerm(result, env);
      return evalReducedTerm([result, ...args.slice(1)], env);
    }
  }

  return 0;
}

// Re-initialize default ops when range changes
function _reinitOps(env) {
  env.ops.set('not', (x) => env.hi - (x - env.lo));
  env.ops.set('and', (...xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : env.lo);
  env.ops.set('or', (...xs) => xs.length ? Math.max(...xs) : env.lo);
  env.ops.set('both', (...xs) => xs.length ? decRound(xs.reduce((a,b)=>a+b,0)/xs.length) : env.lo);
  env.ops.set('neither', (...xs) => xs.length ? decRound(xs.reduce((a,b)=>a*b,1)) : env.lo);
  env.ops.set('=', (L,R,ctx) => {
    const kPrefix = keyOf(['=',L,R]);
    if (env.assign.has(kPrefix)) {
      const v = env.assign.get(kPrefix);
      env.trace('lookup', `${kPrefix} → ${formatTraceValue(v)}`);
      return v;
    }
    const kInfix = keyOf([L,'=',R]);
    if (env.assign.has(kInfix)) {
      const v = env.assign.get(kInfix);
      env.trace('lookup', `${kInfix} → ${formatTraceValue(v)}`);
      return v;
    }
    return isStructurallySame(L,R) ? env.hi : env.lo;
  });
  env.ops.set('!=', (...args) => env.getOp('not')( env.getOp('=')(...args) ));
  env.ops.set('+', (a,b) => decRound(a + b));
  env.ops.set('-', (a,b) => decRound(a - b));
  env.ops.set('*', (a,b) => decRound(a * b));
  env.ops.set('/', (a,b) => b === 0 ? 0 : decRound(a / b));
  env.ops.set('<', (a,b) => a < b ? env.hi : env.lo);
  env.ops.set('<=', (a,b) => a <= b ? env.hi : env.lo);
  // Re-initialize truth constants for new range
  env._initTruthConstants();
}

function defineForm(head, rhs, env){
  // Configuration directives are file-level and never namespaced.
  // Range configuration: (range: lo hi) — sets the truth value range
  if (head === 'range' && rhs.length === 2 && isNum(rhs[0]) && isNum(rhs[1])) {
    env.lo = parseFloat(rhs[0]);
    env.hi = parseFloat(rhs[1]);
    _reinitOps(env);
    return 1;
  }
  // Valence configuration: (valence: N) — sets the number of truth values
  // N=1: unary (trivial), N=2: binary (Boolean), N=3: ternary, N=0: continuous
  if (head === 'valence' && rhs.length === 1 && isNum(rhs[0])) {
    env.valence = parseInt(rhs[0], 10);
    return 1;
  }

  // Bindings introduced inside `(namespace foo)` are stored under `foo.head`.
  // The syntactic head (e.g. `a` in `(a: a is a)`) is still used to match
  // patterns; only the storage key is qualified.
  const storeName = env.qualifyName(head);
  // Shadowing diagnostic (E008): if this name was already imported, warn.
  if (storeName !== head || env.namespace === null) {
    _maybeWarnShadow(env, storeName);
  } else {
    _maybeWarnShadow(env, head);
  }

  // Term definition: (a: a is a)  → declare 'a' as a term (no probability assignment)
  if (rhs.length === 3 && typeof rhs[0]==='string' && rhs[1]==='is' && typeof rhs[2]==='string' && rhs[0]===head && rhs[2]===head) {
    env.terms.add(storeName);
    return 1;
  }

  // Prefix type notation: (name: TypeName name) → typed self-referential declaration
  // e.g. (zero: Natural zero), (boolean: Type boolean), (true: Boolean true)
  if (rhs.length === 2 && typeof rhs[0] === 'string' && typeof rhs[1] === 'string' && rhs[1] === head) {
    const typeName = rhs[0];
    // Only if typeName starts with uppercase (type convention) and is not an operator
    if (/^[A-Z]/.test(typeName)) {
      env.terms.add(storeName);
      env.setType(storeName, typeName);
      return 1;
    }
  }

  // Prefix type notation with complex type: (name: (Type 0) name) → typed self-referential declaration
  if (rhs.length === 2 && Array.isArray(rhs[0]) && typeof rhs[1] === 'string' && rhs[1] === head) {
    const typeExpr = rhs[0];
    env.terms.add(storeName);
    env.setType(storeName, typeExpr);
    evalNode(typeExpr, env);
    return 1;
  }

  // Typed declaration with complex type expression: (succ: (Pi (Natural n) Natural))
  // Only complex expressions (arrays) are accepted as type annotations in single-element form.
  // Simple name type annotations like (x: Natural) are NOT supported — use (x: Natural x) prefix form instead.
  if (rhs.length === 1 && Array.isArray(rhs[0])) {
    const isOp = ['=','!=','and','or','not','is','?:','both','neither'].includes(head) || /[=!]/.test(head);
    if (!isOp) {
      const typeExpr = rhs[0];
      env.terms.add(storeName);
      env.setType(storeName, typeExpr);
      evalNode(typeExpr, env);
      return 1;
    }
  }

  // Optional symbol prior: (a: 0.7) — not required for your use-case, but allowed
  if (rhs.length === 1 && isNum(rhs[0])) {
    env.setSymbolProb(storeName, parseFloat(rhs[0]));
    return env.toNum(rhs[0]);
  }

  // Operator redefinitions
  if (['=','!=','and','or','not','is','?:','both','neither'].includes(head) || /[=!]/.test(head)) {
    // Operator alias: `(not: not)` inside a namespace exports the existing
    // operator under the qualified name, e.g. `classical.not`.
    if (rhs.length === 1 && typeof rhs[0] === 'string' && env.hasOp(rhs[0])) {
      const target = rhs[0];
      const op = env.getOp(target);
      env.defineOp(storeName, (...xs) => op(...xs));
      env.trace('resolve', `(${storeName}: ${target})`);
      return 1;
    }

    // Composition like: (!=: not =)   or  (=: =) (no-op)
    if (rhs.length === 2 && typeof rhs[0]==='string' && typeof rhs[1]==='string') {
      const outer = env.getOp(rhs[0]);
      const inner = env.getOp(rhs[1]);
      env.defineOp(storeName, (...xs) => env.clamp( outer( inner(...xs) ) ));
      env.trace('resolve', `(${storeName}: ${rhs[0]} ${rhs[1]})`);
      return 1;
    }

    // Aggregator selection: (and: avg|min|max|product|probabilistic_sum)
    if ((head==='and' || head==='or' || head==='both' || head==='neither') && rhs.length===1 && typeof rhs[0]==='string') {
      const sel = rhs[0];
      const lo = env.lo;
      const agg =
        sel==='avg' ? xs=>xs.reduce((a,b)=>a+b,0)/xs.length :
        sel==='min' ? xs=>xs.length? Math.min(...xs) : lo :
        sel==='max' ? xs=>xs.length? Math.max(...xs) : lo :
        sel==='product' || sel==='prod' ? xs=>xs.reduce((a,b)=>a*b,1) :
        sel==='probabilistic_sum' || sel==='ps' ? xs=> 1 - xs.reduce((a,b)=>a*(1-b),1) : null;
      if (!agg) throw new RmlError('E004', `Unknown aggregator "${sel}"`);
      env.defineOp(storeName, (...xs)=> xs.length? agg(xs) : lo);
      env.trace('resolve', `(${storeName}: ${sel})`);
      return 1;
    }

    throw new RmlError('E003', `Unsupported operator definition for "${head}"`);
  }

  // Lambda definition: (name: lambda (A x) body)
  if (rhs.length >= 2 && rhs[0] === 'lambda') {
    if (rhs.length === 3 && Array.isArray(rhs[1])) {
      const parsed = parseBinding(rhs[1]);
      if (parsed) {
        const { paramName, paramType } = parsed;
        const body = rhs[2];
        env.terms.add(storeName);
        env.setLambda(storeName, paramName, paramType, body);
        const hadParamTerm = env.terms.has(paramName);
        const previousParamType = env.getType(paramName);
        env.terms.add(paramName);
        env.setType(paramName, paramType);
        const paramTypeKey = typeof paramType === 'string' ? paramType : keyOf(paramType);
        const bodyTypeKey = env.getType(body) || (typeof body === 'string' ? body : keyOf(body));
        if (!hadParamTerm) env.terms.delete(paramName);
        if (previousParamType === null) env.types.delete(paramName);
        else env.setType(paramName, previousParamType);
        env.setType(storeName, '(Pi (' + paramTypeKey + ' ' + paramName + ') ' + bodyTypeKey + ')');
        return 1;
      }
    }
  }

  // Typed definition: (name : Type) — just a type annotation (no body)
  // Already handled by the (x: A) form in evalNode

  // Generic symbol alias like (x: y) just copies y's prior probability if any
  if (rhs.length===1 && typeof rhs[0]==='string') {
    env.setSymbolProb(storeName, env.getSymbolProb(rhs[0]));
    return env.getSymbolProb(storeName);
  }

  // Else: ignore (keeps PoC minimal)
  return 0;
}

// Emit a shadowing warning (E008) if the name being defined was previously
// brought in via `(import ...)`. The import handler tracks names it added to
// the environment in `env.imported`; the importing file's own definitions are
// not in that set, so re-binding them locally never triggers the warning.
// Diagnostics are appended to `env._shadowDiagnostics` and surfaced by the
// outer `evaluate()` loop alongside other diagnostics.
function _maybeWarnShadow(env, name) {
  if (!env.imported) return;
  // Resolve the name through alias mappings so a re-binding like `(cl.and: ...)`
  // matches the canonical imported key `classical.and`.
  let key = name;
  if (!env.imported.has(key)) {
    const resolved = env._resolveQualified(name);
    if (resolved !== name && env.imported.has(resolved)) {
      key = resolved;
    } else {
      return;
    }
  }
  // Only warn once per name to keep noise down; remove from imported so the
  // shadow only fires the first time it's rebinding.
  env.imported.delete(key);
  const span = env._currentSpan || { file: null, line: 1, col: 1, length: 0 };
  const diag = new Diagnostic({
    code: 'E008',
    message: `Definition of "${name}" shadows an imported binding`,
    span,
  });
  if (Array.isArray(env._shadowDiagnostics)) {
    env._shadowDiagnostics.push(diag);
  }
}

// ---------- Bidirectional Type Checker (issue #42) ----------
// Public API:
//   synth(term, ctx)            -> { type: Node|null, diagnostics: Diagnostic[] }
//   check(term, expectedType, ctx) -> { ok: boolean, diagnostics: Diagnostic[] }
//
// `ctx` is either an `Env` instance or a plain options object passed to
// `new Env(...)`. Term/type inputs may be parsed AST nodes, link strings,
// or plain symbol strings — the checker normalises each via `parseTermInput`.
//
// Design notes:
//   - Synthesise mode walks the term and looks up types in `env.types`,
//     applies kernel rules for `(Type N)`, `(Pi ...)`, `(lambda ...)`,
//     `(apply ...)`, `(subst ...)`, `(type of ...)`, and `(expr of T)`.
//   - Check mode prefers a direct lambda-vs-Pi rule that opens the binder
//     and recurses on the body; otherwise it falls back to synthesise +
//     definitional convertibility (`isConvertible`).
//   - Diagnostics use stable codes E020..E024 (see `docs/DIAGNOSTICS.md`).
//   - The checker never throws on user errors; runtime invariants still
//     bubble up so genuine bugs surface in tests.

function _typeKeyOf(typeNode) {
  if (typeNode === null || typeNode === undefined) return null;
  return typeof typeNode === 'string' ? typeNode : keyOf(typeNode);
}

function _parseTypeKeyToNode(typeKey) {
  if (typeof typeKey !== 'string') return typeKey;
  const trimmed = typeKey.trim();
  if (trimmed.startsWith('(')) {
    try {
      return parseOne(tokenizeOne(trimmed));
    } catch (_) {
      return typeKey;
    }
  }
  return typeKey;
}

function _diag(code, message, span) {
  return new Diagnostic({
    code,
    message,
    span: span || { file: null, line: 1, col: 1, length: 0 },
  });
}

function _envFromCtx(ctx) {
  return ctx instanceof Env ? ctx : new Env(ctx && ctx.env ? ctx.env : ctx);
}

function _spanFromCtx(ctx, options) {
  const opts = options || {};
  if (opts.span) return opts.span;
  if (ctx instanceof Env && ctx._currentSpan) return ctx._currentSpan;
  if (ctx && ctx.span) return ctx.span;
  return null;
}

// Snapshot just enough of the env's type-related state to restore after a
// scoped extension (used by lambda binder introduction during synth/check).
function _snapshotTypeBinding(env, name) {
  return {
    name,
    hadTerm: env.terms.has(name),
    hadType: env.types.has(name),
    previousType: env.types.get(name),
  };
}

function _extendTypeBinding(env, name, typeKey) {
  env.terms.add(name);
  env.types.set(name, typeKey);
}

function _restoreTypeBinding(env, snap) {
  if (!snap.hadTerm) env.terms.delete(snap.name);
  if (snap.hadType) env.types.set(snap.name, snap.previousType);
  else env.types.delete(snap.name);
}

// Best-effort node equality after beta-normalisation. Falls back to plain
// structural equality when convertibility throws.
function _typesAgree(a, b, env) {
  if (a === null || b === null) return false;
  const aN = _expandForall(a);
  const bN = _expandForall(b);
  if (isStructurallySame(aN, bN)) return true;
  try {
    return isConvertible(aN, bN, env);
  } catch (_) {
    return false;
  }
}

// Prenex polymorphism (D9): `(forall A T)` is sugar for `(Pi (Type A) T)`.
// `A` is a bound type variable ranging over the universe `Type`. Expansion
// happens at the outermost layer only — nested quantifiers desugar lazily as
// the type checker recurses into the body.
function _isForallNode(node) {
  return (
    Array.isArray(node) &&
    node.length === 3 &&
    node[0] === 'forall' &&
    typeof node[1] === 'string'
  );
}

function _expandForall(node) {
  if (!_isForallNode(node)) return node;
  return ['Pi', ['Type', node[1]], node[2]];
}

function _synthLeaf(term, env) {
  if (isNum(term)) {
    // Numeric literals do not carry an inferable kernel type without an
    // ambient annotation; treat them as members of an unspecified Number
    // sort by leaving the type unresolved. Callers asking to check a
    // literal against a specific type fall back to convertibility.
    return null;
  }
  const recorded = inferTypeKey(term, env);
  if (recorded) return _parseTypeKeyToNode(recorded);
  // Resolve through namespaces / aliases the same way getType does.
  const resolved = env._resolveQualified(term);
  if (resolved !== term) {
    const fromAlias = env.types.get(resolved);
    if (fromAlias) return _parseTypeKeyToNode(fromAlias);
  }
  // Named lambda introduced via `(name: lambda (A x) body)` records the Pi
  // type under `name`, so the inferTypeKey path above already covers it.
  return null;
}

function _synthApply(node, env, span, diagnostics) {
  // (apply f a) — synth f, expect Pi; check a against domain; result is
  // codomain with x := a substituted.
  const fnSynth = synth(node[1], env, { span, parentDiagnostics: diagnostics });
  for (const d of fnSynth.diagnostics) diagnostics.push(d);
  if (!fnSynth.type) {
    diagnostics.push(_diag(
      'E020',
      `Cannot synthesize type of \`${keyOf(node[1])}\` in \`${keyOf(node)}\``,
      span,
    ));
    return null;
  }
  // Prenex polymorphism (D9): `(forall A T)` desugars to `(Pi (Type A) T)`,
  // so type-application `(apply f Natural)` reduces by substituting `A := Natural`
  // in the body just like a regular Pi-type does.
  const fnType = _expandForall(fnSynth.type);
  if (!Array.isArray(fnType) || fnType.length !== 3 || fnType[0] !== 'Pi') {
    diagnostics.push(_diag(
      'E022',
      `Application head \`${keyOf(node[1])}\` has type \`${keyOf(fnType)}\`, expected a Pi-type`,
      span,
    ));
    return null;
  }
  const parsed = parseBinding(fnType[1]);
  if (!parsed) {
    diagnostics.push(_diag(
      'E022',
      `Application head has malformed Pi binder \`${keyOf(fnType[1])}\``,
      span,
    ));
    return null;
  }
  const domainNode = typeof parsed.paramType === 'string'
    ? parsed.paramType
    : parsed.paramType;
  const argCheck = check(node[2], domainNode, env, { span, parentDiagnostics: diagnostics });
  for (const d of argCheck.diagnostics) diagnostics.push(d);
  if (!argCheck.ok) return null;
  // Substitute x := a in the codomain to get the result type.
  return subst(fnType[2], parsed.paramName, node[2]);
}

function _synthLambda(node, env, span, diagnostics) {
  // (lambda (A x) body) synthesises a Pi-type by extending the context
  // with x : A and recursively synthesising the body.
  const parsed = parseBinding(node[1]);
  if (!parsed) {
    diagnostics.push(_diag(
      'E024',
      `Lambda has malformed binder \`${keyOf(node[1])}\``,
      span,
    ));
    return null;
  }
  const paramTypeKey = _typeKeyOf(parsed.paramType);
  const snap = _snapshotTypeBinding(env, parsed.paramName);
  _extendTypeBinding(env, parsed.paramName, paramTypeKey);
  let bodyType = null;
  try {
    const bodySynth = synth(node[2], env, { span, parentDiagnostics: diagnostics });
    for (const d of bodySynth.diagnostics) diagnostics.push(d);
    bodyType = bodySynth.type;
  } finally {
    _restoreTypeBinding(env, snap);
  }
  if (!bodyType) return null;
  return ['Pi', [parsed.paramType, parsed.paramName], bodyType];
}

function _synthTypeOfQuery(node, env) {
  // (type of expr) reports the synthesized type literally.
  const inner = node[2];
  const result = synth(inner, env);
  if (result.type) return ['Type', '0'];
  return null;
}

function _synthOfMembership(node, env, span, diagnostics) {
  // (expr of Type) — checks membership and produces a (Type 0) result if
  // the check holds. We delegate to `check` against the declared type.
  const expected = node[2];
  const result = check(node[0], expected, env, { span, parentDiagnostics: diagnostics });
  for (const d of result.diagnostics) diagnostics.push(d);
  if (!result.ok) return null;
  return ['Type', '0'];
}

/**
 * Synthesize the type of a kernel term.
 */
function synth(term, ctx, options) {
  const env = _envFromCtx(ctx);
  const span = _spanFromCtx(ctx, options);
  const diagnostics = [];
  const node = parseTermInput(term);

  // Leaves: numeric literals and bare symbols.
  if (typeof node === 'string') {
    const t = _synthLeaf(node, env);
    if (!t && !isNum(node)) {
      diagnostics.push(_diag(
        'E020',
        `Cannot synthesize type of symbol \`${node}\``,
        span,
      ));
    }
    return { type: t, diagnostics };
  }

  if (!Array.isArray(node)) {
    diagnostics.push(_diag(
      'E020',
      `Cannot synthesize type of \`${keyOf(node)}\``,
      span,
    ));
    return { type: null, diagnostics };
  }

  // (Type N) : (Type N+1)
  if (node.length === 2 && node[0] === 'Type') {
    const universeType = universeTypeKey(node);
    if (universeType) return { type: _parseTypeKeyToNode(universeType), diagnostics };
    diagnostics.push(_diag(
      'E020',
      `Universe \`${keyOf(node)}\` has invalid level token \`${keyOf(node[1])}\``,
      span,
    ));
    return { type: null, diagnostics };
  }

  // (Prop) : (Type 1)
  if (node.length === 1 && node[0] === 'Prop') {
    return { type: ['Type', '1'], diagnostics };
  }

  // (Pi (A x) B) : (Type 0) — domain checks against (Type 0); body checks
  // under the extended context. We do not enforce a universe stratification
  // here beyond what evalNode records, matching the documented kernel.
  if (node.length === 3 && node[0] === 'Pi') {
    const parsed = parseBinding(node[1]);
    if (!parsed) {
      diagnostics.push(_diag(
        'E024',
        `Pi has malformed binder \`${keyOf(node[1])}\``,
        span,
      ));
      return { type: null, diagnostics };
    }
    return { type: ['Type', '0'], diagnostics };
  }

  // (forall A T) : (Type 0) — prenex polymorphism (D9). `A` is bound as a
  // type variable ranging over `Type`; the body `T` is the polymorphic type.
  // Synthesised as a Type because the surface form is itself a type.
  if (_isForallNode(node)) {
    return synth(_expandForall(node), env, { span, parentDiagnostics: diagnostics });
  }

  // (lambda (A x) body)
  if (node.length === 3 && node[0] === 'lambda') {
    const lambdaType = _synthLambda(node, env, span, diagnostics);
    return { type: lambdaType, diagnostics };
  }

  // (apply f a)
  if (node.length === 3 && node[0] === 'apply') {
    const appType = _synthApply(node, env, span, diagnostics);
    return { type: appType, diagnostics };
  }

  // (subst term x replacement) — synth the substituted term.
  if (node.length === 4 && node[0] === 'subst' && typeof node[2] === 'string') {
    const reduced = subst(parseTermInput(node[1]), node[2], parseTermInput(node[3]));
    return synth(reduced, env, { span, parentDiagnostics: diagnostics });
  }

  // (type of expr) — kernel returns the type of expr.
  if (node.length === 3 && node[0] === 'type' && node[1] === 'of') {
    const innerSynth = synth(node[2], env, { span });
    for (const d of innerSynth.diagnostics) diagnostics.push(d);
    if (innerSynth.type) {
      // (type of expr) itself is a (Type 0)-level term — a representation
      // of a type. Its synthesised type is therefore (Type 0).
      return { type: ['Type', '0'], diagnostics };
    }
    diagnostics.push(_diag(
      'E020',
      `Cannot synthesize type referenced by \`${keyOf(node)}\``,
      span,
    ));
    return { type: null, diagnostics };
  }

  // (expr of T) — succeeds with (Type 0) when the membership check holds.
  if (node.length === 3 && node[1] === 'of') {
    const t = _synthOfMembership(node, env, span, diagnostics);
    return { type: t, diagnostics };
  }

  // Fallback: try the recorded type from evalNode-installed facts.
  const recorded = inferTypeKey(node, env);
  if (recorded) return { type: _parseTypeKeyToNode(recorded), diagnostics };

  diagnostics.push(_diag(
    'E020',
    `Cannot synthesize type of \`${keyOf(node)}\``,
    span,
  ));
  return { type: null, diagnostics };
}

/**
 * Check that a kernel term has the expected type.
 */
function check(term, expectedType, ctx, options) {
  const env = _envFromCtx(ctx);
  const span = _spanFromCtx(ctx, options);
  const diagnostics = [];
  const node = parseTermInput(term);
  let expectedNode = parseTermInput(expectedType);

  // Prenex polymorphism (D9): `(forall A T)` is sugar for `(Pi (Type A) T)`.
  // Expand once here so the lambda-vs-Pi rule below applies uniformly. The
  // term-side stays unchanged because `(lambda (Type A) ...)` already uses
  // the Pi-friendly binder form.
  if (_isForallNode(expectedNode)) {
    expectedNode = _expandForall(expectedNode);
  }

  // Direct rule: (lambda (A x) body) checks against (Pi (A' y) B) when
  // A converts with A' — open the binder, alpha-rename if needed, recurse
  // on body against B.
  if (
    Array.isArray(node) && node.length === 3 && node[0] === 'lambda' &&
    Array.isArray(expectedNode) && expectedNode.length === 3 && expectedNode[0] === 'Pi'
  ) {
    const lambdaParsed = parseBinding(node[1]);
    const piParsed = parseBinding(expectedNode[1]);
    if (lambdaParsed && piParsed) {
      const domainOk = _typesAgree(
        parseTermInput(lambdaParsed.paramType),
        parseTermInput(piParsed.paramType),
        env,
      );
      if (!domainOk) {
        diagnostics.push(_diag(
          'E021',
          `Lambda parameter type \`${keyOf(lambdaParsed.paramType)}\` does not match Pi domain \`${keyOf(piParsed.paramType)}\``,
          span,
        ));
        return { ok: false, diagnostics };
      }
      // Align body context: introduce the lambda's parameter, then check
      // the body against the Pi codomain with the Pi parameter renamed to
      // the lambda parameter.
      const codomain = subst(expectedNode[2], piParsed.paramName, lambdaParsed.paramName);
      const paramTypeKey = _typeKeyOf(lambdaParsed.paramType);
      const snap = _snapshotTypeBinding(env, lambdaParsed.paramName);
      _extendTypeBinding(env, lambdaParsed.paramName, paramTypeKey);
      try {
        const bodyResult = check(node[2], codomain, env, { span, parentDiagnostics: diagnostics });
        for (const d of bodyResult.diagnostics) diagnostics.push(d);
        return { ok: bodyResult.ok, diagnostics };
      } finally {
        _restoreTypeBinding(env, snap);
      }
    }
  }

  // Lambda checked against non-Pi expected type.
  if (
    Array.isArray(node) && node.length === 3 && node[0] === 'lambda' &&
    !(Array.isArray(expectedNode) && expectedNode[0] === 'Pi')
  ) {
    diagnostics.push(_diag(
      'E023',
      `Lambda \`${keyOf(node)}\` cannot check against non-Pi type \`${keyOf(expectedNode)}\``,
      span,
    ));
    return { ok: false, diagnostics };
  }

  // Numeric literal: accept any non-empty annotation; the kernel does not
  // record number sorts directly. Equality with the expected type collapses
  // through definitional convertibility downstream.
  if (typeof node === 'string' && isNum(node)) {
    return { ok: true, diagnostics };
  }

  // Default mode-switch: synthesise and compare with definitional equality.
  const synthResult = synth(node, env, { span });
  for (const d of synthResult.diagnostics) diagnostics.push(d);
  if (!synthResult.type) {
    return { ok: false, diagnostics };
  }
  const ok = _typesAgree(synthResult.type, expectedNode, env);
  if (!ok) {
    diagnostics.push(_diag(
      'E021',
      `Type mismatch: \`${keyOf(node)}\` has type \`${keyOf(synthResult.type)}\`, expected \`${keyOf(expectedNode)}\``,
      span,
    ));
  }
  return { ok, diagnostics };
}

// ---------- Public LiNo helpers ----------
function stripLinoComments(text) {
  return text
    .replace(/^[ \t]*#.*$/gm, '')          // full-line comments
    .replace(/(\)[ \t]+)#.*$/gm, '$1')     // inline comments after closing paren
    .replace(/\n{3,}/g, '\n\n');
}

// RML's parenthesized forms predate links-notation 0.20's nested-context
// interpretation of line breaks. Keep their established flat-list meaning by
// treating layout inside parentheses as whitespace, while retaining root-level
// newlines for indentation syntax and preserving multiline quoted references.
function hasSubstantiveQuotedBody(text) {
  let depth = 0;
  let visible = false;
  for (const character of text) {
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
    if (!/\s/.test(character)) visible = true;
  }
  return visible && depth === 0;
}

// Return the position after a delimited reference using links-notation 0.20's
// N-quote rules. This keeps layout normalization from changing quoted data.
function quotedReferenceEnd(text, start) {
  const quote = text[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let width = 1;
  while (text[start + width] === quote) width += 1;
  const delimiter = quote.repeat(width);
  const escape = delimiter.repeat(2);
  const emptyEnd = width % 2 === 0 ? start + width : null;
  let position = start + width;
  while (position < text.length) {
    if (text.startsWith(escape, position)) {
      position += escape.length;
      continue;
    }
    if (text.startsWith(delimiter, position) && text[position + width] !== quote) {
      const end = position + width;
      const body = text.slice(start + width, position);
      return width % 2 !== 0 || hasSubstantiveQuotedBody(body) ? end : emptyEnd;
    }
    position += 1;
  }
  return emptyEnd;
}

function flattenParenthesizedLayout(text) {
  let depth = 0;
  let output = '';

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' || character === "'" || character === '`') {
      const end = quotedReferenceEnd(text, index);
      if (end !== null) {
        output += text.slice(index, end);
        index = end - 1;
        continue;
      }
    }
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (character === '\n' && depth > 0) {
      output += ' ';
      while (text[index + 1] === ' ' || text[index + 1] === '\t') index += 1;
      continue;
    }
    output += character;
  }
  return output;
}

function isLiterateLinoPath(file) {
  return typeof file === 'string' && /\.lino\.md$/i.test(file);
}

function parseMarkdownFence(line) {
  const trimmed = String(line).replace(/^[ \t]*/, '');
  const match = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return {
    marker: match[1][0],
    length: match[1].length,
    info: match[2] || '',
  };
}

function isClosingMarkdownFence(line, fence) {
  const parsed = parseMarkdownFence(line);
  return parsed &&
    parsed.marker === fence.marker &&
    parsed.length >= fence.length &&
    /^[ \t]*$/.test(parsed.info);
}

function isLinoFenceInfo(info) {
  const tag = String(info).trim().split(/\s+/, 1)[0] || '';
  return tag.toLowerCase() === 'lino';
}

/**
 * Extract LiNo code from fenced `lino` blocks in a literate `.lino.md` file.
 *
 * Non-LiNo prose and other code fences become blank lines so diagnostics keep
 * the original Markdown line numbers.
 */
function extractLiterateLino(text) {
  const lines = String(text).split('\n');
  const out = [];
  let activeFence = null;
  for (const line of lines) {
    if (activeFence) {
      if (isClosingMarkdownFence(line, activeFence)) {
        activeFence = null;
        out.push('');
      } else {
        out.push(activeFence.include ? line : '');
      }
      continue;
    }
    const fence = parseMarkdownFence(line);
    if (fence) {
      activeFence = { ...fence, include: isLinoFenceInfo(fence.info) };
      out.push('');
      continue;
    }
    out.push('');
  }
  return out.join('\n');
}

function sourceForEvaluation(code, file) {
  const source = String(code);
  return isLiterateLinoPath(file) ? extractLiterateLino(source) : source;
}

/**
 * Parse LiNo source text with the official links-notation parser.
 */
function parseLino(text) {
  const parser = new Parser({ comments: false });
  const source = flattenParenthesizedLayout(stripLinoComments(text));
  return parser.parse(source).map(link => String(link));
}

function parseLinoForms(text) {
  return parseLino(text)
    .filter(linkStr => {
      const s = String(linkStr).trim();
      // Skip if it's just a comment link like "(# ...)"
      return !s.match(/^\(#\s/);
    })
    .map(linkStr => {
      const toks = tokenizeOne(String(linkStr));
      return desugarHoas(parseOne(toks));
    });
}

// Compute (line, col) source positions for every top-level link in `text`.
// A "top-level link" is a parenthesized form that is not nested inside another;
// position is reported as 1-based line and column of its opening `(`.
// Lines starting with `#` are treated as full-line comments and ignored, just
// like `stripLinoComments` does. Inline `# ...` comments that follow a closing
// paren (matching `(\)[ \t]+)#.*$` in `stripLinoComments`) are also skipped so
// parens inside the comment don't disturb the depth counter.
/**
 * Compute 1-based source spans for every top-level LiNo form in `text`.
 */
function computeFormSpans(text, file) {
  const spans = [];
  const lines = text.split('\n');
  // Track parenthesis depth across the whole text (top-level links never nest).
  let depth = 0;
  let lineNum = 1;
  let colNum = 1;
  let pendingStart = null; // {line, col, offset} for the next top-level link
  let inLineComment = false;
  let lastClosingDepthZeroCol = -1;
  let sawWsAfterClose = false;
  for (let off = 0; off < text.length; off++) {
    const ch = text[off];
    if (ch === '\n') {
      inLineComment = false;
      lineNum++;
      colNum = 1;
      lastClosingDepthZeroCol = -1;
      sawWsAfterClose = false;
      continue;
    }
    if (inLineComment) { colNum++; continue; }
    // Detect a full-line comment (line begins with optional whitespace + #).
    if (ch === '#' && depth === 0) {
      // Full-line comment: line so far is all whitespace.
      const lineSoFar = lines[lineNum - 1].slice(0, colNum - 1);
      if (/^[ \t]*$/.test(lineSoFar)) {
        inLineComment = true;
        colNum++;
        continue;
      }
      // Inline comment after `)` + whitespace: discard rest of line.
      if (lastClosingDepthZeroCol >= 0 && sawWsAfterClose) {
        inLineComment = true;
        colNum++;
        continue;
      }
    }
    if (ch === '(') {
      if (depth === 0) {
        pendingStart = { line: lineNum, col: colNum };
      }
      depth++;
      sawWsAfterClose = false;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && pendingStart) {
        spans.push({ file: file || null, line: pendingStart.line, col: pendingStart.col, length: 1 });
        pendingStart = null;
        lastClosingDepthZeroCol = colNum;
        sawWsAfterClose = false;
      }
    } else if (ch === ' ' || ch === '\t') {
      if (lastClosingDepthZeroCol >= 0) sawWsAfterClose = true;
    } else {
      // Any other character resets the inline-comment-eligible state.
      lastClosingDepthZeroCol = -1;
      sawWsAfterClose = false;
    }
    colNum++;
  }
  return spans;
}

// New structured evaluator: returns { results, diagnostics }. Existing
// callers can keep using `run`, which now delegates to this and surfaces only
// the result list (preserving its previous signature for tests/CLI consumers).
//
// `options.env` may be an existing `Env` instance (used by the REPL to
// preserve state across inputs) or a plain options object passed to `new Env`.
/**
 * Evaluate LiNo source and return query results plus structured diagnostics.
 *
 * @param {string} code - LiNo source text.
 * @param {object} [options] - Evaluation options.
 * @param {string} [options.file] - Source file path used in diagnostics.
 * @param {Env|object} [options.env] - Existing environment or environment options.
 * @param {boolean} [options.trace=false] - Include deterministic trace events.
 * @param {boolean} [options.withProofs=false] - Include proof witnesses for queries.
 * @returns {object} Results, diagnostics, and optional trace/proof arrays.
 */
function evaluate(code, options) {
  const opts = options || {};
  const file = opts.file || null;
  const sourceText = sourceForEvaluation(code, file);
  const env = opts.env instanceof Env ? opts.env : new Env(opts.env || opts);
  const results = [];
  const diagnostics = [];
  const traceEnabled = !!opts.trace;
  const trace = traceEnabled ? [] : null;
  if (traceEnabled) {
    env._tracer = (kind, detail, span) => {
      trace.push(new TraceEvent({ kind, detail, span: span || { file, line: 1, col: 1, length: 0 } }));
    };
  }
  // Proof mode (issue #35): when `withProofs` is true every query result is
  // accompanied by a derivation tree at the same index in `proofs`. The
  // inline `(? expr with proof)` form opts in per-query without flipping the
  // global flag — in that case `proofs` is still populated, but bare queries
  // that did not ask for a witness get `null` so the array stays
  // index-aligned with `results`.
  const proofsEnabled = !!opts.withProofs;
  let proofs = proofsEnabled ? [] : null;

  // Equality-layer provenance (issue #97). Lazy-allocated: as soon as one
  // query reports a non-null equality layer we backfill nulls for prior
  // queries so the array stays index-aligned with `results`. The property
  // is only attached to the output when at least one entry is non-null,
  // which keeps the baseline `{results, diagnostics}` shape unchanged for
  // programs that never test equality.
  let provenance = null;
  const recordProvenance = (expandedForm, expandedSpan) => {
    const rule = equalityProvenanceForQuery(expandedForm, env);
    if (rule === null) {
      if (provenance !== null) provenance.push(null);
      return;
    }
    if (provenance === null) {
      provenance = results.slice(0, -1).map(() => null);
    }
    provenance.push(rule);
    if (traceEnabled && trace) {
      trace.push(new TraceEvent({ kind: 'equality-layer', detail: rule, span: expandedSpan }));
    }
  };

  // Import context: a stack of canonical paths currently being loaded (cycle
  // detection) and a set of canonical paths already loaded into this env
  // (caching for diamond patterns). Both are reused across recursive calls.
  const importStack = opts._importStack || [];
  const importedFiles = opts._importedFiles || new Set();

  // Shadowing diagnostics (E008) are appended to this array by `defineForm`
  // when a top-level definition rebinds an imported name. Surfaced after the
  // form-evaluation loop so they appear alongside other diagnostics.
  if (!Array.isArray(env._shadowDiagnostics)) env._shadowDiagnostics = [];

  // Pre-compute spans for each top-level form so error reporting can attach
  // a real source location even when the parser/evaluator throw deep inside.
  const formSpans = computeFormSpans(sourceText, file);

  let forms;
  try {
    forms = parseLinoForms(sourceText);
  } catch (err) {
    const diag = err && err.code
      ? new Diagnostic({ code: err.code, message: err.message, span: { file, line: 1, col: 1, length: 0 } })
      : new Diagnostic({ code: 'E006', message: `LiNo parse failure: ${err && err.message ? err.message : String(err)}`, span: { file, line: 1, col: 1, length: 0 } });
    diagnostics.push(diag);
    const out = { results, diagnostics };
    if (traceEnabled) out.trace = trace;
    if (proofs !== null) out.proofs = proofs;
    if (provenance !== null) out.provenance = provenance;
    return out;
  }

  // Evaluate a single `(with-foundation <name> <body>...)` form. Body forms
  // are dispatched recursively so nested `(with-foundation ...)`,
  // `(foundation-report)`, and `(foundation ...)` declarations work the
  // same way they do at the top level. Anything else falls through to the
  // regular `evalNode` query path.
  const runWithFoundation = (form, span) => {
    if (form.length < 2 || typeof form[1] !== 'string') {
      diagnostics.push(new Diagnostic({
        code: 'E062',
        message: 'with-foundation form must be `(with-foundation <name> <body>...)`',
        span,
      }));
      return;
    }
    const fname = form[1];
    let entered = false;
    try {
      env.enterFoundation(fname);
      entered = true;
      if (traceEnabled && trace) {
        trace.push(new TraceEvent({ kind: 'with-foundation/enter', detail: fname, span }));
      }
      for (let bi = 2; bi < form.length; bi++) {
        let body = form[bi];
        while (Array.isArray(body) && body.length === 1 && Array.isArray(body[0])) {
          body = body[0];
        }
        try {
          if (Array.isArray(body) && body[0] === 'with-foundation') {
            runWithFoundation(body, span);
          } else if (Array.isArray(body)
              && (body[0] === 'foundation-report' || body[0] === 'foundation-report?')) {
            const report = env.foundationReport();
            results.push(report);
            if (proofs !== null) proofs.push(null);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'foundation-report', detail: report.activeFoundation, span }));
            }
          } else if (Array.isArray(body) && body[0] === 'foundation') {
            const foundation = parseFoundationForm(body);
            env.registerFoundation(foundation);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'foundation', detail: foundation.name, span }));
            }
          } else if (Array.isArray(body) && body[0] === 'root-construct') {
            const descriptor = parseRootConstructForm(body);
            env.registerRootConstruct(descriptor);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'root-construct', detail: descriptor.name, span }));
            }
          } else if (Array.isArray(body) && body[0] === 'rule' && isProofRuleShape(body)) {
            const rule = parseRuleForm(body);
            env.registerProofRule(rule);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'rule', detail: rule.name, span }));
            }
          } else if (Array.isArray(body) && (body[0] === 'assumption' || body[0] === 'axiom')) {
            const assumption = parseProofAssumptionForm(body);
            env.registerProofAssumption(assumption);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: assumption.kind, detail: assumption.name, span }));
            }
          } else if (Array.isArray(body) && body[0] === 'proof-object') {
            const po = parseProofObjectForm(body);
            env.registerProofObject(po);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'proof-object', detail: po.name, span }));
            }
          } else if (Array.isArray(body) && body[0] === 'check-proof') {
            if (body.length !== 2 || typeof body[1] !== 'string' || !body[1]) {
              throw new RmlError('E064', '(check-proof <name>) requires a proof-object name');
            }
            const target = body[1];
            const verdict = checkProofObject(env, target);
            const value = verdict.ok ? 1 : 0;
            results.push(value);
            if (proofs !== null) proofs.push(null);
            if (provenance !== null) provenance.push(null);
            if (!verdict.ok) {
              diagnostics.push(new Diagnostic({ code: 'E064', message: verdict.error, span }));
            }
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'check-proof', detail: `${target} -> ${verdict.ok ? 'ok' : 'fail'}`, span }));
            }
          } else if (Array.isArray(body) && body[0] === 'proof-report') {
            if (body.length !== 2 || typeof body[1] !== 'string' || !body[1]) {
              throw new RmlError('E064', '(proof-report <name>) requires a proof-object name');
            }
            const target = body[1];
            const report = env.proofReport(target);
            results.push(report);
            if (proofs !== null) proofs.push(null);
            if (provenance !== null) provenance.push(null);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'proof-report', detail: target, span }));
            }
          } else if (Array.isArray(body) && body[0] === 'eval-nat') {
            if (body.length !== 2) {
              throw new RmlError('E067', '(eval-nat <term>) requires exactly one term argument');
            }
            const { value, normalForm, steps } = evalNatTerm(env, body[1]);
            results.push(value);
            if (proofs !== null) proofs.push(null);
            if (provenance !== null) provenance.push(null);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({
                kind: 'eval-nat',
                detail: `${formatTraceValue(body[1])} -> normal-form ${keyOf(normalForm)} -> ${value}; rules-used: ${steps.join(', ') || '<none>'}; host-primitives-used: structural-matcher; renderer: nat-normal-form-to-host-number`,
                span,
              }));
            }
          } else if (Array.isArray(body) && body[0] === 'strict-foundation') {
            const decl = parseStrictFoundationForm(body);
            env.strictPureLinks = true;
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'strict-foundation', detail: decl.profile, span }));
            }
          } else if (Array.isArray(body) && body[0] === 'allow-host-primitive') {
            const decl = parseAllowHostPrimitiveForm(body);
            for (const name of decl.names) env.allowedHostPrimitives.add(name);
            if (traceEnabled && trace) {
              trace.push(new TraceEvent({ kind: 'allow-host-primitive', detail: decl.names.join(' '), span }));
            }
          } else {
            const expanded = expandTemplates(body, env);
            const res = evalNode(expanded, env);
            if (res && res.query) {
              results.push(res.value);
              if (proofs !== null) proofs.push(null);
              recordProvenance(expanded, span);
              const carrierErr = env.checkCarrierValue(res.value);
              if (carrierErr) {
                diagnostics.push(new Diagnostic({
                  code: 'E063',
                  message: `Query result ${formatTraceValue(res.value)} violates active foundation carrier: ${carrierErr}`,
                  span,
                }));
              }
              if (env.strictPureLinks === true) {
                const innerExp = _stripWithProof(expanded.slice(1));
                const targetExp = innerExp.length === 1 ? innerExp[0] : innerExp;
                const offenders = scanPureLinksOffenders(targetExp, env);
                if (offenders.length > 0) {
                  diagnostics.push(new Diagnostic({
                    code: 'E065',
                    message: `Query depends on host-primitive construct(s) under pure-links strict mode: ${offenders.join(', ')}`,
                    span,
                  }));
                }
              }
            }
          }
        } catch (innerErr) {
          const diagSpan = (innerErr && innerErr.span) || span;
          const code = (innerErr && innerErr.code) || 'E000';
          const message = innerErr && innerErr.message ? innerErr.message : String(innerErr);
          diagnostics.push(new Diagnostic({ code, message, span: diagSpan }));
        }
      }
    } catch (err) {
      diagnostics.push(new Diagnostic({
        code: (err && err.code) || 'E062',
        message: err && err.message ? err.message : String(err),
        span: (err && err.span) || span,
      }));
    } finally {
      if (entered) {
        env.exitFoundation();
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'with-foundation/exit', detail: fname, span }));
        }
      }
    }
  };

  for (let idx = 0; idx < forms.length; idx++) {
    let form = forms[idx];
    while (Array.isArray(form) && form.length === 1 && Array.isArray(form[0])) {
      form = form[0];
    }
    const span = formSpans[idx] || { file, line: 1, col: 1, length: 0 };
    env._currentSpan = span;

    // Handle (namespace <name>) at the top level — sets the active namespace
    // for subsequent definitions in this file (issue #34).
    if (Array.isArray(form) && form.length === 2 && form[0] === 'namespace' && typeof form[1] === 'string') {
      const ns = form[1];
      if (ns.includes('.')) {
        diagnostics.push(new Diagnostic({
          code: 'E009',
          message: `Namespace name must not contain '.': "${ns}"`,
          span,
        }));
      } else {
        env.namespace = ns;
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'namespace', detail: ns, span }));
        }
      }
      continue;
    }

    // Handle (import <path>) and (import <path> as <alias>) at the top level —
    // file-level directives, not regular RML expressions.
    if (Array.isArray(form) && form[0] === 'import') {
      let importDiag = null;
      if (form.length === 2) {
        importDiag = handleImport(form[1], null, span, file, env, importStack, importedFiles, diagnostics, traceEnabled, trace);
      } else if (form.length === 4 && form[2] === 'as' && typeof form[3] === 'string') {
        importDiag = handleImport(form[1], form[3], span, file, env, importStack, importedFiles, diagnostics, traceEnabled, trace);
      } else if (form.length === 2 || form.length >= 3) {
        importDiag = new Diagnostic({
          code: 'E007',
          message: 'Import directive must be (import "<path>") or (import "<path>" as <alias>)',
          span,
        });
      }
      if (importDiag) diagnostics.push(importDiag);
      continue;
    }

    // Handle `(template (<name> <param>...) <body>)` at the top level. The
    // declaration itself produces no result; later forms are expanded before
    // regular evaluation.
    if (Array.isArray(form) && form[0] === 'template') {
      try {
        const registered = registerTemplateForm(form, env);
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'template', detail: registered, span }));
        }
      } catch (err) {
        diagnostics.push(new Diagnostic({
          code: (err && err.code) || 'E040',
          message: err && err.message ? err.message : String(err),
          span: (err && err.span) || span,
        }));
      }
      continue;
    }

    // Foundation / root-construct registry (issue #97). Declarations are
    // data-only: they record what the prover trusts but never alter the host
    // implementation's behaviour. Backward compatibility is preserved by
    // defaulting to the `default-rml` foundation, which is preregistered with
    // the current host semantics.
    if (Array.isArray(form) && form[0] === 'root-construct') {
      try {
        const descriptor = parseRootConstructForm(form);
        env.registerRootConstruct(descriptor);
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'root-construct', detail: descriptor.name, span }));
        }
      } catch (err) {
        diagnostics.push(new Diagnostic({
          code: (err && err.code) || 'E060',
          message: err && err.message ? err.message : String(err),
          span: (err && err.span) || span,
        }));
      }
      continue;
    }
    if (Array.isArray(form) && form[0] === 'foundation') {
      try {
        const foundation = parseFoundationForm(form);
        env.registerFoundation(foundation);
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'foundation', detail: foundation.name, span }));
        }
      } catch (err) {
        diagnostics.push(new Diagnostic({
          code: (err && err.code) || 'E061',
          message: err && err.message ? err.message : String(err),
          span: (err && err.span) || span,
        }));
      }
      continue;
    }
    if (Array.isArray(form) && form[0] === 'with-foundation') {
      runWithFoundation(form, span);
      continue;
    }
    if (Array.isArray(form) && (form[0] === 'foundation-report' || form[0] === 'foundation-report?')) {
      const report = env.foundationReport();
      results.push(report);
      if (proofs !== null) proofs.push(null);
      if (traceEnabled && trace) {
        trace.push(new TraceEvent({ kind: 'foundation-report', detail: report.activeFoundation, span }));
      }
      continue;
    }
    // Proof-object substrate (issue #97, Phase 3). Rules and proof objects
    // are registered as data; `(check-proof <name>)` looks the proof up,
    // matches it structurally against the rule's pattern with `?metavar`
    // unification, and returns 1.0 on success or 0.0 on failure (emitting
    // an E064 diagnostic so callers can surface the mismatch reason).
    // The proof-substrate form is `(rule <leaf-name> (premise ...)... (conclusion ...))`.
    // Existing self-bootstrap grammar files declare `(rule <leaf-name> (sequence
    // ...) ...)` data-only forms that we must not hijack, so we route to the
    // proof substrate only when every clause uses the `premise`/`conclusion`
    // keywords and at least one `conclusion` clause is present. Other shapes
    // fall through to the legacy data path unchanged.
    if (isProofRuleShape(form)) {
      try {
        const rule = parseRuleForm(form);
        env.registerProofRule(rule);
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'rule', detail: rule.name, span }));
        }
      } catch (err) {
        diagnostics.push(new Diagnostic({
          code: (err && err.code) || 'E064',
          message: err && err.message ? err.message : String(err),
          span: (err && err.span) || span,
        }));
      }
      continue;
    }
    if (Array.isArray(form) && (form[0] === 'assumption' || form[0] === 'axiom')) {
      try {
        const assumption = parseProofAssumptionForm(form);
        env.registerProofAssumption(assumption);
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: assumption.kind, detail: assumption.name, span }));
        }
      } catch (err) {
        diagnostics.push(new Diagnostic({
          code: (err && err.code) || 'E064',
          message: err && err.message ? err.message : String(err),
          span: (err && err.span) || span,
        }));
      }
      continue;
    }
    if (Array.isArray(form) && form[0] === 'proof-object') {
      try {
        const po = parseProofObjectForm(form);
        env.registerProofObject(po);
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'proof-object', detail: po.name, span }));
        }
      } catch (err) {
        diagnostics.push(new Diagnostic({
          code: (err && err.code) || 'E064',
          message: err && err.message ? err.message : String(err),
          span: (err && err.span) || span,
        }));
      }
      continue;
    }
    // Pure-links strict mode (issue #97, Phase 6). The `(strict-foundation
    // pure-links)` form flips the audit on for every subsequent query; the
    // `(allow-host-primitive ...)` form whitelists specific host primitives
    // so a program can opt in gradually instead of all at once.
    if (Array.isArray(form) && form[0] === 'strict-foundation') {
      try {
        const decl = parseStrictFoundationForm(form);
        env.strictPureLinks = true;
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'strict-foundation', detail: decl.profile, span }));
        }
      } catch (err) {
        diagnostics.push(new Diagnostic({
          code: (err && err.code) || 'E065',
          message: err && err.message ? err.message : String(err),
          span: (err && err.span) || span,
        }));
      }
      continue;
    }
    if (Array.isArray(form) && form[0] === 'allow-host-primitive') {
      try {
        const decl = parseAllowHostPrimitiveForm(form);
        for (const n of decl.names) env.allowedHostPrimitives.add(n);
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({ kind: 'allow-host-primitive', detail: decl.names.join(','), span }));
        }
      } catch (err) {
        diagnostics.push(new Diagnostic({
          code: (err && err.code) || 'E065',
          message: err && err.message ? err.message : String(err),
          span: (err && err.span) || span,
        }));
      }
      continue;
    }
    if (Array.isArray(form) && form[0] === 'check-proof') {
      if (form.length !== 2 || typeof form[1] !== 'string') {
        diagnostics.push(new Diagnostic({
          code: 'E064',
          message: '(check-proof <name>) requires a proof-object name',
          span,
        }));
        continue;
      }
      const verdict = checkProofObject(env, form[1]);
      results.push(verdict.ok ? 1 : 0);
      if (proofs !== null) proofs.push(null);
      if (!verdict.ok) {
        diagnostics.push(new Diagnostic({
          code: 'E064',
          message: verdict.error,
          span,
        }));
      }
      if (traceEnabled && trace) {
        trace.push(new TraceEvent({
          kind: 'check-proof',
          detail: `${form[1]} → ${verdict.ok ? 'ok' : 'fail'}`,
          span,
        }));
      }
      continue;
    }
    if (Array.isArray(form) && form[0] === 'proof-report') {
      if (form.length !== 2 || typeof form[1] !== 'string' || !form[1]) {
        diagnostics.push(new Diagnostic({
          code: 'E064',
          message: '(proof-report <name>) requires a proof-object name',
          span,
        }));
        continue;
      }
      const report = env.proofReport(form[1]);
      results.push(report);
      if (proofs !== null) proofs.push(null);
      if (traceEnabled && trace) {
        trace.push(new TraceEvent({
          kind: 'proof-report',
          detail: form[1],
          span,
        }));
      }
      continue;
    }
    if (Array.isArray(form) && form[0] === 'eval-nat') {
      if (form.length !== 2) {
        diagnostics.push(new Diagnostic({
          code: 'E067',
          message: '(eval-nat <term>) requires exactly one term argument',
          span,
        }));
        continue;
      }
      try {
        const { value, normalForm, steps } = evalNatTerm(env, form[1]);
        results.push(value);
        if (proofs !== null) proofs.push(null);
        if (provenance !== null) provenance.push(null);
        if (traceEnabled && trace) {
          trace.push(new TraceEvent({
            kind: 'eval-nat',
            detail: `${formatTraceValue(form[1])} -> normal-form ${keyOf(normalForm)} -> ${value}; rules-used: ${steps.join(', ') || '<none>'}; host-primitives-used: structural-matcher; renderer: nat-normal-form-to-host-number`,
            span,
          }));
        }
      } catch (err) {
        const diagSpan = (err && err.span) || span;
        const code = (err && err.code) || 'E067';
        const message = err && err.message ? err.message : String(err);
        diagnostics.push(new Diagnostic({ code, message, span: diagSpan }));
      }
      continue;
    }

    try {
      const expandedForm = expandTemplates(form, env);
      const res = evalNode(expandedForm, env);
      if (traceEnabled) {
        const formKey = keyOf(expandedForm);
        let summary;
        if (res && res.query) {
          const tag = res.typeQuery ? 'type' : 'query';
          summary = `${formKey} → ${tag} ${formatTraceValue(res.value)}`;
        } else if (isTermResult(res)) {
          summary = `${formKey} → term ${keyOf(res.term)}`;
        } else {
          summary = `${formKey} → ${formatTraceValue(res)}`;
        }
        trace.push(new TraceEvent({ kind: 'eval', detail: summary, span }));
      }
      if (res && res.query) {
        results.push(res.value);
        // Per-query proof: the global `withProofs` flag forces a proof for
        // every query; the inline `with proof` keyword pair opts a single
        // query in without the global flag. Lazily allocate the proofs
        // array on first per-query opt-in so callers that never use
        // proofs still get the original `{results, diagnostics}` shape.
        const wantsProof = proofsEnabled || _queryRequestsProof(expandedForm);
        if (wantsProof) {
          if (proofs === null) {
            // Backfill nulls for any prior bare queries so indexes align.
            proofs = results.slice(0, -1).map(() => null);
          }
          // Strip the surrounding (? ...) so the proof attaches to the
          // queried expression directly; this matches the issue example
          // `(by structural-equality (a a))` rather than nesting under
          // `(by query ...)`.
          const inner = _stripWithProof(expandedForm.slice(1));
          const target = inner.length === 1 ? inner[0] : inner;
          proofs.push(buildProof(target, env));
        } else if (proofs !== null) {
          proofs.push(null);
        }
        recordProvenance(expandedForm, span);
        const carrierErr = env.checkCarrierValue(res.value);
        if (carrierErr) {
          diagnostics.push(new Diagnostic({
            code: 'E063',
            message: `Query result ${formatTraceValue(res.value)} violates active foundation carrier: ${carrierErr}`,
            span,
          }));
        }
        if (env.strictPureLinks === true) {
          const inner = _stripWithProof(expandedForm.slice(1));
          const target = inner.length === 1 ? inner[0] : inner;
          const offenders = scanPureLinksOffenders(target, env);
          if (offenders.length > 0) {
            diagnostics.push(new Diagnostic({
              code: 'E065',
              message: `Query depends on host-primitive construct(s) under pure-links strict mode: ${offenders.join(', ')}`,
              span,
            }));
          }
        }
      }
    } catch (err) {
      const diagSpan = (err && err.span) || span;
      const code = (err && err.code) || 'E000';
      const message = err && err.message ? err.message : String(err);
      diagnostics.push(new Diagnostic({ code, message, span: diagSpan }));
    }
  }
  env._currentSpan = null;
  env._tracer = null;
  // Surface shadow diagnostics (E008) collected during defineForm calls.
  if (Array.isArray(env._shadowDiagnostics) && env._shadowDiagnostics.length > 0) {
    for (const d of env._shadowDiagnostics) diagnostics.push(d);
    env._shadowDiagnostics.length = 0;
  }
  const out = { results, diagnostics };
  if (traceEnabled) out.trace = trace;
  if (proofs !== null) out.proofs = proofs;
  if (provenance !== null) {
    // Pad in the rare case where late queries returned without going
    // through `recordProvenance` (defensive — keeps the array aligned
    // with `results` for consumers iterating by index).
    while (provenance.length < results.length) provenance.push(null);
    out.provenance = provenance;
  }
  return out;
}

// ---------- File imports (issue #33) ----------
// Strip surrounding quotes (LiNo passes them through unmodified for some
// shapes; the LiNo parser strips double-quotes for most inputs).
function _unquotePath(s) {
  if (typeof s !== 'string') return s;
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
    return s.slice(1, -1);
  }
  return s;
}

// Resolve an import target relative to the importing file's directory.
// When `importingFile` is null (e.g. evaluating a string literal in tests),
// resolve relative to the current working directory.
function _resolveImportPath(target, importingFile) {
  const cleaned = _unquotePath(target);
  if (path.isAbsolute(cleaned)) return path.resolve(cleaned);
  const baseDir = importingFile ? path.dirname(path.resolve(importingFile)) : process.cwd();
  return path.resolve(baseDir, cleaned);
}

// Process a top-level (import <path>) directive. Returns a Diagnostic or null.
// `alias`, when non-null, comes from the `(import "<path>" as <alias>)` form
// (issue #34): after the imported file finishes evaluating, the alias is
// recorded in `env.aliases` mapping `alias -> imported namespace`, so
// references like `<alias>.foo` resolve against that namespace.
function handleImport(rawTarget, alias, span, importingFile, env, importStack, importedFiles, diagnostics, traceEnabled, trace) {
  const target = _unquotePath(rawTarget);
  if (typeof target !== 'string' || !target) {
    return new Diagnostic({
      code: 'E007',
      message: 'Import target must be a string path',
      span,
    });
  }
  if (alias !== null && alias !== undefined) {
    if (typeof alias !== 'string' || !alias || alias.includes('.')) {
      return new Diagnostic({
        code: 'E009',
        message: `Import alias must be a non-empty bare identifier (got "${alias}")`,
        span,
      });
    }
    if (env.aliases.has(alias) || env.namespace === alias) {
      return new Diagnostic({
        code: 'E009',
        message: `Import alias "${alias}" collides with an existing namespace or alias`,
        span,
      });
    }
  }
  const resolved = _resolveImportPath(target, importingFile);

  // Cycle detection: if the resolved path is already on the active import
  // stack, the import would loop forever.
  if (importStack.includes(resolved)) {
    const cycle = [...importStack, resolved].join(' -> ');
    return new Diagnostic({
      code: 'E007',
      message: `Import cycle detected: ${cycle}`,
      span,
    });
  }

  // Cache: each file is loaded once. Repeated imports (e.g. diamond pattern)
  // are silent no-ops — but the alias still needs to register, since the
  // imported namespace is already loaded into the env.
  if (importedFiles.has(resolved)) {
    if (alias) {
      const recordedNs = (env._fileNamespaces && env._fileNamespaces.get(resolved)) || alias;
      env.aliases.set(alias, recordedNs);
      if (traceEnabled && trace) {
        trace.push(new TraceEvent({ kind: 'import', detail: `${resolved} as ${alias} (cached)`, span }));
      }
    } else if (traceEnabled && trace) {
      trace.push(new TraceEvent({ kind: 'import', detail: `${resolved} (cached)`, span }));
    }
    return null;
  }

  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    return new Diagnostic({
      code: 'E007',
      message: `Failed to read import "${target}": ${err.message}`,
      span,
    });
  }

  importedFiles.add(resolved);
  importStack.push(resolved);
  if (traceEnabled && trace) {
    trace.push(new TraceEvent({ kind: 'import', detail: alias ? `${resolved} as ${alias}` : resolved, span }));
  }

  // Track names introduced by this import so the importing file can fire a
  // shadowing diagnostic (E008) if it later rebinds them. Snapshot the
  // current bindings before evaluating the imported file, then diff.
  const beforeOps = new Set(env.ops.keys());
  const beforeSyms = new Set(env.symbolProb.keys());
  const beforeTerms = new Set(env.terms);
  const beforeLambdas = new Set(env.lambdas.keys());
  const beforeTemplates = new Set(env.templates.keys());
  const beforeNamespace = env.namespace;

  const inner = evaluate(text, {
    env,
    file: resolved,
    trace: traceEnabled,
    _importStack: importStack,
    _importedFiles: importedFiles,
  });

  // The imported file may have declared its own (namespace ...) — capture it
  // before restoring the importing file's namespace so we can wire up the
  // alias and remember the file's namespace for cached re-imports.
  const importedNamespace = env.namespace;
  env.namespace = beforeNamespace;
  if (importedNamespace) {
    if (!env._fileNamespaces) env._fileNamespaces = new Map();
    env._fileNamespaces.set(resolved, importedNamespace);
  }

  importStack.pop();

  // Record names added by the import for shadowing detection. Skip this when
  // the import is itself nested inside another import — only the top-level
  // file should warn.
  if (importStack.length === 0 || (importingFile && importStack[importStack.length - 1] === importingFile)) {
    for (const k of env.ops.keys()) if (!beforeOps.has(k)) env.imported.add(k);
    for (const k of env.symbolProb.keys()) if (!beforeSyms.has(k)) env.imported.add(k);
    for (const k of env.terms) if (!beforeTerms.has(k)) env.imported.add(k);
    for (const k of env.lambdas.keys()) if (!beforeLambdas.has(k)) env.imported.add(k);
    for (const k of env.templates.keys()) if (!beforeTemplates.has(k)) env.imported.add(k);
  }

  // Wire up the alias once the imported file has finished evaluating. If the
  // imported file declared a namespace, alias maps to it; otherwise it maps
  // to the alias name itself (so qualified references through the alias still
  // work for namespace-less files — symbols defined as top-level become
  // accessible via `<alias>.<name>` only if pre-existing under that key).
  if (alias) {
    env.aliases.set(alias, importedNamespace || alias);
  }

  // Forward inner diagnostics so the importer surfaces errors from the
  // imported file with their original spans intact.
  for (const diag of inner.diagnostics) diagnostics.push(diag);
  if (traceEnabled && trace && Array.isArray(inner.trace)) {
    for (const ev of inner.trace) trace.push(ev);
  }
  return null;
}

// Read a file from disk and evaluate it, honouring (import ...) directives.
// Mirrors `evaluate()` but takes a path on disk and resolves relative imports
// against the file's directory.
/**
 * Read and evaluate a LiNo file, resolving imports relative to that file.
 */
function evaluateFile(filePath, options) {
  const opts = options || {};
  const resolved = path.resolve(filePath);
  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    const diag = new Diagnostic({
      code: 'E007',
      message: `Failed to read "${filePath}": ${err.message}`,
      span: { file: filePath, line: 1, col: 1, length: 0 },
    });
    return { results: [], diagnostics: [diag] };
  }
  return evaluate(text, {
    ...opts,
    file: resolved,
    _importStack: opts._importStack || [resolved],
    _importedFiles: opts._importedFiles || new Set([resolved]),
  });
}

// ---------- Meta-expression adapter ----------
function normalizeInterpretation(interpretation) {
  if (!interpretation) return {};
  if (typeof interpretation === 'string') return { kind: interpretation, summary: interpretation };
  return interpretation;
}

function normalizeQuestionExpression(text) {
  return String(text || '')
    .trim()
    .replace(/\?+$/g, '')
    .replace(/^what\s+is\s+/i, '')
    .trim();
}

function splitTopLevelEquals(expression) {
  let depth = 0;
  const s = String(expression);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '=' && depth === 0) {
      if (s[i - 1] === '!' || s[i + 1] === '=') continue;
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }
  }
  return null;
}

function parseExpressionShape(expression, options = {}) {
  const trimmed = String(expression || '').trim();
  if (!trimmed) throw new RmlError('E005', 'empty expression');
  const source = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed : `(${trimmed})`;
  let ast = parseOne(tokenizeOne(source));
  while (
    Array.isArray(ast) &&
    ast.length === 1 &&
    (options.unwrapSingle || Array.isArray(ast[0]))
  ) {
    ast = ast[0];
  }
  return ast;
}

function buildArithmeticFormalization(expression, valueKind) {
  const eq = valueKind === 'truth-value' ? splitTopLevelEquals(expression) : null;
  const ast = eq
    ? [parseExpressionShape(eq[0], { unwrapSingle: true }), '=', parseExpressionShape(eq[1], { unwrapSingle: true })]
    : parseExpressionShape(expression, { unwrapSingle: true });
  return {
    ast,
    lino: keyOf(ast),
    valueKind,
  };
}

function partialFormalization(request, interpretation, unknowns, level = 2) {
  const uniqueUnknowns = [...new Set(unknowns)];
  return {
    type: 'rml-formalization',
    sourceText: request?.text || '',
    interpretation,
    formalSystem: request?.formalSystem || request?.formal_system || 'rml',
    dependencies: request?.dependencies || [],
    computable: false,
    formalizationLevel: level,
    unknowns: uniqueUnknowns,
    valueKind: 'partial',
    ast: null,
    lino: null,
  };
}

function formalizeSelectedInterpretation(request = {}) {
  const interpretation = normalizeInterpretation(request.interpretation);
  const kind = String(interpretation.kind || '').toLowerCase();
  const formalSystem = request.formalSystem || request.formal_system || 'rml';
  const dependencies = request.dependencies || [];
  const rawExpression =
    interpretation.expression ||
    interpretation.formalExpression ||
    interpretation.formal_expression ||
    interpretation.lino ||
    normalizeQuestionExpression(request.text);

  const canUseArithmetic =
    formalSystem === 'rml-arithmetic' ||
    formalSystem === 'arithmetic' ||
    kind.startsWith('arithmetic');

  if (canUseArithmetic && rawExpression) {
    const valueKind = kind.includes('equal') || splitTopLevelEquals(rawExpression) ? 'truth-value' : 'number';
    try {
      const formal = buildArithmeticFormalization(rawExpression, valueKind);
      return {
        type: 'rml-formalization',
        sourceText: request.text || '',
        interpretation,
        formalSystem,
        dependencies,
        computable: true,
        formalizationLevel: 3,
        unknowns: [],
        valueKind: formal.valueKind,
        ast: formal.ast,
        lino: formal.lino,
      };
    } catch (error) {
      return partialFormalization(request, interpretation, ['unsupported-arithmetic-shape', error.message], 1);
    }
  }

  if ((interpretation.lino || interpretation.formalExpression || interpretation.formal_expression) && rawExpression) {
    try {
      const ast = parseExpressionShape(rawExpression);
      return {
        type: 'rml-formalization',
        sourceText: request.text || '',
        interpretation,
        formalSystem,
        dependencies,
        computable: true,
        formalizationLevel: 3,
        unknowns: [],
        valueKind: Array.isArray(ast) && ast[0] === '?' ? 'query' : 'truth-value',
        ast,
        lino: keyOf(ast),
      };
    } catch (error) {
      return partialFormalization(request, interpretation, ['unsupported-lino-shape', error.message], 1);
    }
  }

  const dependencyUnknowns = dependencies
    .filter(dep => dep && ['missing', 'unknown', 'partial'].includes(dep.status))
    .map(dep => `dependency:${dep.id || 'unknown'}`);
  return partialFormalization(request, interpretation, [
    'selected-subject',
    'selected-relation',
    'evidence-source',
    'formal-shape',
    ...dependencyUnknowns,
  ]);
}

function evaluateFormalization(formalization, options = {}) {
  if (!formalization || !formalization.computable || !formalization.ast) {
    return {
      computable: false,
      formalizationLevel: formalization?.formalizationLevel || 0,
      unknowns: formalization?.unknowns || ['formalization'],
      result: { kind: 'partial', value: 'unknown', deterministic: false },
    };
  }

  const env = new Env(options.env || options);
  const evaluated = evalNode(formalization.ast, env);
  const value = evaluated && evaluated.query ? evaluated.value : evaluated;
  const kind =
    formalization.valueKind === 'truth-value' ? 'truth-value' :
    formalization.valueKind === 'query' && typeof value === 'string' ? 'type' :
    'number';

  return {
    computable: true,
    formalizationLevel: formalization.formalizationLevel,
    unknowns: [],
    result: { kind, value, deterministic: true },
  };
}

// ---------- Program extraction (issue #66) ----------
const EXTRACT_JS_RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return',
  'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield',
]);

const EXTRACT_RUST_RESERVED = new Set([
  'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern',
  'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod',
  'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct',
  'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async',
  'await', 'dyn',
]);

const EXTRACT_LOGIC_TOKENS = new Set(['and', 'or', 'not', 'both', 'neither', 'has', 'probability']);
const EXTRACT_SPECIAL_FORMS = new Set([
  'range', 'valence', 'mode', 'relation', 'world', 'total', 'coverage',
  'terminating', 'coinductive', 'template', 'import', 'namespace',
]);

function normalizeExtractTarget(target) {
  if (target === 'js' || target === 'javascript') return 'js';
  if (target === 'rust' || target === 'rs') return 'rust';
  throw new RmlError('E041', `Unknown extraction target "${target}"`);
}

function extractIdentifier(name, target, used) {
  const reserved = target === 'rust' ? EXTRACT_RUST_RESERVED : EXTRACT_JS_RESERVED;
  let out = String(name).replace(/[^A-Za-z0-9_]/g, '_');
  if (!out || /^[0-9]/.test(out)) out = '_' + out;
  if (reserved.has(out)) out = out + '_';
  const base = out;
  let i = 2;
  while (used.has(out)) {
    out = `${base}_${i}`;
    i++;
  }
  used.add(out);
  return out;
}

function extractNumberLiteral(token, target) {
  const raw = String(token);
  if (target === 'rust' && /^-?\d+$/.test(raw)) return `${raw}.0`;
  return raw;
}

function extractCompileError(message) {
  return new RmlError('E041', message);
}

function isProbabilityAssignment(node) {
  return Array.isArray(node) &&
    node.length === 4 &&
    node[1] === 'has' &&
    node[2] === 'probability';
}

function isQueryForm(node) {
  return Array.isArray(node) && node[0] === '?';
}

function isLambdaDefinition(node) {
  return Array.isArray(node) &&
    node.length >= 3 &&
    typeof node[0] === 'string' &&
    node[0].endsWith(':') &&
    node[1] === 'lambda' &&
    Array.isArray(node[2]);
}

function isTypeOnlyForm(node) {
  if (!Array.isArray(node) || node.length === 0) return true;
  if (node[0] === 'Type' || node[0] === 'Prop' || node[0] === 'Pi') return true;
  if (typeof node[0] !== 'string' || !node[0].endsWith(':')) return false;
  const head = node[0].slice(0, -1);
  const rhs = node.slice(1);
  if (rhs.length === 2 && rhs[1] === head) return true;
  if (rhs.length === 3 && rhs[0] === head && rhs[1] === 'is' && rhs[2] === head) return true;
  if (rhs.length === 1 && Array.isArray(rhs[0])) return true;
  return false;
}

function containsExtractLogic(node) {
  if (typeof node === 'string') return EXTRACT_LOGIC_TOKENS.has(node);
  if (!Array.isArray(node)) return false;
  if (isProbabilityAssignment(node)) return true;
  return node.some(containsExtractLogic);
}

function extractLambdaDeclaration(form) {
  const name = form[0].slice(0, -1);
  const bindings = parseBindings(form[2]);
  if (!bindings || bindings.length === 0) {
    throw extractCompileError(`Cannot extract "${name}": malformed lambda binding`);
  }
  if (form.length !== 4) {
    throw extractCompileError(`Cannot extract "${name}": lambda definitions must have one body`);
  }
  return {
    name,
    params: bindings.map(b => b.paramName),
    body: form[3],
  };
}

function collectApplySpine(node) {
  const args = [];
  let head = node;
  while (Array.isArray(head) && head.length === 3 && head[0] === 'apply') {
    args.unshift(head[2]);
    head = head[1];
  }
  return { head, args };
}

function makeExtractNameMap(names, target) {
  const used = new Set();
  const map = new Map();
  for (const name of names) {
    map.set(name, extractIdentifier(name, target, used));
  }
  return map;
}

function compileExtractExpr(node, ctx) {
  if (typeof node === 'string') {
    if (isNum(node)) return extractNumberLiteral(node, ctx.target);
    if (ctx.locals.has(node)) return ctx.locals.get(node);
    if (ctx.nameMap.has(node)) return ctx.nameMap.get(node);
    throw extractCompileError(`Cannot extract unresolved symbol "${node}"`);
  }
  if (!Array.isArray(node) || node.length === 0) {
    throw extractCompileError(`Cannot extract malformed expression "${keyOf(node)}"`);
  }
  if (containsExtractLogic(node)) {
    throw extractCompileError(`Cannot extract probabilistic or logical expression "${keyOf(node)}"`);
  }
  if (node.length === 3 && typeof node[1] === 'string' && ['+', '-', '*', '/'].includes(node[1])) {
    return `(${compileExtractExpr(node[0], ctx)} ${node[1]} ${compileExtractExpr(node[2], ctx)})`;
  }
  if (node.length === 3 && node[0] === 'apply') {
    const { head, args } = collectApplySpine(node);
    if (typeof head !== 'string') {
      throw extractCompileError(`Cannot extract higher-order application "${keyOf(node)}"`);
    }
    const fn = compileExtractExpr(head, ctx);
    return `${fn}(${args.map(arg => compileExtractExpr(arg, ctx)).join(', ')})`;
  }
  if (typeof node[0] === 'string' && ctx.nameMap.has(node[0])) {
    const fn = ctx.nameMap.get(node[0]);
    return `${fn}(${node.slice(1).map(arg => compileExtractExpr(arg, ctx)).join(', ')})`;
  }
  throw extractCompileError(`Cannot extract expression "${keyOf(node)}"`);
}

function parseExtractQuery(form) {
  const parts = _stripWithProof(form.slice(1));
  const target = parts.length === 1 ? parts[0] : parts;
  if (Array.isArray(target) && target.length === 3 && target[1] === '=') {
    return { left: target[0], right: target[2] };
  }
  throw extractCompileError(`Cannot extract query "${keyOf(form)}"; expected (? (<left> = <right>))`);
}

function parseExtractProgram(code) {
  const forms = parseLinoForms(String(code));
  const lambdas = [];
  const tests = [];
  for (const form of forms) {
    if (isProbabilityAssignment(form)) {
      throw extractCompileError('Cannot extract probability assignments');
    }
    if (isLambdaDefinition(form)) {
      if (containsExtractLogic(form[3])) {
        throw extractCompileError(`Cannot extract probabilistic or logical lambda "${form[0].slice(0, -1)}"`);
      }
      lambdas.push(extractLambdaDeclaration(form));
      continue;
    }
    if (isQueryForm(form)) {
      tests.push(parseExtractQuery(form));
      continue;
    }
    if (Array.isArray(form) && typeof form[0] === 'string') {
      const head = form[0].endsWith(':') ? form[0].slice(0, -1) : form[0];
      if (EXTRACT_SPECIAL_FORMS.has(head) || ['and', 'or', 'not', 'both', 'neither', '=', '!='].includes(head)) {
        throw extractCompileError(`Cannot extract unsupported form "${keyOf(form)}"`);
      }
    }
    if (!isTypeOnlyForm(form)) {
      throw extractCompileError(`Cannot extract unsupported form "${keyOf(form)}"`);
    }
  }
  if (lambdas.length === 0) {
    throw extractCompileError('Cannot extract program: no lambda definitions found');
  }
  return { lambdas, tests };
}

function compileJavaScriptProgram(parsed) {
  const nameMap = makeExtractNameMap(parsed.lambdas.map(l => l.name), 'js');
  const lines = [
    '// Generated by rml extract js. Do not edit by hand.',
    "import { pathToFileURL } from 'node:url';",
    '',
  ];
  for (const lambda of parsed.lambdas) {
    const used = new Set(nameMap.values());
    const locals = new Map();
    for (const param of lambda.params) {
      locals.set(param, extractIdentifier(param, 'js', used));
    }
    const ctx = { target: 'js', nameMap, locals };
    const params = lambda.params.map(param => locals.get(param)).join(', ');
    lines.push(`export function ${nameMap.get(lambda.name)}(${params}) {`);
    lines.push(`  return ${compileExtractExpr(lambda.body, ctx)};`);
    lines.push('}');
    lines.push('');
  }
  lines.push('function __rmlApproxEq(left, right) {');
  lines.push('  return Object.is(left, right) || Math.abs(left - right) <= 1e-9;');
  lines.push('}');
  lines.push('');
  lines.push('export function __runRmlExtractedTests() {');
  if (parsed.tests.length === 0) {
    lines.push('  return true;');
  } else {
    parsed.tests.forEach((test, idx) => {
      const ctx = { target: 'js', nameMap, locals: new Map() };
      const left = compileExtractExpr(test.left, ctx);
      const right = compileExtractExpr(test.right, ctx);
      lines.push(`  if (!__rmlApproxEq(${left}, ${right})) {`);
      lines.push(`    throw new Error('RML extracted test ${idx + 1} failed');`);
      lines.push('  }');
    });
    lines.push('  return true;');
  }
  lines.push('}');
  lines.push('');
  lines.push("if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {");
  lines.push('  __runRmlExtractedTests();');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function compileRustProgram(parsed) {
  const nameMap = makeExtractNameMap(parsed.lambdas.map(l => l.name), 'rust');
  const lines = ['// Generated by rml extract rust. Do not edit by hand.', ''];
  for (const lambda of parsed.lambdas) {
    const used = new Set(nameMap.values());
    const locals = new Map();
    for (const param of lambda.params) {
      locals.set(param, extractIdentifier(param, 'rust', used));
    }
    const ctx = { target: 'rust', nameMap, locals };
    const params = lambda.params.map(param => `${locals.get(param)}: f64`).join(', ');
    lines.push(`pub fn ${nameMap.get(lambda.name)}(${params}) -> f64 {`);
    lines.push(`    ${compileExtractExpr(lambda.body, ctx)}`);
    lines.push('}');
    lines.push('');
  }
  if (parsed.tests.length > 0) {
    lines.push('#[cfg(test)]');
    lines.push('mod tests {');
    lines.push('    use super::*;');
    lines.push('');
    lines.push('    fn rml_approx_eq(left: f64, right: f64) -> bool {');
    lines.push('        (left - right).abs() <= 1e-9');
    lines.push('    }');
    lines.push('');
    parsed.tests.forEach((test, idx) => {
      const ctx = { target: 'rust', nameMap, locals: new Map() };
      const left = compileExtractExpr(test.left, ctx);
      const right = compileExtractExpr(test.right, ctx);
      lines.push('    #[test]');
      lines.push(`    fn rml_query_${idx + 1}() {`);
      lines.push(`        assert!(rml_approx_eq(${left}, ${right}), "RML query ${idx + 1} failed");`);
      lines.push('    }');
      lines.push('');
    });
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Extract selected LiNo definitions into JavaScript or Rust source code.
 */
function extractProgram(code, target = 'js') {
  const normalized = normalizeExtractTarget(target);
  const parsed = parseExtractProgram(code);
  return normalized === 'js' ? compileJavaScriptProgram(parsed) : compileRustProgram(parsed);
}


// ---------- Isabelle/HOL exporter ----------
// The exporter targets the simply typed fragment shared by RML's prototype
// type layer and Isabelle/HOL: type declarations, constants, simple Pi-types,
// first-order inductive datatypes, and lambda definitions whose types can be
// inferred locally. Dependent Pi codomains and probabilistic/operator forms
// are rejected instead of being approximated silently.
class IsabelleExportError extends Error {
  constructor(message, node = null) {
    const suffix = node ? `: ${keyOf(node)}` : '';
    super(`Isabelle export: ${message}${suffix}`);
    this.name = 'IsabelleExportError';
    this.node = node;
  }
}

const ISABELLE_RESERVED = new Set([
  'and', 'assumes', 'begin', 'binder', 'case', 'class', 'consts', 'datatype',
  'definition', 'else', 'end', 'fixes', 'for', 'fun', 'if', 'imports', 'in',
  'infix', 'infixl', 'infixr', 'let', 'locale', 'module', 'notation', 'of',
  'open', 'or', 'shows', 'structure', 'syntax', 'then', 'theory', 'type',
  'typedecl', 'where',
]);

function _isUniverseAnnotation(node) {
  if (node === 'Type') return true;
  return Array.isArray(node) &&
    node.length === 2 &&
    node[0] === 'Type' &&
    parseUniverseLevelToken(node[1]) !== null;
}

function _isTypeSelfDeclaration(name, rhs) {
  return rhs.length === 2 &&
    rhs[1] === name &&
    _isUniverseAnnotation(rhs[0]);
}

function _isTypedSelfDeclaration(name, rhs) {
  return rhs.length === 2 && rhs[1] === name && !_isUniverseAnnotation(rhs[0]);
}

function _isProbabilisticAssignment(node) {
  return Array.isArray(node) &&
    node.length === 4 &&
    node[1] === 'has' &&
    node[2] === 'probability' &&
    isNum(node[3]);
}

function _isOperatorHead(head) {
  return ['=','!=','and','or','not','is','?:','both','neither'].includes(head) || /[=!]/.test(head);
}

function _nodeContainsSymbol(node, symbol) {
  if (typeof node === 'string') return node === symbol;
  return Array.isArray(node) && node.some(child => _nodeContainsSymbol(child, symbol));
}

function _escapeIsabelleString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function _isabelleBaseName(raw, fallback = 'x') {
  let base = String(raw || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!base) base = fallback;
  if (/^[0-9]/.test(base)) base = `${fallback}_${base}`;
  return base;
}

function _isabelleTheoryName(raw) {
  const stem = path.basename(String(raw || 'RML_Export')).replace(/\.[^.]*$/, '');
  const parts = stem
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
  let name = parts.length ? parts.join('_') : 'RML_Export';
  name = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Z]/.test(name)) name = `RML_${name}`;
  return name;
}

class IsabelleExportContext {
  constructor(options = {}) {
    this.theoryName = options.theoryName || _isabelleTheoryName(options.outputFile || options.file || 'RML_Export');
    this.sourceFile = options.file || null;
    this.typeNames = new Map();
    this.termNames = new Map();
    this.usedTypeNames = new Map();
    this.usedTermNames = new Map();
    this.typeDecls = [];
    this.typeDeclSet = new Set();
    this.datatypes = [];
    this.datatypeNames = new Set();
    this.datatypeConstructors = new Set();
    this.consts = [];
    this.constNames = new Set();
    this.definitions = [];
    this.definitionNames = new Set();
    this.termTypes = new Map();
  }

  makeUnique(original, base, used) {
    if (used.has(base) && used.get(base) === original) return base;
    let candidate = base;
    let index = 2;
    while (used.has(candidate) && used.get(candidate) !== original) {
      candidate = `${base}_${index}`;
      index++;
    }
    used.set(candidate, original);
    return candidate;
  }

  typeName(name) {
    if (name === 'Prop') return 'bool';
    if (this.typeNames.has(name)) return this.typeNames.get(name);
    const base = `rml_${_isabelleBaseName(name, 'type')}`;
    const unique = this.makeUnique(name, base, this.usedTypeNames);
    this.typeNames.set(name, unique);
    return unique;
  }

  termName(name) {
    if (this.termNames.has(name)) return this.termNames.get(name);
    const base = `rml_${_isabelleBaseName(name, 'term')}`;
    const unique = this.makeUnique(name, base, this.usedTermNames);
    this.termNames.set(name, unique);
    return unique;
  }

  localName(name) {
    let base = _isabelleBaseName(name, 'x');
    if (ISABELLE_RESERVED.has(base)) base = `x_${base}`;
    return base;
  }

  ensureTypedecl(name) {
    if (name === 'Type' || name === 'Prop') return;
    if (!this.typeDeclSet.has(name)) {
      this.typeDeclSet.add(name);
      this.typeDecls.push(name);
    }
  }

  addConst(name, typeNode) {
    if (this.datatypeConstructors.has(name) || this.definitionNames.has(name)) return;
    if (!this.constNames.has(name)) {
      this.constNames.add(name);
      this.consts.push({ name, typeNode });
    }
    this.termTypes.set(name, typeNode);
  }

  addDefinition(name, typeNode, valueNode) {
    if (this.definitionNames.has(name)) {
      throw new IsabelleExportError(`duplicate definition "${name}"`);
    }
    this.definitionNames.add(name);
    this.termTypes.set(name, typeNode);
    this.definitions.push({ name, typeNode, valueNode });
  }

  addDatatype(decl) {
    if (this.datatypeNames.has(decl.name)) {
      throw new IsabelleExportError(`duplicate datatype "${decl.name}"`);
    }
    this.datatypeNames.add(decl.name);
    for (const ctor of decl.constructors) {
      this.datatypeConstructors.add(ctor.name);
      this.termTypes.set(ctor.name, ctor.type);
    }
    this.datatypes.push(decl);
  }

  typeExpr(node) {
    if (typeof node === 'string') {
      if (node === 'Type') {
        throw new IsabelleExportError('universe Type is not an Isabelle/HOL value type', node);
      }
      this.ensureTypedecl(node);
      return this.typeName(node);
    }
    if (!Array.isArray(node)) {
      throw new IsabelleExportError('unsupported type expression', node);
    }
    if (_isUniverseAnnotation(node)) {
      throw new IsabelleExportError('universe levels cannot be exported as HOL value types', node);
    }
    if (node.length === 1 && node[0] === 'Prop') return 'bool';
    if (node.length === 3 && node[0] === 'Pi') {
      const binding = parseBinding(node[1]);
      if (!binding) {
        throw new IsabelleExportError('malformed Pi binder', node);
      }
      if (_nodeContainsSymbol(node[2], binding.paramName)) {
        throw new IsabelleExportError(
          `dependent Pi codomain mentions "${binding.paramName}", which is outside the Isabelle/HOL exporter subset`,
          node,
        );
      }
      const domain = this.typeExpr(binding.paramType);
      const codomain = this.typeExpr(node[2]);
      const left = Array.isArray(binding.paramType) &&
        binding.paramType.length === 3 &&
        binding.paramType[0] === 'Pi'
        ? `(${domain})`
        : domain;
      return `${left} => ${codomain}`;
    }
    throw new IsabelleExportError('unsupported type expression', node);
  }

  inferTermType(node, locals = new Map()) {
    if (typeof node === 'string') {
      if (locals.has(node)) return locals.get(node).typeNode;
      if (this.termTypes.has(node)) return this.termTypes.get(node);
      throw new IsabelleExportError(`cannot infer type of "${node}"`, node);
    }
    if (!Array.isArray(node)) {
      throw new IsabelleExportError('cannot infer type of term', node);
    }
    if (node.length === 3 && node[0] === 'lambda') {
      const binding = parseBinding(node[1]);
      if (!binding) throw new IsabelleExportError('malformed lambda binder', node);
      const nextLocals = new Map(locals);
      nextLocals.set(binding.paramName, {
        typeNode: binding.paramType,
        localName: this.localName(binding.paramName),
      });
      return ['Pi', [binding.paramType, binding.paramName], this.inferTermType(node[2], nextLocals)];
    }
    if (node.length === 3 && node[0] === 'apply') {
      const fnType = this.inferTermType(node[1], locals);
      const flat = _flattenPi(fnType);
      if (!flat || flat.params.length === 0) {
        throw new IsabelleExportError('application head does not have a Pi type', node);
      }
      return _buildPi(flat.params.slice(1), flat.result);
    }
    if (node.length > 0 && typeof node[0] === 'string') {
      const fnType = this.termTypes.get(node[0]);
      const flat = fnType ? _flattenPi(fnType) : null;
      if (flat && flat.params.length >= node.length - 1) {
        return _buildPi(flat.params.slice(node.length - 1), flat.result);
      }
    }
    throw new IsabelleExportError('cannot infer type of term', node);
  }

  termExpr(node, locals = new Map()) {
    if (typeof node === 'string') {
      if (isNum(node)) return node;
      if (locals.has(node)) return locals.get(node).localName;
      return this.termName(node);
    }
    if (!Array.isArray(node)) {
      throw new IsabelleExportError('unsupported term expression', node);
    }
    if (node.length === 3 && node[0] === 'lambda') {
      const binding = parseBinding(node[1]);
      if (!binding) throw new IsabelleExportError('malformed lambda binder', node);
      const localName = this.localName(binding.paramName);
      const nextLocals = new Map(locals);
      nextLocals.set(binding.paramName, { typeNode: binding.paramType, localName });
      return `(%${localName}. ${this.termExpr(node[2], nextLocals)})`;
    }
    if (node.length === 3 && node[0] === 'apply') {
      return `(${this.termExpr(node[1], locals)} ${this.termExpr(node[2], locals)})`;
    }
    if (node.length === 3 && node[1] === '=') {
      return `(${this.termExpr(node[0], locals)} = ${this.termExpr(node[2], locals)})`;
    }
    if (node.length > 0) {
      const parts = node.map(part => this.termExpr(part, locals));
      return `(${parts.join(' ')})`;
    }
    throw new IsabelleExportError('empty term expression', node);
  }

  processDefinition(head, rhs, node) {
    if (head === 'range' || head === 'valence' || _isOperatorHead(head)) {
      throw new IsabelleExportError('probabilistic configuration and operator definitions are outside the Isabelle exporter subset', node);
    }
    if (rhs.length === 1 && isNum(rhs[0])) {
      throw new IsabelleExportError('symbol probability priors are outside the Isabelle exporter subset', node);
    }
    if (_isTypeSelfDeclaration(head, rhs)) {
      if (head !== 'Type') this.ensureTypedecl(head);
      return;
    }
    if (_isTypedSelfDeclaration(head, rhs)) {
      this.addConst(head, rhs[0]);
      return;
    }
    if (rhs.length === 1 && Array.isArray(rhs[0])) {
      this.addConst(head, rhs[0]);
      return;
    }
    if (rhs.length === 3 && rhs[0] === 'lambda') {
      const typeNode = this.inferTermType(rhs);
      this.addDefinition(head, typeNode, rhs);
      return;
    }
    throw new IsabelleExportError('unsupported top-level definition form', node);
  }

  processForm(rawForm) {
    let node = rawForm;
    while (Array.isArray(node) && node.length === 1 && Array.isArray(node[0])) {
      node = node[0];
    }
    if (!Array.isArray(node) || node.length === 0) return;
    if (_isProbabilisticAssignment(node)) {
      throw new IsabelleExportError('probability assignments are outside the Isabelle exporter subset', node);
    }
    if (node[0] === '?' || _isUniverseAnnotation(node)) return;
    if (node[0] === 'inductive') {
      this.addDatatype(parseInductiveForm(node));
      return;
    }
    if (typeof node[0] === 'string' && node[0].endsWith(':')) {
      this.processDefinition(node[0].slice(0, -1), node.slice(1), node);
      return;
    }
    throw new IsabelleExportError('unsupported top-level form', node);
  }

  renderTypedecls() {
    const lines = [];
    for (const name of this.typeDecls) {
      if (this.datatypeNames.has(name)) continue;
      lines.push(`typedecl ${this.typeName(name)}`);
    }
    return lines;
  }

  renderDatatypes() {
    const sections = [];
    for (const decl of this.datatypes) {
      const lines = [`datatype ${this.typeName(decl.name)} =`];
      decl.constructors.forEach((ctor, index) => {
        const args = ctor.params.map(param => this.typeExpr(param.type));
        const rhs = [this.termName(ctor.name), ...args].join(' ');
        lines.push(`  ${index === 0 ? '' : '| '}${rhs}`);
      });
      sections.push(lines.join('\n'));
    }
    return sections;
  }

  renderConsts() {
    const lines = [];
    for (const decl of this.consts) {
      if (this.datatypeConstructors.has(decl.name) || this.definitionNames.has(decl.name)) continue;
      lines.push(`  ${this.termName(decl.name)} :: "${_escapeIsabelleString(this.typeExpr(decl.typeNode))}"`);
    }
    return lines.length ? ['consts', ...lines] : [];
  }

  renderDefinitions() {
    const sections = [];
    for (const decl of this.definitions) {
      const name = this.termName(decl.name);
      const type = _escapeIsabelleString(this.typeExpr(decl.typeNode));
      const body = _escapeIsabelleString(this.termExpr(decl.valueNode));
      sections.push(`definition ${name} :: "${type}" where\n  "${name} = ${body}"`);
    }
    return sections;
  }

  render() {
    const bodySections = [];
    const typedecls = this.renderTypedecls();
    if (typedecls.length) bodySections.push(typedecls.join('\n'));
    const datatypes = this.renderDatatypes();
    bodySections.push(...datatypes);
    const consts = this.renderConsts();
    if (consts.length) bodySections.push(consts.join('\n'));
    bodySections.push(...this.renderDefinitions());

    const lines = [
      `theory ${this.theoryName}`,
      '  imports Main',
      'begin',
      '',
      '(* Generated by RML Isabelle exporter. *)',
    ];
    if (this.sourceFile) {
      lines.push(`(* Source: ${_escapeIsabelleString(this.sourceFile)} *)`);
    }
    if (bodySections.length) {
      lines.push('', bodySections.join('\n\n'));
    }
    lines.push('', 'end', '');
    return lines.join('\n');
  }
}

/**
 * Export the supported typed LiNo fragment to Isabelle/HOL source text.
 */
function exportIsabelle(sourceText, options = {}) {
  const ctx = new IsabelleExportContext(options);
  let forms;
  try {
    forms = parseLinoForms(sourceText);
  } catch (err) {
    throw new IsabelleExportError(`LiNo parse failure: ${err && err.message ? err.message : String(err)}`);
  }
  for (const form of forms) ctx.processForm(form);
  return ctx.render();
}

// ---------- Runner ----------
/**
 * Compatibility wrapper that evaluates LiNo text and returns only query values.
 */
function run(text, options){
  return evaluate(text, options).results;
}

// CLI (runs only when invoked directly, not when imported as a library).
// The REPL subcommand lives in `./rml-repl.mjs` so we can `await import` it
// without triggering an ESM circular-dependency deadlock.
function _printMainUsage() {
  console.error('Usage: rml [--trace] <kb.lino>   |   rml repl   |   rml extract <js|rust> <kb.lino>   |   rml export <lean|rocq|isabelle> <file.lino> [-o <file>] [--theory <Name>]');
}

async function runCli() {
  const argv = process.argv.slice(2);
  let trace = false;
  const positionals = [];
  for (const arg of argv) {
    if (arg === '--trace') trace = true;
    else positionals.push(arg);
  }
  const arg = positionals[0];
  if (!arg) {
    _printMainUsage();
    process.exit(1);
  }
  if (arg === 'extract') {
    const target = positionals[1];
    const file = positionals[2];
    if (!target || !file) {
      console.error('Usage: rml extract <js|rust> <kb.lino>');
      process.exit(1);
    }
    const text = fs.readFileSync(file, 'utf8');
    try {
      process.stdout.write(extractProgram(text, target));
      process.stdout.write('\n');
    } catch (err) {
      console.error(err && err.message ? err.message : String(err));
      process.exit(1);
    }
    return;
  }
  if (arg === 'export') {
    const status = await runExportCli(positionals.slice(1));
    process.exit(status);
  }
  if (arg === 'repl') {
    const replUrl = new URL('./rml-repl.mjs', import.meta.url).href;
    const { runRepl } = await import(replUrl);
    await runRepl();
    return;
  }
  const text = fs.readFileSync(arg, 'utf8');
  const out = evaluate(text, { file: arg, trace });
  if (trace && out.trace) {
    for (const event of out.trace) {
      console.error(formatTraceEvent(event));
    }
  }
  for (const v of out.results) {
    if (typeof v === 'string') {
      console.log(v);
    } else {
      console.log(String(+v.toFixed(6)).replace(/\.0+$/,''));
    }
  }
  for (const diag of out.diagnostics) {
    console.error(formatDiagnostic(diag, text));
  }
  if (out.diagnostics.length > 0) process.exit(1);
}

async function runExportCli(args) {
  const [target, input] = args;
  if (args.length < 2 || (target !== 'lean' && target !== 'rocq' && target !== 'isabelle')) {
    console.error('Usage: rml export <lean|rocq|isabelle> <file.lino> [-o <file>] [--theory <Name>]');
    return 2;
  }
  let output = null;
  let theoryName = null;
  for (let i = 2; i < args.length; i++) {
    if ((args[i] === '-o' || args[i] === '--output') && i + 1 < args.length) {
      output = args[i + 1];
      i++;
      continue;
    }
    if (target === 'isabelle' && args[i] === '--theory' && i + 1 < args.length) {
      theoryName = args[i + 1];
      i++;
      continue;
    }
    console.error(`Unknown export option: ${args[i]}`);
    console.error(`Usage: rml export ${target} <file.lino> [-o <file>]${target === 'isabelle' ? ' [--theory <Name>]' : ''}`);
    return 2;
  }
  if (target === 'lean' && !output) {
    console.error('Usage: rml export lean <file.lino> -o <file.lean>');
    return 2;
  }
  let text;
  try {
    text = fs.readFileSync(input, 'utf8');
  } catch (err) {
    console.error(`Error reading ${input}: ${err.message}`);
    return 1;
  }
  let rendered;
  if (target === 'lean') {
    const { exportLean } = await import(new URL('./lean-export.mjs', import.meta.url).href);
    const out = exportLean(text, { file: input });
    if (out.diagnostics.length > 0) {
      for (const diag of out.diagnostics) {
        console.error(formatDiagnostic(diag, text));
      }
      return 1;
    }
    rendered = out.source;
  } else if (target === 'rocq') {
    const { exportRocq } = await import(new URL('./rml-rocq.mjs', import.meta.url).href);
    rendered = exportRocq(text, { sourcePath: input });
  } else {
    rendered = exportIsabelle(text, {
      file: input,
      outputFile: output,
      theoryName: theoryName || _isabelleTheoryName(output || input),
    });
  }
  try {
    if (output) fs.writeFileSync(output, rendered, 'utf8');
    else process.stdout.write(rendered);
  } catch (err) {
    console.error(`Error writing ${output}: ${err.message}`);
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

export {
  run,
  evaluate,
  evaluateFile,
  Diagnostic,
  RmlError,
  TraceEvent,
  formatDiagnostic,
  formatTraceEvent,
  computeFormSpans,
  extractLiterateLino,
  parseLino,
  tokenizeOne,
  parseOne,
  Env,
  evalNode,
  buildProof,
  runTactics,
  rewrite,
  simplify,
  goalToTptp,
  parseAtpStatus,
  quantize,
  decRound,
  keyOf,
  isNum,
  isStructurallySame,
  isConvertible,
  whnf,
  nf,
  parseBinding,
  parseBindings,
  subst,
  substitute,
  synth,
  check,
  isTotal,
  isTerminating,
  parseDefineForm,
  isCovered,
  parseInductiveForm,
  buildEliminatorType,
  parseCoinductiveForm,
  buildCorecursorType,
  automaticSequencesDomainPlugin,
  decideAutomaticSequenceTheorem,
  formalizeSelectedInterpretation,
  evaluateFormalization,
  extractProgram,
  exportIsabelle,
  parseModeFlag,
  parseRootConstructForm,
  parseFoundationForm,
  formatFoundationReport,
  parseRuleForm,
  parseProofAssumptionForm,
  parseProofObjectForm,
  matchProofPattern,
  checkProofObject,
  parseStrictFoundationForm,
  parseAllowHostPrimitiveForm,
  scanPureLinksOffenders,
  buildDependencyGraph,
  encodeAnum,
  decodeAnum,
};
