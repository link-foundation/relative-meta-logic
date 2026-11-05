/** Strict transport for addressed typed links networks. The codec fixes only UTF-8,
 * framing, roots and the two declared edge roles; it adds no inference rules,
 * default ontology, type universes, proof admission or soundness claims.
 */
import { TypedLinkNetwork } from './rml-theory-network.mjs';

const HEADER = 'RML-TYPED-LINKS/1\n';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const DEFAULT_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxLinks: 100_000, maxFieldBytes: 65536 });
const order = (a, b) => {
  const left = [...a].map(c => c.codePointAt(0));
  const right = [...b].map(c => c.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
};
function limits(options) {
  const result = { ...DEFAULT_LIMITS, ...options };
  for (const [key, value] of Object.entries(result)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`archive ${key} must be a positive safe integer`);
  return result;
}
function fields(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) throw new Error('archive contains unrepresented metadata');
}
function scalar(text, bounds) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('archive references must be non-empty strings');
  if (text.length > bounds.maxFieldBytes) throw new Error('archive field limit exceeded');
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) throw new Error('archive reference is not valid Unicode');
  }
  const bytes = encoder.encode(text);
  if (bytes.length > bounds.maxFieldBytes) throw new Error('archive field limit exceeded');
  return bytes;
}

class TypedSemanticArchive {
  #snapshot;
  #roots;
  #bounds;
  #links;

  static fromNetwork(network, { roots = [], ...options } = {}) {
    return new TypedSemanticArchive(network.snapshot(), { roots, ...options });
  }
  constructor(snapshot, { roots = [], ...options } = {}) {
    this.#bounds = limits(options);
    fields(snapshot, ['links', 'typeFacts']);
    if (!Array.isArray(snapshot.links) || !Array.isArray(snapshot.typeFacts) || !Array.isArray(roots)) throw new Error('archive tables and roots must be lists');
    if (snapshot.links.length + snapshot.typeFacts.length > this.#bounds.maxLinks || roots.length > this.#bounds.maxLinks) throw new Error('archive link limit exceeded');
    let total = 0;
    const check = value => { total += scalar(value, this.#bounds).length; if (total > this.#bounds.maxBytes) throw new Error('archive byte limit exceeded'); };
    for (const row of snapshot.links) { fields(row, ['address', 'source', 'target']); Object.values(row).forEach(check); }
    for (const row of snapshot.typeFacts) { fields(row, ['address', 'subject', 'type']); Object.values(row).forEach(check); }
    const network = TypedLinkNetwork.fromSnapshot(snapshot, { requireClosed: true });
    this.#snapshot = network.snapshot();
    this.#snapshot.links.sort((a, b) => order(a.address, b.address));
    this.#snapshot.typeFacts.sort((a, b) => order(a.address, b.address));
    this.#links = new Map([
      ...this.#snapshot.links.map(row => [row.address, { source: row.source, target: row.target }]),
      ...this.#snapshot.typeFacts.map(row => [row.address, { source: row.subject, target: row.type }]),
    ]);
    for (const root of roots) {
      scalar(root, this.#bounds);
      if (!this.#links.has(root)) throw new Error(`archive root ${root} is undefined`);
    }
    if (new Set(roots).size !== roots.length) throw new Error('archive repeats a root');
    this.#roots = [...roots];
  }
  get roots() { return [...this.#roots]; }
  snapshot() { return structuredClone(this.#snapshot); }
  doublet(address) { const link = this.#links.get(address); return link ? { ...link } : null; }
  toTypedNetwork() { return TypedLinkNetwork.fromSnapshot(this.#snapshot, { requireClosed: true }); }

  serialize() {
    const parts = []; let size = 0;
    const append = bytes => { size += bytes.length; if (size > this.#bounds.maxBytes) throw new Error('archive byte limit exceeded'); parts.push(bytes); };
    const text = value => append(encoder.encode(value));
    const field = value => { const bytes = scalar(value, this.#bounds); text(`${bytes.length}:`); append(bytes); };
    text(HEADER); text(`${this.#roots.length}\n`);
    for (const root of this.#roots) { field(root); text('\n'); }
    text(`${this.#snapshot.links.length}\n`);
    for (const row of this.#snapshot.links) { [row.address, row.source, row.target].forEach(field); text('\n'); }
    text(`${this.#snapshot.typeFacts.length}\n`);
    for (const row of this.#snapshot.typeFacts) { [row.address, row.subject, row.type].forEach(field); text('\n'); }
    const output = new Uint8Array(size); let at = 0;
    for (const part of parts) { output.set(part, at); at += part.length; }
    return output;
  }

  static deserialize(input, options = {}) {
    const bounds = limits(options);
    if (!(input instanceof Uint8Array)) throw new Error('archive input must be bytes');
    if (input.length > bounds.maxBytes) throw new Error('archive byte limit exceeded');
    let at = 0;
    const expect = expected => { if (input[at++] !== expected) throw new Error('invalid archive framing'); };
    for (const byte of encoder.encode(HEADER)) expect(byte);
    const natural = end => {
      const start = at; let value = 0;
      while (at < input.length && input[at] !== end) {
        const digit = input[at++] - 48;
        if (digit < 0 || digit > 9 || at - start > 16) throw new Error('invalid archive length');
        value = value * 10 + digit;
        if (!Number.isSafeInteger(value)) throw new Error('invalid archive length');
      }
      if (at === start || at - start > 1 && input[start] === 48) throw new Error('non-canonical archive length');
      expect(end); return value;
    };
    const field = () => {
      const length = natural(58);
      if (length === 0 || length > bounds.maxFieldBytes) throw new Error('archive field limit exceeded');
      if (length > input.length - at) throw new Error('truncated archive field');
      const value = decoder.decode(input.subarray(at, at + length)); at += length; return value;
    };
    const count = () => { const value = natural(10); if (value > bounds.maxLinks) throw new Error('archive link limit exceeded'); return value; };
    const roots = []; const rootCount = count();
    for (let i = 0; i < rootCount; i++) { roots.push(field()); expect(10); }
    const links = []; const linkCount = count();
    for (let i = 0; i < linkCount; i++) { links.push({ address: field(), source: field(), target: field() }); expect(10); }
    const typeFacts = []; const factCount = count();
    if (linkCount + factCount > bounds.maxLinks) throw new Error('archive link limit exceeded');
    for (let i = 0; i < factCount; i++) { typeFacts.push({ address: field(), subject: field(), type: field() }); expect(10); }
    if (at !== input.length) throw new Error('archive has trailing bytes');
    return new TypedSemanticArchive({ links, typeFacts }, { roots, ...bounds });
  }
}

export { TypedSemanticArchive };
