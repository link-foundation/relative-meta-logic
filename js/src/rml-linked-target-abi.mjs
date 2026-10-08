// Generated only from the executable Link target model.
const {encodeFrame,decodeFrame}=(function compiledCodec(T, L, D) {
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
})({"addressBits":32,"alignment":4,"endian":"little","maxBytes":16777216,"wordBytes":4},{"cellWords":["tag","payload","length"],"codes":{"list":2,"text":1},"frameWords":["magic","root","end"],"magic":1380797489},{"maxDepth":256,"maxNodes":1000000,"maxTextBytes":8388608,"nonemptyText":true,"unicode":"scalar-values"});
export {encodeFrame,decodeFrame};
const error=message=>{throw new TypeError(message)};
const list=x=>Array.isArray(x)?x:error('target expected list');
const boolean=x=>typeof x==='boolean'?x:error('target expected boolean');
const head=x=>list(x).length?x[0]:error('target empty head');
const tail=x=>list(x).length?x.slice(1):error('target empty tail');
const same=(a,b)=>typeof a==='string'||typeof b==='string'||typeof a==='boolean'||typeof b==='boolean'?a===b:a.length===b.length&&a.every((x,i)=>same(x,b[i]));
function program_accepted(args,state){if(args.length!==1||--state.fuel<0||++state.depth>256)error('target invocation/fuel/depth');try{return (boolean((typeof args[0]==='string'))?same("true","false"):(boolean((list(args[0]).length===0))?same("true","false"):same(head(args[0]),"proof-accepted")));}finally{state.depth--;}}
function program_program(args,state){if(args.length!==0||--state.fuel<0||++state.depth>256)error('target invocation/fuel/depth');try{return "linked-proof-verifier";}finally{state.depth--;}}
function program_quote(args,state){if(args.length!==1||--state.fuel<0||++state.depth>256)error('target invocation/fuel/depth');try{return (boolean((typeof args[0]==='string'))?["atom",args[0]]:(boolean((list(args[0]).length===0))?["list-end"]:["pair",program_quote([head(args[0])],state),program_quote([tail(args[0])],state)]));}finally{state.depth--;}}
function program_receipt(args,state){if(args.length!==5||--state.fuel<0||++state.depth>256)error('target invocation/fuel/depth');try{return ["rml-linked-proof-replay/v1",args[0],(boolean(program_accepted([args[2]],state))?"true":"false"),args[1],args[2],args[3],args[4]];}finally{state.depth--;}}
function program_request(args,state){if(args.length!==3||--state.fuel<0||++state.depth>256)error('target invocation/fuel/depth');try{return ["verify-linked-proof",program_quote([args[0]],state),program_quote([args[1]],state),program_quote([args[2]],state)];}finally{state.depth--;}}
const programs={"accepted":program_accepted,"program":program_program,"quote":program_quote,"receipt":program_receipt,"request":program_request};
export function executeProgram(name,args,fuel=1000000){if(!Object.hasOwn(programs,name))error('unknown target program');if(!Number.isSafeInteger(fuel)||fuel<0||fuel>1000000)error('invalid target fuel');return programs[name](args,{fuel,depth:0});}
