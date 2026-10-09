/** Generic structural ECMAScript code generation. No RML constructors occur here.
 * The input is an AST, never source tokens, source slices, or an eval payload.
 * Its own implementation is included in the linked implementation archive.
 */
export function generateJavaScript(tree, { maxNodes = 2_000_000, maxDepth = 512 } = {}) {
  let visits = 0;
  const ancestors = new Set();
  const list = (nodes, separator = ', ') => nodes.map(node => emit(node)).join(separator);
  const key = node => node.computed ? `[${emit(node.key)}]` : emit(node.key);
  const blockBody = node => [...(node.directives ?? []), ...node.body].map(node => emit(node)).join('\n');
  const method = node => `${node.static ? 'static ' : ''}${node.async ? 'async ' : ''}${node.kind === 'get' || node.kind === 'set' ? `${node.kind} ` : ''}${node.generator ? '*' : ''}${key(node)}(${list(node.params)}) ${emit(node.body)}`;
  const expressionTypes = new Set(['ClassExpression', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectExpression']);
  const statementBody = node => node.type === 'BlockStatement' ? emit(node) : `{\n${emit(node)}\n}`;
  function emit(node, depth = ancestors.size) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') throw new TypeError('JavaScript generator requires a structured AST node');
    if (++visits > maxNodes || depth > maxDepth) throw new RangeError('JavaScript generation budget exceeded');
    if (ancestors.has(node)) throw new TypeError('cyclic JavaScript syntax');
    ancestors.add(node);
    let result;
    switch (node.type) {
      case 'File': result = emit(node.program); break;
      case 'Program': result = `${node.interpreter ? `${emit(node.interpreter)}\n` : ''}${blockBody(node)}\n`; break;
      case 'InterpreterDirective': result = `#!${node.value}`; break;
      case 'Identifier': result = node.name; break;
      case 'PrivateName': result = `#${emit(node.id)}`; break;
      case 'StringLiteral': result = JSON.stringify(node.value); break;
      case 'NumericLiteral': result = String(node.value); break;
      case 'BigIntLiteral': result = `${node.value}n`; break;
      case 'BooleanLiteral': result = node.value ? 'true' : 'false'; break;
      case 'NullLiteral': result = 'null'; break;
      case 'RegExpLiteral': result = `/${node.pattern}/${node.flags}`; break;
      case 'ThisExpression': result = 'this'; break;
      case 'Super': result = 'super'; break;
      case 'BlockStatement': result = `{\n${blockBody(node)}\n}`; break;
      case 'EmptyStatement': result = ';'; break;
      case 'DebuggerStatement': result = 'debugger;'; break;
      case 'Directive': result = `${emit(node.value)};`; break;
      case 'DirectiveLiteral': result = JSON.stringify(node.value); break;
      case 'VariableDeclaration': result = `${node.kind} ${list(node.declarations)};`; break;
      case 'VariableDeclarator': result = `${emit(node.id)}${node.init ? ` = ${emit(node.init)}` : ''}`; break;
      case 'ExpressionStatement': result = `${expressionTypes.has(node.expression.type) ? `(${emit(node.expression)})` : emit(node.expression)};`; break;
      case 'ReturnStatement': result = `return${node.argument ? ` ${emit(node.argument)}` : ''};`; break;
      case 'ThrowStatement': result = `throw ${emit(node.argument)};`; break;
      case 'BreakStatement': result = `break${node.label ? ` ${emit(node.label)}` : ''};`; break;
      case 'ContinueStatement': result = `continue${node.label ? ` ${emit(node.label)}` : ''};`; break;
      case 'LabeledStatement': result = `${emit(node.label)}: ${emit(node.body)}`; break;
      case 'IfStatement': result = `if (${emit(node.test)}) ${statementBody(node.consequent)}${node.alternate ? ` else ${statementBody(node.alternate)}` : ''}`; break;
      case 'WhileStatement': result = `while (${emit(node.test)}) ${statementBody(node.body)}`; break;
      case 'DoWhileStatement': result = `do ${statementBody(node.body)} while (${emit(node.test)});`; break;
      case 'ForStatement': result = `for (${node.init ? emit(node.init).replace(/;$/, '') : ''}; ${node.test ? emit(node.test) : ''}; ${node.update ? emit(node.update) : ''}) ${statementBody(node.body)}`; break;
      case 'ForInStatement':
      case 'ForOfStatement': result = `for ${node.await ? 'await ' : ''}(${emit(node.left).replace(/;$/, '')} ${node.type === 'ForOfStatement' ? 'of' : 'in'} ${emit(node.right)}) ${statementBody(node.body)}`; break;
      case 'SwitchStatement': result = `switch (${emit(node.discriminant)}) {\n${list(node.cases, '\n')}\n}`; break;
      case 'SwitchCase': result = `${node.test ? `case ${emit(node.test)}` : 'default'}:\n${list(node.consequent, '\n')}`; break;
      case 'TryStatement': result = `try ${emit(node.block)}${node.handler ? ` ${emit(node.handler)}` : ''}${node.finalizer ? ` finally ${emit(node.finalizer)}` : ''}`; break;
      case 'CatchClause': result = `catch${node.param ? ` (${emit(node.param)})` : ''} ${emit(node.body)}`; break;
      case 'FunctionDeclaration':
      case 'FunctionExpression': result = `${node.async ? 'async ' : ''}function${node.generator ? '*' : ''}${node.id ? ` ${emit(node.id)}` : ''}(${list(node.params)}) ${emit(node.body)}`; break;
      case 'ArrowFunctionExpression': result = `(${node.async ? 'async ' : ''}(${list(node.params)}) => ${node.body.type === 'ObjectExpression' ? `(${emit(node.body)})` : emit(node.body)})`; break;
      case 'ClassDeclaration':
      case 'ClassExpression': result = `class${node.id ? ` ${emit(node.id)}` : ''}${node.superClass ? ` extends ${emit(node.superClass)}` : ''} ${emit(node.body)}`; break;
      case 'ClassBody': result = `{\n${list(node.body, '\n')}\n}`; break;
      case 'ClassMethod':
      case 'ClassPrivateMethod':
      case 'ObjectMethod': result = method(node); break;
      case 'ClassProperty':
      case 'ClassPrivateProperty': result = `${node.static ? 'static ' : ''}${key(node)}${node.value ? ` = ${emit(node.value)}` : ''};`; break;
      case 'StaticBlock': result = `static {\n${list(node.body, '\n')}\n}`; break;
      case 'ArrayExpression':
      case 'ArrayPattern': result = `[${node.elements.map(node => node ? emit(node) : '').join(', ')}${node.elements.length && node.elements.at(-1) === null ? ',' : ''}]`; break;
      case 'ObjectExpression':
      case 'ObjectPattern': result = `{${list(node.properties)}}`; break;
      case 'ObjectProperty': result = node.shorthand ? emit(node.value) : `${key(node)}: ${emit(node.value)}`; break;
      case 'SpreadElement':
      case 'RestElement': result = `...${emit(node.argument)}`; break;
      case 'AssignmentPattern': result = `${emit(node.left)} = ${emit(node.right)}`; break;
      case 'BinaryExpression':
      case 'LogicalExpression':
      case 'AssignmentExpression': result = `(${emit(node.left)} ${node.operator} ${emit(node.right)})`; break;
      case 'UnaryExpression': result = `(${node.operator} ${emit(node.argument)})`; break;
      case 'UpdateExpression': result = `(${node.prefix ? node.operator : ''}${emit(node.argument)}${node.prefix ? '' : node.operator})`; break;
      case 'ConditionalExpression': result = `(${emit(node.test)} ? ${emit(node.consequent)} : ${emit(node.alternate)})`; break;
      case 'SequenceExpression': result = `(${list(node.expressions)})`; break;
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const object = ['NumericLiteral', 'ObjectExpression', 'FunctionExpression', 'ClassExpression'].includes(node.object.type) ? `(${emit(node.object)})` : emit(node.object);
        result = `${object}${node.optional ? '?.' : node.computed ? '' : '.'}${node.computed ? `[${emit(node.property)}]` : emit(node.property)}`;
        break;
      }
      case 'CallExpression':
      case 'OptionalCallExpression': result = `${expressionTypes.has(node.callee.type) ? `(${emit(node.callee)})` : emit(node.callee)}${node.optional ? '?.' : ''}(${list(node.arguments)})`; break;
      case 'NewExpression': result = `(new (${emit(node.callee)})(${list(node.arguments)}))`; break;
      case 'AwaitExpression': result = `(await ${emit(node.argument)})`; break;
      case 'YieldExpression': result = `(yield${node.delegate ? '*' : ''}${node.argument ? ` ${emit(node.argument)}` : ''})`; break;
      case 'MetaProperty': result = `${emit(node.meta)}.${emit(node.property)}`; break;
      case 'ImportExpression': result = `import(${emit(node.source)}${node.options ? `, ${emit(node.options)}` : ''})`; break;
      case 'TemplateLiteral': result = '`' + node.quasis.map((quasi, index) => quasi.value.raw + (index < node.expressions.length ? '${' + emit(node.expressions[index]) + '}' : '')).join('') + '`'; break;
      case 'TaggedTemplateExpression': result = `${emit(node.tag)}${emit(node.quasi)}`; break;
      case 'ImportDeclaration': {
        const bare = node.specifiers.filter(item => item.type !== 'ImportSpecifier');
        const named = node.specifiers.filter(item => item.type === 'ImportSpecifier');
        const specifiers = [...bare.map(node => emit(node)), ...(named.length ? [`{${list(named)}}`] : [])].join(', ');
        result = `import ${specifiers ? `${specifiers} from ` : ''}${emit(node.source)}${node.attributes?.length ? ` with {${list(node.attributes)}}` : ''};`;
        break;
      }
      case 'ImportSpecifier': result = `${emit(node.imported)}${node.imported.name !== node.local.name ? ` as ${emit(node.local)}` : ''}`; break;
      case 'ImportDefaultSpecifier': result = emit(node.local); break;
      case 'ImportNamespaceSpecifier': result = `* as ${emit(node.local)}`; break;
      case 'ImportAttribute': result = `${emit(node.key)}: ${emit(node.value)}`; break;
      case 'ExportNamedDeclaration': result = `export ${node.declaration ? emit(node.declaration) : `{${list(node.specifiers)}}${node.source ? ` from ${emit(node.source)}` : ''};`}`; break;
      case 'ExportDefaultDeclaration': result = `export default ${emit(node.declaration)}${['FunctionDeclaration', 'ClassDeclaration'].includes(node.declaration.type) ? '' : ';'}`; break;
      case 'ExportAllDeclaration': result = `export * from ${emit(node.source)};`; break;
      case 'ExportSpecifier': result = `${emit(node.local)}${node.local.name !== node.exported.name ? ` as ${emit(node.exported)}` : ''}`; break;
      default: throw new TypeError(`unsupported JavaScript AST node: ${node.type}`);
    }
    ancestors.delete(node);
    return result;
  }
  return emit(tree);
}
