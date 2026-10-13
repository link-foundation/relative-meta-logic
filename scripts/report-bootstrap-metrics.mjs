#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(here, '..', 'lib', 'meta-theory', 'universal.lino'),
  'utf8',
);

const report = LinkedProgramRegistry.bootstrapMetricsReport(source);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
