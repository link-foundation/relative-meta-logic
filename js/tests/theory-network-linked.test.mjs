import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TheoryNetwork } from '../src/rml-theory-network.mjs';

const foundation = `(implementation-contract user-logic-contract
  (kind user-logic)
  (obligation double-negation))

(conformance-case user-logic-contract double-negation
  (program user-logic)
  (input (negate (negate proposition)))
  (expected proposition))

(rule verified-theory-definition
  (premise (?implementation implements ?kind))
  (conclusion
    (?definition defines ?subject using ?foundation
      via ?implementation as ?kind)))

(axiom user-logic-capability
  (judgement (user-logic-implementation implements user-logic)))
`;

const source = `(linked-program user-logic)

(linked-rewrite user-logic eliminate-double-negation
  (from (negate (negate ?proposition)))
  (to ?proposition))

(theory object-theory
  (address theory.object))

(theory link-foundation
  (address theory.links))

(term object-theory proposition concept.proposition)
(term link-foundation proposition concept.proposition)

(implementation user-logic-implementation
  (contract user-logic-contract)
  (program user-logic)
  (kind user-logic)
  (subject object-theory)
  (using link-foundation)
  (obligation double-negation))

(witness definition.object.links
  (kind user-logic)
  (implementation user-logic-implementation)
  (proof proof.object.links))

(definition object-in-links
  (subject object-theory)
  (using link-foundation)
  (witness definition.object.links))

(proof-object proof.object.links
  (applies verified-theory-definition)
  (premise-by user-logic-capability)
  (conclusion
    (object-in-links defines object-theory using link-foundation
      via user-logic-implementation as user-logic)))
`;

describe('link-defined theory implementation verification', () => {
  it('verifies a previously unknown logic without host-language adapters', () => {
    const network = TheoryNetwork.fromRml(source, foundation);

    assert.deepEqual(network.definitionVerification('object-in-links'), {
      definition: 'object-in-links',
      witness: 'definition.object.links',
      proof: 'proof.object.links',
      implementation: 'user-logic-implementation',
      kind: 'user-logic',
      obligations: ['double-negation'],
      verified: true,
    });
  });
});
