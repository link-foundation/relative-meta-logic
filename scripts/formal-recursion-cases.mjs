/** Shared source-independent typed structural recursion obligations.
 * Expected positive normal forms are constructed here, never obtained by
 * running another prover or copying the linked reducer's actual result.
 */
export const index = n => n === 0 ? 'fs-index-zero' : ['fs-index-next', index(n - 1)];
const variable = n => ['fs-variable', index(n)];
const lambda = body => ['fs-lambda-inferred', body];
const nat = n => n === 0 ? ['fs-zero'] : ['fs-successor', nat(n - 1)];
const natural = n => n === 0 ? 'fs-v-zero' : ['fs-v-successor', natural(n - 1)];
const list = items => items.reduceRight((tail, head) => ['fs-cons', head, tail], ['fs-nil']);
const values = items => items.reduceRight((tail, head) => ['fs-v-cons', head, tail], 'fs-v-nil');
const ok = (type, value) => ['fs-ok', type, value];
const neutral = name => ['fs-neutral', name];
const closure = (body, locals) => ['fs-closure', body, locals];
const bind = (type, value, locals = 'fs-empty') => ['fs-bind', type, value, locals];
const apply = (fn, value) => ['fs-apply', fn, value];
const pi = (domain, codomain) => ['fs-pi-type', domain, codomain];
const arrow = (domain, codomain) => ['fs-arrow-type', domain, codomain];
const tpi = (domain, body, locals) => ['fs-t-pi', domain, ['fs-type-closure', body, locals]];
const natType = ['fs-nat-type'];
const listType = ['fs-list-type', natType];
const tlist = ['fs-t-list', 'fs-t-nat'];
const natMotive = lambda(natType);
const natStep = lambda(lambda(['fs-successor', variable(0)]));
const listStep = lambda(lambda(lambda(['fs-successor', variable(0)])));
const natRec = (target, motive = natMotive, base = nat(0), step = natStep) => ['fs-nat-rec', motive, base, step, target];
const listRec = (target, motive = natMotive, base = nat(0), step = listStep) => ['fs-list-rec', motive, base, step, target];
const infer = (expression, locals = 'fs-empty', globals = 'fs-empty') => ['fs-infer', expression, locals, globals];
const natStepType = (motive, locals) => tpi('fs-t-nat',
  pi(apply(variable(1), variable(0)), apply(variable(2), ['fs-successor', variable(1)])),
  bind(['fs-t-arrow', 'fs-t-nat', 'fs-kind'], motive, locals));
const listStepType = (element, motive, locals) => tpi(element,
  pi(['fs-list-type', variable(1)],
    pi(apply(variable(3), variable(0)), apply(variable(4), ['fs-cons', variable(2), variable(1)]))),
  bind('fs-kind', element, bind(['fs-t-arrow', ['fs-t-list', element], 'fs-kind'], motive, locals)));
const globals = ['fs-global-bind', 'empty', tlist, 'fs-v-nil', 'fs-empty'];
const empty = ['fs-global', 'empty'];
const natLocals = bind('fs-t-nat', neutral(index(0)));
const listLocals = bind(tlist, neutral(index(0)));
const vectorMotive = lambda(['fs-vector-type', natType, variable(0)]);
const vectorBase = ['fs-vector-repeat', nat(0), nat(0)];
const vectorStep = lambda(lambda(['fs-vector-repeat', ['fs-successor', variable(1)], nat(0)]));
const listVectorMotive = lambda(['fs-vector-type', natType, ['fs-length', variable(0)]]);
const listVectorStep = lambda(lambda(lambda(['fs-vector-repeat', ['fs-successor', ['fs-length', variable(1)]], nat(0)])));

export function formalRecursionCases() {
  const cases = [];
  const yes = (name, request, expected) => cases.push({ name, accepted: true, request, expected });
  const no = (name, request) => cases.push({ name, accepted: false, request });
  yes('nat-zero-checks-both-branches', infer(natRec(nat(0))), ok('fs-t-nat', natural(0)));
  yes('nat-successors-use-induction-hypothesis', infer(natRec(nat(3))), ok('fs-t-nat', natural(3)));
  yes('nat-annotated-step-binders', infer(natRec(nat(1), ['fs-lambda', natType, natType], nat(0),
    ['fs-lambda', natType, ['fs-lambda', natType, ['fs-successor', variable(0)]]])), ok('fs-t-nat', natural(1)));
  yes('nat-dependent-vector-concrete', infer(natRec(nat(2), vectorMotive, vectorBase, vectorStep)),
    ok(['fs-t-vector', 'fs-t-nat', natural(2)], ['fs-v-vector', values([natural(0), natural(0)])]));
  const vm = closure(vectorMotive[1], natLocals);
  const vs = ok(natStepType(vm, natLocals), closure(vectorStep[1], natLocals));
  const vb = ok(['fs-t-vector', 'fs-t-nat', natural(0)], ['fs-v-vector', 'fs-v-nil']);
  yes('nat-dependent-vector-symbolic', infer(natRec(variable(0), vectorMotive, vectorBase, vectorStep), natLocals),
    ok(['fs-t-vector', 'fs-t-nat', neutral(index(0))], neutral(['fs-neutral-nat-rec', vm, vb, vs, index(0)])));
  // An outer index is captured by the motive and must survive the ghost binding.
  const captureMotive = lambda(['fs-vector-type', natType, variable(1)]);
  const captureBase = ['fs-vector-repeat', variable(0), nat(0)];
  const captureStep = lambda(lambda(variable(0)));
  const captureResult = ['fs-v-vector', neutral(['fs-neutral-vector-repeat', index(0), natural(0)])];
  yes('nat-motive-captures-outer-index', infer(natRec(nat(1), captureMotive, captureBase, captureStep), natLocals),
    ok(['fs-t-vector', 'fs-t-nat', neutral(index(0))], captureResult));
  no('nat-mutated-motive-value', infer(natRec(nat(0), lambda(nat(0)))));
  no('nat-mutated-motive-domain', infer(natRec(nat(0), ['fs-lambda', listType, natType])));
  no('nat-mutated-base-on-zero', infer(natRec(nat(0), natMotive, ['fs-true'])));
  no('nat-mutated-step-on-zero', infer(natRec(nat(0), natMotive, nat(0), lambda(lambda(['fs-true'])))));
  no('nat-mutated-step-annotation', infer(natRec(nat(0), natMotive, nat(0),
    ['fs-lambda', ['fs-bool-type'], lambda(nat(0))])));
  no('nat-mutated-target', infer(natRec(['fs-true'])));
  no('nat-mutated-vector-base-index', infer(natRec(nat(0), vectorMotive, ['fs-vector-repeat', nat(1), nat(0)], vectorStep)));
  no('nat-mutated-vector-step-index', infer(natRec(nat(0), vectorMotive, vectorBase,
    lambda(lambda(['fs-vector-repeat', variable(1), nat(0)])))));
  no('nat-mutated-induction-dependency', infer(natRec(nat(0), vectorMotive, vectorBase, lambda(lambda(variable(0))))));
  no('nat-mutated-missing-global-dependency', infer(natRec(nat(0), natMotive, nat(0),
    lambda(lambda(apply(['fs-global', 'missing'], variable(0)))))));
  no('nat-mutated-global-dependency-type', infer(natRec(nat(0), natMotive, nat(0),
    lambda(lambda(apply(['fs-global', 'increment'], variable(0))))), 'fs-empty',
    ['fs-global-bind', 'increment', ['fs-t-arrow', 'fs-t-bool', 'fs-t-nat'],
      closure(nat(0), 'fs-empty'), 'fs-empty']));
  no('nat-mutated-step-on-symbolic-target', infer(natRec(variable(0), natMotive, nat(0), lambda(lambda(['fs-true']))), natLocals));

  yes('list-nil-checks-both-branches', infer(listRec(empty), 'fs-empty', globals), ok('fs-t-nat', natural(0)));
  yes('list-cons-use-induction-hypothesis', infer(listRec(list([nat(2), nat(1)]))), ok('fs-t-nat', natural(2)));
  const lm = closure(natMotive[1], listLocals);
  const ls = ok(listStepType('fs-t-nat', lm, listLocals), closure(listStep[1], listLocals));
  yes('list-symbolic-preserves-checked-branches', infer(listRec(variable(0)), listLocals),
    ok('fs-t-nat', neutral(['fs-neutral-list-rec', 'fs-t-nat', lm, ok('fs-t-nat', natural(0)), ls, index(0)])));
  const lvm = closure(listVectorMotive[1], listLocals);
  const lvs = ok(listStepType('fs-t-nat', lvm, listLocals), closure(listVectorStep[1], listLocals));
  yes('list-dependent-vector-symbolic', infer(listRec(variable(0), listVectorMotive, vectorBase, listVectorStep), listLocals),
    ok(['fs-t-vector', 'fs-t-nat', neutral(['fs-neutral-length', index(0)])],
      neutral(['fs-neutral-list-rec', 'fs-t-nat', lvm, vb, lvs, index(0)])));
  yes('list-dependent-vector-concrete', infer(listRec(list([nat(1)]), listVectorMotive, vectorBase, listVectorStep)),
    ok(['fs-t-vector', 'fs-t-nat', natural(1)], ['fs-v-vector', values([natural(0)])]));
  // The recursive result is a function. Changing offset goes through the IH,
  // as in structural translations of NetworkConversions' offset recursion.
  const outputType = ['fs-list-type', ['fs-product-type', natType, natType]];
  const offsetMotive = lambda(arrow(natType, outputType));
  const offsetBase = lambda(['fs-nil']);
  const offsetStep = lambda(lambda(lambda(lambda(['fs-cons',
    ['fs-pair', variable(3), variable(0)], apply(variable(1), ['fs-successor', variable(0)])]))));
  const offsetFold = listRec(list([nat(2), nat(1)]), offsetMotive, offsetBase, offsetStep);
  yes('list-offset-parameter-changes-recursive-call', infer(apply(offsetFold, nat(3))),
    ok(['fs-t-list', ['fs-t-product', 'fs-t-nat', 'fs-t-nat']],
      values([['fs-v-pair', natural(2), natural(3)], ['fs-v-pair', natural(1), natural(4)]])));
  no('list-mutated-motive-value-on-nil', infer(listRec(empty, lambda(nat(0))), 'fs-empty', globals));
  no('list-mutated-motive-domain', infer(listRec(empty, ['fs-lambda', natType, natType]), 'fs-empty', globals));
  no('list-mutated-base-on-nil', infer(listRec(empty, natMotive, ['fs-true']), 'fs-empty', globals));
  no('list-mutated-step-on-nil', infer(listRec(empty, natMotive, nat(0), lambda(lambda(lambda(['fs-true'])))), 'fs-empty', globals));
  no('list-mutated-head-type', infer(listRec(empty, natMotive, nat(0),
    ['fs-lambda', ['fs-bool-type'], lambda(lambda(nat(0)))]), 'fs-empty', globals));
  no('list-mutated-tail-type', infer(listRec(empty, natMotive, nat(0),
    lambda(['fs-lambda', natType, lambda(nat(0))])), 'fs-empty', globals));
  no('list-mutated-induction-hypothesis-type', infer(listRec(empty, natMotive, nat(0),
    lambda(lambda(['fs-lambda', ['fs-bool-type'], nat(0)]))), 'fs-empty', globals));
  no('list-mutated-vector-base-index', infer(listRec(empty, listVectorMotive,
    ['fs-vector-repeat', nat(1), nat(0)], listVectorStep), 'fs-empty', globals));
  no('list-mutated-vector-step-index', infer(listRec(empty, listVectorMotive, vectorBase,
    lambda(lambda(lambda(['fs-vector-repeat', ['fs-length', variable(1)], nat(0)])))), 'fs-empty', globals));
  no('list-mutated-induction-dependency', infer(listRec(empty, listVectorMotive, vectorBase,
    lambda(lambda(lambda(variable(0))))), 'fs-empty', globals));
  no('list-mutated-step-on-symbolic-target', infer(listRec(variable(0), natMotive, nat(0),
    lambda(lambda(lambda(['fs-true'])))), listLocals));
  no('list-mutated-target', infer(listRec(nat(0))));
  no('list-untyped-nil-does-not-guess-element', infer(listRec(['fs-nil'])));
  return { schema: 'rml-formal-recursion-cases/v1', program: 'formal-recursion-replay',
    programs: ['formal-recursion', 'formal-indexed', 'formal-records', 'formal-semantics'], maxSteps: 50_000, cases };
}
