import { readFileSync } from 'node:fs';

import { foundationSearchReport } from '../js/src/rml-foundation-search.mjs';

const universalSource = readFileSync(
  new URL('../lib/meta-theory/universal.lino', import.meta.url),
  'utf8',
);
const alternativeSource = readFileSync(
  new URL('../lib/meta-theory/alternative-foundations.lino', import.meta.url),
  'utf8',
);

console.log(JSON.stringify(
  foundationSearchReport(universalSource, alternativeSource),
  null,
  2,
));
