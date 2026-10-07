import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfCohort } from '../../experiments/relational-kernel/self-cohort.mjs';
test('actual quoted Horn image preserves the entire six-capability workload', { timeout: 300_000 }, () => {
  const result=selfCohort();
  assert.equal(result.capabilities.length,6);
  assert.equal(result.reductions.length,6);
  assert.equal(result.derivations.length,2);
  assert.equal(result.fixedPoint,true);
  assert.equal(result.absentProof,null);
  assert.equal(result.known,3);
  if(process.env.RML_RELATIONAL_COHORT_REPORT) writeFileSync(process.env.RML_RELATIONAL_COHORT_REPORT,JSON.stringify(result,null,2)+'\n');
});
