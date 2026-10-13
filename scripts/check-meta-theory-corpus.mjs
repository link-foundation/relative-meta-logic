#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  FORMAL_CORPUS_SCHEMA,
  FormalCorpus,
  semanticLines,
  semanticSha256,
  tokenHex,
} from '../js/src/rml-formal-corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const languageConfigurations = [
  {
    language: 'lean',
    extension: '.lean',
    declaration: /^(abbrev|def|inductive|structure|theorem)\s+([^\s(:={]+)/gm,
  },
  {
    language: 'rocq',
    extension: '.v',
    declaration: /^(Definition|Fixpoint|Inductive|Record|Theorem|Lemma|Corollary)\s+([^\s(:={.]+)/gm,
  },
];

const normalizedKinds = new Map([
  ['abbrev', 'abbreviation'],
  ['def', 'definition'],
  ['inductive', 'inductive'],
  ['structure', 'structure'],
  ['theorem', 'theorem'],
  ['Definition', 'definition'],
  ['Fixpoint', 'recursive-definition'],
  ['Inductive', 'inductive'],
  ['Record', 'structure'],
  ['Theorem', 'theorem'],
  ['Lemma', 'theorem'],
  ['Corollary', 'theorem'],
]);

const FORMAL_KEYWORDS = new Set([
  'Definition', 'Fixpoint', 'Inductive', 'Record', 'Theorem', 'Lemma',
  'Corollary', 'Proof', 'Qed', 'Admitted', 'Defined', 'Require', 'Import',
  'From', 'End', 'Section', 'match', 'with', 'end', 'forall', 'exists',
  'fun', 'let', 'in', 'if', 'then', 'else', 'return', 'as', 'where',
  'abbrev', 'def', 'inductive', 'structure', 'theorem', 'by', 'namespace',
  'open', 'import', 'termination_by', 'decreasing_by', 'partial', 'mutual',
]);

const MULTI_CHARACTER_SYMBOLS = [
  '<->', '⟷', ':=', '=>', '->', '→', '<-', '←', '/\\', '\\/', '::',
  '++', '<=', '>=', '<>', '==', '!=', '<?', '=?', '<:', ':>', '..', '**',
];

const IDENTIFIER_START = /[\p{L}_]/u;
const IDENTIFIER_CONTINUE = /[\p{L}\p{N}_']/u;

function blankCharacter(character) {
  return character === '\n' || character === '\r' ? character : ' ';
}

// Remove nested Lean/Rocq comments without changing offsets. Keeping offsets
// lets declaration ranges point into the one module-wide linked token stream.
function sourceWithoutComments(source, language) {
  const blockOpen = language === 'lean' ? '/-' : '(*';
  const blockClose = language === 'lean' ? '-/' : '*)';
  const output = source.split('');
  let index = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  while (index < source.length) {
    if (depth > 0) {
      if (source.startsWith(blockOpen, index)) {
        output[index] = blankCharacter(source[index]);
        output[index + 1] = blankCharacter(source[index + 1]);
        depth += 1;
        index += 2;
      } else if (source.startsWith(blockClose, index)) {
        output[index] = blankCharacter(source[index]);
        output[index + 1] = blankCharacter(source[index + 1]);
        depth -= 1;
        index += 2;
      } else {
        output[index] = blankCharacter(source[index]);
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (source[index] === '\\') escaped = true;
      else if (source[index] === '"') inString = false;
      index += 1;
      continue;
    }
    if (source[index] === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (source.startsWith(blockOpen, index)) {
      output[index] = blankCharacter(source[index]);
      output[index + 1] = blankCharacter(source[index + 1]);
      depth = 1;
      index += 2;
      continue;
    }
    if (language === 'lean' && source.startsWith('--', index)) {
      while (index < source.length && source[index] !== '\n') {
        output[index] = ' ';
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  if (depth !== 0) throw new Error(`unterminated ${language} block comment`);
  if (inString) throw new Error(`unterminated ${language} string literal`);
  return output.join('');
}

function isIdentifierStart(character) {
  return character !== undefined && IDENTIFIER_START.test(character);
}

function isIdentifierContinue(character) {
  return character !== undefined && IDENTIFIER_CONTINUE.test(character);
}

function lexFormalSource(source, language) {
  const clean = sourceWithoutComments(source, language);
  const tokens = [];
  let index = 0;
  while (index < clean.length) {
    if (/\s/u.test(clean[index])) {
      index += 1;
      continue;
    }
    const start = index;
    if (clean[index] === '"') {
      index += 1;
      let escaped = false;
      while (index < clean.length) {
        const character = clean[index++];
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') break;
      }
      tokens.push({ kind: 'string', text: clean.slice(start, index), start, end: index });
      continue;
    }
    if (isIdentifierStart(clean[index])) {
      index += 1;
      while (isIdentifierContinue(clean[index])) index += 1;
      while (clean[index] === '.' && isIdentifierStart(clean[index + 1])) {
        index += 2;
        while (isIdentifierContinue(clean[index])) index += 1;
      }
      const text = clean.slice(start, index);
      tokens.push({
        kind: FORMAL_KEYWORDS.has(text) ? 'keyword' : 'identifier',
        text,
        start,
        end: index,
      });
      continue;
    }
    if (/\d/u.test(clean[index])) {
      index += 1;
      while (/\d/u.test(clean[index])) index += 1;
      tokens.push({ kind: 'numeral', text: clean.slice(start, index), start, end: index });
      continue;
    }
    const symbol = MULTI_CHARACTER_SYMBOLS.find(candidate => clean.startsWith(candidate, index));
    if (symbol) index += symbol.length;
    else index += 1;
    tokens.push({ kind: 'symbol', text: clean.slice(start, index), start, end: index });
  }
  return { clean, tokens };
}

function tokenIndexAtOrAfter(tokens, offset) {
  const index = tokens.findIndex(token => token.start >= offset);
  return index === -1 ? tokens.length : index;
}

function topLevelIndex(tokens, candidates, start = 0) {
  const opening = new Map([['(', ')'], ['[', ']'], ['{', '}'], ['⟨', '⟩']]);
  const closing = new Set(opening.values());
  const stack = [];
  for (let index = start; index < tokens.length; index += 1) {
    const text = tokens[index].text;
    if (opening.has(text)) stack.push(opening.get(text));
    else if (closing.has(text)) {
      if (stack.at(-1) === text) stack.pop();
    } else if (stack.length === 0 && candidates.has(text)) {
      return index;
    }
  }
  return -1;
}

function leanDeclarationEnd(clean, start) {
  const lineStart = clean.indexOf('\n', start) + 1;
  if (lineStart === 0) return clean.length;
  const nextCommand = /^(?=\S)/gm;
  nextCommand.lastIndex = lineStart;
  const match = nextCommand.exec(clean);
  return match ? match.index : clean.length;
}

function rocqDeclarationEnd(clean, start, theorem) {
  if (theorem) {
    const terminator = /\b(?:Qed|Admitted|Defined)\s*\./g;
    terminator.lastIndex = start;
    const match = terminator.exec(clean);
    if (!match) throw new Error(`Rocq theorem at offset ${start} has no proof terminator`);
    return match.index + match[0].length;
  }
  for (let index = start; index < clean.length; index += 1) {
    if (clean[index] === '.' && (index + 1 === clean.length || /\s/u.test(clean[index + 1]))) {
      return index + 1;
    }
  }
  throw new Error(`Rocq declaration at offset ${start} has no terminating period`);
}

function declarationAddress(language, module, symbol) {
  return `rml.formal.${language}.${module}.${symbol}`;
}

function parseDeclaration(configuration, module, match, endOffset) {
  const start = tokenIndexAtOrAfter(module.tokens, match.index);
  const end = tokenIndexAtOrAfter(module.tokens, endOffset);
  const syntax = module.tokens.slice(start, end);
  const sourceKeyword = match[1];
  const kind = normalizedKinds.get(sourceKeyword);
  const symbol = match[2];
  if (syntax[0]?.text !== sourceKeyword || syntax[1]?.text !== symbol) {
    throw new Error(
      `cannot locate ${configuration.language}.${module.name}.${symbol} in linked module syntax`,
    );
  }

  let signatureStart = start + 2;
  let signatureEnd;
  let bodyStart;
  let bodyEnd;
  let proofStart;
  let proofEnd;
  if (configuration.language === 'lean') {
    const localSeparator = topLevelIndex(syntax, new Set([':=', 'where', '|']), 2);
    if (localSeparator === -1) {
      throw new Error(`Lean declaration ${module.name}.${symbol} has no body separator`);
    }
    signatureEnd = start + localSeparator;
    const separator = syntax[localSeparator].text;
    const contentStart = start + localSeparator + (separator === '|' ? 0 : 1);
    if (kind === 'theorem') {
      bodyStart = contentStart;
      bodyEnd = contentStart;
      proofStart = contentStart;
      proofEnd = end;
    } else {
      bodyStart = contentStart;
      bodyEnd = end;
      proofStart = end;
      proofEnd = end;
    }
  } else if (kind === 'theorem') {
    const localProof = topLevelIndex(syntax, new Set(['Proof']), 2);
    if (localProof === -1) {
      throw new Error(`Rocq theorem ${module.name}.${symbol} has no Proof block`);
    }
    const statementTerminator = syntax[localProof - 1]?.text === '.' ? localProof - 1 : localProof;
    signatureEnd = start + statementTerminator;
    bodyStart = start + localProof;
    bodyEnd = bodyStart;
    proofStart = start + localProof;
    proofEnd = end;
  } else {
    const localSeparator = topLevelIndex(syntax, new Set([':=']), 2);
    if (localSeparator === -1) {
      throw new Error(`Rocq declaration ${module.name}.${symbol} has no := body separator`);
    }
    signatureEnd = start + localSeparator;
    bodyStart = start + localSeparator + 1;
    bodyEnd = syntax.at(-1)?.text === '.' ? end - 1 : end;
    proofStart = end;
    proofEnd = end;
  }

  const proof = module.tokens.slice(proofStart, proofEnd);
  const proofStatus = kind === 'theorem'
    ? (proof.some(token => token.text === 'sorry' || token.text === 'Admitted')
      ? 'admitted'
      : 'verified')
    : 'not-applicable';
  return {
    corpus: 'meta-theory-0.0.3',
    address: declarationAddress(configuration.language, module.name, symbol),
    language: configuration.language,
    module: module.name,
    sourceKeyword,
    kind,
    symbol,
    proofStatus,
    recursive: kind === 'recursive-definition',
    syntaxRange: [start, end],
    signatureRange: [signatureStart, signatureEnd],
    bodyRange: [bodyStart, bodyEnd],
    proofRange: [proofStart, proofEnd],
    syntax,
    signature: module.tokens.slice(signatureStart, signatureEnd),
    body: module.tokens.slice(bodyStart, bodyEnd),
    proof,
    dependencies: [],
  };
}

class ExtractedFormalCorpus {
  constructor(modules, declarations) {
    this.modules = modules;
    this.declarations = declarations;
  }

  declaration(language, module, symbol) {
    return this.declarations.find(declaration =>
      declaration.language === language &&
      declaration.module === module &&
      declaration.symbol === symbol);
  }
}

function resolveDependencies(declarations) {
  const symbols = new Map();
  for (const declaration of declarations) {
    const key = `${declaration.language}\0${declaration.symbol}`;
    const entries = symbols.get(key) ?? [];
    entries.push(declaration);
    symbols.set(key, entries);
  }
  for (const declaration of declarations) {
    const dependencies = new Set();
    for (const token of [...declaration.signature, ...declaration.body, ...declaration.proof]) {
      if (token.kind !== 'identifier') continue;
      const names = [token.text];
      if (token.text.includes('.')) names.push(token.text.slice(token.text.lastIndexOf('.') + 1));
      for (const name of names) {
        const matches = symbols.get(`${declaration.language}\0${name}`) ?? [];
        const preferred = matches.find(candidate => candidate.module === declaration.module);
        const selected = preferred ? [preferred] : matches.length === 1 ? matches : [];
        for (const dependency of selected) dependencies.add(dependency.address);
      }
    }
    declaration.dependencies = [...dependencies].sort();
    declaration.recursive = declaration.recursive || declaration.dependencies.includes(declaration.address);
  }
}

function extractFormalCorpus(upstreamRoot) {
  const sourceRoot = join(upstreamRoot, 'drafts', '0.0.3', 'src');
  const modules = [];
  const declarations = [];
  for (const configuration of languageConfigurations) {
    const directory = join(sourceRoot, configuration.language);
    const filenames = readdirSync(directory)
      .filter(filename => filename.endsWith(configuration.extension))
      .filter(filename => filename !== 'lakefile.lean')
      .sort();
    for (const filename of filenames) {
      const source = readFileSync(join(directory, filename), 'utf8');
      const { clean, tokens } = lexFormalSource(source, configuration.language);
      const module = {
        language: configuration.language,
        name: filename.slice(0, -configuration.extension.length),
        tokens,
      };
      modules.push(module);
      const matches = [...clean.matchAll(configuration.declaration)];
      for (const match of matches) {
        const kind = normalizedKinds.get(match[1]);
        const endOffset = configuration.language === 'lean'
          ? leanDeclarationEnd(clean, match.index)
          : rocqDeclarationEnd(clean, match.index, kind === 'theorem');
        declarations.push(parseDeclaration(configuration, module, match, endOffset));
      }
    }
  }
  resolveDependencies(declarations);
  declarations.sort((left, right) => {
    const a = canonical(left);
    const b = canonical(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  modules.sort((left, right) => {
    const a = `${left.language}\0${left.name}`;
    const b = `${right.language}\0${right.name}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return new ExtractedFormalCorpus(modules, declarations);
}

function tokenTexts(tokens) {
  return tokens.map(token => token.text);
}

function renderRange(name, range) {
  return `    (${name} ${range[0]} ${range[1]})`;
}

function renderFormalCorpus(corpus) {
  const lines = [
    '# Complete linked source representation of the pinned formal corpus.',
    '# Module syntax is stored as typed UTF-8 token links. Every declaration',
    '# selects its complete syntax, signature/judgement, definition body, and',
    '# proof-object ranges, then links to all referenced corpus declarations.',
    '',
    '(formal-corpus meta-theory-0.0.3',
    '  (upstream link-foundation/meta-theory)',
    '  (revision 087f4515d0652925eecc54bcade724445c3978f1)',
    `  (schema ${FORMAL_CORPUS_SCHEMA}))`,
    '',
  ];
  for (const module of corpus.modules) {
    lines.push(`(formal-module meta-theory-0.0.3 ${module.language} ${module.name}`);
    lines.push('  (syntax');
    for (const token of module.tokens) {
      lines.push(`    (token ${token.kind} ${tokenHex(token.text)})`);
    }
    lines.push('  )');
    const declarations = corpus.declarations
      .filter(declaration =>
        declaration.language === module.language && declaration.module === module.name)
      .sort((left, right) => left.syntaxRange[0] - right.syntaxRange[0]);
    for (const declaration of declarations) {
      lines.push(`  (declaration ${declaration.kind} ${declaration.symbol}`);
      lines.push(renderRange('syntax-range', declaration.syntaxRange));
      lines.push(renderRange('signature-range', declaration.signatureRange));
      lines.push(renderRange('body-range', declaration.bodyRange));
      lines.push(renderRange('proof-range', declaration.proofRange));
      lines.push(`    (proof-status ${declaration.proofStatus})`);
      lines.push(`    (recursion ${declaration.recursive ? 'recursive' : 'non-recursive'})`);
      for (const dependency of declaration.dependencies) {
        lines.push(`    (dependency ${dependency})`);
      }
      lines.push('  )');
    }
    lines.push(')');
    lines.push('');
  }
  return lines.join('\n');
}

function formalCorpusStats(corpus) {
  const tokenCount = corpus.modules.reduce((count, module) => count + module.tokens.length, 0);
  const dependencyCount = corpus.declarations
    .reduce((count, declaration) => count + declaration.dependencies.length, 0);
  return {
    moduleCount: corpus.modules.length,
    declarationCount: corpus.declarations.length,
    tokenCount,
    dependencyCount,
    fingerprint: semanticSha256(semanticLines(corpus.modules, corpus.declarations)),
  };
}

function renderFormalCorpusFoundation(corpus) {
  const stats = formalCorpusStats(corpus);
  return `# Independent semantic completeness contract for the pinned corpus.
# The fingerprint covers every typed source token, declaration range, proof
# status, recursion marker, and dependency link. Candidate data cannot change
# this contract or authorize an altered declaration body or proof object.

(formal-corpus-contract meta-theory-0.0.3
  (upstream link-foundation/meta-theory)
  (revision 087f4515d0652925eecc54bcade724445c3978f1)
  (schema ${FORMAL_CORPUS_SCHEMA})
  (module-count ${stats.moduleCount})
  (declaration-count ${stats.declarationCount})
  (semantic-token-count ${stats.tokenCount})
  (dependency-count ${stats.dependencyCount})
  (sha256 ${stats.fingerprint}))
`;
}

function canonical(declaration) {
  return [
    declaration.language,
    declaration.module,
    declaration.kind,
    declaration.symbol,
    declaration.proofStatus,
  ].join('|');
}

function extractFormalDeclarations(upstreamRoot) {
  return extractFormalCorpus(upstreamRoot).declarations;
}

function assertCorpusMatchesUpstream(upstreamRoot, corpus) {
  const extractedCorpus = extractFormalCorpus(upstreamRoot);
  assert.deepStrictEqual(
    semanticLines(extractedCorpus.modules, extractedCorpus.declarations),
    semanticLines(corpus.formalModules, corpus.declarations),
    'LiNo semantic corpus differs from the pinned Lean/Rocq sources',
  );
  return extractedCorpus.declarations;
}

function main(upstreamRoot) {
  const corpus = FormalCorpus.fromRml(
    readFileSync(join(repoRoot, 'lib', 'meta-theory', 'upstream-0.0.3.lino'), 'utf8'),
    readFileSync(join(repoRoot, 'lib', 'meta-theory', 'upstream-0.0.3-foundation.lino'), 'utf8'),
  );
  const actualRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: upstreamRoot,
    encoding: 'utf8',
  }).trim();
  assert.strictEqual(
    actualRevision,
    corpus.revision,
    `upstream checkout must be pinned to ${corpus.revision}`,
  );
  const declarations = assertCorpusMatchesUpstream(upstreamRoot, corpus);
  const admitted = declarations.filter(declaration => declaration.proofStatus === 'admitted');
  process.stdout.write(
    `verified ${declarations.length} declarations at ${actualRevision}; ` +
    `${admitted.length} admitted Lean proofs are explicitly accounted for\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const upstreamRoot = process.argv[2];
  if (!upstreamRoot) {
    process.stderr.write('usage: node scripts/check-meta-theory-corpus.mjs <meta-theory-checkout>\n');
    process.exitCode = 2;
  } else {
    main(resolve(upstreamRoot));
  }
}

export {
  assertCorpusMatchesUpstream,
  canonical,
  extractFormalCorpus,
  extractFormalDeclarations,
  formalCorpusStats,
  lexFormalSource,
  renderFormalCorpus,
  renderFormalCorpusFoundation,
  tokenTexts,
};
