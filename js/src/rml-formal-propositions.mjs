/** Additive source-bound proposition checking. Foundation receipts supply
 * syntax, not authority: every dependency is rechecked by the combined linked
 * program before its resulting type and value enter a later environment.
 */
import { createHash } from 'node:crypto';
import { FormalCorpus } from './rml-formal-corpus.mjs';
import { FormalFoundation } from './rml-formal-foundation.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';
import { describeSourceRecord } from './rml-formal-foundation-parser.mjs';
import { elaboratePropositionDeclaration, explicitPropositionReference } from './rml-formal-propositions-parser.mjs';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ordered = values => [...values].sort();
export const FORMAL_PROPOSITIONS_SCHEMA = 'rml-formal-propositions/v1';

export function linkedPropositionSource(kernels) {
  for (const name of ['core', 'indexed', 'records', 'propositions']) {
    if (typeof kernels?.[name] !== 'string') throw new TypeError(`${name} linked source required`);
  }
  return [kernels.core, kernels.indexed, kernels.records, kernels.propositions].join('\n') +
    '\n(linked-program formal-proposition-checker (uses formal-propositions) (uses formal-indexed) (uses formal-records) (uses formal-semantics))\n';
}

function bounded(value, depth = 0, budget = { nodes: 0, bytes: 0, seen: new Set() }) {
  if (++budget.nodes > 2_000_000 || depth > 512) throw new RangeError('proposition receipt budget exceeded');
  if (typeof value === 'string') {
    if ((budget.bytes += Buffer.byteLength(value)) > 64 * 1024 * 1024) throw new RangeError('proposition receipt text budget exceeded');
    return;
  }
  if (typeof value === 'boolean' || Number.isSafeInteger(value)) return;
  if (!value || typeof value !== 'object' || budget.seen.has(value)) throw new TypeError('invalid or cyclic proposition receipt');
  budget.seen.add(value);
  for (const child of Object.values(value)) bounded(child, depth + 1, budget);
  budget.seen.delete(value);
}

export class FormalPropositions {
  #corpus;
  #registry;
  #compiled = new Map();
  #checked = new Map();
  #status = new Map();
  #baseline;
  #kernelHash;
  #maxSteps;

  static fromRml(source, foundation, kernels, { maxSteps = 50_000, executionBasis = 'direct-structural' } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new RangeError('positive maxSteps required');
    const instance = new FormalPropositions();
    instance.#corpus = FormalCorpus.fromRml(source, foundation);
    instance.#maxSteps = maxSteps;
    const linked = linkedPropositionSource(kernels);
    instance.#kernelHash = hash(linked);
    instance.#registry = LinkedProgramRegistry.fromRml(linked, { executionBasis });
    const baseline = FormalFoundation.fromRml(source, foundation, kernels, { maxSteps, executionBasis });
    instance.#baseline = baseline.coverage();
    const statuses = new Map(instance.#baseline.declarations.map(entry => [entry.address, entry]));
    const records = instance.#corpus.declarations.filter(entry => entry.kind === 'structure').flatMap(entry => {
      try { return [describeSourceRecord(entry)]; } catch { return []; }
    });
    for (const declaration of instance.#corpus.declarations) {
      const old = statuses.get(declaration.address);
      if (old.status === 'upstream-admitted') { instance.#status.set(declaration.address, old); continue; }
      if (old.status === 'definition-checked' || old.status === 'conversion-proof-replayed') {
        const receipt = old.status === 'definition-checked'
          ? baseline.verifyDefinition(declaration.address) : baseline.verifyTheorem(declaration.address);
        instance.#compiled.set(declaration.address, { request: receipt.request, dependencies: receipt.dependencies, kind: receipt.kind });
        continue;
      }
      const references = new Set();
      const resolve = name => {
        const candidates = declaration.dependencies.map(address => instance.#corpus.declarationAt(address))
          .filter(candidate => candidate && candidate.language === declaration.language &&
            (candidate.symbol === name || `${candidate.module}.${candidate.symbol}` === name));
        const local = candidates.filter(candidate => candidate.module === declaration.module);
        const selected = local.length ? local : candidates;
        if (selected.length !== 1) throw new Error(`unresolved or ambiguous source reference ${name}`);
        const address = explicitPropositionReference(selected[0]);
        references.add(address);
        return address;
      };
      try {
        const compiled = elaboratePropositionDeclaration(declaration, resolve, records);
        if (!same(ordered(references), ordered(declaration.dependencies))) throw new Error('source dependency links differ from elaborated references');
        const request = compiled.annotation ? ['fs-definition', compiled.annotation, compiled.body, 'fs-empty']
          : ['fs-infer', compiled.body, 'fs-empty', 'fs-empty'];
        instance.#compiled.set(declaration.address, { request, dependencies: ordered(references), kind: 'definition', parameters: compiled.parameters });
      } catch (error) {
        instance.#status.set(declaration.address, { address: declaration.address, status: 'unsupported', reason: error.message });
      }
    }
    for (const declaration of instance.#corpus.declarations) instance.#check(declaration.address, new Set());
    return instance;
  }

  #environment(roots) {
    const visited = new Set();
    const visit = address => {
      if (visited.has(address)) return;
      if (this.#status.get(address)?.status !== 'definition-checked') throw new Error(`unchecked definition dependency ${address}`);
      visited.add(address);
      for (const dependency of this.#compiled.get(address).dependencies) visit(dependency);
    };
    for (const root of roots) visit(root);
    let environment = 'fs-empty';
    for (const address of ordered(visited)) {
      const result = this.#checked.get(address);
      environment = ['fs-global-bind', address, result[1], result[2], environment];
    }
    return environment;
  }
  #request(address) {
    const compiled = this.#compiled.get(address), request = structuredClone(compiled.request);
    request[request.length - 1] = this.#environment(compiled.dependencies);
    return request;
  }
  #reduce(request) { return this.#registry.reduce('formal-proposition-checker', request, { maxSteps: this.#maxSteps }); }
  #check(address, ancestors) {
    if (this.#status.has(address)) return;
    if (ancestors.has(address)) { this.#status.set(address, { address, status: 'unresolved', reason: 'cyclic semantic dependency' }); return; }
    const compiled = this.#compiled.get(address), next = new Set([...ancestors, address]);
    for (const dependency of compiled.dependencies) this.#check(dependency, next);
    try {
      const result = this.#reduce(this.#request(address));
      const proof = compiled.kind === 'conversion-proof';
      if (!(proof ? result.term === 'fs-proof-accepted' : result.term?.[0] === 'fs-ok')) throw new Error('linked program did not discharge the type/proposition obligation');
      if (!proof) this.#checked.set(address, result.term);
      this.#status.set(address, { address, status: proof ? 'conversion-proof-replayed' : 'definition-checked', dependencies: compiled.dependencies, steps: result.steps,
        ...(compiled.parameters ? { parameters: compiled.parameters.map(({ name, implicit }) => ({ name, implicit })) } : {}) });
    } catch (error) {
      this.#status.set(address, { address, status: 'unresolved', reason: error.message });
    }
  }
  coverage() {
    const declarations = [...this.#status.values()].sort((left, right) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0);
    return structuredClone({ ...this.#baseline, schema: FORMAL_PROPOSITIONS_SCHEMA, kernelHash: this.#kernelHash,
      checkedDefinitions: declarations.filter(entry => entry.status === 'definition-checked').length,
      replayedProofs: declarations.filter(entry => entry.status === 'conversion-proof-replayed').length,
      propositionTruthVerified: false, fullCorpusVerified: false, declarations });
  }
  #receipt(address, expectedStatus) {
    if (this.#status.get(address)?.status !== expectedStatus) throw new Error(`unchecked declaration ${address}`);
    const request = this.#request(address), reduced = this.#reduce(request), compiled = this.#compiled.get(address);
    const result = { schema: FORMAL_PROPOSITIONS_SCHEMA, corpusFingerprint: this.#corpus.fingerprint, kernelHash: this.#kernelHash,
      address, kind: compiled.kind, dependencies: compiled.dependencies, request, result: reduced.term, trace: reduced.trace, steps: reduced.steps,
      accepted: compiled.kind === 'conversion-proof' ? reduced.term === 'fs-proof-accepted' : reduced.term?.[0] === 'fs-ok' };
    bounded(result);
    return structuredClone(result);
  }
  verifyDefinition(address) { return this.#receipt(address, 'definition-checked'); }
  verifyTheorem(address) { return this.#receipt(address, 'conversion-proof-replayed'); }
  replay(receipt) {
    bounded(receipt);
    if (receipt.schema !== FORMAL_PROPOSITIONS_SCHEMA || receipt.corpusFingerprint !== this.#corpus.fingerprint || receipt.kernelHash !== this.#kernelHash) {
      throw new Error('proposition receipt differs from authoritative source/kernel');
    }
    const result = receipt.kind === 'definition' ? this.verifyDefinition(receipt.address)
      : receipt.kind === 'conversion-proof' ? this.verifyTheorem(receipt.address) : undefined;
    if (!result) throw new Error('unsupported proposition receipt kind');
    const matches = same(receipt, result);
    return { accepted: result.accepted && matches, executionAccepted: result.accepted, matches, result };
  }
}
