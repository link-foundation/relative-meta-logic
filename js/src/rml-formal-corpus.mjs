import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import {
  parseRmlToMetaLanguage,
  reconstructRmlFromMetaLanguage,
} from './rml-meta-language.mjs';
import { parseLino, parseOne, tokenizeOne } from './rml-links.mjs';

const DECLARATION_KINDS = new Set([
  'abbreviation',
  'definition',
  'recursive-definition',
  'inductive',
  'structure',
  'theorem',
]);
const TOKEN_KINDS = new Set(['identifier', 'keyword', 'numeral', 'string', 'symbol']);
const SCHEMA = 'linked-source-v1';
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function leaf(value, context) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty reference`);
  }
  return value;
}

function natural(value, context) {
  const text = leaf(value, context);
  if (!/^(0|[1-9]\d*)$/.test(text)) throw new Error(`${context} must be a natural number`);
  const result = Number(text);
  if (!Number.isSafeInteger(result)) throw new Error(`${context} exceeds the safe integer range`);
  return result;
}

function uniqueLeafClauses(form, context, expected) {
  const result = new Map();
  for (const clause of form.slice(2)) {
    if (!Array.isArray(clause) || clause.length !== 2 || typeof clause[0] !== 'string') {
      throw new Error(`${context} clauses must have the form (name value)`);
    }
    if (!expected.has(clause[0])) {
      throw new Error(`${context} has unsupported clause ${clause[0]}`);
    }
    if (result.has(clause[0])) throw new Error(`${context} repeats clause ${clause[0]}`);
    result.set(clause[0], leaf(clause[1], `${context} ${clause[0]}`));
  }
  for (const name of expected) {
    if (!result.has(name)) throw new Error(`${context} is missing ${name}`);
  }
  return result;
}

function formsFrom(source, context) {
  const text = String(source);
  const metaLanguage = parseRmlToMetaLanguage(text);
  const reconstructed = reconstructRmlFromMetaLanguage(metaLanguage);
  const forms = parseLino(reconstructed).map(link => parseOne(tokenizeOne(link)));
  return { text, reconstructed, forms, roundTripOk: reconstructed === text, context };
}

function tokenHex(text) {
  return Buffer.from(text, 'utf8').toString('hex');
}

function decodeToken(form, context) {
  if (!Array.isArray(form) || form.length !== 3 || form[0] !== 'token') {
    throw new Error(`${context} entries must have the form (token kind utf8-hex)`);
  }
  const kind = leaf(form[1], `${context} token kind`);
  if (!TOKEN_KINDS.has(kind)) throw new Error(`${context} has unsupported token kind ${kind}`);
  const hex = leaf(form[2], `${context} token utf8-hex`);
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) {
    throw new Error(`${context} token utf8-hex must contain lowercase byte pairs`);
  }
  let text;
  try {
    text = UTF8.decode(Buffer.from(hex, 'hex'));
  } catch {
    throw new Error(`${context} token utf8-hex is not valid UTF-8`);
  }
  if (tokenHex(text) !== hex) throw new Error(`${context} token utf8-hex is not canonical UTF-8`);
  return { kind, text };
}

function parseRange(clause, context) {
  if (!Array.isArray(clause) || clause.length !== 3) {
    throw new Error(`${context} must have the form (${clause?.[0]} start end)`);
  }
  const start = natural(clause[1], `${context} start`);
  const end = natural(clause[2], `${context} end`);
  if (start > end) throw new Error(`${context} start must not exceed end`);
  return [start, end];
}

function rangeWithin(inner, outer) {
  return inner[0] >= outer[0] && inner[1] <= outer[1];
}

function rangeSlice(tokens, range) {
  return tokens.slice(range[0], range[1]);
}

function canonicalModule(module) {
  return [
    'module',
    module.language,
    module.name,
    module.tokens.map(token => `${token.kind}:${tokenHex(token.text)}`).join(','),
  ].join('|');
}

function canonicalDeclaration(declaration) {
  const range = value => `${value[0]}:${value[1]}`;
  return [
    'declaration',
    declaration.language,
    declaration.module,
    declaration.kind,
    declaration.symbol,
    declaration.proofStatus,
    declaration.recursive ? 'recursive' : 'non-recursive',
    range(declaration.syntaxRange),
    range(declaration.signatureRange),
    range(declaration.bodyRange),
    range(declaration.proofRange),
    declaration.dependencies.join(','),
  ].join('|');
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function semanticLines(modules, declarations) {
  return [
    ...modules.map(canonicalModule),
    ...declarations.map(canonicalDeclaration),
  ].sort(compareCodePoints);
}

function sha256(lines) {
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

function parseContract(forms) {
  let contract;
  for (const form of forms) {
    if (!Array.isArray(form) || form[0] !== 'formal-corpus-contract') {
      throw new Error(`trusted formal corpus foundation has unsupported form ${form?.[0]}`);
    }
    if (contract) throw new Error('trusted formal corpus foundation repeats its contract');
    const name = leaf(form[1], 'formal-corpus-contract name');
    const data = uniqueLeafClauses(
      form,
      `formal-corpus-contract ${name}`,
      new Set([
        'upstream', 'revision', 'schema', 'module-count', 'declaration-count',
        'semantic-token-count', 'dependency-count', 'sha256',
      ]),
    );
    if (!/^[0-9a-f]{64}$/.test(data.get('sha256'))) {
      throw new Error(`formal-corpus-contract ${name} sha256 must be 64 lowercase hex digits`);
    }
    contract = {
      name,
      upstream: data.get('upstream'),
      revision: data.get('revision'),
      schema: data.get('schema'),
      moduleCount: natural(data.get('module-count'), `formal-corpus-contract ${name} module-count`),
      declarationCount: natural(data.get('declaration-count'), `formal-corpus-contract ${name} declaration-count`),
      tokenCount: natural(data.get('semantic-token-count'), `formal-corpus-contract ${name} semantic-token-count`),
      dependencyCount: natural(data.get('dependency-count'), `formal-corpus-contract ${name} dependency-count`),
      fingerprint: data.get('sha256'),
    };
  }
  if (!contract) throw new Error('trusted formal corpus foundation is missing its contract');
  if (contract.schema !== SCHEMA) {
    throw new Error(`trusted formal corpus foundation uses unsupported schema ${contract.schema}`);
  }
  return contract;
}

function parseDeclaration(form, module, owner, seen) {
  if (form.length < 8) throw new Error(`formal-module ${module.language}.${module.name} has invalid declaration`);
  const kind = leaf(form[1], `formal-module ${module.name} declaration kind`);
  const symbol = leaf(form[2], `formal-module ${module.name} declaration symbol`);
  if (!DECLARATION_KINDS.has(kind)) {
    throw new Error(`formal declaration ${module.language}.${module.name}.${symbol} has unsupported kind ${kind}`);
  }
  const context = `formal declaration ${module.language}.${module.name}.${symbol}`;
  const singular = new Map();
  const dependencies = [];
  const clauseNames = new Set([
    'syntax-range', 'signature-range', 'body-range', 'proof-range',
    'proof-status', 'recursion',
  ]);
  for (const clause of form.slice(3)) {
    if (!Array.isArray(clause) || typeof clause[0] !== 'string') {
      throw new Error(`${context} has invalid clause`);
    }
    if (clause[0] === 'dependency') {
      if (clause.length !== 2) throw new Error(`${context} dependency must contain one address`);
      dependencies.push(leaf(clause[1], `${context} dependency`));
      continue;
    }
    if (!clauseNames.has(clause[0])) throw new Error(`${context} has unsupported clause ${clause[0]}`);
    if (singular.has(clause[0])) throw new Error(`${context} repeats clause ${clause[0]}`);
    singular.set(clause[0], clause);
  }
  for (const required of clauseNames) {
    if (!singular.has(required)) throw new Error(`${context} is missing ${required}`);
  }
  const syntaxRange = parseRange(singular.get('syntax-range'), `${context} syntax-range`);
  const signatureRange = parseRange(singular.get('signature-range'), `${context} signature-range`);
  const bodyRange = parseRange(singular.get('body-range'), `${context} body-range`);
  const proofRange = parseRange(singular.get('proof-range'), `${context} proof-range`);
  if (syntaxRange[1] > module.tokens.length) throw new Error(`${context} syntax-range exceeds its module`);
  for (const [name, range] of [
    ['signature-range', signatureRange], ['body-range', bodyRange], ['proof-range', proofRange],
  ]) {
    if (!rangeWithin(range, syntaxRange)) throw new Error(`${context} ${name} is outside syntax-range`);
  }
  const statusClause = singular.get('proof-status');
  const recursionClause = singular.get('recursion');
  if (statusClause.length !== 2) throw new Error(`${context} proof-status must contain one value`);
  if (recursionClause.length !== 2) throw new Error(`${context} recursion must contain one value`);
  const proofStatus = leaf(statusClause[1], `${context} proof-status`);
  const recursion = leaf(recursionClause[1], `${context} recursion`);
  if (!['verified', 'admitted', 'not-applicable'].includes(proofStatus)) {
    throw new Error(`${context} has unsupported proof status ${proofStatus}`);
  }
  if (!['recursive', 'non-recursive'].includes(recursion)) {
    throw new Error(`${context} has unsupported recursion value ${recursion}`);
  }
  if (new Set(dependencies).size !== dependencies.length) throw new Error(`${context} repeats a dependency`);
  dependencies.sort(compareCodePoints);
  const address = `rml.formal.${module.language}.${module.name}.${symbol}`;
  if (seen.has(address)) throw new Error(`duplicate formal declaration ${module.language}.${module.name}.${symbol}`);
  seen.add(address);
  const declaration = {
    corpus: owner,
    address,
    language: module.language,
    module: module.name,
    kind,
    symbol,
    proofStatus,
    recursive: recursion === 'recursive',
    syntaxRange,
    signatureRange,
    bodyRange,
    proofRange,
    syntax: rangeSlice(module.tokens, syntaxRange),
    signature: rangeSlice(module.tokens, signatureRange),
    body: rangeSlice(module.tokens, bodyRange),
    proof: rangeSlice(module.tokens, proofRange),
    dependencies,
  };
  if (declaration.syntax.length < 2 || declaration.syntax[1].text !== symbol) {
    throw new Error(`${context} syntax-range does not name ${symbol}`);
  }
  if (kind === 'theorem') {
    if (proofStatus === 'not-applicable') throw new Error(`${context} theorem proof status is required`);
    if (declaration.signature.length === 0) throw new Error(`${context} theorem judgement is empty`);
    if (declaration.proof.length === 0) throw new Error(`${context} theorem proof object is empty`);
    const admitted = declaration.proof.some(token => token.text === 'sorry' || token.text === 'Admitted');
    if ((proofStatus === 'admitted') !== admitted) {
      throw new Error(`${context} proof status disagrees with its proof object`);
    }
  } else {
    if (proofStatus !== 'not-applicable') throw new Error(`${context} non-theorem has a proof status`);
    if (declaration.body.length === 0) throw new Error(`${context} definition body is empty`);
    if (declaration.proof.length !== 0) throw new Error(`${context} non-theorem has a proof object`);
  }
  return declaration;
}

/** Complete linked source content from a pinned Lean/Rocq formal corpus. */
class FormalCorpus {
  constructor() {
    this.metaLanguageRoundTripOk = false;
    this.trustedFoundationRoundTripOk = false;
    this.name = '';
    this.upstream = '';
    this.revision = '';
    this.schema = '';
    this.formalModules = [];
    this.declarations = [];
    this.semanticTokenCount = 0;
    this.dependencyCount = 0;
    this.fingerprint = '';
  }

  static fromRml(source, trustedFoundationSource) {
    if (trustedFoundationSource === undefined) {
      throw new Error('trusted formal corpus foundation source is required');
    }
    const candidate = formsFrom(source, 'formal corpus');
    const trusted = formsFrom(trustedFoundationSource, 'trusted formal corpus foundation');
    const contract = parseContract(trusted.forms);
    const corpus = new FormalCorpus();
    corpus.metaLanguageRoundTripOk = candidate.roundTripOk;
    corpus.trustedFoundationRoundTripOk = trusted.roundTripOk;

    let header;
    const moduleForms = [];
    for (const form of candidate.forms) {
      if (!Array.isArray(form) || typeof form[0] !== 'string') continue;
      if (form[0] === 'formal-corpus-contract') {
        throw new Error('candidate formal corpus cannot declare trusted formal-corpus-contract forms');
      }
      if (form[0] === 'formal-corpus') {
        if (header) throw new Error('candidate formal corpus repeats its header');
        const name = leaf(form[1], 'formal-corpus name');
        const data = uniqueLeafClauses(
          form,
          `formal-corpus ${name}`,
          new Set(['upstream', 'revision', 'schema']),
        );
        header = {
          name,
          upstream: data.get('upstream'),
          revision: data.get('revision'),
          schema: data.get('schema'),
        };
      } else if (form[0] === 'formal-module') {
        moduleForms.push(form);
      } else {
        throw new Error(`candidate formal corpus has unsupported form ${form[0]}`);
      }
    }
    if (!header) throw new Error('candidate formal corpus is missing its header');
    if (header.name !== contract.name || header.upstream !== contract.upstream ||
        header.revision !== contract.revision || header.schema !== contract.schema) {
      throw new Error('candidate formal corpus metadata does not match trusted contract');
    }

    const seenModules = new Set();
    const pendingDeclarations = [];
    for (const form of moduleForms) {
      if (form.length < 6) throw new Error('formal-module must contain syntax and declarations');
      const owner = leaf(form[1], 'formal-module corpus');
      const language = leaf(form[2], 'formal-module language');
      const name = leaf(form[3], 'formal-module name');
      if (!['lean', 'rocq'].includes(language)) {
        throw new Error(`formal-module ${name} has unsupported language ${language}`);
      }
      if (owner !== header.name) throw new Error(`formal module ${language}.${name} belongs to ${owner}, not ${header.name}`);
      const moduleKey = `${language}\0${name}`;
      if (seenModules.has(moduleKey)) throw new Error(`duplicate formal module ${language}.${name}`);
      seenModules.add(moduleKey);
      let tokens;
      const declarations = [];
      for (const child of form.slice(4)) {
        if (!Array.isArray(child) || typeof child[0] !== 'string') {
          throw new Error(`formal-module ${language}.${name} has invalid content`);
        }
        if (child[0] === 'syntax') {
          if (tokens) throw new Error(`formal-module ${language}.${name} repeats syntax`);
          tokens = child.slice(1).map((token, index) =>
            decodeToken(token, `formal-module ${language}.${name} syntax ${index}`));
        } else if (child[0] === 'declaration') {
          declarations.push(child);
        } else {
          throw new Error(`formal-module ${language}.${name} has unsupported content ${child[0]}`);
        }
      }
      if (!tokens || tokens.length === 0) throw new Error(`formal-module ${language}.${name} has empty syntax`);
      if (declarations.length === 0) throw new Error(`formal-module ${language}.${name} has no declarations`);
      const module = { corpus: owner, language, name, tokens };
      corpus.formalModules.push(module);
      pendingDeclarations.push({ module, forms: declarations });
    }

    const seenDeclarations = new Set();
    for (const pending of pendingDeclarations) {
      for (const form of pending.forms) {
        corpus.declarations.push(parseDeclaration(form, pending.module, header.name, seenDeclarations));
      }
    }
    corpus.formalModules.sort((left, right) =>
      compareCodePoints(`${left.language}\0${left.name}`, `${right.language}\0${right.name}`));
    corpus.declarations.sort((left, right) =>
      compareCodePoints(canonicalDeclaration(left), canonicalDeclaration(right)));

    for (const declaration of corpus.declarations) {
      for (const dependency of declaration.dependencies) {
        if (!seenDeclarations.has(dependency)) {
          throw new Error(`formal declaration ${declaration.address} has unknown dependency ${dependency}`);
        }
      }
      const selfRecursive = declaration.dependencies.includes(declaration.address);
      if (declaration.recursive !== selfRecursive) {
        throw new Error(`formal declaration ${declaration.address} recursion disagrees with its dependencies`);
      }
    }

    corpus.semanticTokenCount = corpus.formalModules
      .reduce((count, module) => count + module.tokens.length, 0);
    corpus.dependencyCount = corpus.declarations
      .reduce((count, declaration) => count + declaration.dependencies.length, 0);
    const actualFingerprint = sha256(semanticLines(corpus.formalModules, corpus.declarations));
    const counts = [
      ['module count', corpus.formalModules.length, contract.moduleCount],
      ['declaration count', corpus.declarations.length, contract.declarationCount],
      ['semantic token count', corpus.semanticTokenCount, contract.tokenCount],
      ['dependency count', corpus.dependencyCount, contract.dependencyCount],
    ];
    for (const [name, actual, expected] of counts) {
      if (actual !== expected) {
        throw new Error(`formal corpus ${name} ${actual} does not match trusted ${name} ${expected}`);
      }
    }
    if (actualFingerprint !== contract.fingerprint) {
      throw new Error(
        `formal corpus fingerprint ${actualFingerprint} does not match trusted fingerprint ${contract.fingerprint}`,
      );
    }
    Object.assign(corpus, {
      name: header.name,
      upstream: header.upstream,
      revision: header.revision,
      schema: header.schema,
      fingerprint: actualFingerprint,
    });
    return corpus;
  }

  languages() {
    return [...new Set(this.formalModules.map(module => module.language))].sort();
  }

  modules(language) {
    return this.formalModules
      .filter(module => module.language === language)
      .map(module => module.name)
      .sort();
  }

  module(language, name) {
    return this.formalModules.find(module => module.language === language && module.name === name);
  }

  declaration(language, module, symbol) {
    return this.declarations.find(declaration =>
      declaration.language === language &&
      declaration.module === module &&
      declaration.symbol === symbol);
  }

  declarationAt(address) {
    return this.declarations.find(declaration => declaration.address === address);
  }

  dependencyClosure(address) {
    const visited = new Set();
    const visit = current => {
      const declaration = this.declarationAt(current);
      if (!declaration) throw new Error(`unknown formal declaration ${current}`);
      for (const dependency of declaration.dependencies) {
        if (dependency === address || visited.has(dependency)) continue;
        visited.add(dependency);
        visit(dependency);
      }
    };
    visit(address);
    return [...visited].sort();
  }

  counterpart(declaration) {
    const language = declaration.language === 'lean' ? 'rocq' : 'lean';
    return this.declaration(language, declaration.module, declaration.symbol);
  }
}

export {
  FormalCorpus,
  SCHEMA as FORMAL_CORPUS_SCHEMA,
  canonicalDeclaration,
  canonicalModule,
  semanticLines,
  sha256 as semanticSha256,
  tokenHex,
};
