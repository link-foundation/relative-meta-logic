import {
  parseRmlToMetaLanguage,
  reconstructRmlFromMetaLanguage,
} from './rml-meta-language.mjs';
import { parseLino, parseOne, tokenizeOne } from './rml-links.mjs';

const EMPTY_SEQUENCE = 'rml.sequence.empty';

function requireLeaf(value, context) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty reference`);
  }
  return value;
}

function clauses(form, context) {
  const result = new Map();
  for (const clause of form.slice(2)) {
    if (!Array.isArray(clause) || clause.length !== 2 || typeof clause[0] !== 'string') {
      throw new Error(`${context} clauses must have the form (name value)`);
    }
    if (result.has(clause[0])) {
      throw new Error(`${context} repeats clause ${clause[0]}`);
    }
    result.set(clause[0], requireLeaf(clause[1], `${context} ${clause[0]}`));
  }
  return result;
}

/**
 * An addressable graph of theories, definition relations, and local terms.
 * Source is round-tripped through meta-language before its LiNo forms are read.
 */
class TheoryGraph {
  constructor(metaLanguageRoundTripOk) {
    this.metaLanguageRoundTripOk = metaLanguageRoundTripOk;
    this.theories = new Map();
    this.definitions = [];
    this.terms = new Map();
  }

  static fromRml(source) {
    const text = String(source);
    const network = parseRmlToMetaLanguage(text);
    const reconstructed = reconstructRmlFromMetaLanguage(network);
    const graph = new TheoryGraph(reconstructed === text);
    const forms = parseLino(reconstructed).map(link => parseOne(tokenizeOne(link)));

    for (const form of forms) {
      if (!Array.isArray(form) || typeof form[0] !== 'string') continue;
      if (form[0] === 'theory') graph.#addTheory(form);
      if (form[0] === 'term') graph.#addTerm(form);
      if (form[0] === 'definition') graph.#addDefinition(form);
    }
    graph.#validate();
    return graph;
  }

  #addTheory(form) {
    if (form.length < 3) throw new Error('theory must have a name and address');
    const name = requireLeaf(form[1], 'theory name');
    const data = clauses(form, `theory ${name}`);
    const address = data.get('address');
    if (!address) throw new Error(`theory ${name} is missing address`);
    if (this.theories.has(name)) throw new Error(`duplicate theory ${name}`);
    if ([...this.theories.values()].some(theory => theory.address === address)) {
      throw new Error(`duplicate theory address ${address}`);
    }
    this.theories.set(name, { name, address });
  }

  #addTerm(form) {
    if (form.length !== 4) {
      throw new Error('term must have the form (term theory local-name address)');
    }
    const theory = requireLeaf(form[1], 'term theory');
    const term = requireLeaf(form[2], 'term name');
    const address = requireLeaf(form[3], 'term address');
    const key = `${theory}\u0000${term}`;
    const previous = this.terms.get(key);
    if (previous && previous.address !== address) {
      throw new Error(`term ${theory}.${term} maps to both ${previous.address} and ${address}`);
    }
    this.terms.set(key, { theory, term, address });
  }

  #addDefinition(form) {
    if (form.length < 3) throw new Error('definition must have a name and clauses');
    const name = requireLeaf(form[1], 'definition name');
    if (this.definitions.some(definition => definition.name === name)) {
      throw new Error(`duplicate definition ${name}`);
    }
    const data = clauses(form, `definition ${name}`);
    for (const field of ['subject', 'using', 'witness']) {
      if (!data.has(field)) throw new Error(`definition ${name} is missing ${field}`);
    }
    this.definitions.push({
      name,
      subject: data.get('subject'),
      using: data.get('using'),
      witness: data.get('witness'),
    });
  }

  #validate() {
    for (const { theory, term } of this.terms.values()) {
      if (!this.theories.has(theory)) {
        throw new Error(`term ${theory}.${term} references unknown theory ${theory}`);
      }
    }
    for (const definition of this.definitions) {
      if (!this.theories.has(definition.subject)) {
        throw new Error(`definition ${definition.name} has unknown subject ${definition.subject}`);
      }
      if (!this.theories.has(definition.using)) {
        throw new Error(`definition ${definition.name} uses unknown theory ${definition.using}`);
      }
    }
  }

  theoryNames() {
    return [...this.theories.keys()].sort();
  }

  definitionsFor(theory) {
    return this.definitions.filter(definition => definition.subject === theory);
  }

  resolveTerm(theory, term) {
    return this.terms.get(`${theory}\u0000${term}`)?.address ?? null;
  }

  termsAt(address) {
    return [...this.terms.values()]
      .filter(term => term.address === address)
      .map(({ theory, term }) => ({ theory, term }))
      .sort((left, right) =>
        left.theory.localeCompare(right.theory) || left.term.localeCompare(right.term));
  }

  /** Find the shortest cycle-safe chain of definition edges. */
  definitionPath(subject, foundation) {
    if (!this.theories.has(subject) || !this.theories.has(foundation)) return null;
    if (subject === foundation) return [subject];
    const queue = [[subject]];
    const visited = new Set([subject]);
    while (queue.length > 0) {
      const path = queue.shift();
      const current = path.at(-1);
      for (const definition of this.definitionsFor(current)) {
        const next = definition.using;
        if (next === foundation) return [...path, next];
        if (!visited.has(next)) {
          visited.add(next);
          queue.push([...path, next]);
        }
      }
    }
    return null;
  }
}

/**
 * Store sequences as addressed doublets `(value, next-address)`.
 * Cycles are legal links; callers must choose a finite observation bound.
 */
class DoubletSequenceStore {
  constructor() {
    this.nodes = new Map();
  }

  define(address, value, next) {
    requireLeaf(address, 'sequence address');
    requireLeaf(value, 'sequence value');
    requireLeaf(next, 'sequence next address');
    if (address === EMPTY_SEQUENCE) throw new Error(`${EMPTY_SEQUENCE} is reserved`);
    if (this.nodes.has(address)) throw new Error(`sequence address ${address} is already defined`);
    this.nodes.set(address, { value, next });
    return address;
  }

  walk(head, limit) {
    requireLeaf(head, 'sequence head');
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('sequence limit must be a non-negative safe integer');
    }
    const values = [];
    const seen = new Map();
    let current = head;
    let cycleAt = null;
    while (current !== EMPTY_SEQUENCE && values.length < limit) {
      if (!seen.has(current)) seen.set(current, values.length);
      const node = this.nodes.get(current);
      if (!node) throw new Error(`unknown sequence address ${current}`);
      values.push(node.value);
      current = node.next;
      if (current !== EMPTY_SEQUENCE && seen.has(current) && cycleAt === null) {
        cycleAt = seen.get(current);
      }
    }
    return {
      values,
      complete: current === EMPTY_SEQUENCE,
      cyclic: cycleAt !== null,
      cycleAt,
    };
  }

  encodeOrderedSet(values, address = 'rml.sequence') {
    requireLeaf(address, 'ordered set address');
    const unique = new Set();
    for (const rawValue of values) {
      const value = requireLeaf(rawValue, 'ordered set value');
      if (unique.has(value)) throw new Error(`ordered set contains duplicate ${value}`);
      unique.add(value);
    }
    const addresses = values.map((_, index) => `${address}.cell.${index}`);
    for (const cell of addresses) {
      if (this.nodes.has(cell)) throw new Error(`sequence address ${cell} is already defined`);
    }
    let next = EMPTY_SEQUENCE;
    for (let index = values.length - 1; index >= 0; index--) {
      this.define(addresses[index], values[index], next);
      next = addresses[index];
    }
    return next;
  }

  decodeOrderedSet(head) {
    requireLeaf(head, 'ordered set head');
    const values = [];
    const nodesSeen = new Set();
    const valuesSeen = new Set();
    let current = head;
    while (current !== EMPTY_SEQUENCE) {
      if (nodesSeen.has(current)) {
        throw new Error(`ordered set must be finite; ${head} is cyclic`);
      }
      nodesSeen.add(current);
      const node = this.nodes.get(current);
      if (!node) throw new Error(`unknown sequence address ${current}`);
      if (valuesSeen.has(node.value)) {
        throw new Error(`ordered set contains duplicate ${node.value}`);
      }
      valuesSeen.add(node.value);
      values.push(node.value);
      current = node.next;
    }
    return values;
  }
}

export {
  DoubletSequenceStore,
  EMPTY_SEQUENCE,
  TheoryGraph,
};
