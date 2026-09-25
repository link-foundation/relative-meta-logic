#!/usr/bin/env node
// rml-lsp - stdio Language Server Protocol bridge for LiNo/RML files.
//
// The server intentionally keeps the protocol surface small and dependency
// free. It reuses the structured evaluator for diagnostics, then layers
// lightweight document analysis on top for hover, go-to-definition, and
// completion.

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  Env,
  evaluate,
  parseLinoDocument,
  tokenizeOne,
  parseOne,
} from './rml-links.mjs';
import { envCompletionCandidates } from './rml-repl.mjs';

const TextDocumentSyncKind = {
  Full: 1,
};

const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
};

const CompletionItemKind = {
  Text: 1,
  Function: 3,
  Variable: 6,
  Keyword: 14,
};

const BUILTIN_DOCS = new Map([
  ['?', 'Query the truth value or type of an RML expression.'],
  ['has', 'Part of a probability assignment: `((expr) has probability p)`.'],
  ['probability', 'Assigns or reads an expression truth value in the active range.'],
  ['range', 'Configures the evaluator truth-value range, for example `(range: -1 1)`.'],
  ['valence', 'Configures discrete truth-value levels, for example `(valence: 2)`.'],
  ['and', 'Default conjunction operator. It can be redefined with `(and: ...)`.'],
  ['or', 'Default disjunction operator. It can be redefined with `(or: ...)`.'],
  ['not', 'Default negation operator. It can be redefined with `(not: ...)`.'],
  ['both', 'Belnap-style contradiction-aware conjunction operator.'],
  ['neither', 'Belnap-style gap-aware conjunction operator.'],
  ['lambda', 'Introduces a typed lambda term.'],
  ['apply', 'Applies a lambda term to an argument.'],
  ['Pi', 'Forms a dependent function type.'],
  ['Type', 'Universe type constructor.'],
  ['Prop', 'Proposition universe.'],
  ['type', 'Used in `(type of expr)` queries.'],
  ['of', 'Used in type queries and type ascriptions.'],
  ['fresh', 'Introduces a fresh variable for a scoped body.'],
  ['template', 'Declares a reusable link template.'],
  ['namespace', 'Sets the active namespace for subsequent declarations.'],
  ['import', 'Imports another `.lino` file into the current environment.'],
  ['relation', 'Declares relation clauses used by totality and coverage checks.'],
  ['define', 'Declares recursive definitions used by termination checks.'],
  ['inductive', 'Declares an inductive datatype and generated eliminator.'],
  ['coinductive', 'Declares a coinductive datatype and generated corecursor.'],
]);

function uriToFilePath(uri) {
  if (typeof uri !== 'string') return null;
  if (!uri.startsWith('file://')) return uri;
  try {
    return fileURLToPath(uri);
  } catch (_) {
    return null;
  }
}

function lspRange(line, character, length = 1) {
  const start = {
    line: Math.max(0, line),
    character: Math.max(0, character),
  };
  return {
    start,
    end: {
      line: start.line,
      character: start.character + Math.max(1, length),
    },
  };
}

// The lines of a document, split the way both LSP and the LiNo front end count
// them: LF, CRLF, and a lone CR each end a line.
function documentLines(text) {
  return String(text).split(/\r\n|\r|\n/);
}

// RML spans count columns in code points (see docs/DIAGNOSTICS.md) while LSP
// positions count UTF-16 code units, so a column is converted on its line.
// The front end drops a leading byte order mark before it counts.
function utf16Character(lines, line, col) {
  const lineText = lines[line] ?? '';
  let character = line === 0 && lineText.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let remaining = col - 1; remaining > 0; remaining--) {
    const code = lineText.codePointAt(character);
    character += code === undefined ? 1 : code > 0xffff ? 2 : 1;
  }
  return character;
}

function spanToRange(span, lines = []) {
  const line = Math.max(0, (span?.line || 1) - 1);
  const col = Math.max(1, span?.col || 1);
  const start = utf16Character(lines, line, col);
  const end = utf16Character(lines, line, col + Math.max(1, span?.length || 1));
  return lspRange(line, start, end - start);
}

function toLspDiagnostic(diag, lines) {
  return {
    range: spanToRange(diag.span, lines),
    severity: diag.code === 'E008' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    code: diag.code,
    source: 'rml',
    message: diag.message,
  };
}

function parseFormsWithSpans(text, file) {
  let forms;
  try {
    forms = parseLinoDocument(text);
  } catch (_) {
    // The evaluator reports why the text is not valid LiNo; document features
    // wait until it reads again.
    return [];
  }

  const out = [];
  for (const form of forms) {
    const source = form.text;
    const span = { file, line: form.line, col: form.col, length: form.length || 1 };
    try {
      let node = parseOne(tokenizeOne(source));
      while (Array.isArray(node) && node.length === 1 && Array.isArray(node[0])) {
        node = node[0];
      }
      out.push({ node, span, source });
    } catch (_) {
      // The evaluator reports parse diagnostics; document features just skip
      // malformed forms so a partial file remains usable while editing.
    }
  }
  return out;
}

function tokenBoundary(ch) {
  return ch === undefined || ch === '' || /\s/.test(ch) || ch === '(' || ch === ')';
}

function normalizeToken(token) {
  if (!token) return '';
  return String(token).replace(/[:,]+$/g, '');
}

function tokenAt(text, position) {
  const lines = documentLines(text);
  const lineText = lines[position.line];
  if (lineText === undefined) return null;
  let index = Math.min(Math.max(0, position.character), lineText.length);
  if (index === lineText.length && index > 0) index--;
  if (tokenBoundary(lineText[index]) && index > 0 && !tokenBoundary(lineText[index - 1])) {
    index--;
  }
  if (tokenBoundary(lineText[index])) return null;

  let start = index;
  while (start > 0 && !tokenBoundary(lineText[start - 1])) start--;
  let end = index + 1;
  while (end < lineText.length && !tokenBoundary(lineText[end])) end++;
  const raw = lineText.slice(start, end);
  const token = normalizeToken(raw);
  if (!token) return null;
  return {
    token,
    raw,
    range: {
      start: { line: position.line, character: start },
      end: { line: position.line, character: end },
    },
  };
}

function prefixAt(text, position) {
  const lines = documentLines(text);
  const lineText = lines[position.line] || '';
  const before = lineText.slice(0, Math.max(0, position.character));
  const match = before.match(/[^\s()]*$/);
  return normalizeToken(match ? match[0] : '');
}

function findTokenRange(text, span, token) {
  const lines = documentLines(text);
  const startLine = Math.max(0, (span?.line || 1) - 1);
  const needle = String(token);
  for (let line = startLine; line < lines.length; line++) {
    let from = line === startLine ? utf16Character(lines, line, Math.max(1, span?.col || 1)) : 0;
    for (;;) {
      const index = lines[line].indexOf(needle, from);
      if (index === -1) break;
      const before = lines[line][index - 1];
      const after = lines[line][index + needle.length];
      if (tokenBoundary(before) && tokenBoundary(after)) {
        return lspRange(line, index, needle.length);
      }
      from = index + needle.length;
    }
  }
  return spanToRange(span, lines);
}

function addDefinition(definitions, name, range, kind, detail) {
  if (!name) return;
  definitions.set(name, { name, range, kind, detail });
}

function addNamespacedDefinition(definitions, namespace, name, range, kind, detail) {
  addDefinition(definitions, name, range, kind, detail);
  if (namespace && !name.includes('.')) {
    addDefinition(definitions, `${namespace}.${name}`, range, kind, detail);
  }
}

function constructorName(node) {
  if (!Array.isArray(node) || node[0] !== 'constructor') return null;
  if (typeof node[1] === 'string') return node[1];
  if (Array.isArray(node[1]) && typeof node[1][0] === 'string') return node[1][0];
  return null;
}

function collectDefinitions(text, file) {
  const lines = documentLines(text);
  const definitions = new Map();
  let namespace = null;
  for (const { node, span } of parseFormsWithSpans(text, file)) {
    if (!Array.isArray(node) || node.length === 0) continue;

    if (node.length === 2 && node[0] === 'namespace' && typeof node[1] === 'string') {
      namespace = node[1];
      continue;
    }

    if (typeof node[0] === 'string' && node[0].endsWith(':')) {
      const name = node[0].slice(0, -1);
      const line = (span.line || 1) - 1;
      const range = lspRange(line, utf16Character(lines, line, (span.col || 1) + 1), name.length);
      addNamespacedDefinition(definitions, namespace, name, range, 'definition', `Definition \`${name}\``);
      continue;
    }

    if (node[0] === 'template' && Array.isArray(node[1]) && typeof node[1][0] === 'string') {
      const name = node[1][0];
      const range = findTokenRange(text, span, name);
      addNamespacedDefinition(definitions, namespace, name, range, 'template', `Template \`${name}\``);
      continue;
    }

    if (['relation', 'define', 'inductive', 'coinductive'].includes(node[0]) && typeof node[1] === 'string') {
      const name = node[1];
      const range = findTokenRange(text, span, name);
      addNamespacedDefinition(definitions, namespace, name, range, node[0], `${node[0]} \`${name}\``);

      if (node[0] === 'inductive') {
        addNamespacedDefinition(definitions, namespace, `${name}-rec`, range, 'eliminator', `Eliminator for \`${name}\``);
      }
      if (node[0] === 'coinductive') {
        addNamespacedDefinition(definitions, namespace, `${name}-corec`, range, 'corecursor', `Corecursor for \`${name}\``);
      }
      if (node[0] === 'inductive' || node[0] === 'coinductive') {
        for (const child of node.slice(2)) {
          const ctor = constructorName(child);
          if (ctor) {
            addNamespacedDefinition(
              definitions,
              namespace,
              ctor,
              findTokenRange(text, span, ctor),
              'constructor',
              `Constructor \`${ctor}\``,
            );
          }
        }
      }
    }
  }
  return definitions;
}

function completionItems(env, definitions, prefix) {
  const labels = new Set([
    ...envCompletionCandidates(env),
    ...env.types.keys(),
    ...env.templates.keys(),
    ...env.relations.keys(),
    ...env.definitions.keys(),
    ...env.inductives.keys(),
    ...env.coinductives.keys(),
    ...definitions.keys(),
    ...BUILTIN_DOCS.keys(),
  ]);

  return [...labels]
    .filter(label => !prefix || label.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b))
    .map(label => {
      const definition = definitions.get(label);
      const builtin = BUILTIN_DOCS.has(label);
      return {
        label,
        kind: builtin
          ? CompletionItemKind.Keyword
          : definition && ['template', 'define', 'relation'].includes(definition.kind)
            ? CompletionItemKind.Function
            : definition
              ? CompletionItemKind.Variable
              : CompletionItemKind.Text,
        detail: definition ? definition.detail : builtin ? 'RML keyword' : 'RML symbol',
        insertText: label,
      };
    });
}

function analyzeDocument(uri, text) {
  const file = uriToFilePath(uri);
  const env = new Env();
  const evaluation = evaluate(text, { env, file });
  const lines = documentLines(text);
  const definitions = collectDefinitions(text, file);
  return {
    diagnostics: evaluation.diagnostics.map(diag => toLspDiagnostic(diag, lines)),
    definitions,
    env,
  };
}

class RmlLanguageServer {
  constructor(input = process.stdin, output = process.stdout) {
    this.input = input;
    this.output = output;
    this.documents = new Map();
    this.buffer = Buffer.alloc(0);
    this.shutdownRequested = false;
  }

  start() {
    this.input.on('data', chunk => this._onData(chunk));
    this.input.on('end', () => process.exit(0));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString('ascii');
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.slice(bodyEnd);
      let message;
      try {
        message = JSON.parse(body);
      } catch (err) {
        this._sendError(null, -32700, `Parse error: ${err.message}`);
        continue;
      }
      this._handleMessage(message);
    }
  }

  _send(message) {
    const body = JSON.stringify(message);
    this.output.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }

  _sendResponse(id, result) {
    this._send({ jsonrpc: '2.0', id, result });
  }

  _sendError(id, code, message) {
    this._send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  _handleMessage(message) {
    const isRequest = Object.prototype.hasOwnProperty.call(message, 'id');
    try {
      const result = this._dispatch(message.method, message.params);
      if (isRequest) this._sendResponse(message.id, result);
    } catch (err) {
      if (isRequest) {
        const code = err && Number.isInteger(err.code) ? err.code : -32603;
        this._sendError(message.id, code, err && err.message ? err.message : String(err));
      } else {
        process.stderr.write(`rml-lsp notification error: ${err && err.stack ? err.stack : err}\n`);
      }
    }
  }

  _dispatch(method, params = {}) {
    switch (method) {
      case 'initialize':
        return this._initialize();
      case 'initialized':
        return undefined;
      case 'shutdown':
        this.shutdownRequested = true;
        return null;
      case 'exit':
        process.exit(this.shutdownRequested ? 0 : 1);
        return undefined;
      case 'textDocument/didOpen':
        this._didOpen(params);
        return undefined;
      case 'textDocument/didChange':
        this._didChange(params);
        return undefined;
      case 'textDocument/didClose':
        this._didClose(params);
        return undefined;
      case 'textDocument/hover':
        return this._hover(params);
      case 'textDocument/definition':
        return this._definition(params);
      case 'textDocument/completion':
        return this._completion(params);
      default: {
        const err = new Error(`Method not found: ${method}`);
        err.code = -32601;
        throw err;
      }
    }
  }

  _initialize() {
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Full,
        },
        hoverProvider: true,
        definitionProvider: true,
        completionProvider: {
          triggerCharacters: ['(', ' ', ':'],
        },
      },
      serverInfo: {
        name: 'rml-lsp',
      },
    };
  }

  _didOpen(params) {
    const doc = params.textDocument || {};
    this._setDocument(doc.uri, doc.text || '', doc.version || 0);
  }

  _didChange(params) {
    const uri = params.textDocument?.uri;
    const existing = this.documents.get(uri);
    const changes = params.contentChanges || [];
    const last = changes[changes.length - 1];
    const text = typeof last?.text === 'string' ? last.text : existing?.text || '';
    this._setDocument(uri, text, params.textDocument?.version || existing?.version || 0);
  }

  _didClose(params) {
    const uri = params.textDocument?.uri;
    if (!uri) return;
    this.documents.delete(uri);
    this._notify('textDocument/publishDiagnostics', { uri, diagnostics: [] });
  }

  _setDocument(uri, text, version) {
    if (!uri) return;
    const analysis = analyzeDocument(uri, text);
    const doc = { uri, text, version, analysis };
    this.documents.set(uri, doc);
    this._notify('textDocument/publishDiagnostics', {
      uri,
      diagnostics: analysis.diagnostics,
    });
  }

  _document(uri) {
    return this.documents.get(uri) || null;
  }

  _hover(params) {
    const uri = params.textDocument?.uri;
    const doc = this._document(uri);
    if (!doc) return null;
    const hit = tokenAt(doc.text, params.position || { line: 0, character: 0 });
    if (!hit) return null;

    const definition = doc.analysis.definitions.get(hit.token);
    if (definition) {
      return {
        contents: {
          kind: 'markdown',
          value: `${definition.detail}\n\nDeclared in this document.`,
        },
        range: hit.range,
      };
    }
    if (BUILTIN_DOCS.has(hit.token)) {
      return {
        contents: {
          kind: 'markdown',
          value: `\`${hit.token}\`: ${BUILTIN_DOCS.get(hit.token)}`,
        },
        range: hit.range,
      };
    }
    return null;
  }

  _definition(params) {
    const uri = params.textDocument?.uri;
    const doc = this._document(uri);
    if (!doc) return null;
    const hit = tokenAt(doc.text, params.position || { line: 0, character: 0 });
    if (!hit) return null;
    const definition = doc.analysis.definitions.get(hit.token);
    if (!definition) return null;
    return {
      uri,
      range: definition.range,
    };
  }

  _completion(params) {
    const uri = params.textDocument?.uri;
    const doc = this._document(uri);
    if (!doc) {
      return { isIncomplete: false, items: [] };
    }
    const prefix = prefixAt(doc.text, params.position || { line: 0, character: 0 });
    return {
      isIncomplete: false,
      items: completionItems(doc.analysis.env, doc.analysis.definitions, prefix),
    };
  }
}

function runServer() {
  new RmlLanguageServer().start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runServer();
}

export {
  RmlLanguageServer,
  analyzeDocument,
  tokenAt,
  prefixAt,
  collectDefinitions,
};
