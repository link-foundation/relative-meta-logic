import {
  parseRmlToMetaLanguage,
  reconstructRmlFromMetaLanguage,
} from './rml-meta-language.mjs';
import {
  Env,
  checkProofObject,
  isStructurallySame,
  parseLino,
  parseOne,
  parseProofAssumptionForm,
  parseProofObjectForm,
  parseRuleForm,
  tokenizeOne,
} from './rml-links.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';

const EMPTY_SEQUENCE = 'rml.sequence.empty';

function requireLeaf(value, context) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty reference`);
  }
  return value;
}

function clauses(form, context) {
  const result = new Map();
  for (const clause of form.slice(2)) {
    if (!Array.isArray(clause) || clause.length !== 2 || typeof clause[0] !== 'string') {
      throw new Error(`${context} clauses must have the form (name value)`);
    }
    if (result.has(clause[0])) {
      throw new Error(`${context} repeats clause ${clause[0]}`);
    }
    result.set(clause[0], requireLeaf(clause[1], `${context} ${clause[0]}`));
  }
  return result;
}

function implementationClauses(form, context) {
  const data = new Map();
  const obligations = [];
  for (const clause of form.slice(2)) {
    if (!Array.isArray(clause) || clause.length !== 2 || typeof clause[0] !== 'string') {
      throw new Error(`${context} clauses must have the form (name value)`);
    }
    const value = requireLeaf(clause[1], `${context} ${clause[0]}`);
    if (clause[0] === 'obligation') {
      if (obligations.includes(value)) {
        throw new Error(`${context} repeats obligation ${value}`);
      }
      obligations.push(value);
    } else {
      if (data.has(clause[0])) throw new Error(`${context} repeats clause ${clause[0]}`);
      data.set(clause[0], value);
    }
  }
  return { data, obligations };
}

function isProofRuleShape(form) {
  return Array.isArray(form) &&
    form[0] === 'rule' &&
    typeof form[1] === 'string' &&
    form.length >= 3 &&
    form.slice(2).every(clause =>
      Array.isArray(clause) && (clause[0] === 'premise' || clause[0] === 'conclusion')) &&
    form.slice(2).some(clause => clause[0] === 'conclusion');
}

// Reads every form of a reconstructed source before any of them is
// interpreted, so both runtimes report the same first error whatever the
// forms go on to declare.
function readTheoryForms(source, label) {
  let links;
  try {
    links = parseLino(source);
  } catch (err) {
    throw new Error(`invalid ${label} source: ${err.message}`);
  }
  return links.map(link => {
    try {
      return parseOne(tokenizeOne(link));
    } catch (err) {
      throw new Error(`invalid ${label} link ${link}: ${err.message}`);
    }
  });
}

/**
 * An addressable network of theories, definition relations, and local terms.
 * Source is round-tripped through meta-language before its LiNo forms are read.
 */
class TheoryNetwork {
  constructor(metaLanguageRoundTripOk, trustedFoundationRoundTripOk) {
    this.metaLanguageRoundTripOk = metaLanguageRoundTripOk;
    this.trustedFoundationRoundTripOk = trustedFoundationRoundTripOk;
    this.theories = new Map();
    this.definitions = [];
    this.terms = new Map();
    this.implementations = new Map();
    this.witnesses = new Map();
    this.verifications = new Map();
    this.forms = [];
    this.proofEnv = new Env();
    this.implementationContracts = new Map();
    this.conformanceCases = new Map();
    this.proofObligations = new Map();
    this.linkedPrograms = null;
  }

  static fromRml(source, trustedFoundationSource) {
    if (trustedFoundationSource === undefined) {
      throw new Error('trusted foundation source is required');
    }
    const text = String(source);
    const metaLanguageNetwork = parseRmlToMetaLanguage(text);
    const reconstructed = reconstructRmlFromMetaLanguage(metaLanguageNetwork);
    const trustedText = String(trustedFoundationSource);
    const trustedMetaLanguageNetwork = parseRmlToMetaLanguage(trustedText);
    const trustedReconstructed = reconstructRmlFromMetaLanguage(trustedMetaLanguageNetwork);
    const network = new TheoryNetwork(
      reconstructed === text,
      trustedReconstructed === trustedText,
    );
    const trustedForms = readTheoryForms(trustedReconstructed, 'trusted foundation');

    for (const form of trustedForms) {
      if (!Array.isArray(form) || typeof form[0] !== 'string') continue;
      if (form[0] === 'implementation-contract') {
        network.#addImplementationContract(form);
      } else if (form[0] === 'conformance-case') {
        network.#addConformanceCase(form);
      } else if (form[0] === 'proof-obligation') {
        network.#addProofObligation(form);
      } else if (isProofRuleShape(form)) {
        network.proofEnv.registerProofRule(parseRuleForm(form));
      } else if (form[0] === 'axiom' || form[0] === 'assumption') {
        network.proofEnv.registerProofAssumption(parseProofAssumptionForm(form));
      } else {
        throw new Error(`trusted foundation has unsupported form ${form[0]}`);
      }
    }
    network.#validateTrustedFoundation();

    const forms = readTheoryForms(reconstructed, 'theory network');
    for (const form of forms) {
      if (!Array.isArray(form) || typeof form[0] !== 'string') continue;
      network.forms.push(form);
      if (['implementation-contract', 'conformance-case', 'proof-obligation',
        'rule', 'axiom', 'assumption']
        .includes(form[0])) {
        throw new Error(`candidate theory source cannot declare trusted ${form[0]} forms`);
      }
      if (form[0] === 'theory') network.#addTheory(form);
      if (form[0] === 'term') network.#addTerm(form);
      if (form[0] === 'implementation') network.#addImplementation(form);
      if (form[0] === 'witness') network.#addWitness(form);
      if (form[0] === 'definition') network.#addDefinition(form);
      if (form[0] === 'proof-object') {
        network.proofEnv.registerProofObject(parseProofObjectForm(form));
      }
    }
    network.linkedPrograms = LinkedProgramRegistry.fromForms(forms);
    network.#validate();
    return network;
  }

  #addImplementationContract(form) {
    if (form.length < 3) {
      throw new Error('implementation-contract must have a name and clauses');
    }
    const contract = requireLeaf(form[1], 'implementation-contract name');
    if (this.implementationContracts.has(contract)) {
      throw new Error(`duplicate implementation-contract ${contract}`);
    }
    const { data, obligations } = implementationClauses(
      form,
      `implementation-contract ${contract}`,
    );
    for (const field of data.keys()) {
      if (field !== 'kind') {
        throw new Error(`implementation-contract ${contract} has unsupported clause ${field}`);
      }
    }
    if (!data.has('kind')) {
      throw new Error(`implementation-contract ${contract} is missing kind`);
    }
    if (obligations.length === 0) {
      throw new Error(`implementation-contract ${contract} is missing obligations`);
    }
    this.implementationContracts.set(contract, {
      kind: data.get('kind'),
      obligations,
    });
  }

  #addConformanceCase(form) {
    if (form.length < 5) {
      throw new Error('conformance-case must have a contract, obligation, and clauses');
    }
    const contract = requireLeaf(form[1], 'conformance-case contract');
    const obligation = requireLeaf(form[2], 'conformance-case obligation');
    const context = `conformance-case ${contract}.${obligation}`;
    const values = new Map();
    const facts = [];
    for (const clause of form.slice(3)) {
      if (!Array.isArray(clause) || clause.length !== 2 || typeof clause[0] !== 'string') {
        throw new Error(`${context} clauses must have the form (name value)`);
      }
      if (clause[0] === 'fact') {
        facts.push(clause[1]);
      } else {
        if (values.has(clause[0])) throw new Error(`${context} repeats clause ${clause[0]}`);
        values.set(clause[0], clause[1]);
      }
    }
    for (const field of values.keys()) {
      if (!['program', 'input', 'expected', 'goal'].includes(field)) {
        throw new Error(`${context} has unsupported clause ${field}`);
      }
    }
    const program = requireLeaf(values.get('program'), `${context} program`);
    const hasReduction = values.has('input') || values.has('expected');
    const hasProof = values.has('goal') || facts.length > 0;
    if (hasReduction === hasProof) {
      throw new Error(`${context} must define exactly one reduction or proof case`);
    }
    if (hasReduction && (!values.has('input') || !values.has('expected'))) {
      throw new Error(`${context} reduction requires input and expected clauses`);
    }
    if (hasProof && !values.has('goal')) {
      throw new Error(`${context} proof requires a goal clause`);
    }
    const key = JSON.stringify([contract, obligation]);
    if (this.conformanceCases.has(key)) throw new Error(`duplicate ${context}`);
    this.conformanceCases.set(key, {
      contract,
      obligation,
      program,
      input: values.get('input'),
      expected: values.get('expected'),
      goal: values.get('goal'),
      facts,
    });
  }

  #addProofObligation(form) {
    if (form.length < 3) throw new Error('proof-obligation must have a contract and clauses');
    const contract = requireLeaf(form[1], 'proof-obligation contract');
    const data = new Map();
    for (const clause of form.slice(2)) {
      if (!Array.isArray(clause) || clause.length !== 2 || typeof clause[0] !== 'string') {
        throw new Error(`proof-obligation ${contract} clauses must have the form (name value)`);
      }
      if (data.has(clause[0])) {
        throw new Error(`proof-obligation ${contract} repeats clause ${clause[0]}`);
      }
      data.set(clause[0], clause[1]);
    }
    for (const field of data.keys()) {
      if (!['obligation', 'proof', 'judgement'].includes(field)) {
        throw new Error(`proof-obligation ${contract} has unsupported clause ${field}`);
      }
    }
    for (const field of ['obligation', 'proof', 'judgement']) {
      if (!data.has(field)) throw new Error(`proof-obligation ${contract} is missing ${field}`);
    }
    const obligation = requireLeaf(data.get('obligation'), `proof-obligation ${contract} name`);
    const proof = requireLeaf(data.get('proof'), `proof-obligation ${contract} proof`);
    if (!Array.isArray(data.get('judgement'))) {
      throw new Error(`proof-obligation ${contract}.${obligation} judgement must be a link`);
    }
    const key = JSON.stringify([contract, obligation]);
    if (this.proofObligations.has(key)) {
      throw new Error(`duplicate proof-obligation ${contract}.${obligation}`);
    }
    this.proofObligations.set(key, {
      contract,
      obligation,
      proof,
      judgement: data.get('judgement'),
    });
  }

  #validateTrustedFoundation() {
    if (this.implementationContracts.size === 0) {
      throw new Error('trusted foundation does not declare any implementation contracts');
    }
    for (const [contractName, contract] of this.implementationContracts) {
      for (const obligation of contract.obligations) {
        if (!this.conformanceCases.has(JSON.stringify([contractName, obligation]))) {
          throw new Error(
            `implementation-contract ${contractName} has no conformance-case for ${obligation}`,
          );
        }
      }
    }
    for (const testCase of this.conformanceCases.values()) {
      const contract = this.implementationContracts.get(testCase.contract);
      if (!contract || !contract.obligations.includes(testCase.obligation)) {
        throw new Error(
          `conformance-case ${testCase.contract}.${testCase.obligation} is not in its contract`,
        );
      }
    }
    for (const obligation of this.proofObligations.values()) {
      const contract = this.implementationContracts.get(obligation.contract);
      if (!contract) {
        throw new Error(
          `proof-obligation ${obligation.contract}.${obligation.obligation} has unknown contract`,
        );
      }
      if (!contract.obligations.includes(obligation.obligation)) {
        throw new Error(
          `proof-obligation ${obligation.contract}.${obligation.obligation} is not in its contract`,
        );
      }
    }
  }

  #addTheory(form) {
    if (form.length < 3) throw new Error('theory must have a name and address');
    const name = requireLeaf(form[1], 'theory name');
    const data = clauses(form, `theory ${name}`);
    const address = data.get('address');
    if (!address) throw new Error(`theory ${name} is missing address`);
    if (this.theories.has(name)) throw new Error(`duplicate theory ${name}`);
    if ([...this.theories.values()].some(theory => theory.address === address)) {
      throw new Error(`duplicate theory address ${address}`);
    }
    this.theories.set(name, { name, address });
  }

  #addTerm(form) {
    if (form.length !== 4) {
      throw new Error('term must have the form (term theory local-name address)');
    }
    const theory = requireLeaf(form[1], 'term theory');
    const term = requireLeaf(form[2], 'term name');
    const address = requireLeaf(form[3], 'term address');
    const key = JSON.stringify([theory, term]);
    const previous = this.terms.get(key);
    if (previous && previous.address !== address) {
      throw new Error(`term ${theory}.${term} maps to both ${previous.address} and ${address}`);
    }
    this.terms.set(key, { theory, term, address });
  }

  #addDefinition(form) {
    if (form.length < 3) throw new Error('definition must have a name and clauses');
    const name = requireLeaf(form[1], 'definition name');
    if (this.definitions.some(definition => definition.name === name)) {
      throw new Error(`duplicate definition ${name}`);
    }
    const data = clauses(form, `definition ${name}`);
    for (const field of ['subject', 'using', 'witness']) {
      if (!data.has(field)) throw new Error(`definition ${name} is missing ${field}`);
    }
    this.definitions.push({
      name,
      subject: data.get('subject'),
      using: data.get('using'),
      witness: data.get('witness'),
    });
  }

  #addImplementation(form) {
    if (form.length < 3) throw new Error('implementation must have a name and clauses');
    const name = requireLeaf(form[1], 'implementation name');
    if (this.implementations.has(name)) throw new Error(`duplicate implementation ${name}`);
    const { data, obligations } = implementationClauses(
      form,
      `implementation ${name}`,
    );
    const fields = new Set(['contract', 'program', 'kind', 'subject', 'using']);
    for (const field of data.keys()) {
      if (!fields.has(field)) {
        throw new Error(`implementation ${name} has unsupported clause ${field}`);
      }
    }
    for (const field of ['contract', 'program', 'kind', 'subject', 'using']) {
      if (!data.has(field)) throw new Error(`implementation ${name} is missing ${field}`);
    }
    if (obligations.length === 0) {
      throw new Error(`implementation ${name} is missing obligations`);
    }
    this.implementations.set(name, {
      name,
      contract: data.get('contract'),
      program: data.get('program'),
      kind: data.get('kind'),
      subject: data.get('subject'),
      using: data.get('using'),
      obligations,
    });
  }

  #addWitness(form) {
    if (form.length < 3) throw new Error('witness must have an address and clauses');
    const address = requireLeaf(form[1], 'witness address');
    if (this.witnesses.has(address)) throw new Error(`duplicate witness ${address}`);
    const data = clauses(form, `witness ${address}`);
    for (const field of ['kind', 'implementation', 'proof']) {
      if (!data.has(field)) throw new Error(`witness ${address} is missing ${field}`);
    }
    this.witnesses.set(address, {
      address,
      kind: data.get('kind'),
      implementation: data.get('implementation'),
      proof: data.get('proof'),
    });
  }

  #validate() {
    if (!this.metaLanguageRoundTripOk) {
      throw new Error('candidate theory source failed its meta-language round trip');
    }
    if (!this.trustedFoundationRoundTripOk) {
      throw new Error('trusted foundation failed its meta-language round trip');
    }
    for (const { theory, term } of this.terms.values()) {
      if (!this.theories.has(theory)) {
        throw new Error(`term ${theory}.${term} references unknown theory ${theory}`);
      }
    }
    for (const definition of this.definitions) {
      if (!this.theories.has(definition.subject)) {
        throw new Error(`definition ${definition.name} has unknown subject ${definition.subject}`);
      }
      if (!this.theories.has(definition.using)) {
        throw new Error(`definition ${definition.name} uses unknown theory ${definition.using}`);
      }
      if (!this.witnesses.has(definition.witness)) {
        throw new Error(
          `definition ${definition.name} has unknown witness ${definition.witness}`,
        );
      }
      const witness = this.witnesses.get(definition.witness);
      const implementation = this.implementations.get(witness.implementation);
      if (!implementation) {
        throw new Error(
          `witness ${witness.address} uses unknown implementation ${witness.implementation}`,
        );
      }
      const obligations = this.#verifyImplementation(definition, witness, implementation);
      const verdict = checkProofObject(this.proofEnv, witness.proof);
      if (!verdict.ok) {
        throw new Error(
          `witness ${witness.address} has invalid proof ${witness.proof}: ${verdict.error}`,
        );
      }
      const proof = this.proofEnv.getProofObject(witness.proof);
      const expectedConclusion = [
        definition.name,
        'defines',
        definition.subject,
        'using',
        definition.using,
        'via',
        witness.implementation,
        'as',
        witness.kind,
      ];
      if (!isStructurallySame(proof.conclusion, expectedConclusion)) {
        throw new Error(
          `proof ${witness.proof} does not establish definition ${definition.name}`,
        );
      }
      this.verifications.set(definition.name, {
        definition: definition.name,
        witness: witness.address,
        proof: witness.proof,
        implementation: witness.implementation,
        kind: witness.kind,
        obligations,
        verified: true,
      });
    }
  }

  #verifyImplementation(definition, witness, implementation) {
    const contract = this.implementationContracts.get(implementation.contract);
    if (contract === undefined) {
      throw new Error(
        `implementation ${implementation.name} uses unknown contract ${implementation.contract}`,
      );
    }
    for (const obligation of this.proofObligations.values()) {
      if (obligation.contract !== implementation.contract) continue;
      const verdict = checkProofObject(this.proofEnv, obligation.proof);
      const proof = this.proofEnv.getProofObject(obligation.proof);
      if (!verdict.ok || proof === null ||
          !isStructurallySame(proof.conclusion, obligation.judgement)) {
        throw new Error(
          `proof-obligation ${obligation.contract}.${obligation.obligation} failed proof replay`,
        );
      }
    }
    if (implementation.kind !== contract.kind) {
      throw new Error(
        `implementation ${implementation.name} contract ${implementation.contract} requires ` +
        `kind ${contract.kind}, not ${implementation.kind}`,
      );
    }
    if (implementation.kind !== witness.kind) {
      throw new Error(
        `implementation ${implementation.name} requires kind ${implementation.kind}, not ` +
        witness.kind,
      );
    }
    if (implementation.subject !== definition.subject ||
        implementation.using !== definition.using) {
      throw new Error(
        `implementation ${implementation.name} is declared for ` +
        `${implementation.subject} using ${implementation.using}, not ` +
        `${definition.subject} using ${definition.using}`,
      );
    }
    const declaredObligations = [...implementation.obligations].sort(compareReferences);
    const expectedObligations = [...contract.obligations].sort(compareReferences);
    if (!isStructurallySame(declaredObligations, expectedObligations)) {
      throw new Error(
        `implementation ${implementation.name} obligations do not match contract ` +
        implementation.contract,
      );
    }

    if (definition.subject !== definition.using) {
      const subjectAddresses = new Set(
        [...this.terms.values()]
          .filter(term => term.theory === definition.subject)
          .map(term => term.address),
      );
      const sharesAddress = [...this.terms.values()].some(term =>
        term.theory === definition.using && subjectAddresses.has(term.address));
      if (!sharesAddress) {
        throw new Error(
          `implementation ${witness.implementation} has no shared concept between ` +
          `${definition.subject} and ${definition.using}`,
        );
      }
    }

    if (!this.linkedPrograms.has(implementation.program)) {
      throw new Error(
        `implementation ${implementation.name} uses unknown linked-program ${implementation.program}`,
      );
    }
    for (const obligation of contract.obligations) {
      const testCase = this.conformanceCases.get(
        JSON.stringify([implementation.contract, obligation]),
      );
      if (testCase.program !== implementation.program) {
        throw new Error(
          `implementation ${implementation.name} program ${implementation.program} does not match ` +
          `${implementation.contract}.${obligation} program ${testCase.program}`,
        );
      }
      if (testCase.input !== undefined) {
        const result = this.linkedPrograms.reduce(testCase.program, testCase.input);
        if (!isStructurallySame(result.term, testCase.expected)) {
          throw new Error(
            `implementation ${implementation.name} failed reduction conformance ` +
            `${implementation.contract}.${obligation}`,
          );
        }
      } else {
        const verdict = this.linkedPrograms.prove(testCase.program, testCase.goal, {
          facts: testCase.facts,
        });
        if (!verdict.ok) {
          throw new Error(
            `implementation ${implementation.name} failed proof conformance ` +
            `${implementation.contract}.${obligation}`,
          );
        }
      }
    }
    return [...contract.obligations];
  }

  theoryNames() {
    return [...this.theories.keys()].sort();
  }

  definitionsFor(theory) {
    return this.definitions.filter(definition => definition.subject === theory);
  }

  definitionWitness(address) {
    const witness = this.witnesses.get(address);
    return witness ? { ...witness } : null;
  }

  implementation(name) {
    const implementation = this.implementations.get(name);
    return implementation ? {
      ...implementation,
      obligations: [...implementation.obligations],
    } : null;
  }

  definitionVerification(name) {
    const verification = this.verifications.get(name);
    return verification ? { ...verification } : null;
  }

  resolveTerm(theory, term) {
    return this.terms.get(JSON.stringify([theory, term]))?.address ?? null;
  }

  termsAt(address) {
    return [...this.terms.values()]
      .filter(term => term.address === address)
      .map(({ theory, term }) => ({ theory, term }))
      .sort((left, right) =>
        left.theory.localeCompare(right.theory) || left.term.localeCompare(right.term));
  }

  /** Translate a theory-local term through its shared address. */
  translateTerm(sourceTheory, sourceTerm, targetTheory) {
    const address = this.resolveTerm(sourceTheory, sourceTerm);
    if (address === null) return [];
    return this.termsAt(address)
      .filter(({ theory }) => theory === targetTheory)
      .map(({ term }) => term);
  }

  /** Find the shortest cycle-safe chain of definition links. */
  definitionChain(subject, foundation) {
    if (!this.theories.has(subject) || !this.theories.has(foundation)) return null;
    if (subject === foundation) return [subject];
    const queue = [[subject]];
    const visited = new Set([subject]);
    while (queue.length > 0) {
      const path = queue.shift();
      const current = path.at(-1);
      for (const definition of this.definitionsFor(current)) {
        const next = definition.using;
        if (next === foundation) return [...path, next];
        if (!visited.has(next)) {
          visited.add(next);
          queue.push([...path, next]);
        }
      }
    }
    return null;
  }
}

/** The unconstrained addressed-doublet substrate used by every interpretation. */
class LinkNetwork {
  constructor() {
    this.nodes = new Map();
  }

  define(address, source, target) {
    requireLeaf(address, 'link address');
    requireLeaf(source, 'link source');
    requireLeaf(target, 'link target');
    if (this.nodes.has(address)) throw new Error(`link address ${address} is already defined`);
    this.nodes.set(address, { source, target });
    return address;
  }

  /** Return the doublet stored at an address, without exposing mutable state. */
  doublet(address) {
    const node = this.nodes.get(address);
    return node ? { ...node } : null;
  }

  /** Return a deterministic immutable view of every addressed doublet. */
  entries() {
    return [...this.nodes.entries()]
      .map(([address, node]) => ({ address, ...node }))
      .sort((left, right) => compareReferences(left.address, right.address));
  }
}

/** A link network whose references and ordered-pair endpoints are type checked. */
class TypedLinkNetwork {
  constructor() {
    this.links = new LinkNetwork();
    this.typeFactLinks = new LinkNetwork();
    this.typeIndex = new Map();
  }

  /**
   * Construct the selectable recursively linked default ontology.
   *
   * Each canonical link's address is also its target. The source is its
   * classifier: Type classifies itself and SubType; SubType classifies Value.
   */
  static withDefaultOntology() {
    const network = new TypedLinkNetwork();
    network.links.define('Type', 'Type', 'Type');
    network.links.define('SubType', 'Type', 'SubType');
    network.links.define('Value', 'SubType', 'Value');
    network.declare('Type', 'Type');
    network.declare('SubType', 'Type');
    network.declare('Value', 'SubType');
    return network;
  }

  declare(address, type) {
    requireLeaf(address, 'typed reference address');
    requireLeaf(type, 'typed reference type');
    if (this.typesOf(address).includes(type)) return address;

    let factIndex = 0;
    let factAddress = `rml.type-fact.${factIndex}`;
    while (this.typeFactLinks.doublet(factAddress) !== null) {
      factAddress = `rml.type-fact.${++factIndex}`;
    }
    this.typeFactLinks.define(factAddress, address, type);

    if (this.typeIndex !== null) {
      const declared = this.typeIndex.get(address) ?? new Set();
      declared.add(type);
      this.typeIndex.set(address, declared);
    }
    return address;
  }

  define(address, source, target, sourceType, targetType) {
    requireLeaf(sourceType, 'link source type');
    requireLeaf(targetType, 'link target type');
    this.#requireType(source, sourceType, 'source');
    this.#requireType(target, targetType, 'target');
    this.links.define(address, source, target);
    this.declare(address, `(Pair ${sourceType} ${targetType})`);
    return address;
  }

  doublet(address) {
    return this.links.doublet(address);
  }

  typeOf(address) {
    const types = this.typesOf(address);
    return types.length === 1 ? types[0] : null;
  }

  typesOf(address) {
    if (this.typeIndex !== null) {
      return [...(this.typeIndex.get(address) ?? [])].sort(compareReferences);
    }
    return this.typeFacts()
      .filter(fact => fact.subject === address)
      .map(fact => fact.type)
      .sort(compareReferences);
  }

  /** The authoritative type relation, represented as addressed doublets. */
  typeFacts() {
    return this.typeFactLinks.entries().map(({ address, source, target }) => ({
      address,
      subject: source,
      type: target,
    }));
  }

  /** Discard the derived host index; subsequent queries read linked facts. */
  clearTypeIndex() {
    this.typeIndex = null;
  }

  /** Rebuild the optional acceleration index solely from linked facts. */
  rebuildTypeIndex() {
    const rebuilt = new Map();
    for (const { subject, type } of this.typeFacts()) {
      const declared = rebuilt.get(subject) ?? new Set();
      declared.add(type);
      rebuilt.set(subject, declared);
    }
    this.typeIndex = rebuilt;
  }

  /** Return the semantic network state without its disposable cache. */
  snapshot() {
    return {
      links: this.links.entries(),
      typeFacts: this.typeFacts(),
    };
  }

  /**
   * Check whether every endpoint and every type fact resolves to a link.
   * General typed networks may intentionally be open; the default is closed.
   */
  validateClosure() {
    const missing = new Set();
    const requireDefined = reference => {
      if (this.links.doublet(reference) === null) missing.add(reference);
    };
    for (const { source, target } of this.links.entries()) {
      requireDefined(source);
      requireDefined(target);
    }
    for (const { subject, type } of this.typeFacts()) {
      requireDefined(subject);
      requireDefined(type);
    }
    const missingReferences = [...missing].sort(compareReferences);
    return { closed: missingReferences.length === 0, missingReferences };
  }

  /**
   * Compare this ontology with link-cli's pinned construction without
   * assuming that symbolic names and reserved numeric identities coincide.
   */
  linkCliInteropProfile() {
    const numericAddresses = new Map([['Type', 1], ['SubType', 2], ['Value', 3]]);
    const pinnedTypes = [...numericAddresses].map(([rmlAddress, address]) => {
      const link = this.doublet(rmlAddress);
      const source = numericAddresses.get(link?.source);
      const target = numericAddresses.get(link?.target);
      const mappedRmlShape = source === undefined || target === undefined
        ? null
        : { address, source, target };
      const linkCliShape = { address, source: 1, target: address };
      return {
        rmlAddress,
        mappedRmlShape,
        linkCliShape,
        exactShape: mappedRmlShape !== null &&
          mappedRmlShape.source === linkCliShape.source &&
          mappedRmlShape.target === linkCliShape.target,
      };
    });

    return {
      revision: 'e801cb877f8ed90a103ee253add6f702da89ee40',
      pinnedTypes,
      unicode: {
        linkCliShape: ['raw-number', 'unicode-symbol-type'],
        mapsToRml: ['type-fact-subject', 'type-fact-type'],
        typeFactOrientationCompatible: true,
        canonicalDefinitionOrientationCompatible: false,
      },
      names: {
        storage: 'separate-names-link-database',
        numericIdentityRequired: false,
      },
    };
  }

  #requireType(address, expected, role) {
    const declared = this.typesOf(address);
    if (declared.length === 0) {
      throw new Error(`typed link ${role} ${address} has no declared type`);
    }
    if (!declared.includes(expected)) {
      const actual = declared.join(', ');
      throw new Error(
        `typed link ${role} ${address} has type ${actual}; expected ${expected}`,
      );
    }
  }
}

/**
 * Store finite trees and right-spine sequences in a links network.
 * Cycles are legal links, but only bounded `walk` observes them productively.
 */
class DoubletSequenceStore extends LinkNetwork {
  define(address, source, target) {
    requireLeaf(address, 'sequence address');
    requireLeaf(source, 'sequence source');
    requireLeaf(target, 'sequence target');
    if (address === EMPTY_SEQUENCE) throw new Error(`${EMPTY_SEQUENCE} is reserved`);
    if (this.nodes.has(address)) throw new Error(`sequence address ${address} is already defined`);
    this.nodes.set(address, { source, target });
    return address;
  }

  walk(head, limit) {
    requireLeaf(head, 'sequence head');
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('sequence limit must be a non-negative safe integer');
    }
    const values = [];
    const seen = new Map();
    let current = head;
    let cycleAt = null;
    while (current !== EMPTY_SEQUENCE && values.length < limit) {
      if (!seen.has(current)) seen.set(current, values.length);
      const node = this.nodes.get(current);
      if (!node) throw new Error(`unknown sequence address ${current}`);
      values.push(node.source);
      current = node.target;
      if (current !== EMPTY_SEQUENCE && seen.has(current) && cycleAt === null) {
        cycleAt = seen.get(current);
      }
    }
    return {
      values,
      complete: current === EMPTY_SEQUENCE,
      cyclic: cycleAt !== null,
      cycleAt,
    };
  }

  /**
   * Encode a finite sequence as a nested tree of addressed doublets.
   * The returned sequence is the root link itself; leaves remain references.
   */
  encodeSequence(values, address = 'rml.sequence', layout = 'balanced') {
    requireLeaf(address, 'sequence address');
    const references = Array.from(values, value => requireLeaf(value, 'sequence value'));
    if (!['balanced', 'left', 'right'].includes(layout)) {
      throw new Error('sequence layout must be balanced, left, or right');
    }
    if (references.length === 0) return EMPTY_SEQUENCE;
    if (references.length === 1) return references[0];

    const leaf = value => ({ value });
    const branch = (source, target) => ({ source, target });
    let tree;
    if (layout === 'left') {
      tree = branch(leaf(references[0]), leaf(references[1]));
      for (const value of references.slice(2)) tree = branch(tree, leaf(value));
    } else if (layout === 'right') {
      tree = leaf(references.at(-1));
      for (let index = references.length - 2; index >= 0; index--) {
        tree = branch(leaf(references[index]), tree);
      }
    } else {
      const balancedTree = items => {
        if (items.length === 1) return leaf(items[0]);
        const middle = Math.floor(items.length / 2);
        return branch(balancedTree(items.slice(0, middle)), balancedTree(items.slice(middle)));
      };
      tree = balancedTree(references);
    }

    let nextCell = 0;
    const entries = [];
    const serialize = node => {
      if ('value' in node) return node.value;
      const nodeAddress = `${address}.cell.${nextCell++}`;
      const source = serialize(node.source);
      const target = serialize(node.target);
      entries.push([nodeAddress, source, target]);
      return nodeAddress;
    };
    const head = serialize(tree);

    for (const [nodeAddress] of entries) {
      if (this.nodes.has(nodeAddress)) {
        throw new Error(`sequence address ${nodeAddress} is already defined`);
      }
      if (references.includes(nodeAddress)) {
        throw new Error(`sequence value ${nodeAddress} collides with an internal link`);
      }
    }
    for (const [nodeAddress, source, target] of entries) {
      this.define(nodeAddress, source, target);
    }
    return head;
  }

  /** Decode a finite nested-doublet sequence in left-to-right leaf order. */
  decodeSequence(head) {
    requireLeaf(head, 'sequence head');
    const values = [];
    const active = new Set();
    const visit = reference => {
      if (reference === EMPTY_SEQUENCE) return;
      const node = this.nodes.get(reference);
      if (!node) {
        values.push(reference);
        return;
      }
      if (active.has(reference)) throw new Error(`sequence ${head} is cyclic`);
      active.add(reference);
      visit(node.source);
      visit(node.target);
      active.delete(reference);
    };
    visit(head);
    return values;
  }

  encodeOrderedSet(values, address = 'rml.sequence') {
    requireLeaf(address, 'ordered set address');
    const references = Array.from(values, value => requireLeaf(value, 'ordered set value'));
    const unique = new Set();
    for (const value of references) {
      if (unique.has(value)) throw new Error(`ordered set contains duplicate ${value}`);
      unique.add(value);
    }
    return this.encodeSequence(references, address, 'balanced');
  }

  decodeOrderedSet(head) {
    requireLeaf(head, 'ordered set head');
    let values;
    try {
      values = this.decodeSequence(head);
    } catch (error) {
      if (error.message === `sequence ${head} is cyclic`) {
        throw new Error(`ordered set must be finite; ${head} is cyclic`);
      }
      throw error;
    }
    const valuesSeen = new Set();
    for (const value of values) {
      if (valuesSeen.has(value)) {
        throw new Error(`ordered set contains duplicate ${value}`);
      }
      valuesSeen.add(value);
    }
    return values;
  }

  /** Encode an extensional finite set in canonical reference order. */
  encodeSet(values, address = 'rml.set') {
    requireLeaf(address, 'set address');
    const unique = new Set(
      Array.from(values, value => requireLeaf(value, 'set value')),
    );
    const canonical = [...unique].sort(compareReferences);
    return this.encodeSequence(canonical, address, 'balanced');
  }

  /** Decode a canonical finite-set tree and verify its ordering invariant. */
  decodeSet(head) {
    const values = this.decodeSequence(head);
    for (let index = 1; index < values.length; index++) {
      if (compareReferences(values[index - 1], values[index]) >= 0) {
        throw new Error(`set ${head} is not in strict canonical order`);
      }
    }
    return values;
  }
}

/** Extensional finite sets represented by addressed `(element, set)` links. */
class MembershipSetStore {
  constructor() {
    this.doublets = new LinkNetwork();
    this.memberships = new Map();
  }

  define(address, element, set) {
    requireLeaf(element, 'set member');
    requireLeaf(set, 'set address');
    this.doublets.define(address, element, set);
    this.memberships.set(address, { element, set });
    return address;
  }

  has(set, element) {
    return [...this.memberships.values()].some(link =>
      link.set === set && link.element === element);
  }

  members(set) {
    return [...new Set(
      [...this.memberships.values()]
        .filter(link => link.set === set)
        .map(link => link.element),
    )].sort(compareReferences);
  }

  equals(left, right) {
    return isStructurallySame(this.members(left), this.members(right));
  }

  isSubsetOf(left, right) {
    return this.members(left).every(element => this.has(right, element));
  }

  pair(left, right) {
    requireLeaf(left, 'pair left value');
    requireLeaf(right, 'pair right value');
    return [...new Set([left, right])].sort(compareReferences);
  }

  /** Flatten a finite set whose members are addresses of finite sets. */
  union(collection) {
    return [...new Set(
      this.members(collection).flatMap(set => this.members(set)),
    )].sort(compareReferences);
  }

  separation(set, predicate) {
    if (typeof predicate !== 'function') throw new Error('set predicate must be a function');
    return this.members(set).filter(element => predicate(element));
  }

  replacement(set, mapping) {
    if (typeof mapping !== 'function') throw new Error('set mapping must be a function');
    return [...new Set(
      this.members(set).map(element =>
        requireLeaf(mapping(element), 'replacement output')),
    )].sort(compareReferences);
  }
}

/** A finite directed graph, constrained to a vertex set, represented by links. */
class LinkGraph {
  constructor(address) {
    this.address = requireLeaf(address, 'graph address');
    this.vertexMemberships = new MembershipSetStore();
    this.vertexType = `${this.address}.vertex`;
    this.edges = new TypedLinkNetwork();
    this.edgeAddresses = new Set();
    this.nextVertexMembership = 0;
  }

  addVertex(vertex) {
    requireLeaf(vertex, 'graph vertex');
    if (this.vertexMemberships.has(this.address, vertex)) {
      throw new Error(`vertex ${vertex} is already in ${this.address}`);
    }
    const membership = `${this.address}.vertex-membership.${this.nextVertexMembership++}`;
    this.vertexMemberships.define(membership, vertex, this.address);
    this.edges.declare(vertex, this.vertexType);
    return vertex;
  }

  vertices() {
    return this.vertexMemberships.members(this.address);
  }

  defineEdge(address, source, target) {
    requireLeaf(source, 'edge source');
    requireLeaf(target, 'edge target');
    if (!this.vertexMemberships.has(this.address, source)) {
      throw new Error(`edge source ${source} is not a vertex of ${this.address}`);
    }
    if (!this.vertexMemberships.has(this.address, target)) {
      throw new Error(`edge target ${target} is not a vertex of ${this.address}`);
    }
    this.edges.define(address, source, target, this.vertexType, this.vertexType);
    this.edgeAddresses.add(address);
    return address;
  }

  edge(address) {
    return this.edgeAddresses.has(address) ? this.edges.doublet(address) : null;
  }

  edgeType(address) {
    return this.edgeAddresses.has(address) ? this.edges.typeOf(address) : null;
  }

  successors(vertex) {
    return [...new Set(
      [...this.edgeAddresses]
        .map(address => this.edges.doublet(address))
        .filter(edge => edge.source === vertex)
        .map(edge => edge.target),
    )].sort(compareReferences);
  }

  reachable(source, target) {
    if (!this.vertexMemberships.has(this.address, source) ||
        !this.vertexMemberships.has(this.address, target)) return false;
    const queue = [source];
    const visited = new Set([source]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === target) return true;
      for (const successor of this.successors(current)) {
        if (!visited.has(successor)) {
          visited.add(successor);
          queue.push(successor);
        }
      }
    }
    return false;
  }
}

/** A finite typed binary relation with standard set-theoretic operations. */
class FiniteRelation {
  constructor(address, domain, codomain) {
    this.address = requireLeaf(address, 'relation address');
    this.domain = [...new Set(
      Array.from(domain, value => requireLeaf(value, 'relation domain value')),
    )].sort(compareReferences);
    this.codomain = [...new Set(
      Array.from(codomain, value => requireLeaf(value, 'relation codomain value')),
    )].sort(compareReferences);
    this.domainSet = new Set(this.domain);
    this.codomainSet = new Set(this.codomain);
    this.typeMemberships = new MembershipSetStore();
    this.links = new TypedLinkNetwork();
    this.relationPairs = new Map();
    this.domain.forEach((value, index) => {
      this.typeMemberships.define(`${address}.domain.${index}`, value, `${address}.domain`);
      this.links.declare(value, `${address}.domain`);
    });
    this.codomain.forEach((value, index) => {
      this.typeMemberships.define(`${address}.codomain.${index}`, value, `${address}.codomain`);
      this.links.declare(value, `${address}.codomain`);
    });
  }

  define(address, left, right) {
    requireLeaf(left, 'relation left value');
    requireLeaf(right, 'relation right value');
    if (!this.domainSet.has(left)) {
      throw new Error(`relation left value ${left} is outside the declared domain`);
    }
    if (!this.codomainSet.has(right)) {
      throw new Error(`relation right value ${right} is outside the declared codomain`);
    }
    if (this.pairs().some(pair => pair[0] === left && pair[1] === right)) {
      throw new Error(`relation ${this.address} already contains (${left}, ${right})`);
    }
    this.links.define(
      address,
      left,
      right,
      `${this.address}.domain`,
      `${this.address}.codomain`,
    );
    this.relationPairs.set(address, [left, right]);
    return address;
  }

  has(left, right) {
    return this.pairs().some(pair => pair[0] === left && pair[1] === right);
  }

  pairType(address) {
    return this.relationPairs.has(address) ? this.links.typeOf(address) : null;
  }

  pairs() {
    return [...this.relationPairs.values()]
      .map(pair => [...pair])
      .sort(comparePairs);
  }

  converse(address) {
    return relationFromPairs(
      address,
      this.codomain,
      this.domain,
      this.pairs().map(([left, right]) => [right, left]),
    );
  }

  union(other, address) {
    this.#requireSameSignature(other, 'union');
    return relationFromPairs(address, this.domain, this.codomain, [
      ...this.pairs(),
      ...other.pairs(),
    ]);
  }

  intersection(other, address) {
    this.#requireSameSignature(other, 'intersection');
    return relationFromPairs(
      address,
      this.domain,
      this.codomain,
      this.pairs().filter(([left, right]) => other.has(left, right)),
    );
  }

  compose(next, address) {
    if (!isStructurallySame(this.codomain, next.domain)) {
      throw new Error('relation composition requires the first codomain to equal the next domain');
    }
    const pairs = [];
    for (const [left, middle] of this.pairs()) {
      for (const [nextMiddle, right] of next.pairs()) {
        if (middle === nextMiddle) pairs.push([left, right]);
      }
    }
    return relationFromPairs(address, this.domain, next.codomain, pairs);
  }

  #requireSameSignature(other, operation) {
    if (!isStructurallySame(this.domain, other.domain) ||
        !isStructurallySame(this.codomain, other.codomain)) {
      throw new Error(`relation ${operation} requires equal domains and codomains`);
    }
  }
}

function relationFromPairs(address, domain, codomain, pairs) {
  const relation = new FiniteRelation(address, domain, codomain);
  const unique = new Map();
  for (const [left, right] of pairs) unique.set(JSON.stringify([left, right]), [left, right]);
  [...unique.values()].sort(comparePairs).forEach(([left, right], index) => {
    relation.define(`${address}.pair.${index}`, left, right);
  });
  return relation;
}

function comparePairs(left, right) {
  return compareReferences(left[0], right[0]) || compareReferences(left[1], right[1]);
}

function compareReferences(left, right) {
  const leftPoints = [...left].map(character => character.codePointAt(0));
  const rightPoints = [...right].map(character => character.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index++) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export {
  DoubletSequenceStore,
  EMPTY_SEQUENCE,
  FiniteRelation,
  LinkGraph,
  LinkNetwork,
  MembershipSetStore,
  TheoryNetwork,
  TypedLinkNetwork,
};
