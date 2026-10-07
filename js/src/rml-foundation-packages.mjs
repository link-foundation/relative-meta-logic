/** Independent, versioned linked source packages with explicit program imports.
 * Qualification changes declaration/reference positions only; judgement symbols
 * and caller assumptions are never renamed. Internal addresses are accompanied
 * by their original package/program identities in every answer.
 */
import { FoundationWorkspace } from './rml-foundation-workspace.mjs';
import { parseLino, parseOne, tokenizeOne } from './rml-links.mjs';
import { cloneTerm } from './rml-linked-program.mjs';

const key = (name, version) => JSON.stringify([name, version]);
const hex = text => [...new TextEncoder().encode(text)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const address = (name, version, kind, local) => `rml-package.${hex(name)}.${hex(version)}.${kind}.${hex(local)}`;
const roles = new Set(FoundationWorkspace.roles().map(item => item.role));
const heads = new Set(['linked-program', 'linked-fact', 'linked-inference', 'linked-rewrite', 'linked-foundation', 'linked-instance']);
const named = (value, context) => {
  if (typeof value !== 'string' || !value.length || value.startsWith('?')) throw new Error(`${context} must be a name`);
  return value;
};
const versionOf = form => form.find(item => Array.isArray(item) && item[0] === 'version')?.[1];

class FoundationPackages {
  #workspace;
  #plans;
  #origins;
  #options;
  #answers = new WeakMap();

  static fromPackages(packages, options = {}) {
    if (!Array.isArray(packages) || packages.length === 0) throw new Error('foundation packages must be a non-empty list');
    const plans = new Map();
    const origins = new Map();
    for (const item of packages) {
      const name = named(item.name, 'package name');
      const version = named(item.version, 'package version');
      const identity = key(name, version);
      if (plans.has(identity)) throw new Error(`duplicate package ${name} version ${version}`);
      if (typeof item.source !== 'string') throw new Error(`package ${name} source must be text`);
      const forms = parseLino(item.source.replace(/^[ \t]+/gm, '')).map(form => parseOne(tokenizeOne(form)));
      const local = new Map();
      const instances = new Map();
      const foundations = [];
      for (const form of forms) {
        if (!Array.isArray(form) || !heads.has(form[0])) throw new Error(`package ${name} contains an unsupported top-level form`);
        if (form[0] === 'linked-foundation') foundations.push(form);
        if (form[0] === 'linked-program' || form[0] === 'linked-instance') {
          const kind = form[0] === 'linked-program' ? 'program' : 'instance';
          const target = kind === 'program' ? local : instances;
          const label = named(form[1], `${kind} name`);
          if (target.has(label)) throw new Error(`package ${name} repeats ${kind} ${label}`);
          const qualified = address(name, version, kind, label);
          target.set(label, qualified);
          if (kind === 'program') origins.set(qualified, { address: qualified, name, version, program: label });
        }
      }
      if (foundations.length !== 1 || foundations[0][1] !== name || versionOf(foundations[0]) !== version) {
        throw new Error(`package ${name} version ${version} requires exactly its matching linked-foundation declaration`);
      }
      if (item.imports !== undefined && !Array.isArray(item.imports)) throw new Error('package imports must be a list');
      plans.set(identity, { name, version, forms, local, instances, imports: item.imports ?? [], aliases: new Map(), dependencies: new Set() });
    }
    for (const plan of plans.values()) {
      for (const entry of plan.imports) {
        const imported = plans.get(key(named(entry.name, 'import package'), named(entry.version, 'import version')));
        if (!imported) throw new Error(`package ${plan.name} imports an unloaded package ${entry.name} version ${entry.version}`);
        plan.dependencies.add(key(entry.name, entry.version));
        if (entry.program === undefined && entry.alias === undefined) continue;
        const program = named(entry.program, 'import program');
        const alias = named(entry.alias, 'import alias');
        if (!imported.local.has(program)) throw new Error(`package ${entry.name} version ${entry.version} has no program ${program}`);
        if (plan.local.has(alias) || plan.aliases.has(alias)) throw new Error(`package ${plan.name} import alias ${alias} collides`);
        plan.aliases.set(alias, imported.local.get(program));
      }
    }
    const forms = [...plans.values()].flatMap(plan => plan.forms.map(form => qualify(plan, form)));
    const loaded = new FoundationPackages();
    loaded.#plans = plans;
    loaded.#origins = origins;
    loaded.#options = { ...options };
    loaded.#workspace = FoundationWorkspace.fromForms(forms, options);
    return loaded;
  }

  static loadPackages(packages, options = {}) { return this.fromPackages(packages, options); }

  packages() { return [...this.#plans.values()].map(({ name, version }) => ({ name, version })); }
  programs() { return [...this.#origins.values()].sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0).map(item => ({ ...item })); }
  instances() {
    return [...this.#plans.values()].flatMap(plan => [...plan.instances.keys()].map(instance => ({ name: plan.name, version: plan.version, instance })));
  }
  describe(name, version) { this.#plan(name, version); return this.#workspace.describe(name, version); }

  ask(selection, query, options = {}) {
    const instance = this.#instance(selection);
    const raw = this.#workspace.ask(instance, query, options);
    return this.#answer(selection, raw);
  }

  execute(selection, term, options = {}) {
    const instance = this.#instance(selection);
    return this.#answer(selection, this.#workspace.execute(instance, term, options));
  }

  /** Explicitly scope each rule mutation to its source package. */
  revise(answers, selection, change) {
    const plan = this.#plan(selection.name, selection.version);
    const qualified = { ...change };
    if (change.removeRule) qualified.removeRule = [resolveProgram(plan, change.removeRule[0], false), change.removeRule[1]];
    if (change.addRule) qualified.addRule = qualify(plan, change.addRule);
    if (change.replaceRule) qualified.replaceRule = qualify(plan, change.replaceRule);
    const before = answers.map(answer => {
      const saved = this.#answers.get(answer);
      if (!saved || saved.raw.schema !== 'rml-foundation-result/v1') throw new Error('package revisions require query answers returned by this package workspace');
      return saved;
    });
    const applies = before.map(item => change.replaceAssumption === undefined ||
      (item.selection.name === selection.name && item.selection.version === selection.version &&
        (selection.instance === undefined || item.selection.instance === selection.instance)));
    const revision = this.#workspace.revise(before.filter((_, index) => applies[index]).map(item => item.raw), qualified);
    const loaded = new FoundationPackages();
    loaded.#workspace = revision.workspace;
    loaded.#plans = this.#plans;
    loaded.#origins = this.#origins;
    loaded.#options = this.#options;
    let revisedIndex = 0;
    return {
      workspace: loaded,
      revisions: before.map((saved, index) => {
        const item = applies[index] ? revision.revisions[revisedIndex++]
          : { action: 'kept', changed: false, after: saved.raw };
        return { action: item.action, changed: item.changed, before: answers[index], after: loaded.#answer(saved.selection, item.after) };
      }),
    };
  }

  #plan(name, version) {
    const plan = this.#plans.get(key(name, version));
    if (!plan) throw new Error(`unknown package ${name} version ${version}`);
    return plan;
  }
  #instance(selection) {
    const plan = this.#plan(selection.name, selection.version);
    const instance = plan.instances.get(selection.instance);
    if (!instance) throw new Error(`package ${plan.name} version ${plan.version} has no instance ${selection.instance}`);
    return instance;
  }
  #answer(selection, raw) {
    const theory = this.#origins.get(raw.theory.name);
    const answer = {
      package: { name: selection.name, version: selection.version },
      result: { ...raw, instance: selection.instance, theory: { ...raw.theory, name: theory?.program ?? raw.theory.name } },
      theoryPackage: theory ? { name: theory.name, version: theory.version } : null,
      programs: this.programs(),
    };
    this.#answers.set(answer, { selection: { ...selection }, raw: structuredClone(raw) });
    return answer;
  }
}

function resolveProgram(plan, program, imported = true) {
  const resolved = plan.local.get(program) ?? (imported ? plan.aliases.get(program) : undefined);
  if (!resolved) throw new Error(`package ${plan.name} version ${plan.version} has no ${imported ? 'declared or imported' : 'local'} program ${program}`);
  return resolved;
}

function foundationReference(plan, name, version) {
  if (name === plan.name && (version === undefined || version === plan.version)) return;
  if (version === undefined) throw new Error(`package ${plan.name} external foundation ${name} requires an explicit version`);
  if (!plan.dependencies.has(key(name, version))) throw new Error(`package ${plan.name} uses undeclared foundation import ${name} version ${version}`);
}

function qualify(plan, source) {
  const form = cloneTerm(source);
  if (form[0] === 'linked-program') {
    form[1] = resolveProgram(plan, form[1], false);
    for (const clause of form.slice(2)) {
      if (clause[0] === 'uses') clause[1] = resolveProgram(plan, clause[1]);
    }
  } else if (['linked-fact', 'linked-inference', 'linked-rewrite'].includes(form[0])) {
    form[1] = resolveProgram(plan, form[1], false);
  } else if (form[0] === 'linked-foundation') {
    for (const clause of form.slice(2)) {
      if (roles.has(clause[0])) clause[1] = resolveProgram(plan, clause[1]);
      else if (clause[0] === 'depends-on') foundationReference(plan, clause[1], versionOf(clause));
      else if (clause[0] === 'cycle-policy') {
        for (const guard of clause.slice(2)) if (guard[0] === 'guard') guard[1] = resolveProgram(plan, guard[1]);
      }
    }
  } else if (form[0] === 'linked-instance') {
    form[1] = plan.instances.get(form[1]);
    for (const clause of form.slice(2)) {
      if (clause[0] === 'theory') clause[1] = resolveProgram(plan, clause[1]);
      else if (clause[0] === 'foundation') foundationReference(plan, clause[1], versionOf(clause));
    }
  } else throw new Error('package mutation must contain a linked rule');
  return form;
}

export { FoundationPackages };
