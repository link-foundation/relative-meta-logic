/** Elaboration from owned Babel syntax, independent of source text and parsers.
 * Parameter/result contracts are required because JavaScript is dynamically typed.
 * Unsupported syntax is retained in the caller's AST and reported, never erased. */
import { validateControlFlowAst } from './rml-control-flow-ast.mjs';
import { CONTROL_FLOW_SCHEMA, CONTROL_FLOW_CONTRACT, ControlFlowError, validateControlFlow, controlFlowToNetwork } from './rml-control-flow.mjs';

const error = (code, message, node) => { throw new ControlFlowError(code, message, node?.type ?? 'project'); };
const ensure = (value, code, message, node) => { if (!value) error(code, message, node); };
const operators = { '+': 'add', '-': 'sub', '*': 'mul', '<': 'lt', '<=': 'le', '===': 'eq' };
const typeOf = value => value === null ? 'unit' : typeof value === 'boolean' ? 'bool' : 'int';

export function lowerJavaScriptControlFlow(project) {
  ensure(project && Array.isArray(project.modules) && project.signatures, 'PROJECT', 'Explicit modules and function type contracts are required');
  const modules = [], definitions = [], bindings = [], moduleNames = new Set();
  ensure(project.modules.length <= 1000, 'LIMIT', 'Module count exceeded');
  for (const source of project.modules) {
    validateControlFlowAst(source.ast);
    ensure(!moduleNames.has(source.id), 'BINDING', 'Duplicate module identity'); moduleNames.add(source.id);
    const ast = source.ast?.type === 'File' ? source.ast.program : source.ast;
    ensure(ast?.type === 'Program' && (!ast.directives || ast.directives.length === 0), 'UNSUPPORTED', 'Expected a module without directives', ast);
    const module = { id: source.id, imports: [], exports: [] };
    for (const statement of ast.body) {
      if (statement.type === 'ImportDeclaration') {
        ensure(!statement.attributes?.length && !statement.assertions?.length, 'UNSUPPORTED', 'Import attributes need an environment contract', statement);
        const dependency = source.dependencies?.[statement.source.value];
        ensure(dependency, 'PROJECT', `No project module for ${statement.source.value}`, statement);
        for (const specifier of statement.specifiers) {
          ensure(specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier', 'UNSUPPORTED', 'Only named function imports are elaborated', specifier);
          module.imports.push([specifier.local.name, `${dependency}.${specifier.imported.name}`]);
        }
        ensure(statement.specifiers.length, 'UNSUPPORTED', 'Side-effect imports need module initialization semantics', statement);
        continue;
      }
      let declaration = statement;
      if (statement.type === 'ExportNamedDeclaration') {
        ensure(statement.declaration && !statement.source && !statement.specifiers.length, 'UNSUPPORTED', 'Only directly exported functions are elaborated', statement);
        declaration = statement.declaration;
        if (declaration.id) module.exports.push(declaration.id.name);
      }
      ensure(declaration.type === 'FunctionDeclaration' && declaration.id && !declaration.async && !declaration.generator, 'UNSUPPORTED', 'Only synchronous function declarations are elaborated', declaration);
      const signature = project.signatures[`${source.id}.${declaration.id.name}`];
      ensure(signature && Array.isArray(signature.parameters) && signature.parameters.length === declaration.params.length, 'TYPE_OBLIGATION', 'A parameter/result/effect contract is required for every function', declaration);
      definitions.push({ module, declaration, signature });
    }
    modules.push(module);
  }
  const signatures = new Map(definitions.map(({ module, declaration, signature }) => [`${module.id}.${declaration.id.name}`, signature]));
  const functions = definitions.map(({ module, declaration, signature }) => {
    const id = `${module.id}.${declaration.id.name}`;
    const fn = { module: module.id, name: declaration.id.name, parameters: [], result: signature.result, effects: signature.effects, locals: [], entry: 'b0', blocks: [] };
    let nextRegister = 0, nextBlock = 0;
    const scopes = [new Map()], loopStack = [];
    const block = () => { const value = { id: `b${nextBlock++}`, instructions: [], terminator: null }; fn.blocks.push(value); return value; };
    let current = block();
    const register = type => { const id = `r${nextRegister++}`; fn.locals.push([id, type]); return { id, type }; };
    const emit = instruction => { ensure(current, 'UNREACHABLE_SOURCE', 'Unreachable source must be handled explicitly', declaration); current.instructions.push(instruction); };
    const terminate = instruction => { current.terminator = instruction; current = null; };
    const define = (sourceName, value, mutable, node) => {
      const scope = scopes.at(-1);
      ensure(!scope.has(sourceName), 'BINDING', `Duplicate lexical binding ${sourceName}`, node);
      scope.set(sourceName, { ...value, mutable }); bindings.push({ function: id, identity: value.id, name: sourceName, mutable });
    };
    const lookup = (sourceName, node) => {
      for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(sourceName)) { const value = scopes[i].get(sourceName); ensure(value.id !== null, 'UNINITIALIZED', `Temporal dead zone for ${sourceName}`, node); return value; }
      error('BINDING', `Unresolved lexical binding ${sourceName}`, node);
    };
    const hasLocal = sourceName => scopes.some(scope => scope.has(sourceName));
    declaration.params.forEach((parameter, index) => {
      ensure(parameter.type === 'Identifier' && !parameter.typeAnnotation, 'UNSUPPORTED', 'Destructuring/default/rest parameters need separate elaboration', parameter);
      const value = { id: `r${nextRegister++}`, type: signature.parameters[index] };
      fn.parameters.push([value.id, value.type]); define(parameter.name, value, signature.parameterMutability?.[index] ?? true, parameter);
    });
    const constant = value => { ensure(value === null || typeof value === 'boolean' || (Number.isSafeInteger(value) && !Object.is(value, -0)), 'NUMERIC_OBLIGATION', 'Only signed safe integer literals are elaborated'); const result = register(typeOf(value)); emit(['const', result.id, value]); return result; };
    const copy = (target, source, node) => { ensure(target.type === source.type, 'TYPE', 'Assignment type mismatch', node); emit(['copy', target.id, source.id]); return target; };
    const binary = (operator, left, right, node) => {
      ensure(operators[operator], 'UNSUPPORTED', `Operator ${operator} requires a numeric or coercion contract`, node);
      ensure(operator === '===' ? left.type === right.type : left.type === 'int' && right.type === 'int', 'TYPE', 'Operator type mismatch', node);
      const result = register(['<', '<=', '==='].includes(operator) ? 'bool' : 'int'); emit([operators[operator], result.id, left.id, right.id]); return result;
    };
    const expression = node => {
      ensure(node && typeof node.type === 'string', 'SCHEMA', 'Missing expression', node);
      if (node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') return constant(node.value);
      if (node.type === 'NullLiteral') error('TYPE_OBLIGATION', 'JavaScript null is distinct from unit/undefined and needs a nullable type', node);
      if (node.type === 'Identifier') {
        const source = lookup(node.name, node), result = register(source.type);
        // Copy now: evaluating a later operand may mutate this source register.
        copy(result, source, node); return result;
      }
      if (node.type === 'UnaryExpression' && node.operator === '!') { const operand = expression(node.argument); ensure(operand.type === 'bool', 'TYPE', 'Boolean negation requires a boolean', node); const result = register('bool'); emit(['not', result.id, operand.id]); return result; }
      if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral') return constant(-node.argument.value);
      if (node.type === 'BinaryExpression') { const left = expression(node.left), right = expression(node.right); return binary(node.operator, left, right, node); }
      if (node.type === 'AssignmentExpression') {
        ensure(node.left.type === 'Identifier', 'OWNERSHIP_OBLIGATION', 'Property assignment requires heap and alias semantics', node);
        const target = lookup(node.left.name, node); ensure(target.mutable, 'BINDING', 'Cannot assign to a constant', node);
        if (node.operator === '=') { copy(target, expression(node.right), node); const result = register(target.type); return copy(result, target, node); }
        ensure(['+=', '-=', '*='].includes(node.operator), 'UNSUPPORTED', 'Unsupported assignment operator', node);
        const old = register(target.type); copy(old, target, node);
        copy(target, binary(node.operator[0], old, expression(node.right), node), node); const result = register(target.type); return copy(result, target, node);
      }
      if (node.type === 'UpdateExpression') {
        ensure(node.argument.type === 'Identifier' && ['++', '--'].includes(node.operator), 'UNSUPPORTED', 'Unsupported update', node);
        const target = lookup(node.argument.name, node); ensure(target.mutable && target.type === 'int', 'TYPE', 'Update requires a mutable integer', node);
        const old = register('int'); copy(old, target, node); copy(target, binary(node.operator === '++' ? '+' : '-', old, constant(1), node), node); if (!node.prefix) return old; const result = register('int'); return copy(result, target, node);
      }
      if (node.type === 'CallExpression') {
        ensure(!node.optional && !node.arguments.some(arg => arg.type === 'SpreadElement'), 'UNSUPPORTED', 'Optional/spread calls need additional elaboration', node);
        if (node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.object.type === 'Identifier' && node.callee.object.name === 'console' && node.callee.property.type === 'Identifier' && node.callee.property.name === 'log') {
          ensure(!hasLocal('console') && !module.imports.some(([name]) => name === 'console') && !signatures.has(`${module.id}.console`), 'BINDING', 'Shadowed console is not the output intrinsic', node);
          ensure(node.arguments.length === 1, 'EFFECT_OBLIGATION', 'The scalar output contract accepts exactly one argument', node);
          const argument = expression(node.arguments[0]); emit(['emit', argument.id]); return constant(null);
        }
        ensure(node.callee.type === 'Identifier' && !hasLocal(node.callee.name), 'UNSUPPORTED', 'Only resolved first-order function calls are elaborated', node);
        const target = module.imports.find(([alias]) => alias === node.callee.name)?.[1] ?? `${module.id}.${node.callee.name}`;
        const callee = signatures.get(target); ensure(callee && callee.parameters.length === node.arguments.length, 'BINDING', 'Unresolved function or wrong arity', node);
        const args = node.arguments.map(expression); ensure(args.every((arg, i) => arg.type === callee.parameters[i]), 'TYPE', 'Call argument type mismatch', node);
        const result = register(callee.result); emit(['call', result.id, target, ...args.map(arg => arg.id)]); return result;
      }
      if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
        const condition = expression(node.type === 'ConditionalExpression' ? node.test : node.left);
        ensure(condition.type === 'bool', 'TYPE', 'Conditional test must be boolean', node);
        ensure(node.type !== 'LogicalExpression' || ['&&', '||'].includes(node.operator), 'UNSUPPORTED', 'Nullish coalescing needs nullable value semantics', node);
        const yes = block(), no = block(), merge = block(); terminate(['branch', condition.id, yes.id, no.id]);
        current = yes;
        const left = node.type === 'ConditionalExpression' ? expression(node.consequent) : node.operator === '&&' ? expression(node.right) : condition;
        const result = register(left.type); copy(result, left, node); terminate(['jump', merge.id]);
        current = no;
        const right = node.type === 'ConditionalExpression' ? expression(node.alternate) : node.operator === '||' ? expression(node.right) : condition;
        copy(result, right, node); terminate(['jump', merge.id]); current = merge; return result;
      }
      error('UNSUPPORTED', `No semantic elaboration for ${node.type}`, node);
    };
    const statements = nodes => { for (const node of nodes) if (node.type === 'VariableDeclaration' && ['let', 'const'].includes(node.kind)) for (const declaration of node.declarations) { ensure(declaration.id.type === 'Identifier' && !scopes.at(-1).has(declaration.id.name), 'BINDING', 'Duplicate or destructured lexical binding', declaration); scopes.at(-1).set(declaration.id.name, { id: null, type: null, mutable: false }); } for (const node of nodes) { ensure(current, 'UNREACHABLE_SOURCE', 'Statements after unconditional transfer require explicit handling', node); statement(node); } };
    const scoped = callback => { scopes.push(new Map()); callback(); scopes.pop(); };
    const statement = node => {
      if (node.type === 'BlockStatement') { ensure(!node.directives?.length, 'UNSUPPORTED', 'Block directives need semantics', node); scoped(() => statements(node.body)); }
      else if (node.type === 'EmptyStatement') { /* No observation. */ }
      else if (node.type === 'ExpressionStatement') expression(node.expression);
      else if (node.type === 'VariableDeclaration') {
        ensure(node.kind === 'let' || node.kind === 'const', 'UNSUPPORTED', 'var requires function-scope hoisting semantics', node);
        for (const declaration of node.declarations) {
          ensure(declaration.id.type === 'Identifier' && declaration.init, 'UNSUPPORTED', 'Only initialized identifier bindings are elaborated', declaration);
          // A lexical declaration shadows outer names during its initializer.
          ensure(!scopes.at(-1).has(declaration.id.name) || scopes.at(-1).get(declaration.id.name).id === null, 'BINDING', 'Duplicate lexical declaration', declaration);
          scopes.at(-1).set(declaration.id.name, { id: null, type: null, mutable: false });
          const value = expression(declaration.init); scopes.at(-1).delete(declaration.id.name);
          const binding = register(value.type); copy(binding, value, declaration); define(declaration.id.name, binding, node.kind === 'let', declaration);
        }
      } else if (node.type === 'ReturnStatement') {
        const value = node.argument ? expression(node.argument) : constant(null); ensure(value.type === fn.result, 'TYPE', 'Return type mismatch', node); terminate(['return', value.id]);
      } else if (node.type === 'IfStatement') {
        const condition = expression(node.test); ensure(condition.type === 'bool', 'TYPE', 'If requires a boolean condition', node);
        const yes = block(), no = block(); terminate(['branch', condition.id, yes.id, no.id]);
        current = yes; statement(node.consequent); const left = current;
        current = no; if (node.alternate) statement(node.alternate); const right = current;
        if (left || right) { const merge = block(); if (left) left.terminator = ['jump', merge.id]; if (right) right.terminator = ['jump', merge.id]; current = merge; } else current = null;
      } else if (node.type === 'WhileStatement' || node.type === 'ForStatement') scoped(() => {
        if (node.type === 'ForStatement' && node.init) { if (node.init.type === 'VariableDeclaration') statement(node.init); else expression(node.init); }
        const test = block(), body = block(), exit = block(), increment = node.type === 'ForStatement' && node.update ? block() : test;
        terminate(['jump', test.id]); current = test;
        const condition = node.test ? expression(node.test) : constant(true); ensure(condition.type === 'bool', 'TYPE', 'Loop requires a boolean test', node);
        terminate(['branch', condition.id, body.id, exit.id]); current = body; loopStack.push({ break: exit.id, continue: increment.id }); statement(node.body); loopStack.pop();
        if (current) terminate(['jump', increment.id]);
        if (increment !== test) { current = increment; expression(node.update); terminate(['jump', test.id]); }
        current = exit;
      });
      else if (node.type === 'BreakStatement' || node.type === 'ContinueStatement') {
        ensure(!node.label && loopStack.length, 'UNSUPPORTED', 'Only unlabeled loop transfer is elaborated', node); terminate(['jump', loopStack.at(-1)[node.type === 'BreakStatement' ? 'break' : 'continue']]);
      } else error('UNSUPPORTED', `No statement elaboration for ${node.type}`, node);
    };
    // Function parameters and the outer function body share a lexical scope.
    ensure(declaration.body.type === 'BlockStatement' && !declaration.body.directives?.length, 'UNSUPPORTED', 'Expected a function block without directives', declaration.body);
    statements(declaration.body.body);
    if (current) { ensure(fn.result === 'unit', 'TYPE', 'Function may fall through without its declared result', declaration); const unit = constant(null); terminate(['return', unit.id]); }
    return fn;
  });
  const program = { schema: CONTROL_FLOW_SCHEMA, modules, functions, entry: project.entry };
  const checked = validateControlFlow(program);
  return { status: 'elaborated-fragment', program, network: controlFlowToNetwork(program), bindings, effects: checked.effects, contract: CONTROL_FLOW_CONTRACT,
    obligations: ['JavaScript entry arguments satisfy explicit scalar type contracts', 'Every JavaScript argument and arithmetic intermediate lies in the signed-safe-integer domain, excluding negative zero; the compiler does not prove this precondition', 'console.log is the declared scalar output intrinsic; host formatting is outside the event observation', 'Termination and semantic-preservation proofs remain unproved'] };
}
