/** Executable, portable linear-memory target schema. The supplied Link graph is
 * the only authority for layout, resource limits and adapter programs. */
import { readFileSync } from 'node:fs';
import { decodeLinkedValues } from './linked-runtime-graph.mjs';

const own = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
const uint = (value, max = 0xffffffff) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const fail = message => { throw new TypeError(message); };

export function validateTargetModel(model) {
  if (!own(model, ['format', 'target', 'layout', 'domain', 'programs']) || model.format !== 'rml-linear-abi/v1') fail('invalid target model');
  const { target: t, layout: l, domain: d, programs } = model;
  if (!own(t, ['wordBytes', 'addressBits', 'endian', 'alignment', 'maxBytes']) || t.wordBytes !== 4 || t.addressBits !== 32 || !['little', 'big'].includes(t.endian) || ![1, 2, 4, 8, 16].includes(t.alignment) || !uint(t.maxBytes, 0x7fffffff) || t.maxBytes < 24) fail('unsupported target storage');
  const permutation = (value, keys) => Array.isArray(value) && value.length === keys.length && [...value].sort().join(',') === [...keys].sort().join(',');
  if (!own(l, ['frameWords', 'magic', 'cellWords', 'codes']) || !permutation(l.frameWords, ['magic', 'root', 'end']) || !permutation(l.cellWords, ['tag', 'payload', 'length']) || !uint(l.magic) || !own(l.codes, ['text', 'list']) || !uint(l.codes.text) || !uint(l.codes.list) || l.codes.text === l.codes.list) fail('invalid target layout');
  if (!own(d, ['maxDepth', 'maxNodes', 'maxTextBytes', 'nonemptyText', 'unicode']) || !uint(d.maxDepth, 256) || !d.maxDepth || !uint(d.maxNodes, 1000000) || !d.maxNodes || !uint(d.maxTextBytes, t.maxBytes) || !d.maxTextBytes || typeof d.nonemptyText !== 'boolean' || d.unicode !== 'scalar-values') fail('invalid target domain');
  if (!programs || Array.isArray(programs) || !Object.keys(programs).length || Object.keys(programs).length > 64) fail('invalid target programs');
  for (const [name, program] of Object.entries(programs)) if (!/^[a-z][a-z0-9_]*$/.test(name) || !own(program, ['params', 'body']) || !uint(program.params, 16)) fail('invalid target program declaration');
  let nodes = 0;
  function expression(e, params, depth = 0) {
    if (++nodes > 10000 || depth > 128 || !Array.isArray(e)) fail('invalid target expression budget');
    const arities = { arg: 1, text: 1, if: 3, 'is-text': 1, empty: 1, head: 1, tail: 1, equal: 2, fail: 1 };
    if (e[0] in arities && e.length !== arities[e[0]] + 1) fail('invalid target expression arity');
    if (e[0] === 'arg') { if (!uint(e[1], params - 1)) fail('invalid target argument'); return; }
    if (e[0] === 'text' || e[0] === 'fail') { if (typeof e[1] !== 'string') fail('invalid target literal'); scalarText(e[1]); return; }
    if (e[0] === 'call') {
      if (!Object.hasOwn(programs, e[1]) || e.length !== programs[e[1]].params + 2) fail('invalid target call');
      for (const child of e.slice(2)) expression(child, params, depth + 1);
    } else if (['list', 'if', 'is-text', 'empty', 'head', 'tail', 'equal', 'and'].includes(e[0])) {
      for (const child of e.slice(1)) expression(child, params, depth + 1);
    } else fail('unsupported target operation');
  }
  for (const program of Object.values(programs)) expression(program.body, program.params);
  return model;
}

export function readTargetModel(root = new URL('../', import.meta.url)) {
  return validateTargetModel(decodeLinkedValues(JSON.parse(readFileSync(new URL('lib/target-abi/model.links.json', root), 'utf8'))));
}

/** Independent expression evaluator. Generated adapters compile these expressions. */
export function executeTargetProgram(model, name, args, fuel = 1000000) {
  validateTargetModel(model);
  if (!uint(fuel, 1000000)) fail('invalid target fuel');
  let callDepth = 0;
  const same = (a, b) => typeof a === 'string' || typeof b === 'string' || typeof a === 'boolean' || typeof b === 'boolean' ? a === b : a.length === b.length && a.every((x, i) => same(x, b[i]));
  function call(name, args) {
    const p = Object.hasOwn(model.programs, name) && model.programs[name]; if (!p || p.params !== args.length) fail('invalid target invocation');
    if (--fuel < 0 || ++callDepth > model.domain.maxDepth) fail('target program fuel/depth exhausted');
    try { return evaluate(p.body, args); } finally { callDepth -= 1; }
  }
  function evaluate(e, args) {
    const v = index => evaluate(e[index], args), list = value => Array.isArray(value) ? value : fail('target expected list');
    switch (e[0]) {
      case 'arg': return args[e[1]];
      case 'text': return e[1];
      case 'list': return e.slice(1).map(child => evaluate(child, args));
      case 'if': { const condition = v(1); if (typeof condition !== 'boolean') fail('target expected boolean'); return condition ? v(2) : v(3); }
      case 'is-text': return typeof v(1) === 'string';
      case 'empty': return list(v(1)).length === 0;
      case 'head': { const value = list(v(1)); return value.length ? value[0] : fail('target empty head'); }
      case 'tail': { const value = list(v(1)); return value.length ? value.slice(1) : fail('target empty tail'); }
      case 'call': return call(e[1], e.slice(2).map(child => evaluate(child, args)));
      case 'equal': return same(v(1), v(2));
      case 'and': return e.slice(1).every(child => { const value = evaluate(child, args); if (typeof value !== 'boolean') fail('target expected boolean'); return value; });
      case 'fail': return fail(e[1]);
      default: return fail('unsupported target operation');
    }
  }
  return call(name, args);
}

function scalarText(text) {
  for (let i = 0; i < text.length; i += 1) {
    const x = text.charCodeAt(i);
    if (x >= 0xd800 && x <= 0xdbff) { const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail('target requires Unicode scalar text'); }
    else if (x >= 0xdc00 && x <= 0xdfff) fail('target requires Unicode scalar text');
  }
}

/** Model interpreter: plan sparse cells/payloads, then materialize a byte arena. */
export function interpretTargetEncode(model, value) {
  validateTargetModel(model);
  const { target: t, layout: l, domain: d } = model;
  const chunks = [], words = [], ancestors = new Set(); let cursor = 12, nodes = 0, textBytes = 0;
  const allocate = bytes => { const address = Math.ceil(cursor / t.alignment) * t.alignment; cursor = address + bytes; if (!uint(cursor, t.maxBytes)) fail('target memory limit'); return address; };
  const word = (address, value) => words.push([address, value]);
  function visit(value, depth) {
    if (depth > d.maxDepth || ++nodes > d.maxNodes) fail('target term budget');
    const address = allocate(12), put = (field, data) => word(address + 4 * l.cellWords.indexOf(field), data);
    if (typeof value === 'string') {
      scalarText(value); if (d.nonemptyText && !value.length) fail('target empty text');
      const bytes = new TextEncoder().encode(value); textBytes += bytes.length;
      if (textBytes > d.maxTextBytes) fail('target text limit');
      const payload = allocate(bytes.length); chunks.push([payload, bytes]);
      put('tag', l.codes.text); put('payload', payload); put('length', bytes.length);
    } else {
      if (!Array.isArray(value) || ancestors.has(value)) fail('target requires finite terms');
      ancestors.add(value); const payload = allocate(value.length * 4);
      put('tag', l.codes.list); put('payload', payload); put('length', value.length);
      value.forEach((child, index) => word(payload + index * 4, visit(child, depth + 1)));
      ancestors.delete(value);
    }
    return address;
  }
  const root = visit(value, 1), memory = new Uint8Array(cursor), view = new DataView(memory.buffer);
  for (const [field, value] of Object.entries({ magic: l.magic, root, end: cursor })) word(l.frameWords.indexOf(field) * 4, value);
  for (const [address, bytes] of chunks) memory.set(bytes, address);
  for (const [address, value] of words) view.setUint32(address, value, t.endian === 'little');
  return memory;
}

export function interpretTargetDecode(model, bytes) {
  validateTargetModel(model);
  const { target: t, layout: l, domain: d } = model;
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > t.maxBytes) fail('target frame size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), seen = new Set(); let nodes = 0, textBytes = 0;
  const span = (address, length) => { if (!uint(address) || !uint(length) || address < 12 || address + length > bytes.length) fail('target address out of bounds'); };
  const word = address => { if (address + 4 > bytes.length) fail('target word out of bounds'); return view.getUint32(address, t.endian === 'little'); };
  const header = field => word(4 * l.frameWords.indexOf(field));
  if (header('magic') !== l.magic || header('end') !== bytes.length) fail('target frame header');
  function read(address, depth) {
    span(address, 12); if (address % t.alignment || seen.has(address) || depth > d.maxDepth || ++nodes > d.maxNodes) fail('target term budget or alias');
    seen.add(address); const cell = field => word(address + 4 * l.cellWords.indexOf(field));
    const tag = cell('tag'), payload = cell('payload'), length = cell('length');
    if (tag === l.codes.text) {
      span(payload, length); textBytes += length; if (textBytes > d.maxTextBytes) fail('target text limit');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(payload, payload + length));
      if (d.nonemptyText && !text.length) fail('target empty text'); return text;
    }
    if (tag !== l.codes.list) fail('target unknown tag');
    span(payload, length * 4); if (length > d.maxNodes) fail('target list limit');
    return Array.from({ length }, (_, i) => read(word(payload + 4 * i), depth + 1));
  }
  const value = read(header('root'), 1), expected = interpretTargetEncode(model, value);
  if (expected.length !== bytes.length || expected.some((byte, i) => byte !== bytes[i])) fail('target noncanonical frame');
  return value;
}

// This generic runtime is emitted as code, with the model's scalar layout fields
// specialized below. Its allocation algorithm is independent of the planner.
function compiledCodec(T, L, D) {
  const error = message => { throw new TypeError(message); };
  function encodeFrame(value) {
    const memory = Array(12).fill(0), ancestors = new Set(); let nodes = 0, textBytes = 0;
    const allocate = count => { while (memory.length % T.alignment) memory.push(0); const at = memory.length; if (!Number.isSafeInteger(count) || count < 0 || at + count > T.maxBytes) error('target memory limit'); for (let i = 0; i < count; i += 1) memory.push(0); return at; };
    const put = (at, value) => { for (let i = 0; i < 4; i += 1) memory[at + i] = value >>> (8 * (T.endian === 'little' ? i : 3 - i)) & 255; };
    function visit(value, depth) {
      if (depth > D.maxDepth || ++nodes > D.maxNodes) error('target term budget');
      const at = allocate(12), cell = (field, value) => put(at + L.cellWords.indexOf(field) * 4, value);
      if (typeof value === 'string') {
        for (let i = 0; i < value.length; i += 1) { const x = value.charCodeAt(i); if (x >= 0xd800 && x <= 0xdbff) { const y = value.charCodeAt(++i); if (!(y >= 0xdc00 && y <= 0xdfff)) error('target requires Unicode scalar text'); } else if (x >= 0xdc00 && x <= 0xdfff) error('target requires Unicode scalar text'); }
        const bytes = new TextEncoder().encode(value); if ((D.nonemptyText && bytes.length === 0) || (textBytes += bytes.length) > D.maxTextBytes) error('target text limit');
        const payload = allocate(bytes.length); bytes.forEach((x, i) => { memory[payload + i] = x; });
        cell('tag', L.codes.text); cell('payload', payload); cell('length', bytes.length);
      } else {
        if (!Array.isArray(value) || ancestors.has(value)) error('target requires finite terms'); ancestors.add(value);
        const payload = allocate(value.length * 4); cell('tag', L.codes.list); cell('payload', payload); cell('length', value.length);
        for (let i = 0; i < value.length; i += 1) put(payload + i * 4, visit(value[i], depth + 1));
        ancestors.delete(value);
      }
      return at;
    }
    const root = visit(value, 1); put(L.frameWords.indexOf('magic') * 4, L.magic); put(L.frameWords.indexOf('root') * 4, root); put(L.frameWords.indexOf('end') * 4, memory.length);
    return Uint8Array.from(memory);
  }
  function decodeFrame(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > T.maxBytes) error('target frame size');
    const seen = new Set(); let nodes = 0, textBytes = 0;
    const word = at => { if (at + 4 > bytes.length) error('target word bounds'); let value = 0; for (let i = 0; i < 4; i += 1) value += bytes[at + i] * 2 ** (8 * (T.endian === 'little' ? i : 3 - i)); return value; };
    const span = (at, length) => { if (at < 12 || !Number.isSafeInteger(length) || length < 0 || at + length > bytes.length) error('target address bounds'); };
    const header = field => word(L.frameWords.indexOf(field) * 4);
    if (header('magic') !== L.magic || header('end') !== bytes.length) error('target frame header');
    function read(at, depth) {
      span(at, 12); if (at % T.alignment || seen.has(at) || depth > D.maxDepth || ++nodes > D.maxNodes) error('target term budget or alias'); seen.add(at);
      const field = key => word(at + L.cellWords.indexOf(key) * 4), tag = field('tag'), payload = field('payload'), length = field('length');
      if (tag === L.codes.text) { span(payload, length); if ((textBytes += length) > D.maxTextBytes) error('target text limit'); const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.slice(payload, payload + length)); if (D.nonemptyText && !text.length) error('target empty text'); return text; }
      if (tag !== L.codes.list) error('target unknown tag'); span(payload, length * 4); if (length > D.maxNodes) error('target list limit'); const value = []; for (let i = 0; i < length; i += 1) value.push(read(word(payload + i * 4), depth + 1)); return value;
    }
    const value = read(header('root'), 1), encoded = encodeFrame(value); if (encoded.length !== bytes.length || encoded.some((x, i) => x !== bytes[i])) error('target noncanonical frame'); return value;
  }
  return { encodeFrame, decodeFrame };
}

export function generateJavaScriptTarget(model) {
  validateTargetModel(model);
  const expr = e => {
    const children = e.slice(1).map(x => Array.isArray(x) ? expr(x) : null);
    switch (e[0]) {
      case 'arg': return `args[${e[1]}]`;
      case 'text': return JSON.stringify(e[1]);
      case 'list': return `[${children.join(',')}]`;
      case 'if': return `(boolean(${children[0]})?${children[1]}:${children[2]})`;
      case 'is-text': return `(typeof ${children[0]}==='string')`;
      case 'empty': return `(list(${children[0]}).length===0)`;
      case 'head': return `head(${children[0]})`;
      case 'tail': return `tail(${children[0]})`;
      case 'call': return `program_${e[1]}([${e.slice(2).map(expr).join(',')}],state)`;
      case 'equal': return `same(${children[0]},${children[1]})`;
      case 'and': return `(${children.map(x => `boolean(${x})`).join('&&') || 'true'})`;
      case 'fail': return `error(${JSON.stringify(e[1])})`;
      default: return fail('unsupported target operation');
    }
  };
  const functions = Object.entries(model.programs).map(([name, p]) => `function program_${name}(args,state){if(args.length!==${p.params}||--state.fuel<0||++state.depth>${model.domain.maxDepth})error('target invocation/fuel/depth');try{return ${expr(p.body)};}finally{state.depth--;}}`).join('\n');
  return `// Generated only from the executable Link target model.\nconst {encodeFrame,decodeFrame}=(${compiledCodec.toString()})(${JSON.stringify(model.target)},${JSON.stringify(model.layout)},${JSON.stringify(model.domain)});\nexport {encodeFrame,decodeFrame};\nconst error=message=>{throw new TypeError(message)};\nconst list=x=>Array.isArray(x)?x:error('target expected list');\nconst boolean=x=>typeof x==='boolean'?x:error('target expected boolean');\nconst head=x=>list(x).length?x[0]:error('target empty head');\nconst tail=x=>list(x).length?x.slice(1):error('target empty tail');\nconst same=(a,b)=>typeof a==='string'||typeof b==='string'||typeof a==='boolean'||typeof b==='boolean'?a===b:a.length===b.length&&a.every((x,i)=>same(x,b[i]));\n${functions}\nconst programs={${Object.keys(model.programs).map(name => `${JSON.stringify(name)}:program_${name}`).join(',')}};\nexport function executeProgram(name,args,fuel=1000000){if(!Object.hasOwn(programs,name))error('unknown target program');if(!Number.isSafeInteger(fuel)||fuel<0||fuel>1000000)error('invalid target fuel');return programs[name](args,{fuel,depth:0});}\n`;
}
