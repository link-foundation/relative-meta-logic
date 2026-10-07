// Documentation regression tests for issue #48.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('soundness documentation', () => {
  it('is linked from the README', () => {
    const readme = read('README.md');
    assert.match(readme, /\[Soundness statement\]\(\.\/docs\/SOUNDNESS\.md\)/);
  });

  it('cross-links the C2 proof-replay checker implementations', () => {
    const doc = read('docs/SOUNDNESS.md');
    for (const expected of [
      '../js/src/check.mjs',
      '../js/src/rml-check.mjs',
      '../rust/src/check.rs',
      '../rust/src/bin/rml-check.rs',
    ]) {
      assert.match(doc, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('states the trusted aggregator family for soundness claims', () => {
    const doc = read('docs/SOUNDNESS.md');
    for (const expected of [
      'Aggregator-Relative Soundness',
      '`avg`',
      '`min`',
      '`max`',
      '`product` / `prod`',
      '`probabilistic_sum` / `ps`',
    ]) {
      assert.ok(doc.includes(expected), `missing ${expected}`);
    }
  });
});

describe('generated API reference documentation', () => {
  it('is linked from the README', () => {
    const readme = read('README.md');
    assert.match(
      readme,
      /\[API reference\]\(https:\/\/link-foundation\.github\.io\/relative-meta-logic\/\)/,
    );
  });

  it('links the online playground from the README', () => {
    const readme = read('README.md');
    assert.match(
      readme,
      /\[Online playground\]\(https:\/\/link-foundation\.github\.io\/relative-meta-logic\/playground\/\)/,
    );
  });

  it('builds JavaScript and Rust API docs for GitHub Pages on release', () => {
    const workflow = read('.github/workflows/api-docs.yml');
    for (const expected of [
      'release:',
      'types: [published]',
      'npm run docs',
      'npm run build:playground',
      'npm run test:playground',
      'cargo doc',
      'actions/configure-pages',
      'actions/upload-pages-artifact',
      'actions/deploy-pages',
      'docs/playground/**',
      'scripts/build-playground.mjs',
      'scripts/playground.test.mjs',
    ]) {
      assert.ok(workflow.includes(expected), `missing ${expected}`);
    }
  });

  it('defines a JavaScript docs script for JSDoc generation', () => {
    const packageJson = JSON.parse(read('js/package.json'));
    assert.equal(packageJson.scripts.docs, 'node ../scripts/run-with-cache.mjs -- jsdoc -c ../docs/api/jsdoc.json');
  });

  it('writes a Pages landing page and copies playground assets', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-docs-site-'));
    try {
      execFileSync(process.execPath, ['scripts/write-docs-index.mjs', outDir], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
      const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      assert.ok(index.includes('./playground/'));
      assert.ok(fs.existsSync(path.join(outDir, 'playground', 'index.html')));
      assert.ok(fs.existsSync(path.join(outDir, 'playground', 'rml-playground-runtime.mjs')));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('compatibility and release documentation', () => {
  it('is linked from the README', () => {
    const readme = read('README.md');
    assert.match(
      readme,
      /\[Compatibility and release policy\]\(\.\/docs\/COMPATIBILITY\.md\)/,
    );
  });

  it('covers semver, deprecations, and release cadence', () => {
    const doc = read('docs/COMPATIBILITY.md');
    for (const expected of [
      'Semantic Versioning',
      'Pre-1.0 Compatibility',
      'Deprecation Procedure',
      'Release Cadence',
      '`js/package.json`',
      '`rust/Cargo.toml`',
    ]) {
      assert.ok(doc.includes(expected), `missing ${expected}`);
    }
  });

  it('keeps JavaScript and Rust package versions aligned', () => {
    const packageJson = JSON.parse(read('js/package.json'));
    const cargoToml = read('rust/Cargo.toml');
    const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];

    assert.equal(packageJson.version, cargoVersion);
  });
});

describe('supported logic type overview documentation', () => {
  function readmeTableRow(prefix) {
    const readme = read('README.md');
    return readme.split('\n').find(line => line.startsWith(prefix));
  }

  it('mentions probabilistic logic in the continuous valence row', () => {
    const row = readmeTableRow('| 0/∞ |');

    assert.ok(row, 'README must include the continuous valence row');
    for (const expected of [
      '[Probabilistic](https://en.wikipedia.org/wiki/Probabilistic_logic)',
      '[Probabilistic logic](https://en.wikipedia.org/wiki/Probabilistic_logic)',
      'probability logic',
      '[Infinite-valued logic](https://en.wikipedia.org/wiki/Infinite-valued_logic)',
    ]) {
      assert.ok(row.includes(expected), `continuous row missing ${expected}`);
    }
  });

  it('uses specific Wikipedia references for finite and four-valued logic rows', () => {
    const quaternary = readmeTableRow('| 4 |');
    const nValued = readmeTableRow('| N |');

    assert.ok(quaternary, 'README must include the quaternary valence row');
    assert.ok(nValued, 'README must include the N-valued valence row');
    assert.ok(
      quaternary.includes('https://en.wikipedia.org/wiki/Four-valued_logic'),
      'quaternary row must link four-valued logic',
    );
    assert.ok(
      nValued.includes('https://en.wikipedia.org/wiki/Finite-valued_logic'),
      'N-valued row must link finite-valued logic',
    );
  });

  it('keeps the expanded logic references in the README bibliography', () => {
    const readme = read('README.md');

    for (const expected of [
      '[Probabilistic logic](https://en.wikipedia.org/wiki/Probabilistic_logic)',
      '[Finite-valued logic](https://en.wikipedia.org/wiki/Finite-valued_logic)',
      '[Infinite-valued logic](https://en.wikipedia.org/wiki/Infinite-valued_logic)',
    ]) {
      assert.ok(readme.includes(expected), `README references missing ${expected}`);
    }
  });
});

describe('self-bootstrap tutorial documentation', () => {
  it('is linked from the README', () => {
    const readme = read('README.md');
    assert.ok(
      readme.includes('[RML in RML self-bootstrap tutorial](./docs/tutorials/self-bootstrap.md)'),
      'README must link docs/tutorials/self-bootstrap.md',
    );
  });

  it('walks through the encoded self-bootstrap files in narrative order', () => {
    const doc = read('docs/tutorials/self-bootstrap.md');
    const expectedOrder = [
      './lib/self/grammar.lino',
      './lib/self/evaluator.lino',
      './lib/self/types.lino',
      './lib/self/operators.lino',
      './lib/self/metatheorem.lino',
      './.github/workflows/bootstrap.yml',
    ];

    let previous = -1;
    for (const expected of expectedOrder) {
      const index = doc.indexOf(expected);
      assert.ok(index > previous, `${expected} missing or out of order`);
      previous = index;
    }

    for (const expected of [
      'npm run test:bootstrap',
      './test-corpus/evaluator-operators.lino',
      './test-corpus/expected.lino',
    ]) {
      assert.ok(doc.includes(expected), `missing ${expected}`);
    }
  });
});

describe('progressive tutorial documentation', () => {
  const tutorials = [
    ['Classical logic tutorial', './docs/tutorials/classical.md'],
    ['Fuzzy logic tutorial', './docs/tutorials/fuzzy.md'],
    ['Probabilistic reasoning tutorial', './docs/tutorials/probabilistic.md'],
    ['Typed LiNo tutorial', './docs/tutorials/typed.md'],
    ['Metatheory tutorial', './docs/tutorials/metatheory.md'],
    ['RML in RML self-bootstrap tutorial', './docs/tutorials/self-bootstrap.md'],
  ];

  it('links the tutorial path from the README in learning order', () => {
    const readme = read('README.md');

    let previous = -1;
    for (const [label, href] of tutorials) {
      const markdown = `[${label}](${href})`;
      const index = readme.indexOf(markdown);
      assert.ok(index > previous, `${markdown} missing or out of order`);
      previous = index;
    }
  });

  it('provides a docs/tutorials index in the same learning order', () => {
    const indexDoc = read('docs/tutorials/README.md');
    const orderedPaths = [
      './classical.md',
      './fuzzy.md',
      './probabilistic.md',
      './typed.md',
      './metatheory.md',
      './self-bootstrap.md',
    ];

    let previous = -1;
    for (const expected of orderedPaths) {
      const index = indexDoc.indexOf(expected);
      assert.ok(index > previous, `${expected} missing or out of order`);
      previous = index;
    }
  });

  it('connects each tutorial to its runnable source material', () => {
    const expectedReferences = {
      'docs/tutorials/classical.md': [
        '../../examples/classical-logic.lino',
        '../../lib/classical/core.lino',
      ],
      'docs/tutorials/fuzzy.md': [
        '../../examples/fuzzy-logic.lino',
        '../../lib/probabilistic/fuzzy.lino',
      ],
      'docs/tutorials/probabilistic.md': [
        '../../examples/bayesian-network.lino',
        '../../lib/probabilistic/bayesian.lino',
      ],
      'docs/tutorials/typed.md': [
        '../../examples/dependent-types.lino',
        '../../docs/KERNEL.md',
      ],
      'docs/tutorials/metatheory.md': [
        '../../docs/METATHEOREMS.md',
        '../../examples/lambda-calculus.lino',
      ],
    };

    for (const [docPath, references] of Object.entries(expectedReferences)) {
      const doc = read(docPath);
      for (const expected of references) {
        assert.ok(doc.includes(expected), `${docPath} missing ${expected}`);
      }
    }
  });
});
