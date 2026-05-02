// rml-check — independent proof-replay checker (issue #36).
//
// Verifies that a derivation produced by the proof-producing evaluator
// (issue #35) replays under the kernel alone — never calls evaluate().
// Each `(by <rule> <sub>...)` node is matched against the kernel's
// structural shape for its expression: rule name, arity, and that
// sub-derivations recurse onto matching sub-expressions. Mutating any of
// those rejects.
//
// Mirrors rust/src/check.rs so any drift between the two implementations
// fails both test suites.

import {
  parseLino,
  parseOne,
  tokenizeOne,
  keyOf,
  isStructurallySame,
} from './rml-links.mjs';

const isNum = s => typeof s === 'string' && /^-?(\d+(\.\d+)?|\.\d+)$/.test(s);

// Built-in operator names plus user-declared `(name: ...)` heads. Used to
// validate the prefix-operator fallback rule. Mirrors the names recognised
// by `Env` so the checker can validate proofs without an env.
function collectOperators(forms) {
  const ops = new Set(['not', 'and', 'or', '=', '!=', '+', '-', '*', '/']);
  for (const f of forms) {
    if (Array.isArray(f) && typeof f[0] === 'string' && f[0].endsWith(':')) {
      const name = f[0].slice(0, -1);
      if (name) ops.add(name);
    }
  }
  return ops;
}

// Equality keys (both prefix and infix shapes) that the program assigned a
// probability to. Used by `expectedRule` to know whether `assigned-*`
// rules are admissible at a given equality node.
function collectAssignments(forms) {
  const out = new Set();
  for (const f of forms) {
    if (
      Array.isArray(f) &&
      f.length === 4 &&
      f[1] === 'has' &&
      f[2] === 'probability' &&
      isNum(f[3])
    ) {
      const inner = f[0];
      out.add(keyOf(inner));
      if (Array.isArray(inner) && inner.length === 3 && inner[1] === '=') {
        out.add(keyOf(['=', inner[0], inner[2]]));
      }
    }
  }
  return out;
}

// Parse a `.lino` source into top-level forms via the kernel parser.
function parseForms(src) {
  const out = [];
  for (const s of parseLino(src)) {
    if (s.trimStart().startsWith('(#')) continue;
    try {
      out.push(parseOne(tokenizeOne(s)));
    } catch (_) {
      // Skip unparseable forms. The checker reports a count mismatch
      // downstream if this hides a real query.
    }
  }
  return out;
}

// Strip `(? expr)` wrappers and the optional `with proof` keyword pair.
function queryTarget(n) {
  if (!Array.isArray(n) || n[0] !== '?') return null;
  let parts = n.slice(1);
  if (
    parts.length >= 2 &&
    parts[parts.length - 2] === 'with' &&
    parts[parts.length - 1] === 'proof'
  ) {
    parts = parts.slice(0, -2);
  }
  return parts.length === 1 ? parts[0] : parts;
}

// Decompose `(by <rule> <sub>...)` or fail with a descriptive error.
function decode(p, path) {
  if (
    Array.isArray(p) &&
    p.length >= 2 &&
    p[0] === 'by' &&
    typeof p[1] === 'string'
  ) {
    return { rule: p[1], subs: p.slice(2) };
  }
  throw {
    path: [...path],
    message: `expected \`(by <rule> ...)\`, got \`${keyOf(p)}\``,
  };
}

// The single rule the kernel would emit for `expr`. Equality is the only
// shape with multiple admissible rules (assigned/structural/numeric); we
// pick the unique one matching the program facts.
function expectedRule(expr, ops, assigned) {
  if (typeof expr === 'string') return isNum(expr) ? 'literal' : 'symbol';
  if (!Array.isArray(expr)) return 'reduce';

  const head = expr[0];
  if (typeof head === 'string' && head.endsWith(':')) return 'definition';
  if (head === 'Type' && expr.length === 2) return 'type-universe';
  if (head === 'Prop' && expr.length === 1) return 'prop';
  if (head === 'Pi' && expr.length === 3) return 'pi-formation';
  if (head === 'lambda' && expr.length === 3) return 'lambda-formation';
  if (head === 'apply' && expr.length === 3) return 'beta-reduction';
  if (head === 'subst' && expr.length === 4) return 'substitution';
  if (head === 'fresh' && expr.length === 4 && expr[2] === 'in') return 'fresh';
  if (head === 'type' && expr.length === 3 && expr[1] === 'of') {
    return 'type-query';
  }

  // ((expr) has probability p)
  if (
    expr.length === 4 &&
    expr[1] === 'has' &&
    expr[2] === 'probability' &&
    isNum(expr[3])
  ) {
    return 'assigned-probability';
  }

  // (range lo hi) / (valence N)
  if (
    expr.length === 3 &&
    head === 'range' &&
    isNum(expr[1]) &&
    isNum(expr[2])
  ) {
    return 'configuration';
  }
  if (expr.length === 2 && head === 'valence' && isNum(expr[1])) {
    return 'configuration';
  }

  // (L op R) infix.
  if (expr.length === 3 && typeof expr[1] === 'string') {
    const op = expr[1];
    const arith = { '+': 'sum', '-': 'difference', '*': 'product', '/': 'quotient' };
    if (op in arith) return arith[op];
    if (op === 'and' || op === 'or' || op === 'both' || op === 'neither') return op;
    if (op === 'of') return 'type-check';
    if (op === '=' || op === '!=') {
      const L = expr[0];
      const R = expr[2];
      const kP = keyOf(['=', L, R]);
      const kI = keyOf([L, '=', R]);
      const isAssigned = assigned.has(kP) || assigned.has(kI);
      if (op === '!=') {
        if (isAssigned) return 'assigned-inequality';
        return isStructurallySame(L, R) ? 'structural-inequality' : 'numeric-inequality';
      }
      if (isAssigned) return 'assigned-equality';
      return isStructurallySame(L, R) ? 'structural-equality' : 'numeric-equality';
    }
  }

  // Composite (both A and B [...]) / (neither A nor B [...]).
  if (expr.length >= 4 && expr.length % 2 === 0) {
    if (head === 'both') return 'both';
    if (head === 'neither') return 'neither';
  }

  // Prefix operator: (op X Y ...)
  if (typeof head === 'string' && ops.has(head)) {
    return prefixMarker(head);
  }
  return 'reduce';
}

// Stable name for a prefix-op rule: the op name itself maps to its
// operational rule (e.g. `not` → `not`). Anything else falls back to
// `reduce` so the structural validator handles it via the prefix path.
function prefixMarker(name) {
  switch (name) {
    case 'not': return 'not';
    case 'and': return 'and';
    case 'or': return 'or';
    case '+': return 'sum';
    case '-': return 'difference';
    case '*': return 'product';
    case '/': return 'quotient';
    default: return 'reduce';
  }
}

// Walk both trees in lockstep and verify each level matches.
function checkNode(expr, proof, ops, assigned, path) {
  const { rule, subs } = decode(proof, path);
  const exp = expectedRule(expr, ops, assigned);
  const ruleOk = rule === exp || prefixMatch(rule, expr, ops);
  if (!ruleOk) {
    throw {
      path: [...path],
      message: `rule \`${rule}\` does not justify \`${keyOf(expr)}\` (expected \`${exp}\`)`,
    };
  }
  const nextPath = [...path, rule];

  switch (rule) {
    case 'literal': {
      arity(rule, subs, 1, path);
      if (typeof subs[0] !== 'string' || !isNum(subs[0]) || subs[0] !== expr) {
        throw {
          path: [...path],
          message: `literal \`${keyOf(subs[0])}\` ≠ \`${keyOf(expr)}\``,
        };
      }
      return rule;
    }
    case 'symbol': {
      arity(rule, subs, 1, path);
      if (typeof subs[0] !== 'string' || subs[0] !== expr) {
        throw {
          path: [...path],
          message: `symbol \`${keyOf(subs[0])}\` ≠ \`${keyOf(expr)}\``,
        };
      }
      return rule;
    }
    case 'definition':
      return checkPayload(rule, subs, [expr], path);
    case 'configuration':
      return checkConfiguration(expr, rule, subs, path);
    case 'assigned-probability':
      return checkAssignedProbability(expr, rule, subs, path);
    case 'reduce':
      return checkPayload(rule, subs, [expr], path);
    case 'query':
      throw { path: [...path], message: 'stray `query` rule (stripped by checker)' };
    case 'sum':
    case 'difference':
    case 'product':
    case 'quotient': {
      const opMap = { sum: '+', difference: '-', product: '*', quotient: '/' };
      return checkInfix(expr, rule, subs, opMap[rule], ops, assigned, nextPath, path);
    }
    case 'and':
    case 'or':
    case 'both':
    case 'neither':
      return checkLogic(expr, rule, subs, ops, assigned, nextPath, path);
    case 'not': {
      arity(rule, subs, 1, path);
      if (
        Array.isArray(expr) &&
        expr.length === 2 &&
        expr[0] === 'not'
      ) {
        checkNode(expr[1], subs[0], ops, assigned, nextPath);
        return rule;
      }
      throw { path: [...path], message: `\`not\` ≠ \`${keyOf(expr)}\`` };
    }
    case 'structural-equality':
    case 'numeric-equality':
    case 'assigned-equality':
    case 'structural-inequality':
    case 'numeric-inequality':
    case 'assigned-inequality':
      return checkEq(expr, rule, subs, ops, assigned, path);
    case 'type-universe':
    case 'prop':
    case 'pi-formation':
    case 'lambda-formation':
    case 'type-query':
    case 'type-check':
    case 'substitution':
    case 'fresh':
      return checkTypesys(expr, rule, subs, path);
    case 'beta-reduction': {
      arity(rule, subs, 2, path);
      if (
        Array.isArray(expr) &&
        expr.length === 3 &&
        expr[0] === 'apply'
      ) {
        checkNode(expr[1], subs[0], ops, assigned, nextPath);
        checkNode(expr[2], subs[1], ops, assigned, nextPath);
        return rule;
      }
      throw {
        path: [...path],
        message: `\`beta-reduction\` ≠ \`${keyOf(expr)}\``,
      };
    }
    default:
      return checkPrefix(expr, rule, subs, ops, assigned, nextPath, path);
  }
}

function arity(rule, subs, n, path) {
  if (subs.length !== n) {
    throw {
      path: [...path],
      message: `rule \`${rule}\` expects ${n} sub(s), got ${subs.length}`,
    };
  }
}

function checkPayload(rule, subs, expected, path) {
  arity(rule, subs, expected.length, path);
  for (let i = 0; i < expected.length; i++) {
    if (!isStructurallySame(subs[i], expected[i])) {
      throw {
        path: [...path],
        message: `payload ${i} \`${keyOf(subs[i])}\` ≠ \`${keyOf(expected[i])}\``,
      };
    }
  }
  return rule;
}

function checkConfiguration(expr, rule, subs, path) {
  if (Array.isArray(expr) && expr.length === 3 && expr[0] === 'range') {
    return checkPayload(rule, subs, ['range', expr[1], expr[2]], path);
  }
  if (Array.isArray(expr) && expr.length === 2 && expr[0] === 'valence') {
    return checkPayload(rule, subs, ['valence', expr[1]], path);
  }
  throw { path: [...path], message: `\`${rule}\` ≠ \`${keyOf(expr)}\`` };
}

function checkAssignedProbability(expr, rule, subs, path) {
  if (
    Array.isArray(expr) &&
    expr.length === 4 &&
    expr[1] === 'has' &&
    expr[2] === 'probability'
  ) {
    return checkPayload(rule, subs, [expr[0], expr[3]], path);
  }
  throw { path: [...path], message: `\`${rule}\` ≠ \`${keyOf(expr)}\`` };
}

// True when `rule` is the bare name of a prefix operator applied at expr.
function prefixMatch(rule, expr, ops) {
  if (!ops.has(rule)) return false;
  return Array.isArray(expr) && expr[0] === rule;
}

function checkInfix(expr, rule, subs, op, ops, assigned, nextPath, path) {
  arity(rule, subs, 2, path);
  if (
    Array.isArray(expr) &&
    expr.length === 3 &&
    expr[1] === op
  ) {
    checkNode(expr[0], subs[0], ops, assigned, nextPath);
    checkNode(expr[2], subs[1], ops, assigned, nextPath);
    return rule;
  }
  throw { path: [...path], message: `rule \`${rule}\` ≠ \`${keyOf(expr)}\`` };
}

function checkLogic(expr, rule, subs, ops, assigned, nextPath, path) {
  if (Array.isArray(expr)) {
    // Binary infix.
    if (expr.length === 3 && expr[1] === rule) {
      arity(rule, subs, 2, path);
      checkNode(expr[0], subs[0], ops, assigned, nextPath);
      checkNode(expr[2], subs[1], ops, assigned, nextPath);
      return rule;
    }
    // Composite chain.
    if (
      (rule === 'both' || rule === 'neither') &&
      expr.length >= 4 &&
      expr.length % 2 === 0 &&
      expr[0] === rule
    ) {
      const sep = rule === 'both' ? 'and' : 'nor';
      for (let i = 2; i < expr.length; i += 2) {
        if (expr[i] !== sep) {
          throw {
            path: [...path],
            message: `composite \`${rule}\` separator must be \`${sep}\``,
          };
        }
      }
      const n = expr.length / 2;
      arity(rule, subs, n, path);
      for (let j = 0; j < subs.length; j++) {
        checkNode(expr[1 + j * 2], subs[j], ops, assigned, nextPath);
      }
      return rule;
    }
  }
  throw { path: [...path], message: `rule \`${rule}\` ≠ \`${keyOf(expr)}\`` };
}

function checkEq(expr, rule, subs, ops, assigned, path) {
  arity(rule, subs, 1, path);
  const pair = subs[0];
  if (!Array.isArray(pair) || pair.length !== 2) {
    throw { path: [...path], message: `\`${rule}\` expects \`(L R)\` sub` };
  }
  if (
    Array.isArray(expr) &&
    expr.length === 3 &&
    (expr[1] === '=' || expr[1] === '!=')
  ) {
    if (
      !isStructurallySame(expr[0], pair[0]) ||
      !isStructurallySame(expr[2], pair[1])
    ) {
      throw {
        path: [...path],
        message: `operands \`${keyOf(pair[0])} ${keyOf(pair[1])}\` ≠ \`${keyOf(expr[0])} ${keyOf(expr[2])}\``,
      };
    }
    const exp = expectedRule(expr, ops, assigned);
    if (exp === rule) return rule;
    throw {
      path: [...path],
      message: `rule \`${rule}\` ≠ expected \`${exp}\``,
    };
  }
  throw { path: [...path], message: `rule \`${rule}\` ≠ \`${keyOf(expr)}\`` };
}

function checkTypesys(expr, rule, subs, path) {
  const bad = (reason) => {
    throw {
      path: [...path],
      message: `\`${rule}\` ≠ \`${keyOf(expr)}\` (${reason})`,
    };
  };
  if (!Array.isArray(expr)) bad('shape mismatch');

  if (rule === 'type-universe' && expr.length === 2 && expr[0] === 'Type') {
    arity(rule, subs, 1, path);
    if (isStructurallySame(expr[1], subs[0])) return rule;
    bad('Type level mismatch');
  }
  if (rule === 'prop' && expr.length === 1 && expr[0] === 'Prop') {
    arity(rule, subs, 0, path);
    return rule;
  }
  if (
    (rule === 'pi-formation' && expr.length === 3 && expr[0] === 'Pi') ||
    (rule === 'lambda-formation' && expr.length === 3 && expr[0] === 'lambda')
  ) {
    arity(rule, subs, 2, path);
    if (
      isStructurallySame(expr[1], subs[0]) &&
      isStructurallySame(expr[2], subs[1])
    ) {
      return rule;
    }
    bad('binder mismatch');
  }
  if (
    rule === 'type-query' &&
    expr.length === 3 &&
    expr[0] === 'type' &&
    expr[1] === 'of'
  ) {
    arity(rule, subs, 1, path);
    if (isStructurallySame(expr[2], subs[0])) return rule;
    bad('type-query mismatch');
  }
  if (rule === 'type-check' && expr.length === 3 && expr[1] === 'of') {
    arity(rule, subs, 2, path);
    if (
      isStructurallySame(expr[0], subs[0]) &&
      isStructurallySame(expr[2], subs[1])
    ) {
      return rule;
    }
    bad('type-check mismatch');
  }
  if (rule === 'substitution' && expr.length === 4 && expr[0] === 'subst') {
    arity(rule, subs, 3, path);
    if (
      isStructurallySame(expr[1], subs[0]) &&
      isStructurallySame(expr[2], subs[1]) &&
      isStructurallySame(expr[3], subs[2])
    ) {
      return rule;
    }
    bad('substitution mismatch');
  }
  if (rule === 'fresh' && expr.length === 4 && expr[0] === 'fresh' && expr[2] === 'in') {
    arity(rule, subs, 2, path);
    if (
      isStructurallySame(expr[1], subs[0]) &&
      isStructurallySame(expr[3], subs[1])
    ) {
      return rule;
    }
    bad('fresh mismatch');
  }
  bad('shape mismatch');
}

function checkPrefix(expr, rule, subs, ops, assigned, nextPath, path) {
  if (
    Array.isArray(expr) &&
    expr.length >= 1 &&
    expr[0] === rule &&
    ops.has(rule)
  ) {
    arity(rule, subs, expr.length - 1, path);
    for (let i = 0; i < subs.length; i++) {
      checkNode(expr[1 + i], subs[i], ops, assigned, nextPath);
    }
    return rule;
  }
  throw {
    path: [...path],
    message: `unknown rule \`${rule}\` for \`${keyOf(expr)}\``,
  };
}

/**
 * Public entry point: parse both `.lino` sources, pair queries with
 * derivations 1:1, and verify each pair structurally. Returns
 * `{ ok: [{rule, expr}, ...], errors: [{path, message}, ...] }`.
 */
export function checkProgram(programSrc, proofsSrc) {
  const programForms = parseForms(programSrc);
  const proofForms = parseForms(proofsSrc);
  const queries = programForms.map(queryTarget).filter(q => q !== null);
  const ops = collectOperators(programForms);
  const assigned = collectAssignments(programForms);
  const result = { ok: [], errors: [] };

  if (queries.length !== proofForms.length) {
    result.errors.push({
      path: [],
      message: `expected ${queries.length} derivation(s), got ${proofForms.length}`,
    });
    return result;
  }

  for (let i = 0; i < queries.length; i++) {
    const path = [`query[${i}]`];
    try {
      const rule = checkNode(queries[i], proofForms[i], ops, assigned, path);
      result.ok.push({ rule, expr: keyOf(queries[i]) });
    } catch (e) {
      if (e && typeof e === 'object' && 'path' in e && 'message' in e) {
        result.errors.push(e);
      } else {
        throw e;
      }
    }
  }
  return result;
}

export function isOk(result) {
  return result.errors.length === 0;
}
