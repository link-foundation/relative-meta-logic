// Tests for the English-readability lint (issue #32).
//
// Run with: node --test scripts/lint-english.test.mjs
// Or via the JS package script: (cd js && npm run lint-english:test)

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  tokenize,
  parseLinks,
  checkIdentifierShape,
  isOperatorOnlyDefinition,
  lintFile,
  loadAllowlist,
  suggestKebab,
  suggestWordForm,
} from './lint-english.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'lint-english.mjs');

function lintSource(source, file = 'inline.lino', allowlist = { identifiers: new Set(), links: new Set() }) {
  return lintFile(file, source, allowlist);
}

describe('tokenize()', () => {
  it('strips comments and tracks 1-based positions', () => {
    const tokens = tokenize('# header\n(a: a is a)  # tail comment\n');
    assert.deepStrictEqual(tokens.map(t => t.value), ['(', 'a:', 'a', 'is', 'a', ')']);
    assert.strictEqual(tokens[0].line, 2);
    assert.strictEqual(tokens[0].col, 1);
    assert.strictEqual(tokens[1].line, 2);
    assert.strictEqual(tokens[1].col, 2);
  });
});

describe('parseLinks()', () => {
  it('builds a tree of nested lists and atoms', () => {
    const ast = parseLinks(tokenize('(a: a is a)'));
    assert.strictEqual(ast.length, 1);
    assert.strictEqual(ast[0].kind, 'list');
    assert.strictEqual(ast[0].children.length, 4);
    assert.strictEqual(ast[0].children[0].value, 'a:');
  });

  it('reports unmatched parens', () => {
    assert.throws(() => parseLinks(tokenize('(a: a is a')), /Unmatched/);
    assert.throws(() => parseLinks(tokenize('a: a is a)')), /Expected/);
  });
});

describe('checkIdentifierShape()', () => {
  it('flags underscore identifiers', () => {
    const f = checkIdentifierShape('foo_bar');
    assert.ok(f);
    assert.strictEqual(f.code, 'identifiers-without-hyphens');
    assert.match(f.message, /foo-bar/);
  });

  it('flags camelCase identifiers', () => {
    const f = checkIdentifierShape('fooBar');
    assert.ok(f);
    assert.match(f.message, /foo-bar/);
  });

  it('accepts single-word lowercase identifiers', () => {
    assert.strictEqual(checkIdentifierShape('alice'), null);
    assert.strictEqual(checkIdentifierShape('cloudy'), null);
  });

  it('accepts single-word PascalCase type names', () => {
    assert.strictEqual(checkIdentifierShape('Natural'), null);
    assert.strictEqual(checkIdentifierShape('Boolean'), null);
    assert.strictEqual(checkIdentifierShape('Type'), null);
  });

  it('accepts already-hyphenated identifiers', () => {
    assert.strictEqual(checkIdentifierShape('wet-grass'), null);
    assert.strictEqual(checkIdentifierShape('supports-many-valued'), null);
    assert.strictEqual(checkIdentifierShape('true-val'), null);
  });

  it('does not flag reserved keywords or symbols', () => {
    for (const k of ['and', 'or', 'not', 'is', 'has', 'probability', 'true', 'false',
                     'unknown', 'undefined', 'both', 'neither', 'nor', 'min', 'max',
                     'product', 'probabilistic_sum', 'avg', 'Type', 'type', 'apply',
                     'lambda', 'Pi', 'range', 'valence', '=', '!=', '+', '-', '*', '/']) {
      assert.strictEqual(checkIdentifierShape(k), null, `should not flag reserved "${k}"`);
    }
  });

  it('does not flag numeric literals', () => {
    assert.strictEqual(checkIdentifierShape('0.5'), null);
    assert.strictEqual(checkIdentifierShape('-1'), null);
    assert.strictEqual(checkIdentifierShape('42'), null);
  });
});

describe('suggestKebab()', () => {
  it('lowercases and joins underscores with hyphens', () => {
    assert.strictEqual(suggestKebab('foo_bar'), 'foo-bar');
    assert.strictEqual(suggestKebab('supports_many_valued'), 'supports-many-valued');
  });
  it('splits camelCase boundaries', () => {
    assert.strictEqual(suggestKebab('fooBar'), 'foo-bar');
    assert.strictEqual(suggestKebab('XMLHttpRequest'), 'xml-http-request');
  });
});

describe('isOperatorOnlyDefinition()', () => {
  it('flags operator-only definition with a body containing no English word', () => {
    const ast = parseLinks(tokenize('(@: + -)'));
    assert.ok(isOperatorOnlyDefinition(ast[0]));
  });

  it('does not flag operator-only definition with English connective in body', () => {
    const ast = parseLinks(tokenize('(!=: not =)'));
    assert.strictEqual(isOperatorOnlyDefinition(ast[0]), false);
  });

  it('does not flag definitions whose head is a regular identifier', () => {
    const ast = parseLinks(tokenize('(a: a is a)'));
    assert.strictEqual(isOperatorOnlyDefinition(ast[0]), false);
  });

  it('does not flag queries', () => {
    const ast = parseLinks(tokenize('(? (0.1 + 0.2))'));
    assert.strictEqual(isOperatorOnlyDefinition(ast[0]), false);
  });
});

describe('suggestWordForm()', () => {
  it('returns a known suggestion for built-in operators', () => {
    assert.strictEqual(suggestWordForm('='), 'equals');
    assert.strictEqual(suggestWordForm('!='), 'differs-from');
    assert.strictEqual(suggestWordForm('+'), 'plus');
    assert.strictEqual(suggestWordForm('-'), 'minus');
    assert.strictEqual(suggestWordForm('*'), 'times');
    assert.strictEqual(suggestWordForm('/'), 'divided-by');
  });
  it('falls back to a generic placeholder for unknown operators', () => {
    assert.match(suggestWordForm('@'), /word-form/);
  });
});

describe('lintFile() — end-to-end on inline sources', () => {
  it('returns no violations for a clean program', () => {
    const src = `# Clean example\n(alice: alice is alice)\n((alice = true) has probability 0.5)\n(? (alice = true))\n`;
    assert.deepStrictEqual(lintSource(src), []);
  });

  it('flags underscore identifiers with line/col information', () => {
    const src = `(wet_grass: wet_grass is wet_grass)\n`;
    const violations = lintSource(src);
    assert.strictEqual(violations.length, 3);
    for (const v of violations) {
      assert.strictEqual(v.code, 'identifiers-without-hyphens');
      assert.strictEqual(v.line, 1);
    }
  });

  it('flags operator-only definitions', () => {
    // `(@: + -)` defines `@` with a body that has no English word.
    const src = `(@: + -)\n`;
    const violations = lintSource(src);
    assert.ok(violations.some(v => v.code === 'operator-only-link'));
  });

  it('respects identifier allow-list', () => {
    const src = `(wet_grass: wet_grass is wet_grass)\n`;
    const allow = { identifiers: new Set(['wet_grass']), links: new Set() };
    assert.deepStrictEqual(lintSource(src, 'inline.lino', allow), []);
  });

  it('respects link allow-list keyed by basename:line', () => {
    const src = `(@: + -)\n`;
    const allow = { identifiers: new Set(), links: new Set(['inline.lino:1']) };
    assert.deepStrictEqual(lintSource(src, 'inline.lino', allow), []);
  });

  it('preserves externally defined identifiers in an allowed manifest file', () => {
    const src = `(definition ReferenceListToDupletList)\n`;
    const allow = {
      identifiers: new Set(),
      identifierFiles: new Set(['upstream.lino']),
      links: new Set(),
    };
    assert.deepStrictEqual(lintSource(src, 'upstream.lino', allow), []);
    assert.strictEqual(lintSource(src, 'other.lino', allow).length, 1);
  });

  it('reports parse errors instead of crashing', () => {
    const src = `(a: a is a\n`;
    const violations = lintSource(src);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].code, 'parse-error');
  });
});

describe('loadAllowlist()', () => {
  it('returns an empty allow-list when no path is provided', () => {
    const a = loadAllowlist(null);
    assert.strictEqual(a.identifiers.size, 0);
    assert.strictEqual(a.identifierFiles.size, 0);
    assert.strictEqual(a.links.size, 0);
  });

  it('parses identifiers and links from a JSON file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-english-'));
    const file = path.join(tmp, 'allowlist.json');
    fs.writeFileSync(file, JSON.stringify({
      identifiers: ['foo_bar'],
      identifierFiles: ['upstream.lino'],
      links: ['demo.lino:1'],
    }));
    try {
      const a = loadAllowlist(file);
      assert.ok(a.identifiers.has('foo_bar'));
      assert.ok(a.identifierFiles.has('upstream.lino'));
      assert.ok(a.links.has('demo.lino:1'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws on missing file', () => {
    assert.throws(() => loadAllowlist('/no/such/allowlist.json'), /not found/);
  });

  it('throws on malformed JSON', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-english-'));
    const file = path.join(tmp, 'allowlist.json');
    fs.writeFileSync(file, '{not-json');
    try {
      assert.throws(() => loadAllowlist(file), /not valid JSON/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('CLI', () => {
  it('exits 0 when all bundled examples and libraries are clean', () => {
    const examples = fs.readdirSync(path.join(REPO_ROOT, 'examples'))
      .filter(f => f.endsWith('.lino'))
      .map(f => path.join(REPO_ROOT, 'examples', f));
    const libraries = fs.readdirSync(path.join(REPO_ROOT, 'lib', 'classical'))
      .filter(f => f.endsWith('.lino'))
      .map(f => path.join(REPO_ROOT, 'lib', 'classical', f));
    const r = spawnSync(process.execPath, [SCRIPT, ...examples, ...libraries], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0,
      `expected clean lint, got status ${r.status}\n${r.stdout}\n${r.stderr}`);
  });

  it('exits 1 and prints a diagnostic for a known violation', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-english-'));
    const file = path.join(tmp, 'bad.lino');
    fs.writeFileSync(file, '(foo_bar: foo_bar is foo_bar)\n');
    try {
      const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, /identifiers-without-hyphens/);
      assert.match(r.stdout, /foo_bar/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--help prints usage and exits 0', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  });

  it('exits 2 when no files are supplied', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.strictEqual(r.status, 2);
  });

  it('honours an allow-list file passed via --allowlist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-english-'));
    const file = path.join(tmp, 'bad.lino');
    fs.writeFileSync(file, '(foo_bar: foo_bar is foo_bar)\n');
    const allow = path.join(tmp, 'allowlist.json');
    fs.writeFileSync(allow, JSON.stringify({ identifiers: ['foo_bar'] }));
    try {
      const r = spawnSync(process.execPath, [SCRIPT, '--allowlist', allow, file], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0,
        `expected clean lint with allow-list, got status ${r.status}\n${r.stdout}\n${r.stderr}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
