// Reproduce the executable basis-equivalence measurement reported by
// `npm run report:bootstrap-metrics`. Barker's iota has one surface equation,
// but its definition imports S and K. This experiment makes the distinction
// between a shorter surface vocabulary and a smaller semantic basis visible.

import { combinatorIotaEquivalenceReport } from '../js/src/rml-combinator-kernel.mjs';

const report = combinatorIotaEquivalenceReport();

if (report.surfaceLawCount !== 1 || report.baselinePreserved !== true) {
  throw new Error('iota did not preserve the S/K witness baseline');
}
if (report.observedExternalOperations.join(',') !== 'contract-k-link,contract-s-link') {
  throw new Error('iota unexpectedly changed the residual semantic basis');
}
if (report.semanticInformationReduced !== false) {
  throw new Error('surface compression was misclassified as semantic reduction');
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
