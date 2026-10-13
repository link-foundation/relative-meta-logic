#!/usr/bin/env node
/**
 * Generate the native linked program for the pinned meta-theory corpus and
 * execute every elaborated non-declaration evaluation command through it.
 * Expected values are what the unchanged generic reducer computes; they are
 * independently compared with the source-stated expectations in upstream
 * comments and with the other language's counterpart command.
 *
 * A declaration counts as natively executed only with an ablation witness: a
 * value-producing case that reaches the same value on the program sliced to
 * its static closure, and stops reaching it once that declaration's own rules
 * are removed from the slice.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FormalCorpus } from '../js/src/rml-formal-corpus.mjs';
import {
  META_THEORY_NATIVE_PROGRAM, META_THEORY_NATIVE_SCHEMA, MetaTheoryNative, compactNative, corpusCommands,
  isNativeValue, languageNeutral, nativeClosure, nativeRegistry, nativeSha256, renderNativeValue, sliceNativeProgram,
} from '../js/src/rml-meta-theory-native.mjs';
import { assertCorpusMatchesUpstream, lexFormalSource } from './check-meta-theory-corpus.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
export const NATIVE_MAX_STEPS = 200_000;
const SOURCE_ROOT = 'lib/meta-theory/upstream-0.0.3-source';
export const NATIVE_PROGRAM_PATH = 'lib/meta-theory/upstream-0.0.3-native.lino';
export const NATIVE_PRELUDE_PATH = 'lib/meta-theory/meta-theory-native-prelude.lino';
export const NATIVE_CASES_PATH = 'test-corpus/meta-theory-native/cases.json';
export const NATIVE_COVERAGE_PATH = 'test-corpus/meta-theory-native/coverage.json';
export const NATIVE_CONVERSION_PATH = 'lib/meta-theory/upstream-0.0.3-native-conversion.lino';

/** The upstream comment on the command's last line, if any (the source-stated expectation). */
function sourceExpectation(command, rawModules) {
  const raw = rawModules.get(`${command.language}.${command.module}`);
  const token = raw.tokens[command.tokenRange[1] - 1];
  const lineEnd = raw.source.indexOf('\n', token.end);
  const rest = raw.source.slice(token.end, lineEnd === -1 ? undefined : lineEnd);
  const match = command.language === 'lean' ? /--\s*(.*)$/.exec(rest) : /\(\*\s*(.*?)\s*\*\)/.exec(rest);
  if (!match) return undefined;
  const text = match[1].replace(/^Ожидается результат:\s*/u, '').trim();
  return text.length ? text : undefined;
}

const numbers = text => (String(text).match(/\d+/g) ?? []).join(',');

/**
 * Execute one term on a registry and classify the outcome. Reduction failures
 * (step limit, stalled rewrite) are outcomes, not generator errors.
 */
export function executeNative(registry, term) {
  try {
    const reduced = registry.reduceResult(META_THEORY_NATIVE_PROGRAM, term, { maxSteps: NATIVE_MAX_STEPS });
    return { term: reduced.term, steps: reduced.steps, value: isNativeValue(reduced.term) };
  } catch (error) {
    return { failure: error.code ?? error.message, value: false };
  }
}

/** Whether an ablated outcome still reaches the recorded value. */
export function ablationOutcome(expected, outcome) {
  if (outcome.failure) return `failure:${outcome.failure}`;
  if (!outcome.value) return 'stuck';
  return JSON.stringify(compactNative(outcome.term)) === JSON.stringify(expected) ? 'unchanged' : 'different-value';
}

export function metaTheoryNativeArtifacts() {
  const source = read('lib/meta-theory/upstream-0.0.3.lino');
  const foundation = read('lib/meta-theory/upstream-0.0.3-foundation.lino');
  const prelude = read(NATIVE_PRELUDE_PATH);
  const corpus = FormalCorpus.fromRml(source, foundation);
  assertCorpusMatchesUpstream(resolve(root, SOURCE_ROOT), corpus);
  const rawModules = new Map(corpus.formalModules.map(module => {
    const path = `${SOURCE_ROOT}/drafts/0.0.3/src/${module.language}/${module.name}.${module.language === 'lean' ? 'lean' : 'v'}`;
    const text = read(path);
    return [`${module.language}.${module.name}`, { source: text, tokens: lexFormalSource(text, module.language).tokens }];
  }));
  const commands = corpusCommands(corpus);
  const braceListModules = commands.filter(command => command.kind === 'notation')
    .map(command => `${command.language}.${command.module}`);
  const native = MetaTheoryNative.fromCorpus(corpus, { braceListModules });
  const { analyses, rules } = native.analyzeCommands(commands);
  const program = native.programSource({ extraRules: rules });
  const listing = native.coverage();
  const registry = nativeRegistry(prelude, program);
  const sliced = new Map();
  const slicedRegistry = closure => {
    const key = closure.join('\n');
    if (!sliced.has(key)) sliced.set(key, nativeRegistry(prelude, sliceNativeProgram(program, closure)));
    return sliced.get(key);
  };
  const cases = [];
  const execute = (id, kind, term, roots, extra = {}) => {
    const outcome = executeNative(registry, term);
    if (outcome.failure) throw new Error(`${id}: native execution failed: ${outcome.failure}`);
    const closure = nativeClosure(listing, roots);
    const expected = compactNative(outcome.term);
    // The static closure must be sufficient: the slice reaches the same result.
    const local = executeNative(slicedRegistry(closure), term);
    if (local.failure || JSON.stringify(compactNative(local.term)) !== JSON.stringify(expected) || local.steps !== outcome.steps) {
      throw new Error(`${id}: execution on its static closure differs from the whole program`);
    }
    const record = { id, kind, ...extra, request: compactNative(term), expected, steps: outcome.steps, value: outcome.value, closure,
      ...(outcome.value ? { rendered: renderNativeValue(outcome.term, extra.language) } : {}) };
    cases.push(record);
    return record;
  };

  const commandRecords = [];
  for (const [index, analysis] of analyses.entries()) {
    const command = commands[index];
    const record = { id: analysis.id, language: analysis.language, module: analysis.module, kind: analysis.kind,
      tokenRange: analysis.tokenRange, status: analysis.status, ...(analysis.reason ? { reason: analysis.reason } : {}) };
    if (analysis.targets) record.targets = analysis.targets;
    if (analysis.notation) record.notation = analysis.notation;
    if (analysis.namespace) record.namespace = analysis.namespace;
    if (analysis.target) record.target = analysis.target;
    if (analysis.status === 'elaborated' && (analysis.kind === 'eval' || analysis.kind === 'compute')) {
      const caseRecord = execute(`${analysis.id}-execution`, 'command-execution', analysis.term, analysis.references,
        { command: analysis.id, language: analysis.language, references: analysis.references });
      const expectation = sourceExpectation(command, rawModules);
      if (expectation !== undefined) {
        caseRecord.sourceExpectation = expectation;
        caseRecord.sourceExpectationNumbersMatch = numbers(expectation) === numbers(caseRecord.rendered ?? '');
      }
      record.witness = caseRecord.id;
      record.nativeExecution = caseRecord.value ? 'value' : 'stuck';
    } else if (analysis.status === 'elaborated' && analysis.kind === 'check') {
      const caseRecord = execute(`${analysis.id}-check`, 'command-check', analysis.term, [analysis.target],
        { command: analysis.id, language: analysis.language, target: analysis.target });
      record.witness = caseRecord.id;
      record.nativeExecution = caseRecord.value ? 'value' : 'stuck';
    }
    commandRecords.push(record);
  }

  // Independent cross-language comparison: the n-th evaluation command of a
  // Lean module against the n-th of its Rocq counterpart, when counts agree.
  const evaluations = (language, module) => cases.filter(item => item.kind === 'command-execution' &&
    item.language === language && item.command.startsWith(`rml.formal.${language}.${module}#`));
  for (const module of corpus.modules('lean')) {
    const lean = evaluations('lean', module);
    const rocq = evaluations('rocq', module);
    if (!lean.length || lean.length !== rocq.length) continue;
    lean.forEach((item, position) => {
      const other = rocq[position];
      const agree = JSON.stringify(languageNeutral(item.expected)) === JSON.stringify(languageNeutral(other.expected));
      item.counterpart = other.id;
      other.counterpart = item.id;
      item.counterpartAgrees = other.counterpartAgrees = agree;
    });
  }

  // Declaration-level cases: closed definitions, types and theorem statements normalize.
  for (const declaration of corpus.declarations) {
    const entry = native.entries.get(declaration.address);
    if (entry.status !== 'elaborated') continue;
    if (declaration.kind === 'theorem') {
      execute(`${declaration.address}-statement`, 'statement-normalization', ['mt-statement', declaration.address],
        [declaration.address], { address: declaration.address, language: declaration.language });
    } else if (entry.arity === 0) {
      execute(`${declaration.address}-closed-normalization`, 'closed-normalization', [declaration.address],
        [declaration.address], { address: declaration.address, language: declaration.language });
    }
  }

  // Ablation witnesses: the smallest value case whose result depends on the declaration's rules.
  const valueCases = cases.filter(item => item.value)
    .sort((left, right) => left.closure.length - right.closure.length || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const witnesses = new Map();
  for (const entry of listing) {
    if (entry.status !== 'elaborated') continue;
    for (const item of valueCases) {
      if (!item.closure.includes(entry.address)) continue;
      const without = item.closure.filter(address => address !== entry.address);
      const outcome = executeNative(nativeRegistry(prelude, sliceNativeProgram(program, without)), expandRequest(item.request));
      const ablation = ablationOutcome(item.expected, outcome);
      if (ablation !== 'unchanged') {
        witnesses.set(entry.address, { case: item.id, ablation });
        break;
      }
    }
  }

  const declarations = listing.map(entry => ({ ...entry, executionWitness: witnesses.get(entry.address) ?? null }));
  const programHash = nativeSha256(program);
  const preludeHash = nativeSha256(prelude);
  const count = predicate => declarations.filter(predicate).length;
  const coverage = {
    schema: META_THEORY_NATIVE_SCHEMA,
    corpusFingerprint: corpus.fingerprint,
    programHash,
    preludeHash,
    conversionHash: nativeSha256(native.conversionProgramSource()),
    semantics: 'untyped call-by-value linked execution; typing is the separate formal-propositions layer',
    declarationCount: declarations.length,
    elaborated: count(entry => entry.status === 'elaborated'),
    exactDependencies: count(entry => entry.dependencyCheck.status === 'exact'),
    executionWitnessed: count(entry => entry.executionWitness !== null),
    commandCount: commandRecords.length,
    commandsElaborated: commandRecords.filter(record => record.status === 'elaborated').length,
    evaluationsExecuted: commandRecords.filter(record => record.nativeExecution === 'value' &&
      ['eval', 'compute'].includes(record.kind)).length,
    sourceExpectationsMatched: cases.filter(item => item.sourceExpectationNumbersMatch === true).length,
    sourceExpectationsDiffering: cases.filter(item => item.sourceExpectationNumbersMatch === false).map(item => item.id),
    counterpartsAgreeing: cases.filter(item => item.counterpartAgrees === true).length,
    counterpartsDiffering: cases.filter(item => item.counterpartAgrees === false).map(item => item.id),
    declarations,
    commands: commandRecords,
  };
  return {
    program,
    conversion: native.conversionProgramSource(),
    cases: { schema: `${META_THEORY_NATIVE_SCHEMA}-cases`, corpusFingerprint: corpus.fingerprint, programHash, preludeHash,
      program: META_THEORY_NATIVE_PROGRAM, maxSteps: NATIVE_MAX_STEPS, cases },
    coverage,
  };
}

/** Inverse of compactNative for requests: (mt-natural N) back to a binary natural link. */
export function expandRequest(term) {
  if (Array.isArray(term) && term.length === 2 && term[0] === 'mt-natural') {
    let number = Number(term[1]);
    const bits = [];
    while (number > 0) { bits.push(number % 2 === 1 ? 'mt-b1' : 'mt-b0'); number = Math.floor(number / 2); }
    return bits.reduceRight((inner, bit) => [bit, inner], 'mt-zero');
  }
  return Array.isArray(term) ? term.map(expandRequest) : term;
}

/**
 * Independently re-execute recorded native evidence. Every case must reach its
 * recorded normal form in the recorded number of steps, on the whole program
 * and on its static-closure slice; every claimed execution witness must still
 * lose its value once the declaration's rules are removed from that slice.
 * Returns the list of problems (empty when the evidence holds).
 */
export function validateNativeEvidence({ prelude, program, cases, coverage }, { reexecuteCases = true, addresses } = {}) {
  const problems = [];
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (cases.programHash !== nativeSha256(program) || coverage.programHash !== nativeSha256(program)) {
    problems.push('program hash differs from the recorded evidence');
  }
  if (cases.preludeHash !== nativeSha256(prelude) || coverage.preludeHash !== nativeSha256(prelude)) {
    problems.push('prelude hash differs from the recorded evidence');
  }
  let registry;
  try {
    registry = nativeRegistry(prelude, program);
  } catch (error) {
    return [...problems, `native program does not load: ${error.message}`];
  }
  const byId = new Map(cases.cases.map(item => [item.id, item]));
  for (const item of reexecuteCases ? cases.cases : []) {
    const outcome = executeNative(registry, expandRequest(item.request));
    if (outcome.failure || !same(compactNative(outcome.term), item.expected) || outcome.steps !== item.steps ||
        outcome.value !== item.value) {
      problems.push(`${item.id}: re-execution differs from the recorded normal form`);
    }
  }
  const declarations = new Map(coverage.declarations.map(entry => [entry.address, entry]));
  for (const entry of coverage.declarations) {
    const witness = entry.executionWitness;
    if (!witness || (addresses && !addresses.includes(entry.address))) continue;
    const item = byId.get(witness.case);
    if (!item) { problems.push(`${entry.address}: witness case ${witness.case} is missing`); continue; }
    if (!item.value) { problems.push(`${entry.address}: witness case ${witness.case} does not reach a value`); continue; }
    if (!item.closure.includes(entry.address)) { problems.push(`${entry.address}: witness case does not reach the declaration`); continue; }
    if (!same(item.closure, nativeClosure(coverage.declarations, item.closure))) {
      problems.push(`${entry.address}: witness closure is not closed under recorded references`);
      continue;
    }
    const request = expandRequest(item.request);
    const local = executeNative(nativeRegistry(prelude, sliceNativeProgram(program, item.closure)), request);
    if (local.failure || !local.value || !same(compactNative(local.term), item.expected)) {
      problems.push(`${entry.address}: witness case does not reach its value on its static closure`);
      continue;
    }
    const without = item.closure.filter(address => address !== entry.address);
    const ablation = ablationOutcome(item.expected,
      executeNative(nativeRegistry(prelude, sliceNativeProgram(program, without)), request));
    if (ablation === 'unchanged') problems.push(`${entry.address}: removing its rules leaves ${witness.case} unchanged`);
    else if (ablation !== witness.ablation) problems.push(`${entry.address}: ablation outcome ${ablation} differs from ${witness.ablation}`);
  }
  for (const [address, entry] of declarations) {
    if (entry.executionWitness && entry.status !== 'elaborated') problems.push(`${address}: witness claimed for an unelaborated declaration`);
  }
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const artifacts = metaTheoryNativeArtifacts();
  const outputs = [
    [NATIVE_PROGRAM_PATH, artifacts.program],
    [NATIVE_CONVERSION_PATH, artifacts.conversion],
    [NATIVE_CASES_PATH, `${JSON.stringify(artifacts.cases, null, 2)}\n`],
    [NATIVE_COVERAGE_PATH, `${JSON.stringify(artifacts.coverage, null, 2)}\n`],
  ];
  if (!check) mkdirSync(resolve(root, 'test-corpus/meta-theory-native'), { recursive: true });
  for (const [path, text] of outputs) {
    if (check) {
      if (read(path) !== text) throw new Error(`stale ${path}; run node scripts/generate-meta-theory-native.mjs`);
    } else writeFileSync(resolve(root, path), text);
  }
  const { coverage } = artifacts;
  console.log(`${check ? 'checked' : 'generated'} ${coverage.elaborated}/${coverage.declarationCount} elaborated declarations, ` +
    `${coverage.executionWitnessed} with ablation witnesses, ${coverage.evaluationsExecuted} evaluation commands executed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
