/**
 * Fixed-point bootstrap for linked programs.
 *
 * The host contracts only the two local equations of the S/K binary-link
 * basis. Matching, repeated-variable binding, substitution, ordered rule
 * selection, and nested traversal are closed combinator terms. Input/output
 * conversion is deliberately kept outside the semantic basis.
 */

import KERNEL_ARTIFACT from './rml-combinator-kernel-data.mjs';

const S = 'S';
const K = 'K';
const app = (left, right) => [left, right];
const applyMany = (head, ...arguments_) => arguments_.reduce(app, head);

// Bracket abstraction is a generation tool, not part of semantic execution.
// Public operations below use only the parsed, checked-in closed-term DAG.
function buildSourceKernel() {
const variable = name => ({ variable: name });
const lambda = (name, body) => ({ lambda: name, body });
const lambdas = (names, body) => names.reduceRight(
  (nested, name) => lambda(name, nested),
  body,
);

function freeIn(name, term) {
  if (term?.variable !== undefined) return term.variable === name;
  if (term?.lambda !== undefined) {
    return term.lambda !== name && freeIn(name, term.body);
  }
  return Array.isArray(term) && (freeIn(name, term[0]) || freeIn(name, term[1]));
}

function abstract(name, term) {
  if (!freeIn(name, term)) return app(K, term);
  if (term?.variable === name) return app(app(S, K), K);
  if (!Array.isArray(term)) throw new Error(`cannot abstract free variable ${name}`);
  return app(app(S, abstract(name, term[0])), abstract(name, term[1]));
}

function compile(term) {
  if (term?.variable !== undefined) return term;
  if (term?.lambda !== undefined) return abstract(term.lambda, compile(term.body));
  if (Array.isArray(term)) return app(compile(term[0]), compile(term[1]));
  return term;
}

const compiled = compile;
const TRUE = compiled(lambdas(['yes', 'no'], variable('yes')));
const FALSE = compiled(lambdas(['yes', 'no'], variable('no')));
const NOT = compiled(lambda('value', applyMany(variable('value'), FALSE, TRUE)));
const AND = compiled(lambdas(
  ['left', 'right'],
  applyMany(variable('left'), variable('right'), FALSE),
));
const EQUAL_BOOLEAN = compiled(lambdas(
  ['left', 'right'],
  applyMany(variable('left'), variable('right'), app(NOT, variable('right'))),
));
const NIL = compiled(lambdas(['nil', 'cons'], variable('nil')));
const CONS = compiled(lambdas(
  ['head', 'tail', 'nil', 'cons'],
  applyMany(variable('cons'), variable('head'), variable('tail')),
));
const FIX = compiled(lambda(
  'function',
  app(
    lambda('self', app(variable('function'), app(variable('self'), variable('self')))),
    lambda('self', app(variable('function'), app(variable('self'), variable('self')))),
  ),
));
const NONE = compiled(lambdas(['none', 'some'], variable('none')));
const SOME = compiled(lambdas(
  ['value', 'none', 'some'],
  app(variable('some'), variable('value')),
));
const BINDING = compiled(lambdas(
  ['name', 'value', 'consumer'],
  applyMany(variable('consumer'), variable('name'), variable('value')),
));
const ATOM = compiled(lambdas(
  ['payload', 'atom', 'list'],
  app(variable('atom'), variable('payload')),
));
const LIST = compiled(lambdas(
  ['children', 'atom', 'list'],
  app(variable('list'), variable('children')),
));
const PATTERN_VARIABLE = compiled(lambdas(
  ['name', 'variable', 'atom', 'list'],
  app(variable('variable'), variable('name')),
));
const PATTERN_ATOM = compiled(lambdas(
  ['payload', 'variable', 'atom', 'list'],
  app(variable('atom'), variable('payload')),
));
const PATTERN_LIST = compiled(lambdas(
  ['children', 'variable', 'atom', 'list'],
  app(variable('list'), variable('children')),
));
const NAMED_RULE = compiled(lambdas(
  ['name', 'pattern', 'replacement', 'consumer'],
  applyMany(
    variable('consumer'),
    variable('name'),
    variable('pattern'),
    variable('replacement'),
  ),
));
const STEP = compiled(lambdas(
  ['term', 'name', 'consumer'],
  applyMany(variable('consumer'), variable('term'), variable('name')),
));
const REBINDING = compiled(lambdas(
  ['from', 'to', 'consumer'],
  applyMany(variable('consumer'), variable('from'), variable('to')),
));
const PROGRAM_IMPORT = compiled(lambdas(
  ['name', 'rebindings', 'consumer'],
  applyMany(variable('consumer'), variable('name'), variable('rebindings')),
));
const PROGRAM = compiled(lambdas(
  ['name', 'rules', 'facts', 'inferences', 'imports', 'consumer'],
  applyMany(
    variable('consumer'),
    variable('name'),
    variable('rules'),
    variable('facts'),
    variable('inferences'),
    variable('imports'),
  ),
));
const FACT = compiled(lambdas(
  ['name', 'judgement', 'consumer'],
  applyMany(variable('consumer'), variable('name'), variable('judgement')),
));
const INFERENCE = compiled(lambdas(
  ['name', 'premises', 'conclusion', 'consumer'],
  applyMany(
    variable('consumer'),
    variable('name'),
    variable('premises'),
    variable('conclusion'),
  ),
));
const PROOF = compiled(lambdas(
  ['name', 'judgement', 'premises', 'consumer'],
  applyMany(
    variable('consumer'),
    variable('name'),
    variable('judgement'),
    variable('premises'),
  ),
));
const KNOWN = compiled(lambdas(
  ['judgement', 'proof', 'consumer'],
  applyMany(variable('consumer'), variable('judgement'), variable('proof')),
));
const CANDIDATE = compiled(lambdas(
  ['bindings', 'proofs', 'consumer'],
  applyMany(variable('consumer'), variable('bindings'), variable('proofs')),
));
const DERIVATION = compiled(lambdas(
  ['judgement', 'proof', 'consumer'],
  applyMany(variable('consumer'), variable('judgement'), variable('proof')),
));
const INFERENCE_TRANSITION = compiled(lambdas(
  ['derivation', 'next-inferences', 'consumer'],
  applyMany(variable('consumer'), variable('derivation'), variable('next-inferences')),
));
const EQUAL_BITS = compiled(app(FIX, lambdas(
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
            applyMany(EQUAL_BOOLEAN, variable('left-head'), variable('right-head')),
            applyMany(variable('recur'), variable('left-tail'), variable('right-tail')),
          ),
        ),
      ),
    ),
  ),
)));

const EQUAL_NODE_LIST = compiled(lambdas(
  ['equal-node', 'left', 'right'],
  applyMany(
    app(FIX, lambdas(
      ['recur', 'left-list', 'right-list'],
      applyMany(
        variable('left-list'),
        applyMany(
          variable('right-list'),
          TRUE,
          lambdas(['head', 'tail'], FALSE),
        ),
        lambdas(
          ['left-head', 'left-tail'],
          applyMany(
            variable('right-list'),
            FALSE,
            lambdas(
              ['right-head', 'right-tail'],
              applyMany(
                AND,
                applyMany(
                  variable('equal-node'),
                  variable('left-head'),
                  variable('right-head'),
                ),
                applyMany(variable('recur'), variable('left-tail'), variable('right-tail')),
              ),
            ),
          ),
        ),
      ),
    )),
    variable('left'),
    variable('right'),
  ),
));

const EQUAL_NODE = compiled(app(FIX, lambdas(
  ['recur', 'left', 'right'],
  applyMany(
    variable('left'),
    lambda('left-atom', applyMany(
      variable('right'),
      lambda('right-atom', applyMany(
        EQUAL_BITS,
        variable('left-atom'),
        variable('right-atom'),
      )),
      lambda('right-list', FALSE),
    )),
    lambda('left-list', applyMany(
      variable('right'),
      lambda('right-atom', FALSE),
      lambda('right-list', applyMany(
        EQUAL_NODE_LIST,
        variable('recur'),
        variable('left-list'),
        variable('right-list'),
      )),
    )),
  ),
)));

const LOOKUP = compiled(app(FIX, lambdas(
  ['recur', 'name', 'bindings'],
  applyMany(
    variable('bindings'),
    NONE,
    lambdas(['binding', 'remaining'], app(
      variable('binding'),
      lambdas(['bound-name', 'bound-value'], applyMany(
        EQUAL_BITS,
        variable('name'),
        variable('bound-name'),
        app(SOME, variable('bound-value')),
        applyMany(variable('recur'), variable('name'), variable('remaining')),
      )),
    )),
  ),
)));

const APPEND = compiled(app(FIX, lambdas(
  ['recur', 'left', 'right'],
  applyMany(
    variable('left'),
    variable('right'),
    lambdas(['head', 'tail'], applyMany(
      CONS,
      variable('head'),
      applyMany(variable('recur'), variable('tail'), variable('right')),
    )),
  ),
)));

const FIND_REBINDING = compiled(app(FIX, lambdas(
  ['recur', 'name', 'rebindings'],
  applyMany(
    variable('rebindings'),
    NONE,
    lambdas(['rebinding', 'remaining'], app(
      variable('rebinding'),
      lambdas(['from', 'to'], applyMany(
        EQUAL_BITS,
        variable('name'),
        variable('from'),
        app(SOME, variable('to')),
        applyMany(variable('recur'), variable('name'), variable('remaining')),
      )),
    )),
  ),
)));

const REBIND_NAME = compiled(app(FIX, lambdas(
  ['recur', 'chains', 'name'],
  applyMany(
    variable('chains'),
    variable('name'),
    lambdas(['rebindings', 'remaining'], applyMany(
      applyMany(FIND_REBINDING, variable('name'), variable('rebindings')),
      applyMany(variable('recur'), variable('remaining'), variable('name')),
      lambda('replacement', applyMany(
        variable('recur'),
        variable('remaining'),
        variable('replacement'),
      )),
    )),
  ),
)));

const REBIND_PATTERN_LIST = compiled(lambdas(
  ['rebind-pattern', 'chains', 'patterns'],
  applyMany(
    app(FIX, lambdas(
      ['recur', 'patterns'],
      applyMany(
        variable('patterns'),
        NIL,
        lambdas(['head', 'tail'], applyMany(
          CONS,
          applyMany(variable('rebind-pattern'), variable('chains'), variable('head')),
          applyMany(variable('recur'), variable('tail')),
        )),
      ),
    )),
    variable('patterns'),
  ),
));

const REBIND_PATTERN = compiled(app(FIX, lambdas(
  ['recur', 'chains', 'pattern'],
  applyMany(
    variable('pattern'),
    lambda('name', app(PATTERN_VARIABLE, variable('name'))),
    lambda('name', app(PATTERN_ATOM, applyMany(
      REBIND_NAME,
      variable('chains'),
      variable('name'),
    ))),
    lambda('children', app(PATTERN_LIST, applyMany(
      REBIND_PATTERN_LIST,
      variable('recur'),
      variable('chains'),
      variable('children'),
    ))),
  ),
)));

const REBIND_NODE_LIST = compiled(lambdas(
  ['rebind-node', 'chains', 'nodes'],
  applyMany(
    app(FIX, lambdas(
      ['recur', 'nodes'],
      applyMany(
        variable('nodes'),
        NIL,
        lambdas(['head', 'tail'], applyMany(
          CONS,
          applyMany(variable('rebind-node'), variable('chains'), variable('head')),
          applyMany(variable('recur'), variable('tail')),
        )),
      ),
    )),
    variable('nodes'),
  ),
));

const REBIND_NODE = compiled(app(FIX, lambdas(
  ['recur', 'chains', 'node'],
  applyMany(
    variable('node'),
    lambda('name', app(ATOM, applyMany(
      REBIND_NAME,
      variable('chains'),
      variable('name'),
    ))),
    lambda('children', app(LIST, applyMany(
      REBIND_NODE_LIST,
      variable('recur'),
      variable('chains'),
      variable('children'),
    ))),
  ),
)));

const REBIND_RULES = compiled(lambdas(
  ['rules', 'chains'],
  applyMany(
    app(FIX, lambdas(
      ['recur', 'rules'],
      applyMany(
        variable('rules'),
        NIL,
        lambdas(['rule', 'remaining'], app(
          variable('rule'),
          lambdas(['name', 'pattern', 'replacement'], applyMany(
            CONS,
            applyMany(
              NAMED_RULE,
              variable('name'),
              applyMany(REBIND_PATTERN, variable('chains'), variable('pattern')),
              applyMany(REBIND_PATTERN, variable('chains'), variable('replacement')),
            ),
            applyMany(variable('recur'), variable('remaining')),
          )),
        )),
      ),
    )),
    variable('rules'),
  ),
));

const REBIND_FACTS = compiled(lambdas(
  ['facts', 'chains'],
  applyMany(
    app(FIX, lambdas(
      ['recur', 'facts'],
      applyMany(
        variable('facts'),
        NIL,
        lambdas(['fact', 'remaining'], app(
          variable('fact'),
          lambdas(['name', 'judgement'], applyMany(
            CONS,
            applyMany(
              FACT,
              variable('name'),
              applyMany(REBIND_NODE, variable('chains'), variable('judgement')),
            ),
            applyMany(variable('recur'), variable('remaining')),
          )),
        )),
      ),
    )),
    variable('facts'),
  ),
));

const REBIND_INFERENCES = compiled(lambdas(
  ['inferences', 'chains'],
  applyMany(
    app(FIX, lambdas(
      ['recur', 'inferences'],
      applyMany(
        variable('inferences'),
        NIL,
        lambdas(['inference', 'remaining'], app(
          variable('inference'),
          lambdas(['name', 'premises', 'conclusion'], applyMany(
            CONS,
            applyMany(
              INFERENCE,
              variable('name'),
              applyMany(
                REBIND_PATTERN_LIST,
                REBIND_PATTERN,
                variable('chains'),
                variable('premises'),
              ),
              applyMany(REBIND_PATTERN, variable('chains'), variable('conclusion')),
            ),
            applyMany(variable('recur'), variable('remaining')),
          )),
        )),
      ),
    )),
    variable('inferences'),
  ),
));

const LOOKUP_PROGRAM = compiled(app(FIX, lambdas(
  ['recur', 'name', 'programs'],
  applyMany(
    variable('programs'),
    NONE,
    lambdas(['program', 'remaining'], app(
      variable('program'),
      lambdas(['program-name', 'rules', 'facts', 'inferences', 'imports'], applyMany(
        EQUAL_BITS,
        variable('name'),
        variable('program-name'),
        app(SOME, variable('program')),
        applyMany(variable('recur'), variable('name'), variable('remaining')),
      )),
    )),
  ),
)));

const PROGRAM_REWRITES = compiled(lambda(
  'program',
  app(variable('program'), lambdas(
    ['name', 'rules', 'facts', 'inferences', 'imports'],
    variable('rules'),
  )),
));
const PROGRAM_FACTS = compiled(lambda(
  'program',
  app(variable('program'), lambdas(
    ['name', 'rules', 'facts', 'inferences', 'imports'],
    variable('facts'),
  )),
));
const PROGRAM_INFERENCES = compiled(lambda(
  'program',
  app(variable('program'), lambdas(
    ['name', 'rules', 'facts', 'inferences', 'imports'],
    variable('inferences'),
  )),
));
const PROGRAM_IMPORTS = compiled(lambda(
  'program',
  app(variable('program'), lambdas(
    ['name', 'rules', 'facts', 'inferences', 'imports'],
    variable('imports'),
  )),
));

const RESOLVE_ITEMS = compiled(app(FIX, lambdas(
  ['resolve', 'programs', 'name', 'chains', 'select', 'rebind'],
  applyMany(
    applyMany(LOOKUP_PROGRAM, variable('name'), variable('programs')),
    NONE,
    lambda('program', app(SOME, applyMany(
      APPEND,
      applyMany(
        variable('rebind'),
        app(variable('select'), variable('program')),
        variable('chains'),
      ),
      applyMany(
        app(FIX, lambdas(
          ['resolve-imports', 'imports'],
          applyMany(
            variable('imports'),
            NIL,
            lambdas(['dependency', 'remaining'], app(
              variable('dependency'),
              lambdas(['dependency-name', 'rebindings'], applyMany(
                applyMany(
                  variable('resolve'),
                  variable('programs'),
                  variable('dependency-name'),
                  applyMany(CONS, variable('rebindings'), variable('chains')),
                  variable('select'),
                  variable('rebind'),
                ),
                applyMany(variable('resolve-imports'), variable('remaining')),
                lambda('dependency-items', applyMany(
                  APPEND,
                  variable('dependency-items'),
                  applyMany(variable('resolve-imports'), variable('remaining')),
                )),
              )),
            )),
          ),
        )),
        app(PROGRAM_IMPORTS, variable('program')),
      ),
    ))),
  ),
)));

const RESOLVE_REWRITES = compiled(lambdas(
  ['programs', 'name', 'chains'],
  applyMany(
    RESOLVE_ITEMS,
    variable('programs'),
    variable('name'),
    variable('chains'),
    PROGRAM_REWRITES,
    REBIND_RULES,
  ),
));
const RESOLVE_FACTS = compiled(lambdas(
  ['programs', 'name', 'chains'],
  applyMany(
    RESOLVE_ITEMS,
    variable('programs'),
    variable('name'),
    variable('chains'),
    PROGRAM_FACTS,
    REBIND_FACTS,
  ),
));
const RESOLVE_INFERENCES = compiled(lambdas(
  ['programs', 'name', 'chains'],
  applyMany(
    RESOLVE_ITEMS,
    variable('programs'),
    variable('name'),
    variable('chains'),
    PROGRAM_INFERENCES,
    REBIND_INFERENCES,
  ),
));

const MATCH_LIST = compiled(lambdas(
  ['match-node', 'patterns', 'candidates', 'bindings'],
  applyMany(
    app(FIX, lambdas(
      ['recur', 'patterns', 'candidates', 'bindings'],
      applyMany(
        variable('patterns'),
        applyMany(
          variable('candidates'),
          app(SOME, variable('bindings')),
          lambdas(['head', 'tail'], NONE),
        ),
        lambdas(['pattern-head', 'pattern-tail'], applyMany(
          variable('candidates'),
          NONE,
          lambdas(['candidate-head', 'candidate-tail'], applyMany(
            applyMany(
              variable('match-node'),
              variable('pattern-head'),
              variable('candidate-head'),
              variable('bindings'),
            ),
            NONE,
            lambda('next-bindings', applyMany(
              variable('recur'),
              variable('pattern-tail'),
              variable('candidate-tail'),
              variable('next-bindings'),
            )),
          )),
        )),
      ),
    )),
    variable('patterns'),
    variable('candidates'),
    variable('bindings'),
  ),
));

const MATCH = compiled(app(FIX, lambdas(
  ['recur', 'pattern', 'candidate', 'bindings'],
  applyMany(
    variable('pattern'),
    lambda('name', applyMany(
      applyMany(LOOKUP, variable('name'), variable('bindings')),
      app(SOME, applyMany(
        CONS,
        applyMany(BINDING, variable('name'), variable('candidate')),
        variable('bindings'),
      )),
      lambda('previous', applyMany(
        EQUAL_NODE,
        variable('previous'),
        variable('candidate'),
        app(SOME, variable('bindings')),
        NONE,
      )),
    )),
    lambda('pattern-atom', applyMany(
      variable('candidate'),
      lambda('candidate-atom', applyMany(
        EQUAL_BITS,
        variable('pattern-atom'),
        variable('candidate-atom'),
        app(SOME, variable('bindings')),
        NONE,
      )),
      lambda('candidate-list', NONE),
    )),
    lambda('pattern-list', applyMany(
      variable('candidate'),
      lambda('candidate-atom', NONE),
      lambda('candidate-list', applyMany(
        MATCH_LIST,
        variable('recur'),
        variable('pattern-list'),
        variable('candidate-list'),
        variable('bindings'),
      )),
    )),
  ),
)));

const SUBSTITUTE_LIST = compiled(lambdas(
  ['substitute-node', 'patterns', 'bindings'],
  applyMany(
    app(FIX, lambdas(
      ['recur', 'patterns'],
      applyMany(
        variable('patterns'),
        app(SOME, NIL),
        lambdas(['head', 'tail'], applyMany(
          applyMany(variable('substitute-node'), variable('head'), variable('bindings')),
          NONE,
          lambda('substituted-head', applyMany(
            applyMany(variable('recur'), variable('tail')),
            NONE,
            lambda('substituted-tail', app(SOME, applyMany(
              CONS,
              variable('substituted-head'),
              variable('substituted-tail'),
            ))),
          )),
        )),
      ),
    )),
    variable('patterns'),
  ),
));

const SUBSTITUTE = compiled(app(FIX, lambdas(
  ['recur', 'pattern', 'bindings'],
  applyMany(
    variable('pattern'),
    lambda('name', applyMany(LOOKUP, variable('name'), variable('bindings'))),
    lambda('payload', app(SOME, app(ATOM, variable('payload')))),
    lambda('children', applyMany(
      applyMany(
        SUBSTITUTE_LIST,
        variable('recur'),
        variable('children'),
        variable('bindings'),
      ),
      NONE,
      lambda('result', app(SOME, app(LIST, variable('result')))),
    )),
  ),
)));

const SELECT_NAMED_RULE = compiled(app(FIX, lambdas(
  ['recur', 'rules', 'candidate'],
  applyMany(
    variable('rules'),
    NONE,
    lambdas(['rule', 'remaining'], app(
      variable('rule'),
      lambdas(['name', 'pattern', 'replacement'], applyMany(
        applyMany(MATCH, variable('pattern'), variable('candidate'), NIL),
        applyMany(variable('recur'), variable('remaining'), variable('candidate')),
        lambda('bindings', applyMany(
          applyMany(SUBSTITUTE, variable('replacement'), variable('bindings')),
          applyMany(variable('recur'), variable('remaining'), variable('candidate')),
          lambda('result', app(SOME, applyMany(
            STEP,
            variable('result'),
            variable('name'),
          ))),
        )),
      )),
    )),
  ),
)));

const REWRITE_ONCE = compiled(app(FIX, lambdas(
  ['rewrite-node', 'rules', 'candidate'],
  applyMany(
    applyMany(SELECT_NAMED_RULE, variable('rules'), variable('candidate')),
    applyMany(
      variable('candidate'),
      lambda('atom', NONE),
      lambda('children', applyMany(
        applyMany(
          app(FIX, lambdas(
            ['rewrite-list', 'remaining'],
            applyMany(
              variable('remaining'),
              NONE,
              lambdas(['head', 'tail'], applyMany(
                applyMany(
                  variable('rewrite-node'),
                  variable('rules'),
                  variable('head'),
                ),
                applyMany(
                  applyMany(variable('rewrite-list'), variable('tail')),
                  NONE,
                  lambda('tail-step', app(
                    variable('tail-step'),
                    lambdas(['rewritten-tail', 'rule-name'], app(SOME, applyMany(
                      STEP,
                      applyMany(CONS, variable('head'), variable('rewritten-tail')),
                      variable('rule-name'),
                    ))),
                  )),
                ),
                lambda('head-step', app(
                  variable('head-step'),
                  lambdas(['rewritten-head', 'rule-name'], app(SOME, applyMany(
                    STEP,
                    applyMany(CONS, variable('rewritten-head'), variable('tail')),
                    variable('rule-name'),
                  ))),
                )),
              )),
            ),
          )),
          variable('children'),
        ),
        NONE,
        lambda('children-step', app(
          variable('children-step'),
          lambdas(['rewritten-children', 'rule-name'], app(SOME, applyMany(
            STEP,
            app(LIST, variable('rewritten-children')),
            variable('rule-name'),
          ))),
        )),
      )),
    ),
    lambda('root-step', app(SOME, variable('root-step'))),
  ),
)));

const REVERSE = compiled(app(FIX, lambdas(
  ['recur', 'items', 'reversed'],
  applyMany(
    variable('items'),
    variable('reversed'),
    lambdas(['head', 'tail'], applyMany(
      variable('recur'),
      variable('tail'),
      applyMany(CONS, variable('head'), variable('reversed')),
    )),
  ),
)));

const CONTAINS_KNOWN = compiled(app(FIX, lambdas(
  ['recur', 'judgement', 'known'],
  applyMany(
    variable('known'),
    FALSE,
    lambdas(['entry', 'remaining'], app(
      variable('entry'),
      lambdas(['known-judgement', 'proof'], applyMany(
        EQUAL_NODE,
        variable('judgement'),
        variable('known-judgement'),
        TRUE,
        applyMany(variable('recur'), variable('judgement'), variable('remaining')),
      )),
    )),
  ),
)));

const MATCH_KNOWN = compiled(app(FIX, lambdas(
  ['recur', 'premise', 'known', 'bindings', 'proofs'],
  applyMany(
    variable('known'),
    NIL,
    lambdas(['entry', 'remaining'], app(
      variable('entry'),
      lambdas(['judgement', 'proof'], applyMany(
        applyMany(
          MATCH,
          variable('premise'),
          variable('judgement'),
          variable('bindings'),
        ),
        applyMany(
          variable('recur'),
          variable('premise'),
          variable('remaining'),
          variable('bindings'),
          variable('proofs'),
        ),
        lambda('next-bindings', applyMany(
          CONS,
          applyMany(
            CANDIDATE,
            variable('next-bindings'),
            applyMany(CONS, variable('proof'), variable('proofs')),
          ),
          applyMany(
            variable('recur'),
            variable('premise'),
            variable('remaining'),
            variable('bindings'),
            variable('proofs'),
          ),
        )),
      )),
    )),
  ),
)));

const EXPAND_CANDIDATES = compiled(app(FIX, lambdas(
  ['recur', 'premise', 'known', 'candidates'],
  applyMany(
    variable('candidates'),
    NIL,
    lambdas(['candidate', 'remaining'], app(
      variable('candidate'),
      lambdas(['bindings', 'proofs'], applyMany(
        APPEND,
        applyMany(
          MATCH_KNOWN,
          variable('premise'),
          variable('known'),
          variable('bindings'),
          variable('proofs'),
        ),
        applyMany(
          variable('recur'),
          variable('premise'),
          variable('known'),
          variable('remaining'),
        ),
      )),
    )),
  ),
)));

const MATCH_PREMISES = compiled(app(FIX, lambdas(
  ['recur', 'premises', 'known', 'candidates'],
  applyMany(
    variable('premises'),
    variable('candidates'),
    lambdas(['premise', 'remaining'], applyMany(
      variable('recur'),
      variable('remaining'),
      variable('known'),
      applyMany(
        EXPAND_CANDIDATES,
        variable('premise'),
        variable('known'),
        variable('candidates'),
      ),
    )),
  ),
)));

const NORMALIZE = compiled(app(FIX, lambdas(
  ['recur', 'rules', 'candidate'],
  applyMany(
    applyMany(REWRITE_ONCE, variable('rules'), variable('candidate')),
    variable('candidate'),
    lambda('step', app(
      variable('step'),
      lambdas(['rewritten', 'rule-name'], applyMany(
        variable('recur'),
        variable('rules'),
        variable('rewritten'),
      )),
    )),
  ),
)));

const FIRST_NOVEL_CANDIDATE = compiled(app(FIX, lambdas(
  ['recur', 'candidates', 'rule-name', 'conclusion', 'known', 'rewrite-rules'],
  applyMany(
    variable('candidates'),
    NONE,
    lambdas(['candidate', 'remaining'], app(
      variable('candidate'),
      lambdas(['bindings', 'proofs'], applyMany(
        applyMany(SUBSTITUTE, variable('conclusion'), variable('bindings')),
        applyMany(
          variable('recur'),
          variable('remaining'),
          variable('rule-name'),
          variable('conclusion'),
          variable('known'),
          variable('rewrite-rules'),
        ),
        lambda('raw-judgement', app(
          lambda('judgement', applyMany(
            CONTAINS_KNOWN,
            variable('judgement'),
            variable('known'),
            applyMany(
              variable('recur'),
              variable('remaining'),
              variable('rule-name'),
              variable('conclusion'),
              variable('known'),
              variable('rewrite-rules'),
            ),
            app(SOME, applyMany(
              DERIVATION,
              variable('judgement'),
              applyMany(
                PROOF,
                variable('rule-name'),
                variable('raw-judgement'),
                applyMany(REVERSE, variable('proofs'), NIL),
              ),
            )),
          )),
          applyMany(
            NORMALIZE,
            variable('rewrite-rules'),
            variable('raw-judgement'),
          ),
        )),
      )),
    )),
  ),
)));

const INFER_SCAN = compiled(app(FIX, lambdas(
  ['recur', 'inferences', 'skipped', 'known', 'rewrite-rules'],
  applyMany(
    variable('inferences'),
    NONE,
    lambdas(['inference', 'remaining'], app(
      variable('inference'),
      lambdas(['rule-name', 'premises', 'conclusion'], applyMany(
        applyMany(
          FIRST_NOVEL_CANDIDATE,
          applyMany(
            MATCH_PREMISES,
            variable('premises'),
            variable('known'),
            applyMany(CONS, applyMany(CANDIDATE, NIL, NIL), NIL),
          ),
          variable('rule-name'),
          variable('conclusion'),
          variable('known'),
          variable('rewrite-rules'),
        ),
        applyMany(
          variable('recur'),
          variable('remaining'),
          applyMany(
            APPEND,
            variable('skipped'),
            applyMany(CONS, variable('inference'), NIL),
          ),
          variable('known'),
          variable('rewrite-rules'),
        ),
        lambda('derivation', app(SOME, applyMany(
          INFERENCE_TRANSITION,
          variable('derivation'),
          applyMany(
            APPEND,
            variable('remaining'),
            applyMany(
              APPEND,
              variable('skipped'),
              applyMany(CONS, variable('inference'), NIL),
            ),
          ),
        ))),
      )),
    )),
  ),
)));

const INFER_ONCE = compiled(lambdas(
  ['inferences', 'known', 'rewrite-rules'],
  applyMany(
    INFER_SCAN,
    variable('inferences'),
    NIL,
    variable('known'),
    variable('rewrite-rules'),
  ),
));

const ADD_FACTS = compiled(app(FIX, lambdas(
  ['recur', 'facts', 'known', 'rewrite-rules'],
  applyMany(
    variable('facts'),
    variable('known'),
    lambdas(['fact', 'remaining'], app(
      variable('fact'),
      lambdas(['fact-name', 'raw-judgement'], app(
        lambda('judgement', applyMany(
          CONTAINS_KNOWN,
          variable('judgement'),
          variable('known'),
          applyMany(
            variable('recur'),
            variable('remaining'),
            variable('known'),
            variable('rewrite-rules'),
          ),
          applyMany(
            variable('recur'),
            variable('remaining'),
            applyMany(
              APPEND,
              variable('known'),
              applyMany(CONS, applyMany(
                KNOWN,
                variable('judgement'),
                applyMany(PROOF, variable('fact-name'), variable('raw-judgement'), NIL),
              ), NIL),
            ),
            variable('rewrite-rules'),
          ),
        )),
        applyMany(
          NORMALIZE,
          variable('rewrite-rules'),
          variable('raw-judgement'),
        ),
      )),
    )),
  ),
)));

const FIND_KNOWN_PROOF = compiled(app(FIX, lambdas(
  ['recur', 'judgement', 'known'],
  applyMany(
    variable('known'),
    NONE,
    lambdas(['entry', 'remaining'], app(
      variable('entry'),
      lambdas(['known-judgement', 'proof'], applyMany(
        EQUAL_NODE,
        variable('judgement'),
        variable('known-judgement'),
        app(SOME, variable('proof')),
        applyMany(variable('recur'), variable('judgement'), variable('remaining')),
      )),
    )),
  ),
)));

  return {
    TRUE,
    FALSE,
    NIL,
    CONS,
    ATOM,
    LIST,
    PATTERN_VARIABLE,
    PATTERN_ATOM,
    PATTERN_LIST,
    NAMED_RULE,
    FACT,
    INFERENCE,
    REBINDING,
    PROGRAM_IMPORT,
    PROGRAM,
    PROOF,
    KNOWN,
    APPEND,
    RESOLVE_REWRITES,
    RESOLVE_FACTS,
    RESOLVE_INFERENCES,
    REWRITE_ONCE,
    ADD_FACTS,
    INFER_ONCE,
    FIND_KNOWN_PROOF,
  };
}

function parseCombinatorKernel(serialized) {
  const lines = serialized.split('\n');
  if (lines.shift() !== 'rml-ski-dag-v1') {
    throw new Error('invalid fixed-point kernel header');
  }
  const counts = lines.shift()?.split('\t').map(Number);
  if (counts?.length !== 2 || counts.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('invalid fixed-point kernel counts');
  }
  const [nodeCount, rootCount] = counts;
  const nodes = [];
  const reference = value => {
    if (value === S || value === K) return value;
    if (!/^n\d+$/.test(value)) throw new Error(`invalid fixed-point reference ${value}`);
    const index = Number(value.slice(1));
    if (index >= nodes.length) throw new Error(`unknown fixed-point node ${value}`);
    return nodes[index];
  };
  for (let expected = 0; expected < nodeCount; expected += 1) {
    const fields = lines.shift()?.split('\t');
    if (fields?.length !== 3 || Number(fields[0]) !== expected) {
      throw new Error(`invalid fixed-point node ${expected}`);
    }
    nodes.push(app(reference(fields[1]), reference(fields[2])));
  }
  const roots = {};
  for (let index = 0; index < rootCount; index += 1) {
    const fields = lines.shift()?.split('\t');
    if (fields?.length !== 2 || Object.hasOwn(roots, fields[0])) {
      throw new Error('invalid fixed-point root');
    }
    roots[fields[0]] = reference(fields[1]);
  }
  if (lines.some(line => line.length > 0)) {
    throw new Error('unexpected fixed-point kernel content');
  }
  return roots;
}

const {
  TRUE,
  FALSE,
  NIL,
  CONS,
  ATOM,
  LIST,
  PATTERN_VARIABLE,
  PATTERN_ATOM,
  PATTERN_LIST,
  NAMED_RULE,
  FACT,
  INFERENCE,
  REBINDING,
  PROGRAM_IMPORT,
  PROGRAM,
  PROOF,
  KNOWN,
  APPEND,
  RESOLVE_REWRITES,
  RESOLVE_FACTS,
  RESOLVE_INFERENCES,
  REWRITE_ONCE,
  ADD_FACTS,
  INFER_ONCE,
  FIND_KNOWN_PROOF,
} = parseCombinatorKernel(KERNEL_ARTIFACT);

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function encodeBits(value) {
  return [...encoder.encode(value)]
    .flatMap(byte => Array.from(
      { length: 8 },
      (_, index) => (byte & (128 >> index)) !== 0,
    ))
    .reduceRight(
      (tail, bit) => applyMany(CONS, bit ? TRUE : FALSE, tail),
      NIL,
    );
}

function encodeNode(term) {
  if (!Array.isArray(term)) return app(ATOM, encodeBits(String(term)));
  return app(LIST, term.reduceRight(
    (tail, child) => applyMany(CONS, encodeNode(child), tail),
    NIL,
  ));
}

function encodePattern(term) {
  if (!Array.isArray(term)) {
    const value = String(term);
    return value.startsWith('?') && value.length > 1
      ? app(PATTERN_VARIABLE, encodeBits(value.slice(1)))
      : app(PATTERN_ATOM, encodeBits(value));
  }
  return app(PATTERN_LIST, term.reduceRight(
    (tail, child) => applyMany(CONS, encodePattern(child), tail),
    NIL,
  ));
}

function encodeRules(rules) {
  return rules.reduceRight(
    (tail, rule) => applyMany(
      CONS,
      applyMany(
        NAMED_RULE,
        encodeBits(`${rule.program}\0${rule.name}`),
        encodePattern(rule.pattern),
        encodePattern(rule.replacement),
      ),
      tail,
    ),
    NIL,
  );
}

function encodeFacts(facts) {
  return facts.reduceRight(
    (tail, fact) => applyMany(
      CONS,
      applyMany(
        FACT,
        encodeBits(`${fact.program}\0${fact.name}`),
        encodeNode(fact.judgement),
      ),
      tail,
    ),
    NIL,
  );
}

function encodeInputFacts(facts) {
  return encodeFacts(facts.map((judgement, index) => ({
    program: '<input>',
    name: `input-${index + 1}`,
    judgement,
  })));
}

function encodeInferences(inferences) {
  return inferences.reduceRight(
    (tail, inference) => applyMany(
      CONS,
      applyMany(
        INFERENCE,
        encodeBits(`${inference.program}\0${inference.name}`),
        inference.premises.reduceRight(
          (premiseTail, premise) => applyMany(
            CONS,
            encodePattern(premise),
            premiseTail,
          ),
          NIL,
        ),
        encodePattern(inference.conclusion),
      ),
      tail,
    ),
    NIL,
  );
}

function encodeRebindings(rebindings) {
  return [...rebindings.entries()].reduceRight(
    (tail, [from, to]) => applyMany(
      CONS,
      applyMany(REBINDING, encodeBits(from), encodeBits(to)),
      tail,
    ),
    NIL,
  );
}

function encodeImports(imports) {
  return imports.reduceRight(
    (tail, dependency) => applyMany(
      CONS,
      applyMany(
        PROGRAM_IMPORT,
        encodeBits(dependency.program),
        encodeRebindings(dependency.rebindings),
      ),
      tail,
    ),
    NIL,
  );
}

function encodeProgram(program) {
  return applyMany(
    PROGRAM,
    encodeBits(program.name),
    encodeRules(program.rewrites),
    encodeFacts(program.facts),
    encodeInferences(program.inferences),
    encodeImports(program.uses),
  );
}

function encodePrograms(programs) {
  const values = programs instanceof Map ? [...programs.values()] : [...programs];
  return values.reduceRight(
    (tail, program) => applyMany(CONS, encodeProgram(program), tail),
    NIL,
  );
}

class CombinatorRunner {
  constructor({ disabledOperations = [], maxContractions = 100_000_000 } = {}) {
    this.disabledOperations = new Set(disabledOperations);
    this.maxContractions = maxContractions;
    this.contractions = 0;
    this.observedOperations = new Set();
  }

  #observe(operation) {
    if (this.disabledOperations.has(operation)) {
      throw new Error(`disabled host semantic operation ${operation}`);
    }
    this.observedOperations.add(operation);
    this.contractions += 1;
    if (this.contractions > this.maxContractions) {
      throw new Error(`combinator contraction limit ${this.maxContractions} exceeded`);
    }
  }

  headNormalize(term) {
    let current = term;
    const arguments_ = [];
    while (true) {
      while (Array.isArray(current)) {
        arguments_.push(current[1]);
        current = current[0];
      }
      if (current === K && arguments_.length >= 2) {
        this.#observe('contract-k-link');
        current = arguments_.pop();
        arguments_.pop();
        continue;
      }
      if (current === S && arguments_.length >= 3) {
        this.#observe('contract-s-link');
        const left = arguments_.pop();
        const right = arguments_.pop();
        const argument = arguments_.pop();
        current = app(app(left, argument), app(right, argument));
        continue;
      }
      while (arguments_.length > 0) current = app(current, arguments_.pop());
      return current;
    }
  }

  decodeBoolean(term) {
    const observed = this.headNormalize(applyMany(term, 'decoded-true', 'decoded-false'));
    if (observed === 'decoded-true') return true;
    if (observed === 'decoded-false') return false;
    throw new Error('combinator output is not a boolean');
  }

  decodeBits(term) {
    const bits = [];
    let current = term;
    while (true) {
      const observed = this.headNormalize(applyMany(
        current,
        'decoded-nil',
        'decoded-cons',
      ));
      if (observed === 'decoded-nil') break;
      if (!Array.isArray(observed) ||
          !Array.isArray(observed[0]) ||
          observed[0][0] !== 'decoded-cons') {
        throw new Error('combinator output is not a bit list');
      }
      bits.push(this.decodeBoolean(observed[0][1]));
      current = observed[1];
    }
    if (bits.length % 8 !== 0) throw new Error('combinator atom is not byte-aligned');
    const bytes = new Uint8Array(bits.length / 8);
    for (let byte = 0; byte < bytes.length; byte += 1) {
      for (let bit = 0; bit < 8; bit += 1) {
        if (bits[byte * 8 + bit]) bytes[byte] |= 128 >> bit;
      }
    }
    return decoder.decode(bytes);
  }

  decodeList(term) {
    const output = [];
    let current = term;
    while (true) {
      const observed = this.headNormalize(applyMany(
        current,
        'decoded-nil',
        'decoded-cons',
      ));
      if (observed === 'decoded-nil') return output;
      if (!Array.isArray(observed) ||
          !Array.isArray(observed[0]) ||
          observed[0][0] !== 'decoded-cons') {
        throw new Error('combinator output is not a list');
      }
      output.push(this.decodeNode(observed[0][1]));
      current = observed[1];
    }
  }

  materializeList(term) {
    const output = [];
    let current = term;
    while (true) {
      const observed = this.headNormalize(applyMany(
        current,
        'decoded-nil',
        'decoded-cons',
      ));
      if (observed === 'decoded-nil') return output;
      if (!Array.isArray(observed) ||
          !Array.isArray(observed[0]) ||
          observed[0][0] !== 'decoded-cons') {
        throw new Error('combinator output is not a list');
      }
      output.push(observed[0][1]);
      current = observed[1];
    }
  }

  decodeNode(term) {
    const observed = this.headNormalize(applyMany(
      term,
      'decoded-atom',
      'decoded-list',
    ));
    if (!Array.isArray(observed)) throw new Error('combinator output is not a node');
    if (observed[0] === 'decoded-atom') return this.decodeBits(observed[1]);
    if (observed[0] === 'decoded-list') return this.decodeList(observed[1]);
    throw new Error('combinator output has an unknown node constructor');
  }

  decodeStep(option) {
    const observed = this.headNormalize(applyMany(
      option,
      'decoded-none',
      'decoded-some',
    ));
    if (observed === 'decoded-none') return null;
    if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
      throw new Error('combinator output is not an optional rewrite step');
    }
    const step = this.headNormalize(applyMany(
      observed[1],
      'decoded-step',
    ));
    if (!Array.isArray(step) ||
        !Array.isArray(step[0]) ||
        step[0][0] !== 'decoded-step') {
      throw new Error('combinator output is not a rewrite step');
    }
    const [program, name] = this.decodeBits(step[1]).split('\0');
    return {
      term: this.decodeNode(step[0][1]),
      rule: { program, name },
    };
  }

  decodeProof(term) {
    const observed = this.headNormalize(app(term, 'decoded-proof'));
    if (!Array.isArray(observed) ||
        !Array.isArray(observed[0]) ||
        !Array.isArray(observed[0][0]) ||
        observed[0][0][0] !== 'decoded-proof') {
      throw new Error('combinator output is not a proof');
    }
    const [program, rule] = this.decodeBits(observed[0][0][1]).split('\0');
    return {
      judgement: this.decodeNode(observed[0][1]),
      program,
      rule,
      premises: this.materializeList(observed[1])
        .map(premise => this.decodeProof(premise)),
    };
  }

  decodeOptionalProof(option) {
    const observed = this.headNormalize(applyMany(
      option,
      'decoded-none',
      'decoded-some',
    ));
    if (observed === 'decoded-none') return null;
    if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
      throw new Error('combinator output is not an optional proof');
    }
    return this.decodeProof(observed[1]);
  }

  decodeDerivation(option) {
    const observed = this.headNormalize(applyMany(
      option,
      'decoded-none',
      'decoded-some',
    ));
    if (observed === 'decoded-none') return null;
    if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
      throw new Error('combinator output is not an optional derivation');
    }
    const transition = this.headNormalize(app(observed[1], 'decoded-transition'));
    if (!Array.isArray(transition) ||
        !Array.isArray(transition[0]) ||
        transition[0][0] !== 'decoded-transition') {
      throw new Error('combinator output is not an inference transition');
    }
    const derivation = this.headNormalize(app(
      transition[0][1],
      'decoded-derivation',
    ));
    if (!Array.isArray(derivation) ||
        !Array.isArray(derivation[0]) ||
        derivation[0][0] !== 'decoded-derivation') {
      throw new Error('combinator output is not a derivation');
    }
    return {
      encodedJudgement: derivation[0][1],
      encodedProof: derivation[1],
      encodedInferences: transition[1],
      judgement: this.decodeNode(derivation[0][1]),
      proof: this.decodeProof(derivation[1]),
    };
  }
}

/** Execute one ordered, leftmost linked rewrite above the S/K residual basis. */
function combinatorRewriteOnce(term, rules, options = {}) {
  const runner = new CombinatorRunner(options);
  const encodedRules = rules?.encodedRules ?? encodeRules(rules);
  const output = applyMany(REWRITE_ONCE, encodedRules, encodeNode(term));
  return {
    step: runner.decodeStep(output),
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: [
      'matching',
      'substitution',
      'rule-selection-and-traversal',
    ],
  };
}

function encodedList(items) {
  return items.reduceRight(
    (tail, item) => applyMany(CONS, item, tail),
    NIL,
  );
}

function unwrapOptionalItems(runner, option, context) {
  const observed = runner.headNormalize(applyMany(
    option,
    'decoded-none',
    'decoded-some',
  ));
  if (observed === 'decoded-none') {
    throw new Error(`combinator import resolver cannot find linked-program ${context}`);
  }
  if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
    throw new Error('combinator import resolver returned an invalid result');
  }
  return encodedList(runner.materializeList(observed[1]));
}

/** Resolve ordered imports and rebinding chains above the S/K residual basis. */
function combinatorResolveRewrites(programs, name, options = {}) {
  const runner = new CombinatorRunner(options);
  const output = applyMany(
    RESOLVE_REWRITES,
    encodePrograms(programs),
    encodeBits(name),
    NIL,
  );
  return {
    encodedRules: unwrapOptionalItems(runner, output, name),
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: ['import-and-rebinding'],
  };
}

/** Build normalized declared/input facts and resolved rules for linked inference. */
function combinatorCreateProofState(programs, name, inputFacts = [], options = {}) {
  const runner = new CombinatorRunner(options);
  const encodedPrograms = encodePrograms(programs);
  const resolve = operation => unwrapOptionalItems(
    runner,
    applyMany(operation, encodedPrograms, encodeBits(name), NIL),
    name,
  );
  const encodedRules = resolve(RESOLVE_REWRITES);
  const encodedFacts = resolve(RESOLVE_FACTS);
  const encodedInferences = resolve(RESOLVE_INFERENCES);
  const declaredKnown = applyMany(ADD_FACTS, encodedFacts, NIL, encodedRules);
  const allKnown = applyMany(
    ADD_FACTS,
    encodeInputFacts(inputFacts),
    declaredKnown,
    encodedRules,
  );
  const knownItems = runner.materializeList(allKnown);
  return {
    name,
    encodedRules,
    encodedInferences,
    encodedKnown: encodedList(knownItems),
    size: knownItems.length,
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: [
      'import-and-rebinding',
      'matching',
      'substitution',
      'rule-selection-and-traversal',
    ],
  };
}

/** Execute one complete linked inference transition, or report fixed point. */
function combinatorInferOnce(state, options = {}) {
  const runner = new CombinatorRunner(options);
  const output = applyMany(
    INFER_ONCE,
    state.encodedInferences,
    state.encodedKnown,
    state.encodedRules,
  );
  const derivation = runner.decodeDerivation(output);
  const result = {
    derivation: derivation === null ? null : {
      judgement: derivation.judgement,
      proof: derivation.proof,
    },
    state,
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: [
      'matching',
      'substitution',
      'rule-selection-and-traversal',
      'inference-saturation',
    ],
  };
  if (derivation !== null) {
    result.state = {
      ...state,
      encodedInferences: derivation.encodedInferences,
      encodedKnown: applyMany(
        APPEND,
        state.encodedKnown,
        applyMany(CONS, applyMany(
          KNOWN,
          derivation.encodedJudgement,
          derivation.encodedProof,
        ), NIL),
      ),
      size: state.size + 1,
    };
  }
  return result;
}

/** Find an exact normalized judgement in a linked proof state. */
function combinatorFindProof(state, judgement, options = {}) {
  const runner = new CombinatorRunner(options);
  const proof = runner.decodeOptionalProof(applyMany(
    FIND_KNOWN_PROOF,
    encodeNode(judgement),
    state.encodedKnown,
  ));
  return {
    proof,
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: ['result-verification'],
  };
}

/** Serialize the closed kernel as a shared application DAG for mirrored runtimes. */
function serializeCombinatorKernel() {
  const roots = buildSourceKernel();
  const ids = new WeakMap();
  const nodes = [];
  const reference = term => {
    if (term === S || term === K) return term;
    if (!Array.isArray(term)) throw new Error('serialized combinator is not closed');
    const known = ids.get(term);
    if (known !== undefined) return `n${known}`;
    const left = reference(term[0]);
    const right = reference(term[1]);
    const id = nodes.length;
    ids.set(term, id);
    nodes.push(`${id}\t${left}\t${right}`);
    return `n${id}`;
  };
  const rootLines = Object.entries(roots)
    .map(([name, term]) => `${name}\t${reference(term)}`);
  return [
    'rml-ski-dag-v1',
    `${nodes.length}\t${rootLines.length}`,
    ...nodes,
    ...rootLines,
    '',
  ].join('\n');
}

export {
  CombinatorRunner,
  combinatorCreateProofState,
  combinatorFindProof,
  combinatorInferOnce,
  combinatorResolveRewrites,
  combinatorRewriteOnce,
  serializeCombinatorKernel,
};
