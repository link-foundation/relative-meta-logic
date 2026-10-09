import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FormalCorpus } from '../js/src/rml-formal-corpus.mjs';
import { elaboratePropositionDeclaration, explicitPropositionReference } from '../js/src/rml-formal-propositions-parser.mjs';
import { extractFormalCorpus, renderFormalCorpus, renderFormalCorpusFoundation } from './check-meta-theory-corpus.mjs';

export const sha256 = text => createHash('sha256').update(text).digest('hex');

/** Mutation controls edit real upstream source bytes in a disposable copy,
 * re-extract declarations and their dependencies, then create a fresh source
 * contract. No mutation changes the retained upstream tree or its contract.
 */
export function propositionSourceMutations(upstreamRoot) {
  const temporary = mkdtempSync(join(tmpdir(), 'rml-proposition-source-'));
  const controls = [];
  try {
    cpSync(join(upstreamRoot, 'drafts'), join(temporary, 'drafts'), { recursive: true });
    for (const language of ['lean', 'rocq']) {
      const extension = language === 'lean' ? 'lean' : 'v';
      const path = join(temporary, 'drafts/0.0.3/src', language, `NetworkEquivalence.${extension}`);
      const original = readFileSync(path, 'utf8');
      const nat = language === 'lean' ? 'Nat' : 'nat';
      const bool = language === 'lean' ? 'Bool' : 'bool';
      const forall = language === 'lean' ? '∀' : 'forall';
      const start = language === 'lean' ? 'def' : 'Definition';
      const tupleFunction = `${start} TupleFunctionEquivalence`;
      const dupletFunction = `${start} DupletFunctionEquivalence`;
      const tupleList = `${start} TupleListEquivalence`;
      const dupletList = `${start} DupletListEquivalence`;
      const variants = [
        { name: 'implicit-index-type', symbol: 'TupleFunctionEquivalence', start: tupleFunction,
          change: text => text.replace(new RegExp(`n\\s*:\\s*${nat}`), `n : ${bool}`), accepted: false },
        { name: 'non-proposition-result', symbol: 'DupletFunctionEquivalence', start: dupletFunction,
          change: text => text.replace(': Prop :=', `: ${bool} :=`), accepted: false },
        { name: 'wrong-equality-type', symbol: 'TupleFunctionEquivalence', start: tupleFunction,
          change: text => text.replace('anet1 id = anet2 id', 'anet1 id = 0'), accepted: false },
        { name: 'non-proposition-body', symbol: 'DupletFunctionEquivalence', start: dupletFunction,
          change: text => text.replace('anet1 id = anet2 id', 'anet1 id'), accepted: false },
        { name: 'wrong-universal-domain', symbol: 'DupletFunctionEquivalence', start: dupletFunction,
          change: text => text.replace(`${forall} id,`, `${forall} (id : ${bool}),`), accepted: false },
        { name: 'unequal-dependent-indices', symbol: 'TupleListEquivalence', start: tupleList,
          change: text => language === 'lean'
            ? text.replace('(anet1 anet2 : NetworkTupleList n)', '(anet1 : NetworkTupleList n) (anet2 : NetworkTupleList 0)')
            : text.replace('(anet2: NetworkTupleList n)', '(anet2: NetworkTupleList 0)'), accepted: false },
        { name: 'false-but-formed', symbol: 'DupletListEquivalence', start: dupletList,
          change: text => text.replace('anet1 = anet2', '0 = 1'), accepted: true },
        { name: 'unlisted-source-name', symbol: 'FreshSourcePredicate', start: dupletFunction,
          change: text => text.replace('DupletFunctionEquivalence', 'FreshSourcePredicate'), accepted: true },
      ];
      for (const variant of variants) {
        const offset = original.indexOf(variant.start);
        if (offset < 0) throw new Error(`missing source declaration ${variant.start}`);
        const mutated = original.slice(0, offset) + variant.change(original.slice(offset));
        if (mutated === original) throw new Error(`ineffective mutation ${language}-${variant.name}`);
        writeFileSync(path, mutated);
        const extracted = extractFormalCorpus(temporary);
        const corpus = FormalCorpus.fromRml(renderFormalCorpus(extracted), renderFormalCorpusFoundation(extracted));
        const declaration = corpus.declaration(language, 'NetworkEquivalence', variant.symbol);
        controls.push({ name: `${language}-${variant.name}`, declaration, corpus,
          expectedAccepted: variant.accepted, sourceBinding: { moduleSha256: sha256(mutated), corpusFingerprint: corpus.fingerprint,
            signature: declaration.signature, body: declaration.body, dependencies: declaration.dependencies } });
        writeFileSync(path, original);
      }
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  return controls;
}

/** Build an obligation only from source references and previously checked
 * dependency results. This helper never checks acceptance on the host.
 */
export function sourcePropositionRequest(declaration, corpus, checked) {
  const references = new Set();
  const resolve = name => {
    const candidates = declaration.dependencies.map(address => corpus.declarationAt(address)).filter(candidate =>
      candidate && candidate.language === declaration.language && (candidate.symbol === name || `${candidate.module}.${candidate.symbol}` === name));
    const local = candidates.filter(candidate => candidate.module === declaration.module), selected = local.length ? local : candidates;
    if (selected.length !== 1) throw new Error(`unresolved source dependency ${name}`);
    const address = explicitPropositionReference(selected[0]);
    references.add(address);
    return address;
  };
  const compiled = elaboratePropositionDeclaration(declaration, resolve);
  if (JSON.stringify([...references].sort()) !== JSON.stringify([...declaration.dependencies].sort())) throw new Error('source references differ from dependency links');
  const visited = new Set();
  const visit = address => {
    if (visited.has(address)) return;
    const dependency = checked.get(address);
    if (!dependency?.accepted || dependency.kind !== 'definition') throw new Error(`unchecked dependency ${address}`);
    visited.add(address);
    for (const nested of dependency.dependencies) visit(nested);
  };
  for (const reference of references) visit(reference);
  let environment = 'fs-empty';
  for (const address of [...visited].sort()) {
    const entry = checked.get(address);
    environment = ['fs-global-bind', address, entry.result[1], entry.result[2], environment];
  }
  return compiled.annotation ? ['fs-definition', compiled.annotation, compiled.body, environment]
    : ['fs-infer', compiled.body, 'fs-empty', environment];
}
