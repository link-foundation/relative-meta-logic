/** Source-bound extension of native formal checking to indexed types/records.
 * All old and new obligations are rechecked by the combined linked program.
 * The frozen core adapter is used only as a producer of already supported ASTs.
 */
import { createHash } from 'node:crypto';
import { FormalCorpus } from './rml-formal-corpus.mjs';
import { FormalSemantics } from './rml-formal-semantics.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';
import { describeSourceRecord, elaborateFoundationDeclaration, recordValues } from './rml-formal-foundation-parser.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const ordered = values => [...values].sort();
export const FORMAL_FOUNDATION_SCHEMA = 'rml-formal-foundation/v1';
export const formalRecord = values => ['fs-record-untyped', recordValues(values)];

export function linkedFoundationSource(kernels) {
  const programs = [kernels.core, kernels.indexed];
  if (kernels.records) programs.push(kernels.records);
  return `${programs.join('\n')}\n(linked-program formal-foundation\n` +
    ` (uses formal-indexed)\n${kernels.records ? ' (uses formal-records)\n' : ''} (uses formal-semantics))\n`;
}

function boundData(value, depth = 0, budget = { nodes: 0, bytes: 0, ancestors: new Set() }) {
  if (++budget.nodes > 2_000_000 || depth > 512) throw new RangeError('formal foundation receipt budget exceeded');
  if (typeof value === 'string') {
    if ((budget.bytes += Buffer.byteLength(value, 'utf8')) > 64 * 1024 * 1024) throw new RangeError('formal foundation text budget exceeded');
    return;
  }
  if (typeof value === 'boolean' || Number.isSafeInteger(value)) return;
  if (!value || typeof value !== 'object' || budget.ancestors.has(value)) throw new TypeError('invalid or cyclic formal foundation data');
  budget.ancestors.add(value);
  for (const child of Object.values(value)) boundData(child, depth + 1, budget);
  budget.ancestors.delete(value);
}

export class FormalFoundation {
  #corpus;
  #registry;
  #compiled = new Map();
  #checked = new Map();
  #status = new Map();
  #records = [];
  #kernelHash;
  #maxSteps;

  static fromRml(source, foundation, kernels, { maxSteps = 50_000, executionBasis = 'direct-structural' } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new RangeError('positive maxSteps required');
    if (typeof kernels?.core !== 'string' || typeof kernels?.indexed !== 'string') throw new TypeError('core and indexed linked sources required');
    const instance = new FormalFoundation();
    instance.#corpus = FormalCorpus.fromRml(source, foundation);
    instance.#maxSteps = maxSteps;
    const combined = linkedFoundationSource(kernels);
    instance.#kernelHash = hash(combined);
    instance.#registry = LinkedProgramRegistry.fromRml(combined, { executionBasis });
    const core = FormalSemantics.fromRml(source, foundation, kernels.core, { maxSteps, executionBasis });
    const baseline = new Map(core.coverage().declarations.map(entry => [entry.address, entry]));
    for (const declaration of instance.#corpus.declarations.filter(item => item.kind === 'structure')) {
      try { instance.#records.push(describeSourceRecord(declaration)); }
      catch (error) { instance.#status.set(declaration.address, { address: declaration.address, status: 'unsupported', reason: error.message }); }
    }
    for (const declaration of instance.#corpus.declarations) {
      if (instance.#status.has(declaration.address)) continue;
      const old = baseline.get(declaration.address);
      if (old.status === 'upstream-admitted') {
        instance.#status.set(declaration.address, structuredClone(old));
        continue;
      }
      if (old.status === 'definition-checked') {
        const receipt = core.verifyDefinition(declaration.address);
        const request = receipt.request;
        const compiled = request[0] === 'fs-definition'
          ? { annotation: request[1], body: request[2] } : { body: request[1] };
        instance.#compiled.set(declaration.address, { ...compiled, dependencies: receipt.dependencies });
      } else if (old.status === 'conversion-proof-replayed') {
        const receipt = core.verifyTheorem(declaration.address);
        instance.#compiled.set(declaration.address, { goal: receipt.request[1], proof: receipt.request[2], dependencies: receipt.dependencies });
      } else instance.#compile(declaration);
    }
    for (const declaration of instance.#corpus.declarations) instance.#check(declaration.address, new Set());
    return instance;
  }

  #compile(declaration) {
    const references = new Set();
    const resolve = name => {
      const candidates = declaration.dependencies.map(address => this.#corpus.declarationAt(address))
        .filter(candidate => candidate && candidate.language === declaration.language &&
          (candidate.symbol === name || `${candidate.module}.${candidate.symbol}` === name));
      const local = candidates.filter(candidate => candidate.module === declaration.module);
      const selected = local.length ? local : candidates;
      if (selected.length !== 1) throw new Error(`unresolved or ambiguous source reference ${name}`);
      references.add(selected[0].address);
      return selected[0].address;
    };
    try {
      const compiled = elaborateFoundationDeclaration(declaration, resolve, this.#records);
      if (!same(ordered(references), ordered(declaration.dependencies))) throw new Error('source dependency links differ from elaborated references');
      this.#compiled.set(declaration.address, { ...compiled, dependencies: ordered(references) });
    } catch (error) {
      this.#status.set(declaration.address, { address: declaration.address, status: 'unsupported', reason: error.message });
    }
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
  #reduce(request) { return this.#registry.reduce('formal-foundation', request, { maxSteps: this.#maxSteps }); }
  #request(address) {
    const compiled = this.#compiled.get(address);
    if (!compiled) throw new Error(`unsupported source declaration ${address}`);
    const globals = this.#environment(compiled.dependencies);
    return compiled.goal ? ['fs-prove', compiled.goal, compiled.proof, 'fs-empty', globals]
      : compiled.annotation ? ['fs-definition', compiled.annotation, compiled.body, globals]
        : ['fs-infer', compiled.body, 'fs-empty', globals];
  }
  #check(address, ancestors) {
    if (this.#status.has(address)) return;
    if (ancestors.has(address)) {
      this.#status.set(address, { address, status: 'unresolved', reason: 'cyclic semantic dependency' });
      return;
    }
    const compiled = this.#compiled.get(address);
    if (!compiled) return;
    const next = new Set([...ancestors, address]);
    for (const dependency of compiled.dependencies) this.#check(dependency, next);
    try {
      const result = this.#reduce(this.#request(address));
      const accepted = compiled.goal ? result.term === 'fs-proof-accepted' : result.term?.[0] === 'fs-ok';
      if (!accepted) throw new Error('linked foundation did not discharge the complete type/conversion obligation');
      if (!compiled.goal) this.#checked.set(address, result.term);
      this.#status.set(address, { address, status: compiled.goal ? 'conversion-proof-replayed' : 'definition-checked',
        dependencies: compiled.dependencies, steps: result.steps });
    } catch (error) {
      this.#status.set(address, { address, status: 'unresolved', reason: error.message });
    }
  }

  coverage() {
    const declarations = [...this.#status.values()].sort((left, right) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0);
    const pendingGeneratedTraits = this.#records.flatMap(record => record.derived.map(trait => ({ address: record.address, trait,
      status: 'source-preserved-native-trait-generation-pending' })));
    return structuredClone({ schema: FORMAL_FOUNDATION_SCHEMA, corpusFingerprint: this.#corpus.fingerprint,
      kernelHash: this.#kernelHash, fullCorpusVerified: false, declarationCount: this.#corpus.declarations.length,
      checkedDefinitions: declarations.filter(entry => entry.status === 'definition-checked').length,
      replayedProofs: declarations.filter(entry => entry.status === 'conversion-proof-replayed').length,
      upstreamAdmissions: declarations.filter(entry => entry.status === 'upstream-admitted').length,
      pendingGeneratedTraits, declarations });
  }

  #receipt(address, kind, input, request, reduced, accepted) {
    const receipt = { schema: FORMAL_FOUNDATION_SCHEMA, corpusFingerprint: this.#corpus.fingerprint,
      kernelHash: this.#kernelHash, address, kind, input, dependencies: this.#compiled.get(address).dependencies,
      request, result: reduced.term, trace: reduced.trace, steps: reduced.steps, accepted };
    boundData(receipt);
    return structuredClone(receipt);
  }
  verifyDefinition(address) {
    if (this.#status.get(address)?.status !== 'definition-checked') throw new Error(`unchecked definition ${address}`);
    const request = this.#request(address), result = this.#reduce(request);
    return this.#receipt(address, 'definition', [], request, result, result.term?.[0] === 'fs-ok');
  }
  verifyTheorem(address) {
    if (!this.#compiled.get(address)?.goal) throw new Error(`unsupported proof ${address}`);
    const request = this.#request(address), result = this.#reduce(request);
    return this.#receipt(address, 'conversion-proof', [], request, result, result.term === 'fs-proof-accepted');
  }
  #argument(expression, references, depth = 0, budget = { nodes: 0 }) {
    if (++budget.nodes > 20_000 || depth > 128) throw new RangeError('foundation argument resource limit exceeded');
    if (expression === 'fs-field-values-end') return;
    if (!Array.isArray(expression)) throw new TypeError('foundation argument must be constructor data');
    if (expression[0] === 'fs-global' && expression.length === 2 && typeof expression[1] === 'string') {
      if (this.#status.get(expression[1])?.status !== 'definition-checked') throw new Error('argument references an unchecked definition');
      references.add(expression[1]); return;
    }
    const arities = { 'fs-zero': 0, 'fs-successor': 1, 'fs-nil': 0, 'fs-cons': 2, 'fs-pair': 2,
      'fs-true': 0, 'fs-false': 0, 'fs-record-untyped': 1, 'fs-field-value': 2, 'fs-vector-repeat': 2 };
    if (!Object.hasOwn(arities, expression[0]) || expression.length !== arities[expression[0]] + 1) throw new TypeError('unsupported foundation argument constructor');
    for (const child of expression.slice(1)) this.#argument(child, references, depth + 1, budget);
  }
  evaluate(address, arguments_ = []) {
    if (this.#status.get(address)?.status !== 'definition-checked') throw new Error(`unchecked definition ${address}`);
    if (!Array.isArray(arguments_) || arguments_.length > 32) throw new RangeError('at most 32 foundation arguments');
    const references = new Set([address]), budget = { nodes: 0 };
    for (const argument of arguments_) this.#argument(argument, references, arguments_.length, budget);
    let expression = ['fs-global', address];
    for (const argument of arguments_) expression = ['fs-apply', expression, argument];
    const request = ['fs-infer', expression, 'fs-empty', this.#environment(references)];
    const result = this.#reduce(request);
    return this.#receipt(address, 'evaluation', arguments_, request, result, result.term?.[0] === 'fs-ok');
  }
  replay(receipt) {
    boundData(receipt);
    if (receipt.schema !== FORMAL_FOUNDATION_SCHEMA || receipt.corpusFingerprint !== this.#corpus.fingerprint || receipt.kernelHash !== this.#kernelHash) {
      throw new Error('foundation receipt differs from the authoritative source/kernel');
    }
    const result = receipt.kind === 'definition' ? this.verifyDefinition(receipt.address)
      : receipt.kind === 'conversion-proof' ? this.verifyTheorem(receipt.address)
        : receipt.kind === 'evaluation' ? this.evaluate(receipt.address, receipt.input) : undefined;
    if (!result) throw new Error('unsupported foundation receipt kind');
    const matches = same(receipt, result);
    return { accepted: result.accepted && matches, executionAccepted: result.accepted, matches, result };
  }
}
