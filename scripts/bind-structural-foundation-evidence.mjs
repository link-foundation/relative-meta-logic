#!/usr/bin/env node
/** Produce source-pinned candidate bindings without changing original obligations. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, validateIssue183Inventory } from './issue-183-requirements.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'docs/case-studies/issue-183';
const ids = ['R128', 'R138', 'R139', 'R140', 'R141', 'R142'];
const walk = (root, relative) => fs.readdirSync(path.join(root, relative), {withFileTypes:true}).flatMap(entry => {
  const name = `${relative}/${entry.name}`;
  if (entry.isSymbolicLink()) throw new Error(`source pin refuses symlink: ${name}`);
  return entry.isDirectory() ? walk(root, name) : entry.isFile() ? [name] : [];
});

export function structuralFoundationEvidenceCandidate(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, BASE, 'requirements.manifest.json'), 'utf8'));
  const sources = JSON.parse(fs.readFileSync(path.join(root, manifest.sourceSnapshot.path), 'utf8'));
  let ledger = fs.readFileSync(path.join(root, BASE, 'requirements.md'), 'utf8');
  let baselineInventoryError = null;
  try { validateIssue183Inventory({root,manifest,sources,ledger}); } catch (error) { baselineInventoryError = error.message; }
  const original = new Map(manifest.requirements.map(row => [row.id, JSON.stringify({obligation:row.obligation,originalWording:row.originalWording})]));
  const pin = (relative, role) => ({path:relative,role,sha256:sha256(fs.readFileSync(path.join(root,relative)))});
  const common = [
    'scripts/issue-183-requirements.mjs',
    'scripts/issue-183-requirements-reporter.mjs',
    'scripts/bind-structural-foundation-evidence.mjs',
    'scripts/run-with-cache.mjs',
    'scripts/build-cache.mjs',
    'scripts/cache-policy.json',
    'scripts/check-linked-implementation.mjs',
    'js/vendor/meta-language-provenance.json',
    '.gitmodules',
    ...walk(root,'lib').filter(file => /\.(?:lino|json|gz)$/.test(file)),
  ];
  const inputs = {
    js: [...common,'js/package.json','js/package-lock.json',...walk(root,'js/src'),...walk(root,'js/vendor/meta-language/js/src'),'js/vendor/meta-language/js/package.json'],
    rust: [...common,'rust/Cargo.toml','rust/Cargo.lock',...walk(root,'rust/src')],
  };
  const families = [
    {id:'slotwise-self-incidence', js:'js/tests/slotwise-self-incidence.test.mjs', rust:'rust/tests/slotwise_self_incidence_tests.rs'},
    {id:'structural-foundation-evidence', js:'js/tests/structural-foundation-evidence.test.mjs', rust:'rust/tests/structural_foundation_evidence_tests.rs'},
  ];
  const checks = families.flatMap(family => ['js','rust'].map(language => {
    const file = family[language];
    const source = fs.readFileSync(path.join(root,file),'utf8');
    const names = language === 'js' ? [...source.matchAll(/test\('([^']+)'/g)].map(match => match[1]) : [...source.matchAll(/#\[test\]\s*fn\s+([a-z0-9_]+)/g)].map(match => match[1]);
    const assertions = names.map(name => ({file,name,polarity:/(?:^|[ _])rejects(?:[ _]|$)/.test(name) ? 'negative' : 'positive'}));
    const fixture = 'test-corpus/foundation-structural-evidence/certificates.json';
    const files = [...new Set([...inputs[language],file,...(family.id==='structural-foundation-evidence' ? [fixture] : [])])].sort().map(relative => pin(relative,relative===file ? 'test-and-fixture' : relative===fixture || relative.startsWith('lib/') ? 'fixture' : 'implementation'));
    return {id:`${family.id}-${language}`,kind:language==='js' ? 'node-test' : 'cargo-test',testFiles:[file],...(language==='rust'?{testTarget:path.basename(file,'.rs')}:{}),files,assertions,timeoutMs:1200000};
  }));
  const explanations = {
    R128: {
      status:'Complete as a claim guard',
      remainingGap:'The completed obligation is the preservation guard: address-renaming equivalence is contract-relative, occurrence permutation is unestablished, and direct/indirect incidence, address identity, arity and possible slot identity remain visible. No intrinsic ontology, endpoint roles or execution law is thereby established; those broader research obligations remain open.',
    },
    R138: {
      status:'Complete for the ordered address/equality contract',
      remainingGap:'The public generic functions classify each reference by equality with its link address at arbitrary finite arity. Mirrored masks through width eight, arity 4096, injective renaming, slot permutation, noninjective mutation and invalid-input tests exercise the implementation. Intrinsic slot identity and semantic roles are not part of this classification and remain unestablished.',
    },
    R139: {
      status:'Partial isolation removal proven; remaining assumption audit open',
      remainingGap:'The single-link-isolation removal produces an exact countermodel and exhaustive shared-address invariants, but finite size, ordered records, one reference per link, distinct link identities and equality-only observation remain declared restrictions. This does not complete the original one-at-a-time audit of all remaining assumptions or establish independent link-derived necessity for each.',
    },
    R140: {
      status:'Partial raw-structure countermodel; intrinsic continuation law open',
      remainingGap:'The raw identity/equality/incidence/recursion countermodel is executable, but originalWording also includes reviews 5819808597 and 5821335636. They require investigation of what makes a continuation follow, faithful-representation and arbitrary-replacement tests, assumption removal, and self-applicability without an observer-selected projection. Existing conditional readouts and finite negatives do not establish the missing intrinsic selection/consequence law.',
    },
    R141: {
      status:'Partial incidence asymmetry; selection authority unresolved',
      remainingGap:'The specified removal, replacement, duplicate, forgery, relocation, finite-chain and self-reference probes show that incidence changes distinguishability while opposite equivariant selections survive. They do not yield a self-contained linked selection/admission/execution mechanism, derive its applicability, or prove all link-carried authority mechanisms insufficient or external authority irreducible.',
    },
    R142: {
      status:'Partial finite certificate verification; admissibility authority unresolved',
      remainingGap:'The live external exact-cover verifier passes complete, malformed, missing, duplicate, foreign, wrong-decomposition, zero/many, context and description-replacement cases. Locally isomorphic forgery remains admissible, the host assigns evidence roles and cardinality, and the linked description does not authenticate itself or authorize admission/activation/execution. The original structural-authority and regress question remains open.',
    },
  };
  for (const id of ids) {
    const row = manifest.requirements.find(item => item.id === id);
    if (!row) throw new Error(`missing original row ${id}`);
    const oldLine = `| ${id} | ${row.obligation} | ${row.status} | ${row.claimedEvidence} |`;
    if (!ledger.includes(oldLine)) throw new Error(`ledger differs from manifest for ${id}`);
    const selected = checks.filter(check => id==='R138' ? check.id.startsWith('slotwise-self-incidence') : check.id.startsWith('structural-foundation-evidence'));
    row.implementationClaims = ['js/src/rml-foundation-search.mjs','rust/src/linked_program.rs'].map(relative=>pin(relative,'implementation'));
    row.checks = selected.map(check=>check.id);
    row.assertionBindings = selected.flatMap(check => check.assertions.filter(assertion => id==='R138' || assertion.name.toLowerCase().startsWith(id.toLowerCase())).map(assertion => ({checkId:check.id,...assertion})));
    // The preservation guard also needs the live shared-address cycle witness.
    if (id==='R128') row.assertionBindings.push(...selected.flatMap(check => check.assertions.filter(assertion => /^r139[ _]detects/i.test(assertion.name)).map(assertion=>({checkId:check.id,...assertion}))));
    row.completionBindings = ['R128','R138'].includes(id) ? structuredClone(row.assertionBindings) : [];
    Object.assign(row, explanations[id]);
    row.verificationState = row.completionBindings.length ? 'full-scope-producer-bound-awaiting-fresh-native-execution' : 'finite-progress-producer-bound-full-scope-unmet';
    row.nativeValidationRequired = true;
    const evidence = id==='R138' ? '`selfIncidenceByReferenceSlot` in `js/src/rml-foundation-search.mjs` and `self_incidence_by_reference_slot` in `rust/src/linked_program.rs` classify the ordered slots through public generic functions. The relation is `RENAMING_INVARIANT_PERMUTATION_EQUIVARIANT`. Seven mirrored `slotwise-self-incidence` tests cover every Boolean mask through eight slots, arity 4096, injective renaming, permutation-versus-count loss, noninjective renaming and absent-address rejection; the report retains its equality-only boundary.' : row.claimedEvidence.replace(/ Mirrored requirement-specific .*$/,'');
    row.claimedEvidence = `${evidence} Mirrored requirement-specific \`structural-foundation-evidence\` tests bind live finite invariants and exact countermodels; full-scope research gaps are recorded separately.`;
    ledger = ledger.replace(oldLine,`| ${id} | ${row.obligation} | ${row.status} | ${row.claimedEvidence} |`);
  }
  for (const check of checks) {
    const index = manifest.checks.findIndex(item=>item.id===check.id);
    if (index===-1) manifest.checks.push(check); else manifest.checks[index]=check;
  }
  if (manifest.requirements.length!==164) throw new Error('the reviewed 164-obligation inventory changed');
  for (const row of manifest.requirements) {
    if (original.get(row.id)!==JSON.stringify({obligation:row.obligation,originalWording:row.originalWording})) throw new Error(`original scope changed: ${row.id}`);
  }
  let inventoryError = null;
  try { validateIssue183Inventory({root,manifest,sources,ledger}); } catch (error) {
    inventoryError = error.message;
    if (inventoryError!==baselineInventoryError) throw error;
  }
  return {manifest,ledger,bindings:{inventoryError,schema:'rml-structural-evidence-candidate/v1',sourceSnapshot:manifest.sourceSnapshot,requirements:manifest.requirements.filter(row=>ids.includes(row.id)),checks}};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output || process.argv.length!==3) throw new Error('Usage: node scripts/bind-structural-foundation-evidence.mjs OUTPUT_DIRECTORY');
  const result = structuralFoundationEvidenceCandidate();
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'requirements.manifest.json'),JSON.stringify(result.manifest,null,2)+'\n');
  fs.writeFileSync(path.join(output,'requirements.md'),result.ledger);
  fs.writeFileSync(path.join(output,'structural-evidence.bindings.json'),JSON.stringify(result.bindings,null,2)+'\n');
  console.log(JSON.stringify({rows:result.bindings.requirements.map(row=>({id:row.id,status:row.status,assertions:row.assertionBindings.length,completion:row.completionBindings.length})),checks:result.bindings.checks.map(check=>({id:check.id,pins:check.files.length,assertions:check.assertions.length})),output},null,2));
}
