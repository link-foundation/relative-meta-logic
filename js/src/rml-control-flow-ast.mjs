/** Shared bounds for public owned-AST entry points; no parser or source codec. */
import { ControlFlowError } from './rml-control-flow.mjs';
export function validateControlFlowAst(root) {
  const ancestors = new Set(), stack = [[root, 0, false]];
  let nodes = 0, text = 0;
  while (stack.length) {
    const [value, depth, leave] = stack.pop();
    if (leave) { ancestors.delete(value); continue; }
    if (++nodes > 500000 || depth > 256) throw new ControlFlowError('AST_LIMIT', 'Owned syntax size/depth budget exceeded');
    if (typeof value === 'string') { text += value.length; if (text > 16000000) throw new ControlFlowError('AST_LIMIT', 'Owned syntax text budget exceeded'); }
    else if (value !== null && typeof value === 'object') {
      if (ancestors.has(value)) throw new ControlFlowError('AST_SCHEMA', 'Cyclic owned syntax');
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ControlFlowError('AST_SCHEMA', 'Owned syntax requires plain records');
      ancestors.add(value); stack.push([value, depth, true]);
      for (const child of Object.values(value)) stack.push([child, depth + 1, false]);
    } else if (value !== null && typeof value !== 'boolean' && typeof value !== 'number') throw new ControlFlowError('AST_SCHEMA', 'Owned syntax must be finite data');
  }
}
