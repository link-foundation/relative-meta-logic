#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertIssue183Complete,
  readIssue183Requirements,
} from './issue-183-requirements.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ledgerPath = path.join(
  SCRIPT_DIRECTORY,
  '..',
  'docs/case-studies/issue-183/requirements.md',
);

assertIssue183Complete(readIssue183Requirements(ledgerPath));
console.log('Issue 183 has no incomplete requirement rows.');
