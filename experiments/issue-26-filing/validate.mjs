#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const issues = JSON.parse(fs.readFileSync(path.join(__dirname, 'issues.json'), 'utf8'));
const ids = new Set(issues.map(i => i.id));
let problems = 0;
for (const i of issues) {
  for (const d of i.depends || []) {
    if (!ids.has(d)) { console.log(`UNKNOWN dep ${d} in ${i.id}`); problems++; }
  }
  for (const b of i.blocks || []) {
    if (!ids.has(b)) { console.log(`UNKNOWN block ${b} in ${i.id}`); problems++; }
  }
}
console.log(`Issues: ${issues.length}, problems: ${problems}`);
// Detect cycles
const seen = new Set(); const stack = new Set();
function visit(id, trace) {
  if (stack.has(id)) { console.log(`CYCLE: ${[...trace, id].join(' -> ')}`); problems++; return; }
  if (seen.has(id)) return;
  stack.add(id); trace.push(id);
  const spec = issues.find(s => s.id === id);
  for (const d of spec.depends || []) visit(d, trace.slice());
  stack.delete(id); seen.add(id);
}
for (const i of issues) visit(i.id, []);
console.log('Validation complete.');
process.exit(problems > 0 ? 1 : 0);
