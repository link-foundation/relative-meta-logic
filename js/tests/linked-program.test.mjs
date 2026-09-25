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

  it('preserves proof-round capacity and unnormalized proof witnesses', () => {
    const programs = registry(`
      (linked-program normalized-proofs)
      (linked-rewrite normalized-proofs unwrap
        (from (wrapped ?value))
        (to ?value))
      (linked-fact normalized-proofs seed
        (judgement (wrapped seed)))
      (linked-inference normalized-proofs first
        (premise seed)
        (conclusion (wrapped intermediate)))
      (linked-inference normalized-proofs second
        (premise intermediate)
        (conclusion (wrapped goal)))
    `);

    const result = programs.prove('normalized-proofs', 'goal', { maxRounds: 1 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.proof.judgement, ['wrapped', 'goal']);
    assert.deepEqual(result.proof.premises[0].judgement, ['wrapped', 'intermediate']);
    assert.deepEqual(
      result.proof.premises[0].premises[0].judgement,
      ['wrapped', 'seed'],
    );
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

  it('reports why a proof search ended in every execution basis', () => {
    const searchSource = `
      (linked-program graph)
      (linked-fact graph ab (judgement (edge a b)))
      (linked-fact graph bc (judgement (edge b c)))
      (linked-inference graph base (premise (edge ?x ?y)) (conclusion (path ?x ?y)))
      (linked-inference graph step
        (premise (edge ?x ?y)) (premise (path ?y ?z)) (conclusion (path ?x ?z)))
      (linked-program counter)
      (linked-fact counter zero (judgement (count z)))
      (linked-inference counter next (premise (count ?n)) (conclusion (count (s ?n))))
      (linked-program loops)
      (linked-rewrite loops flip (from (flip ?x)) (to (flop ?x)))
      (linked-rewrite loops flop (from (flop ?x)) (to (flip ?x)))
    `;
    const closure = [['path', 'a', 'b'], ['path', 'b', 'c'], ['path', 'a', 'c']];
    for (const executionBasis of ['s-k', 'direct-structural', 'horn-relational']) {
      const programs = LinkedProgramRegistry.fromRml(searchSource, { executionBasis });

      const found = programs.search('graph', [['path', 'a', 'c'], ['path', 'b', 'c']]);
      assert.equal(found.schema, 'rml-linked-search/v1');
      assert.equal(found.executionBasis, executionBasis);
      assert.equal(found.ended, 'found');
      assert.deepEqual(found.goals.map(goal => goal.normalization), ['normal', 'normal']);
      assert.deepEqual(found.goals.map(goal => goal.proof.rule), ['step', 'base']);
      assert.deepEqual(found.derived.map(entry => entry.judgement), closure);

      // A fixed point without the goal is not the same outcome as a spent bound.
      const saturated = programs.search('graph', [['path', 'c', 'a']]);
      assert.equal(saturated.ended, 'saturated');
      assert.equal(saturated.goals[0].proof, null);
      assert.equal(saturated.facts, 5);
      const whole = programs.search('graph', []);
      assert.equal(whole.ended, 'saturated');
      assert.deepEqual(whole.derived.map(entry => entry.judgement), closure);

      const facts = programs.search('counter', [['count', 'never']], { maxRounds: 64, maxFacts: 3 });
      assert.equal(facts.ended, 'fact-limit');
      assert.equal(facts.facts, 4);
      // The closed kernel spends one transition per derived fact, so it meets
      // the fact bound where a direct round runs out first.
      const rounds = programs.search('counter', [['count', 'never']], { maxRounds: 1, maxFacts: 3 });
      assert.equal(rounds.ended, executionBasis === 's-k' ? 'fact-limit' : 'inference-limit');
      assert.equal(rounds.goals[0].proof, null);

      // The Horn control has no ordered reduction, so only the other two bases
      // can fail to normalize a goal.
      if (executionBasis !== 'horn-relational') {
        const cycle = programs.search('loops', [['flip', 'a']]);
        assert.equal(cycle.ended, 'saturated');
        assert.equal(cycle.goals[0].normalization, 'rewrite-cycle');
        assert.equal(cycle.goals[0].normalized, null);
        assert.match(cycle.goals[0].detail, /rewrite cycle after/);
      }
    }
    const programs = LinkedProgramRegistry.fromRml(searchSource);
    assert.throws(() => programs.search('graph', 'path'), /search goals must be a list/);
    assert.throws(() => programs.search('graph', [], { maxSteps: 0 }), /maxSteps must be a positive safe integer/);
    assert.throws(() => programs.search('graph', [], { maxFacts: 0 }), /proof bounds must be positive safe integers/);
  });

  it('bounds each closed kernel call by a contraction budget', () => {
    const counterSource = `
      (linked-program counter)
      (linked-fact counter zero (judgement (count z)))
      (linked-inference counter next (premise (count ?n)) (conclusion (seen ?n)))
    `;
    const spent = budget => error =>
      error.reductionFailure === 'contraction-limit' &&
      error.message === `combinator contraction limit ${budget} exceeded`;
    assert.equal(LinkedProgramRegistry.fromRml(counterSource).maxContractions, 100_000_000);
    assert.throws(
      () => LinkedProgramRegistry.fromRml(counterSource, { maxContractions: 0 }),
      /maxContractions must be a positive safe integer/,
    );
    const tiny = LinkedProgramRegistry.fromRml(counterSource, { maxContractions: 100 });
    assert.equal(tiny.maxContractions, 100);
    assert.throws(() => tiny.reduce('counter', ['count', 'z']), spent(100));

    // The budget applies to each kernel call separately. The reduction of a
    // wide goal spends it and is reported like a goal without a normal form,
    // while the saturation that finds the other goal fits.
    const wide = ['row', ...Array.from({ length: 200 }, () => 'item')];
    const bounded = LinkedProgramRegistry.fromRml(counterSource, { maxContractions: 60_000 });
    const found = bounded.search('counter', [wide, ['seen', 'z']]);
    assert.equal(found.ended, 'found');
    assert.deepEqual(found.goals.map(goal => goal.normalization), ['contraction-limit', 'normal']);
    assert.equal(found.goals[0].normalized, null);
    assert.equal(found.goals[0].detail, 'combinator contraction limit 60000 exceeded');
    assert.equal(found.goals[1].proof.rule, 'next');
    // A saturation call that spends the budget stops the whole search.
    const small = LinkedProgramRegistry.fromRml(counterSource, { maxContractions: 20_000 });
    assert.equal(small.reduce('counter', ['seen', 'z']).term[0], 'seen');
    assert.throws(() => small.search('counter', [['seen', 'z']]), spent(20000));

    // The direct basis makes no kernel call, so the budget does not bound it:
    // the wide goal normalizes and is searched for without a proof.
    const direct = LinkedProgramRegistry.fromRml(counterSource, {
      executionBasis: 'direct-structural',
      maxContractions: 1,
    });
    const searched = direct.search('counter', [wide, ['seen', 'z']]);
    assert.equal(searched.ended, 'saturated');
    assert.deepEqual(searched.goals.map(goal => goal.normalization), ['normal', 'normal']);
    assert.deepEqual(searched.goals.map(goal => goal.proof?.rule ?? null), [null, 'next']);
  });

  it('loads the forms a layer derives from the same parse', () => {
    const layered = `
      (linked-program base)
      (linked-rewrite base finish (from (start ?x)) (to (done ?x)))
      (wrapped-program wrapper base)
    `;
    let heads = null;
    const expandForms = forms => {
      heads = forms.map(form => form[0]);
      return forms
        .filter(form => form[0] === 'wrapped-program')
        .map(form => ['linked-program', form[1], ['uses', form[2]]]);
    };
    const programs = LinkedProgramRegistry.fromRml(layered, { expandForms });
    assert.deepEqual(heads, ['linked-program', 'linked-rewrite', 'wrapped-program']);
    assert.deepEqual(programs.names(), ['base', 'wrapper']);
    assert.deepEqual(programs.reduce('wrapper', ['start', 'a']).term, ['done', 'a']);
    assert.ok(programs.runtimeSemanticTrace().observedOperations.includes('parse-linked-forms'));

    // Derived forms are validated like parsed ones, and a failing layer stops the load.
    assert.throws(
      () => LinkedProgramRegistry.fromRml(layered, {
        expandForms: () => [['linked-program', 'broken', ['uses', 'missing']]],
      }),
      /linked-program broken uses unknown program missing/,
    );
    assert.throws(
      () => LinkedProgramRegistry.fromRml(layered, {
        expandForms: () => { throw new Error('layer rejected the source'); },
      }),
      /layer rejected the source/,
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
      'contract-s-link',
      'contract-k-link',
      'parse-linked-forms',
      'enforce-cycle-and-resource-bounds',
    ]);
    assert.deepEqual(report.derivedHostServices, []);
    assert.deepEqual(report.objectSemantics, []);
    assert.deepEqual(report.semanticSource, {
      artifact: 'lib/meta-theory/fixed-point-source.lino',
      schema: 'rml-lambda-link-dag-v1',
      representation: 'addressed-doublet-network',
      upstreamModel: 'network-duplet-function',
      sourceNodes: 1446,
      runtimeNodes: 35674,
      roots: 25,
      provenance: 'represented-as-addressed-links',
      compiledFromExternalSemanticDescription: false,
    });
    assert.deepEqual(report.semanticLawProvenance, [
      {
        operation: 'contract-s-link',
        provenance: 'externally-primitive',
        law: 'S x y z -> x z (y z)',
      },
      {
        operation: 'contract-k-link',
        provenance: 'externally-primitive',
        law: 'K x y -> x',
      },
    ]);
    assert.equal(report.minimizationExperiments.length, 4);
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

    assert.equal(report.schema, 'rml-bootstrap-metrics/v4');
    assert.deepEqual(report.provenanceClassifications, [
      'represented-as-addressed-links',
      'derived-inside-system',
      'compiled-from-external-semantic-description',
      'externally-primitive',
    ]);
    assert.deepEqual(report.removalClassifications, [
      'INDEPENDENT',
      'DERIVABLE',
      'EQUIVALENT_REENCODING',
      'UNKNOWN',
    ]);
    assert.equal(report.current.totalHostSemanticOperations, 2);
    assert.deepEqual(report.current.independentHostPrimitives, {
      confirmed: 2,
      unknown: 0,
    });
    assert.equal(report.current.derivedHostSemanticServices, 0);
    assert.equal(report.current.duplicatedSemanticCapabilities, 0);
    assert.equal(report.current.objectSpecificHostSemantics, 0);
    assert.equal(report.current.undocumentedSemanticPaths, 0);
    assert.deepEqual(report.current.externalSemanticInformation, {
      independentLaws: 2,
      lawNames: ['contract-s-link', 'contract-k-link'],
      provenance: 'externally-primitive',
    });
    assert.equal(
      report.semanticProvenance.authoritativeSource.provenance,
      'represented-as-addressed-links',
    );
    assert.equal(
      report.semanticProvenance.authoritativeSource.compiledFromExternalSemanticDescription,
      false,
    );
    assert.deepEqual(
      report.semanticProvenance.derivedCapabilities.map(item => item.provenance),
      Array(6).fill('derived-inside-system'),
    );
    assert.deepEqual(report.semanticProvenance.eliminatedExternalSources, [{
      id: 'buildSourceKernel',
      provenance: 'compiled-from-external-semantic-description',
      present: false,
    }]);
    assert.equal(report.foundationSearchExperiments[0].candidate, 'zero-semantic-transition');
    assert.equal(report.foundationSearchExperiments[0].surfaceLawCount, 0);
    assert.equal(report.foundationSearchExperiments[0].residualExternalSemanticLawCount, 0);
    assert.equal(report.foundationSearchExperiments[0].baselinePreserved, false);
    assert.ok(report.foundationSearchExperiments[0].observedFailure.length > 0);
    assert.deepEqual(report.foundationSearchExperiments[1], {
      candidate: 's-k-over-addressed-link-source',
      classification: 'CURRENT_SUFFICIENT',
      surfaceLawCount: 2,
      residualExternalSemanticLawCount: 2,
      baselinePreserved: true,
      observedFailure: '',
      experimentScope: 'complete-acceptance-probe',
      observedExternalOperations: ['contract-k-link', 'contract-s-link'],
      semanticInformationReduced: null,
    });
    assert.deepEqual(report.foundationSearchExperiments[2], {
      candidate: 'iota',
      classification: 'EQUIVALENT_REENCODING',
      surfaceLawCount: 1,
      residualExternalSemanticLawCount: 2,
      baselinePreserved: true,
      observedFailure: '',
      experimentScope: 'residual-basis-equivalence-witness',
      observedExternalOperations: ['contract-k-link', 'contract-s-link'],
      semanticInformationReduced: false,
    });
    assert.deepEqual(report.current.selfHostingClosure, {
      task: 'linked-load-import-reduce-infer-and-self-verify-above-residual-basis',
      linkedCapabilities: 6,
      linkedCapabilityNames: [
        'matching',
        'substitution',
        'rule-selection-and-traversal',
        'import-and-rebinding',
        'inference-saturation',
        'result-verification',
      ],
      hostCapabilities: 0,
      hostCapabilityNames: [],
      totalCapabilities: 6,
      numerator: 6,
      denominator: 6,
    });
    assert.deepEqual(report.current.foundationCompression, {
      basis: 'semantic-operation fault injection over the complete acceptance probe',
      smallestSufficientHostOperations: 2,
      originalHostOperations: 8,
      candidateOperations: [
        'contract-s-link',
        'contract-k-link',
      ],
      sufficientOperations: [
        'contract-s-link',
        'contract-k-link',
      ],
      numerator: 2,
      denominator: 8,
    });

    assert.deepEqual(
      report.hostSemanticLayers.map(({ layer, count }) => [layer, count]),
      [
        ['semantic-bootstrap', 2],
        ['derived-host-semantics', 0],
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
    assert.equal(report.removalExperiments.length, 4);
    assert.ok(report.removalExperiments.every(experiment =>
      experiment.baselinePreserved === false &&
      experiment.observedFailure.length > 0));
    assert.deepEqual(
      Object.fromEntries(report.removalExperiments.map(experiment => [
        experiment.operation,
        experiment.classification,
      ])),
      {
        'parse-linked-forms': 'UNKNOWN',
        'contract-s-link': 'INDEPENDENT',
        'contract-k-link': 'INDEPENDENT',
        'enforce-cycle-and-resource-bounds': 'UNKNOWN',
      },
    );
    assert.deepEqual(
      new Set(report.removalExperiments.map(experiment => experiment.operation)),
      new Set([
        ...LinkedProgramRegistry.bootstrapKernelReport().operations,
        ...LinkedProgramRegistry.bootstrapKernelReport().derivedHostServices,
      ]),
    );
    assert.deepEqual(report.hostLinkedDuplications, []);
    assert.deepEqual(report.runtimeTrustGraphCoverage.undocumentedPaths, []);
    assert.deepEqual(report.runtimeTrustGraphCoverage.undocumentedOperations, []);
    assert.deepEqual(report.runtimeTrustGraphCoverage.undocumentedPathSegments, []);
    assert.equal(report.runtimeTrustGraphCoverage.totalObservedPaths, 4);
    assert.equal(report.runtimeTrustGraphCoverage.totalObservedPathSegments, 10);
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
      previous: 2,
      current: 2,
      delta: 0,
    });
    assert.equal(
      report.previousRevision,
      '8b39df510a083e5cbe2a56a72e6595aae7b48146',
    );
    assert.deepEqual(
      report.comparison.map(({ metric, previous, current, delta }) => [
        metric,
        previous,
        current,
        delta,
      ]),
      [
        ['total-host-semantic-operations', 2, 2, 0],
        ['independent-host-primitives', '2 confirmed; 0 unknown', '2 confirmed; 0 unknown', null],
        ['derived-host-semantic-services', 0, 0, 0],
        ['host-linked-duplicated-semantics', 0, 0, 0],
        ['object-specific-host-semantics', 0, 0, 0],
        ['undocumented-semantic-paths', 0, 0, 0],
        ['self-hosting-closure', '6/6', '6/6', null],
        ['foundation-compression-ratio', '2/8', '2/8', null],
        ['independent-external-semantic-laws', null, 2, null],
        ['external-semantic-source-descriptions', 1, 0, -1],
      ],
    );
  });

  it('closes the linked semantic path over a non-duplicating residual basis', () => {
    const report = LinkedProgramRegistry.bootstrapMetricsReport(source);

    assert.deepEqual(report.current.residualSemanticBasis, {
      operations: ['contract-s-link', 'contract-k-link'],
      experimentallyNecessary: 2,
      equivalentOneRuleBases: ['iota'],
    });
    assert.equal(report.current.derivedHostSemanticServices, 0);
    assert.equal(report.current.duplicatedSemanticCapabilities, 0);
    assert.deepEqual(report.current.selfHostingClosure, {
      task: 'linked-load-import-reduce-infer-and-self-verify-above-residual-basis',
      linkedCapabilities: 6,
      linkedCapabilityNames: [
        'matching',
        'substitution',
        'rule-selection-and-traversal',
        'import-and-rebinding',
        'inference-saturation',
        'result-verification',
      ],
      hostCapabilities: 0,
      hostCapabilityNames: [],
      totalCapabilities: 6,
      numerator: 6,
      denominator: 6,
    });
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
