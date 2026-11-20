#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { formalRecursionCases } from './formal-recursion-cases.mjs';
writeFileSync(new URL('../test-corpus/formal-recursion/cases.json', import.meta.url),
  `${JSON.stringify(formalRecursionCases(), null, 2)}\n`);
