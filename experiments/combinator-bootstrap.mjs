// Experiment: compile closed lambda terms to the S/K binary-link basis and
// reduce them without host variable binding, substitution, or atom equality.

const S = 'S';
const K = 'K';
const app = (left, right) => [left, right];
const variable = name => ({ variable: name });
const lambda = (name, body) => ({ lambda: name, body });

const freeIn = (name, term) => {
  if (term?.variable !== undefined) return term.variable === name;
  if (term?.lambda !== undefined) {
    return term.lambda !== name && freeIn(name, term.body);
  }
  return Array.isArray(term) && (freeIn(name, term[0]) || freeIn(name, term[1]));
};

const abstract = (name, term) => {
  if (!freeIn(name, term)) return app(K, term);
  if (term?.variable === name) return app(app(S, K), K);
  if (!Array.isArray(term)) throw new Error(`cannot abstract free ${name}`);
  return app(app(S, abstract(name, term[0])), abstract(name, term[1]));
};

const compile = term => {
  if (term?.variable !== undefined) return term;
  if (term?.lambda !== undefined) return abstract(term.lambda, compile(term.body));
  if (Array.isArray(term)) return app(compile(term[0]), compile(term[1]));
  return term;
};

const rewriteOnce = term => {
  if (!Array.isArray(term)) return null;
  if (Array.isArray(term[0]) && term[0][0] === K) return term[0][1];
  if (
    Array.isArray(term[0]) &&
    Array.isArray(term[0][0]) &&
    term[0][0][0] === S
  ) {
    const left = term[0][0][1];
    const right = term[0][1];
    const argument = term[1];
    return app(app(left, argument), app(right, argument));
  }
  const left = rewriteOnce(term[0]);
  if (left !== null) return app(left, term[1]);
  const right = rewriteOnce(term[1]);
  return right === null ? null : app(term[0], right);
};

const normalize = (term, limit = 1_000_000) => {
  let current = term;
  for (let steps = 0; steps < limit; steps += 1) {
    const next = rewriteOnce(current);
    if (next === null) return { term: current, steps };
    current = next;
  }
  throw new Error(`combinator limit ${limit} exceeded`);
};

const applyMany = (head, ...arguments_) => arguments_.reduce(app, head);
const lambdas = (names, body) => names.reduceRight((nested, name) => lambda(name, nested), body);

// Normal-order head reduction is sufficient to observe Scott-encoded data and
// does not unfold recursion hidden in an unselected branch.
const rewriteHeadOnce = term => {
  if (!Array.isArray(term)) return null;
  if (Array.isArray(term[0]) && term[0][0] === K) return term[0][1];
  if (
    Array.isArray(term[0]) &&
    Array.isArray(term[0][0]) &&
    term[0][0][0] === S
  ) {
    const left = term[0][0][1];
    const right = term[0][1];
    const argument = term[1];
    return app(app(left, argument), app(right, argument));
  }
  const left = rewriteHeadOnce(term[0]);
  return left === null ? null : app(left, term[1]);
};

const headNormalize = (term, limit = 2_000_000) => {
  let current = term;
  for (let steps = 0; steps < limit; steps += 1) {
    const next = rewriteHeadOnce(current);
    if (next === null) return { term: current, steps };
    current = next;
  }
  throw new Error(`combinator head limit ${limit} exceeded`);
};

const x = variable('x');
const y = variable('y');
const identity = lambda('x', x);
const chooseFirst = lambda('x', lambda('y', x));
const chooseSecond = lambda('x', lambda('y', y));

for (const [name, expression, expected] of [
  ['identity', app(identity, K), K],
  ['choose-first', app(app(chooseFirst, S), K), S],
  ['choose-second', app(app(chooseSecond, S), K), K],
]) {
  const result = normalize(compile(expression));
  if (JSON.stringify(result.term) !== JSON.stringify(expected)) {
    throw new Error(`${name} failed: ${JSON.stringify(result.term)}`);
  }
  console.log(`${name}: ${result.steps} contractions`);
}

const TRUE = lambdas(['yes', 'no'], variable('yes'));
const FALSE = lambdas(['yes', 'no'], variable('no'));
const NOT = lambda('value', applyMany(variable('value'), FALSE, TRUE));
const AND = lambdas(
  ['left', 'right'],
  applyMany(variable('left'), variable('right'), FALSE),
);
const EQ_BOOL = lambdas(
  ['left', 'right'],
  applyMany(variable('left'), variable('right'), app(NOT, variable('right'))),
);
const NIL = lambdas(['nil', 'cons'], variable('nil'));
const CONS = lambdas(
  ['head', 'tail', 'nil', 'cons'],
  applyMany(variable('cons'), variable('head'), variable('tail')),
);
const Y = lambda(
  'function',
  app(
    lambda('self', app(variable('function'), app(variable('self'), variable('self')))),
    lambda('self', app(variable('function'), app(variable('self'), variable('self')))),
  ),
);
const EQ_BITS = app(Y, lambdas(
  ['recur', 'left', 'right'],
  applyMany(
    variable('left'),
    applyMany(variable('right'), TRUE, lambdas(['head', 'tail'], FALSE)),
    lambdas(
      ['left-head', 'left-tail'],
      applyMany(
        variable('right'),
        FALSE,
        lambdas(
          ['right-head', 'right-tail'],
          applyMany(
            AND,
            applyMany(EQ_BOOL, variable('left-head'), variable('right-head')),
            applyMany(variable('recur'), variable('left-tail'), variable('right-tail')),
          ),
        ),
      ),
    ),
  ),
));

const bits = values => values.reduceRight(
  (tail, value) => applyMany(CONS, value ? TRUE : FALSE, tail),
  NIL,
);

for (const [name, left, right, expected] of [
  ['equal-empty', [], [], K],
  ['equal-bits', [true, false, true], [true, false, true], K],
  ['different-bit', [true, false], [true, true], S],
  ['different-length', [true], [true, false], S],
]) {
  const observed = applyMany(EQ_BITS, bits(left), bits(right), K, S);
  const result = headNormalize(compile(observed));
  if (JSON.stringify(result.term) !== JSON.stringify(expected)) {
    throw new Error(`${name} failed: ${JSON.stringify(result.term)}`);
  }
  console.log(`${name}: ${result.steps} contractions`);
}

const compiled = expression => compile(expression);
const TRUE_C = compiled(TRUE);
const FALSE_C = compiled(FALSE);
const NOT_C = compiled(NOT);
const AND_C = compiled(AND);
const EQ_BOOL_C = compiled(EQ_BOOL);
const NIL_C = compiled(NIL);
const CONS_C = compiled(CONS);
const Y_C = compiled(Y);
const EQ_BITS_C = compiled(EQ_BITS);

const NONE_C = compiled(lambdas(['none', 'some'], variable('none')));
const SOME_C = compiled(lambdas(
  ['value', 'none', 'some'],
  app(variable('some'), variable('value')),
));
const IS_SOME_C = compiled(lambda(
  'option',
  applyMany(variable('option'), FALSE_C, lambda('value', TRUE_C)),
));
const BINDING_C = compiled(lambdas(
  ['name', 'value', 'consumer'],
  applyMany(variable('consumer'), variable('name'), variable('value')),
));
const ATOM_C = compiled(lambdas(
  ['payload', 'atom', 'list'],
  app(variable('atom'), variable('payload')),
));
const LIST_C = compiled(lambdas(
  ['children', 'atom', 'list'],
  app(variable('list'), variable('children')),
));
const PATTERN_VARIABLE_C = compiled(lambdas(
  ['name', 'variable', 'atom', 'list'],
  app(variable('variable'), variable('name')),
));
const PATTERN_ATOM_C = compiled(lambdas(
  ['payload', 'variable', 'atom', 'list'],
  app(variable('atom'), variable('payload')),
));
const PATTERN_LIST_C = compiled(lambdas(
  ['children', 'variable', 'atom', 'list'],
  app(variable('list'), variable('children')),
));

const EQ_NODE_LIST_FACTORY_C = compiled(lambdas(
  ['equal-node', 'left', 'right'],
  applyMany(
    app(
      Y_C,
      lambdas(
        ['recur', 'left-list', 'right-list'],
        applyMany(
          variable('left-list'),
          applyMany(
            variable('right-list'),
            TRUE_C,
            lambdas(['head', 'tail'], FALSE_C),
          ),
          lambdas(
            ['left-head', 'left-tail'],
            applyMany(
              variable('right-list'),
              FALSE_C,
              lambdas(
                ['right-head', 'right-tail'],
                applyMany(
                  AND_C,
                  applyMany(
                    variable('equal-node'),
                    variable('left-head'),
                    variable('right-head'),
                  ),
                  applyMany(
                    variable('recur'),
                    variable('left-tail'),
                    variable('right-tail'),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    variable('left'),
    variable('right'),
  ),
));

const EQ_NODE_C = compiled(app(
  Y_C,
  lambdas(
    ['recur', 'left', 'right'],
    applyMany(
      variable('left'),
      lambda(
        'left-atom',
        applyMany(
          variable('right'),
          lambda(
            'right-atom',
            applyMany(EQ_BITS_C, variable('left-atom'), variable('right-atom')),
          ),
          lambda('right-list', FALSE_C),
        ),
      ),
      lambda(
        'left-list',
        applyMany(
          variable('right'),
          lambda('right-atom', FALSE_C),
          lambda(
            'right-list',
            applyMany(
              EQ_NODE_LIST_FACTORY_C,
              variable('recur'),
              variable('left-list'),
              variable('right-list'),
            ),
          ),
        ),
      ),
    ),
  ),
));

const LOOKUP_C = compiled(app(
  Y_C,
  lambdas(
    ['recur', 'name', 'bindings'],
    applyMany(
      variable('bindings'),
      NONE_C,
      lambdas(
        ['binding', 'remaining'],
        app(
          variable('binding'),
          lambdas(
            ['bound-name', 'bound-value'],
            applyMany(
              EQ_BITS_C,
              variable('name'),
              variable('bound-name'),
              app(SOME_C, variable('bound-value')),
              applyMany(variable('recur'), variable('name'), variable('remaining')),
            ),
          ),
        ),
      ),
    ),
  ),
));

const MATCH_LIST_FACTORY_C = compiled(lambdas(
  ['match-node', 'patterns', 'candidates', 'bindings'],
  applyMany(
    app(
      Y_C,
      lambdas(
        ['recur', 'patterns', 'candidates', 'bindings'],
        applyMany(
          variable('patterns'),
          applyMany(
            variable('candidates'),
            app(SOME_C, variable('bindings')),
            lambdas(['head', 'tail'], NONE_C),
          ),
          lambdas(
            ['pattern-head', 'pattern-tail'],
            applyMany(
              variable('candidates'),
              NONE_C,
              lambdas(
                ['candidate-head', 'candidate-tail'],
                applyMany(
                  applyMany(
                    variable('match-node'),
                    variable('pattern-head'),
                    variable('candidate-head'),
                    variable('bindings'),
                  ),
                  NONE_C,
                  lambda(
                    'next-bindings',
                    applyMany(
                      variable('recur'),
                      variable('pattern-tail'),
                      variable('candidate-tail'),
                      variable('next-bindings'),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    variable('patterns'),
    variable('candidates'),
    variable('bindings'),
  ),
));

const MATCH_C = compiled(app(
  Y_C,
  lambdas(
    ['recur', 'pattern', 'candidate', 'bindings'],
    applyMany(
      variable('pattern'),
      lambda(
        'name',
        applyMany(
          applyMany(LOOKUP_C, variable('name'), variable('bindings')),
          app(
            SOME_C,
            applyMany(
              CONS_C,
              applyMany(BINDING_C, variable('name'), variable('candidate')),
              variable('bindings'),
            ),
          ),
          lambda(
            'previous',
            applyMany(
              EQ_NODE_C,
              variable('previous'),
              variable('candidate'),
              app(SOME_C, variable('bindings')),
              NONE_C,
            ),
          ),
        ),
      ),
      lambda(
        'pattern-atom',
        applyMany(
          variable('candidate'),
          lambda(
            'candidate-atom',
            applyMany(
              EQ_BITS_C,
              variable('pattern-atom'),
              variable('candidate-atom'),
              app(SOME_C, variable('bindings')),
              NONE_C,
            ),
          ),
          lambda('candidate-list', NONE_C),
        ),
      ),
      lambda(
        'pattern-list',
        applyMany(
          variable('candidate'),
          lambda('candidate-atom', NONE_C),
          lambda(
            'candidate-list',
            applyMany(
              MATCH_LIST_FACTORY_C,
              variable('recur'),
              variable('pattern-list'),
              variable('candidate-list'),
              variable('bindings'),
            ),
          ),
        ),
      ),
    ),
  ),
));

const encodeBits = text => [...new TextEncoder().encode(text)]
  .flatMap(byte => Array.from({ length: 8 }, (_, index) => (byte & (128 >> index)) !== 0))
  .reduceRight(
    (tail, value) => applyMany(CONS_C, value ? TRUE_C : FALSE_C, tail),
    NIL_C,
  );
const encodeNode = term => typeof term === 'string'
  ? app(ATOM_C, encodeBits(term))
  : app(LIST_C, term.reduceRight(
    (tail, child) => applyMany(CONS_C, encodeNode(child), tail),
    NIL_C,
  ));
const encodePattern = term => typeof term === 'string'
  ? term.startsWith('?')
    ? app(PATTERN_VARIABLE_C, encodeBits(term.slice(1)))
    : app(PATTERN_ATOM_C, encodeBits(term))
  : app(PATTERN_LIST_C, term.reduceRight(
    (tail, child) => applyMany(CONS_C, encodePattern(child), tail),
    NIL_C,
  ));

for (const [name, pattern, candidate, expected] of [
  ['match-atom', 'a', 'a', K],
  ['reject-atom', 'a', 'b', S],
  ['bind-variable', ['pair', '?x', '?x'], ['pair', 'same', 'same'], K],
  ['reject-repeated-variable', ['pair', '?x', '?x'], ['pair', 'a', 'b'], S],
]) {
  const observed = applyMany(
    IS_SOME_C,
    applyMany(MATCH_C, encodePattern(pattern), encodeNode(candidate), NIL_C),
    K,
    S,
  );
  const result = headNormalize(observed, 20_000_000);
  if (JSON.stringify(result.term) !== JSON.stringify(expected)) {
    throw new Error(`${name} failed: ${JSON.stringify(result.term)}`);
  }
  console.log(`${name}: ${result.steps} contractions`);
}

const SUBSTITUTE_LIST_FACTORY_C = compiled(lambdas(
  ['substitute-node', 'patterns', 'bindings'],
  applyMany(
    app(
      Y_C,
      lambdas(
        ['recur', 'patterns'],
        applyMany(
          variable('patterns'),
          app(SOME_C, NIL_C),
          lambdas(
            ['head', 'tail'],
            applyMany(
              applyMany(variable('substitute-node'), variable('head'), variable('bindings')),
              NONE_C,
              lambda(
                'substituted-head',
                applyMany(
                  applyMany(variable('recur'), variable('tail')),
                  NONE_C,
                  lambda(
                    'substituted-tail',
                    app(
                      SOME_C,
                      applyMany(CONS_C, variable('substituted-head'), variable('substituted-tail')),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    variable('patterns'),
  ),
));

const SUBSTITUTE_C = compiled(app(
  Y_C,
  lambdas(
    ['recur', 'pattern', 'bindings'],
    applyMany(
      variable('pattern'),
      lambda('name', applyMany(LOOKUP_C, variable('name'), variable('bindings'))),
      lambda('payload', app(SOME_C, app(ATOM_C, variable('payload')))),
      lambda(
        'children',
        applyMany(
          applyMany(
            SUBSTITUTE_LIST_FACTORY_C,
            variable('recur'),
            variable('children'),
            variable('bindings'),
          ),
          NONE_C,
          lambda('result', app(SOME_C, app(LIST_C, variable('result')))),
        ),
      ),
    ),
  ),
));

const RULE_C = compiled(lambdas(
  ['pattern', 'replacement', 'consumer'],
  applyMany(variable('consumer'), variable('pattern'), variable('replacement')),
));
const APPLY_RULE_C = compiled(lambdas(
  ['rule', 'candidate'],
  app(
    variable('rule'),
    lambdas(
      ['pattern', 'replacement'],
      applyMany(
        applyMany(MATCH_C, variable('pattern'), variable('candidate'), NIL_C),
        NONE_C,
        lambda(
          'bindings',
          applyMany(SUBSTITUTE_C, variable('replacement'), variable('bindings')),
        ),
      ),
    ),
  ),
));
const SELECT_RULE_C = compiled(app(
  Y_C,
  lambdas(
    ['recur', 'rules', 'candidate'],
    applyMany(
      variable('rules'),
      NONE_C,
      lambdas(
        ['rule', 'remaining'],
        applyMany(
          applyMany(APPLY_RULE_C, variable('rule'), variable('candidate')),
          applyMany(variable('recur'), variable('remaining'), variable('candidate')),
          lambda('result', app(SOME_C, variable('result'))),
        ),
      ),
    ),
  ),
));

const encodeRule = (pattern, replacement) => applyMany(
  RULE_C,
  encodePattern(pattern),
  encodePattern(replacement),
);
const encodeRules = rules => rules.reduceRight(
  (tail, [pattern, replacement]) => applyMany(CONS_C, encodeRule(pattern, replacement), tail),
  NIL_C,
);

for (const [name, rules, candidate, expected, marker] of [
  [
    'select-and-substitute',
    [
      [['other', '?x'], ['wrong', '?x']],
      [['identity', '?x'], '?x'],
    ],
    ['identity', ['nested', 'value']],
    ['nested', 'value'],
    K,
  ],
  [
    'reject-conflicting-rule',
    [[['pair', '?x', '?x'], '?x']],
    ['pair', 'a', 'b'],
    null,
    S,
  ],
]) {
  const selected = applyMany(SELECT_RULE_C, encodeRules(rules), encodeNode(candidate));
  const predicate = expected === null
    ? applyMany(IS_SOME_C, selected)
    : applyMany(
      selected,
      FALSE_C,
      lambda('result', applyMany(EQ_NODE_C, variable('result'), encodeNode(expected))),
    );
  const observed = applyMany(predicate, K, S);
  const result = headNormalize(compile(observed), 100_000_000);
  if (JSON.stringify(result.term) !== JSON.stringify(marker)) {
    throw new Error(`${name} failed: ${JSON.stringify(result.term)}`);
  }
  console.log(`${name}: ${result.steps} contractions`);
}

const serializedSize = term => Array.isArray(term)
  ? 2 + serializedSize(term[0]) + serializedSize(term[1])
  : 1;
console.log(`select-rule compiled nodes: ${serializedSize(SELECT_RULE_C)}`);

const NAMED_RULE_C = compiled(lambdas(
  ['name', 'pattern', 'replacement', 'consumer'],
  applyMany(
    variable('consumer'),
    variable('name'),
    variable('pattern'),
    variable('replacement'),
  ),
));
const STEP_C = compiled(lambdas(
  ['term', 'name', 'consumer'],
  applyMany(variable('consumer'), variable('term'), variable('name')),
));
const SELECT_NAMED_RULE_C = compiled(app(
  Y_C,
  lambdas(
    ['recur', 'rules', 'candidate'],
    applyMany(
      variable('rules'),
      NONE_C,
      lambdas(
        ['rule', 'remaining'],
        app(
          variable('rule'),
          lambdas(
            ['name', 'pattern', 'replacement'],
            applyMany(
              applyMany(MATCH_C, variable('pattern'), variable('candidate'), NIL_C),
              applyMany(variable('recur'), variable('remaining'), variable('candidate')),
              lambda(
                'bindings',
                applyMany(
                  applyMany(SUBSTITUTE_C, variable('replacement'), variable('bindings')),
                  applyMany(variable('recur'), variable('remaining'), variable('candidate')),
                  lambda(
                    'result',
                    app(
                      SOME_C,
                      applyMany(STEP_C, variable('result'), variable('name')),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
));

const REWRITE_ONCE_C = compiled(app(
  Y_C,
  lambdas(
    ['rewrite-node', 'rules', 'candidate'],
    applyMany(
      applyMany(SELECT_NAMED_RULE_C, variable('rules'), variable('candidate')),
      applyMany(
        variable('candidate'),
        lambda('atom', NONE_C),
        lambda(
          'children',
          applyMany(
            applyMany(
              app(
                Y_C,
                lambdas(
                  ['rewrite-list', 'remaining'],
                  applyMany(
                    variable('remaining'),
                    NONE_C,
                    lambdas(
                      ['head', 'tail'],
                      applyMany(
                        applyMany(
                          variable('rewrite-node'),
                          variable('rules'),
                          variable('head'),
                        ),
                        applyMany(
                          variable('rewrite-list'),
                          variable('tail'),
                          NONE_C,
                          lambda(
                            'tail-step',
                            app(
                              variable('tail-step'),
                              lambdas(
                                ['rewritten-tail', 'rule-name'],
                                app(
                                  SOME_C,
                                  applyMany(
                                    STEP_C,
                                    applyMany(
                                      CONS_C,
                                      variable('head'),
                                      variable('rewritten-tail'),
                                    ),
                                    variable('rule-name'),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        lambda(
                          'head-step',
                          app(
                            variable('head-step'),
                            lambdas(
                              ['rewritten-head', 'rule-name'],
                              app(
                                SOME_C,
                                applyMany(
                                  STEP_C,
                                  applyMany(
                                    CONS_C,
                                    variable('rewritten-head'),
                                    variable('tail'),
                                  ),
                                  variable('rule-name'),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              variable('children'),
            ),
            NONE_C,
            lambda(
              'children-step',
              app(
                variable('children-step'),
                lambdas(
                  ['rewritten-children', 'rule-name'],
                  app(
                    SOME_C,
                    applyMany(
                      STEP_C,
                      app(LIST_C, variable('rewritten-children')),
                      variable('rule-name'),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      lambda('root-step', app(SOME_C, variable('root-step'))),
    ),
  ),
));

const encodeNamedRules = rules => rules.reduceRight(
  (tail, [name, pattern, replacement]) => applyMany(
    CONS_C,
    applyMany(
      NAMED_RULE_C,
      encodeBits(name),
      encodePattern(pattern),
      encodePattern(replacement),
    ),
    tail,
  ),
  NIL_C,
);

const nestedRules = encodeNamedRules([
  ['identity', ['identity', '?x'], '?x'],
]);
const nestedCandidate = encodeNode(['outer', ['identity', ['nested', 'value']]]);
const nestedExpected = encodeNode(['outer', ['nested', 'value']]);
const nestedStep = applyMany(REWRITE_ONCE_C, nestedRules, nestedCandidate);
const nestedPredicate = applyMany(
  nestedStep,
  FALSE_C,
  lambda(
    'step',
    app(
      variable('step'),
      lambdas(
        ['result', 'name'],
        applyMany(
          AND_C,
          applyMany(EQ_NODE_C, variable('result'), nestedExpected),
          applyMany(EQ_BITS_C, variable('name'), encodeBits('identity')),
        ),
      ),
    ),
  ),
  K,
  S,
);
const nestedResult = headNormalize(compile(nestedPredicate), 100_000_000);
if (JSON.stringify(nestedResult.term) !== JSON.stringify(K)) {
  throw new Error(`nested rewrite failed: ${JSON.stringify(nestedResult.term)}`);
}
console.log(`nested-rewrite: ${nestedResult.steps} contractions`);
console.log(`rewrite-once compiled nodes: ${serializedSize(REWRITE_ONCE_C)}`);
