import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(here, '..', '..', 'lib', 'meta-theory', 'universal.lino'),
  'utf8',
);

function registry(extra = '') {
  return LinkedProgramRegistry.fromRml(`${source}\n${extra}`);
}

describe('links-defined universal program evaluator', () => {
  it('performs binding, substitution, and beta reduction without a host adapter', () => {
    const programs = registry();
    const identity = [
      'beta',
      ['lambda', ['bound', 'zero']],
      ['free', 'a'],
    ];

    assert.deepEqual(programs.reduce('lambda-calculus', identity).term, ['free', 'a']);

    const captureSafe = [
      'evaluate',
      [
        'apply',
        [
          'apply',
          ['lambda', ['lambda', ['bound', ['successor', 'zero']]]],
          ['free', 'a'],
        ],
        ['free', 'b'],
      ],
      'empty-environment',
    ];
    assert.deepEqual(programs.reduce('lambda-calculus', captureSafe).term, ['free', 'a']);
  });

  it('loads a completely new logic from links without a JavaScript callback', () => {
    const programs = registry(`
      (linked-program user-logic)
      (linked-rewrite user-logic eliminate-double-negation
        (from (negate (negate ?proposition)))
        (to ?proposition))
    `);

    const result = programs.reduce('user-logic', ['negate', ['negate', 'p']]);
    assert.equal(result.term, 'p');
    assert.deepEqual(result.trace.map(step => step.rule), ['eliminate-double-negation']);
  });

  it('derives judgements using user-defined facts and inference rules', () => {
    const programs = registry(`
      (linked-program user-proof-system)
      (linked-fact user-proof-system premise-p
        (judgement (holds p)))
      (linked-fact user-proof-system premise-p-implies-q
        (judgement (implies p q)))
      (linked-inference user-proof-system modus-ponens
        (premise (holds ?antecedent))
        (premise (implies ?antecedent ?consequent))
        (conclusion (holds ?consequent)))
    `);

    const proof = programs.prove('user-proof-system', ['holds', 'q']);
    assert.equal(proof.ok, true);
    assert.equal(proof.proof.rule, 'modus-ponens');
    assert.deepEqual(proof.proof.premises.map(item => item.rule), [
      'premise-p',
      'premise-p-implies-q',
    ]);
  });

  it('defines finite sets, graphs, relations, and dependent typing as programs', () => {
    const programs = registry();
    const set = ['cons', 'a', ['cons', 'b', ['empty']]];
    assert.equal(programs.reduce('set-theory', ['member', 'b', set]).term, 'true');
    assert.equal(
      programs.reduce('set-theory', ['set-equal', set, ['cons', 'b', ['cons', 'a', ['empty']]]]).term,
      'true',
    );

    const graphProof = programs.prove('graph-theory', ['reachable', 'a', 'c'], {
      facts: [['edge', 'a', 'b'], ['edge', 'b', 'c']],
    });
    assert.equal(graphProof.ok, true);

    const relationProof = programs.prove(
      'relational-algebra',
      ['relates', ['compose', 'left', 'right'], 'a', 'c'],
      { facts: [['relates', 'left', 'a', 'b'], ['relates', 'right', 'b', 'c']] },
    );
    assert.equal(relationProof.ok, true);

    const typeProof = programs.prove(
      'dependent-type-theory',
      ['has-type', ['apply', ['lambda', 'Nat', ['bound', 'zero']], 'zero'], 'Nat'],
    );
    assert.equal(typeProof.ok, true);
  });

  it('rejects malformed programs and bounds non-terminating definitions', () => {
    assert.throws(
      () => registry(`
        (linked-program invalid)
        (linked-rewrite invalid unbound
          (from (f ?x))
          (to (g ?missing)))
      `),
      /unbound variable \?missing/,
    );

    const programs = registry(`
      (linked-program looping)
      (linked-rewrite looping left (from left) (to right))
      (linked-rewrite looping right (from right) (to left))
    `);
    assert.throws(() => programs.reduce('looping', 'left'), /rewrite cycle/);

    assert.throws(
      () => registry(`
        (linked-program parent)
        (linked-program invalid-import
          (uses parent (rebind ?pattern-variable concrete)))
      `),
      /cannot rebind pattern variables/,
    );
  });

  it('applies the proof fact bound to declared and input facts', () => {
    const programs = registry(`
      (linked-program bounded-proof)
      (linked-fact bounded-proof first (judgement (holds a)))
      (linked-fact bounded-proof second (judgement (holds b)))
    `);

    assert.throws(
      () => programs.prove('bounded-proof', ['holds', 'b'], { maxFacts: 1 }),
      /proof fact limit 1 exceeded/,
    );

    const inputOnly = registry('(linked-program bounded-input)');
    assert.throws(
      () => inputOnly.prove('bounded-input', ['holds', 'b'], {
        facts: [['holds', 'a'], ['holds', 'b']],
        maxFacts: 1,
      }),
      /proof fact limit 1 exceeded/,
    );
  });

  it('instantiates one unchanged theory over replaceable foundations', () => {
    const programs = registry(`
      (linked-program portable-classifier)
      (linked-rewrite portable-classifier classify
        (from (classify ?value))
        (to (foundation-decision ?value)))

      (linked-program strict-foundation)
      (linked-rewrite strict-foundation decide-unknown
        (from (strict-decision unknown))
        (to reject))

      (linked-program permissive-foundation)
      (linked-rewrite permissive-foundation decide-unknown
        (from (permissive-decision unknown))
        (to accept))

      (linked-program classifier-interface
        (uses portable-classifier
          (rebind foundation-decision selected-decision)))

      (linked-program classifier-over-strict
        (uses classifier-interface
          (rebind selected-decision strict-decision))
        (uses strict-foundation))

      (linked-program classifier-over-permissive
        (uses portable-classifier
          (rebind foundation-decision permissive-decision))
        (uses permissive-foundation))

      (linked-program portable-entailment)
      (linked-fact portable-entailment premise
        (judgement (abstract-holds p)))
      (linked-fact portable-entailment implication
        (judgement (abstract-implies p q)))
      (linked-inference portable-entailment modus-ponens
        (premise (abstract-holds ?antecedent))
        (premise (abstract-implies ?antecedent ?consequent))
        (conclusion (abstract-holds ?consequent)))
      (linked-program selected-entailment
        (uses portable-entailment
          (rebind abstract-holds holds)
          (rebind abstract-implies implies)))
    `);

    assert.equal(
      programs.reduce('classifier-over-strict', ['classify', 'unknown']).term,
      'reject',
    );
    assert.equal(
      programs.reduce('classifier-over-permissive', ['classify', 'unknown']).term,
      'accept',
    );
    assert.equal(programs.prove('selected-entailment', ['holds', 'q']).ok, true);

    const traditionalSet = [
      'sequence-cons',
      'a',
      ['sequence-cons', 'b', ['sequence-empty']],
    ];
    const associativeSet = [
      'link-cons',
      'a',
      ['link-cons', 'b', ['link-empty']],
    ];
    assert.equal(programs.reduce(
      'set-theory-over-traditional-sequences',
      ['member', 'b', traditionalSet],
    ).term, 'true');
    assert.equal(programs.reduce(
      'set-theory-over-associative-links',
      ['member', 'b', associativeSet],
    ).term, 'true');
  });

  it('executes a links-defined meta-interpreter above an explicit K0 boundary', () => {
    const programs = registry();
    const objectRule = [
      'rewrite',
      ['pair', ['atom', 'identity'], ['meta-variable', 'argument']],
      ['meta-variable', 'argument'],
    ];
    const candidate = ['pair', ['atom', 'identity'], ['atom', 'a']];
    const request = [
      'meta-verify',
      ['atom', 'a'],
      ['meta-rewrite', ['rules', objectRule, ['no-rules']], candidate],
    ];

    const result = programs.reduce('links-meta-foundation', request);
    assert.equal(result.term, 'verified');
    assert.ok(result.trace.some(step => step.rule === 'match-unbound-variable'));
    assert.ok(result.trace.some(step => step.rule === 'substitute-bound-variable'));

    const report = LinkedProgramRegistry.bootstrapKernelReport();
    assert.equal(report.name, 'K0');
    assert.equal(report.status, 'current-bootstrap-boundary');
    assert.equal(report.claimsIrreducible, false);
    assert.deepEqual(report.operations, [
      'parse-linked-forms',
      'compare-link-structure',
      'bind-pattern-variables',
      'substitute-bound-structures',
      'select-and-traverse-rewrite-rules',
      'enforce-cycle-and-resource-bounds',
    ]);
    assert.deepEqual(report.derivedHostServices, [
      'resolve-and-rebind-program-imports',
      'saturate-inference-rules',
    ]);
    assert.deepEqual(report.objectSemantics, []);
    assert.equal(report.minimizationExperiments.length, 8);
    assert.deepEqual(
      new Set(report.minimizationExperiments.map(experiment => experiment.operation)),
      new Set([...report.operations, ...report.derivedHostServices]),
    );
    assert.ok(report.trustGraph.nodes.every(node =>
      node.layer !== 'bootstrap' || node.primitiveReason.length > 0));

    assert.deepEqual(LinkedProgramRegistry.auditBootstrapKernel(), { ok: true });
    assert.throws(
      () => LinkedProgramRegistry.auditBootstrapKernel([
        ...report.operations,
        ...report.derivedHostServices,
        'hidden-object-evaluator',
      ]),
      /unreported host semantic operation hidden-object-evaluator/,
    );
  });

  it('measures the complete host semantic surface and self-hosting distance', () => {
    const report = LinkedProgramRegistry.bootstrapMetricsReport(source);

    assert.equal(report.schema, 'rml-bootstrap-metrics/v1');
    assert.deepEqual(report.removalClassifications, [
      'INDEPENDENT',
      'DERIVABLE',
      'EQUIVALENT_REENCODING',
      'UNKNOWN',
    ]);
    assert.equal(report.current.totalHostSemanticOperations, 8);
    assert.deepEqual(report.current.independentHostPrimitives, {
      confirmed: 0,
      unknown: 8,
    });
    assert.equal(report.current.derivedHostSemanticServices, 2);
    assert.equal(report.current.duplicatedSemanticCapabilities, 3);
    assert.equal(report.current.objectSpecificHostSemantics, 0);
    assert.equal(report.current.undocumentedSemanticPaths, 0);
    assert.deepEqual(report.current.selfHostingClosure, {
      task: 'textual-load-through-links-meta-foundation-verification',
      linkedCapabilities: 4,
      linkedCapabilityNames: [
        'matching',
        'substitution',
        'rule-selection',
        'result-verification',
      ],
      hostCapabilities: 7,
      hostCapabilityNames: [
        'bind-pattern-variables',
        'compare-link-structure',
        'enforce-cycle-and-resource-bounds',
        'parse-linked-forms',
        'resolve-and-rebind-program-imports',
        'select-and-traverse-rewrite-rules',
        'substitute-bound-structures',
      ],
      totalCapabilities: 11,
      numerator: 4,
      denominator: 11,
    });
    assert.deepEqual(report.current.foundationCompression, {
      basis: 'host-operation fault injection over the declared acceptance probe',
      smallestSufficientHostOperations: 8,
      originalHostOperations: 8,
      candidateOperations: [
        'parse-linked-forms',
        'compare-link-structure',
        'bind-pattern-variables',
        'substitute-bound-structures',
        'select-and-traverse-rewrite-rules',
        'enforce-cycle-and-resource-bounds',
        'resolve-and-rebind-program-imports',
        'saturate-inference-rules',
      ],
      sufficientOperations: [
        'parse-linked-forms',
        'compare-link-structure',
        'bind-pattern-variables',
        'substitute-bound-structures',
        'select-and-traverse-rewrite-rules',
        'enforce-cycle-and-resource-bounds',
        'resolve-and-rebind-program-imports',
        'saturate-inference-rules',
      ],
      numerator: 8,
      denominator: 8,
    });

    assert.deepEqual(
      report.hostSemanticLayers.map(({ layer, count }) => [layer, count]),
      [
        ['semantic-bootstrap', 4],
        ['derived-host-semantics', 2],
        ['representation-parsing', 1],
        ['execution-control-resource-bounds', 1],
        ['debugging-observability', 0],
        ['object-specific-host-semantics', 0],
      ],
    );
    assert.deepEqual(
      new Set(report.hostSemanticLayers.flatMap(layer => layer.operations)),
      new Set([
        ...LinkedProgramRegistry.bootstrapKernelReport().operations,
        ...LinkedProgramRegistry.bootstrapKernelReport().derivedHostServices,
      ]),
    );
    assert.equal(report.removalExperiments.length, 8);
    assert.ok(report.removalExperiments.every(experiment =>
      experiment.classification === 'UNKNOWN' &&
      experiment.baselinePreserved === false &&
      experiment.observedFailure.length > 0));
    assert.deepEqual(
      new Set(report.removalExperiments.map(experiment => experiment.operation)),
      new Set([
        ...LinkedProgramRegistry.bootstrapKernelReport().operations,
        ...LinkedProgramRegistry.bootstrapKernelReport().derivedHostServices,
      ]),
    );
    assert.deepEqual(
      report.hostLinkedDuplications.map(duplication => duplication.capability),
      ['matching', 'substitution', 'rule-selection'],
    );
    assert.deepEqual(report.runtimeTrustGraphCoverage.undocumentedPaths, []);
    assert.deepEqual(report.runtimeTrustGraphCoverage.undocumentedOperations, []);
    assert.deepEqual(report.runtimeTrustGraphCoverage.undocumentedPathSegments, []);
    assert.equal(report.runtimeTrustGraphCoverage.totalObservedPaths, 4);
    assert.equal(report.runtimeTrustGraphCoverage.totalObservedPathSegments, 19);
    assert.equal(
      report.runtimeTrustGraphCoverage.documentedObservedPaths,
      report.runtimeTrustGraphCoverage.totalObservedPaths,
    );
    assert.equal(
      report.runtimeTrustGraphCoverage.documentedObservedPathSegments,
      report.runtimeTrustGraphCoverage.totalObservedPathSegments,
    );

    assert.deepEqual(report.comparison[0], {
      metric: 'total-host-semantic-operations',
      previous: 8,
      current: 8,
      delta: 0,
    });
    assert.equal(
      report.previousRevision,
      'e2e9f7b2a87d4b128bb736d693d5512509974860',
    );
    assert.deepEqual(
      report.comparison.map(({ metric, previous, current, delta }) => [
        metric,
        previous,
        current,
        delta,
      ]),
      [
        ['total-host-semantic-operations', 8, 8, 0],
        ['independent-host-primitives', null, '0 confirmed; 8 unknown', null],
        ['derived-host-semantic-services', 2, 2, 0],
        ['host-linked-duplicated-semantics', null, 3, null],
        ['object-specific-host-semantics', 0, 0, 0],
        ['undocumented-semantic-paths', null, 0, null],
        ['self-hosting-closure', null, '4/11', null],
        ['foundation-compression-ratio', null, '8/8', null],
      ],
    );
  });

  it('self-interprets a non-trivial fragment of its own matching semantics', () => {
    const programs = registry();
    const encode = (term, variables = false) => {
      if (!Array.isArray(term)) {
        if (variables && term.startsWith('?')) {
          return ['meta-variable', term.slice(1)];
        }
        return ['atom', term];
      }
      return term.reduceRight(
        (tail, item) => ['pair', encode(item, variables), tail],
        ['atom', 'nil'],
      );
    };
    const ownPattern = [
      'meta-match',
      ['atom', '?value'],
      ['atom', '?value'],
      '?bindings',
    ];
    const ownReplacement = ['match-ok', '?bindings'];
    const directRequest = [
      'meta-match',
      ['atom', 'same'],
      ['atom', 'same'],
      ['no-bindings'],
    ];
    const direct = programs.reduce('links-meta-foundation', directRequest);
    const selfRequest = [
      'meta-apply',
      ['rewrite', encode(ownPattern, true), encode(ownReplacement, true)],
      encode(directRequest),
    ];
    const selfInterpreted = programs.reduce('links-meta-foundation', selfRequest);

    assert.deepEqual(selfInterpreted.term, ['rewrite-result', encode(direct.term)]);
    assert.ok(selfInterpreted.trace.some(step => step.rule === 'match-repeated-variable'));
    assert.ok(selfInterpreted.trace.some(step => step.rule === 'substitute-bound-variable'));
  });
});
