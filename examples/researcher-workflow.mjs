#!/usr/bin/env node
/** Reproducible public-API research lifecycle. No assertion here replaces verification. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AddressSequence } from '../js/src/rml-address-sequence.mjs';
import { TypedLinkNetwork } from '../js/src/rml-theory-network.mjs';
import { TypedSemanticArchive } from '../js/src/rml-semantic-archive.mjs';
import { FoundationPackages } from '../js/src/rml-foundation-packages.mjs';
import { LinkedProgramRegistry, directMatchTerm } from '../js/src/rml-linked-program.mjs';
import { verifyLinkedProof, replayLinkedProof } from '../js/src/rml-linked-proof.mjs';
import { parseLinoForms, keyOf } from '../js/src/rml-links.mjs';
import { parseRmlToMetaLanguage, serializeRmlStructure, deserializeRmlStructure, emitRmlFromStructure } from '../js/src/rml-meta-language.mjs';
import { translatePortableNatural, parsePortableNatural, evaluatePortableNatural } from '../js/src/rml-portable-natural.mjs';
import { analyzeProgram, ProgramRepresentation, languageSupport } from '../js/src/rml-upstream-language.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
export const selection = version => ({ name: 'review-policy', version, instance: 'review' });
export function researcherPackages() {
  return ['one', 'two'].map((word, index) => {
    const version = String(index + 1);
    return { name: 'review-policy', version, source: `${read(`test-corpus/researcher-workflow/foundation-${word}.lino`)}\n${read('test-corpus/researcher-workflow/theory.lino')}\n(linked-instance review (theory submissions) (foundation review-policy (version ${version})))`, imports: [] };
  });
}
export function proofRegistry(executionBasis = 'direct-structural') {
  return LinkedProgramRegistry.fromRml(`${read('lib/meta-theory/universal.lino')}\n${read('lib/meta-theory/proof-verifier.lino')}`, { executionBasis });
}

/** Data adapter for finite inductive proofs with unrewritten premises.
 * It reads caller-selected source and recorded proof trees, never admits a proof.
 * Rebinding, imports, assumptions and coinduction require their own explicit exporter.
 */
export function certificateFromResult(manifest, answer) {
  if (answer.package.name !== manifest.name || answer.package.version !== manifest.version || answer.result.assumptions.length || !answer.result.proof || answer.result.cyclePolicy.kind !== 'inductive' || (manifest.imports?.length ?? 0)) throw new Error('certificate export requires a matching unimported inductive source and assumption-free proof');
  const variable = term => Array.isArray(term) ? term.map(variable) : term.startsWith('?') ? ['variable', term.slice(1)] : term;
  const forms = parseLinoForms(manifest.source);
  const foundation = forms.find(form => form[0] === 'linked-foundation' && form[1] === manifest.name && form.some(clause => Array.isArray(clause) && clause[0] === 'version' && clause[1] === manifest.version));
  const instance = forms.find(form => form[0] === 'linked-instance' && form[1] === answer.result.instance);
  const theory = instance?.find(clause => Array.isArray(clause) && clause[0] === 'theory');
  const selected = instance?.find(clause => Array.isArray(clause) && clause[0] === 'foundation');
  if (!foundation || !theory || theory.length !== 2 || selected?.[1] !== manifest.name || selected?.some(clause => Array.isArray(clause) && clause[0] === 'version' && clause[1] !== manifest.version) || foundation.some(clause => Array.isArray(clause) && clause[0] === 'depends-on')) throw new Error('certificate source needs a direct, unbound theory and foundation');
  // Derive context from caller-owned declarations, never the proof's claimed dependencies.
  const permitted = new Set([theory[1], ...foundation.filter(clause => Array.isArray(clause) && ['axioms', 'inference', 'typing'].includes(clause[0])).map(clause => clause[1])]);
  if (forms.some(form => form[0] === 'linked-program' && permitted.has(form[1]) && form.length !== 2)) throw new Error('certificate source imports need an explicit exporter');
  const rules = forms.filter(form => ['linked-fact', 'linked-inference'].includes(form[0]) && permitted.has(form[1])).map(form => ({
    id: `${form[1]}.${form[2]}`, premises: form.slice(3).filter(clause => clause[0] === 'premise').map(clause => clause[1]),
    conclusion: form.slice(3).find(clause => ['judgement', 'conclusion'].includes(clause[0]))[1],
  }));
  const context = ['proof-context', [manifest.name, manifest.version], rules.map(rule => ['rule', rule.id, rule.premises.map(variable), variable(rule.conclusion)])];
  const nodes = [];
  const visit = proof => {
    const id = `n${nodes.length}`;
    nodes.push(null);
    const origin = answer.programs.find(item => item.address === proof.program);
    const rule = rules.find(item => item.id === `${origin?.program}.${proof.rule}`);
    if (!rule || rule.premises.length !== proof.premises.length) throw new Error('proof rule is absent from the selected source');
    const bindings = new Map();
    rule.premises.forEach((pattern, index) => {
      if (!directMatchTerm(pattern, proof.premises[index].judgement, bindings)) throw new Error('proof premise needs unsupported conversion');
    });
    // The checker reconstructs the conclusion from premise bindings; it must not
    // obtain an unbound variable merely by trusting the claimed conclusion.
    const dependencies = [rule.id];
    const children = proof.premises.map(child => {
      const result = visit(child);
      for (const dependency of result.dependencies) if (!dependencies.includes(dependency)) dependencies.push(dependency);
      return result.id;
    });
    const entry = ['node', id, rule.id, proof.judgement, [...bindings].reverse().map(([name, value]) => [name.slice(1), value]), children, dependencies];
    nodes[Number(id.slice(1))] = entry;
    return { id, dependencies };
  };
  const root = visit(answer.result.proof);
  const goal = answer.result.query;
  return { context, goal, candidate: ['proof', context, goal, root.id, nodes, root.dependencies] };
}

export function constructResearchObjects() {
  const typed = TypedLinkNetwork.withDefaultOntology();
  for (const name of ['Submission', 'SubmissionPair', 'Set', 'OrderedSet']) {
    typed.links.define(name, 'Type', name); typed.declare(name, 'Type');
  }
  typed.links.define('specimen', 'specimen', 'specimen'); typed.declare('specimen', 'Submission');
  typed.links.define('archive', 'archive', 'archive'); typed.declare('archive', 'Submission');
  typed.links.define('submitted-edge', 'specimen', 'archive'); typed.declare('submitted-edge', 'SubmissionPair');
  const collections = new AddressSequence('research-collections');
  for (const { address, source, target } of typed.links.entries()) collections.defineLink(address, source, target);
  const setRoot = collections.encodeSet(['submitted-edge', 'specimen', 'submitted-edge'], 'accepted-objects');
  const nestedRoot = collections.encodeSet([setRoot, setRoot], 'collection-of-collections');
  const orderedRoot = collections.encodeOrderedSet(['submitted-edge', 'specimen'], 'review-order');
  for (const { address, source, target } of collections.entries()) if (!typed.links.doublet(address)) typed.links.define(address, source, target);
  typed.declare(setRoot, 'Set'); typed.declare(nestedRoot, 'Set'); typed.declare(orderedRoot, 'OrderedSet');
  const archive = TypedSemanticArchive.fromNetwork(typed, { roots: [setRoot, nestedRoot, orderedRoot, 'submitted-edge', 'Submission'] });
  const restored = TypedSemanticArchive.deserialize(archive.serialize()).toTypedNetwork();
  restored.clearTypeIndex();
  const sourceFree = AddressSequence.fromSnapshot(JSON.parse(JSON.stringify(collections.snapshot())));
  return { typed: restored, collections: sourceFree, summary: {
    setRoot, nestedRoot, orderedRoot,
    setMembers: sourceFree.decodeSet(setRoot), nestedMembers: sourceFree.decodeSet(nestedRoot), orderedMembers: sourceFree.decodeOrderedSet(orderedRoot),
    nestedDistinct: nestedRoot !== setRoot, closed: restored.validateClosure().closed,
    edge: restored.doublet('submitted-edge'), edgeTypes: restored.typesOf('submitted-edge'), setTypes: restored.typesOf(setRoot),
  } };
}
export function executeResearchAlgorithm(workspace, members) {
  const list = members.reduceRight((tail, member) => ['cons', member, tail], 'nil');
  return workspace.execute(selection('1'), ['length', list]);
}

export function runResearcherWorkflow({ executionBasis = 's-k', manifests = researcherPackages() } = {}) {
  // Store only structured links, discard source tokens, then execute reconstructed RML.
  const restored = manifests.map(item => ({ ...item, source: emitRmlFromStructure(deserializeRmlStructure(serializeRmlStructure(parseRmlToMetaLanguage(item.source)))) }));
  const workspace = FoundationPackages.fromPackages(restored, { executionBasis });
  const query = ['publishable', 'specimen'];
  const first = workspace.ask(selection('1'), query);
  const second = workspace.ask(selection('2'), query);
  const certificate = certificateFromResult(restored[0], first);
  const registry = proofRegistry(executionBasis);
  const receipt = verifyLinkedProof(registry, certificate.context, certificate.goal, certificate.candidate);
  // A fresh registry independently replays all trace steps against caller-owned context.
  const replay = replayLinkedProof(proofRegistry(executionBasis), certificate.context, certificate.goal, receipt);
  const objects = constructResearchObjects();
  const execution = executeResearchAlgorithm(workspace, objects.summary.setMembers);
  const change = { replaceRule: ['linked-fact', 'submissions', 'submitted', ['judgement', ['input', 'other']]] };
  const revised = workspace.revise([first, second], selection('1'), change);
  const languageSources = JSON.parse(read('test-corpus/researcher-workflow/languages.json'));
  const languages = languageSources.map(({ language, source }) => {
    const program = analyzeProgram(source, language);
    const exported = ProgramRepresentation.fromSnapshot(JSON.parse(program.serializeSnapshot())).emit();
    return { language, sourcePreserved: exported === source, syntaxClean: program.network.verifyFullMatch().isClean(), typeElaboration: languageSupport(language).typeElaboration };
  });
  const translations = languageSources.flatMap(({ language: from, source }) => languageSources.filter(({ language }) => language !== from).map(({ language: to }) => {
    const result = translatePortableNatural(source, from, to);
    if (result.status !== 'translated-fragment') throw new Error(JSON.stringify(result.obligations));
    const imported = parsePortableNatural(result.targetSource, to);
    return { from, to, status: result.status, observation: evaluatePortableNatural(imported.network, 'successor', [7]).toString(), verification: result.stages.verification };
  }));
  const report = {
    schema: 'rml-researcher-workflow/v1', executionBasis,
    foundations: workspace.packages(),
    theory: first.result.theory.name, assumptions: first.result.assumptions, objects: objects.summary,
    comparison: [first, second].map(answer => ({ version: answer.package.version, status: answer.result.status })),
    proof: { accepted: receipt.accepted, replayMatches: replay.matches, dependencies: certificate.candidate[5], nodes: certificate.candidate[4].length },
    execution: { status: execution.result.status, output: keyOf(execution.result.output) },
    invalidation: revised.revisions.map(item => ({ action: item.action, changed: item.changed, status: item.after.result.status })),
    originalStatus: workspace.ask(selection('1'), query).result.status,
    languages, translations,
  };
  return { report, workspace, first, second, certificate, receipt, revised, manifests: restored, objects };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && args[0] !== '--direct') throw new Error('Usage: node examples/researcher-workflow.mjs [--direct]');
  console.log(JSON.stringify(runResearcherWorkflow({ executionBasis: args[0] === '--direct' ? 'direct-structural' : 's-k' }).report, null, 2));
}
