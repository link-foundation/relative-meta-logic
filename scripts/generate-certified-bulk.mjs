#!/usr/bin/env node
// Repository-scale certified translation (R165, after link-assistant/router#761).
//
// Every top-level item of every JavaScript module in js/src and every Rust
// module in rust/src, plus any JavaScript under lib/, is cut out at its exact
// original span, assembled with the same-file declarations it references, and
// sent through the certified pipeline (vendored meta-language PR #201 core ->
// RML links -> emitters). The Lean and Rocq files under lib/ are translated at
// module granularity, so all four source languages are covered. Admitted items are translated into the other three
// languages with RML-checked certificates; every other item keeps its exact
// source and receives a first-refusal record. The bulk receipt aggregates
// counts per language and path, refusal causes, input fingerprints and the
// reconstruction recipe. `--check` regenerates in memory and rejects stale,
// missing or unexpected files without writing.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  CERTIFIED_EXTENSIONS, CERTIFIED_LANGUAGES, importCertifiedSource, renderCertifiedJavaScript, serializeLinks, translateCertified,
  vendoredTranslatorIdentity,
} from '../js/src/rml-certified-translation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const BULK_DIRECTORY = join(root, 'test-corpus/certified-translation/bulk');
export const BULK_SCHEMA = 'rml:certified-bulk-receipt:1';
const require = createRequire(join(root, 'js/package.json'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const encoder = new TextEncoder();
const byteOffset = (text, offset) => encoder.encode(text.slice(0, offset)).length;
export const BULK_SCOPE = Object.freeze([
  { root: 'js/src', language: 'JavaScript', pattern: /\.m?js$/u },
  { root: 'rust/src', language: 'Rust', pattern: /\.rs$/u },
  { root: 'lib', language: 'JavaScript', pattern: /\.m?js$/u },
  { root: 'lib', language: 'Lean', pattern: /\.lean$/u },
  { root: 'lib', language: 'Rocq', pattern: /\.v$/u },
]);
export const MIRRORS_FILE = 'test-corpus/certified-translation/mirrors.json';
const IMPLEMENTATION = ['scripts/generate-certified-bulk.mjs', 'js/src/rml-certified-translation.mjs', 'js/vendor/meta-language-pr201/upstream-files.json', MIRRORS_FILE];

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** Repository-relative input files in scope, in a stable order. */
export function bulkInputs() {
  return BULK_SCOPE.flatMap(scope => listFiles(join(root, scope.root))
    .filter(path => scope.pattern.test(path))
    .map(path => ({ path: relative(root, path).split('\\').join('/'), language: scope.language })));
}

// ---------------------------------------------------------------------------
// Item extraction.

const IGNORED_KEYS = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);
function referencedNames(node, into = new Set()) {
  (function visit(value, parent, key) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, parent, key)); return; }
    if (value.type === 'Identifier') {
      const property = key === 'property' && parent && !parent.computed && /MemberExpression$/u.test(parent.type);
      const objectKey = key === 'key' && parent && !parent.computed;
      if (!property && !objectKey) into.add(value.name);
    }
    for (const [childKey, child] of Object.entries(value)) if (!IGNORED_KEYS.has(childKey)) visit(child, value, childKey);
  })(node, null, null);
  return into;
}

/** Top-level JavaScript declarations with exact UTF-16 spans (export keywords excluded). */
export function javaScriptItems(text) {
  const { parse } = require('@babel/parser');
  const program = parse(text, { sourceType: 'module', errorRecovery: false }).program;
  const items = [];
  for (const statement of program.body) {
    const declaration = statement.type.startsWith('Export') && statement.declaration ? statement.declaration : statement;
    const span = { start: declaration.start, end: declaration.end };
    if (declaration.type === 'FunctionDeclaration') items.push({ name: declaration.id.name, kind: 'function', ...span, hoisted: true, references: referencedNames(declaration.body) });
    else if (declaration.type === 'ClassDeclaration') items.push({ name: declaration.id.name, kind: 'class', ...span, references: referencedNames(declaration) });
    else if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== 'Identifier') continue;
        items.push({ name: declarator.id.name, kind: declaration.kind, ...span, references: referencedNames(declarator.init ?? {}) });
      }
    }
  }
  return items;
}

/** Rust tokens with comments, strings and character literals handled; offsets are UTF-16. */
function rustTokens(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/u.test(character)) { index += 1; continue; }
    if (text.startsWith('//', index)) { const end = text.indexOf('\n', index); index = end < 0 ? text.length : end + 1; continue; }
    if (text.startsWith('/*', index)) {
      let depth = 1; index += 2;
      while (index < text.length && depth) {
        if (text.startsWith('/*', index)) { depth += 1; index += 2; } else if (text.startsWith('*/', index)) { depth -= 1; index += 2; } else index += 1;
      }
      continue;
    }
    const start = index;
    const raw = /^(?:b|c)?r(#*)"/u.exec(text.slice(index, index + 260));
    if (raw) {
      const close = `"${raw[1]}`;
      const end = text.indexOf(close, index + raw[0].length);
      index = end < 0 ? text.length : end + close.length;
      tokens.push({ kind: 'literal', start, end: index }); continue;
    }
    if (character === '"' || ((character === 'b' || character === 'c') && text[index + 1] === '"')) {
      index += character === '"' ? 1 : 2;
      while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
      index += 1; tokens.push({ kind: 'literal', start, end: index }); continue;
    }
    if (character === '\'' || (character === 'b' && text[index + 1] === '\'')) {
      const quote = character === 'b' ? index + 1 : index;
      const literal = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\}|.)|[^\\'\n])'/u.exec(text.slice(quote, quote + 16));
      if (literal) { index = quote + literal[0].length; tokens.push({ kind: 'literal', start, end: index }); continue; }
      const lifetime = /^'[A-Za-z_][A-Za-z0-9_]*/u.exec(text.slice(index, index + 64));
      index += lifetime ? lifetime[0].length : 1; tokens.push({ kind: 'lifetime', start, end: index }); continue;
    }
    const word = /^(?:r#)?[\p{XID_Start}_][\p{XID_Continue}]*/u.exec(text.slice(index, index + 256));
    if (word) { index += word[0].length; tokens.push({ kind: 'identifier', value: word[0].replace(/^r#/u, ''), start, end: index }); continue; }
    const number = /^[0-9][0-9A-Za-z_]*(?:\.[0-9][0-9A-Za-z_]*)?/u.exec(text.slice(index, index + 128));
    if (number) { index += number[0].length; tokens.push({ kind: 'literal', start, end: index }); continue; }
    index += 1; tokens.push({ kind: 'punct', value: character, start, end: index });
  }
  return tokens;
}

const RUST_BLOCK_ITEMS = new Set(['fn', 'impl', 'trait', 'mod', 'enum', 'struct', 'union', 'macro_rules', 'extern']);
const RUST_ITEM_KEYWORDS = new Set(['fn', 'impl', 'trait', 'mod', 'enum', 'struct', 'union', 'const', 'static', 'type', 'use', 'macro_rules', 'extern']);

/** Top-level Rust items with exact UTF-16 spans, including their outer attributes. */
export function rustItems(text) {
  const tokens = rustTokens(text);
  const items = [];
  let index = 0;
  while (index < tokens.length) {
    // Inner attributes such as #![allow(...)] belong to the module, not to an item.
    if (tokens[index].value === '#' && tokens[index + 1]?.value === '!' && tokens[index + 2]?.value === '[') {
      let depth = 0; index += 2;
      for (; index < tokens.length; index += 1) { if (tokens[index].value === '[') depth += 1; if (tokens[index].value === ']' && --depth === 0) break; }
      index += 1; continue;
    }
    const first = index;
    let keyword = null; let name = null; let depth = 0; let blockOpened = false; let end = null;
    for (; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.value === '{' || token.value === '(' || token.value === '[') { depth += 1; if (token.value === '{' && depth === 1) blockOpened = true; }
      else if (token.value === '}' || token.value === ')' || token.value === ']') {
        depth -= 1;
        // Block items end at their closing brace; so does an unknown top-level macro invocation block.
        if (depth === 0 && token.value === '}' && ((RUST_BLOCK_ITEMS.has(keyword) && !(keyword === 'struct' && !blockOpened)) || keyword === null)) { end = index; break; }
      } else if (token.value === ';' && depth === 0) { end = index; break; }
      else if (depth === 0 && !keyword && token.kind === 'identifier' && RUST_ITEM_KEYWORDS.has(token.value) && !(token.value === 'const' && tokens[index + 1]?.value === 'fn')) {
        keyword = token.value;
        const next = tokens[index + 1];
        if (keyword === 'macro_rules') name = tokens[index + 2]?.value;
        else if (keyword === 'impl') {
          const brace = tokens.findIndex((candidate, position) => position > index && candidate.value === '{');
          name = `impl ${text.slice(tokens[index + 1].start, tokens[brace > 0 ? brace - 1 : index + 1].end).replace(/\s+/gu, ' ')}`;
        } else if (keyword === 'use') name = `use ${text.slice(next.start, tokens.slice(index).find(candidate => candidate.value === ';')?.start ?? next.end).replace(/\s+/gu, ' ')}`;
        else if (keyword === 'extern') name = next?.kind === 'literal' ? 'extern block' : `extern ${tokens[index + 2]?.value ?? ''}`;
        else name = next?.value;
      }
    }
    if (end === null) break;
    const start = tokens[first].start; const stop = tokens[end].end;
    const references = new Set(tokens.slice(first, end + 1).filter(token => token.kind === 'identifier').map(token => token.value));
    references.delete(name);
    items.push({ name: name ?? `item@${start}`, kind: keyword ?? 'unknown', start, end: stop, references });
    index = end + 1;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Assembly and translation.

/** A Lean or Rocq file is translated at module granularity: one item spanning the whole file. */
export function moduleItems(text, path = 'module') {
  return [{ name: path.split('/').pop().replace(/\.[^.]+$/u, ''), kind: 'module', start: 0, end: text.length, references: [] }];
}

/** Items of a source file in its language. */
export function extractItems(text, language, path) {
  if (language === 'JavaScript') return javaScriptItems(text);
  if (language === 'Rust') return rustItems(text);
  return moduleItems(text, path);
}

/** The item plus every same-file declaration it reaches by name; segments map program offsets back. */
export function assembleItem(text, items, item, language) {
  if (item.kind === 'module') return { program: text, segments: [{ programStart: 0, start: 0, end: text.length, site: 'item' }], closure: 1 };
  const named = new Map();
  for (const candidate of items) if (!['use', 'impl'].includes(candidate.kind) && !named.has(candidate.name)) named.set(candidate.name, candidate);
  const closure = new Set([item]); const queue = [item];
  while (queue.length) {
    for (const reference of queue.pop().references) {
      const dependency = named.get(reference);
      if (dependency && !closure.has(dependency)) { closure.add(dependency); queue.push(dependency); }
    }
  }
  // JavaScript function declarations are hoisted, so placing them first preserves meaning.
  const unique = [...new Map([...closure].map(candidate => [candidate.start, candidate])).values()]
    .sort((a, b) => (language === 'JavaScript' ? Number(!a.hoisted) - Number(!b.hoisted) : 0) || a.start - b.start);
  const segments = []; let program = '';
  for (const part of unique) {
    if (program) program += '\n\n';
    segments.push({ programStart: program.length, start: part.start, end: part.end, site: part === item ? 'item' : part.name });
    program += text.slice(part.start, part.end);
  }
  program += '\n';
  if (language === 'Rust' && !unique.some(part => part.kind === 'fn' && part.name === 'main')) program += '\nfn main() {}\n';
  return { program, segments, closure: unique.length };
}

function originalSpan(text, segments, span) {
  if (!span) return null;
  const segment = segments.find(candidate => span.start >= candidate.programStart && span.start <= candidate.programStart + (candidate.end - candidate.start));
  if (!segment) return { harness: true };
  const start = segment.start + span.start - segment.programStart;
  const end = Math.min(segment.end, segment.start + span.end - segment.programStart);
  return { start, end, byteStart: byteOffset(text, start), byteEnd: byteOffset(text, end), sha256: sha256(text.slice(start, end)), site: segment.site };
}

/**
 * Refusal cause: the diagnostic's construct head with only program-local names abstracted.
 * Syntax diagnostics keep their exact text; standard-library names, operators, methods and
 * types stay, because they name the missing construct an upstream request has to add.
 */
const LOCAL_NAME_CAUSES = [
  [/^function value \S+:/u, 'function value used as data (not called)'],
  [/^use of \S+ before its declaration/u, 'use before declaration (temporal dead zone)'],
  [/^unknown name crate\./u, 'unknown name: binding imported from another module'],
  [/^unknown name /u, 'unknown name: binding from another crate or module'],
  [/^unknown type /u, 'unknown type: type defined in another module'],
  [/^field access: field \S+ is only portable inside a constructor match/u, 'field access outside a constructor match'],
  [/^field access: field \S+ is outside the portable core/u, 'Rust field access'],
  [/^record field \S+ is missing/u, 'record field missing'],
  [/^namespace property \S+:/u, 'namespace property that is not a method'],
  [/^function after a top-level statement/u, 'function after a top-level statement'],
  [/^one value is used as /u, 'one value used at two inferred types'],
  [/^new (\S+):/u, match => (match[1] in globalThis ? `new ${match[1]}` : 'new of a class defined in the program')],
  [/^indexing of \S+: only arrays/u, 'indexing of a non-array'],
  [/^spread of \S+: only arrays/u, 'spread of a non-array'],
  [/^literal suffix \S+:/u, 'Rust literal suffix'],
  [/^format spec \S+:/u, 'Rust format spec'],
  [/^method call \.(\w+)\(\): .* (on \S+|string operation|on strings, not on \S+)$/u, match => `method call .${match[1]}() unchecked ${match[2].startsWith('on strings') ? 'on optional string' : match[2]}`],
];
export function refusalFamily(message, kind) {
  if (kind === 'syntax') return message.split('\n')[0];
  for (const [pattern, cause] of LOCAL_NAME_CAUSES) {
    const match = message.match(pattern);
    if (match) return typeof cause === 'function' ? cause(match) : cause;
  }
  return kind === 'type' ? message : message.split(/: /u)[0].trim();
}

/** Translate one item; returns the record, certificates and targets. */
export function certifyItem(path, language, text, items, item) {
  const { program, segments, closure } = assembleItem(text, items, item, language);
  const record = { id: `${path}#${item.name}@${item.start}`, path, language, name: item.name, kind: item.kind,
    span: [item.start, item.end], bytes: [byteOffset(text, item.start), byteOffset(text, item.end)],
    sha256: sha256(text.slice(item.start, item.end)), closure, programSha256: sha256(program) };
  const imported = importCertifiedSource(program, language);
  const targets = CERTIFIED_LANGUAGES.filter(target => target !== language);
  if (imported.status === 'refused') {
    const receipt = translateCertified(program, language, targets[0], { imported }).receipt;
    return { ...record, status: 'refused', refusal: { stage: imported.stage, kind: imported.diagnostic.kind, message: imported.diagnostic.message,
      family: refusalFamily(imported.diagnostic.message, imported.diagnostic.kind), original: originalSpan(text, segments, imported.diagnostic.span), receiptSha256: sha256(receipt) } };
  }
  // Each directed path is judged on its own: an emitter refusal for one target leaves the others.
  const outputs = []; const refusals = [];
  for (const target of targets) {
    const result = translateCertified(program, language, target, { imported });
    if (result.status !== 'translated') {
      refusals.push({ stage: result.stage, kind: result.diagnostic.kind, message: result.diagnostic.message,
        family: refusalFamily(result.diagnostic.message, result.diagnostic.kind), original: originalSpan(text, segments, result.diagnostic.span), receiptSha256: sha256(result.receipt), target });
    } else outputs.push({ target, targetSource: result.targetSource, certificate: result.certificate, constructs: result.constructs, observation: result.observation });
  }
  if (!outputs.length) return { ...record, status: 'refused', refusal: refusals[0], refusals };
  const own = outputs[0].constructs.filter(construct => construct.source === item.name || construct.source.startsWith(`${item.name}.`));
  return { ...record, status: own.length ? 'admitted' : 'lowered', constructs: own, outputs, refusals,
    targets: outputs.map(output => ({ target: output.target, sha256: sha256(output.targetSource), certificateSha256: sha256(output.certificate) })) };
}

/** Run the whole repository in memory. */
export function runCertifiedBulk({ inputs = bulkInputs() } = {}) {
  const files = [];
  const records = [];
  for (const input of inputs) {
    const text = readFileSync(join(root, input.path), 'utf8');
    let items;
    try { items = extractItems(text, input.language, input.path); } catch (error) {
      files.push({ ...input, sha256: sha256(text), bytes: encoder.encode(text).length, items: 0, extraction: error.message }); continue;
    }
    const translatable = items.filter(item => item.kind !== 'use');
    files.push({ ...input, sha256: sha256(text), bytes: encoder.encode(text).length, items: translatable.length, context: items.length - translatable.length });
    for (const item of translatable) records.push(certifyItem(input.path, input.language, text, items, item));
  }
  return { files, records };
}

// ---------------------------------------------------------------------------
// Hand-written mirrors: observe admitted translations on the mirror's documented inputs.

/** The signature line of a translated function in a target text. */
export function signatureLine(text, name) {
  const pattern = new RegExp(`^(?:pub )?(?:fn|function) ${name.replace(/[$]/gu, '\\$')}\\(`, 'u');
  return text.split('\n').find(line => pattern.test(line)) ?? null;
}

function runJavaScript(text) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], { input: text, encoding: 'utf8' });
  return { status: run.status === 0 ? 'completed' : 'failed', lines: run.stdout.split('\n').slice(0, -1) };
}

/**
 * Probe one mirror: the item's own certified program plus a main that prints each call, run
 * through the certified pipeline. The probe must keep the bulk translation's signature, so it
 * observes the same certified function. Observers: the RML evaluator over the intermediate when
 * it completes; the certified JavaScript target itself on a Rust-to-JavaScript path; otherwise
 * the JavaScript rendering of the decoded certified intermediate the Rust certificate pins.
 */
export function observeMirror(mirror, record, text, items) {
  const base = { id: mirror.id, mirror, record: record?.id ?? null };
  if (!record || record.status !== 'admitted') return { ...base, verdict: 'not-admitted' };
  const output = record.outputs.find(candidate => candidate.target === mirror.to);
  const targetName = record.constructs.find(construct => construct.source === mirror.source.name)?.target ?? mirror.source.name;
  const bulkSignature = signatureLine(output.targetSource, targetName);
  const mirrorText = readFileSync(join(root, mirror.mirror.path), 'utf8');
  const result = { ...base, targetName, bulkSignature, mirrorPresent: mirrorText.includes(mirror.mirror.signature) };
  if (!result.mirrorPresent) return { ...result, verdict: 'mirror-missing' };
  if (mirror.correspondence === 'signature-differs' || !mirror.calls.length) return { ...result, verdict: 'signature-differs', calls: [] };
  const item = items.find(candidate => candidate.name === mirror.source.name && candidate.start === record.span[0]);
  let { program } = assembleItem(text, items, item, mirror.from);
  if (mirror.from === 'Rust') {
    program = program.replace(/\nfn main\(\) \{\}\n$/u, '');
    program += `\nfn main() {\n${mirror.calls.map(call => `    println!("{}", ${mirror.source.name}(${call.args}));`).join('\n')}\n}\n`;
  } else program += `\n${mirror.calls.map(call => `console.log(String(${mirror.source.name}(${call.args})));`).join('\n')}\n`;
  const imported = importCertifiedSource(program, mirror.from);
  if (imported.status !== 'imported') return { ...result, verdict: 'probe-refused', probeRefusal: imported.diagnostic.message };
  const probe = translateCertified(program, mirror.from, mirror.to, { imported });
  if (probe.status !== 'translated') return { ...result, verdict: 'probe-refused', probeRefusal: probe.diagnostic.message };
  const probeSignature = signatureLine(probe.targetSource, targetName);
  if (probeSignature !== bulkSignature) return { ...result, verdict: 'probe-retyped', probeSignature };
  const observers = [];
  if (probe.observation.status === 'completed') observers.push({ by: 'rml-evaluation', ...probe.observation });
  observers.push(mirror.to === 'JavaScript'
    ? { by: 'certified-javascript-target', ...runJavaScript(probe.targetSource) }
    : { by: 'certified-intermediate-javascript', ...runJavaScript(renderCertifiedJavaScript(imported)) });
  const calls = mirror.calls.map((call, index) => {
    const observed = observers.map(observer => ({ by: observer.by, line: observer.lines[index] ?? null }));
    return { ...call, observed, verdict: observed.every(entry => entry.line === call.expected) ? 'match' : 'mismatch' };
  });
  return { ...result, probeSha256: sha256(program), probeCertificateSha256: sha256(probe.certificate), probeTargetSha256: sha256(probe.targetSource),
    observers: observers.map(observer => ({ by: observer.by, status: observer.status })), calls,
    verdict: calls.every(call => call.verdict === 'match') && observers.every(observer => observer.status === 'completed') ? 'match' : 'mismatch' };
}

export function observeMirrors(run) {
  const { mirrors } = JSON.parse(readFileSync(join(root, MIRRORS_FILE), 'utf8'));
  const sources = new Map();
  return mirrors.map(mirror => {
    if (!sources.has(mirror.source.path)) {
      const text = readFileSync(join(root, mirror.source.path), 'utf8');
      sources.set(mirror.source.path, { text, items: extractItems(text, mirror.from, mirror.source.path) });
    }
    const { text, items } = sources.get(mirror.source.path);
    const record = run.records.find(candidate => candidate.path === mirror.source.path && candidate.name === mirror.source.name);
    return observeMirror(mirror, record, text, items);
  });
}

// ---------------------------------------------------------------------------
// Receipt and generated files.

const count = (list, predicate) => list.filter(predicate).length;

export function buildCertifiedBulk(run = runCertifiedBulk()) {
  const { files, records } = run;
  const identity = vendoredTranslatorIdentity();
  const output = new Map();
  const languages = [...new Set(files.map(file => file.language))];
  // A record's refusal on one directed path: the shared frontend or checker refusal, or the
  // emitter refusal of that target.
  const pathRefusal = (record, target) => (record.refusals?.length || record.status !== 'refused'
    ? record.refusals?.find(refusal => refusal.target === target) : record.refusal);
  const pathStatus = (record, target) => (pathRefusal(record, target) ? 'refused' : record.status);
  const causes = new Map();
  for (const record of records) {
    const seen = new Set();
    for (const target of CERTIFIED_LANGUAGES.filter(candidate => candidate !== record.language)) {
      const refusal = pathRefusal(record, target);
      if (!refusal) continue;
      const key = JSON.stringify([record.language, refusal.stage, refusal.kind, refusal.family, refusal.target ?? '']);
      const entry = causes.get(key) ?? { items: 0, paths: 0, item: 0, dependency: 0, harness: 0 };
      entry.paths += 1;
      if (!seen.has(key)) {
        seen.add(key); entry.items += 1;
        const site = refusal.original?.site;
        if (site === 'item') entry.item += 1; else if (site) entry.dependency += 1; else entry.harness += 1;
      }
      causes.set(key, entry);
    }
  }
  const causeForms = [...causes].sort((a, b) => b[1].items - a[1].items || a[0].localeCompare(b[0])).map(([key, entry]) => {
    const [language, stage, kind, family, target] = JSON.parse(key);
    return ['cause', ['language', language], ['stage', stage], ['kind', kind], ['construct', family], ...(target ? [['target', target]] : []),
      ['items', String(entry.items)], ['paths', String(entry.paths)],
      ['in-item', String(entry.item)], ['in-dependency', String(entry.dependency)], ['unlocated', String(entry.harness)]];
  });
  const paths = [];
  for (const language of languages) for (const target of CERTIFIED_LANGUAGES) {
    if (target === language) continue;
    const scoped = records.filter(item => item.language === language);
    paths.push(['path', ['from', language], ['to', target],
      ['admitted', String(count(scoped, item => pathStatus(item, target) === 'admitted'))],
      ['lowered', String(count(scoped, item => pathStatus(item, target) === 'lowered'))],
      ['refused', String(count(scoped, item => pathStatus(item, target) === 'refused'))]]);
  }
  const refusalForm = refusal => ['refusal', ['stage', refusal.stage], ['kind', refusal.kind], ['construct', refusal.family], ['message', refusal.message],
    ...(refusal.target ? [['target', refusal.target]] : []),
    ...(refusal.original?.start !== undefined ? [['span', String(refusal.original.start), String(refusal.original.end)],
      ['bytes', String(refusal.original.byteStart), String(refusal.original.byteEnd)], ['span-sha256', refusal.original.sha256],
      ['site', refusal.original.site]]
      : [['span', refusal.original?.harness ? 'harness' : 'unlocated']]),
    ['receipt-sha256', refusal.receiptSha256]];
  const itemForm = record => ['item', ['id', record.id], ['kind', record.kind], ['span', ...record.span.map(String)], ['bytes', ...record.bytes.map(String)],
    ['sha256', record.sha256], ['closure', String(record.closure)], ['program-sha256', record.programSha256], ['status', record.status],
    ...(record.status === 'refused'
      ? (record.refusals?.length ? record.refusals : [record.refusal]).map(refusalForm)
      : [['constructs', ...record.constructs.map(construct => ['construct', construct.kind, construct.source, construct.target])],
        ['targets', ...record.targets.map(target => ['target', target.target, ['sha256', target.sha256], ['certificate-sha256', target.certificateSha256]])],
        ...record.refusals.map(refusalForm)])];
  for (const language of languages) {
    const scoped = records.filter(record => record.language === language);
    output.set(`items-${language.toLowerCase()}.lino`, `${serializeLinks(['certified-bulk-items', ['schema', BULK_SCHEMA], ['language', language], ...scoped.map(itemForm)])}\n`);
  }
  // Certificates and targets of admitted items, aggregated per source file and target.
  const admittedFiles = new Map();
  for (const record of records.filter(item => item.status === 'admitted')) {
    if (!admittedFiles.has(record.path)) admittedFiles.set(record.path, []);
    admittedFiles.get(record.path).push(record);
  }
  for (const [path, list] of admittedFiles) {
    const stem = path.replace(/\.[^.]+$/u, '');
    for (const target of CERTIFIED_LANGUAGES.filter(candidate => candidate !== list[0].language)) {
      const outputs = list.map(record => ({ record, output: record.outputs.find(candidate => candidate.target === target) })).filter(entry => entry.output);
      if (!outputs.length) continue;
      output.set(`certificates/${stem}.${target.toLowerCase()}.lino`, outputs.map(({ output: item }) => item.certificate).join('\n\n') + '\n');
      const comment = { JavaScript: ['// ', ''], Rust: ['// ', ''], Lean: ['-- ', ''], Rocq: ['(* ', ' *)'] }[target];
      // Each target follows its header line verbatim, so the text up to the next header hashes to target-sha256.
      // A bundle concatenates separate targets (each with its own prelude and inner attributes), so it is
      // stored as text: it is evidence, never one compilable module, and must not join the source inventory.
      output.set(`targets/${stem}.${target.toLowerCase()}.${CERTIFIED_EXTENSIONS[target]}.txt`, outputs.map(({ record, output: item }) => {
        if (!item.targetSource.endsWith('\n')) throw new Error(`target of ${record.id} does not end with a newline`);
        return `${comment[0]}rml-certified-item ${record.id} target-sha256=${sha256(item.targetSource)}${comment[1]}\n${item.targetSource}`;
      }).join(''));
    }
  }
  // Hand-written mirrors; texts are JSON-quoted so control characters stay visible.
  const mirrors = run.mirrors ?? observeMirrors(run);
  const quoted = value => JSON.stringify(value);
  output.set('mirrors.lino', `${serializeLinks(['certified-bulk-mirrors', ['schema', 'rml:certified-bulk-mirrors:1'], ['cases', MIRRORS_FILE, sha256(readFileSync(join(root, MIRRORS_FILE)))],
    ...mirrors.map(entry => ['mirror', ['id', entry.id], ['path', entry.mirror.from, entry.mirror.to], ['source', entry.mirror.source.path, entry.mirror.source.name],
      ['hand-written', entry.mirror.mirror.path, entry.mirror.mirror.name, ['present', String(entry.mirrorPresent ?? false)]],
      ['item', entry.record ?? 'none'], ['correspondence', entry.mirror.correspondence],
      ...(entry.bulkSignature ? [['certified-signature', entry.bulkSignature]] : []), ['mirror-signature', entry.mirror.mirror.signature],
      ...(entry.probeSignature ? [['probe-signature', entry.probeSignature]] : []),
      ...(entry.probeRefusal ? [['probe-refusal', entry.probeRefusal]] : []),
      ...(entry.probeSha256 ? [['probe', ['program-sha256', entry.probeSha256], ['certificate-sha256', entry.probeCertificateSha256], ['target-sha256', entry.probeTargetSha256]]] : []),
      ...(entry.observers ?? []).map(observer => ['observer', observer.by, observer.status]),
      ...(entry.calls ?? []).map(call => ['call', ['args', quoted(call.args)], ['expected', quoted(call.expected)],
        ...call.observed.map(observed => ['observed', observed.by, quoted(observed.line)]), ['verdict', call.verdict]]),
      ['verdict', entry.verdict]])])}\n`);
  const generated = [...output].sort(([a], [b]) => a.localeCompare(b));
  const receipt = ['certified-bulk-receipt', ['schema', BULK_SCHEMA],
    ['practice', 'link-assistant/router#761 bulk translation receipts: original items preserved by span and hash, first refusals aggregated by cause'],
    ['translator', ['upstream', identity.upstream], ['commit', identity.commit], ['lock-sha256', identity.lockSha256]],
    ['implementation', ...IMPLEMENTATION.map(path => ['file', path, sha256(readFileSync(join(root, path)))])],
    ['recipe', ['regenerate', 'node scripts/generate-certified-bulk.mjs'], ['freshness', 'node scripts/generate-certified-bulk.mjs --check'],
      ['item', 'assembleItem(original file, item) then translateCertified(program, source, target)'],
      ['harness', 'JavaScript hoisted function declarations precede other declarations; a Rust program without main gets an effect-free fn main() {}; a Lean or Rocq file is one module item, translated verbatim']],
    ['scope', ...BULK_SCOPE.map(scope => ['root', scope.root, scope.language, String(count(files, file => file.path.startsWith(`${scope.root}/`) && file.language === scope.language))])],
    ['totals', ['files', String(files.length)], ['items', String(records.length)],
      ['admitted', String(count(records, item => item.status === 'admitted'))], ['lowered', String(count(records, item => item.status === 'lowered'))],
      ['refused', String(count(records, item => item.status === 'refused'))],
      ['certified-translations', String(records.filter(item => item.status === 'admitted').reduce((sum, item) => sum + item.targets.length, 0))]],
    ['languages', ...languages.map(language => {
      const scoped = records.filter(record => record.language === language);
      return ['language', language, ['files', String(count(files, file => file.language === language))], ['items', String(scoped.length)],
        ['admitted', String(count(scoped, item => item.status === 'admitted'))], ['lowered', String(count(scoped, item => item.status === 'lowered'))],
        ['refused', String(count(scoped, item => item.status === 'refused'))],
        ['kinds', ...[...new Set(scoped.map(item => item.kind))].sort().map(kind => [kind, String(count(scoped, item => item.kind === kind)),
          String(count(scoped, item => item.kind === kind && item.status === 'admitted'))])]];
    })],
    ['paths', ...paths],
    ['causes', ...causeForms],
    ['mirrors', ['file', 'mirrors.lino'], ['cases', String(mirrors.length)],
      ...['match', 'mismatch', 'signature-differs', 'probe-retyped', 'probe-refused', 'not-admitted', 'mirror-missing']
        .map(verdict => [verdict, String(count(mirrors, entry => entry.verdict === verdict))]),
      ['calls', String(mirrors.reduce((sum, entry) => sum + (entry.calls?.length ?? 0), 0))],
      ['matching-calls', String(mirrors.reduce((sum, entry) => sum + count(entry.calls ?? [], call => call.verdict === 'match'), 0))]],
    ['inputs', ...files.map(file => ['input', ['path', file.path], ['language', file.language], ['sha256', file.sha256], ['bytes', String(file.bytes)],
      ['items', String(file.items)], ['admitted', String(count(records, item => item.path === file.path && item.status === 'admitted'))],
      ...(file.extraction ? [['extraction-refused', file.extraction]] : [])])],
    ['outputs', ...generated.map(([path, text]) => ['output', ['path', path], ['sha256', sha256(text)]])],
    ['authority', ['macros', 'none'], ['traits', 'none'], ['runtime', 'none'], ['external-kernels', 'oracle-only']]];
  output.set('receipt.lino', `${serializeLinks(receipt)}\n`);
  return { files: output, run };
}

function listGenerated(directory, base = directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listGenerated(path, base) : [relative(base, path).split('\\').join('/')];
  });
}

export function checkCertifiedBulk(files = buildCertifiedBulk().files) {
  const stale = []; const missing = [];
  for (const [path, text] of files) {
    const absolute = join(BULK_DIRECTORY, path);
    if (!existsSync(absolute)) missing.push(path);
    else if (readFileSync(absolute, 'utf8') !== text) stale.push(path);
  }
  const unexpected = listGenerated(BULK_DIRECTORY).filter(path => !files.has(path));
  return { ok: !stale.length && !missing.length && !unexpected.length, stale, missing, unexpected, files: files.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files } = buildCertifiedBulk();
  if (process.argv.includes('--check')) {
    const report = checkCertifiedBulk(files);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } else {
    rmSync(BULK_DIRECTORY, { recursive: true, force: true });
    for (const [path, text] of files) {
      const absolute = join(BULK_DIRECTORY, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, text);
    }
    console.log(`wrote ${files.size} files`);
  }
}
