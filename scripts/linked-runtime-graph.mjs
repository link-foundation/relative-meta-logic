/** A source-free value/AST archive made only of addressed, ordered Links.
 * Byte and record roles are conventions of this codec, explicitly trusted.
 * Every link consists only of references to earlier links; no source text,
 * token buffer, executable metadata, or host object is stored in the archive.
 */
export const LINKED_RUNTIME_SCHEMA = 'rml-linked-implementation/v1';
const STRING = 257, NUMBER = 258, ARRAY = 259, OBJECT = 260, ENTRY = 261;
const FALSE = 262, TRUE = 263, NIL = 264;
const ANCHORS = 265;
export const DEFAULT_LINK_LIMITS = Object.freeze({ maxLinks: 2_000_000, maxReferences: 20_000_000, maxDepth: 512, maxExpandedNodes: 5_000_000, maxTextUnits: 16_000_000 });

function limitsFor(options) {
  const limits = { ...DEFAULT_LINK_LIMITS, ...options };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('positive safe linked-archive limits required');
  return limits;
}

export function encodeLinkedValues(value, options = {}) {
  const limits = limitsFor(options);
  const links = Array.from({ length: ANCHORS }, (_, index) => index ? [index - 1] : []);
  const interned = new Map(links.map((references, id) => [JSON.stringify(references), id]));
  const ancestors = new Set();
  let visits = 0, references = ANCHORS - 1, textUnits = 0;
  const intern = refs => {
    const key = JSON.stringify(refs), previous = interned.get(key);
    if (previous !== undefined) return previous;
    if (links.length >= limits.maxLinks || (references += refs.length) > limits.maxReferences) throw new RangeError('linked archive size budget exceeded');
    const id = links.length; links.push(refs); interned.set(key, id); return id;
  };
  function encode(value, depth) {
    if (++visits > limits.maxExpandedNodes || depth > limits.maxDepth) throw new RangeError('linked archive expansion budget exceeded');
    if (value === null) return NIL;
    if (value === false) return FALSE;
    if (value === true) return TRUE;
    if (typeof value === 'string' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('finite archive numbers required');
      const text = typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value);
      if ((textUnits += text.length) > limits.maxTextUnits) throw new RangeError('linked archive text budget exceeded');
      const refs = [typeof value === 'string' ? STRING : NUMBER, 0];
      for (let index = 0; index < text.length; index += 1) { const unit = text.charCodeAt(index); refs.push((unit >>> 8) + 1, (unit & 255) + 1); }
      return intern(refs);
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw new TypeError('linked archive requires finite acyclic data');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('plain linked archive records required');
    ancestors.add(value);
    const refs = Array.isArray(value) ? [ARRAY, 0, ...value.map(child => encode(child, depth + 1))]
      : [OBJECT, 0, ...Object.keys(value).sort().map(key => intern([ENTRY, encode(key, depth + 1), encode(value[key], depth + 1)]))];
    ancestors.delete(value);
    return intern(refs);
  }
  return { schema: LINKED_RUNTIME_SCHEMA, root: encode(value, 0), links };
}

export function decodeLinkedValues(archive, options = {}) {
  const limits = limitsFor(options);
  if (!archive || archive.schema !== LINKED_RUNTIME_SCHEMA || Object.keys(archive).sort().join(',') !== 'links,root,schema' || !Array.isArray(archive.links) || archive.links.length < ANCHORS || archive.links.length > limits.maxLinks) throw new TypeError('invalid linked implementation archive');
  let references = 0;
  for (let id = 0; id < archive.links.length; id += 1) {
    const refs = archive.links[id];
    if (!Array.isArray(refs) || (references += refs.length) > limits.maxReferences || refs.some(ref => !Number.isSafeInteger(ref) || ref < 0 || ref >= id)) throw new TypeError('dangling, cyclic, or excessive linked archive references');
    if (id < ANCHORS && JSON.stringify(refs) !== JSON.stringify(id ? [id - 1] : [])) throw new TypeError('linked archive anchor mismatch');
  }
  if (!Number.isSafeInteger(archive.root) || archive.root < 0 || archive.root >= archive.links.length) throw new TypeError('invalid linked archive root');
  let visits = 0, textUnits = 0;
  function decode(id, depth) {
    if (++visits > limits.maxExpandedNodes || depth > limits.maxDepth) throw new RangeError('linked archive expansion budget exceeded');
    if (id === NIL) return null;
    if (id === TRUE || id === FALSE) return id === TRUE;
    if (id < ANCHORS) throw new TypeError('archive anchor used as a value');
    const [tag, delimiter, ...refs] = archive.links[id];
    if (delimiter !== 0) throw new TypeError('invalid linked value delimiter');
    if (tag === STRING || tag === NUMBER) {
      if (refs.length % 2 || refs.some(ref => ref < 1 || ref > 256)) throw new TypeError('invalid linked scalar encoding');
      if ((textUnits += refs.length / 2) > limits.maxTextUnits) throw new RangeError('linked archive text budget exceeded');
      let text = '';
      for (let index = 0; index < refs.length; index += 2) text += String.fromCharCode(((refs[index] - 1) << 8) | (refs[index + 1] - 1));
      if (tag === STRING) return text;
      const number = Number(text);
      if (!Number.isFinite(number) || (Object.is(number, -0) ? '-0' : String(number)) !== text) throw new TypeError('noncanonical linked number');
      return number;
    }
    if (tag === ARRAY) return refs.map(ref => decode(ref, depth + 1));
    if (tag === OBJECT) {
      const value = {};
      let previous;
      for (const ref of refs) {
        const entry = archive.links[ref];
        if (entry?.length !== 3 || entry[0] !== ENTRY) throw new TypeError('invalid linked record entry');
        const key = decode(entry[1], depth + 1);
        if (typeof key !== 'string' || (previous !== undefined && key <= previous)) throw new TypeError('duplicate or unsorted linked record keys');
        Object.defineProperty(value, key, { value: decode(entry[2], depth + 1), writable: true, enumerable: true, configurable: true });
        previous = key;
      }
      return value;
    }
    throw new TypeError('unknown linked value role');
  }
  return decode(archive.root, 0);
}
