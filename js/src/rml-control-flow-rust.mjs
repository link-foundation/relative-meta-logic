/** Elaboration from the shared Syn owned-AST capture into the scalar CFG.
 * This uses Rust lexical shadowing/Copy bindings, not JavaScript source parsing.
 * Borrowing, non-Copy values, macros beyond the declared output intrinsic and
 * nontrivial type elaboration are explicit remaining obligations. */
import { lowerJavaScriptControlFlow } from './rml-control-flow-javascript.mjs';
import { validateControlFlowAst } from './rml-control-flow-ast.mjs';
import { ControlFlowError } from './rml-control-flow.mjs';
const fail=(code,message)=>{throw new ControlFlowError(code,message,'Rust/Syn');};
const ensure=(test,code,message)=>{if(!test)fail(code,message);};
const supported=(node,keys)=>ensure(node&&typeof node==='object'&&!Array.isArray(node)&&Object.keys(node).every(k=>keys.includes(k)),'UNSUPPORTED','Unelaborated Rust syntax fields');
// Syn 3 adds modifier records. Accept only their empty, ordinary-function form.
const plainModifiers=value=>{if(value!==undefined)supported(value,[]);};
const id=name=>({type:'Identifier',name});
const literal=value=>({type:typeof value==='boolean'?'BooleanLiteral':'NumericLiteral',value});
const block=body=>({type:'BlockStatement',body,directives:[]});
const expressionStatement=expression=>({type:'ExpressionStatement',expression});
const declaration=(name,init,mutable=false)=>({type:'VariableDeclaration',kind:mutable?'let':'const',declarations:[{type:'VariableDeclarator',id:id(name),init}]});
const binary=(operator,left,right)=>({type:'BinaryExpression',operator,left,right});
const path=p=>{supported(p,['segments']);ensure(Array.isArray(p.segments)&&p.segments.every(s=>Object.keys(s).length===1&&typeof s.ident==='string'),'TYPE_OBLIGATION','Generic or qualified path arguments need elaboration');return p.segments.map(s=>s.ident);};
const scalarType=t=>{if(!t)return'unit';if(t.path){const p=path(t.path);ensure(p.length===1&&['i64','bool'].includes(p[0]),'TYPE_OBLIGATION','Only i64 and bool are elaborated');return p[0]==='i64'?'int':'bool';}if(t.tuple?.elems?.length===0)return'unit';fail('OWNERSHIP_OBLIGATION','References, generics, aggregates and ownership-bearing types require elaboration');};

export function lowerRustControlFlow(project){
 ensure(project&&Array.isArray(project.modules),'PROJECT','Explicit Rust module ASTs are required');
 const signatures={},modules=[];
 let serial=0;
 const fresh=()=>`rust_binding_${serial++}`;
 ensure(project.modules.length<=1000,'LIMIT','Module count exceeded');
 for(const source of project.modules){
  validateControlFlowAst(source.ast);
  supported(source.ast,['items','attrs','shebang']);ensure(!source.ast.attrs?.length&&!source.ast.shebang,'UNSUPPORTED','Crate attributes/shebang need separate handling');
  const body=[],dependencies={};
  for(const item of source.ast.items){
   if(item.use){
    supported(item.use,['tree']);const parts=[];let tree=item.use.tree;
    while(tree.path){supported(tree,['path']);supported(tree.path,['ident','tree']);parts.push(tree.path.ident);tree=tree.path.tree;}
    let imported,alias;
    if(tree.ident){supported(tree,['ident']);imported=alias=tree.ident;}
    else if(tree.rename){supported(tree,['rename']);supported(tree.rename,['ident','rename']);imported=tree.rename.ident;alias=tree.rename.rename;}
    else fail('UNSUPPORTED','Glob/group/self imports need project elaboration');
    const request=[...parts,imported].join('::');
    const target=source.dependencies?.[request];ensure(typeof target==='string','PROJECT',`No resolved project dependency for ${request}`);
    const split=target.lastIndexOf('.');ensure(split>0,'PROJECT','Expected a qualified target function');
    dependencies[request]=target.slice(0,split);
    body.push({type:'ImportDeclaration',source:{type:'StringLiteral',value:request},specifiers:[{type:'ImportSpecifier',local:id(alias),imported:id(target.slice(split+1))}]});continue;
   }
   ensure(item.fn&&Object.keys(item).length===1,'UNSUPPORTED','Only functions and named use declarations are elaborated');
   const fn=item.fn;supported(fn,['vis','ident','inputs','output','stmts','modifiers','safety']);plainModifiers(fn.modifiers);ensure(fn.safety===undefined||fn.safety==='default','UNSUPPORTED','Explicit Rust safety needs separate elaboration');ensure(!fn.vis||fn.vis==='pub','UNSUPPORTED','Restricted visibility needs module visibility semantics');
   const scopes=[new Map()];
   const bind=(name,mutable)=>{const renamed=fresh();scopes.at(-1).set(name,{name:renamed,mutable});return renamed;};
   const lookup=name=>{for(let i=scopes.length-1;i>=0;i--)if(scopes[i].has(name))return scopes[i].get(name).name;return name;};
   const params=[],parameterTypes=[],parameterMutability=[];
   for(const input of fn.inputs){supported(input,['typed']);supported(input.typed,['pat','ty']);const pattern=input.typed.pat;ensure(pattern.ident,'UNSUPPORTED','Parameter patterns need elaboration');supported(pattern.ident,['ident','mut']);
    ensure(!scopes[0].has(pattern.ident.ident),'BINDING','Duplicate Rust parameter');const name=bind(pattern.ident.ident,!!pattern.ident.mut);params.push(id(name));parameterTypes.push(scalarType(input.typed.ty));parameterMutability.push(!!pattern.ident.mut);
   }
   const signature={parameters:parameterTypes,parameterMutability,result:scalarType(fn.output),effects:project.effects?.[`${source.id}.${fn.ident}`]??[]};signatures[`${source.id}.${fn.ident}`]=signature;
   const convertExpression=e=>{
    ensure(e&&Object.keys(e).length===1,'UNSUPPORTED','Attributed or unrecognized Rust expression');
    if(e.lit){const l=e.lit;supported(l,['int','bool']);if(Object.hasOwn(l,'bool'))return literal(l.bool);ensure(typeof l.int==='string'&&/^(?:0|[1-9][0-9_]*)(?:i64)?$/u.test(l.int),'NUMERIC_OBLIGATION','Nondecimal/suffixed/noninteger literal needs numeric elaboration');return literal(Number(l.int.replaceAll('_','').replace(/i64$/u,'')));}
    if(e.path){const p=path(e.path);ensure(p.length===1,'PROJECT','Qualified expression paths need an explicit named import');return id(lookup(p[0]));}
    if(e.paren){supported(e.paren,['expr']);return convertExpression(e.paren.expr);}
    if(e.unary){supported(e.unary,['op','expr']);ensure(['-','!'].includes(e.unary.op),'OWNERSHIP_OBLIGATION','Dereference needs borrow/heap semantics');return{type:'UnaryExpression',operator:e.unary.op,argument:convertExpression(e.unary.expr),prefix:true};}
    if(e.binary){const b=e.binary;supported(b,['left','op','right']);const left=convertExpression(b.left),right=convertExpression(b.right);
     if(['+=','-=','*='].includes(b.op))return{type:'AssignmentExpression',operator:b.op,left,right};
     if(['&&','||'].includes(b.op))return{type:'LogicalExpression',operator:b.op,left,right};
     ensure(['+','-','*','<','<=','=='].includes(b.op),'NUMERIC_OBLIGATION',`Rust operator ${b.op} needs additional lowering`);return binary(b.op==='=='?'===':b.op,left,right);
    }
    if(e.assign){supported(e.assign,['left','right']);return{type:'AssignmentExpression',operator:'=',left:convertExpression(e.assign.left),right:convertExpression(e.assign.right)};}
    if(e.call){supported(e.call,['func','args']);return{type:'CallExpression',callee:convertExpression(e.call.func),arguments:e.call.args.map(convertExpression)};}
    if(e.if){const f=e.if;supported(f,['cond','then_branch','else_branch']);ensure(f.else_branch,'TYPE','Value-producing if requires an else branch');
     const one=stmts=>{ensure(stmts.length===1&&stmts[0].expr?.[1]===false,'UNSUPPORTED','Conditional expression blocks with statements need block-value elaboration');return convertExpression(stmts[0].expr[0]);};
     ensure(f.else_branch.block,'UNSUPPORTED','Else-if expressions require separate elaboration');return{type:'ConditionalExpression',test:convertExpression(f.cond),consequent:one(f.then_branch),alternate:one(f.else_branch.block.stmts)};
    }
    fail('UNSUPPORTED',`No scalar elaboration for Rust ${Object.keys(e)[0]}`);
   };
   const convertBlock=(stmts,tail=false)=>{scopes.push(new Map());const result=convertStatements(stmts,tail);scopes.pop();return block(result);};
   const convertStatementExpression=e=>{
    if(e.return){supported(e.return,['expr']);return{type:'ReturnStatement',argument:e.return.expr?convertExpression(e.return.expr):null};}
    if(e.break){supported(e.break,[]);return{type:'BreakStatement',label:null};}
    if(e.continue){supported(e.continue,[]);return{type:'ContinueStatement',label:null};}
    if(e.block){supported(e.block,['stmts']);return convertBlock(e.block.stmts);}
    if(e.if){const f=e.if;supported(f,['cond','then_branch','else_branch']);return{type:'IfStatement',test:convertExpression(f.cond),consequent:convertBlock(f.then_branch),alternate:f.else_branch?convertStatementExpression(f.else_branch):null};}
    if(e.while){const w=e.while;supported(w,['cond','body']);return{type:'WhileStatement',test:convertExpression(w.cond),body:convertBlock(w.body)};}
    if(e.for_loop){const f=e.for_loop;supported(f,['pat','expr','body']);ensure(f.pat.ident&&!f.pat.ident.mut&&f.expr.range,'UNSUPPORTED','Only immutable half-open integer range loops are elaborated');supported(f.pat.ident,['ident']);const range=f.expr.range;supported(range,['start','end','limits']);ensure(range.start&&range.end&&range.limits==='..','UNSUPPORTED','Only bounded half-open ranges are elaborated');
     const start=convertExpression(range.start),end=convertExpression(range.end),counter=fresh(),limit=fresh(),startValue=fresh();scopes.push(new Map());const binding=bind(f.pat.ident.ident,false);const converted=convertStatements(f.body,false);scopes.pop();
     return block([declaration(startValue,start),declaration(limit,end),{type:'ForStatement',init:declaration(counter,id(startValue),true),test:binary('<',id(counter),id(limit)),update:{type:'UpdateExpression',operator:'++',argument:id(counter),prefix:false},body:block([declaration(binding,id(counter)),...converted])}]);
    }
    return expressionStatement(convertExpression(e));
   };
   const convertStatements=(stmts,tail)=>{const result=[];
    for(let index=0;index<stmts.length;index++){
     const statement=stmts[index];ensure(Object.keys(statement).length===1,'UNSUPPORTED','Unrecognized Rust statement');
     if(statement.let){const d=statement.let;supported(d,['pat','init','modifiers']);plainModifiers(d.modifiers);ensure(d.pat.ident&&d.init?.expr,'UNSUPPORTED','Only initialized identifier bindings are elaborated');supported(d.pat.ident,['ident','mut']);supported(d.init,['expr']);const init=convertExpression(d.init.expr),name=bind(d.pat.ident.ident,!!d.pat.ident.mut);result.push(declaration(name,init,!!d.pat.ident.mut));}
     else if(statement.macro){const m=statement.macro;supported(m,['path','delimiter','tokens','semi_token']);ensure(path(m.path).join('::')==='println'&&m.delimiter==='paren'&&m.tokens.length===3&&m.tokens[0].lit==='"{}"'&&m.tokens[1].punct?.op===','&&m.tokens[2].ident,'EFFECT_OBLIGATION','Only println!("{}", scalar_binding) has an output contract');
      result.push(expressionStatement({type:'CallExpression',callee:{type:'MemberExpression',computed:false,object:id('console'),property:id('log')},arguments:[id(lookup(m.tokens[2].ident))]}));
     }else if(statement.expr){ensure(Array.isArray(statement.expr)&&statement.expr.length===2,'SCHEMA','Malformed Rust expression statement');const[e,semicolon]=statement.expr;
      if(tail&&index===stmts.length-1&&!semicolon&&!e.return&&!e.while&&!e.for_loop&&!e.break&&!e.continue){result.push({type:'ReturnStatement',argument:convertExpression(e)});}else result.push(convertStatementExpression(e));
     }else fail('UNSUPPORTED','Nested items need declaration/scope elaboration');
    }return result;
   };
   const fnDeclaration={type:'FunctionDeclaration',id:id(fn.ident),params,body:block(convertStatements(fn.stmts,signature.result!=='unit')),async:false,generator:false};
   body.push(fn.vis==='pub'?{type:'ExportNamedDeclaration',declaration:fnDeclaration,specifiers:[],source:null}:fnDeclaration);
  }
  modules.push({id:source.id,ast:{type:'Program',body,directives:[],sourceType:'module'},dependencies});
 }
 const result=lowerJavaScriptControlFlow({modules,signatures,entry:project.entry});
 result.obligations=['Rust i64 entry values and every arithmetic intermediate lie in the signed-safe-integer domain','Only Copy scalar ownership has been elaborated; borrowing, heap values and destructors remain unsupported','println! is interpreted as one scalar output event; formatting and IO failure require separate contracts','Termination and semantic-preservation proofs remain unproved'];
 return result;
}
