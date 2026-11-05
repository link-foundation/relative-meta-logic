/** The explicit portable target entry points. All request/verdict/storage
 * decisions come from the generated model; execution uses the real registry. */
import { decodeFrame, encodeFrame, executeProgram } from './rml-linked-target-abi.mjs';
import { linkedProofTrace, replayLinkedProof } from './rml-linked-proof.mjs';
import { parseLinoDocument } from './rml-lino-frontend.mjs';

export function verifyTargetFrame(registry, frame, maxSteps = 100000) {
  const args = decodeFrame(frame);
  if (!Array.isArray(args) || args.length !== 3) throw new TypeError('target proof expects context, goal, candidate');
  const request = executeProgram('request', args), program = executeProgram('program', []);
  const reduced = registry.reduce(program, request, { maxSteps });
  return encodeFrame(executeProgram('receipt', [program, request, reduced.term, linkedProofTrace(reduced.trace), String(reduced.steps)]));
}

export function receiptFromTargetFrame(frame) {
  const v = decodeFrame(frame);
  if (!Array.isArray(v) || v.length !== 7 || !['true', 'false'].includes(v[2]) || typeof v[6] !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v[6]) || !Number.isSafeInteger(Number(v[6])) || Number(v[6]) > 0xffffffff) throw new TypeError('invalid target receipt');
  return { schema: v[0], program: v[1], accepted: v[2] === 'true', request: v[3], result: v[4], trace: v[5], steps: Number(v[6]) };
}

export function replayTargetFrame(registry, contextFrame, goalFrame, receiptFrame, maxSteps = 100000) {
  const result = replayLinkedProof(registry, decodeFrame(contextFrame), decodeFrame(goalFrame), receiptFromTargetFrame(receiptFrame), { program: executeProgram('program', []), maxSteps });
  return encodeFrame([String(result.accepted), String(result.matches), result.result, result.trace, String(result.steps)]);
}

export function parseTargetFrame(frame) {
  const source = decodeFrame(frame); if (typeof source !== 'string') throw new TypeError('target parser expects text');
  const forms = parseLinoDocument(source);
  return encodeFrame(forms.map(form => [form.text, String(form.line), String(form.col), String(form.length)]));
}
