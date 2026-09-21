import {
  parseRmlToMetaLanguage,
  reconstructRmlFromMetaLanguage,
} from './rml-meta-language.mjs';
import { parseLino, parseOne, tokenizeOne } from './rml-links.mjs';
import { createHash } from 'node:crypto';

const DECLARATION_KINDS = new Set([
  'abbreviation',
  'definition',
  'recursive-definition',
  'inductive',
  'structure',
  'theorem',
]);

function leaf(value, context) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty reference`);
  }
  return value;
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

function canonicalDeclaration(declaration) {
  return [
    declaration.language,
    declaration.module,
    declaration.kind,
    declaration.symbol,
    declaration.proofStatus,
  ].join('|');
}

function compareCodePoints(left, right) {
  const a = canonicalDeclaration(left);
  const b = canonicalDeclaration(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(lines) {
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

/**
 * A complete named-declaration inventory from an external formal corpus.
 *
 * Candidate declarations are loaded separately from a trusted revision/count/
 * fingerprint contract. Both inputs pass through the meta-language bridge.
 */
class FormalCorpus {
  constructor() {
    this.metaLanguageRoundTripOk = false;
    this.trustedFoundationRoundTripOk = false;
    this.name = '';
    this.upstream = '';
    this.revision = '';
    this.declarations = [];
  }

  static fromRml(source, trustedFoundationSource) {
    if (trustedFoundationSource === undefined) {
      throw new Error('trusted formal corpus foundation source is required');
    }
    const candidate = formsFrom(source, 'formal corpus');
    const trusted = formsFrom(trustedFoundationSource, 'trusted formal corpus foundation');
    const corpus = new FormalCorpus();
    corpus.metaLanguageRoundTripOk = candidate.roundTripOk;
    corpus.trustedFoundationRoundTripOk = trusted.roundTripOk;

    let contract;
    for (const form of trusted.forms) {
      if (!Array.isArray(form) || form[0] !== 'formal-corpus-contract') {
        throw new Error(`trusted formal corpus foundation has unsupported form ${form?.[0]}`);
      }
      if (contract) throw new Error('trusted formal corpus foundation repeats its contract');
      const name = leaf(form[1], 'formal-corpus-contract name');
      const data = uniqueLeafClauses(
        form,
        `formal-corpus-contract ${name}`,
        new Set(['upstream', 'revision', 'declaration-count', 'sha256']),
      );
      if (!/^\d+$/.test(data.get('declaration-count'))) {
        throw new Error(`formal-corpus-contract ${name} declaration-count must be a natural number`);
      }
      if (!/^[0-9a-f]{64}$/.test(data.get('sha256'))) {
        throw new Error(`formal-corpus-contract ${name} sha256 must be 64 lowercase hex digits`);
      }
      contract = {
        name,
        upstream: data.get('upstream'),
        revision: data.get('revision'),
        count: Number(data.get('declaration-count')),
        fingerprint: data.get('sha256'),
      };
    }
    if (!contract) throw new Error('trusted formal corpus foundation is missing its contract');

    let header;
    const seen = new Set();
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
          new Set(['upstream', 'revision']),
        );
        header = { name, upstream: data.get('upstream'), revision: data.get('revision') };
      } else if (form[0] === 'formal-module') {
        if (form.length < 5) throw new Error('formal-module must contain declarations');
        const owner = leaf(form[1], 'formal-module corpus');
        const language = leaf(form[2], 'formal-module language');
        const module = leaf(form[3], 'formal-module name');
        if (!['lean', 'rocq'].includes(language)) {
          throw new Error(`formal-module ${module} has unsupported language ${language}`);
        }
        for (const declarationForm of form.slice(4)) {
          if (!Array.isArray(declarationForm) || declarationForm.length < 2) {
            throw new Error(`formal-module ${language}.${module} has invalid declaration`);
          }
          const kind = leaf(declarationForm[0], `formal-module ${module} declaration kind`);
          const symbol = leaf(declarationForm[1], `formal-module ${module} declaration symbol`);
          if (!DECLARATION_KINDS.has(kind)) {
            throw new Error(`formal declaration ${language}.${module}.${symbol} has unsupported kind ${kind}`);
          }
          const proofStatus = kind === 'theorem'
            ? leaf(declarationForm[2], `formal theorem ${symbol} proof status`)
            : 'not-applicable';
          const expectedLength = kind === 'theorem' ? 3 : 2;
          if (declarationForm.length !== expectedLength) {
            throw new Error(`formal declaration ${language}.${module}.${symbol} has invalid shape`);
          }
          if (kind === 'theorem' && !['verified', 'admitted'].includes(proofStatus)) {
            throw new Error(`formal theorem ${language}.${module}.${symbol} has unsupported proof status ${proofStatus}`);
          }
          const key = `${language}\0${module}\0${symbol}`;
          if (seen.has(key)) throw new Error(`duplicate formal declaration ${language}.${module}.${symbol}`);
          seen.add(key);
          corpus.declarations.push({ corpus: owner, language, module, kind, symbol, proofStatus });
        }
      } else {
        throw new Error(`candidate formal corpus has unsupported form ${form[0]}`);
      }
    }
    if (!header) throw new Error('candidate formal corpus is missing its header');
    if (header.name !== contract.name ||
        header.upstream !== contract.upstream ||
        header.revision !== contract.revision) {
      throw new Error('candidate formal corpus metadata does not match trusted contract');
    }
    const wrongOwner = corpus.declarations.find(declaration => declaration.corpus !== header.name);
    if (wrongOwner) {
      throw new Error(`formal module ${wrongOwner.language}.${wrongOwner.module} belongs to ${wrongOwner.corpus}, not ${header.name}`);
    }
    corpus.declarations.sort(compareCodePoints);
    if (corpus.declarations.length !== contract.count) {
      throw new Error(
        `formal corpus declaration count ${corpus.declarations.length} does not match trusted count ${contract.count}`,
      );
    }
    const actualFingerprint = sha256(corpus.declarations.map(canonicalDeclaration));
    if (actualFingerprint !== contract.fingerprint) {
      throw new Error(
        `formal corpus fingerprint ${actualFingerprint} does not match trusted fingerprint ${contract.fingerprint}`,
      );
    }
    corpus.name = header.name;
    corpus.upstream = header.upstream;
    corpus.revision = header.revision;
    return corpus;
  }

  languages() {
    return [...new Set(this.declarations.map(declaration => declaration.language))].sort();
  }

  modules(language) {
    return [...new Set(this.declarations
      .filter(declaration => declaration.language === language)
      .map(declaration => declaration.module))].sort();
  }

  declaration(language, module, symbol) {
    return this.declarations.find(declaration =>
      declaration.language === language &&
      declaration.module === module &&
      declaration.symbol === symbol);
  }
}

export { FormalCorpus };
