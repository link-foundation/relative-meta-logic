/** RML surface lowering: recorded source-to-source rewrites that run before the vendored frontends.
 *
 * The temporarily vendored meta-language PR #201 frontends refuse records,
 * struct variants and type parameters. RML lowers a bounded fragment of those
 * constructs into constructs the frontends already admit:
 *
 * - Rust named structs become single-variant tuple enums of the same name.
 *   Struct literals, struct patterns, tuple-struct constructors and field
 *   reads become constructor applications, tuple-variant patterns and calls
 *   of generated accessor functions; enum struct variants become tuple
 *   variants with their fields in declaration order.
 * - Lean structures become one-constructor inductives with projection
 *   definitions in the structure's namespace; structure instances and field
 *   reads become constructor and projection applications.
 * - Rocq records become one-constructor inductives with projection
 *   definitions; record instances and `e.(f)` become applications.
 * - Explicit type parameters (Rust `<T>`, Lean and Rocq `(A : Type)`
 *   binders) are monomorphized: every explicit instantiation becomes a copy
 *   of the item under a fresh mangled name, up to MONOMORPHIZATION_LIMIT.
 *
 * Every rewrite records its kind, subject and exact original span, and
 * every span a frontend reports is mapped back to the original source, so
 * certificates and refusal receipts keep pointing at the user's bytes. Each
 * rewrite is the definitional unfolding of the construct it replaces. Where
 * that unfolding would depend on type inference RML does not perform
 * (ambiguous field reads, a value of a generic type without explicit type
 * arguments, generic calls without explicit instantiation, trait bounds,
 * lifetimes, universe-polymorphic binders, out-of-order evaluation) the
 * program is refused at the `rml-lowering` stage with its span. Patterns may
 * name the single instantiation in scope, because a wrong choice there can
 * only make the checked frontend reject the program, never change it.
 */
import { tokenize } from '#meta-language-pr201/translation/lexer.js';
import { TranslationError, unsupported } from '#meta-language-pr201/translation/diagnostics.js';

export const SURFACE_LOWERING_SCHEMA = 'rml:surface-lowering:1';
/** The largest number of monomorphic copies one program may need. */
export const MONOMORPHIZATION_LIMIT = 64;
/** Every rewrite kind with the statement a certificate records for it. */
export const LOWERING_KINDS = Object.freeze({
  'rust-monomorphize': 'a generic Rust item is copied once per explicit instantiation under a fresh mangled name',
  'rust-instantiation': 'an explicit Rust instantiation (Name<T>, f::<T>, Name::<T>::Variant) names its monomorphic copy',
  'rust-struct': 'a Rust struct becomes a single-variant tuple enum of the same name; each read field gets a generated accessor function',
  'rust-struct-variant': 'an enum struct variant becomes a tuple variant with its fields in declaration order',
  'rust-struct-literal': 'a struct literal written in declaration order becomes a constructor application',
  'rust-struct-pattern': 'a struct pattern becomes a tuple-variant pattern; fields omitted under .. become wildcards',
  'rust-tuple-struct': 'a tuple-struct constructor or pattern names the single variant of its enum',
  'rust-field-read': 'a field read becomes a call of the generated accessor of the field\'s owner',
  'lean-monomorphize': 'a Lean declaration with explicit (α : Type) parameters is copied once per explicit instantiation under a fresh mangled name',
  'lean-instantiation': 'an explicit Lean type application or @-constructor names its monomorphic copy',
  'lean-structure': 'a Lean structure becomes a one-constructor inductive with projection definitions in its namespace',
  'lean-structure-instance': 'a structure instance becomes an application of the constructor to the fields in declaration order',
  'lean-field-read': 'a field read becomes an application of the generated projection',
  'rocq-monomorphize': 'a Rocq declaration with explicit (A : Type) parameters is copied once per explicit instantiation under a fresh mangled name',
  'rocq-instantiation': 'an explicit Rocq type or constructor application names its monomorphic copy',
  'rocq-record': 'a Rocq record becomes a one-constructor inductive with projection definitions',
  'rocq-record-instance': 'a record instance becomes an application of the constructor to the fields in declaration order',
  'rocq-projection': 'a projection e.(f) becomes the application (f e)',
});

const refuse = (construct, reason, span) => unsupported(construct, reason, span);

// ---------------------------------------------------------------------------
// Tokens, spans and edits.

class Tokens {
  constructor(text, language) {
    this.text = text;
    this.list = tokenize(text, language).tokens;
    this.length = this.list.length - 1; // the final token is eof
    this.closeOf = new Map(); this.openOf = new Map();
    const stack = [];
    this.list.forEach((token, index) => {
      if (token.kind !== 'punct') return;
      if (token.value === '(' || token.value === '[' || token.value === '{') stack.push(index);
      else if ((token.value === ')' || token.value === ']' || token.value === '}') && stack.length) {
        const open = stack.pop(); this.closeOf.set(open, index); this.openOf.set(index, open);
      }
    });
    this.lineStarts = [0];
    for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') this.lineStarts.push(index + 1);
  }
  is(k, value) { const token = this.list[k]; return Boolean(token) && (token.kind === 'punct' || token.kind === 'identifier') && token.value === value; }
  ident(k) { const token = this.list[k]; return token?.kind === 'identifier' ? token.value : null; }
  gap(k) { return k <= 0 ? '' : this.text.slice(this.list[k - 1].end, this.list[k].start); }
  adjacent(k) { return k > 0 && this.list[k - 1].end === this.list[k].start; }
  raw(i, j) { return i >= j ? '' : this.text.slice(this.list[i].start, this.list[j - 1].end); }
  span(i, j = i + 1) { return { start: this.list[i].start, end: this.list[Math.max(i, j - 1)].end }; }
  close(k) { return this.closeOf.get(k) ?? -1; }
  open(k) { return this.openOf.get(k) ?? -1; }
  column(k) {
    const offset = this.list[k].start;
    let low = 0; let high = this.lineStarts.length - 1;
    while (low < high) { const middle = (low + high + 1) >> 1; if (this.lineStarts[middle] <= offset) low = middle; else high = middle - 1; }
    return offset - this.lineStarts[low];
  }
  opener(k) { return this.is(k, '(') || this.is(k, '[') || this.is(k, '{'); }
  identifiers() { return new Set(this.list.filter(token => token.kind === 'identifier').flatMap(token => token.value.split('.'))); }
}

function lex(text, language) {
  try { return new Tokens(text, language); } catch (error) {
    if (error instanceof TranslationError) return null; // the frontend reports its own lexical refusal
    throw error;
  }
}

/** Collects rendered text for a token range, keeping the original layout between tokens. */
class TextSink {
  constructor(t) { this.t = t; this.out = ''; this.first = true; }
  lead(k) { if (!this.first) this.out += this.t.gap(k); this.first = false; }
  copy(k) { this.lead(k); this.out += this.t.raw(k, k + 1); }
  put(i, j, text) { this.lead(i); this.out += typeof text === 'function' ? text() : text; }
}

/** Collects top-level edits; copied tokens stay byte-identical. */
class EditSink {
  constructor(t) { this.t = t; this.edits = []; }
  copy() {}
  put(i, j, text, kind, subject) {
    this.edits.push({ start: this.t.list[i].start, end: this.t.list[j - 1].end, text, kind, subject, raw: this.t.raw(i, j) });
  }
  finish() {
    return this.edits.map(edit => ({ ...edit, text: typeof edit.text === 'function' ? edit.text() : edit.text }))
      .filter(edit => edit.text !== edit.raw);
  }
}

function applyEdits(text, edits) {
  const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  let out = ''; let cursor = 0; const segments = [];
  const keep = until => {
    if (until > cursor) segments.push({ from: out.length, to: out.length + until - cursor, start: cursor, end: until, exact: true });
    out += text.slice(cursor, until);
  };
  for (const edit of sorted) {
    if (edit.start < cursor) throw new Error('RML lowering produced overlapping rewrites');
    keep(edit.start);
    segments.push({ from: out.length, to: out.length + edit.text.length, start: edit.start, end: edit.end, exact: false });
    out += edit.text; cursor = edit.end;
  }
  keep(text.length);
  return { text: out, map: span => mapThrough(segments, span) };
}

function mapThrough(segments, span) {
  if (!span) return span;
  const startSegment = segments.find(segment => span.start >= segment.from && span.start < segment.to)
    ?? segments.findLast(segment => span.start >= segment.from && span.start <= segment.to) ?? segments.at(-1);
  const start = startSegment.exact ? startSegment.start + (span.start - startSegment.from) : startSegment.start;
  if (span.end <= span.start) return { start, end: start };
  const endSegment = segments.find(segment => span.end > segment.from && span.end <= segment.to) ?? segments.at(-1);
  const end = endSegment.exact ? endSegment.start + (span.end - endSegment.from) : endSegment.end;
  return { start, end: Math.max(start, end) };
}

/** Split [i, j) at top-level separators; angle brackets nest only when `angles` is set (types, not expressions). */
function splitTop(t, i, j, separator, angles = false) {
  const parts = []; let start = i; let angle = 0;
  for (let p = i; p < j; p += 1) {
    if (t.opener(p)) { const close = t.close(p); if (close < 0 || close >= j) return null; p = close; continue; }
    if (angles && t.is(p, '<')) angle += 1;
    else if (angles && t.is(p, '>') && angle > 0) angle -= 1;
    else if (angle === 0 && t.is(p, separator)) { parts.push([start, p]); start = p + 1; }
  }
  if (start < j) parts.push([start, j]);
  return parts;
}

const flat = text => text.replace(/\s+/gu, ' ').trim();
const normalizeType = text => flat(text).replace(/\s*([<>,()[\]&])\s*/gu, '$1').replace(/,/gu, ', ');
const mangleSuffix = args => args.map(arg => arg.replace(/[^\p{L}\p{N}']+/gu, '_').replace(/^_+|_+$/gu, '')).join('_');
const snake = name => name.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1_$2').toLowerCase();

/** Monomorphization bookkeeping shared by the three languages. */
class Instances {
  constructor(t, construct) { this.t = t; this.construct = construct; this.byKey = new Map(); this.names = new Map(); this.identifiers = t.identifiers(); this.queue = []; }
  get(template, args, span, mangle) {
    const key = `${template.name}<${args.join(', ')}>`;
    let instance = this.byKey.get(key);
    if (instance) return instance;
    if (this.byKey.size >= MONOMORPHIZATION_LIMIT) {
      throw refuse('instantiation limit', `more than ${MONOMORPHIZATION_LIMIT} monomorphic copies are needed (polymorphic recursion or instantiation explosion)`, span);
    }
    const name = mangle(template, args);
    if (this.identifiers.has(name.split('.').at(-1)) || (this.names.has(name) && this.names.get(name) !== key)) {
      throw refuse('instantiation name collision', `the monomorphic name ${name} for ${key} is already used`, span);
    }
    instance = { key, template, args, name, suffix: mangleSuffix(args), sigma: new Map(template.params.map((param, index) => [param, args[index]])) };
    this.byKey.set(key, instance); this.names.set(name, key); this.queue.push(instance);
    return instance;
  }
  of(template) { return [...this.byKey.values()].filter(instance => instance.template === template); }
  /** A pattern may name the one instantiation in its item, else the one in the program. */
  pick(template, local, span, what) {
    const inItem = [...(local ?? [])].map(key => this.byKey.get(key)).filter(instance => instance?.template === template);
    if (inItem.length === 1) return inItem[0];
    const all = this.of(template);
    if (inItem.length === 0 && all.length === 1) return all[0];
    throw refuse(what, `${template.name} has ${inItem.length > 1 ? inItem.length : all.length} instantiations in scope; write the type arguments explicitly`, span);
  }
}

function requireInstantiated(templates, instances, t, construct) {
  for (const template of templates) {
    if (!instances.of(template).length) {
      throw refuse(construct, `${template.name} is never used with explicit type arguments, so RML has no monomorphic copy to translate`, t.span(template.nameIndex));
    }
  }
}

// ---------------------------------------------------------------------------
// Rust.

const RUST_KEYWORDS = new Set(['as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
  'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use',
  'where', 'while', 'dyn', 'Self']);
const RUST_TYPE_CONTEXT = new Set(['->', 'impl', 'for', 'struct', 'enum', 'dyn', 'trait', 'type', 'union']);

function rustAngleClose(t, k) {
  let depth = 0;
  for (let p = k; p < t.length; p += 1) {
    if (t.is(p, '<')) depth += 1;
    else if (t.is(p, '>')) { depth -= 1; if (depth === 0) return p; }
    else if (t.is(p, '(') || t.is(p, '[')) { const close = t.close(p); if (close < 0) return -1; p = close; }
    else if (t.is(p, '{') || t.is(p, '}') || t.is(p, ';')) return -1;
  }
  return -1;
}

/** Token mask of Rust pattern positions: match arms before `=>` and `let` bindings. */
function rustPatternMask(t) {
  const mask = new Uint8Array(t.list.length);
  const skip = (q, limit) => { if (t.opener(q)) { const close = t.close(q); return close < 0 || close > limit ? limit : close; } return q; };
  for (let k = 0; k < t.length; k += 1) {
    if (t.is(k, 'match')) {
      let p = k + 1;
      while (p < t.length && !t.is(p, '{')) { p = skip(p, t.length) + 1; }
      const close = t.close(p);
      if (close < 0) continue;
      let q = p + 1;
      while (q < close) {
        const armStart = q;
        while (q < close && !t.is(q, '=>')) q = skip(q, close) + 1;
        for (let r = armStart; r < Math.min(q, close); r += 1) mask[r] = 1;
        if (q >= close) break;
        q += 1;
        if (t.is(q, '{')) { q = t.close(q) + 1; if (t.is(q, ',')) q += 1; continue; }
        while (q < close && !t.is(q, ',')) q = skip(q, close) + 1;
        q += 1;
      }
    } else if (t.is(k, 'let')) {
      let q = k + 1;
      while (q < t.length && !t.is(q, '=') && !t.is(q, ':') && !t.is(q, ';')) q = skip(q, t.length) + 1;
      for (let r = k + 1; r < q; r += 1) mask[r] = 1;
    }
  }
  return mask;
}

/** Ranges of Rust functions (from `fn` to the end of the body) for item-local facts. */
function rustFunctionRanges(t) {
  const ranges = [];
  for (let k = 0; k < t.length; k += 1) {
    if (!t.is(k, 'fn') || !t.ident(k + 1)) continue;
    let p = k + 2;
    while (p < t.length && !t.is(p, '{') && !t.is(p, ';')) { if (t.is(p, '(') || t.is(p, '[')) { const close = t.close(p); if (close < 0) break; p = close; } p += 1; }
    if (t.is(p, '{') && t.close(p) > 0) ranges.push({ start: k, end: t.close(p) + 1 });
  }
  return ranges;
}
const enclosing = (ranges, k) => ranges.filter(range => range.start <= k && k < range.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] ?? null;

function rustPathEnd(t, k) {
  let p = k + 1;
  while (t.is(p, '::') && t.ident(p + 1)) p += 2;
  return p;
}

function rustItemStart(t, k) {
  let start = k;
  for (;;) {
    if (t.is(start - 1, 'pub')) { start -= 1; continue; }
    if (t.is(start - 1, ')') && t.is(t.open(start - 1) - 1, 'pub')) { start = t.open(start - 1) - 1; continue; }
    if (t.is(start - 1, ']') && t.is(t.open(start - 1) - 1, '#')) { start = t.open(start - 1) - 1; continue; }
    return start;
  }
}

function rustTemplates(t) {
  const templates = new Map();
  for (let k = 0; k < t.length; k += 1) {
    const keyword = t.ident(k);
    if (!['fn', 'enum', 'struct'].includes(keyword) || !t.ident(k + 1) || !t.is(k + 2, '<')) continue;
    const name = t.ident(k + 1);
    const gt = rustAngleClose(t, k + 2);
    if (gt < 0) throw refuse(`generic ${keyword}`, 'the type parameter list is not closed', t.span(k, k + 3));
    const params = [];
    for (const [a, b] of splitTop(t, k + 3, gt, ',', true) ?? []) {
      if (b - a === 1 && t.ident(a) && !RUST_KEYWORDS.has(t.ident(a))) { params.push(t.ident(a)); continue; }
      const what = t.is(a, '\'') ? 'lifetime parameter' : t.is(a, 'const') ? 'const generic parameter'
        : t.is(a + 1, ':') ? 'trait-bounded type parameter' : t.is(a + 1, '=') ? 'defaulted type parameter' : 'type parameter';
      throw refuse(what, 'only unbounded type parameters are monomorphized; trait dispatch, lifetimes and const generics are outside RML lowering', t.span(a, b));
    }
    let p = gt + 1; let end = -1;
    if (keyword === 'fn') {
      while (p < t.length && !t.is(p, '{') && !t.is(p, ';')) {
        if (t.is(p, 'where')) throw refuse('where clause', 'trait bounds are outside RML lowering', t.span(p));
        if (t.is(p, '(') || t.is(p, '[')) p = t.close(p);
        if (p < 0) break;
        p += 1;
      }
      end = t.is(p, '{') ? t.close(p) + 1 : -1;
    } else {
      if (t.is(p, 'where')) throw refuse('where clause', 'trait bounds are outside RML lowering', t.span(p));
      if (t.is(p, '{')) end = t.close(p) + 1;
      else if (t.is(p, '(')) end = t.is(t.close(p) + 1, ';') ? t.close(p) + 2 : -1;
      else if (t.is(p, ';')) end = p + 1;
    }
    if (end <= 0) throw refuse(`generic ${keyword}`, 'the item body is not closed', t.span(k, gt + 1));
    templates.set(name, { name, keyword, nameIndex: k + 1, lt: k + 2, gt, params, start: rustItemStart(t, k), end });
    k = gt;
  }
  const list = [...templates.values()];
  for (const inner of list) {
    if (list.some(outer => outer !== inner && outer.start <= inner.start && inner.end <= outer.end)) {
      throw refuse('nested generic item', 'a generic item inside another generic item is outside RML lowering', t.span(inner.nameIndex));
    }
  }
  return templates;
}

function rustMonomorphize(text) {
  const t = lex(text, 'Rust');
  if (!t) return null;
  const templates = rustTemplates(t);
  if (!templates.size) return null;
  const instances = new Instances(t);
  const patterns = rustPatternMask(t);
  const functions = rustFunctionRanges(t);
  const mangle = (template, args) => `${template.name}_${mangleSuffix(args)}`;
  const localCache = new Map();

  function render(i, j, context, sink) {
    for (let k = i; k < j; k += 1) {
      if (context.header && k === context.header.nameIndex) { sink.put(k, k + 1, context.header.name); k = context.header.gt; continue; }
      const value = t.ident(k);
      if (value && context.sigma?.has(value) && !t.is(k - 1, '.')) { sink.put(k, k + 1, context.sigma.get(value)); continue; }
      const template = value ? templates.get(value) : null;
      if (!template || t.is(k - 1, '.') || ['fn', 'enum', 'struct'].includes(t.ident(k - 1))) { sink.copy(k); continue; }
      const turbofish = t.is(k + 1, '::') && t.is(k + 2, '<');
      const direct = template.keyword !== 'fn' && t.is(k + 1, '<');
      const variantTurbofish = template.keyword === 'enum' && t.is(k + 1, '::') && t.ident(k + 2) && t.is(k + 3, '::') && t.is(k + 4, '<');
      if (turbofish || direct || variantTurbofish) {
        const lt = variantTurbofish ? k + 4 : turbofish ? k + 2 : k + 1;
        const gt = rustAngleClose(t, lt);
        if (gt < 0) throw refuse('generic instantiation', 'the type argument list is not closed', t.span(k, lt + 1));
        const args = (splitTop(t, lt + 1, gt, ',', true) ?? []).map(([a, b]) => {
          const inner = new TextSink(t); render(a, b, { ...context, header: null }, inner); return normalizeType(inner.out);
        });
        if (args.length !== template.params.length) {
          throw refuse('generic instantiation', `${value} takes ${template.params.length} type argument(s) but ${args.length} were given`, t.span(k, gt + 1));
        }
        const instance = instances.get(template, args, t.span(k, gt + 1), mangle);
        context.collect?.add(instance.key);
        sink.put(k, gt + 1, variantTurbofish ? `${instance.name}::${t.ident(k + 2)}` : instance.name, 'rust-instantiation', instance.key);
        k = gt; continue;
      }
      if (template.keyword === 'fn') {
        throw refuse('generic call without explicit instantiation', `${value} has type parameters; write ${value}::<…>(…) so RML can monomorphize the call (RML does not infer type arguments)`, t.span(k));
      }
      if (context.discover) { sink.copy(k); continue; }
      if (!patterns[k]) {
        throw refuse('value of a generic type without explicit instantiation', `write ${value}::<…> so RML can monomorphize the value (RML does not infer type arguments)`, t.span(k));
      }
      const instance = instances.pick(template, context.local, t.span(k), 'pattern of a generic type with several instantiations');
      sink.put(k, k + 1, instance.name, 'rust-instantiation', instance.key);
    }
  }
  const renderInstance = (instance, discover) => {
    const { template } = instance;
    const collect = new Set();
    const header = { nameIndex: template.nameIndex, gt: template.gt, name: instance.name };
    if (!discover && !instance.local) { render(template.start, template.end, { sigma: instance.sigma, header, discover: true, collect }, new TextSink(t)); instance.local = collect; }
    const sink = new TextSink(t);
    render(template.start, template.end, { sigma: instance.sigma, header, discover, collect: discover ? collect : null, local: instance.local }, sink);
    return sink.out;
  };
  const outside = [];
  let cursor = 0;
  for (const template of [...templates.values()].sort((a, b) => a.start - b.start)) { outside.push([cursor, template.start]); cursor = template.end; }
  outside.push([cursor, t.length]);
  const localOf = k => {
    const range = enclosing(functions, k);
    if (!range) return null;
    if (!localCache.has(range)) { const collect = new Set(); render(range.start, range.end, { discover: true, collect }, new TextSink(t)); localCache.set(range, collect); }
    return localCache.get(range);
  };
  for (const [a, b] of outside) render(a, b, { discover: true }, new TextSink(t));
  for (let index = 0; index < instances.queue.length; index += 1) renderInstance(instances.queue[index], true);
  requireInstantiated(templates.values(), instances, t, 'generic item without explicit instantiation');
  const sink = new EditSink(t);
  for (const [a, b] of outside) {
    for (let k = a; k < b; k += 1) {
      // Render one token at a time so every edit stays as small as the construct it rewrites.
      const before = sink.edits.length;
      const probe = new TextSink(t);
      let end = k + 1;
      const value = t.ident(k);
      if (value && templates.has(value)) {
        const lt = t.is(k + 1, '<') ? k + 1 : t.is(k + 1, '::') && t.is(k + 2, '<') ? k + 2 : t.is(k + 3, '::') && t.is(k + 4, '<') ? k + 4 : -1;
        if (lt > 0) end = rustAngleClose(t, lt) + 1 || k + 1;
      }
      render(k, end, { local: localOf(k) }, { copy: c => probe.copy(c), put: (i, j, text, kind, subject) => { sink.put(i, j, text, kind ?? 'rust-instantiation', subject); } });
      if (sink.edits.length > before) k = end - 1;
    }
  }
  for (const template of templates.values()) {
    sink.put(t.list.indexOf(t.list[template.start]), template.end, instances.of(template).map(instance => renderInstance(instance, false)).join('\n\n'),
      'rust-monomorphize', `${template.name}<${template.params.join(', ')}>`);
  }
  return { edits: sink.finish() };
}

function rustStructs(text) {
  const t = lex(text, 'Rust');
  if (!t) return null;
  const structs = new Map(); const variants = new Map();
  const fieldsOf = (open, close, named) => {
    const fields = [];
    for (const [a, b] of splitTop(t, open + 1, close, ',', true) ?? []) {
      let p = a;
      if (t.is(p, '#')) throw refuse('field attribute', 'attributes on fields are outside RML lowering', t.span(a, b));
      if (t.is(p, 'pub')) { p += 1; if (t.is(p, '(')) p = t.close(p) + 1; }
      if (!named) { fields.push({ name: String(fields.length), type: flat(t.raw(p, b)) }); continue; }
      if (!t.ident(p) || !t.is(p + 1, ':')) throw refuse('struct field', 'expected `name: Type`', t.span(a, b));
      fields.push({ name: t.ident(p), type: flat(t.raw(p + 2, b)), index: p });
    }
    return fields;
  };
  for (let k = 0; k < t.length; k += 1) {
    if (t.is(k, 'struct') && t.ident(k + 1) && !t.is(k - 1, '.')) {
      const name = t.ident(k + 1); const p = k + 2;
      if (t.is(p, '<')) throw refuse('generic struct', 'type parameters must be instantiated explicitly', t.span(k, p + 1));
      if (t.is(p, 'where')) throw refuse('where clause', 'trait bounds are outside RML lowering', t.span(p));
      if (t.is(p, ';')) throw refuse('unit struct', 'a struct without fields has no portable value; declare a fieldless enum instead', t.span(k, p + 1));
      if (t.is(p, '{')) {
        const fields = fieldsOf(p, t.close(p), true);
        if (!fields.length) throw refuse('empty struct', 'a struct without fields has no portable value; declare a fieldless enum instead', t.span(k, t.close(p) + 1));
        structs.set(name, { name, kind: 'named', fields, start: k, end: t.close(p) + 1, pub: t.is(k - 1, 'pub') || t.is(t.open(k - 1) - 1, 'pub') });
      } else if (t.is(p, '(') && t.is(t.close(p) + 1, ';')) {
        const fields = fieldsOf(p, t.close(p), false);
        if (!fields.length) throw refuse('empty struct', 'a struct without fields has no portable value; declare a fieldless enum instead', t.span(k, t.close(p) + 2));
        structs.set(name, { name, kind: 'tuple', fields, start: k, end: t.close(p) + 2 });
      }
    } else if (t.is(k, 'enum') && t.ident(k + 1) && t.is(k + 2, '{') && t.close(k + 2) > 0) {
      for (const [a, b] of splitTop(t, k + 3, t.close(k + 2), ',', true) ?? []) {
        if (t.ident(a) && t.is(a + 1, '{') && t.close(a + 1) === b - 1) variants.set(`${t.ident(k + 1)}::${t.ident(a)}`, { name: t.ident(a), fields: fieldsOf(a + 1, b - 1, true), start: a, end: b });
      }
    }
  }
  if (!structs.size && !variants.size) return null;
  const owners = new Map();
  for (const struct of structs.values()) if (struct.kind === 'named') for (const field of struct.fields) owners.set(field.name, [...(owners.get(field.name) ?? []), struct.name]);
  const identifiers = t.identifiers();
  for (const reserved of ['rml_value', 'rml_field']) if (identifiers.has(reserved)) throw refuse('generated name collision', `${reserved} is reserved for generated accessors`, t.span(0));
  const accessors = new Map();
  const accessor = (struct, field, span) => {
    const name = `rml_${snake(struct)}_${field}`;
    const key = `${struct}.${field}`;
    if (identifiers.has(name) || (accessors.has(name) && accessors.get(name) !== key)) throw refuse('generated name collision', `the accessor name ${name} is already used`, span);
    accessors.set(name, key);
    return name;
  };
  const patterns = rustPatternMask(t);
  const functions = rustFunctionRanges(t);
  const annotations = new Map();
  for (const range of functions) {
    const map = new Map();
    for (let p = range.start; p + 2 < range.end; p += 1) {
      if (t.ident(p) && t.is(p + 1, ':') && structs.has(t.ident(p + 2)) && !t.is(p + 3, '::') && !t.is(p + 3, '<')) {
        map.set(t.ident(p), map.has(t.ident(p)) && map.get(t.ident(p)) !== t.ident(p + 2) ? null : t.ident(p + 2));
      }
    }
    annotations.set(range, map);
  }
  const used = new Set();

  const structText = struct => {
    const types = struct.fields.map(field => field.type).join(', ');
    let out = `enum ${struct.name} {\n    ${struct.name}(${types}),\n}`;
    struct.fields.forEach((field, index) => {
      if (!used.has(`${struct.name}.${field.name}`)) return;
      const binds = struct.fields.map((_, position) => (position === index ? 'rml_field' : '_')).join(', ');
      out += `\n\n${struct.pub ? 'pub ' : ''}fn ${accessor(struct.name, field.name, t.span(field.index ?? struct.start + 1))}(rml_value: ${struct.name}) -> ${field.type} {\n    match rml_value {\n        ${struct.name}::${struct.name}(${binds}) => rml_field,\n    }\n}`;
    });
    return out;
  };
  const renderText = (i, j) => { const sink = new TextSink(t); walk(i, j, sink); return sink.out; };

  function literal(k, pathEnd, record, isVariant) {
    const open = pathEnd; const close = t.close(open);
    if (close < 0) return null;
    const pattern = patterns[k] === 1;
    const given = []; let rest = false;
    for (const [a, b] of splitTop(t, open + 1, close, ',') ?? []) {
      if (t.is(a, '..')) {
        if (!pattern) throw refuse('functional record update', 'struct update syntax copies fields RML would have to name; list every field', t.span(a, b));
        if (b - a !== 1) throw refuse('struct pattern rest', 'only a bare .. may end a struct pattern', t.span(a, b));
        rest = true; continue;
      }
      let name; let value;
      if (t.ident(a) && t.is(a + 1, ':')) { name = t.ident(a); value = [a + 2, b]; }
      else if (b - a === 1 && t.ident(a)) { name = t.ident(a); value = [a, b]; }
      else if (pattern && b - a === 2 && (t.is(a, 'ref') || t.is(a, 'mut')) && t.ident(a + 1)) { name = t.ident(a + 1); value = [a, b]; }
      else throw refuse('struct field', 'expected `field: value` or a shorthand field', t.span(a, b));
      if (!record.fields.some(field => field.name === name)) throw refuse('unknown struct field', `${record.name} has no field ${name}`, t.span(a, b));
      if (given.some(entry => entry.name === name)) throw refuse('duplicate struct field', `${name} is given twice`, t.span(a, b));
      given.push({ name, value });
    }
    const order = record.fields.map(field => field.name);
    if (!pattern) {
      const missing = order.filter(name => !given.some(entry => entry.name === name));
      if (missing.length) throw refuse('struct literal missing field', `${record.name} literal omits ${missing.join(', ')}`, t.span(k, close + 1));
      if (given.some((entry, index) => entry.name !== order[index])) {
        throw refuse('struct literal fields out of declaration order', 'Rust evaluates struct literal fields in written order; write them in declaration order so the constructor application keeps that order', t.span(k, close + 1));
      }
    } else if (!rest && given.length !== order.length) {
      throw refuse('struct pattern missing field', 'name every field or end the pattern with ..', t.span(k, close + 1));
    }
    const values = order.map(name => { const entry = given.find(item => item.name === name); return entry ? renderText(...entry.value) : '_'; });
    const head = isVariant ? t.raw(k, pathEnd) : `${t.raw(k, pathEnd)}::${record.name}`;
    return { end: close + 1, text: `${head}(${values.join(', ')})`, kind: pattern ? 'rust-struct-pattern' : 'rust-struct-literal', subject: record.name };
  }

  function chain(k, limit) {
    let p;
    const simple = t.ident(k) && rustPathEnd(t, k) === k + 1;
    if (t.is(k, '(')) { const close = t.close(k); if (close < 0 || close >= limit) return null; p = close + 1; }
    else {
      p = rustPathEnd(t, k);
      if (t.is(p, '!')) return null;
      if (t.is(p, '(')) { const close = t.close(p); if (close < 0 || close >= limit) return null; p = close + 1; }
    }
    const parts = [];
    while (p < limit) {
      if (t.is(p, '.') && t.ident(p + 1) && p + 1 < limit) {
        if (t.is(p + 2, '(')) { const close = t.close(p + 2); if (close < 0 || close >= limit) break; parts.push({ field: false, a: p, b: close + 1 }); p = close + 1; continue; }
        parts.push({ field: owners.has(t.ident(p + 1)), name: t.ident(p + 1), a: p, b: p + 2 }); p += 2; continue;
      }
      if (t.is(p, '.') && t.list[p + 1]?.kind === 'number') { parts.push({ field: false, position: t.list[p + 1].value, a: p, b: p + 2 }); p += 2; continue; }
      if (t.is(p, '[')) { const close = t.close(p); if (close < 0 || close >= limit) break; parts.push({ field: false, a: p, b: close + 1 }); p = close + 1; continue; }
      if (t.is(p, '?')) { parts.push({ field: false, a: p, b: p + 1 }); p += 1; continue; }
      break;
    }
    // Resolve each read's owner left to right; a tuple index reads a struct only when the receiver's struct type is known.
    let type = simple ? annotations.get(enclosing(functions, k))?.get(t.ident(k)) ?? null : null;
    for (const part of parts) {
      if (part.position !== undefined) {
        const struct = type ? structs.get(type) : null;
        if (struct?.kind === 'tuple' && Number(part.position) < struct.fields.length) part.owner = type;
      } else if (part.field) {
        const candidates = owners.get(part.name);
        part.owner = type && structs.get(type)?.fields.some(field => field.name === part.name) ? type : candidates.length === 1 ? candidates[0] : null;
        if (!part.owner) throw refuse('ambiguous field read', `field ${part.name} belongs to ${candidates.join(', ')}; annotate the receiver with its struct type`, t.span(part.a, part.b));
      }
      const fieldName = part.position ?? part.name;
      const fieldType = part.owner ? structs.get(part.owner).fields.find(field => field.name === fieldName).type : null;
      type = fieldType && structs.has(fieldType) ? fieldType : null;
    }
    const first = parts.findIndex(part => part.owner);
    if (first < 0) return null;
    let current = renderText(k, parts[first].a);
    for (const part of parts.slice(first)) {
      if (!part.owner) { current += renderText(part.a, part.b); continue; }
      const fieldName = part.position ?? part.name;
      used.add(`${part.owner}.${fieldName}`);
      current = `${accessor(part.owner, fieldName, t.span(part.a, part.b))}(${current})`;
    }
    return { end: p, text: current, kind: 'rust-field-read', subject: parts.filter(part => part.owner).map(part => part.position ?? part.name).join('.') };
  }

  function construct(k, limit) {
    const struct = t.is(k, 'struct') ? [...structs.values()].find(item => item.start === k) : null;
    if (struct && struct.end <= limit) return { end: struct.end, text: () => structText(struct), kind: 'rust-struct', subject: struct.name };
    if (t.is(k, 'enum') && t.ident(k + 1) && t.is(k + 2, '{')) {
      const close = t.close(k + 2);
      if (close < 0 || close >= limit) return null;
      let out = t.raw(k, k + 3); let previous = k + 2;
      for (const [a, b] of splitTop(t, k + 3, close, ',', true) ?? []) {
        const variant = variants.get(`${t.ident(k + 1)}::${t.ident(a)}`);
        out += t.text.slice(t.list[previous].end, t.list[a].start);
        out += variant && variant.start === a ? `${variant.name}(${variant.fields.map(field => field.type).join(', ')})` : t.raw(a, b);
        previous = b - 1;
      }
      out += t.text.slice(t.list[previous].end, t.list[close].end);
      return { end: close + 1, text: out, kind: 'rust-struct-variant', subject: t.ident(k + 1) };
    }
    const value = t.ident(k);
    if (value && !RUST_KEYWORDS.has(value) && !t.is(k - 1, '.') && !t.is(k - 1, '::')) {
      const pathEnd = rustPathEnd(t, k);
      const segments = []; for (let p = k; p < pathEnd; p += 2) segments.push(t.ident(p));
      const last = segments.at(-1);
      if (t.is(pathEnd, '{') && !RUST_TYPE_CONTEXT.has(t.list[k - 1]?.value)) {
        const variant = segments.length >= 2 ? variants.get(`${segments.at(-2)}::${last}`) : null;
        if (variant) return literal(k, pathEnd, variant, true);
        if (structs.get(last)?.kind === 'named') return literal(k, pathEnd, structs.get(last), false);
      }
      if (t.is(pathEnd, '(') && structs.get(last)?.kind === 'tuple' && !['fn', 'struct', 'enum'].includes(t.ident(k - 1))) {
        const close = t.close(pathEnd);
        if (close > 0 && close < limit) {
          return { end: close + 1, text: `${t.raw(k, pathEnd)}::${last}(${renderText(pathEnd + 1, close)})`, kind: 'rust-tuple-struct', subject: last };
        }
      }
      return chain(k, limit);
    }
    if (t.is(k, '(') && !t.ident(k - 1) && !t.is(k - 1, ')')) return chain(k, limit);
    return null;
  }

  function walk(i, j, sink) {
    for (let k = i; k < j;) {
      const found = construct(k, j);
      if (found) { sink.put(k, found.end, found.text, found.kind, found.subject); k = found.end; } else { sink.copy(k); k += 1; }
    }
  }
  const sink = new EditSink(t);
  walk(0, t.length, sink);
  return { edits: sink.finish() };
}

// ---------------------------------------------------------------------------
// Lean.

const LEAN_COMMANDS = new Set(['def', 'theorem', 'lemma', 'inductive', 'structure', 'abbrev', 'instance', 'class', 'example']);
const LEAN_MODIFIERS = new Set(['private', 'protected', 'partial', 'noncomputable', 'unsafe', '@']);

/** Lean top-level commands: each starts at a column-0 token and runs to the next one. */
function leanItems(t) {
  const items = []; const namespaces = [];
  let start = 0;
  for (let k = 1; k <= t.length; k += 1) {
    if (k < t.length && t.column(k) !== 0) continue;
    if (start < k) items.push({ start, end: k });
    start = k;
  }
  for (const item of items) {
    let p = item.start;
    while (p < item.end && (LEAN_MODIFIERS.has(t.list[p].value) || (t.is(p, '[') && t.is(p - 1, '@')))) p = t.is(p, '[') ? t.close(p) + 1 : p + 1;
    item.keyword = p < item.end ? t.ident(p) : null; item.keywordIndex = p;
    if (item.keyword === 'namespace' && t.ident(p + 1)) namespaces.push(t.ident(p + 1));
    if (item.keyword === 'end' && t.ident(p + 1) === namespaces.at(-1)) namespaces.pop();
    item.namespace = [...namespaces];
  }
  return items;
}

/** Leading explicit `(α β : Type)` binder groups of a Lean declaration. */
function typeBinders(t, p, universes) {
  const params = [];
  while (t.is(p, '(')) {
    const close = t.close(p);
    const colon = (() => { for (let q = p + 1; q < close; q += 1) if (t.is(q, ':')) return q; return -1; })();
    if (colon < 0) break;
    const names = []; for (let q = p + 1; q < colon; q += 1) { if (!t.ident(q)) return { params, end: p }; names.push(t.ident(q)); }
    if (close === colon + 2 && universes.includes(t.ident(colon + 1))) { params.push(...names); p = close + 1; continue; }
    if (universes.includes(t.ident(colon + 1)) || t.is(colon + 1, 'Sort')) {
      throw refuse('universe-polymorphic type parameter', 'only (α : Type) parameters in the lowest universe are monomorphized', t.span(p, close + 1));
    }
    break;
  }
  return { params, end: p };
}

/** Next type argument of an application: a name or a parenthesized group (never a literal value). */
function atomEnd(t, q, limit) {
  if (q >= limit) return -1;
  if (t.is(q, '(')) { const close = t.close(q); return close > 0 && close < limit ? close + 1 : -1; }
  const token = t.list[q];
  if ((token.kind === 'identifier' && !LEAN_COMMANDS.has(token.value) && !['fun', 'match', 'with', 'then', 'else', 'if', 'do', 'let', 'by', 'where'].includes(token.value))) return q + 1;
  return -1;
}

/** Token mask of Lean/Rocq pattern positions: between an arm's `|` and its `=>`. */
function armPatternMask(t, items) {
  const mask = new Uint8Array(t.list.length);
  for (const item of items) {
    for (let k = item.start; k < item.end; k += 1) {
      if (!t.is(k, '|') || t.is(k + 1, '}')) continue;
      let q = k + 1;
      while (q < item.end && !t.is(q, '=>') && !t.is(q, '|') && !t.is(q, '.') && !t.is(q, 'end')) { if (t.opener(q)) { const close = t.close(q); if (close < 0) break; q = close; } q += 1; }
      if (t.is(q, '=>')) for (let r = k + 1; r < q; r += 1) mask[r] = 1;
    }
  }
  return mask;
}

function leanMonomorphize(text) {
  const t = lex(text, 'Lean');
  if (!t) return null;
  const items = leanItems(t);
  const templates = [];
  for (const item of items) {
    if (!['def', 'inductive', 'structure', 'abbrev'].includes(item.keyword) || !t.ident(item.keywordIndex + 1)) continue;
    const nameIndex = item.keywordIndex + 1;
    const { params, end } = typeBinders(t, nameIndex + 1, ['Type']);
    if (!params.length) continue;
    const name = t.ident(nameIndex);
    const ctors = [];
    if (item.keyword === 'inductive') for (let k = end; k < item.end; k += 1) if (t.is(k, '|') && t.ident(k + 1) && t.is(k + 2, ':')) ctors.push(t.ident(k + 1));
    if (item.keyword === 'structure') ctors.push(t.ident(end + 1) && t.is(end + 2, '::') ? t.ident(end + 1) : 'mk');
    templates.push({ name, fullName: [...item.namespace, name].join('.'), keyword: item.keyword, nameIndex, binderEnd: end, params, ctors, start: item.keywordIndex, end: item.end, item });
  }
  if (!templates.length) return null;
  const byName = new Map();
  for (const template of templates) { byName.set(template.fullName, template); if (!byName.has(template.name)) byName.set(template.name, template); }
  const instances = new Instances(t);
  const patterns = armPatternMask(t, items);
  const mangle = (template, args) => `${template.name}_${mangleSuffix(args)}`;
  const qualify = (written, template, instance) => (written === template.name ? instance.name : [...template.fullName.split('.').slice(0, -1), instance.name].join('.'));

  function typeArgs(k, template, context, limit) {
    const args = []; let q = k + 1;
    while (args.length < template.params.length) {
      const end = atomEnd(t, q, limit);
      if (end < 0) throw refuse('partial type application', `${template.name} needs ${template.params.length} explicit type argument(s)`, t.span(k, Math.max(k + 1, q)));
      const inner = new TextSink(t); render(t.is(q, '(') && end - q > 2 ? q + 1 : q, t.is(q, '(') && end - q > 2 ? end - 1 : end, { ...context, header: null }, inner);
      args.push(normalizeType(inner.out)); q = end;
    }
    return { args, end: q };
  }
  function render(i, j, context, sink) {
    for (let k = i; k < j; k += 1) {
      if (context.header && k === context.header.nameIndex) { sink.put(k, k + 1, context.header.name); k = context.header.binderEnd - 1; continue; }
      const value = t.ident(k);
      if (value && context.sigma?.has(value)) { sink.put(k, k + 1, context.sigma.get(value)); continue; }
      if (t.is(k, '@') && t.ident(k + 1)) {
        const dot = t.ident(k + 1).lastIndexOf('.');
        const template = dot > 0 ? byName.get(t.ident(k + 1).slice(0, dot)) : null;
        if (template?.ctors.includes(t.ident(k + 1).slice(dot + 1))) {
          const { args, end } = typeArgs(k + 1, template, context, j);
          const instance = instances.get(template, args, t.span(k, end), mangle);
          context.collect?.add(instance.key);
          sink.put(k, end, `${qualify(t.ident(k + 1).slice(0, dot), template, instance)}.${t.ident(k + 1).slice(dot + 1)}`, 'lean-instantiation', instance.key);
          k = end - 1; continue;
        }
      }
      const template = value ? byName.get(value) : null;
      if (template && !(context.header && k === context.header.nameIndex)) {
        const { args, end } = typeArgs(k, template, context, j);
        const instance = instances.get(template, args, t.span(k, end), mangle);
        context.collect?.add(instance.key);
        sink.put(k, end, qualify(value, template, instance), 'lean-instantiation', instance.key);
        k = end - 1; continue;
      }
      const dot = value ? value.lastIndexOf('.') : -1;
      const owner = dot > 0 ? byName.get(value.slice(0, dot)) : null;
      if (owner?.ctors.includes(value.slice(dot + 1)) && !t.is(k - 1, '@')) {
        if (context.discover) { sink.copy(k); continue; }
        if (!patterns[k]) {
          throw refuse('value of a generic type without explicit instantiation', `write @${value} with its type arguments so RML can monomorphize the value (RML does not infer type arguments)`, t.span(k));
        }
        const instance = instances.pick(owner, context.local, t.span(k), 'pattern of a generic type with several instantiations');
        sink.put(k, k + 1, `${qualify(value.slice(0, dot), owner, instance)}.${value.slice(dot + 1)}`, 'lean-instantiation', instance.key);
        continue;
      }
      sink.copy(k);
    }
  }
  return monomorphizeItems(t, items, templates, instances, render, 'lean-monomorphize', 'lean-instantiation');
}

/** Shared driver for the Lean and Rocq item-level monomorphizers. */
function monomorphizeItems(t, items, templates, instances, render, kind, referenceKind) {
  const isTemplate = item => templates.some(template => template.item === item);
  const localCache = new Map();
  const localOf = item => {
    if (!localCache.has(item)) { const collect = new Set(); render(item.start, item.end, { discover: true, collect }, new TextSink(t)); localCache.set(item, collect); }
    return localCache.get(item);
  };
  const renderInstance = (instance, discover) => {
    const { template } = instance;
    const header = { nameIndex: template.nameIndex, binderEnd: template.binderEnd, name: instance.name };
    if (!discover && !instance.local) { const collect = new Set(); render(template.start, template.end, { sigma: instance.sigma, header, discover: true, collect }, new TextSink(t)); instance.local = collect; }
    const sink = new TextSink(t);
    render(template.start, template.end, { sigma: instance.sigma, header, discover, local: instance.local, collect: discover ? new Set() : null }, sink);
    return sink.out;
  };
  for (const item of items) if (!isTemplate(item)) localOf(item);
  for (let index = 0; index < instances.queue.length; index += 1) renderInstance(instances.queue[index], true);
  requireInstantiated(templates, instances, t, 'generic declaration without explicit instantiation');
  const sink = new EditSink(t);
  for (const item of items) {
    if (isTemplate(item)) continue;
    render(item.start, item.end, { local: localOf(item) }, { copy() {}, put: (i, j, text, editKind, subject) => sink.put(i, j, text, editKind ?? referenceKind, subject) });
  }
  for (const template of templates) {
    sink.put(template.start, template.end, instances.of(template).map(instance => renderInstance(instance, false)).join('\n\n'), kind, `${template.name} ${template.params.join(' ')}`);
  }
  return { edits: sink.finish() };
}

function leanStructures(text) {
  const t = lex(text, 'Lean');
  if (!t) return null;
  const items = leanItems(t);
  const structures = new Map();
  for (const item of items) {
    if (item.keyword !== 'structure') continue;
    const k = item.keywordIndex; const name = t.ident(k + 1);
    if (!name || name.includes('.')) throw refuse('qualified structure name', 'declare the structure inside its namespace', t.span(k, k + 2));
    if (t.is(k + 2, '(') || t.is(k + 2, '{') || t.is(k + 2, '[')) throw refuse('parameterised structure', 'only (α : Type) parameters are monomorphized; value parameters are outside RML lowering', t.span(k + 2));
    if (t.is(k + 2, 'extends')) throw refuse('structure extension', 'extends is outside RML lowering', t.span(k + 2));
    let p = k + 2;
    if (t.is(p, ':')) { if (!t.is(p + 1, 'Type')) throw refuse('structure universe', 'only structures in Type are lowered', t.span(p, p + 2)); p += 2; }
    if (!t.is(p, 'where')) throw refuse('structure', 'expected `where` and the fields', t.span(k, p + 1));
    p += 1;
    let ctor = 'mk';
    if (t.ident(p) && t.is(p + 1, '::')) { ctor = t.ident(p); p += 2; }
    let derivingIndex = item.end;
    for (let q = p; q < item.end; q += 1) if (t.is(q, 'deriving')) { derivingIndex = q; break; }
    const fields = [];
    const fieldColumn = p < derivingIndex ? t.column(p) : 0;
    let q = p;
    while (q < derivingIndex) {
      let entryEnd = q + 1;
      if (t.is(q, '(')) entryEnd = t.close(q) + 1;
      else while (entryEnd < derivingIndex && !(t.column(entryEnd) === fieldColumn && /\n/u.test(t.gap(entryEnd)))) entryEnd += 1;
      const [a, b] = t.is(q, '(') ? [q + 1, entryEnd - 1] : [q, entryEnd];
      let colon = a; while (colon < b && !t.is(colon, ':')) colon += 1;
      const names = []; for (let r = a; r < colon; r += 1) { if (!t.ident(r)) throw refuse('structure field', 'expected `name : Type`', t.span(a, b)); names.push(t.ident(r)); }
      if (colon >= b || !names.length) throw refuse('structure field', 'expected `name : Type`', t.span(a, Math.max(a + 1, b)));
      let typeEnd = colon + 1; while (typeEnd < b && !t.is(typeEnd, ':=')) typeEnd += 1;
      if (typeEnd < b) throw refuse('structure field default', 'default field values are outside RML lowering', t.span(typeEnd, b));
      const type = flat(t.raw(colon + 1, b));
      const mentions = t.list.slice(colon + 1, b).filter(token => token.kind === 'identifier').map(token => token.value);
      const earlier = fields.find(field => mentions.includes(field.name));
      if (earlier) throw refuse('dependent structure field', `the type of ${names[0]} mentions the earlier field ${earlier.name}`, t.span(colon + 1, b));
      for (const fieldName of names) fields.push({ name: fieldName, type });
      q = entryEnd;
    }
    if (!fields.length) throw refuse('empty structure', 'a structure without fields is outside RML lowering', t.span(k, k + 2));
    structures.set(name, { name, ctor, fields, keywordIndex: k, end: item.end, derivingIndex, item });
  }
  if (!structures.size) return null;
  const identifiers = t.identifiers();
  for (const reserved of ['ml_field']) if (identifiers.has(reserved)) throw refuse('generated name collision', `${reserved} is reserved for generated projections`, t.span(0));
  const owners = new Map();
  for (const structure of structures.values()) for (const field of structure.fields) owners.set(field.name, [...(owners.get(field.name) ?? []), structure.name]);
  const globals = new Set(['IO', 'Nat', 'Int', 'String', 'Bool', 'List', 'Float', 'Option', 'Unit', 'Char', 'Array']);
  for (const item of items) if (t.ident(item.keywordIndex + 1)) globals.add(t.ident(item.keywordIndex + 1).split('.')[0]);
  const annotations = new Map();
  for (const item of items) {
    const map = new Map();
    for (let k = item.start; k < item.end; k += 1) {
      if (!t.is(k, '(')) continue;
      const close = t.close(k); let colon = k + 1;
      while (colon < close && t.ident(colon)) colon += 1;
      if (t.is(colon, ':') && close === colon + 2 && structures.has(t.ident(colon + 1))) for (let r = k + 1; r < colon; r += 1) map.set(t.ident(r), t.ident(colon + 1));
    }
    annotations.set(item, map);
  }
  const itemOf = k => items.find(item => item.start <= k && k < item.end);
  const wrap = text => (/\s/u.test(text) && !/^\(.*\)$/su.test(text) ? `(${text})` : text);
  const fieldOwner = (name, type, span) => {
    if (type && structures.get(type)?.fields.some(field => field.name === name)) return type;
    const candidates = owners.get(name) ?? [];
    if (candidates.length === 1) return candidates[0];
    throw refuse('ambiguous field read', `field ${name} belongs to ${candidates.join(', ')}; annotate the receiver with its structure type`, span);
  };
  const projectChain = (base, fieldsRead, type, span) => {
    let current = base;
    for (const field of fieldsRead) {
      const owner = fieldOwner(field, type, span);
      current = `(${owner}.${field} ${wrap(current)})`;
      const fieldType = structures.get(owner).fields.find(entry => entry.name === field).type;
      type = structures.has(fieldType) ? fieldType : null;
    }
    return current;
  };
  const structureText = structure => {
    const arrow = structure.fields.map(field => (/→|->|×/u.test(field.type) ? `(${field.type})` : field.type)).join(' → ');
    const deriving = structure.derivingIndex < structure.end ? `\n${flat(t.raw(structure.derivingIndex, structure.end))}` : '';
    const projections = structure.fields.map((field, index) => {
      const binds = structure.fields.map((_, position) => (position === index ? 'ml_field' : '_')).join(' ');
      return `def ${field.name} : ${structure.name} → ${field.type}\n  | ${structure.name}.${structure.ctor} ${binds} => ml_field`;
    });
    return `inductive ${structure.name} where\n  | ${structure.ctor} : ${arrow} → ${structure.name}${deriving}\n\nnamespace ${structure.name}\n\n${projections.join('\n\n')}\n\nend ${structure.name}`;
  };
  const renderText = (i, j) => { const sink = new TextSink(t); walk(i, j, sink); return sink.out; };

  function instance(k, limit) {
    const close = t.close(k);
    if (close < 0 || close > limit) return null;
    if (t.ident(k + 1) && t.is(k + 2, 'with')) throw refuse('structure update', '{ s with … } is outside RML lowering; write every field', t.span(k, close + 1));
    if (!(t.ident(k + 1) && t.is(k + 2, ':='))) return null;
    const starts = [];
    for (let p = k + 1; p < close; p += 1) {
      if (t.opener(p)) { p = t.close(p); continue; }
      if (t.ident(p) && t.is(p + 1, ':=') && (p === k + 1 || t.is(p - 1, ',') || /\n/u.test(t.gap(p)))) starts.push(p);
    }
    const given = []; let ascribed = null;
    starts.forEach((start, index) => {
      let end = index + 1 < starts.length ? starts[index + 1] : close;
      if (t.is(end - 1, ',')) end -= 1;
      if (index + 1 === starts.length) {
        for (let p = start + 2; p < end; p += 1) { if (t.opener(p)) { p = t.close(p); continue; } if (t.is(p, ':')) { ascribed = t.ident(p + 1); end = p; break; } }
      }
      given.push({ name: t.ident(start), value: [start + 2, end] });
    });
    const names = given.map(entry => entry.name).sort().join(' ');
    const candidates = [...structures.values()].filter(structure => (ascribed ? structure.name === ascribed : structure.fields.map(field => field.name).sort().join(' ') === names));
    if (candidates.length !== 1) throw refuse('structure instance', ascribed ? `${ascribed} is not a lowered structure` : `the fields {${names}} do not name exactly one structure; ascribe the type`, t.span(k, close + 1));
    const [structure] = candidates;
    const values = structure.fields.map(field => {
      const entry = given.find(item => item.name === field.name);
      if (!entry) throw refuse('structure instance missing field', `${structure.name} instance omits ${field.name}`, t.span(k, close + 1));
      return wrap(flat(renderText(...entry.value)));
    });
    if (given.length !== structure.fields.length) throw refuse('unknown structure field', `${structure.name} instance names a field it does not declare`, t.span(k, close + 1));
    return { end: close + 1, text: `(${structure.name}.${structure.ctor} ${values.join(' ')})`, kind: 'lean-structure-instance', subject: structure.name };
  }

  function construct(k, limit) {
    const structure = t.is(k, 'structure') ? [...structures.values()].find(item => item.keywordIndex === k) : null;
    if (structure) return { end: structure.end, text: structureText(structure), kind: 'lean-structure', subject: structure.name };
    if (t.is(k, '{')) return instance(k, limit);
    const value = t.ident(k);
    if (value && value.includes('.') && !t.is(k - 1, '@')) {
      const [base, ...rest] = value.split('.');
      if (!globals.has(base) && /^[\p{Ll}_]/u.test(base) && rest.length && rest.every(field => owners.has(field))) {
        const type = annotations.get(itemOf(k))?.get(base) ?? null;
        return { end: k + 1, text: projectChain(base, rest, type, t.span(k)), kind: 'lean-field-read', subject: rest.join('.') };
      }
    }
    if (t.is(k, '(')) {
      const close = t.close(k);
      if (close > 0 && close + 2 <= limit && t.is(close + 1, '.') && t.adjacent(close + 1) && t.ident(close + 2) && t.adjacent(close + 2)) {
        const fieldsRead = t.ident(close + 2).split('.');
        if (fieldsRead.every(field => owners.has(field))) {
          return { end: close + 3, text: projectChain(renderText(k, close + 1), fieldsRead, null, t.span(close + 1, close + 3)), kind: 'lean-field-read', subject: fieldsRead.join('.') };
        }
      }
    }
    return null;
  }
  function walk(i, j, sink) {
    for (let k = i; k < j;) {
      const found = construct(k, j);
      if (found) { sink.put(k, found.end, found.text, found.kind, found.subject); k = found.end; } else { sink.copy(k); k += 1; }
    }
  }
  const sink = new EditSink(t);
  walk(0, t.length, sink);
  return { edits: sink.finish() };
}

// ---------------------------------------------------------------------------
// Rocq.

/** Rocq sentences: each ends at a `.` followed by whitespace or the end of input. */
function rocqItems(t) {
  const items = []; let start = 0;
  for (let k = 0; k < t.length; k += 1) {
    if (t.is(k, '.') && (k + 1 >= t.length || /^\s/u.test(t.text.slice(t.list[k].end, t.list[k].end + 1)))) {
      items.push({ start, end: k + 1, keyword: t.ident(start), keywordIndex: start }); start = k + 1;
    }
  }
  if (start < t.length) items.push({ start, end: t.length, keyword: t.ident(start), keywordIndex: start });
  return items;
}

function rocqPatternMask(t) {
  const mask = new Uint8Array(t.list.length);
  for (let k = 0; k < t.length; k += 1) {
    if (!t.is(k, 'with')) continue;
    // Only `match … with` arms: walk back to an unmatched `match` at this depth.
    let depth = 0; let p = k - 1; let isMatch = false;
    while (p >= 0) {
      if (t.is(p, ')') || t.is(p, ']') || t.is(p, '}')) { p = t.open(p); if (p < 0) break; }
      else if (t.is(p, 'with') || t.is(p, '.')) break;
      else if (t.is(p, 'end')) depth += 1;
      else if (t.is(p, 'match')) { if (depth === 0) { isMatch = true; break; } depth -= 1; }
      p -= 1;
    }
    if (!isMatch) continue;
    let q = k + 1; let armStart = q; let nested = 0; let inPattern = true;
    while (q < t.length) {
      if (t.opener(q)) { const close = t.close(q); if (close < 0) break; if (inPattern) for (let r = q; r <= close; r += 1) mask[r] = 1; q = close + 1; continue; }
      if (t.is(q, 'match')) nested += 1;
      if (t.is(q, 'end')) { if (nested === 0) break; nested -= 1; }
      if (nested === 0 && t.is(q, '|') && !inPattern) { inPattern = true; armStart = q + 1; }
      else if (nested === 0 && t.is(q, '=>') && inPattern) { for (let r = armStart; r < q; r += 1) mask[r] = 1; inPattern = false; }
      else if (inPattern) mask[q] = 1;
      q += 1;
    }
  }
  return mask;
}

function rocqMonomorphize(text) {
  const t = lex(text, 'Rocq');
  if (!t) return null;
  const items = rocqItems(t);
  const templates = [];
  for (const item of items) {
    if (!['Inductive', 'Definition', 'Fixpoint'].includes(item.keyword) || !t.ident(item.keywordIndex + 1)) continue;
    const nameIndex = item.keywordIndex + 1;
    const { params, end } = typeBinders(t, nameIndex + 1, ['Type', 'Set']);
    if (!params.length) continue;
    for (let k = end; k < item.end; k += 1) if (t.is(k, 'with')) {
      if (item.keyword === 'Inductive') throw refuse('mutual inductive', 'mutually inductive parameterised types are outside RML lowering', t.span(k));
    }
    const ctors = [];
    if (item.keyword === 'Inductive') {
      for (let k = end; k < item.end; k += 1) if ((t.is(k - 1, '|') || t.is(k - 1, ':=')) && t.ident(k) && t.is(k + 1, ':')) ctors.push(t.ident(k));
    }
    templates.push({ name: t.ident(nameIndex), keyword: item.keyword, nameIndex, binderEnd: end, params, ctors, start: item.keywordIndex, end: item.end, item });
  }
  if (!templates.length) return null;
  const byName = new Map(templates.map(template => [template.name, template]));
  const ctorOwner = new Map(templates.flatMap(template => template.ctors.map(ctor => [ctor, template])));
  const instances = new Instances(t);
  const patterns = rocqPatternMask(t);
  const mangle = (template, args) => `${template.name}_${mangleSuffix(args)}`;
  const args = (k, template, context, limit) => {
    const values = []; let q = k + 1;
    while (values.length < template.params.length) {
      const end = atomEnd(t, q, limit);
      if (end < 0) return null;
      const inner = new TextSink(t); render(t.is(q, '(') ? q + 1 : q, t.is(q, '(') ? end - 1 : end, { ...context, header: null }, inner);
      values.push(normalizeType(inner.out)); q = end;
    }
    return { values, end: q };
  };
  function render(i, j, context, sink) {
    for (let k = i; k < j; k += 1) {
      if (context.header && k === context.header.nameIndex) { sink.put(k, k + 1, context.header.name); k = context.header.binderEnd - 1; continue; }
      const value = t.ident(k);
      if (value && context.sigma?.has(value)) { sink.put(k, k + 1, context.sigma.get(value)); continue; }
      const template = value ? byName.get(value) : null;
      if (template) {
        const applied = args(k, template, context, j);
        if (!applied) throw refuse('partial type application', `${value} needs ${template.params.length} explicit type argument(s)`, t.span(k));
        const instance = instances.get(template, applied.values, t.span(k, applied.end), mangle);
        context.collect?.add(instance.key);
        sink.put(k, applied.end, instance.name, 'rocq-instantiation', instance.key);
        k = applied.end - 1; continue;
      }
      const owner = value ? ctorOwner.get(value) : null;
      if (owner) {
        if (context.sigma && context.header && (t.is(k - 1, '|') || t.is(k - 1, ':=')) && t.is(k + 1, ':') && owner === context.template) {
          sink.put(k, k + 1, `${value}_${context.suffix}`); continue;
        }
        if (patterns[k]) {
          if (context.discover) { sink.copy(k); continue; }
          const instance = instances.pick(owner, context.local, t.span(k), 'pattern of a generic type with several instantiations');
          sink.put(k, k + 1, `${value}_${instance.suffix}`, 'rocq-instantiation', instance.key); continue;
        }
        const applied = args(k, owner, context, j);
        if (!applied) throw refuse('constructor without its parameters', `${value} needs ${owner.params.length} explicit type argument(s)`, t.span(k));
        const instance = instances.get(owner, applied.values, t.span(k, applied.end), mangle);
        context.collect?.add(instance.key);
        sink.put(k, applied.end, `${value}_${instance.suffix}`, 'rocq-instantiation', instance.key);
        k = applied.end - 1; continue;
      }
      sink.copy(k);
    }
  }
  const wrapped = (i, j, context, sink) => render(i, j, context.header ? { ...context, template: templates.find(entry => entry.nameIndex === context.header.nameIndex), suffix: mangleSuffix([...context.sigma.values()]) } : context, sink);
  return monomorphizeItems(t, items, templates, instances, wrapped, 'rocq-monomorphize', 'rocq-instantiation');
}

function rocqRecords(text) {
  const t = lex(text, 'Rocq');
  if (!t) return null;
  const items = rocqItems(t);
  const records = new Map();
  for (const item of items) {
    if (!['Record', 'Structure'].includes(item.keyword)) continue;
    const k = item.keywordIndex; const name = t.ident(k + 1);
    if (!name) throw refuse('record', 'expected a record name', t.span(k));
    let p = k + 2;
    if (t.is(p, '(') || t.is(p, '{')) throw refuse('parameterised record', 'only (A : Type) parameters are monomorphized; value parameters are outside RML lowering', t.span(p));
    if (t.is(p, ':')) { if (!['Type', 'Set'].includes(t.ident(p + 1))) throw refuse('record universe', 'only records in Type or Set are lowered', t.span(p, p + 2)); p += 2; }
    if (!t.is(p, ':=')) throw refuse('record', 'expected := and the fields', t.span(k, p + 1));
    p += 1;
    let ctor = `Build_${name}`;
    if (t.ident(p) && t.is(p + 1, '{')) { ctor = t.ident(p); p += 1; }
    if (!t.is(p, '{') || t.close(p) < 0) throw refuse('record', 'expected the field block', t.span(p));
    const close = t.close(p);
    const fields = [];
    for (const [a, b] of splitTop(t, p + 1, close, ';') ?? []) {
      if (!t.ident(a) || !t.is(a + 1, ':')) throw refuse('record field', 'expected `name : type`', t.span(a, b));
      const mentions = t.list.slice(a + 2, b).filter(token => token.kind === 'identifier').map(token => token.value);
      const earlier = fields.find(field => mentions.includes(field.name));
      if (earlier) throw refuse('dependent record field', `the type of ${t.ident(a)} mentions the earlier field ${earlier.name}`, t.span(a, b));
      if (t.list.slice(a + 2, b).some(token => token.value === ':=')) throw refuse('record field default', 'defined fields are outside RML lowering', t.span(a, b));
      fields.push({ name: t.ident(a), type: flat(t.raw(a + 2, b)) });
    }
    if (!fields.length) throw refuse('empty record', 'a record without fields is outside RML lowering', t.span(k, close + 1));
    records.set(name, { name, ctor, fields, start: k, end: item.end });
  }
  const owners = new Map();
  for (const record of records.values()) for (const field of record.fields) owners.set(field.name, record.name);
  let hasInstance = false;
  for (let k = 0; k < t.length; k += 1) if ((t.is(k, '{') && t.is(k + 1, '|') && t.adjacent(k + 1)) || (t.is(k, '.') && t.is(k + 1, '(') && t.adjacent(k + 1))) hasInstance = true;
  if (!records.size && !hasInstance) return null;
  const identifiers = t.identifiers();
  for (const reserved of ['ml_record', 'ml_field']) if (identifiers.has(reserved)) throw refuse('generated name collision', `${reserved} is reserved for generated projections`, t.span(0));
  const wrap = text => (/\s/u.test(text) && !/^\(.*\)$/su.test(text) ? `(${text})` : text);
  const recordText = record => {
    const arrow = record.fields.map(field => (/->|\*/u.test(field.type) ? `(${field.type})` : field.type)).join(' -> ');
    const projections = record.fields.map((field, index) => {
      const binds = record.fields.map((_, position) => (position === index ? 'ml_field' : '_')).join(' ');
      return `Definition ${field.name} (ml_record : ${record.name}) : ${field.type} :=\n  match ml_record with\n  | ${record.ctor} ${binds} => ml_field\n  end.`;
    });
    return `Inductive ${record.name} : Type :=\n  | ${record.ctor} : ${arrow} -> ${record.name}.\n\n${projections.join('\n\n')}`;
  };
  const renderText = (i, j) => { const sink = new TextSink(t); walk(i, j, sink); return sink.out; };
  const projected = (k, primary, limit) => {
    let { end: p, text: current } = primary; const read = [];
    while (p + 4 <= limit && t.is(p, '.') && t.adjacent(p) && t.is(p + 1, '(') && t.adjacent(p + 1) && owners.has(t.ident(p + 2)) && t.is(p + 3, ')')) {
      current = `(${t.ident(p + 2)} ${wrap(current)})`; read.push(t.ident(p + 2)); p += 4;
    }
    return read.length ? { end: p, text: current, kind: 'rocq-projection', subject: read.join('.') } : primary;
  };
  function construct(k, limit) {
    const record = [...records.values()].find(item => item.start === k);
    if (record) return { end: record.end, text: recordText(record), kind: 'rocq-record', subject: record.name };
    const value = instance(k, limit);
    if (value) return projected(k, value, limit);
    const primaryEnd = t.ident(k) ? k + 1 : t.is(k, '(') && t.close(k) > 0 && t.close(k) < limit ? t.close(k) + 1 : -1;
    if (primaryEnd < 0 || !(t.is(primaryEnd, '.') && t.adjacent(primaryEnd) && t.is(primaryEnd + 1, '('))) return null;
    const primary = { end: primaryEnd, text: t.ident(k) ? t.raw(k, k + 1) : `(${renderText(k + 1, primaryEnd - 1)})` };
    const found = projected(k, primary, limit);
    return found === primary ? null : found;
  }
  function instance(k, limit) {
    if (t.is(k, '{') && t.is(k + 1, '|') && t.adjacent(k + 1)) {
      const close = t.close(k);
      if (close < 0 || close > limit || !t.is(close - 1, '|')) return null;
      const given = [];
      for (const [a, b] of splitTop(t, k + 2, close - 1, ';') ?? []) {
        if (!t.ident(a) || !t.is(a + 1, ':=')) throw refuse('record instance field', 'expected `field := value`', t.span(a, b));
        given.push({ name: t.ident(a), value: [a + 2, b] });
      }
      const names = given.map(entry => entry.name).sort().join(' ');
      const candidates = [...records.values()].filter(item => item.fields.map(field => field.name).sort().join(' ') === names);
      if (candidates.length !== 1) throw refuse('record instance', `the fields {${names}} do not name exactly one record`, t.span(k, close + 1));
      const [target] = candidates;
      const values = target.fields.map(field => wrap(flat(renderText(...given.find(entry => entry.name === field.name).value))));
      return { end: close + 1, text: `(${target.ctor} ${values.join(' ')})`, kind: 'rocq-record-instance', subject: target.name };
    }
    return null;
  }
  function walk(i, j, sink) {
    for (let k = i; k < j;) {
      const found = construct(k, j);
      if (found) { sink.put(k, found.end, found.text, found.kind, found.subject); k = found.end; } else { sink.copy(k); k += 1; }
    }
  }
  const sink = new EditSink(t);
  walk(0, t.length, sink);
  return { edits: sink.finish() };
}

// ---------------------------------------------------------------------------
// The lowering driver.

const PASSES = Object.freeze({
  JavaScript: [],
  Rust: [rustMonomorphize, rustStructs],
  Lean: [leanMonomorphize, leanStructures],
  Rocq: [rocqMonomorphize, rocqRecords],
});

/**
 * Lower `source` for `language`. Returns the lowered text, the recorded rewrites in original
 * coordinates and `map(span)`, which maps a span of the lowered text back to the original.
 * Throws a TranslationError (kind `unsupported`) with an original-source span on refusal.
 */
export function lowerSurface(source, language) {
  const text = String(source);
  const maps = [];
  const toOriginal = span => maps.reduceRight((current, map) => map(current), span);
  const rewrites = [];
  let current = text;
  for (const pass of PASSES[language] ?? []) {
    let result;
    try { result = pass(current); } catch (error) {
      if (error instanceof TranslationError && error.span) error.span = toOriginal(error.span);
      throw error;
    }
    if (!result?.edits.length) continue;
    const applied = applyEdits(current, result.edits);
    for (const edit of result.edits) rewrites.push({ kind: edit.kind, subject: String(edit.subject ?? ''), ...toOriginal({ start: edit.start, end: edit.end }) });
    maps.push(applied.map);
    current = applied.text;
  }
  rewrites.sort((left, right) => left.start - right.start || left.end - right.end || left.kind.localeCompare(right.kind));
  return { schema: SURFACE_LOWERING_SCHEMA, text: current, changed: current !== text, rewrites, map: span => (span ? toOriginal(span) : span) };
}
