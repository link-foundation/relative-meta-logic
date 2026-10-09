/** Lossless sequences of link addresses using explicit, stored doublet constructors. */
const SCHEMA = 'rml-address-sequence/v1';
const DEFAULT_NAMESPACE = 'rml:address-sequence:1';
const MAX_ELEMENTS = 10000;
const MAX_LINKS = 100000;
const MAX_TEXT = 1048576;
function reference(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192 || !value.isWellFormed() || [...value].length > 4096) throw new Error('address must be a nonempty Unicode string within 4096 scalars');
  return value;
}
function positive(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('sequence bounds must be positive safe integers');
  return value;
}
function compare(left, right) {
  const a = [...left], b = [...right];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = a[i].codePointAt(0) - b[i].codePointAt(0);
    if (d) return d;
  }
  return a.length - b.length;
}

export class AddressSequence {
  #links;
  #textUnits = 0;
  constructor(namespace = DEFAULT_NAMESPACE) {
    this.namespace = reference(namespace);
    this.#links = new Map();
    for (const tag of this.tags()) this.defineLink(tag, tag, tag);
  }

  tags() { return ['empty', 'element', 'branch'].map(kind => `${this.namespace}:${kind}`); }

  defineLink(address, source, target) {
    [address, source, target].forEach(reference);
    if (this.#links.has(address)) throw new Error(`duplicate link address ${address}`);
    if (this.#links.size >= MAX_LINKS) throw new Error('sequence link bound exceeded');
    const units = [...address].length + [...source].length + [...target].length;
    if (this.#textUnits + units > MAX_TEXT) throw new Error('sequence text bound exceeded');
    this.#links.set(address, [source, target]);
    this.#textUnits += units;
    return address;
  }

  entries() {
    return [...this.#links].sort(([a], [b]) => compare(a, b)).map(([address, [source, target]]) => ({ address, source, target }));
  }

  snapshot() { return { schema: SCHEMA, namespace: this.namespace, links: this.entries() }; }

  static fromSnapshot(snapshot) {
    if (snapshot?.schema !== SCHEMA || Object.keys(snapshot).sort().join(',') !== 'links,namespace,schema' || !Array.isArray(snapshot.links) || snapshot.links.length > MAX_LINKS) throw new Error('invalid address-sequence snapshot');
    const result = new AddressSequence(reference(snapshot.namespace));
    result.#links.clear();
    result.#textUnits = 0;
    let units = 0;
    for (const node of snapshot.links) {
      if (!node || Object.keys(node).sort().join(',') !== 'address,source,target') throw new Error('invalid link record');
      const fields = [node?.address, node?.source, node?.target].map(reference);
      units += fields.reduce((sum, value) => sum + [...value].length, 0);
      if (units > MAX_TEXT) throw new Error('snapshot text bound exceeded');
      result.defineLink(...fields);
    }
    result.validateTags();
    return result;
  }

  validateTags() {
    for (const tag of this.tags()) {
      const node = this.#links.get(tag);
      if (!node || node[0] !== tag || node[1] !== tag) throw new Error(`missing or corrupt constructor ${tag}`);
    }
  }

  encode(values, address, layout = 'balanced') {
    reference(address);
    this.validateTags();
    if (!['balanced', 'left', 'right'].includes(layout)) throw new Error('unknown sequence layout');
    const elements = [];
    let units = 0;
    for (const value of values) {
      elements.push(reference(value));
      units += [...value].length;
      if (elements.length > MAX_ELEMENTS || units > MAX_TEXT) throw new Error('sequence input bound exceeded');
    }
    const [empty, element, branch] = this.tags();
    if (!elements.length) return empty;
    const pending = [];
    const leaves = elements.map((value, i) => {
      const name = `${address}.element.${i}`;
      pending.push([name, element, value]);
      return name;
    });
    let next = 0;
    const pair = (left, right) => {
      const index = next++;
      const payload = `${address}.pair.${index}`, name = `${address}.branch.${index}`;
      pending.push([payload, left, right], [name, branch, payload]);
      return name;
    };
    let head;
    if (layout === 'left') head = leaves.slice(1).reduce((left, right) => pair(left, right), leaves[0]);
    else if (layout === 'right') {
      head = leaves.at(-1);
      for (let i = leaves.length - 2; i >= 0; i--) head = pair(leaves[i], head);
    } else {
      const balanced = (start, end) => end - start === 1 ? leaves[start] : pair(balanced(start, start + Math.floor((end - start) / 2)), balanced(start + Math.floor((end - start) / 2), end));
      head = balanced(0, leaves.length);
    }
    const referenced = new Set(elements);
    let storedUnits = this.#textUnits;
    storedUnits += pending.reduce((sum, node) => sum + node.reduce((count, value) => count + [...value].length, 0), 0);
    if (storedUnits > MAX_TEXT) throw new Error('sequence text bound exceeded');
    for (const record of pending) {
      record.forEach(reference);
      const [name] = record;
      if (this.#links.has(name) || referenced.has(name)) throw new Error(`sequence address collision ${name}`);
    }
    if (this.#links.size + pending.length > MAX_LINKS) throw new Error('sequence link bound exceeded');
    for (const record of pending) this.defineLink(...record);
    return head;
  }

  decode(head, { maxElements = MAX_ELEMENTS, maxNodes = MAX_LINKS } = {}) {
    reference(head); positive(maxElements); positive(maxNodes); this.validateTags();
    const [empty, element, branch] = this.tags();
    const result = [], active = new Set(), stack = [[head, false]];
    let visited = 0;
    while (stack.length) {
      const [address, exit] = stack.pop();
      if (exit) { active.delete(address); continue; }
      if (++visited > maxNodes) throw new Error('sequence node bound exceeded');
      if (address === empty) continue;
      if (address === element || address === branch) throw new Error('constructor address used as a sequence');
      const node = this.#links.get(address);
      if (!node) throw new Error(`missing sequence link ${address}`);
      if (node[0] === element) {
        result.push(node[1]);
        if (result.length > maxElements) throw new Error('sequence element bound exceeded');
      } else if (node[0] === branch) {
        if (active.has(address)) throw new Error('cyclic sequence structure');
        const payload = this.#links.get(node[1]);
        if (!payload) throw new Error(`missing branch payload ${node[1]}`);
        active.add(address);
        stack.push([address, true], [payload[1], false], [payload[0], false]);
      } else throw new Error(`unknown sequence constructor ${node[0]}`);
    }
    return result;
  }

  collect(values) {
    const elements = [];
    for (const value of values) {
      elements.push(reference(value));
      if (elements.length > MAX_ELEMENTS) throw new Error('sequence input bound exceeded');
    }
    return elements;
  }

  encodeSet(values, address, layout = 'balanced') {
    const elements = [...new Set(this.collect(values))].sort(compare);
    return this.encode(elements, address, layout);
  }

  decodeSet(head, bounds = {}) {
    const values = this.decode(head, bounds);
    if (values.some((value, i) => i && compare(values[i - 1], value) >= 0)) throw new Error('set elements are not in strict address order');
    return values;
  }

  encodeOrderedSet(values, address, layout = 'balanced') {
    const elements = this.collect(values);
    if (new Set(elements).size !== elements.length) throw new Error('ordered set contains duplicate addresses');
    return this.encode(elements, address, layout);
  }

  decodeOrderedSet(head, bounds = {}) {
    const values = this.decode(head, bounds);
    if (new Set(values).size !== values.length) throw new Error('ordered set contains duplicate addresses');
    return values;
  }
}
