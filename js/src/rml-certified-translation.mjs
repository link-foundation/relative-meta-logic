/** Certified JavaScript/Rust/Lean/Rocq translation through a checked RML links network.
 *
 * Pipeline: original source (kept byte-exact, hashed) -> temporarily vendored
 * meta-language PR #201 frontend and checker -> source-free typed program links
 * -> the registered RML structure network -> vendored target emitter. Every
 * translation yields a translation certificate written as Links; every refusal
 * yields a first-refusal receipt that keeps the source and names the loss.
 *
 * Authority boundary: RML re-derives and checks certificates itself. Closed
 * ground propositions are discharged by RML's own evaluation of the certified
 * intermediate program. Lean/Rocq kernels, rustc and Node are native-validity
 * oracles that CI runs; their acceptance is never imported as an RML proof, and
 * universal theorems remain open obligations here. The vendored frontends and
 * emitters are trusted host code, recorded as the open `emitter-faithfulness`
 * obligation rather than hidden.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LinkId, LinkNetwork } from '#meta-language';
import { attachRmlStructure, emitRmlFromStructure, rmlStructuredDocument } from './rml-meta-structure.mjs';
import { lowerSurface } from './rml-surface-lowering.mjs';
import { TranslationError } from '#meta-language-pr201/translation/diagnostics.js';
import { checkProgram } from '#meta-language-pr201/translation/check.js';
import { parseJavaScript } from '#meta-language-pr201/translation/javascript.js';
import { parseRust } from '#meta-language-pr201/translation/rust.js';
import { parseLean } from '#meta-language-pr201/translation/lean.js';
import { parseRocq } from '#meta-language-pr201/translation/rocq.js';
import { emitJavaScript } from '#meta-language-pr201/translation/emit-javascript.js';
import { emitRust } from '#meta-language-pr201/translation/emit-rust.js';
import { emitLean } from '#meta-language-pr201/translation/emit-lean.js';
import { emitRocq } from '#meta-language-pr201/translation/emit-rocq.js';
import { decodeTypedProgramLinks, encodeTypedProgramLinks, TYPED_PROGRAM_LINKS_SCHEMA } from '#meta-language-pr201/typed-program-links.js';

export const CERTIFIED_TRANSLATION_SCHEMA = 'rml:translation-certificate:1';
export const TRANSLATION_REFUSAL_SCHEMA = 'rml:translation-refusal:1';
export const TRANSLATION_RECEIPT_SCHEMA = 'rml:translation-producer-receipt:1';
export const CERTIFIED_LANGUAGES = Object.freeze(['JavaScript', 'Rust', 'Lean', 'Rocq']);
export const CERTIFIED_EXTENSIONS = Object.freeze({ JavaScript: 'js', Rust: 'rs', Lean: 'lean', Rocq: 'v' });
/** The seven preservation dimensions every certificate must declare (R107). */
export const PRESERVATION_DIMENSIONS = Object.freeze(['behavior', 'effects', 'ownership', 'types', 'universes', 'assumptions', 'proof-obligations']);
/** Grants a certificate may carry. Anything else is rejected (R165: no implicit authority). */
export const CERTIFIED_AUTHORITY = Object.freeze([['macros', 'none'], ['traits', 'none'], ['runtime', 'none'],
  ['external-kernels', 'oracle-only'], ['proof-authority', 'rml']]);

const FRONTENDS = { JavaScript: parseJavaScript, Rust: parseRust, Lean: parseLean, Rocq: parseRocq };
const EMITTERS = { JavaScript: emitJavaScript, Rust: emitRust, Lean: emitLean, Rocq: emitRocq };
const VENDOR = new URL('../vendor/meta-language-pr201/', import.meta.url);
const encoder = new TextEncoder();
const sha256 = value => createHash('sha256').update(typeof value === 'string' ? encoder.encode(value) : value).digest('hex');

/** The pinned vendored translator identity: upstream commit plus the hash of its file lock. */
export function vendoredTranslatorIdentity({ root = VENDOR } = {}) {
  const lockBytes = readFileSync(new URL('upstream-files.json', root));
  const lock = JSON.parse(lockBytes.toString('utf8'));
  return Object.freeze({ upstream: lock.repository, pullRequest: lock.pullRequest, commit: lock.commit,
    license: lock.license, lockSha256: sha256(lockBytes), files: lock.files });
}

/** Recompute every vendored file hash against the lock; shims are local and listed separately. */
export function verifyVendoredMetaLanguage({ root = VENDOR } = {}) {
  const identity = vendoredTranslatorIdentity({ root });
  const mismatches = [];
  for (const file of identity.files) {
    if (file.shim) continue;
    let bytes;
    try { bytes = readFileSync(new URL(file.path, root)); } catch { mismatches.push({ path: file.path, reason: 'missing' }); continue; }
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) mismatches.push({ path: file.path, reason: 'hash-mismatch' });
  }
  return { ok: mismatches.length === 0, commit: identity.commit, checked: identity.files.filter(file => !file.shim).length,
    shims: identity.files.filter(file => file.shim).map(file => file.path), mismatches };
}

function requireLanguage(language, role) {
  if (!CERTIFIED_LANGUAGES.includes(language)) throw new Error(`Unsupported ${role} language ${language}; expected ${CERTIFIED_LANGUAGES.join(', ')}`);
  return language;
}

function sourceFingerprint(text, language) {
  return { language, sha256: sha256(text), bytes: encoder.encode(text).length, utf16: text.length };
}

function spanRecord(text, span) {
  if (!span || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)) return null;
  const start = Math.max(0, Math.min(span.start, text.length)); const end = Math.max(start, Math.min(span.end, text.length));
  return { start, end, byteStart: encoder.encode(text.slice(0, start)).length, byteEnd: encoder.encode(text.slice(0, end)).length,
    sha256: sha256(text.slice(start, end)) };
}

class RefusalSignal extends Error {
  constructor(stage, error) { super(error.message); this.stage = stage; this.cause = error; }
}

function stage(name, run) {
  try { return run(); } catch (error) {
    if (error instanceof TranslationError || (name === 'archive-validation' && error instanceof TypeError)) throw new RefusalSignal(name, error);
    throw error;
  }
}

/** Import source into the checked intermediate and its RML structure network, or refuse with a receipt. */
export function importCertifiedSource(source, language) {
  requireLanguage(language, 'source');
  const text = String(source);
  const fingerprint = sourceFingerprint(text, language);
  // Frontend spans are in lowered coordinates until mapped back; lowering spans are already original.
  let lowered = null;
  try {
    lowered = stage('rml-lowering', () => lowerSurface(text, language));
    const surface = stage('frontend', () => FRONTENDS[language](lowered.text));
    const program = stage('checker', () => checkProgram(surface));
    const archive = stage('archive-validation', () => encodeTypedProgramLinks(program));
    const intermediate = archive.network.toLino();
    const rmlNetwork = new LinkNetwork();
    attachRmlStructure(rmlNetwork, intermediate);
    rmlStructuredDocument(rmlNetwork);
    const emitted = emitRmlFromStructure(rmlNetwork);
    if (emitted !== intermediate) throw new Error('RML structure did not reproduce the typed program links exactly');
    return { status: 'imported', source: fingerprint, sourceText: text, rmlNetwork, root: archive.root.asU64(),
      lowering: lowered.changed ? { schema: lowered.schema, sha256: sha256(lowered.text), rewrites: lowered.rewrites } : null,
      mapSpan: lowered.map,
      intermediate: { schema: TYPED_PROGRAM_LINKS_SCHEMA.language, schemaVersion: TYPED_PROGRAM_LINKS_SCHEMA.schemaVersion,
        root: archive.root.asU64(), links: archive.network.links().length, sha256: sha256(emitted) } };
  } catch (error) {
    if (!(error instanceof RefusalSignal)) throw error;
    const span = error.stage === 'rml-lowering' || !lowered ? error.cause.span : lowered.map(error.cause.span);
    return { status: 'refused', source: fingerprint, sourceText: text, stage: error.stage, diagnostic: {
      kind: error.cause.kind ?? 'invalid-archive', message: error.cause.reason ?? error.cause.message,
      span: spanRecord(text, span) } };
  }
}

/** The certificate section recording every RML surface rewrite, with original spans; absent when nothing was lowered. */
function loweringForm(result) {
  if (!result.lowering) return [];
  return [['lowering', ['schema', result.lowering.schema], ['lowered-sha256', result.lowering.sha256], ['count', String(result.lowering.rewrites.length)],
    ...result.lowering.rewrites.map(rewrite => {
      const span = spanRecord(result.sourceText, rewrite);
      return ['rewrite', ['kind', rewrite.kind], ['subject', rewrite.subject], ['span', String(span.start), String(span.end)],
        ['bytes', String(span.byteStart), String(span.byteEnd)], ['span-sha256', span.sha256]];
    })]];
}

/** Decode the certified program solely from the RML structure network; no source buffer is consulted. */
export function decodeCertifiedIntermediate(rmlNetwork, root) {
  const network = LinkNetwork.fromLino(emitRmlFromStructure(rmlNetwork));
  return decodeTypedProgramLinks(network, LinkId.fromU64(root));
}

/** Rebuild an RML structure network from its exported Links text (structured import). */
export function importCertifiedIntermediate(lino) {
  const network = new LinkNetwork();
  attachRmlStructure(network, String(lino));
  rmlStructuredDocument(network);
  return network;
}

export function exportCertifiedIntermediate(rmlNetwork) { return emitRmlFromStructure(rmlNetwork); }

// ---------------------------------------------------------------------------
// RML-native evaluation of the certified intermediate program.

class Abort extends Error { constructor(reason) { super(reason); this.reason = reason; } }
class Unsupported extends Error {}
class Exhausted extends Error {}

function fixedRange(type) {
  const bits = BigInt(type.bits);
  return type.signed ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] : [0n, (1n << bits) - 1n];
}

function integerDivision(left, right, rounding, op) {
  let quotient = left / right; // BigInt truncates toward zero
  if (rounding === 'floor' && (left % right !== 0n) && ((left < 0n) !== (right < 0n))) quotient -= 1n;
  if (rounding === 'euclid') { const remainder = left - quotient * right; if (remainder < 0n) quotient += right > 0n ? -1n : 1n; }
  return op === 'div' ? quotient : left - quotient * right;
}

function show(value, console) {
  if (typeof value === 'bigint' || typeof value === 'string') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return console && Object.is(value, -0) ? '-0' : String(value);
  throw new Unsupported('text of a non-scalar value');
}

/** Evaluate main's effects and closed propositions with explicit fuel; never claims more than it ran. */
export class CertifiedEvaluator {
  constructor(program, { fuel = 2_000_000, depth = 4000 } = {}) {
    this.program = program; this.fuel = fuel; this.depthLimit = depth; this.depth = 0; this.constants = new Map();
  }
  tick() { if (--this.fuel < 0) throw new Exhausted('evaluation fuel exhausted'); }
  call(name, args) {
    const declaration = this.program.declarations.get(name);
    if (!declaration) throw new Unsupported(`call of undeclared ${name}`);
    if (declaration.k === 'const') {
      if (!this.constants.has(name)) this.constants.set(name, this.expr(declaration.value, new Map()));
      return this.constants.get(name);
    }
    if (declaration.k !== 'fn' || declaration.params.length !== args.length) throw new Unsupported(`call of ${declaration.k} ${name}`);
    if (++this.depth > this.depthLimit) throw new Exhausted('evaluation depth exhausted');
    try { return this.expr(declaration.body, new Map(declaration.params.map((parameter, index) => [parameter.name, args[index]]))); }
    finally { this.depth -= 1; }
  }
  match(pattern, value, environment) {
    if (pattern.k === 'wild') return true;
    if (pattern.k === 'bind') { environment.set(pattern.name, value); return true; }
    if (pattern.k === 'natZero') return value === 0n;
    if (pattern.k === 'natSucc') { if (value === 0n) return false; environment.set(pattern.name, value - 1n); return true; }
    if (pattern.k === 'ctor') {
      if (!value || value.ctor !== pattern.ctor || value.data !== pattern.data) return false;
      pattern.binds.forEach((name, index) => { if (name !== null) environment.set(name, value.fields[index]); });
      return true;
    }
    throw new Unsupported(`${pattern.k} pattern`);
  }
  expr(node, environment) {
    this.tick();
    switch (node.k) {
      case 'lit': {
        const kind = node.type.kind;
        if (['nat', 'int', 'fixed'].includes(kind)) return BigInt(node.value);
        if (kind === 'float') return Number(node.value);
        if (kind === 'bool') return node.value === true || node.value === 'true';
        if (kind === 'string') return String(node.value);
        throw new Unsupported(`${kind} literal`);
      }
      case 'var':
        if (!environment.has(node.name)) return this.call(node.name, []);
        return environment.get(node.name);
      case 'call': return this.call(node.fn, node.args.map(arg => this.expr(arg, environment)));
      case 'ctor': return Object.freeze({ data: node.data, ctor: node.ctor, fields: node.args.map(arg => this.expr(arg, environment)) });
      case 'if': return this.expr(this.expr(node.cond, environment) ? node.then : node.else, environment);
      case 'let': return this.expr(node.body, new Map(environment).set(node.name, this.expr(node.value, environment)));
      case 'toString': return show(this.expr(node.arg, environment), node.console === true);
      case 'match': {
        const value = this.expr(node.scrutinee, environment);
        for (const kase of node.cases) {
          const inner = new Map(environment);
          if (this.match(kase.pattern, value, inner)) return this.expr(kase.body, inner);
        }
        throw new Abort('no match case applies');
      }
      case 'unary': {
        const value = this.expr(node.arg, environment);
        if (node.op === 'not') return !value;
        if (node.op === 'neg') return this.checked(node.type, -value, node.semantics);
        throw new Unsupported(`unary ${node.op}`);
      }
      case 'binary': return this.binary(node, environment);
      default: throw new Unsupported(`${node.k} expression`);
    }
  }
  checked(type, value, semantics) {
    if (semantics === 'checked' && type?.kind === 'fixed') {
      const [low, high] = fixedRange(type);
      if (value < low || value > high) throw new Abort('integer overflow');
    }
    return value;
  }
  binary(node, environment) {
    const { op } = node;
    if (op === 'and') return this.expr(node.left, environment) ? this.expr(node.right, environment) : false;
    if (op === 'or') return this.expr(node.left, environment) ? true : this.expr(node.right, environment);
    const left = this.expr(node.left, environment); const right = this.expr(node.right, environment);
    if (op === 'concat') return String(left) + String(right);
    if (['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(op)) {
      if (typeof left === 'object' || typeof right === 'object') throw new Unsupported('structural comparison of data');
      return { eq: left === right, ne: left !== right, lt: left < right, le: left <= right, gt: left > right, ge: left >= right }[op];
    }
    if (typeof left === 'number') {
      return { add: left + right, sub: left - right, mul: left * right, div: left / right, rem: left % right }[op];
    }
    if (typeof left !== 'bigint' || typeof right !== 'bigint') throw new Unsupported(`${op} on non-numeric values`);
    const type = node.type;
    if (op === 'add') return this.checked(type, left + right, node.semantics);
    if (op === 'mul') return this.checked(type, left * right, node.semantics);
    if (op === 'sub') {
      const value = left - right;
      if (node.semantics === 'truncated') return value < 0n ? 0n : value;
      if (type?.kind === 'nat' && value < 0n) throw new Abort('natural subtraction below zero');
      return this.checked(type, value, node.semantics);
    }
    if (op === 'div' || op === 'rem') {
      if (right === 0n) {
        if (node.byZero === 'total') return op === 'div' ? 0n : left;
        throw new Abort('division by zero');
      }
      return this.checked(type, integerDivision(left, right, node.rounding ?? 'trunc', op), node.semantics);
    }
    throw new Unsupported(`binary ${op}`);
  }
  prop(node, environment = new Map()) {
    this.tick();
    switch (node.p) {
      case 'eq': case 'ne': case 'lt': case 'le': case 'gt': case 'ge': {
        const left = this.expr(node.left, environment); const right = this.expr(node.right, environment);
        if (typeof left === 'object' || typeof right === 'object') throw new Unsupported('structural proposition over data');
        if (node.sameValue && node.p === 'eq') return Object.is(left, right);
        return { eq: left === right, ne: left !== right, lt: left < right, le: left <= right, gt: left > right, ge: left >= right }[node.p];
      }
      case 'and': return this.prop(node.left, environment) && this.prop(node.right, environment);
      case 'or': return this.prop(node.left, environment) || this.prop(node.right, environment);
      case 'implies': return !this.prop(node.left, environment) || this.prop(node.right, environment);
      case 'not': return !this.prop(node.arg, environment);
      case 'bool': return Boolean(this.expr(node.expr, environment));
      default: throw new Unsupported(`${node.p} proposition`);
    }
  }
  run() {
    const lines = []; const environment = new Map();
    try {
      for (const effect of this.program.main?.effects ?? []) {
        if (effect.k === 'print') lines.push(this.expr(effect.expr, environment));
        else if (effect.k === 'let') environment.set(effect.name, this.expr(effect.value, environment));
        else if (effect.k === 'assert') { if (!this.prop(effect.prop, environment)) throw new Abort('assertion failed'); }
        else throw new Unsupported(`${effect.k} effect`);
      }
      return { status: 'completed', lines };
    } catch (error) {
      if (error instanceof Abort) return { status: 'aborted', lines, reason: error.reason };
      if (error instanceof Unsupported) return { status: 'unsupported', lines: [], reason: error.message };
      if (error instanceof Exhausted) return { status: 'exhausted', lines: [], reason: error.message };
      throw error;
    }
  }
}

/** RML-native observation: the lines main prints from the certified intermediate. */
export function observeCertifiedProgram(program, options) { return new CertifiedEvaluator(program, options).run(); }

/** Discharge a closed theorem by RML evaluation; universal theorems are never discharged here. */
export function dischargeClosedTheorem(program, theorem, options) {
  if (theorem.binders.length) return { status: 'open', reason: 'universally quantified; no RML proof term is constructed' };
  const evaluator = new CertifiedEvaluator(program, options);
  try { return evaluator.prop(theorem.prop) ? { status: 'discharged' } : { status: 'refuted' }; } catch (error) {
    if (error instanceof Abort || error instanceof Unsupported || error instanceof Exhausted) return { status: 'open', reason: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Certificates as Links.

function typeText(type) {
  if (!type || typeof type !== 'object') return 'unknown';
  if (type.kind === 'data') return type.name;
  if (type.kind === 'fixed') return `${type.signed ? 'i' : 'u'}${type.bits}`;
  if (['array', 'option', 'set', 'cell'].includes(type.kind)) return `${type.kind}<${typeText(type.element)}>`;
  if (type.kind === 'tuple') return `(${type.elements.map(typeText).join(', ')})`;
  if (type.kind === 'function') return `(${type.params.map(typeText).join(', ')}) -> ${typeText(type.ret)}`;
  return type.kind;
}

function signature(declaration, mapping) {
  if (!declaration) return mapping.kind;
  if (declaration.k === 'fn') return `(${declaration.params.map(parameter => typeText(parameter.type)).join(', ')}) -> ${typeText(declaration.ret)}`;
  if (declaration.k === 'data') return declaration.ctors.map(ctor => `${ctor.name}(${ctor.fields.map(field => typeText(field.type)).join(', ')})`).join(' | ');
  if (declaration.k === 'theorem') return `theorem/${declaration.binders.length}`;
  if (declaration.k === 'const') return typeText(declaration.type ?? declaration.value?.type);
  return declaration.k;
}

function constructorSignature(program, name) {
  for (const declaration of program.declarations.values()) {
    if (declaration.k !== 'data') continue;
    const ctor = declaration.ctors.find(candidate => `${declaration.fullName}.${candidate.name}` === name);
    if (ctor) return `${ctor.fields.map(field => typeText(field.type)).join(' -> ')}${ctor.fields.length ? ' -> ' : ''}${declaration.fullName}`;
  }
  return 'constructor';
}

// Termination evidence. RML re-derives recursion from the decoded intermediate
// itself: a function is recursive when it calls itself or lies on a call cycle.
// A directly recursive function outside any cycle terminates when every self
// call passes, at one fixed parameter position, a variable bound by a
// constructor or successor pattern of a match on that parameter (or on a
// subterm of it); the archive's `decreasing` claim must name the same
// position. Everything else (general and mutual recursion) stays open.

function calledFunctions(expr, found = []) {
  if (!expr || typeof expr !== 'object') return found;
  if (Array.isArray(expr)) { for (const item of expr) calledFunctions(item, found); return found; }
  if (expr.k === 'call' && typeof expr.fn === 'string') found.push(expr.fn);
  for (const [key, value] of Object.entries(expr)) {
    if (key === 'type' || key === 'domain' || key === 'from' || key === 'to' || key === 'span') continue;
    if (value && typeof value === 'object') calledFunctions(value, found);
  }
  return found;
}

function structurallyDecreases(expr, fn, index, name, subterms) {
  if (!expr || typeof expr !== 'object') return true;
  if (Array.isArray(expr)) return expr.every(item => structurallyDecreases(item, fn, index, name, subterms));
  if (expr.k === 'call' && expr.fn === fn) {
    const argument = expr.args?.[index];
    if (!(argument?.k === 'var' && subterms.has(argument.name))) return false;
  }
  if (expr.k === 'match') {
    if (!structurallyDecreases(expr.scrutinee, fn, index, name, subterms)) return false;
    const onParameter = expr.scrutinee?.k === 'var' && (expr.scrutinee.name === name || subterms.has(expr.scrutinee.name));
    return (expr.cases ?? []).every(kase => {
      const inner = new Set(subterms);
      if (onParameter && kase.pattern?.k === 'natSucc') inner.add(kase.pattern.name);
      if (onParameter && kase.pattern?.k === 'ctor') for (const bind of kase.pattern.binds ?? []) if (bind) inner.add(bind);
      return structurallyDecreases(kase.body, fn, index, name, inner);
    });
  }
  if (expr.k === 'let') {
    if (!structurallyDecreases(expr.value, fn, index, name, subterms)) return false;
    const inner = new Set(subterms); inner.delete(expr.name);
    if (expr.value?.k === 'var' && subterms.has(expr.value.name)) inner.add(expr.name);
    return structurallyDecreases(expr.body, fn, index, name, inner);
  }
  for (const [key, value] of Object.entries(expr)) {
    if (key === 'type' || key === 'domain' || key === 'from' || key === 'to' || key === 'span') continue;
    if (value && typeof value === 'object' && !structurallyDecreases(value, fn, index, name, subterms)) return false;
  }
  return true;
}

function terminationObligations(program) {
  const functions = [...program.declarations.values()].filter(declaration => declaration.k === 'fn');
  const graph = new Map(functions.map(declaration => [declaration.fullName, new Set(calledFunctions(declaration.body))]));
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(graph.get(from) ?? [])].some(next => reaches(next, to, seen));
  };
  const obligations = [];
  for (const declaration of functions) {
    const name = declaration.fullName;
    const direct = graph.get(name).has(name);
    const cycle = [...graph.get(name)].some(next => next !== name && graph.has(next) && reaches(next, name));
    if (!direct && !cycle) continue;
    const index = !cycle ? declaration.params.findIndex((parameter, position) => structurallyDecreases(declaration.body, name, position, parameter.name, new Set())) : -1;
    const discharged = index >= 0 && declaration.decreasing === index;
    obligations.push({ id: `termination:${name}`, kind: 'termination', source: name,
      target: discharged ? `structural:${declaration.params[index].name}` : cycle ? 'mutual-recursion' : 'general-recursion',
      closed: 'true', status: discharged ? 'discharged' : 'open', by: discharged ? 'rml-structural-decrease' : 'unproved-general-recursion' });
  }
  return obligations;
}

function preservation(sourceLanguage, targetLanguage, observation, obligations, assumptions, program) {
  const pair = [sourceLanguage, targetLanguage];
  const theorems = obligations.filter(item => item.kind === 'theorem' || item.kind === 'assertion');
  const counts = status => theorems.filter(item => item.status === status).length;
  const theoremCount = theorems.length;
  const termination = obligations.filter(item => item.kind === 'termination');
  const terminationText = termination.length
    ? `; ${termination.length} termination obligation(s): ${termination.filter(item => item.status === 'discharged').length} discharged by RML structural decrease, ${termination.filter(item => item.status === 'open').length} open (general or mutual recursion)`
    : '';
  const types = new Set();
  for (const declaration of program.declarations.values()) {
    for (const parameter of declaration.params ?? []) types.add(typeText(parameter.type));
    if (declaration.ret) types.add(typeText(declaration.ret));
  }
  return [
    ['behavior', observation.status === 'completed' || observation.status === 'aborted' ? 'certified-observation' : 'open',
      `the ordered lines main prints${observation.status === 'aborted' ? ' up to its abort' : ''}, as RML evaluates the certified intermediate; native target runs are CI oracles`],
    ['effects', 'encoded', 'printing in order, assertion failures and checked arithmetic aborts; no other effect is representable in the admitted core'],
    ['ownership', pair.includes('Rust') ? 'value-model' : 'not-applicable',
      pair.includes('Rust') ? 'immutable owned values; Box marks recursive occurrences; borrows, lifetimes, interior mutability and drop effects are refused' : 'no ownership discipline in either language'],
    ['types', 'checked-intermediate', `declaration types are the checked intermediate types: ${[...types].sort().join(', ') || 'none'}; target representations are listed under encodings`],
    ['universes', pair.some(language => language === 'Lean' || language === 'Rocq') ? 'ground-inductives' : 'not-applicable',
      pair.some(language => language === 'Lean' || language === 'Rocq') ? 'non-parameterised inductives in the lowest universe; universe polymorphism and Prop elimination are refused' : 'no universe hierarchy in either language'],
    ['assumptions', assumptions.length ? 'listed' : 'none', `${assumptions.length} emitter assumption(s), each recorded as an assumed obligation`],
    ['proof-obligations', theoremCount === 0 ? 'none' : counts('open') === 0 && counts('refuted') === 0 ? 'discharged' : 'partially-discharged',
      `${theoremCount} theorem(s) and assertion(s): ${counts('discharged')} discharged by RML evaluation, ${counts('open')} open, ${counts('refuted')} refuted${terminationText}`],
  ];
}

function translatorForm(identity) {
  return ['translator', ['name', 'rml-certified-translation'], ['upstream', identity.upstream], ['pull-request', String(identity.pullRequest)],
    ['commit', identity.commit], ['lock-sha256', identity.lockSha256]];
}

function sourceForm(fingerprint) {
  return ['source', ['language', fingerprint.language], ['sha256', fingerprint.sha256], ['bytes', String(fingerprint.bytes)], ['utf16', String(fingerprint.utf16)]];
}

// The vendored Rocq emitter qualifies a module's own declarations with the
// module name while that module is still open, which Rocq rejects. RML rewrites
// those references to the local names Rocq resolves inside the module and
// records the rewrite as an encoding, so the certificate states the change.
const ROCQ_OPEN_MODULE_ENCODING = Object.freeze({ id: 'rml-rocq-open-module-local-names',
  statement: 'inside an open Rocq module, references to that module\'s own declarations are emitted unqualified' });

function localizeRocqModules(text) {
  const open = [];
  let changed = false;
  const lines = text.split('\n').map(line => {
    const start = /^\s*Module\s+([A-Za-z_][\w']*)\s*\.\s*$/.exec(line);
    const end = /^\s*End\s+([A-Za-z_][\w']*)\s*\.\s*$/.exec(line);
    if (start) { open.push(start[1]); return line; }
    if (end) { if (open.at(-1) === end[1]) open.pop(); return line; }
    if (!open.length) return line;
    // Rocq strings double their quotes, so splitting on quotes keeps literals at odd indices.
    return line.split('"').map((part, index) => {
      if (index % 2) return part;
      let next = part;
      for (const name of open) next = next.replace(new RegExp(`(?<![\\w.'])${name}\\.(?=[A-Za-z_])`, 'g'), () => { changed = true; return ''; });
      return next;
    }).join('"');
  });
  return { text: lines.join('\n'), changed };
}

function localizeTargetNames(targetLanguage, emitted) {
  if (targetLanguage !== 'Rocq') return emitted;
  const { text, changed } = localizeRocqModules(emitted.text);
  return changed ? { ...emitted, text, encodings: [...emitted.encodings, ROCQ_OPEN_MODULE_ENCODING] } : emitted;
}

function authorityForm() { return ['authority', ...CERTIFIED_AUTHORITY.map(([key, value]) => [key, value])]; }

/**
 * Render the certified intermediate of an imported program as JavaScript, decoding it solely from
 * the RML structure network. This lets JavaScript observe the very program a certificate pins by
 * hash when the RML evaluator does not cover a construct; it is an observation aid, not a target.
 */
export function renderCertifiedJavaScript(imported) {
  if (imported?.status !== 'imported') throw new Error('Only an imported certified program can be rendered');
  return EMITTERS.JavaScript(decodeCertifiedIntermediate(imported.rmlNetwork, imported.root)).text;
}

/** Translate and certify; refusals return a first-refusal receipt instead of a target. */
export function translateCertified(source, sourceLanguage, targetLanguage, { imported } = {}) {
  requireLanguage(sourceLanguage, 'source'); requireLanguage(targetLanguage, 'target');
  if (sourceLanguage === targetLanguage) throw new Error('Certified translation needs two distinct languages');
  const identity = vendoredTranslatorIdentity();
  const result = imported ?? importCertifiedSource(source, sourceLanguage);
  if (result.status === 'refused') return refusal(result, targetLanguage, identity);
  const program = decodeCertifiedIntermediate(result.rmlNetwork, result.root);
  const original = result.mapSpan ?? (span => span);
  let emitted;
  try { emitted = localizeTargetNames(targetLanguage, EMITTERS[targetLanguage](program)); } catch (error) {
    if (!(error instanceof TranslationError)) throw error;
    return refusal({ ...result, stage: 'emitter', diagnostic: { kind: error.kind, message: error.reason ?? error.message, span: spanRecord(result.sourceText, original(error.span)) } }, targetLanguage, identity);
  }
  const target = { language: targetLanguage, sha256: sha256(emitted.text), bytes: encoder.encode(emitted.text).length };
  const observation = observeCertifiedProgram(program);
  const obligations = [];
  for (const theorem of emitted.theorems) {
    if (theorem.kind === 'assertion') {
      // A main assertion is a closed goal: RML's own run of main either passed it or aborted on it.
      const status = observation.status === 'completed' ? 'discharged'
        : observation.status === 'aborted' && observation.reason === 'assertion failed' ? 'refuted' : 'open';
      obligations.push({ id: `assertion:${theorem.source}`, kind: 'assertion', source: theorem.source, target: theorem.target,
        closed: 'true', status, by: status === 'open' ? 'unevaluated' : 'rml-evaluation' });
      continue;
    }
    const declaration = program.declarations.get(theorem.source);
    const outcome = declaration?.k === 'theorem' ? dischargeClosedTheorem(program, declaration) : { status: 'open', reason: 'no checked theorem declaration' };
    const by = outcome.status === 'discharged' || outcome.status === 'refuted' ? 'rml-evaluation'
      : ['Lean', 'Rocq'].includes(targetLanguage) ? 'target-kernel-oracle' : 'bounded-runtime-check-not-proof';
    obligations.push({ id: `theorem:${theorem.source}`, kind: 'theorem', source: theorem.source, target: theorem.target,
      closed: declaration?.binders?.length === 0 ? 'true' : 'false', status: outcome.status, by });
  }
  for (const assumption of emitted.assumptions) {
    obligations.push({ id: `assumption:${assumption.id}`, kind: 'assumption', source: assumption.id, target: assumption.id, closed: 'false', status: 'assumed', by: 'declared-assumption' });
  }
  obligations.push(...terminationObligations(program));
  obligations.push({ id: 'emitter-faithfulness', kind: 'trust', source: 'intermediate', target: targetLanguage, closed: 'false', status: 'open', by: 'native-oracle-ci' });
  const mapped = new Set(emitted.mappings.map(mapping => mapping.source));
  const losses = [['trivia', 'source comments and layout are not carried; the exact source is identified by its sha256 and spans']];
  for (const mapping of emitted.mappings) if (mapping.source !== mapping.target) losses.push(['renamed', mapping.source, mapping.target]);
  for (const name of program.declarations.keys()) if (!mapped.has(name)) losses.push(['unmapped-declaration', name]);
  const correspondence = emitted.mappings.map(mapping => {
    const span = spanRecord(result.sourceText, original(mapping.sourceSpan));
    const declaration = program.declarations.get(mapping.source);
    return ['construct', ['kind', mapping.kind], ['source', mapping.source], ['target', mapping.target],
      ['signature', mapping.kind === 'constructor' ? constructorSignature(program, mapping.source) : signature(declaration, mapping)],
      ...(span ? [['span', String(span.start), String(span.end)], ['bytes', String(span.byteStart), String(span.byteEnd)], ['span-sha256', span.sha256]] : [])];
  });
  const body = ['translation-certificate',
    ['schema', CERTIFIED_TRANSLATION_SCHEMA],
    translatorForm(identity),
    sourceForm(result.source),
    ['intermediate', ['schema', result.intermediate.schema], ['schema-version', String(result.intermediate.schemaVersion)],
      ['source-language', program.sourceLanguage],
      ['root', String(result.intermediate.root)], ['links', String(result.intermediate.links)], ['sha256', result.intermediate.sha256]],
    ...loweringForm(result),
    ['target', ['language', target.language], ['sha256', target.sha256], ['bytes', String(target.bytes)]],
    ['correspondence', ...correspondence],
    ['preservation', ...preservation(sourceLanguage, targetLanguage, observation, obligations, emitted.assumptions, program)],
    ['assumptions', ['count', String(emitted.assumptions.length)], ...emitted.assumptions.map(item => ['assumption', item.id, item.statement])],
    ['encodings', ['count', String(emitted.encodings.length)], ...emitted.encodings.map(item => ['encoding', item.id, item.statement])],
    ['observation', ['status', observation.status], ['lines-sha256', sha256(observation.lines.join('\n'))],
      ...(observation.reason ? [['reason', observation.reason]] : []), ...observation.lines.map(line => ['line', line])],
    ['obligations', ...obligations.map(item => ['obligation', ['id', item.id], ['kind', item.kind], ['source', item.source], ['target', item.target],
      ['closed', item.closed], ['status', item.status], ['by', item.by]])],
    ['verdict', ['discharged', String(obligations.filter(item => item.status === 'discharged').length)],
      ['open', String(obligations.filter(item => item.status === 'open').length)],
      ['assumed', String(obligations.filter(item => item.status === 'assumed').length)],
      ['refuted', String(obligations.filter(item => item.status === 'refuted').length)]],
    ['losses', ...losses],
    authorityForm()];
  const certificate = serializeLinks(withDigest(body));
  return { status: 'translated', sourceLanguage, targetLanguage, preservedSource: result.sourceText, targetSource: emitted.text,
    certificate, observation, obligations, intermediate: exportCertifiedIntermediate(result.rmlNetwork), root: result.root,
    constructs: emitted.mappings.map(mapping => ({ kind: mapping.kind, source: mapping.source, target: mapping.target })) };
}

function refusal(result, targetLanguage, identity) {
  const diagnostic = result.diagnostic;
  const body = ['translation-refusal', ['schema', TRANSLATION_REFUSAL_SCHEMA], translatorForm(identity), sourceForm(result.source),
    ['target', ['language', targetLanguage], ['status', 'not-emitted']],
    ['stage', result.stage],
    ['diagnostic', ['kind', diagnostic.kind], ['message', diagnostic.message],
      ...(diagnostic.span ? [['span', String(diagnostic.span.start), String(diagnostic.span.end)],
        ['bytes', String(diagnostic.span.byteStart), String(diagnostic.span.byteEnd)], ['span-sha256', diagnostic.span.sha256]] : [['span', 'unlocated']])],
    ['preserved-source', ['sha256', result.source.sha256], ['status', 'retained-unchanged']],
    ['losses', ['whole-program', 'no target is emitted and no behavior, type or proof claim is made; the first refusal is reported and later constructs were not examined']],
    authorityForm()];
  return { status: 'refused', targetLanguage, preservedSource: result.sourceText, targetSource: null, stage: result.stage,
    diagnostic, receipt: serializeLinks(withDigest(body)) };
}

// Canonical Links serialization. Atoms are bare when they are plain names and
// quoted otherwise; a value carrying both quote characters is percent-encoded
// under an explicit `percent-encoded` wrapper so decoding stays lossless.
function atom(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_.\-]+$/u.test(text)) return text;
  if (!text.includes('"') && !/[\r\n]/u.test(text)) return `"${text}"`;
  if (!text.includes("'") && !/[\r\n]/u.test(text)) return `'${text}'`;
  // encodeURIComponent keeps parentheses, which would unbalance the Links form.
  return `(percent-encoded ${encodeURIComponent(text).replace(/\(/gu, '%28').replace(/\)/gu, '%29')})`;
}

function decodeAtom(value) {
  return Array.isArray(value) && value.length === 2 && value[0] === 'percent-encoded' ? decodeURIComponent(value[1]) : value;
}

export function serializeLinks(form, indent = '') {
  if (!Array.isArray(form)) return atom(form);
  const flat = `(${form.map(item => serializeLinks(item, '')).join(' ')})`;
  if (flat.length <= 100 || form.every(item => !Array.isArray(item))) return flat;
  const inner = `${indent}  `;
  return `(${atom(form[0])}\n${form.slice(1).map(item => inner + serializeLinks(item, inner)).join('\n')})`;
}

function withDigest(body) { return [...body, ['digest', 'sha256', sha256(serializeLinks(body))]]; }

/** Parse Links text through the RML structure network into nested arrays of strings. */
export function readLinksDocument(text) {
  const network = new LinkNetwork();
  attachRmlStructure(network, String(text));
  const plain = link => {
    if (!link.values.length) return link.id;
    const values = link.values.map(plain);
    return decodeAtom(link.id === null ? values : [link.id, ...values]);
  };
  return rmlStructuredDocument(network).map(({ link }) => plain(link));
}

// ---------------------------------------------------------------------------
// The RML certificate checker.

function section(form, name) { return form.find(item => Array.isArray(item) && item[0] === name); }
function sections(form, name) { return form.filter(item => Array.isArray(item) && item[0] === name); }
function field(form, name) { const found = section(form ?? [], name); return found?.length === 2 ? found[1] : found?.slice(1); }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Check a certificate natively in RML: integrity, authority, translator pin,
 * source/target identity, intermediate regeneration, target regeneration,
 * correspondence, preservation contract, observation and every obligation.
 * Each section is re-derived from the preserved source; nothing is trusted
 * from the certificate itself, and no external kernel is consulted.
 */
export function checkTranslationCertificate(certificateText, { source, target }) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });
  let form;
  try {
    const forms = readLinksDocument(certificateText);
    if (forms.length !== 1 || !Array.isArray(forms[0])) throw new Error('expected exactly one certificate form');
    [form] = forms;
  } catch (error) { return { valid: false, errors: [{ code: 'RML_CERT_SYNTAX', message: error.message }] }; }
  if (form[0] !== 'translation-certificate' || field(form, 'schema') !== CERTIFIED_TRANSLATION_SCHEMA) {
    return { valid: false, errors: [{ code: 'RML_CERT_SCHEMA', message: 'not an rml:translation-certificate:1 document' }] };
  }
  const digest = section(form, 'digest');
  const body = form.filter(item => item !== digest);
  if (!digest || digest[1] !== 'sha256' || digest[2] !== sha256(serializeLinks(body)) || form.at(-1) !== digest) fail('RML_CERT_DIGEST', 'certificate digest does not match its canonical body');
  const authority = section(form, 'authority');
  if (!same(authority, authorityForm())) fail('RML_CERT_AUTHORITY', 'certificate grants authority beyond none/oracle-only/rml');
  const identity = vendoredTranslatorIdentity();
  if (!same(section(form, 'translator'), translatorForm(identity))) fail('RML_CERT_TRANSLATOR', 'certificate was produced by a different or stale translator pin');
  const claimedSource = section(form, 'source');
  const sourceLanguage = field(claimedSource, 'language');
  const targetLanguage = field(section(form, 'target'), 'language');
  if (!CERTIFIED_LANGUAGES.includes(sourceLanguage) || !CERTIFIED_LANGUAGES.includes(targetLanguage) || sourceLanguage === targetLanguage) {
    fail('RML_CERT_LANGUAGE', 'certificate names an unsupported language pair');
    return { valid: false, errors };
  }
  const text = String(source);
  if (field(claimedSource, 'sha256') !== sha256(text) || field(claimedSource, 'bytes') !== String(encoder.encode(text).length)) {
    fail('RML_CERT_SOURCE_HASH', 'the supplied source is not the certified source (stale or substituted)');
  }
  if (target !== undefined && field(section(form, 'target'), 'sha256') !== sha256(String(target))) fail('RML_CERT_TARGET_HASH', 'the supplied target is not the certified target');
  const expected = translateCertified(text, sourceLanguage, targetLanguage);
  if (expected.status !== 'translated') {
    fail('RML_CERT_SOURCE_LANGUAGE', `the source does not import as ${sourceLanguage}: ${expected.diagnostic.message} (relabelled or unsupported source)`);
    return { valid: false, errors };
  }
  if (target !== undefined && String(target) !== expected.targetSource) fail('RML_CERT_TARGET_REGENERATION', 'the target is not regenerated from the certified intermediate');
  const [reference] = readLinksDocument(expected.certificate);
  const sectionCodes = { source: 'RML_CERT_SOURCE_HASH', intermediate: 'RML_CERT_INTERMEDIATE', target: 'RML_CERT_TARGET_HASH',
    correspondence: 'RML_CERT_CORRESPONDENCE', preservation: 'RML_CERT_PRESERVATION', assumptions: 'RML_CERT_ASSUMPTIONS',
    encodings: 'RML_CERT_ENCODINGS', observation: 'RML_CERT_OBSERVATION', verdict: 'RML_CERT_VERDICT', losses: 'RML_CERT_LOSSES',
    lowering: 'RML_CERT_LOWERING' };
  for (const [name, code] of Object.entries(sectionCodes)) {
    if (!same(section(form, name), section(reference, name)) && !errors.some(error => error.code === code)) fail(code, `${name} section differs from the RML re-derivation`);
  }
  const claimed = sections(section(form, 'obligations') ?? [], 'obligation');
  const derived = sections(section(reference, 'obligations') ?? [], 'obligation');
  for (const obligation of derived) {
    const id = field(obligation, 'id');
    const match = claimed.find(item => field(item, 'id') === id);
    if (!match) fail('RML_CERT_OBLIGATION_DROPPED', `obligation ${id} is missing`);
    else if (!same(match, obligation)) fail('RML_CERT_OBLIGATION_FORGED', `obligation ${id} claims ${field(match, 'status')} by ${field(match, 'by')}; RML derives ${field(obligation, 'status')} by ${field(obligation, 'by')}`);
  }
  for (const obligation of claimed) if (!derived.some(item => field(item, 'id') === field(obligation, 'id'))) fail('RML_CERT_OBLIGATION_FORGED', `obligation ${field(obligation, 'id')} is not derivable`);
  const declared = (section(form, 'preservation') ?? []).slice(1).map(item => item[0]);
  if (!same(declared, PRESERVATION_DIMENSIONS)) fail('RML_CERT_PRESERVATION', 'preservation contract must declare exactly the seven dimensions');
  return { valid: errors.length === 0, errors, sourceLanguage, targetLanguage,
    discharged: derived.filter(item => field(item, 'status') === 'discharged').length,
    open: derived.filter(item => field(item, 'status') === 'open').length };
}

/** Check a refusal receipt: the source is retained and the first refusal is re-derived exactly. */
export function checkTranslationRefusal(receiptText, { source }) {
  const errors = [];
  let form;
  try { [form] = readLinksDocument(receiptText); } catch (error) { return { valid: false, errors: [{ code: 'RML_REFUSAL_SYNTAX', message: error.message }] }; }
  if (!Array.isArray(form) || form[0] !== 'translation-refusal' || field(form, 'schema') !== TRANSLATION_REFUSAL_SCHEMA) return { valid: false, errors: [{ code: 'RML_REFUSAL_SCHEMA', message: 'not a refusal receipt' }] };
  const sourceLanguage = field(section(form, 'source'), 'language');
  const targetLanguage = field(section(form, 'target'), 'language');
  if (!CERTIFIED_LANGUAGES.includes(sourceLanguage) || !CERTIFIED_LANGUAGES.includes(targetLanguage) || sourceLanguage === targetLanguage) return { valid: false, errors: [{ code: 'RML_REFUSAL_LANGUAGE', message: 'unsupported language pair' }] };
  const expected = translateCertified(String(source), sourceLanguage, targetLanguage);
  if (expected.status !== 'refused') errors.push({ code: 'RML_REFUSAL_NOT_REFUSED', message: 'the source now translates; the receipt is stale' });
  else if (expected.receipt !== String(receiptText)) errors.push({ code: 'RML_REFUSAL_MISMATCH', message: 'receipt differs from the re-derived first refusal' });
  return { valid: errors.length === 0, errors };
}
