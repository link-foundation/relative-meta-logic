import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { linkedCertificateCandidates } from '../js/src/rml-foundation-search.mjs';
const fixture=JSON.parse(readFileSync(new URL('../test-corpus/linked-certificate/cases.json',import.meta.url)));
for(const example of fixture.cases) test(example.name,()=>{
  assert.deepEqual(linkedCertificateCandidates(example),example.expected);
});
