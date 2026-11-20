/** Typed, source-free control-flow programs. The interpreter is an explicit host
 * semantic boundary, not proof authority or a claim of full-language support. */
import { LinkNetwork } from '#meta-language';
import { attachRmlStructure, rmlStructuredDocument } from './rml-meta-structure.mjs';

export const CONTROL_FLOW_SCHEMA = 'rml-control-flow/v1';
export const CONTROL_FLOW_CONTRACT = Object.freeze({
  schema: CONTROL_FLOW_SCHEMA,
  values: 'signed safe integers, booleans and unit; every arithmetic result is checked',
  observations: ['return value', 'ordered scalar output events', 'numeric-domain failure', 'bounded exhaustion'],
  control: 'typed mutable registers, branches, loops and mutually recursive calls',
  ownership: 'all supported values are Copy; references, aliasing and destructors require separate obligations',
  proof: 'execution and type checking do not discharge termination, dependent types, universes or theorem obligations',
  trust: ['registered RML syntax codec', 'control-flow validator and interpreter', 'host integer arithmetic and resource accounting'],
});
const TYPES = new Set(['int', 'bool', 'unit']);
const MAX = 9007199254740991n;
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
const ARITHMETIC = new Set(['add', 'sub', 'mul', 'div', 'mod']);
const COMPARISONS = new Set(['lt', 'le', 'eq']);
const LOGIC = new Set(['and', 'or']);
export class ControlFlowError extends Error {
  constructor(code, message, location = '') { super(message); this.code = code; this.location = location; }
}
const fail = (code, message, location = '') => { throw new ControlFlowError(code, message, location); };
const check = (test, code, message, location) => { if (!test) fail(code, message, location); };
const name = value => typeof value === 'string' && value.length <= 256 && NAME.test(value);
const keys = (value, expected, at) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === expected.split(' ').sort().join(), 'SCHEMA', 'Unexpected or missing fields', at);
const array = (value, at) => { check(Array.isArray(value), 'SCHEMA', 'Expected an array', at); return value; };
const literalType = value => value === null ? 'unit' : typeof value === 'boolean' ? 'bool' : typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0) ? 'int' : null;
const bindingKey = fn => `${fn.module}.${fn.name}`;
const successors = block => block.terminator[0] === 'jump' ? [block.terminator[1]] : block.terminator[0] === 'branch' ? block.terminator.slice(2) : [];
const reads = instruction => instruction[0] === 'const' ? [] : instruction[0] === 'emit' ? instruction.slice(1) : instruction[0] === 'call' ? instruction.slice(3) : instruction.slice(2);
const destination = instruction => instruction[0] === 'emit' ? null : instruction[1];
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

/** Resolve project identities, type instructions, compute definite assignment,
 * and close effect summaries over the complete call graph, including cycles. */
export function validateControlFlow(input) {
  keys(input, 'schema modules functions entry', 'program');
  check(input.schema === CONTROL_FLOW_SCHEMA, 'SCHEMA', 'Unsupported control-flow schema');
  const modules = new Map(), functions = new Map();
  check(array(input.modules).length > 0 && input.modules.length <= 1000, 'LIMIT', 'Module limit exceeded');
  check(array(input.functions).length > 0 && input.functions.length <= 1000, 'LIMIT', 'Function limit exceeded');
  for (const module of input.modules) {
    keys(module, 'id imports exports', 'module');
    check(name(module.id) && !modules.has(module.id), 'BINDING', 'Invalid or duplicate module identity', module.id);
    const aliases = new Set();
    for (const item of array(module.imports, module.id)) {
      check(Array.isArray(item) && item.length === 2 && item.every(name) && !aliases.has(item[0]), 'BINDING', 'Invalid or duplicate import binding', module.id);
      aliases.add(item[0]);
    }
    check(array(module.exports).every(name) && new Set(module.exports).size === module.exports.length, 'BINDING', 'Invalid or duplicate export', module.id);
    modules.set(module.id, module);
  }
  for (const fn of input.functions) {
    keys(fn, 'module name parameters result effects locals entry blocks', 'function');
    const id = bindingKey(fn);
    check(name(fn.name) && modules.has(fn.module) && !functions.has(id), 'BINDING', 'Invalid or duplicate function identity', id);
    check(TYPES.has(fn.result), 'TYPE', 'Unsupported result type', id);
    check(array(fn.effects).every(x => x === 'output') && new Set(fn.effects).size === fn.effects.length, 'EFFECT', 'Unsupported or duplicate effect declaration', id);
    for (const bindings of [fn.parameters, fn.locals]) for (const binding of array(bindings, id)) check(Array.isArray(binding) && binding.length === 2 && name(binding[0]) && TYPES.has(binding[1]), 'BINDING', 'Invalid register declaration', id);
    functions.set(id, fn);
  }
  check(functions.has(input.entry), 'BINDING', 'Unresolved project entry', input.entry);
  for (const module of modules.values()) {
    for (const exported of module.exports) check(functions.has(`${module.id}.${exported}`), 'BINDING', 'Unresolved export', module.id);
    for (const [alias, target] of module.imports) {
      const fn = functions.get(target);
      check(fn && modules.get(fn.module).exports.includes(fn.name) && !functions.has(`${module.id}.${alias}`), 'BINDING', 'Unresolved, private or conflicting import', `${module.id}.${alias}`);
    }
  }
  let total = 0, analysisWork = 0;
  const actualEffects = new Map(), calls = new Map();
  for (const [id, fn] of functions) {
    const types = new Map(), parameterIds = new Set();
    for (const [isParameter, bindings] of [[true, fn.parameters], [false, fn.locals]]) for (const binding of array(bindings, id)) {
      check(Array.isArray(binding) && binding.length === 2 && name(binding[0]) && TYPES.has(binding[1]) && !types.has(binding[0]), 'BINDING', 'Invalid or duplicate register identity', id);
      types.set(binding[0], binding[1]); if (isParameter) parameterIds.add(binding[0]);
    }
    check(types.size <= 10000, 'LIMIT', 'Register limit exceeded', id);
    const blocks = new Map();
    for (const block of array(fn.blocks, id)) {
      keys(block, 'id instructions terminator', id);
      check(name(block.id) && !blocks.has(block.id), 'BINDING', 'Invalid or duplicate block identity', id);
      blocks.set(block.id, block);
    }
    check(blocks.size && blocks.size <= 10000 && blocks.has(fn.entry), 'BINDING', 'Unresolved function entry', id);
    const requireType = (register, type, at) => check(types.has(register) && (!type || types.get(register) === type), 'TYPE', `Unresolved or wrongly typed register ${register}`, at);
    const effect = new Set(), edges = new Set();
    for (const block of blocks.values()) {
      const at = `${id}/${block.id}`;
      for (const instruction of array(block.instructions, at)) {
        check(++total <= 100000 && Array.isArray(instruction), 'LIMIT', 'Instruction limit exceeded', at);
        const [op, dest, ...args] = instruction;
        if (op === 'emit') { check(instruction.length === 2, 'SCHEMA', 'Invalid output instruction', at); requireType(dest, null, at); effect.add('output'); continue; }
        requireType(dest, null, at);
        if (op === 'const') check(args.length === 1 && literalType(args[0]) === types.get(dest), 'TYPE', 'Invalid constant type', at);
        else if (op === 'copy') { check(args.length === 1, 'SCHEMA', 'Invalid copy instruction', at); requireType(args[0], types.get(dest), at); }
        else if (ARITHMETIC.has(op) || COMPARISONS.has(op) || LOGIC.has(op)) {
          check(args.length === 2, 'SCHEMA', 'Invalid binary instruction', at);
          const operand = LOGIC.has(op) ? 'bool' : op === 'eq' ? types.get(args[0]) : 'int';
          args.forEach(arg => requireType(arg, operand, at));
          requireType(dest, ARITHMETIC.has(op) ? 'int' : 'bool', at);
        } else if (op === 'not') { check(args.length === 1, 'SCHEMA', 'Invalid negation', at); requireType(dest, 'bool', at); requireType(args[0], 'bool', at); }
        else if (op === 'call') {
          const callee = functions.get(args[0]);
          check(callee && args.length === callee.parameters.length + 1, 'BINDING', 'Unresolved call or wrong arity', at);
          check(callee.module === fn.module || modules.get(fn.module).imports.some(item => item[1] === args[0]), 'BINDING', 'Call crosses a module without an explicit import', at);
          requireType(dest, callee.result, at); args.slice(1).forEach((arg, i) => requireType(arg, callee.parameters[i][1], at)); edges.add(args[0]);
        } else fail('UNSUPPORTED', `Unsupported instruction ${op}`, at);
      }
      const term = array(block.terminator, at), [op, arg] = term;
      if (op === 'return') { check(term.length === 2, 'SCHEMA', 'Invalid return', at); requireType(arg, fn.result, at); }
      else if (op === 'jump') check(term.length === 2, 'SCHEMA', 'Invalid jump', at);
      else if (op === 'branch') { check(term.length === 4, 'SCHEMA', 'Invalid branch', at); requireType(arg, 'bool', at); }
      else fail('UNSUPPORTED', `Unsupported terminator ${op}`, at);
      for (const target of successors(block)) check(blocks.has(target), 'BINDING', 'Unresolved branch target', at);
    }
    // Reachability is structural, not a claim that both paths are executable.
    const reachable = new Set(), queue = [fn.entry];
    while (queue.length) { const next = queue.pop(); if (reachable.has(next)) continue; reachable.add(next); queue.push(...successors(blocks.get(next))); }
    check(reachable.size === blocks.size, 'UNREACHABLE', 'Unreachable blocks must be removed explicitly', id);
    check(blocks.size * types.size <= 1000000, 'LIMIT', 'Definite-assignment state budget exceeded', id);
    const predecessors = new Map([...blocks.keys()].map(key => [key, []]));
    for (const block of blocks.values()) for (const target of successors(block)) predecessors.get(target).push(block.id);
    const incoming = new Map([...blocks.keys()].map(key => [key, new Set(key === fn.entry ? parameterIds : types.keys())]));
    const outgoing = key => new Set([...incoming.get(key), ...blocks.get(key).instructions.map(destination).filter(Boolean)]);
    let changed;
    do {
      changed = false;
      for (const key of [...blocks.keys()].sort()) {
        check((analysisWork += 1 + types.size * (1 + predecessors.get(key).length)) <= 10000000, 'LIMIT', 'Definite-assignment work budget exceeded', id);
        let next = key === fn.entry ? new Set(parameterIds) : new Set(types.keys());
        for (const pred of predecessors.get(key)) { const out = outgoing(pred); next = new Set([...next].filter(reg => out.has(reg))); }
        if (!sameSet(next, incoming.get(key))) { incoming.set(key, next); changed = true; }
      }
    } while (changed);
    for (const block of blocks.values()) {
      const defined = new Set(incoming.get(block.id)), at = `${id}/${block.id}`;
      for (const instruction of block.instructions) {
        for (const ref of reads(instruction)) check(defined.has(ref), 'UNINITIALIZED', `Register ${ref} is not definitely initialized`, at);
        if (destination(instruction)) defined.add(destination(instruction));
      }
      if (['return', 'branch'].includes(block.terminator[0])) check(defined.has(block.terminator[1]), 'UNINITIALIZED', 'Terminator reads an uninitialized register', at);
    }
    actualEffects.set(id, effect); calls.set(id, edges);
  }
  let changed;
  do { changed = false; for (const [id, edges] of calls) for (const target of edges) for (const effect of actualEffects.get(target)) if (!actualEffects.get(id).has(effect)) { actualEffects.get(id).add(effect); changed = true; } } while (changed);
  for (const [id, effects] of actualEffects) check([...effects].every(effect => functions.get(id).effects.includes(effect)), 'EFFECT', 'Undeclared transitive output effect', id);
  return { functions, effects: Object.fromEntries([...actualEffects].map(([id, effects]) => [id, [...effects].sort()])) };
}

/** One step is one instruction or terminator. A call consumes a step and pushes
 * an explicit frame, so untrusted recursion cannot exhaust the host call stack. */
export function executeControlFlow(program, args = [], { fuel = 100000, entry = program.entry } = {}) {
  const { functions } = validateControlFlow(program);
  check(Number.isSafeInteger(fuel) && fuel >= 0 && fuel <= 1000000, 'LIMIT', 'Fuel must be between zero and one million');
  const fn = functions.get(entry);
  check(fn && Array.isArray(args) && args.length === fn.parameters.length && args.every((arg, i) => literalType(arg) === fn.parameters[i][1]), 'TYPE', 'Entry argument types or arity do not match', entry);
  const frame = (fn, values, dest) => ({ fn, env: new Map(fn.parameters.map(([id], i) => [id, values[i]])), block: fn.blocks.find(b => b.id === fn.entry), index: 0, dest });
  const stack = [frame(fn, args, null)], effects = [];
  let steps = 0;
  const result = (status, value = null, diagnostic = null) => ({ status, value, effects, steps, diagnostic });
  while (stack.length) {
    if (steps === fuel) return result('fuel-exhausted');
    steps += 1;
    const current = stack.at(-1), { env, block } = current;
    if (current.index < block.instructions.length) {
      const instruction = block.instructions[current.index++], [op, dest, ...operands] = instruction;
      if (op === 'const') { env.set(dest, operands[0]); continue; }
      if (op === 'emit') { effects.push(env.get(dest)); continue; }
      if (op === 'call') { stack.push(frame(functions.get(operands[0]), operands.slice(1).map(id => env.get(id)), dest)); continue; }
      const [left, right] = operands.map(id => env.get(id));
      let value;
      if (op === 'copy') value = left;
      else if (op === 'not') value = !left;
      else if (op === 'eq') value = left === right;
      else if (op === 'lt') value = left < right;
      else if (op === 'le') value = left <= right;
      else if (op === 'and') value = left && right;
      else if (op === 'or') value = left || right;
      else {
        const a = BigInt(left), b = BigInt(right);
        if ((op === 'div' || op === 'mod') && b === 0n) return result('domain-error', null, 'DIVISION_BY_ZERO');
        const exact = op === 'add' ? a + b : op === 'sub' ? a - b : op === 'mul' ? a * b : op === 'div' ? a / b : a % b;
        if (exact < -MAX || exact > MAX) return result('domain-error', null, 'INTEGER_OVERFLOW');
        value = Number(exact);
      }
      env.set(dest, value);
    } else {
      const [op, arg, yes, no] = block.terminator;
      if (op === 'return') {
        const value = env.get(arg); stack.pop();
        if (!stack.length) return result('returned', value);
        stack.at(-1).env.set(current.dest, value);
      } else { const target = op === 'jump' ? arg : env.get(arg) ? yes : no; current.block = current.fn.blocks.find(b => b.id === target); current.index = 0; }
    }
  }
  throw new Error('Unreachable empty machine');
}

const atom = value => value === null ? 'unit' : String(value);
const form = parts => `(${parts.join(' ')})`;
export function controlFlowToRml(program) {
  validateControlFlow(program);
  return form(['control-flow-v1', form(['entry', program.entry]),
    form(['modules', ...program.modules.map(m => form(['module', m.id, form(['imports', ...m.imports.map(form)]), form(['exports', ...m.exports])]))]),
    ...program.functions.map(fn => form(['function', fn.module, fn.name, form(['parameters', ...fn.parameters.map(form)]), form(['result', fn.result]), form(['effects', ...fn.effects]), form(['locals', ...fn.locals.map(form)]), form(['entry', fn.entry]),
      form(['blocks', ...fn.blocks.map(block => form(['block', block.id, form(['instructions', ...block.instructions.map(i => form(i.map(atom)))]), form(block.terminator)]))])]))]);
}
export function controlFlowToNetwork(program) { const network = new LinkNetwork(); attachRmlStructure(network, controlFlowToRml(program)); rmlStructuredDocument(network); return network; }
export function controlFlowFromNetwork(network) {
  const document = rmlStructuredDocument(network);
  const decode = link => { check(!link._isFromPathCombination && (link.id === null || !link.values.length), 'SCHEMA', 'Unexpected named/compound link'); return link.id === null ? link.values.map(decode) : link.id; };
  check(document.length === 1, 'SCHEMA', 'Expected one control-flow root');
  const root = decode(document[0].link);
  const fields = (node, tag, length) => { check(Array.isArray(node) && node[0] === tag && (length === undefined || node.length === length), 'SCHEMA', `Expected ${tag}`); return node.slice(1); };
  fields(root, 'control-flow-v1');
  const entry = fields(root[1], 'entry', 2)[0];
  const modules = fields(root[2], 'modules').map(m => { const [id, imports, exports] = fields(m, 'module', 4); return { id, imports: fields(imports, 'imports'), exports: fields(exports, 'exports') }; });
  const functions = root.slice(3).map(f => {
    const [module, name, parameters, result, effects, locals, entry, blocks] = fields(f, 'function', 9);
    return { module, name, parameters: fields(parameters, 'parameters'), result: fields(result, 'result', 2)[0], effects: fields(effects, 'effects'), locals: fields(locals, 'locals'), entry: fields(entry, 'entry', 2)[0],
      blocks: fields(blocks, 'blocks').map(b => { const [id, instructions, terminator] = fields(b, 'block', 4); return { id, instructions: fields(instructions, 'instructions').map(instruction => {
        check(Array.isArray(instruction), 'SCHEMA', 'Expected an instruction');
        if (instruction[0] !== 'const') return instruction;
        check(instruction.length === 3, 'SCHEMA', 'Malformed constant');
        const text = instruction[2];
        const value = text === 'unit' ? null : text === 'true' ? true : text === 'false' ? false : /^(?:0|-?[1-9][0-9]*)$/u.test(text) ? Number(text) : NaN;
        return ['const', instruction[1], value];
      }), terminator }; }) };
  });
  const program = { schema: CONTROL_FLOW_SCHEMA, modules, functions, entry };
  validateControlFlow(program); return program;
}
