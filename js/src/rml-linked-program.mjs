import {
  isStructurallySame,
  keyOf,
  parseLino,
  parseOne,
  tokenizeOne,
} from './rml-links.mjs';

function cloneTerm(term) {
  return Array.isArray(term) ? term.map(cloneTerm) : term;
}

function leaf(value, context) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty reference`);
  }
  return value;
}

function variableName(term) {
  return typeof term === 'string' && term.startsWith('?') && term.length > 1
    ? term
    : null;
}

function variablesIn(term, output = new Set()) {
  const variable = variableName(term);
  if (variable !== null) output.add(variable);
  if (Array.isArray(term)) {
    for (const child of term) variablesIn(child, output);
  }
  return output;
}

function matchTerm(pattern, candidate, substitution = new Map()) {
  const variable = variableName(pattern);
  if (variable !== null) {
    const previous = substitution.get(variable);
    if (previous !== undefined) {
      return isStructurallySame(previous, candidate) ? substitution : null;
    }
    substitution.set(variable, cloneTerm(candidate));
    return substitution;
  }
  if (!Array.isArray(pattern) || !Array.isArray(candidate)) {
    return isStructurallySame(pattern, candidate) ? substitution : null;
  }
  if (pattern.length !== candidate.length) return null;
  for (let index = 0; index < pattern.length; index += 1) {
    if (matchTerm(pattern[index], candidate[index], substitution) === null) return null;
  }
  return substitution;
}

function instantiate(term, substitution) {
  const variable = variableName(term);
  if (variable !== null) {
    if (!substitution.has(variable)) throw new Error(`unbound variable ${variable}`);
    return cloneTerm(substitution.get(variable));
  }
  return Array.isArray(term)
    ? term.map(child => instantiate(child, substitution))
    : term;
}

function singleClause(form, name, context) {
  const clauses = form.slice(3).filter(clause => Array.isArray(clause) && clause[0] === name);
  if (clauses.length !== 1 || clauses[0].length !== 2) {
    throw new Error(`${context} requires exactly one (${name} value) clause`);
  }
  return clauses[0][1];
}

function assertReplacementBound(pattern, replacement, context) {
  const bound = variablesIn(pattern);
  for (const variable of variablesIn(replacement)) {
    if (!bound.has(variable)) throw new Error(`${context} has unbound variable ${variable}`);
  }
}

function assertConclusionBound(premises, conclusion, context) {
  const bound = new Set();
  for (const premise of premises) variablesIn(premise, bound);
  for (const variable of variablesIn(conclusion)) {
    if (!bound.has(variable)) throw new Error(`${context} has unbound variable ${variable}`);
  }
}

function parseForms(source) {
  // links-notation treats indentation after a blank group boundary as nested
  // notation. Linked program forms are an unordered top-level graph, so
  // normalize only leading horizontal whitespace before parsing them.
  const normalized = String(source).replace(/^[ \t]+/gm, '');
  return parseLino(normalized).map(link => parseOne(tokenizeOne(link)));
}

/**
 * A registry of executable semantics represented entirely by LiNo links.
 *
 * The host supplies only structural matching, substitution, deterministic
 * rewriting, and finite rule saturation. It has no branches for lambda
 * calculus, sets, types, graphs, relations, or any other object theory.
 */
class LinkedProgramRegistry {
  constructor() {
    this.programs = new Map();
  }

  static fromRml(source) {
    return LinkedProgramRegistry.fromForms(parseForms(source));
  }

  static fromForms(forms) {
    const registry = new LinkedProgramRegistry();
    for (const form of forms) {
      if (!Array.isArray(form) || form[0] !== 'linked-program') continue;
      registry.#addProgram(form);
    }
    for (const form of forms) {
      if (!Array.isArray(form)) continue;
      if (form[0] === 'linked-rewrite') registry.#addRewrite(form);
      if (form[0] === 'linked-fact') registry.#addFact(form);
      if (form[0] === 'linked-inference') registry.#addInference(form);
    }
    registry.#validate();
    return registry;
  }

  #addProgram(form) {
    if (form.length < 2) throw new Error('linked-program requires a name');
    const name = leaf(form[1], 'linked-program name');
    if (this.programs.has(name)) throw new Error(`duplicate linked-program ${name}`);
    const uses = [];
    for (const clause of form.slice(2)) {
      if (!Array.isArray(clause) || clause.length !== 2 || clause[0] !== 'uses') {
        throw new Error(`linked-program ${name} only supports (uses program) clauses`);
      }
      const dependency = leaf(clause[1], `linked-program ${name} dependency`);
      if (uses.includes(dependency)) {
        throw new Error(`linked-program ${name} repeats dependency ${dependency}`);
      }
      uses.push(dependency);
    }
    this.programs.set(name, { name, uses, rewrites: [], facts: [], inferences: [] });
  }

  #program(name, context) {
    const program = this.programs.get(name);
    if (program === undefined) throw new Error(`${context} references unknown linked-program ${name}`);
    return program;
  }

  #addRewrite(form) {
    if (form.length < 5) {
      throw new Error('linked-rewrite requires a program, name, from, and to');
    }
    const programName = leaf(form[1], 'linked-rewrite program');
    const name = leaf(form[2], 'linked-rewrite name');
    const context = `linked-rewrite ${programName}.${name}`;
    const program = this.#program(programName, context);
    if (program.rewrites.some(rule => rule.name === name)) {
      throw new Error(`duplicate ${context}`);
    }
    const pattern = singleClause(form, 'from', context);
    const replacement = singleClause(form, 'to', context);
    if (form.slice(3).some(clause => !Array.isArray(clause) ||
        !['from', 'to'].includes(clause[0]))) {
      throw new Error(`${context} has an unsupported clause`);
    }
    assertReplacementBound(pattern, replacement, context);
    program.rewrites.push({ program: programName, name, pattern, replacement });
  }

  #addFact(form) {
    if (form.length !== 4) {
      throw new Error('linked-fact requires a program, name, and judgement');
    }
    const programName = leaf(form[1], 'linked-fact program');
    const name = leaf(form[2], 'linked-fact name');
    const context = `linked-fact ${programName}.${name}`;
    const program = this.#program(programName, context);
    if (!Array.isArray(form[3]) || form[3].length !== 2 || form[3][0] !== 'judgement') {
      throw new Error(`${context} requires (judgement value)`);
    }
    if (program.facts.some(fact => fact.name === name)) throw new Error(`duplicate ${context}`);
    if (variablesIn(form[3][1]).size > 0) {
      throw new Error(`${context} cannot contain variables`);
    }
    program.facts.push({ program: programName, name, judgement: form[3][1] });
  }

  #addInference(form) {
    if (form.length < 4) {
      throw new Error('linked-inference requires a program, name, and clauses');
    }
    const programName = leaf(form[1], 'linked-inference program');
    const name = leaf(form[2], 'linked-inference name');
    const context = `linked-inference ${programName}.${name}`;
    const program = this.#program(programName, context);
    if (program.inferences.some(rule => rule.name === name)) {
      throw new Error(`duplicate ${context}`);
    }
    const premises = [];
    let conclusion = null;
    for (const clause of form.slice(3)) {
      if (!Array.isArray(clause) || clause.length !== 2 ||
          !['premise', 'conclusion'].includes(clause[0])) {
        throw new Error(`${context} supports only premise and conclusion clauses`);
      }
      if (clause[0] === 'premise') premises.push(clause[1]);
      if (clause[0] === 'conclusion') {
        if (conclusion !== null) throw new Error(`${context} repeats its conclusion`);
        conclusion = clause[1];
      }
    }
    if (premises.length === 0) throw new Error(`${context} requires at least one premise`);
    if (conclusion === null) throw new Error(`${context} is missing its conclusion`);
    assertConclusionBound(premises, conclusion, context);
    program.inferences.push({ program: programName, name, premises, conclusion });
  }

  #validate() {
    for (const program of this.programs.values()) {
      for (const dependency of program.uses) {
        if (!this.programs.has(dependency)) {
          throw new Error(`linked-program ${program.name} uses unknown program ${dependency}`);
        }
      }
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = name => {
      if (visiting.has(name)) throw new Error(`linked-program import cycle at ${name}`);
      if (visited.has(name)) return;
      visiting.add(name);
      for (const dependency of this.programs.get(name).uses) visit(dependency);
      visiting.delete(name);
      visited.add(name);
    };
    for (const name of this.programs.keys()) visit(name);
  }

  has(name) {
    return this.programs.has(name);
  }

  names() {
    return [...this.programs.keys()].sort();
  }

  #effective(name, field, seen = new Set()) {
    const program = this.#program(name, 'execution');
    if (seen.has(name)) return [];
    seen.add(name);
    const result = [...program[field]];
    for (const dependency of program.uses) {
      result.push(...this.#effective(dependency, field, seen));
    }
    return result;
  }

  #rewriteOnce(term, rules) {
    for (const rule of rules) {
      const substitution = matchTerm(rule.pattern, term);
      if (substitution !== null) {
        return {
          term: instantiate(rule.replacement, substitution),
          rule,
        };
      }
    }
    if (!Array.isArray(term)) return null;
    for (let index = 0; index < term.length; index += 1) {
      const rewritten = this.#rewriteOnce(term[index], rules);
      if (rewritten !== null) {
        const result = term.map(cloneTerm);
        result[index] = rewritten.term;
        return { term: result, rule: rewritten.rule };
      }
    }
    return null;
  }

  reduce(name, input, { maxSteps = 10_000 } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) {
      throw new Error('maxSteps must be a positive safe integer');
    }
    const rules = this.#effective(name, 'rewrites');
    let term = cloneTerm(input);
    const trace = [];
    const seen = new Set([keyOf(term)]);
    while (trace.length < maxSteps) {
      const step = this.#rewriteOnce(term, rules);
      if (step === null) return { term, trace, steps: trace.length };
      if (isStructurallySame(term, step.term)) {
        throw new Error(`linked rewrite ${step.rule.program}.${step.rule.name} made no progress`);
      }
      const before = term;
      term = step.term;
      trace.push(Object.freeze({
        program: step.rule.program,
        rule: step.rule.name,
        before: cloneTerm(before),
        after: cloneTerm(term),
      }));
      const key = keyOf(term);
      if (seen.has(key)) throw new Error(`rewrite cycle after ${trace.length} steps at ${key}`);
      seen.add(key);
    }
    throw new Error(`rewrite step limit ${maxSteps} exceeded`);
  }

  prove(name, goal, { facts = [], maxRounds = 128, maxFacts = 10_000 } = {}) {
    if (!Number.isSafeInteger(maxRounds) || maxRounds <= 0 ||
        !Number.isSafeInteger(maxFacts) || maxFacts <= 0) {
      throw new Error('proof bounds must be positive safe integers');
    }
    const normalizedGoal = this.reduce(name, goal).term;
    const known = new Map();
    const add = (judgement, proof) => {
      const normalized = this.reduce(name, judgement).term;
      const key = keyOf(normalized);
      if (known.has(key)) return false;
      known.set(key, { judgement: normalized, proof });
      return true;
    };
    for (const fact of this.#effective(name, 'facts')) {
      add(fact.judgement, {
        judgement: cloneTerm(fact.judgement),
        program: fact.program,
        rule: fact.name,
        premises: [],
      });
    }
    facts.forEach((fact, index) => add(fact, {
      judgement: cloneTerm(fact),
      program: '<input>',
      rule: `input-${index + 1}`,
      premises: [],
    }));
    const goalKey = keyOf(normalizedGoal);
    if (known.has(goalKey)) return { ok: true, proof: known.get(goalKey).proof };

    const rules = this.#effective(name, 'inferences');
    for (let round = 0; round < maxRounds; round += 1) {
      let changed = false;
      for (const rule of rules) {
        let candidates = [{ substitution: new Map(), premises: [] }];
        for (const premise of rule.premises) {
          const next = [];
          for (const candidate of candidates) {
            for (const entry of known.values()) {
              const substitution = new Map(candidate.substitution);
              if (matchTerm(premise, entry.judgement, substitution) !== null) {
                next.push({
                  substitution,
                  premises: [...candidate.premises, entry.proof],
                });
              }
            }
          }
          candidates = next;
          if (candidates.length === 0) break;
        }
        for (const candidate of candidates) {
          const judgement = instantiate(rule.conclusion, candidate.substitution);
          const proof = {
            judgement: cloneTerm(judgement),
            program: rule.program,
            rule: rule.name,
            premises: candidate.premises,
          };
          if (add(judgement, proof)) {
            changed = true;
            if (known.size > maxFacts) throw new Error(`proof fact limit ${maxFacts} exceeded`);
            if (known.has(goalKey)) return { ok: true, proof: known.get(goalKey).proof };
          }
        }
      }
      if (!changed) break;
    }
    return { ok: false, proof: null };
  }
}

export {
  LinkedProgramRegistry,
  cloneTerm,
  instantiate,
  matchTerm,
  variablesIn,
};
