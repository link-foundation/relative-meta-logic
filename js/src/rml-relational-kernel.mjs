/** Declared codecs and public-call orchestration for source-defined Horn semantics. */
import { createHash } from 'node:crypto';
import { HornResolution } from './rml-horn-resolution.mjs';
const cons = (head, tail) => ['cons', head, tail];
const parts = (value, tag, length) => { if (!Array.isArray(value) || value.length !== length || value[0] !== tag) throw new Error(`invalid relational ${tag}`); return value; };
export const encodeRelationalList = values => values.reduceRight((tail, head) => cons(head, tail), 'end');
export function decodeRelationalList(value) {
  const result = [];
  while (Array.isArray(value) && value.length === 3 && value[0] === 'cons') { result.push(value[1]); value = value[2]; }
  if (value !== 'end') throw new Error('invalid relational list');
  return result;
}
export function encodeRelationalBits(value) {
  const bits = [...new TextEncoder().encode(value)].flatMap(byte => Array.from({ length: 8 }, (_, i) => byte & (128 >> i) ? 'one' : 'zero'));
  return bits.reduceRight((tail, bit) => [bit, tail], 'end');
}
export function decodeRelationalBits(value) {
  const bits = [];
  while (Array.isArray(value) && value.length === 2 && ['zero', 'one'].includes(value[0])) { bits.push(value[0] === 'one'); value = value[1]; }
  if (value !== 'end' || bits.length % 8) throw new Error('invalid relational UTF-8 bits');
  const bytes = new Uint8Array(bits.length / 8);
  bits.forEach((bit, i) => { if (bit) bytes[i >> 3] |= 128 >> (i % 8); });
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export function encodeRelationalNode(value, pattern = false) {
  if (typeof value === 'string') return pattern && value.startsWith('?') && value.length > 1
    ? ['variable', encodeRelationalBits(value.slice(1))] : ['atom', encodeRelationalBits(value)];
  if (!Array.isArray(value)) throw new Error('relational input requires string/list nodes');
  return ['list', encodeRelationalList(value.map(child => encodeRelationalNode(child, pattern)))];
}
export function decodeRelationalNode(value) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('invalid relational node');
  if (value[0] === 'atom') return decodeRelationalBits(value[1]);
  if (value[0] === 'list') return decodeRelationalList(value[1]).map(decodeRelationalNode);
  throw new Error('unknown relational node');
}
export function encodeRelationalRules(rules) {
  return encodeRelationalList(rules.map(rule => ['rule', ['origin', encodeRelationalBits(rule.program), encodeRelationalBits(rule.name)],
    encodeRelationalNode(rule.pattern, true), encodeRelationalNode(rule.replacement, true)]));
}
export function encodeRelationalPrograms(programs) {
  const values = programs instanceof Map ? [...programs.values()] : [...programs];
  const origin = item => ['origin', encodeRelationalBits(item.program), encodeRelationalBits(item.name)];
  return encodeRelationalList(values.map(program => ['program', encodeRelationalBits(program.name),
    encodeRelationalRules(program.rewrites),
    encodeRelationalList(program.facts.map(fact => ['fact', origin(fact), encodeRelationalNode(fact.judgement)])),
    encodeRelationalList(program.inferences.map(rule => ['inference', origin(rule),
      encodeRelationalList(rule.premises.map(premise => encodeRelationalNode(premise, true))), encodeRelationalNode(rule.conclusion, true)])),
    encodeRelationalList(program.uses.map(dependency => ['import', encodeRelationalBits(dependency.program),
      encodeRelationalList([...dependency.rebindings].map(([from, to]) => ['rebind', encodeRelationalBits(from), encodeRelationalBits(to)]))])),
  ]));
}
const fuel = count => { if (!Number.isSafeInteger(count) || count < 0 || count > 256) throw new Error('normalizationFuel must be an integer from 0 to 256'); let value = 'zero'; while (count-- > 0) value = ['successor', value]; return value; };
export function decodeRelationalProof(value) {
  parts(value, 'proof', 4); parts(value[1], 'origin', 3);
  return { program: decodeRelationalBits(value[1][1]), rule: decodeRelationalBits(value[1][2]),
    judgement: decodeRelationalNode(value[2]), premises: decodeRelationalList(value[3]).map(decodeRelationalProof) };
}
// A finite, injective atom-renaming codec avoids quoting every UTF-8 bit twice.
// It changes no predicates or clauses. The dictionary is owned by this call.
function interpreterImage(clauses, query) {
  const names = [], ids = new Map();
  const encodeName = name => {
    if (!ids.has(name)) { ids.set(name, names.length); names.push(name); }
    let value = ids.get(name), bits = 'end';
    do { bits = [value & 1 ? 'one' : 'zero', bits]; value = Math.floor(value / 2); } while (value);
    return bits;
  };
  const encode = value => typeof value === 'string'
    ? value.startsWith('?') && value.length > 1 ? ['variable', encodeName(value.slice(1))] : ['atom', encodeName(value)]
    : ['list', encodeRelationalList(value.map(encode))];
  const program = encodeRelationalList(clauses.map(clause => ['clause', encodeName(clause.name), encode(clause.head), encodeRelationalList(clause.body.map(encode))]));
  const goal = encode(query);
  const decode = value => {
    if (!Array.isArray(value) || value.length !== 2) throw new Error('invalid interpreted node');
    if (value[0] === 'list') return decodeRelationalList(value[1]).map(decode);
    if (value?.[0] !== 'atom') throw new Error('self interpreter returned a nonground atom');
    let cursor = value[1], index = 0;
    if (cursor === 'end' || cursor?.[0] === 'zero' && cursor[1] !== 'end') throw new Error('noncanonical interpreted atom code');
    while (Array.isArray(cursor) && cursor.length === 2 && ['zero','one'].includes(cursor[0])) { index = index * 2 + (cursor[0] === 'one' ? 1 : 0); cursor = cursor[1]; }
    if (cursor !== 'end' || !Number.isSafeInteger(index) || index >= names.length) throw new Error('self interpreter returned an unknown atom code');
    return names[index];
  };
  return { program, goal, decode, names: [...names] };
}
export class RelationalKernel {
  #resolver; #sourceHash;
  get resolver() { return this.#resolver; }
  get sourceHash() { return this.#sourceHash; }
  constructor(source) { this.#resolver = HornResolution.fromSource(source); this.#sourceHash = createHash('sha256').update(source).digest('hex'); }
  describeProgram() {
    return encodeRelationalList(this.resolver.clauses().map(clause => ['clause', encodeRelationalBits(clause.name),
      encodeRelationalNode(clause.head, true), encodeRelationalList(clause.body.map(term => encodeRelationalNode(term, true)))]));
  }
  runQuery(query, options = {}) {
    if (!options.selfInterpret) return this.resolver.query(query, options);
    const image = interpreterImage(this.resolver.clauses(), query);
    const outer = this.resolver.query([options.includeSourceProof ? 'self-query' : 'self-query-value', image.program, image.goal, '?answer'],
      { captureProof: false, maxSteps: 100_000_000, ...options });
    return { ...outer, answers: outer.answers.map(answer => {
      const [, goal, sourceProof] = parts(answer.goal.at(-1), 'answer', options.includeSourceProof ? 3 : 2);
      return { goal: image.decode(goal), proof: null, sourceProof: sourceProof === undefined ? undefined : ['relational-self-proof-v1', this.sourceHash, image.names, sourceProof] };
    }) };
  }
  selfQuery(goal, options = {}) {
    const execution = this.runQuery(goal, { ...options, selfInterpret: true });
    if (execution.answers.length !== 1) throw new Error('self interpreted query has no answer');
    return { ...execution.answers[0], steps: execution.steps, observedOperations: execution.observedOperations };
  }
  selfReplay(goal, sourceProof, options = {}) {
    const image = interpreterImage(this.resolver.clauses(), goal);
    if (!Array.isArray(sourceProof) || sourceProof.length !== 4 || sourceProof[0] !== 'relational-self-proof-v1' || sourceProof[1] !== this.sourceHash || !Array.isArray(sourceProof[2]) || sourceProof[2].length !== image.names.length || !image.names.every((name, i) => name === sourceProof[2][i])) return { accepted: false, goal: null };
    const result = this.resolver.query(['self-replay', image.program, image.goal, sourceProof[3], '?result'],
      { captureProof: false, maxSteps: 100_000_000, ...options });
    return { accepted: result.answers.length === 1, execution: result,
      goal: result.answers.length === 1 ? image.decode(parts(result.answers[0].goal.at(-1), 'verified', 2)[1]) : null };
  }
  call(predicate, inputs, options = {}) {
    const execution = this.runQuery([predicate, ...inputs, '?result'], options);
    if (execution.answers.length !== 1) throw new Error(`linked relation ${predicate} has no answer within the declared search`);
    const answer = execution.answers[0];
    return { value: answer.goal.at(-1), proof: answer.proof, sourceProof: answer.sourceProof,
      query: [predicate, ...inputs, '?result'], steps: execution.steps, observedOperations: execution.observedOperations };
  }
  resolve(programs, name, kind = 'rewrites', options = {}) {
    const result = this.call('resolve', [encodeRelationalPrograms(programs), encodeRelationalBits(name), kind, 'end'], options);
    if (!Array.isArray(result.value) || result.value[0] !== 'resolved') throw new Error(`linked import resolution failed: ${result.value[1]}`);
    parts(result.value, 'resolved', 2);
    return { ...result, encodedRules: result.value[1] };
  }
  createProofState(programs, name, inputFacts = [], options = {}) {
    const rules = this.resolve(programs, name, 'rewrites', options).value[1];
    const facts = this.resolve(programs, name, 'facts', options).value[1];
    const inferences = this.resolve(programs, name, 'inferences', options).value[1];
    const initial = this.call('add-facts', [facts, rules, fuel(options.normalizationFuel ?? 32), 'end'], options).value;
    const input = encodeRelationalList(inputFacts.map((judgement, i) => ['fact',
      ['origin', encodeRelationalBits('<input>'), encodeRelationalBits(`input-${i + 1}`)], encodeRelationalNode(judgement)]));
    const known = this.call('add-facts', [input, rules, fuel(options.normalizationFuel ?? 32), initial], options).value;
    return { rules, inferences, known, size: decodeRelationalList(known).length };
  }
  inferOnce(state, options = {}) {
    const query = ['infer-step', state.inferences, state.known, state.rules, fuel(options.normalizationFuel ?? 32), '?result'];
    const execution = this.runQuery(query, options);
    if (execution.answers.length === 0) {
      if (!execution.exhausted) throw new Error('inference search did not establish exhaustion');
      return { derivation: null, state, execution };
    }
    const value = execution.answers[0].goal.at(-1);
    if (Array.isArray(value) && value[0] === 'blocked') { parts(value, 'blocked', 3); throw new Error(`linked inference blocked: ${value[1]}`); }
    const [, derived, inferences] = parts(value, 'transition', 3);
    const [, judgement, proof] = parts(derived, 'derived', 3);
    const known = this.call('append', [state.known, cons(['known', judgement, proof], 'end')], options).value;
    return { derivation: { judgement: decodeRelationalNode(judgement), proof: decodeRelationalProof(proof) },
      state: { ...state, inferences, known, size: state.size + 1 }, execution };
  }
  findProof(state, judgement, options = {}) {
    const result = this.call('known-proof', [encodeRelationalNode(judgement), state.known], options);
    return { ...result, proof: result.value === 'none' ? null : decodeRelationalProof(parts(result.value, 'some', 2)[1]) };
  }
  rewriteOnce(term, rules, options = {}) {
    const execution = this.call('rewrite-once', [rules?.encodedRules ?? encodeRelationalRules(rules), encodeRelationalNode(term)], options);
    if (execution.value === 'none') return { ...execution, step: null };
    const [, step] = parts(execution.value, 'some', 2);
    const [, output, origin] = parts(step, 'step', 3);
    const [, program, name] = parts(origin, 'origin', 3);
    return { ...execution, step: { term: decodeRelationalNode(output), rule: { program: decodeRelationalBits(program), name: decodeRelationalBits(name) } } };
  }
}
