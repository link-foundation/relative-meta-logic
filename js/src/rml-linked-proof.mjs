/** Data-only adapter for the caller-selected executable linked proof verifier. */
import { cloneTerm } from './rml-linked-program.mjs';

export const LINKED_PROOF_PROGRAM = 'linked-proof-verifier';
export const MAX_LINKED_PROOF_DEPTH = 256;
export const DEFAULT_LINKED_PROOF_INPUT_LIMITS = Object.freeze({
  maxDepth: 128, maxNodes: 10_000, maxTextBytes: 1_048_576,
});
export const DEFAULT_LINKED_PROOF_RECEIPT_LIMITS = Object.freeze({
  maxDepth: 256, maxNodes: 1_000_000, maxTextBytes: 16_777_216,
});

function budget(options, defaults = DEFAULT_LINKED_PROOF_INPUT_LIMITS) {
  const limits = { ...defaults, ...options };
  for (const name of ['maxDepth', 'maxNodes', 'maxTextBytes']) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  if (limits.maxDepth > MAX_LINKED_PROOF_DEPTH) {
    throw new TypeError(`maxDepth must not exceed ${MAX_LINKED_PROOF_DEPTH}`);
  }
  return { ...limits, nodes: 0, textBytes: 0, ancestors: new Set() };
}

function visit(state, depth, text) {
  if (depth > state.maxDepth) throw new RangeError(`linked proof depth limit ${state.maxDepth} exceeded`);
  if (++state.nodes > state.maxNodes) throw new RangeError(`linked proof node limit ${state.maxNodes} exceeded`);
  if (text !== undefined) {
    if (typeof text !== 'string' || text.length === 0) throw new TypeError('proof data leaves must be nonempty strings');
    // Count UTF-8 without allocating a potentially enormous encoded string.
    for (const character of text) {
      const code = character.codePointAt(0);
      state.textBytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (state.textBytes > state.maxTextBytes) {
        throw new RangeError(`linked proof text byte limit ${state.maxTextBytes} exceeded`);
      }
    }
  }
}

function enterArray(value, state) {
  if (!Array.isArray(value)) throw new TypeError('proof data must contain only nonempty strings and arrays');
  if (state.ancestors.has(value)) throw new TypeError('proof data must be a finite, acyclic term');
  state.ancestors.add(value);
}

function encode(value, state, depth) {
  if (typeof value === 'string') {
    visit(state, depth, value);
    return ['atom', value];
  }
  visit(state, depth);
  enterArray(value, state);
  let tail = ['list-end'];
  for (let index = value.length - 1; index >= 0; index -= 1) {
    tail = ['pair', encode(value[index], state, depth + index + 1), tail];
  }
  state.ancestors.delete(value);
  return tail;
}

/** Injective generic quotation, bounded by unfolded nodes, depth and UTF-8 bytes. */
export function encodeLinkedProofData(value, limits = {}) {
  return encode(value, budget(limits), 1);
}

function decode(value, state, depth) {
  enterArray(value, state);
  if (value.length === 2 && value[0] === 'atom' && typeof value[1] === 'string') {
    visit(state, depth, value[1]);
    state.ancestors.delete(value);
    return value[1];
  }
  visit(state, depth);
  const result = [];
  const seen = new Set();
  let tail = value;
  while (Array.isArray(tail) && tail.length === 3 && tail[0] === 'pair') {
    if (seen.has(tail)) throw new TypeError('quoted proof data must be finite');
    seen.add(tail);
    result.push(decode(tail[1], state, depth + result.length + 1));
    tail = tail[2];
  }
  if (!Array.isArray(tail) || tail.length !== 1 || tail[0] !== 'list-end') {
    throw new TypeError('invalid quoted proof data');
  }
  state.ancestors.delete(value);
  return result;
}

/** Decode only bounded canonical quoted data, rejecting executable payloads. */
export function decodeLinkedProofData(value, limits = {}) {
  return decode(value, budget(limits), 1);
}

// Validate untrusted replay metadata before comparison, without serializing it
// or expanding shared arrays into a copied tree. Every unfolded visit counts.
function validate(value, state, depth) {
  if (typeof value === 'string') return visit(state, depth, value);
  visit(state, depth);
  enterArray(value, state);
  for (let index = 0; index < value.length; index += 1) validate(value[index], state, depth + 1);
  state.ancestors.delete(value);
}

function sameData(left, right) {
  const stack = [[left, right, 0]];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const [a, b, index] = frame;
    if (typeof a === 'string' || typeof b === 'string') {
      if (a !== b) return false;
      stack.pop();
    } else if (a.length !== b.length) {
      return false;
    } else if (index === a.length) {
      stack.pop();
    } else {
      frame[2] += 1;
      stack.push([a[index], b[index], 0]);
    }
  }
  return true;
}

/** Encode the generic reducer's entire trace as ordinary links for inspection. */
export function linkedProofTrace(trace) {
  return ['linked-execution', ...trace.map(step => [
    'step', step.program, step.rule, cloneTerm(step.before), cloneTerm(step.after),
  ])];
}

/**
 * Verify under an independently supplied context and exact goal. All semantic
 * decisions are linked rules. Bounds are external controls, not proof verdicts.
 * Load universal.lino and proof-verifier.lino into the registry first.
 */
export function verifyLinkedProof(registry, context, goal, candidate, {
  program = LINKED_PROOF_PROGRAM,
  maxSteps = 100_000,
  inputLimits = {},
} = {}) {
  const state = budget(inputLimits);
  const request = ['verify-linked-proof',
    encode(context, state, 1), encode(goal, state, 1), encode(candidate, state, 1)];
  const reduced = registry.reduce(program, request, { maxSteps });
  return {
    schema: 'rml-linked-proof-replay/v1',
    program,
    accepted: Array.isArray(reduced.term) && reduced.term[0] === 'proof-accepted',
    request,
    result: cloneTerm(reduced.term),
    trace: linkedProofTrace(reduced.trace),
    steps: reduced.steps,
  };
}

/** Independently re-execute a bounded receipt without trusting cached evidence. */
export function replayLinkedProof(registry, context, goal, receipt, {
  program = LINKED_PROOF_PROGRAM,
  maxSteps = 100_000,
  inputLimits = {},
  receiptLimits = {},
} = {}) {
  if (receipt?.schema !== 'rml-linked-proof-replay/v1' || receipt.program !== program ||
      !Array.isArray(receipt.request) || receipt.request.length !== 4 ||
      receipt.request[0] !== 'verify-linked-proof') {
    throw new TypeError('unsupported linked proof replay receipt');
  }
  const state = budget(receiptLimits, DEFAULT_LINKED_PROOF_RECEIPT_LIMITS);
  for (const value of [receipt.request, receipt.result, receipt.trace]) validate(value, state, 1);
  const candidate = decodeLinkedProofData(receipt.request[3], inputLimits);
  // Receipt content cannot select its own assumptions, goal, or verifier.
  const replay = verifyLinkedProof(registry, context, goal, candidate, { program, maxSteps, inputLimits });
  return {
    accepted: replay.accepted,
    matches: replay.accepted === receipt.accepted && replay.steps === receipt.steps &&
      sameData(replay.request, receipt.request) && sameData(replay.result, receipt.result) &&
      sameData(replay.trace, receipt.trace),
    result: replay.result,
    trace: replay.trace,
    steps: replay.steps,
  };
}
