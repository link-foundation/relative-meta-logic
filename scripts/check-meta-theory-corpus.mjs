#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FormalCorpus } from '../js/src/rml-formal-corpus.mjs';

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
  const sourceRoot = join(upstreamRoot, 'drafts', '0.0.3', 'src');
  const declarations = [];
  for (const configuration of languageConfigurations) {
    const directory = join(sourceRoot, configuration.language);
    const filenames = readdirSync(directory)
      .filter(filename => filename.endsWith(configuration.extension))
      .filter(filename => filename !== 'lakefile.lean')
      .sort();
    for (const filename of filenames) {
      const source = readFileSync(join(directory, filename), 'utf8');
      const matches = [...source.matchAll(configuration.declaration)];
      const module = filename.slice(0, -configuration.extension.length);
      for (let index = 0; index < matches.length; index += 1) {
        const kind = normalizedKinds.get(matches[index][1]);
        const body = source.slice(matches[index].index, matches[index + 1]?.index ?? source.length);
        const admitted = configuration.language === 'lean'
          ? /\bsorry\b/.test(body)
          : /\bAdmitted\s*\./.test(body);
        declarations.push({
          language: configuration.language,
          module,
          kind,
          symbol: matches[index][2],
          proofStatus: kind === 'theorem' ? (admitted ? 'admitted' : 'verified') : 'not-applicable',
        });
      }
    }
  }
  return declarations.sort((left, right) => {
    const a = canonical(left);
    const b = canonical(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function assertCorpusMatchesUpstream(upstreamRoot, corpus) {
  const extracted = extractFormalDeclarations(upstreamRoot);
  assert.deepStrictEqual(
    extracted.map(canonical),
    corpus.declarations.map(canonical),
    'LiNo formal corpus manifest differs from the pinned Lean/Rocq sources',
  );
  return extracted;
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

export { assertCorpusMatchesUpstream, canonical, extractFormalDeclarations };
