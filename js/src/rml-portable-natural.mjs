/** A deliberately bounded semantic translation fragment, not a full-language frontend. */
import { LinkNetwork } from '#meta-language';
import { attachRmlStructure, rmlStructuredDocument } from './rml-meta-language.mjs';

export const PORTABLE_NATURAL_CONTRACT = Object.freeze({
  schema: 'rml:portable-natural:1',
  values: 'natural numbers, 0 through 9007199254740991',
  representations: { JavaScript: 'Number safe nonnegative integer, not BigInt', Rust: 'u64', Lean: 'Nat', Rocq: 'nat' },
  observations: 'return value of named pure functions on valid arguments',
  assumptions: [
    'Every argument and arithmetic intermediate is an integer in the declared value range',
    'Functions are called in an environment without conflicting target declarations',
    'Resource exhaustion, stack limits, timing, and memory usage are outside the observations',
  ],
  preserves: ['function arity', 'lexical parameter binding', 'pure calls', 'conditional branch selection', 'natural-number results within bounds'],
  excludes: ['effects', 'modules', 'ownership', 'recursion', 'proofs', 'axioms', 'universes', 'full-language grammar'],
});
const MAX = 9007199254740991n;
const LANGUAGES = ['JavaScript', 'Rust', 'Lean', 'Rocq'];
const RESERVED = new Set(('if then else fn function return let const var true false null undefined match end fix cofix fun forall as in with where for def theorem axiom by namespace section type self crate super move ref mod pub use impl trait extern unsafe dyn async await loop while break continue switch case default throw try catch finally class new import export nat arguments eval typeof void delete debugger instanceof extends implements interface package private protected public static yield abstract become box do final gen macro override priv unsized virtual union example opaque abbrev constant variable universe mutual structure inductive instance open prelude set_option syntax attribute noncomputable partial deriving termination_by decreasing_by have show from calc sorry rfl').split(' '));
const NAME = /^[a-z][a-z0-9_]*$/;
const ARITIES = { literal: 1, variable: 1, add: 2, multiply: 2, less: 2, 'less-equal': 2, equal: 2, choose: 3 };

function obligation(message, offset = 0, code = 'RML_PORTABLE_UNSUPPORTED') {
  const error = new Error(message); error.code = code; error.offset = offset; throw error;
}
function validName(name) { return typeof name === 'string' && NAME.test(name) && !RESERVED.has(name); }

function lex(source, language) {
  if (source.length > 1000000) obligation('Portable source limit exceeded');
  const tokens = [];
  for (let i = 0; i < source.length;) {
    if (/[ \t\r\n]/.test(source[i])) { i += 1; continue; }
    if ((['JavaScript', 'Rust'].includes(language) && source.startsWith('//', i)) || (language === 'Lean' && source.startsWith('--', i))) {
      const ending = (language === 'JavaScript' ? /[\r\n\u2028\u2029]/ : /\n/).exec(source.slice(i));
      i = ending ? i + ending.index + ending[0].length : source.length; continue;
    }
    const comment = language === 'Lean' ? ['/-', '-/'] : language === 'Rocq' ? ['(*', '*)'] : ['/*', '*/'];
    if (source.startsWith(comment[0], i)) {
      let depth = 1; const start = i; i += 2;
      while (i < source.length && depth) {
        if (language !== 'JavaScript' && source.startsWith(comment[0], i)) { depth += 1; i += 2; }
        else if (source.startsWith(comment[1], i)) { depth -= 1; i += 2; } else i += 1;
        if (depth > 64) obligation('Comment nesting exceeds the portable limit', start);
      }
      if (depth) obligation('Unterminated comment', start, 'RML_PORTABLE_INVALID');
      continue;
    }
    const match = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|===|<=\?|<\?|=\?|:=|->|<=|==|[(){}:;,+*?.<>=])/.exec(source.slice(i));
    if (!match) obligation('Unsupported token; complete source is retained', i);
    tokens.push({ text: match[0], offset: i }); i += match[0].length;
    if (tokens.length > 100000) obligation('Portable token limit exceeded', i);
  }
  tokens.push({ text: '<eof>', offset: source.length });
  return tokens;
}

class Parser {
  constructor(source, language) { this.source = source; this.language = language; this.tokens = lex(source, language); this.index = 0; this.arities = new Map(); this.depth = 0; }
  peek() { return this.tokens[this.index].text; }
  take() { return this.tokens[this.index++].text; }
  fail(message, code) { obligation(message, this.tokens[this.index]?.offset ?? this.tokens.at(-1).offset, code); }
  expect(text) { if (this.peek() !== text) this.fail(`Expected ${text}, found ${this.peek()}`); this.take(); }
  name() { const name = this.peek(); if (!validName(name)) this.fail(`Unsupported or reserved portable identifier ${name}`); this.take(); return name; }
  program() {
    const functions = [];
    if (this.language === 'Rocq' && this.peek() === 'Require') for (const text of ['Require', 'Import', 'Arith', '.']) this.expect(text);
    while (this.peek() !== '<eof>') {
      if (functions.length >= 1000) this.fail('Portable function limit exceeded');
      this.expect({ JavaScript: 'function', Rust: 'fn', Lean: 'def', Rocq: 'Definition' }[this.language]);
      const name = this.name(); const parameters = [];
      if (this.language === 'JavaScript' || this.language === 'Rust') {
        this.expect('(');
        if (this.peek() !== ')') while (true) {
          parameters.push(this.name());
          if (this.language === 'Rust') { this.expect(':'); this.expect('u64'); }
          if (this.peek() !== ',') break; this.take();
        }
        this.expect(')');
        if (this.language === 'Rust') { this.expect('->'); this.expect('u64'); }
        this.expect('{');
        if (this.language === 'JavaScript') {
          const start = this.tokens[this.index].offset; this.expect('return');
          if (/[\r\n\u2028\u2029]/.test(this.source.slice(start + 6, this.tokens[this.index].offset))) {
            this.fail('Line break after return has JavaScript ASI semantics');
          }
        }
      } else {
        while (this.peek() === '(') {
          this.take();
          do { parameters.push(this.name()); } while (this.peek() !== ':' && this.peek() !== '<eof>');
          this.expect(':'); this.expect(this.language === 'Lean' ? 'Nat' : 'nat'); this.expect(')');
        }
        this.expect(':'); this.expect(this.language === 'Lean' ? 'Nat' : 'nat'); this.expect(':=');
      }
      if (this.arities.has(name)) this.fail(`Duplicate function ${name}`);
      this.arities.set(name, parameters.length);
      const body = this.expression();
      if (this.language === 'JavaScript') this.expect(';');
      if (this.language === 'JavaScript' || this.language === 'Rust') this.expect('}');
      if (this.language === 'Rocq') this.expect('.');
      functions.push({ name, parameters, body });
    }
    if (!functions.length) this.fail('Expected at least one portable function');
    validate(functions);
    return functions;
  }
  expression(minimum = 0) {
    this.depth += 1; if (this.depth > 64) this.fail('Portable expression nesting exceeds 64');
    const bareRustIf = this.language === 'Rust' && this.peek() === 'if';
    let left = this.atom();
    const comparison = this.language === 'Rocq' ? { '<?': 'less', '<=?': 'less-equal', '=?': 'equal' }
      : { '<': 'less', '<=': 'less-equal', [this.language === 'JavaScript' ? '===' : this.language === 'Lean' ? '=' : '==']: 'equal' };
    let operators = 0;
    while (true) {
      const token = this.peek(); const tag = token === '+' ? 'add' : token === '*' ? 'multiply' : comparison[token];
      const precedence = tag === 'add' ? 10 : tag === 'multiply' ? 20 : tag ? 5 : -1;
      if (precedence < minimum) break;
      if (bareRustIf) this.fail('A Rust conditional before an infix operator must be parenthesized');
      if (++operators > 64) this.fail('Portable expression operator limit exceeded');
      this.take(); left = [tag, left, this.expression(precedence + 1)];
    }
    if (minimum === 0 && this.language === 'JavaScript' && this.peek() === '?') {
      this.take(); const yes = this.expression(); this.expect(':'); const no = this.expression(); left = ['choose', left, yes, no];
    }
    this.depth -= 1; return left;
  }
  atom(allowConditional = true) {
    if (this.peek() === 'if' && this.language !== 'JavaScript' && allowConditional) {
      this.take(); const condition = this.expression();
      if (this.language === 'Rust') this.expect('{'); else this.expect('then');
      const yes = this.expression();
      if (this.language === 'Rust') this.expect('}');
      this.expect('else'); if (this.language === 'Rust') this.expect('{');
      const no = this.expression(); if (this.language === 'Rust') this.expect('}');
      return ['choose', condition, yes, no];
    }
    if (this.peek() === '(') { this.take(); const expression = this.expression(); this.expect(')'); return expression; }
    if (/^[0-9]+$/.test(this.peek())) {
      const text = this.take();
      if ((text.length > 1 && text.startsWith('0')) || BigInt(text) > MAX) this.fail('Literal outside the portable natural-number range');
      return ['literal', text];
    }
    const name = this.name();
    if (['JavaScript', 'Rust'].includes(this.language)) {
      if (this.peek() !== '(') return ['variable', name];
      this.take(); const args = [];
      if (this.peek() !== ')') while (true) { args.push(this.expression()); if (this.peek() !== ',') break; this.take(); }
      this.expect(')'); return ['call', name, ...args];
    }
    if (!this.arities.has(name)) return ['variable', name];
    if (!allowConditional && this.arities.get(name) > 0) this.fail('Function-valued arguments are unsupported; parenthesize nested calls');
    const args = [];
    for (let n = 0; n < this.arities.get(name); n += 1) args.push(this.atom(false));
    return ['call', name, ...args];
  }
}

function validate(functions) {
  if (!functions.length || functions.length > 1000) obligation('Expected one through 1000 portable functions');
  const names = new Map();
  for (const fn of functions) {
    if (!validName(fn.name) || names.has(fn.name)) obligation('Invalid or duplicate portable function');
    if (new Set(fn.parameters).size !== fn.parameters.length || fn.parameters.some(name => !validName(name))) obligation('Invalid or duplicate parameters');
    names.set(fn.name, fn);
  }
  const edges = new Map();
  for (const fn of functions) {
    if (fn.parameters.some(name => names.has(name))) obligation('A parameter shadows a function name');
    const calls = new Set();
    function type(expression, depth = 0) {
      if (!Array.isArray(expression) || depth > 64) obligation('Invalid or over-deep portable expression');
      const [tag, ...args] = expression;
      if (tag !== 'call' && (ARITIES[tag] === undefined || args.length !== ARITIES[tag])) obligation(`Unsupported portable operation ${tag}`);
      if (tag === 'literal') {
        if (typeof args[0] !== 'string' || !/^(0|[1-9][0-9]*)$/.test(args[0]) || BigInt(args[0]) > MAX) obligation('Invalid portable literal');
        return 'natural';
      }
      if (tag === 'variable') {
        if (!fn.parameters.includes(args[0])) obligation(`Unresolved variable ${args[0]}`);
        return 'natural';
      }
      if (tag === 'call') {
        const callee = names.get(args[0]);
        if (!callee || callee.parameters.length !== args.length - 1) obligation(`Unresolved function or arity mismatch: ${args[0]}`);
        calls.add(args[0]);
        if (args.slice(1).some(arg => type(arg, depth + 1) !== 'natural')) obligation('Call arguments must be natural');
        return 'natural';
      }
      if (tag === 'choose') {
        if (type(args[0], depth + 1) !== 'boolean' || type(args[1], depth + 1) !== 'natural' || type(args[2], depth + 1) !== 'natural') obligation('Conditional type mismatch');
        return 'natural';
      }
      if (args.some(arg => type(arg, depth + 1) !== 'natural')) obligation('Arithmetic/comparison operands must be natural');
      return ['less', 'less-equal', 'equal'].includes(tag) ? 'boolean' : 'natural';
    }
    if (type(fn.body) !== 'natural') obligation('Function result must be natural');
    edges.set(fn.name, calls);
  }
  const active = new Set(); const seen = new Set();
  function visit(name) {
    if (active.has(name)) obligation('Recursive calls require termination and numeric-bound proofs');
    if (seen.has(name)) return;
    active.add(name); for (const child of edges.get(name)) visit(child); active.delete(name); seen.add(name);
  }
  for (const name of names.keys()) visit(name);
  return functions;
}

function encode(expression) { return Array.isArray(expression) ? `(${expression.map(encode).join(' ')})` : expression; }
function toNetwork(functions) {
  const network = new LinkNetwork();
  attachRmlStructure(network, encode(['portable-natural-v1', ...functions.map(fn =>
    ['function', fn.name, ['parameters', ...fn.parameters], ['body', fn.body]])]));
  try { rmlStructuredDocument(network); } catch (error) { obligation(error.message); }
  return network;
}

function fromNetwork(network) {
  let documents;
  try { documents = rmlStructuredDocument(network); } catch (error) { obligation(error.message); }
  function decode(link) {
    if (link._isFromPathCombination) obligation('Compound LiNo links are not portable operations');
    if (link.id !== null) {
      if (link.values.length) obligation('Named LiNo links are not portable operations');
      return link.id;
    }
    return link.values.map(decode);
  }
  if (documents.length !== 1) obligation('Expected one portable program root');
  const root = decode(documents[0].link);
  if (!Array.isArray(root) || root[0] !== 'portable-natural-v1') obligation('Unsupported portable program schema');
  const functions = root.slice(1).map(form => {
    if (!Array.isArray(form) || form.length !== 4 || form[0] !== 'function' || !Array.isArray(form[2]) || !Array.isArray(form[3]) || form[2]?.[0] !== 'parameters' || form[3]?.[0] !== 'body' || form[3].length !== 2) obligation('Malformed portable function');
    return { name: form[1], parameters: form[2].slice(1), body: form[3][1] };
  });
  return validate(functions);
}

export function parsePortableNatural(source, language) {
  if (!LANGUAGES.includes(language)) obligation(`Unsupported source language ${language}`);
  const functions = new Parser(String(source), language).program();
  return { network: toNetwork(functions), sourceLanguage: language, preservedSource: String(source),
    contract: PORTABLE_NATURAL_CONTRACT, stages: { parsing: 'portable-fragment', resolution: 'resolved-within-program',
      elaboration: 'natural-and-boolean-fragment', execution: 'not-run', verification: 'not-proved' } };
}

export function emitPortableNatural(network, language) {
  if (!LANGUAGES.includes(language)) obligation(`Unsupported target language ${language}`);
  const functions = fromNetwork(network);
  // Emit dependencies first so Lean and Rocq need no forward declarations.
  const byName = new Map(functions.map(fn => [fn.name, fn])); const ordered = []; const done = new Set();
  function order(fn) {
    if (done.has(fn.name)) return;
    function calls(expr) { if (expr[0] === 'call') order(byName.get(expr[1])); for (const child of expr.slice(1)) if (Array.isArray(child)) calls(child); }
    calls(fn.body); done.add(fn.name); ordered.push(fn);
  }
  functions.forEach(order);
  function expression(node) {
    const [tag, ...args] = node;
    if (tag === 'literal' || tag === 'variable') return args[0];
    if (tag === 'call') return ['JavaScript', 'Rust'].includes(language)
      ? `${args[0]}(${args.slice(1).map(expression).join(', ')})`
      : `(${args[0]}${args.slice(1).map(arg => ` (${expression(arg)})`).join('')})`;
    if (tag === 'choose') {
      const [test, yes, no] = args.map(expression);
      return language === 'JavaScript' ? `(${test} ? ${yes} : ${no})`
        : language === 'Rust' ? `(if ${test} { ${yes} } else { ${no} })`
          : `(if ${test} then ${yes} else ${no})`;
    }
    const operators = { add: '+', multiply: '*', less: language === 'Rocq' ? '<?' : '<',
      'less-equal': language === 'Rocq' ? '<=?' : '<=',
      equal: ({ JavaScript: '===', Rust: '==', Lean: '=', Rocq: '=?' })[language] };
    return `(${expression(args[0])} ${operators[tag]} ${expression(args[1])})`;
  }
  const output = ordered.map(fn => {
    const body = expression(fn.body);
    if (language === 'JavaScript') return `function ${fn.name}(${fn.parameters.join(', ')}) { return ${body}; }`;
    if (language === 'Rust') return `fn ${fn.name}(${fn.parameters.map(name => `${name}: u64`).join(', ')}) -> u64 { ${body} }`;
    const type = language === 'Lean' ? 'Nat' : 'nat';
    const parameters = fn.parameters.map(name => ` (${name} : ${type})`).join('');
    return `${language === 'Lean' ? 'def' : 'Definition'} ${fn.name}${parameters} : ${type} := ${body}${language === 'Rocq' ? '.' : ''}`;
  });
  return (language === 'Rocq' ? 'Require Import Arith.\n' : '') + output.join('\n') + '\n';
}

export function translatePortableNatural(source, sourceLanguage, targetLanguage) {
  try {
    const parsed = parsePortableNatural(source, sourceLanguage);
    const targetSource = emitPortableNatural(parsed.network, targetLanguage);
    return { status: 'translated-fragment', schema: 'rml:portable-natural:1', sourceLanguage, targetLanguage,
      preservedSource: String(source), targetSource, network: parsed.network, contract: PORTABLE_NATURAL_CONTRACT,
      obligations: [{ code: 'RML_PORTABLE_NUMERIC_DOMAIN', status: 'assumption', description: PORTABLE_NATURAL_CONTRACT.assumptions[0] }],
      stages: { ...parsed.stages, targetNativeValidation: 'not-run', equivalence: 'structural-fragment-contract-not-formal-proof' } };
  } catch (error) {
    if (!error.code?.startsWith('RML_PORTABLE_')) throw error;
    return { status: 'unsupported', schema: 'rml:portable-natural:1', sourceLanguage, targetLanguage,
      preservedSource: String(source), targetSource: null,
      obligations: [{ code: error.code, stage: 'portable-fragment', description: error.message, offset: error.offset }] };
  }
}

export function evaluatePortableNatural(network, name, arguments_) {
  const functions = new Map(fromNetwork(network).map(fn => [fn.name, fn]));
  let fuel = 100000;
  function natural(value) {
    if (typeof value !== 'bigint' || value < 0n || value > MAX) obligation('Value outside the portable numeric domain', 0, 'RML_PORTABLE_DOMAIN');
    return value;
  }
  function call(name, args) {
    if (--fuel < 0) obligation('Portable evaluation fuel exhausted', 0, 'RML_PORTABLE_EXHAUSTED');
    const fn = functions.get(name);
    if (!fn || args.length !== fn.parameters.length) obligation('Unknown function or wrong argument count');
    const environment = new Map(fn.parameters.map((name, index) => [name, natural(args[index])]));
    function evaluate(node) {
      if (--fuel < 0) obligation('Portable evaluation fuel exhausted', 0, 'RML_PORTABLE_EXHAUSTED');
      const [tag, ...args] = node;
      if (tag === 'literal') return BigInt(args[0]);
      if (tag === 'variable') return environment.get(args[0]);
      if (tag === 'call') return call(args[0], args.slice(1).map(evaluate));
      if (tag === 'choose') return evaluate(evaluate(args[0]) ? args[1] : args[2]);
      const left = evaluate(args[0]); const right = evaluate(args[1]);
      if (tag === 'less') return left < right;
      if (tag === 'less-equal') return left <= right;
      if (tag === 'equal') return left === right;
      return natural(tag === 'add' ? left + right : left * right);
    }
    return natural(evaluate(fn.body));
  }
  const args = arguments_.map(value => typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value);
  return call(name, args);
}
