// Release regression for issue #188. Included in the existing npm test suite.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assertReleaseContext, interpretRegistryResponse, isPublished, publish,
  publishGuidance, verify,
} from './crates-release.mjs';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const workflowPath = new URL('../.github/workflows/crates-release.yml', import.meta.url);
const name = 'relative-meta-logic';
const version = '0.19.1';
const reply = (overrides = {}) => JSON.stringify({ version: { crate: name, num: version, ...overrides } });
const releaseEnv = { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push' };

describe('crates.io release workflow (issue #188)', { timeout: 10000 }, () => {
  it('provides a crates.io release pipeline', () => {
    assert.ok(fs.existsSync(workflowPath), 'the publishable Rust crate needs a crates.io workflow');
  });

  it('validates PR packages without publishing permissions or credentials', () => {
    const workflow = read('.github/workflows/crates-release.yml');
    const validation = workflow.split('\n  validate:')[1].split('\n  publish:')[0];
    assert.match(workflow, /pull_request:\n    branches: \[main\]/);
    assert.match(workflow, /push:\n    branches: \[main\]/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(validation, /cargo publish --dry-run --locked/);
    assert.match(validation, /node --test scripts\/crates-release.test.mjs/);
    assert.match(validation, /node scripts\/crates-release.mjs check/);
    assert.doesNotMatch(validation, /secrets\.|id-token: write|crates-io-auth-action|--no-verify/);
  });

  it('publishes only unpublished versions on main after validation', () => {
    const job = read('.github/workflows/crates-release.yml').split('\n  publish:')[1];
    assert.match(job, /needs: validate/);
    const guard = job.split('runs-on:')[0];
    assert.match(guard, /github.ref == 'refs\/heads\/main'/);
    assert.match(guard, /github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'/);
    assert.match(guard, /needs.validate.outputs.should_publish == 'true'/);
    assert.match(job, /id-token: write/);
    assert.match(job, /node scripts\/crates-release.mjs publish/);
    assert.match(job, /node scripts\/crates-release.mjs verify/);
  });

  it('pins authentication and tries OIDC before both optional fallback secrets', () => {
    const job = read('.github/workflows/crates-release.yml').split('\n  publish:')[1];
    const auth = job.split('- name: Authenticate')[1].split('- name: Publish')[0];
    assert.match(auth, /id: crates_auth/);
    assert.match(auth, /uses: rust-lang\/crates-io-auth-action@[0-9a-f]{40}\b/);
    assert.match(auth, /continue-on-error: true/);
    assert.match(job, /CARGO_REGISTRY_TOKEN: \$\{\{ steps.crates_auth.outputs.token \|\| secrets.CARGO_REGISTRY_TOKEN \|\| secrets.CARGO_TOKEN \}\}/);
    assert.match(job, /timeout-minutes: 30/);
  });

  it('ships the library and all CLI sources with registry metadata and aligned versions', () => {
    const manifest = read('rust/Cargo.toml');
    assert.doesNotMatch(manifest, /publish\s*=\s*false/);
    assert.match(manifest, /repository = "https:\/\/github.com\/link-foundation\/relative-meta-logic"/);
    assert.match(manifest, /include = \["src\/\*\*", "Cargo.toml", "Cargo.lock", "README.md"\]/);
    for (const file of ['src/lib.rs', 'src/main.rs', 'src/bin/rml-check.rs', 'src/bin/rml-meta.rs']) {
      assert.match(manifest, new RegExp(`path = "${file.replaceAll('.', '\\.')}"`));
    }
    const current = manifest.match(/^version = "([^"]+)"/m)[1];
    const js = JSON.parse(read('js/package.json'));
    const lock = JSON.parse(read('js/package-lock.json'));
    assert.equal(current, js.version);
    assert.equal(current, lock.version);
    assert.equal(current, lock.packages[''].version);
    assert.ok(read('rust/Cargo.lock').includes(`name = "${name}"\nversion = "${current}"`));
  });
});

describe('crates.io release helpers', { timeout: 10000 }, () => {
  it('recognizes existing versions, including yanked ones, and only treats 404 as absent', () => {
    assert.equal(interpretRegistryResponse(404, '{"errors":[]}', name, version), false);
    assert.equal(interpretRegistryResponse(200, reply(), name, version), true);
    assert.equal(interpretRegistryResponse(200, reply({ yanked: true }), name, version), true);
    for (const status of [401, 403, 429, 500, 503]) {
      assert.throws(() => interpretRegistryResponse(status, '{}', name, version), new RegExp(`HTTP ${status}`));
    }
  });

  it('fails closed on malformed or mismatched successful registry replies', () => {
    for (const body of ['<html>error</html>', '{}', reply({ num: '0.1.0' }), reply({ crate: 'other' })]) {
      assert.throws(() => interpretRegistryResponse(200, body, name, version));
    }
  });

  it('looks up the exact version with an identified, bounded request', async () => {
    const found = await isPublished(name, version, async (url, options) => {
      assert.equal(url, `https://crates.io/api/v1/crates/${name}/${version}`);
      assert.match(options.headers['User-Agent'], /link-foundation\/relative-meta-logic/);
      assert.ok(options.signal instanceof AbortSignal);
      return { status: 200, text: async () => reply() };
    });
    assert.equal(found, true);
    await assert.rejects(isPublished(name, version, async () => { throw new Error('network unavailable'); }), /network unavailable/);
  });

  it('blocks pull requests, fork branches, and local publication', () => {
    for (const env of [{}, { ...releaseEnv, GITHUB_EVENT_NAME: 'pull_request' },
      { ...releaseEnv, GITHUB_REF: 'refs/heads/feature' }, { ...releaseEnv, GITHUB_EVENT_NAME: 'release' }]) {
      assert.throws(() => assertReleaseContext(env), /only allowed/);
    }
    assertReleaseContext(releaseEnv);
    assertReleaseContext({ ...releaseEnv, GITHUB_EVENT_NAME: 'workflow_dispatch' });
  });

  it('rejects missing credentials before invoking Cargo and explains bootstrap', async () => {
    await assert.rejects(publish({ name, version }, {
      env: releaseEnv,
      run: () => assert.fail('Cargo must not run without a credential'),
    }), /package-registry-manager setup --repository \. --registry crates-io --execute/);
    const guidance = publishGuidance(name);
    assert.match(guidance, /workflow crates-release.yml, and no environment/);
    assert.match(guidance, /Keep fallback secrets/);
    assert.match(guidance, /CARGO_REGISTRY_TOKEN.*CARGO_TOKEN/);
  });

  it('passes the selected credential to Cargo without exposing it as a command argument', async () => {
    const env = { ...releaseEnv, CARGO_REGISTRY_TOKEN: 'mock-selected-token' };
    let calls = 0;
    await publish({ name, version }, { env, run: (command, args, options) => {
      calls += 1;
      assert.equal(command, 'cargo');
      assert.deepEqual(args, ['publish', '--locked']);
      assert.equal(options.env, env);
      assert.match(options.cwd, /\/rust\/$/);
      return { status: 0 };
    } });
    assert.equal(calls, 1);
  });

  it('fails on Cargo errors, including a killed child, rather than claiming publication', async () => {
    for (const result of [{ status: 1 }, { status: null }, { error: new Error('cargo unavailable') }]) {
      await assert.rejects(publish({ name, version }, {
        env: { ...releaseEnv, CARGO_REGISTRY_TOKEN: 'mock-token' }, run: () => result,
      }));
    }
  });

  it('polls until the exact version is visible, with finite attempts and no real delays', async () => {
    let calls = 0;
    let sleeps = 0;
    const messages = [];
    await verify(name, version, { attempts: 3, delayMs: 15,
      lookup: async () => ++calls === 3, log: message => messages.push(message),
      sleep: async ms => { assert.equal(ms, 15); sleeps += 1; },
    });
    assert.equal(calls, 3);
    assert.equal(sleeps, 2);
    assert.deepEqual(messages, [`Verified ${name}@${version} on crates.io.`]);
    calls = 0;
    await assert.rejects(verify(name, version, { attempts: 2,
      lookup: async () => { calls += 1; return false; }, sleep: async () => {},
    }), /after 2 attempts/);
    assert.equal(calls, 2);
    await assert.rejects(verify(name, version, {
      lookup: async () => { throw new Error('registry outage'); }, sleep: async () => assert.fail(),
    }), /registry outage/);
  });
});
