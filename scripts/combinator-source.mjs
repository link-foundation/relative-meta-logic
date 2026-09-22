import { parseLino, parseOne, tokenizeOne } from '../js/src/rml-links.mjs';

const S = 'S';
const K = 'K';
const app = (left, right) => [left, right];

function sourceForms(source) {
  return parseLino(String(source).replace(/^[ \t]+/gm, ''))
    .map(link => parseOne(tokenizeOne(link)));
}

function clauseValue(form, name) {
  const clause = form.slice(2).find(value =>
    Array.isArray(value) && value.length === 2 && value[0] === name);
  if (clause === undefined || typeof clause[1] !== 'string') {
    throw new Error(`bootstrap source requires (${name} value)`);
  }
  return clause[1];
}

function freeIn(name, term) {
  if (term?.variable !== undefined) return term.variable === name;
  if (term?.lambda !== undefined) {
    return term.lambda !== name && freeIn(name, term.body);
  }
  return Array.isArray(term) && (freeIn(name, term[0]) || freeIn(name, term[1]));
}

function abstract(name, term) {
  if (!freeIn(name, term)) return app(K, term);
  if (term?.variable === name) return app(app(S, K), K);
  if (!Array.isArray(term)) throw new Error(`cannot abstract free variable ${name}`);
  return app(app(S, abstract(name, term[0])), abstract(name, term[1]));
}

function compile(term) {
  if (term?.variable !== undefined) return term;
  if (term?.lambda !== undefined) return abstract(term.lambda, compile(term.body));
  if (Array.isArray(term)) return app(compile(term[0]), compile(term[1]));
  return term;
}

/** Parse the authoritative link source and compile its named roots to S/K. */
function compileCombinatorSource(source) {
  const forms = sourceForms(source);
  const declaration = forms.find(form =>
    Array.isArray(form) && form[0] === 'bootstrap-source');
  if (declaration === undefined || declaration[1] !== 'rml.bootstrap.fixed-point') {
    throw new Error('missing fixed-point bootstrap source declaration');
  }
  const metadata = {
    schema: clauseValue(declaration, 'schema'),
    representation: clauseValue(declaration, 'representation'),
    upstreamModel: clauseValue(declaration, 'upstream-model'),
    declaredNodeCount: Number(clauseValue(declaration, 'node-count')),
    declaredRootCount: Number(clauseValue(declaration, 'root-count')),
  };
  if (metadata.schema !== 'rml-lambda-link-dag-v1' ||
      metadata.representation !== 'addressed-doublet-network' ||
      metadata.upstreamModel !== 'network-duplet-function' ||
      !Number.isSafeInteger(metadata.declaredNodeCount) ||
      !Number.isSafeInteger(metadata.declaredRootCount)) {
    throw new Error('invalid fixed-point bootstrap source metadata');
  }

  const descriptors = new Map();
  const rootForms = [];
  for (const form of forms) {
    if (!Array.isArray(form)) continue;
    if (form[0] === 'bootstrap-source-node') {
      if (form.length !== 3 || typeof form[1] !== 'string' ||
          !Array.isArray(form[2])) {
        throw new Error('invalid bootstrap source node');
      }
      if (descriptors.has(form[1])) {
        throw new Error(`duplicate bootstrap source node ${form[1]}`);
      }
      descriptors.set(form[1], form[2]);
    } else if (form[0] === 'bootstrap-source-root') {
      if (form.length !== 3 || typeof form[1] !== 'string' ||
          typeof form[2] !== 'string') {
        throw new Error('invalid bootstrap source root');
      }
      rootForms.push(form);
    }
  }
  if (descriptors.size !== metadata.declaredNodeCount ||
      rootForms.length !== metadata.declaredRootCount) {
    throw new Error('fixed-point bootstrap source counts do not match its declaration');
  }

  const compiledRoots = new Map();
  const sourceNodes = new Map();
  const materialize = (reference, visiting = new Set()) => {
    if (reference.startsWith('r')) {
      const root = compiledRoots.get(reference.slice(1));
      if (root === undefined) throw new Error(`unknown earlier bootstrap root ${reference}`);
      return root;
    }
    if (sourceNodes.has(reference)) return sourceNodes.get(reference);
    const descriptor = descriptors.get(reference);
    if (descriptor === undefined) throw new Error(`unknown bootstrap source node ${reference}`);
    if (visiting.has(reference)) throw new Error(`cyclic bootstrap source node ${reference}`);
    const nested = new Set(visiting);
    nested.add(reference);
    let term;
    if (descriptor.length === 2 && descriptor[0] === 'variable') {
      term = { variable: descriptor[1] };
    } else if (descriptor.length === 3 && descriptor[0] === 'lambda') {
      term = { lambda: descriptor[1], body: materialize(descriptor[2], nested) };
    } else if (descriptor.length === 3 && descriptor[0] === 'application') {
      term = app(
        materialize(descriptor[1], nested),
        materialize(descriptor[2], nested),
      );
    } else {
      throw new Error(`invalid bootstrap source expression ${reference}`);
    }
    sourceNodes.set(reference, term);
    return term;
  };

  for (const [, name, reference] of rootForms) {
    if (compiledRoots.has(name)) throw new Error(`duplicate bootstrap source root ${name}`);
    compiledRoots.set(name, compile(materialize(reference)));
  }
  return { metadata, roots: Object.fromEntries(compiledRoots) };
}

/** Compile link-native source to the compact addressed-doublet runtime graph. */
function serializeCombinatorSource(source) {
  const { roots } = compileCombinatorSource(source);
  const ids = new WeakMap();
  const nodes = [];
  const reference = term => {
    if (term === S || term === K) return term;
    if (!Array.isArray(term)) throw new Error('serialized combinator is not closed');
    const known = ids.get(term);
    if (known !== undefined) return `n${known}`;
    const left = reference(term[0]);
    const right = reference(term[1]);
    const id = nodes.length;
    ids.set(term, id);
    nodes.push(`${id}\t${left}\t${right}`);
    return `n${id}`;
  };
  const rootLines = Object.entries(roots)
    .map(([name, term]) => `${name}\t${reference(term)}`);
  return [
    'rml-addressed-link-dag-v1',
    `${nodes.length}\t${rootLines.length}`,
    ...nodes,
    ...rootLines,
    '',
  ].join('\n');
}

export { compileCombinatorSource, serializeCombinatorSource };
