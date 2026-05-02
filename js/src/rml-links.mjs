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
import { Parser } from 'links-notation';

// ---------- Structured Diagnostics ----------
// Every parser/evaluator error is reported as a `Diagnostic` with an error
// code, human-readable message, and source span (file/line/col, 1-based).
// See `docs/DIAGNOSTICS.md` for the full code list.
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
class Env {
  constructor(options){
    const opts = options || {};
    this.terms = new Set();                     // declared terms (via (x: x is x))
    this.assign = new Map();                    // key(expr) -> truth value
    this.symbolProb = new Map();                // optional symbol priors if you want (x: 0.7)
    this.types = new Map();                     // key(expr) -> type expression (as string)
    this.lambdas = new Map();                   // name -> { param, paramType, body } for named lambdas
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

    // Initialize truth constants: true, false, unknown, undefined
    // These are predefined symbol probabilities based on the current range.
    // By default: (false: min(range)), (true: max(range)),
    //             (unknown: mid(range)), (undefined: mid(range))
    // They can be redefined by the user via (true: <value>), (false: <value>), etc.
    this._initTruthConstants();
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

  setExprProb(exprNode, p){
    this.assign.set(keyOf(exprNode), this.clamp(p));
  }
  setType(exprNode, typeExpr){
    const key = typeof exprNode === 'string' ? exprNode : keyOf(exprNode);
    this.types.set(key, typeof typeExpr === 'string' ? typeExpr : keyOf(typeExpr));
  }
  getType(exprNode){
    const key = typeof exprNode === 'string' ? exprNode : keyOf(exprNode);
    return this.types.get(key) || null;
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
        this.lambdas.has(qualified)
      ) {
        return qualified;
      }
    }
    return name;
  }
}

// ---------- Binding parser ----------
// Parse a binding form in two supported syntaxes:
// 1. Colon form: (x: A) as ['x:', A] — standard LiNo link definition syntax
// 2. Prefix type form: (A x) as ['A', 'x'] — type-first notation for lambda/Pi bindings
//    e.g. (Natural x), used in (lambda (Natural x) body)
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
  'namespace', 'import', 'as', 'is', '?',
  '+', '-', '*', '/', '=', '!=', 'and', 'or', 'not', 'both', 'neither', 'nor',
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
    env.ops.has(name)
  ) {
    return true;
  }
  const resolved = env._resolveQualified(name);
  return resolved !== name && (
    env.symbolProb.has(resolved) ||
    env.terms.has(resolved) ||
    env.types.has(resolved) ||
    env.lambdas.has(resolved) ||
    env.ops.has(resolved)
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
    const kPrefix = keyOf(['=', L, R]);
    const kInfix = keyOf([L, '=', R]);
    let rule;
    if (env.assign.has(kPrefix) || env.assign.has(kInfix)) {
      rule = node[1] === '!=' ? 'assigned-inequality' : 'assigned-equality';
    } else if (isStructurallySame(L, R)) {
      rule = node[1] === '!=' ? 'structural-inequality' : 'structural-equality';
    } else {
      rule = node[1] === '!=' ? 'numeric-inequality' : 'numeric-equality';
    }
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

function evalReducedTerm(reduced, env) {
  const term = evalTermNode(reduced, env);
  if (hasUnresolvedFreeVariables(term, env)) return { term };
  return evalNode(term, env);
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

function evalNode(node, env){
  if (typeof node === 'string') {
    if (isNum(node)) return env.toNum(node);
    // bare symbol → optional prior probability if set; otherwise irrelevant in calc
    return env.getSymbolProb(node);
  }

  // Definitions & operator redefs:  (head: ...)
  if (typeof node[0] === 'string' && node[0].endsWith(':')) {
    const head = node[0].slice(0,-1);
    return defineForm(head, node.slice(1), env);
  }
  // Note: (x : A) with spaces as a standalone colon separator is NOT supported.
  // Use (x: A) instead — the colon must be part of the link name.

  // Assignment: ((expr) has probability p)
  if (node.length === 4 && node[1] === 'has' && node[2] === 'probability' && isNum(node[3])) {
    const p = parseFloat(node[3]);
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
    const op = env.getOp(node[1]);
    const leftTerm = evalTermNode(node[0], env);
    const rightTerm = evalTermNode(node[2], env);
    // Equality checks assigned probability first, then structural equality,
    // then falls back to numeric comparison of evaluated values (decimal-precision)
    const raw = op(leftTerm, rightTerm, keyOf);
    // If structural/assigned equality already gave a definitive answer, use it
    if (raw === env.hi || raw === env.lo) {
      // Check if there's an explicit assignment — if so, trust it
      const kPrefix = keyOf(['=',leftTerm,rightTerm]);
      const kInfix = keyOf([leftTerm,'=',rightTerm]);
      if (env.assign.has(kPrefix) || env.assign.has(kInfix) || isStructurallySame(leftTerm, rightTerm)) {
        return env.clamp(raw);
      }
      // No explicit assignment and not structurally same — try numeric comparison
      const L = evalArith(leftTerm, env);
      const R = evalArith(rightTerm, env);
      const numEq = decRound(L) === decRound(R) ? env.hi : env.lo;
      if (node[1] === '!=') return env.clamp(env.getOp('not')(numEq));
      return env.clamp(numEq);
    }
    return env.clamp(raw);
  }

  // ---------- Type System: "everything is a link" ----------

  // Type universe: (Type N) — the sort at universe level N
  if (node.length === 2 && node[0] === 'Type') {
    const level = isNum(node[1]) ? parseInt(node[1], 10) : 0;
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
    const typeStr = env.getType(expr);
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
    const actualType = env.getType(expr);
    if (actualType) {
      const expectedKey = typeof expectedType === 'string' ? expectedType : keyOf(expectedType);
      return actualType === expectedKey ? env.hi : env.lo;
    }
    return env.lo;
  }

  // Prefix: (not X), (and X Y ...), (or X Y ...)
  const [head, ...args] = node;
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

// ---------- Public LiNo helpers ----------
function stripLinoComments(text) {
  return text
    .replace(/^[ \t]*#.*$/gm, '')          // full-line comments
    .replace(/(\)[ \t]+)#.*$/gm, '$1')     // inline comments after closing paren
    .replace(/\n{3,}/g, '\n\n');
}

function parseLino(text) {
  const parser = new Parser();
  return parser.parse(stripLinoComments(text)).map(link => String(link));
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
      return parseOne(toks);
    });
}

// Compute (line, col) source positions for every top-level link in `text`.
// A "top-level link" is a parenthesized form that is not nested inside another;
// position is reported as 1-based line and column of its opening `(`.
// Lines starting with `#` are treated as full-line comments and ignored, just
// like `stripLinoComments` does. Inline `# ...` comments that follow a closing
// paren (matching `(\)[ \t]+)#.*$` in `stripLinoComments`) are also skipped so
// parens inside the comment don't disturb the depth counter.
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
function evaluate(code, options) {
  const opts = options || {};
  const file = opts.file || null;
  const sourceText = String(code);
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
    return out;
  }

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

    try {
      const res = evalNode(form, env);
      if (traceEnabled) {
        const formKey = keyOf(form);
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
        const wantsProof = proofsEnabled || _queryRequestsProof(form);
        if (wantsProof) {
          if (proofs === null) {
            // Backfill nulls for any prior bare queries so indexes align.
            proofs = results.slice(0, -1).map(() => null);
          }
          // Strip the surrounding (? ...) so the proof attaches to the
          // queried expression directly; this matches the issue example
          // `(by structural-equality (a a))` rather than nesting under
          // `(by query ...)`.
          const inner = _stripWithProof(form.slice(1));
          const target = inner.length === 1 ? inner[0] : inner;
          proofs.push(buildProof(target, env));
        } else if (proofs !== null) {
          proofs.push(null);
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

// ---------- Runner ----------
function run(text, options){
  const forms = parseLinoForms(text);

  const env = new Env(options);
  const outs = [];
  for (let form of forms) {
    // Unwrap single-element arrays (LiNo wraps everything in outer parens)
    while (Array.isArray(form) && form.length === 1 && Array.isArray(form[0])) {
      form = form[0];
    }
    const res = evalNode(form, env);
    if (res && res.query) {
      if (res.typeQuery) {
        // Type queries return string results
        outs.push(res.value);
      } else {
        outs.push(res.value);
      }
    }
  }
  return outs;
}

// CLI (runs only when invoked directly, not when imported as a library).
// The REPL subcommand lives in `./rml-repl.mjs` so we can `await import` it
// without triggering an ESM circular-dependency deadlock.
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
    console.error('Usage: rml [--trace] <kb.lino>   |   rml repl');
    process.exit(1);
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
  parseLino,
  tokenizeOne,
  parseOne,
  Env,
  evalNode,
  buildProof,
  quantize,
  decRound,
  keyOf,
  isNum,
  isStructurallySame,
  parseBinding,
  parseBindings,
  subst,
  substitute,
  formalizeSelectedInterpretation,
  evaluateFormalization,
};
