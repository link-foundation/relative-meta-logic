// Conservative binding-aware rename for lexical declarations and plain blocks.
// Unsupported binding forms fail before any edit. This is not a full JS parser.
import { leaves } from './cst.mjs';
import { parseJs } from './cst-js.mjs';
const IDENTIFIER = /^[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*$/u;
const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await async').split(' '));
const UNSUPPORTED = new Set(('break case catch class continue debugger default delete do else enum export extends finally for function if implements import in interface package private protected public return static super switch throw try var while with yield await async eval').split(' '));

function fail(code, detail, offset = 0) {
  const error = new Error(`${code}: ${detail} at UTF-16 offset ${offset}`);
  error.code = code;
  throw error;
}

function advance(location, text, previous) {
  const result = { ...location };
  for (let index = 0; index < text.length; index += 1) {
    const character = String.fromCodePoint(text.codePointAt(index));
    if (index === 0 && character === '\n' && previous === '\r') {
      result.offset += 1;
    } else if (character === '\r' && text[index + 1] === '\n') {
      result.offset += 2; result.line += 1; result.column = 1; index += 1;
    } else if (character === '\r' || character === '\n') {
      result.offset += 1; result.line += 1; result.column = 1;
    } else { result.offset += character.length; result.column += 1; index += character.length - 1; }
  }
  return result;
}

export function rewriteJavaScriptIdentifier(source, from, to) {
  for (const [role, value] of [['from', from], ['to', to]]) {
    if (!IDENTIFIER.test(value) || RESERVED.has(value)) throw new Error(`${role} must be a JavaScript identifier`);
  }
  const sourceText = String(source);
  const tokens = [];
  let location = { offset: 0, line: 1, column: 1 };
  let previous;
  for (const leaf of leaves(parseJs(sourceText))) {
    const start = { ...location };
    location = advance(location, leaf.text, previous);
    previous = leaf.text.at(-1) ?? previous;
    if (leaf.kind === 'token') tokens.push({ text: leaf.text, tag: leaf.tag, start, end: { ...location } });
  }
  const scopes = [{ parent: null, bindings: new Map() }];
  const at = [];
  const brackets = [];
  let scope = 0;
  let parentheses = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]; const word = token.text;
    at[index] = scope;
    if (UNSUPPORTED.has(word) || token.tag.endsWith('template_literal') || token.tag.endsWith('regexp_literal') ||
        ['\\', ':', '?', '/'].includes(word) || (word === '=' && tokens[index + 1]?.text === '>') ||
        token.tag.endsWith('.ident') && !IDENTIFIER.test(word)) {
      fail('RML_RENAME_UNSUPPORTED', 'binding or lexical form requires a full JavaScript scope parser', token.start.offset);
    }
    if (token.tag.endsWith('string_literal') && (word.length < 2 || word.at(-1) !== word[0])) {
      fail('RML_RENAME_INVALID', 'unterminated string', token.start.offset);
    }
    if (['(', '[', '{'].includes(word)) {
      if (word === '{') {
        if (index && ![';', '{', '}'].includes(tokens[index - 1].text)) {
          fail('RML_RENAME_UNSUPPORTED', 'only standalone lexical blocks are supported', token.start.offset);
        }
        scopes.push({ parent: scope, bindings: new Map() }); scope = scopes.length - 1;
      } else parentheses += 1;
      brackets.push(word);
    } else if ([')', ']', '}'].includes(word)) {
      if (brackets.pop() !== ({ ')': '(', ']': '[', '}': '{' })[word]) {
        fail('RML_RENAME_INVALID', 'unbalanced delimiter', token.start.offset);
      }
      if (word === '}') scope = scopes[scope].parent; else parentheses -= 1;
    } else if (word === ',' && parentheses === 0) {
      fail('RML_RENAME_UNSUPPORTED', 'multiple declarations or comma expressions require a full parser', token.start.offset);
    }
    if (word === 'const' || word === 'let') {
      const binding = tokens[index + 1];
      if (!binding || !IDENTIFIER.test(binding.text) || RESERVED.has(binding.text) ||
          !['=', ';'].includes(tokens[index + 2]?.text) || word === 'const' && tokens[index + 2]?.text !== '=') {
        fail('RML_RENAME_UNSUPPORTED', 'only simple lexical declarations are supported', token.start.offset);
      }
      if (tokens[index + 2]?.text === '=' && (!tokens[index + 3] || [';', '}'].includes(tokens[index + 3].text))) {
        fail('RML_RENAME_INVALID', 'missing initializer', token.start.offset);
      }
      if (scopes[scope].bindings.has(binding.text)) fail('RML_RENAME_INVALID', 'duplicate lexical binding', binding.start.offset);
      scopes[scope].bindings.set(binding.text, index + 1);
    }
  }
  if (brackets.length) fail('RML_RENAME_INVALID', 'unbalanced delimiter', sourceText.length);
  const isReference = index => tokens[index].tag.endsWith('.ident') && tokens[index - 1]?.text !== '.';
  const resolve = (name, scopeId) => {
    while (scopeId !== null) {
      if (scopes[scopeId].bindings.has(name)) return scopes[scopeId].bindings.get(name);
      scopeId = scopes[scopeId].parent;
    }
    return null;
  };
  const bindings = scopes.map(scope => scope.bindings.get(from)).filter(value => value !== undefined);
  const target = scopes[0].bindings.get(from) ?? (bindings.length === 1 ? bindings[0] : null);
  if (bindings.length > 1 && target === null) fail('RML_RENAME_AMBIGUOUS', 'selecting among shadowed bindings is ambiguous');
  const selected = tokens.map((_, index) => index).filter(index => isReference(index) &&
    tokens[index].text === from && resolve(from, at[index]) === target);
  if (selected.length && from !== to && tokens.some((token, index) => token.text === to && isReference(index))) {
    fail('RML_RENAME_CAPTURE', 'target name is already present in the lexical environment');
  }
  const matches = from === to ? [] : selected.map(index => ({ from, to, start: tokens[index].start, end: tokens[index].end }));
  let rewritten = sourceText;
  for (const match of [...matches].reverse()) rewritten = rewritten.slice(0, match.start.offset) + to + rewritten.slice(match.end.offset);
  return { source: rewritten, matchCount: matches.length, changed: matches.length > 0, matches,
    scopeModel: 'lexical-blocks-v1', syntaxValidated: false,
    report: { replacements: matches, isEmpty() { return matches.length === 0; }, substitution() { return undefined; } } };
}
