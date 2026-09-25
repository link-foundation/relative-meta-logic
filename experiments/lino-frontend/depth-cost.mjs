// Measure what links-notation 0.20 costs per parse, to choose how deeply
// nested a piece the shared LiNo front end may hand it, and what the front end
// itself costs on the same shapes.
//
//   node experiments/lino-frontend/depth-cost.mjs overhead
//   node experiments/lino-frontend/depth-cost.mjs shapes [maxDepth]
//   node experiments/lino-frontend/depth-cost.mjs frontend [maxDepth]
//   node experiments/lino-frontend/depth-cost.mjs corpus
//
// `shapes` times links-notation alone, `frontend` times `parseLinoDocument`,
// and `corpus` times both on every large `.lino` file of the repository.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'js', 'package.json'));
const { Parser } = require('links-notation');
const { parseLinoDocument } = await import(join(root, 'js', 'src', 'rml-lino-frontend.mjs'));

const SHAPES = {
  nested: d => '('.repeat(d) + 'a' + ')'.repeat(d),
  'tail-values': d => '('.repeat(d) + 'a) b'.repeat(d),
  unclosed: d => '('.repeat(d) + 'a',
  'inner-colon': d => '('.repeat(d) + 'a: b: c' + ')'.repeat(d),
  'lone-colon': d => '('.repeat(d) + ':' + ')'.repeat(d),
  'value-group': d => '(a '.repeat(d) + 'b' + ')'.repeat(d),
};

const parseAlone = text => new Parser({ comments: false }).parse(text);

// The best of three runs, in microseconds per parse.
function time(text, repeat, parse = parseAlone) {
  let best = Infinity;
  for (let round = 0; round < 3; round += 1) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < repeat; i += 1) {
      try { parse(text); } catch { /* measured either way */ }
    }
    best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e3 / repeat);
  }
  return best;
}

const show = us => (us < 1000 ? `${us.toFixed(0)}us` : `${(us / 1000).toFixed(1)}ms`);

function maxDepth(text) {
  let depth = 0;
  let deepest = 0;
  for (const character of text) {
    if (character === '(') deepest = Math.max(deepest, (depth += 1));
    if (character === ')') depth = Math.max(0, depth - 1);
  }
  return deepest;
}

function* lino(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* lino(path);
    else if (name.endsWith('.lino')) yield path;
  }
}

const mode = process.argv[2] || 'shapes';
if (mode === 'overhead') {
  for (const text of ['a', '(a b)', '(a: b c)', 'a b c d e f g h']) {
    console.log(JSON.stringify(text), time(text, 20000).toFixed(2), 'us');
  }
} else if (mode === 'shapes') {
  const limit = Number(process.argv[3] || 6);
  for (const [name, make] of Object.entries(SHAPES)) {
    const row = [];
    for (let d = 1; d <= limit; d += 1) {
      const once = time(make(d), 1);
      row.push(`${d}:${show(once)}`);
      if (once > 2e6) break;
    }
    console.log(name.padEnd(12), row.join(' '));
  }
} else if (mode === 'frontend') {
  const limit = Number(process.argv[3] || 64);
  for (const [name, make] of Object.entries(SHAPES)) {
    const row = [];
    for (let d = 1; d <= limit; d += d < 8 ? 1 : 8) row.push(`${d}:${show(time(make(d), 1, parseLinoDocument))}`);
    console.log(name.padEnd(12), row.join(' '));
  }
} else if (mode === 'corpus') {
  const histogram = new Map();
  const rows = [];
  for (const path of lino(root)) {
    const text = readFileSync(path, 'utf8');
    const depth = maxDepth(text);
    histogram.set(depth, (histogram.get(depth) || 0) + 1);
    if (text.length > 9000) {
      rows.push([path.slice(root.length + 1), text.length, depth, time(text, 1), time(text, 1, parseLinoDocument)]);
    }
  }
  console.log('max depth -> files:', [...histogram].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join(' '));
  for (const [path, size, depth, alone, frontEnd] of rows) {
    console.log(path, size, 'depth', depth, 'links-notation', show(alone), 'front end', show(frontEnd));
  }
}
