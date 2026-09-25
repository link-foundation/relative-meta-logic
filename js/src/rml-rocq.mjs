import {
  LinoParseError,
  keyOf,
  parseInductiveForm,
  parseLino,
  readLinoForm,
} from './rml-links.mjs';

class RocqExportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RocqExportError';
  }
}

const ROCQ_RESERVED = new Set([
  'as',
  'at',
  'by',
  'Check',
  'Definition',
  'else',
  'end',
  'fix',
  'forall',
  'fun',
  'if',
  'in',
  'Inductive',
  'let',
  'match',
  'Parameter',
  'Prop',
  'return',
  'Set',
  'struct',
  'then',
  'Type',
  'where',
  'with',
]);

const CONFIG_HEADS = new Set(['range', 'valence']);
const OPERATOR_HEADS = new Set(['=', '!=', 'and', 'or', 'not', 'is', '?:', 'both', 'neither']);
const UNSUPPORTED_FORM_HEADS = new Set([
  'coinductive',
  'coverage',
  'define',
  'import',
  'mode',
  'namespace',
  'relation',
  'terminating',
  'total',
  'world',
]);

const isNum = value => typeof value === 'string' && /^-?(\d+(\.\d+)?|\.\d+)$/.test(value);

function sanitizeComment(text) {
  return String(text).replaceAll('*)', '* )');
}

function sanitizeIdentifier(raw) {
  let out = String(raw).replace(/[^A-Za-z0-9_]/g, '_');
  out = out.replace(/_+/g, '_');
  if (out.length === 0 || !/^[A-Za-z_]/.test(out)) out = `rml_${out}`;
  if (ROCQ_RESERVED.has(out)) out = `${out}_rml`;
  return out;
}

function parseBindingNode(binding) {
  if (!Array.isArray(binding) || binding.length !== 2) return null;
  if (typeof binding[0] === 'string' && binding[0].endsWith(':')) {
    return { name: binding[0].slice(0, -1), type: binding[1] };
  }
  if (
    typeof binding[0] === 'string' &&
    typeof binding[1] === 'string' &&
    /^[A-Z]/.test(binding[0]) &&
    !binding[1].endsWith(':')
  ) {
    return { name: binding[1], type: binding[0] };
  }
  if (Array.isArray(binding[0]) && typeof binding[1] === 'string' && !binding[1].endsWith(':')) {
    return { name: binding[1], type: binding[0] };
  }
  return null;
}

function parseBindingNodes(binding) {
  const single = parseBindingNode(binding);
  if (single) return [single];
  if (!Array.isArray(binding)) return null;

  const tokens = [];
  for (const item of binding) {
    if (typeof item !== 'string') return null;
    if (item.endsWith(',')) {
      tokens.push(item.slice(0, -1));
      tokens.push(',');
    } else {
      tokens.push(item);
    }
  }

  const bindings = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === ',') {
      i += 1;
      continue;
    }
    if (i + 1 < tokens.length && tokens[i + 1] !== ',') {
      const parsed = parseBindingNode([tokens[i], tokens[i + 1]]);
      if (parsed) {
        bindings.push(parsed);
        i += 2;
        continue;
      }
    }
    return null;
  }
  return bindings.length > 0 ? bindings : null;
}

function isTypeUniverse(node) {
  return Array.isArray(node) &&
    node.length === 2 &&
    node[0] === 'Type' &&
    typeof node[1] === 'string' &&
    /^(0|[1-9]\d*)$/.test(node[1]);
}

class RocqEmitter {
  constructor() {
    this.names = new Map();
    this.used = new Map();
  }

  error(message) {
    throw new RocqExportError(message);
  }

  symbol(raw) {
    if (raw === '_') return '_';
    if (this.names.has(raw)) return this.names.get(raw);
    const rendered = sanitizeIdentifier(raw);
    const previous = this.used.get(rendered);
    if (previous && previous !== raw) {
      this.error(`Rocq identifier collision: \`${previous}\` and \`${raw}\` both export as \`${rendered}\``);
    }
    this.names.set(raw, rendered);
    this.used.set(rendered, raw);
    return rendered;
  }

  translateType(node) {
    if (typeof node === 'string') {
      if (node === 'Type') return 'Type';
      if (node === 'Prop') return 'Prop';
      if (isNum(node)) this.error(`numeric literal \`${node}\` is not a Rocq type`);
      return this.symbol(node);
    }
    if (!Array.isArray(node) || node.length === 0) {
      this.error(`unsupported Rocq type expression \`${keyOf(node)}\``);
    }
    if (isTypeUniverse(node)) {
      return node[1] === '0' ? 'Set' : 'Type';
    }
    if (node.length === 1 && node[0] === 'Prop') return 'Prop';
    if (node.length === 3 && (node[0] === 'Pi' || node[0] === 'forall')) {
      return this.translatePi(node);
    }
    if (node.length === 3 && node[1] === '=') {
      return `${this.translateTerm(node[0])} = ${this.translateTerm(node[2])}`;
    }
    return this.translateTerm(node);
  }

  translatePi(node) {
    let current = node;
    const binders = [];
    while (Array.isArray(current) && current.length === 3 && (current[0] === 'Pi' || current[0] === 'forall')) {
      const binding = parseBindingNode(current[1]);
      if (!binding) this.error(`unsupported Pi binder \`${keyOf(current[1])}\``);
      binders.push(binding);
      current = current[2];
    }
    let rendered = this.translateType(current);
    for (let i = binders.length - 1; i >= 0; i -= 1) {
      rendered = `forall ${this.symbol(binders[i].name)} : ${this.translateType(binders[i].type)}, ${rendered}`;
    }
    return rendered;
  }

  translateLambda(node) {
    if (!Array.isArray(node) || node.length !== 3 || node[0] !== 'lambda') {
      this.error(`unsupported lambda expression \`${keyOf(node)}\``);
    }
    const bindings = parseBindingNodes(node[1]);
    if (!bindings || bindings.length === 0) {
      this.error(`unsupported lambda binder \`${keyOf(node[1])}\``);
    }
    let rendered = this.translateTerm(node[2]);
    for (let i = bindings.length - 1; i >= 0; i -= 1) {
      rendered = `fun ${this.symbol(bindings[i].name)} : ${this.translateType(bindings[i].type)} => ${rendered}`;
    }
    return rendered;
  }

  translateTerm(node) {
    if (typeof node === 'string') {
      if (isNum(node)) this.error(`numeric literal \`${node}\` is outside the Rocq export subset`);
      return this.symbol(node);
    }
    if (!Array.isArray(node) || node.length === 0) {
      this.error(`unsupported Rocq term expression \`${keyOf(node)}\``);
    }
    if (isTypeUniverse(node)) return this.translateType(node);
    if (node.length === 1 && node[0] === 'Prop') return 'Prop';
    if (node.length === 3 && node[0] === 'lambda') return this.translateLambda(node);
    if (node.length === 3 && (node[0] === 'Pi' || node[0] === 'forall')) return this.translatePi(node);
    if (node.length === 3 && node[1] === '=') {
      return `(${this.translateTerm(node[0])} = ${this.translateTerm(node[2])})`;
    }
    if (node.length === 3 && node[1] === 'of') {
      return `(${this.translateTerm(node[0])} : ${this.translateType(node[2])})`;
    }
    if (node.length === 3 && node[0] === 'type' && node[1] === 'of') {
      this.error('`(type of ...)` must appear under a query for Rocq export');
    }
    if (node[0] === 'apply') {
      if (node.length !== 3) this.error(`Rocq export supports binary \`apply\` forms, got \`${keyOf(node)}\``);
      return `(${this.translateTerm(node[1])} ${this.translateTerm(node[2])})`;
    }
    if (typeof node[0] === 'string') {
      if (UNSUPPORTED_FORM_HEADS.has(node[0])) {
        this.error(`\`${node[0]}\` is outside the Rocq export subset`);
      }
      if (['+', '-', '*', '/', 'and', 'or', 'not', 'both', 'neither'].includes(node[0])) {
        this.error(`operator \`${node[0]}\` is outside the Rocq export subset`);
      }
      const args = node.slice(1).map(arg => this.translateTerm(arg));
      return `(${[this.symbol(node[0]), ...args].join(' ')})`;
    }
    this.error(`unsupported Rocq term expression \`${keyOf(node)}\``);
  }

  translateQuery(node) {
    if (!Array.isArray(node) || (node.length !== 2 && node.length !== 4) || node[0] !== '?') {
      this.error(`unsupported query form \`${keyOf(node)}\``);
    }
    if (node.length === 4) {
      this.error('proof-producing queries are outside the Rocq export subset');
    }
    const expr = node[1];
    if (Array.isArray(expr) && expr.length === 3 && expr[0] === 'type' && expr[1] === 'of') {
      return `Check ${this.translateTerm(expr[2])}.`;
    }
    if (Array.isArray(expr) && expr.length === 3 && expr[1] === 'of') {
      return `Check (${this.translateTerm(expr[0])} : ${this.translateType(expr[2])}).`;
    }
    return `Check ${this.translateTerm(expr)}.`;
  }

  translateDefinition(node) {
    const head = node[0].slice(0, -1);
    const rhs = node.slice(1);
    if (head === 'Type') {
      this.error('self-referential `(Type: Type Type)` is not in the Rocq export subset; use `(Type N)` universes');
    }
    if (CONFIG_HEADS.has(head) || OPERATOR_HEADS.has(head) || /[=!]/.test(head)) {
      this.error(`definition \`${head}:\` is an operator or configuration form, not a typed Rocq declaration`);
    }
    if (rhs.length === 1 && isNum(rhs[0])) {
      this.error(`numeric prior \`(${head}: ${rhs[0]})\` is outside the Rocq export subset`);
    }
    if (rhs.length === 3 && rhs[1] === 'is') {
      this.error(`untyped term declaration \`(${head}: ... is ...)\` is outside the Rocq export subset`);
    }
    if (rhs.length >= 1 && rhs[0] === 'lambda') {
      return `Definition ${this.symbol(head)} := ${this.translateLambda(['lambda', ...rhs.slice(1)])}.`;
    }
    if (rhs.length === 2 && rhs[1] === head) {
      return `Parameter ${this.symbol(head)} : ${this.translateType(rhs[0])}.`;
    }
    if (rhs.length === 1 && Array.isArray(rhs[0])) {
      return `Parameter ${this.symbol(head)} : ${this.translateType(rhs[0])}.`;
    }
    this.error(`definition \`${keyOf(node)}\` is outside the Rocq export subset`);
  }

  translateInductive(node) {
    let decl;
    try {
      decl = parseInductiveForm(node);
    } catch (error) {
      this.error(error && error.message ? error.message : String(error));
    }
    if (!decl) this.error(`unsupported inductive declaration \`${keyOf(node)}\``);
    const lines = [`Inductive ${this.symbol(decl.name)} : Set :=`];
    for (let i = 0; i < decl.constructors.length; i += 1) {
      const ctor = decl.constructors[i];
      const suffix = i === decl.constructors.length - 1 ? '.' : '';
      lines.push(`| ${this.symbol(ctor.name)} : ${this.translateType(ctor.type)}${suffix}`);
    }
    return lines.join('\n');
  }

  translateForm(node) {
    if (!Array.isArray(node) || node.length === 0) {
      this.error(`unsupported top-level form \`${keyOf(node)}\``);
    }
    if (typeof node[0] === 'string' && node[0].endsWith(':')) {
      return this.translateDefinition(node);
    }
    if (isTypeUniverse(node) || (node.length === 1 && node[0] === 'Prop')) {
      return null;
    }
    if (node.length === 4 && node[1] === 'has' && node[2] === 'probability') {
      this.error('probabilistic assignment is outside the Rocq export subset');
    }
    if (node[0] === 'inductive') return this.translateInductive(node);
    if (node[0] === '?') return this.translateQuery(node);
    if (typeof node[0] === 'string' && UNSUPPORTED_FORM_HEADS.has(node[0])) {
      this.error(`\`${node[0]}\` is outside the Rocq export subset`);
    }
    this.error(`top-level form \`${keyOf(node)}\` is outside the Rocq export subset`);
  }
}

// Reads every form before any is translated, so both runtimes report the same
// first error whatever the forms go on to declare.
function parseForms(text) {
  let links;
  try {
    links = parseLino(text);
  } catch (err) {
    if (err instanceof LinoParseError) throw new RocqExportError(err.message);
    throw err;
  }
  return links.map(link => {
    try {
      return readLinoForm(link);
    } catch (err) {
      throw new RocqExportError(`failed to parse \`${link}\`: ${err.message}`);
    }
  });
}

function exportRocq(text, options = {}) {
  const emitter = new RocqEmitter();
  const lines = ['(* Generated by rml export rocq. *)'];
  if (options.sourcePath) lines.push(`(* Source: ${sanitizeComment(options.sourcePath)} *)`);
  lines.push('', 'Set Universe Polymorphism.', '');

  for (const form of parseForms(text)) {
    const statement = emitter.translateForm(form);
    if (statement) lines.push(statement);
  }
  lines.push('');
  return lines.join('\n');
}

export { exportRocq, RocqExportError };
