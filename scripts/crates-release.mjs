#!/usr/bin/env node
// crates.io counterpart to npm-release.mjs. Never log publishing credentials.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORY = 'link-foundation/relative-meta-logic';
export const WORKFLOW_FILE = 'crates-release.yml';
const crateDir = fileURLToPath(new URL('../rust/', import.meta.url));

export function readCrateManifest() {
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--locked'], {
    cwd: crateDir, encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`cargo metadata failed:\n${result.stderr}`);
  const metadata = JSON.parse(result.stdout);
  const manifest = metadata.packages.find(pkg => metadata.workspace_members.includes(pkg.id));
  if (!manifest || manifest.publish?.length === 0) throw new Error('Rust crate must be publishable');
  return manifest;
}

// Only a registry 404 means absent. Outages and malformed replies must never
// turn into a new publication attempt. A yanked version still exists.
export function interpretRegistryResponse(status, body, name, version) {
  if (status === 404) return false;
  if (status !== 200) throw new Error(`crates.io lookup failed (HTTP ${status})`);
  const data = JSON.parse(body);
  if (data.version?.crate !== name || data.version?.num !== version) {
    throw new Error(`Unexpected crates.io response for ${name}@${version}`);
  }
  return true;
}

export async function isPublished(name, version, request = fetch) {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  if (process.env.RML_RELEASE_DEBUG === '1') console.log(`[debug] GET ${url}`);
  const response = await request(url, {
    headers: { 'User-Agent': `relative-meta-logic release (https://github.com/${REPOSITORY})` },
    signal: AbortSignal.timeout(30000),
  });
  return interpretRegistryResponse(response.status, await response.text(), name, version);
}

export function publishGuidance(name) {
  return [
    `Configure crates.io publishing for ${name}:`,
    `For the first publication, run as a crates.io owner from a checkout of main after merge:`,
    'package-registry-manager setup --repository . --registry crates-io --execute',
    'This bootstraps the crate with a short-lived scoped token and registers its trusted publisher.',
    `Alternatively, provide a crate-scoped CARGO_REGISTRY_TOKEN (or CARGO_TOKEN) Actions secret,`,
    `re-run the crates-release workflow on main, then configure the trusted publisher at`,
    `https://crates.io/crates/${name}/settings with owner link-foundation,`,
    `repository relative-meta-logic, workflow ${WORKFLOW_FILE}, and no environment.`,
    'Keep fallback secrets: OIDC is tried first, then CARGO_REGISTRY_TOKEN, then CARGO_TOKEN.',
  ].join('\n');
}

export function assertReleaseContext(env = process.env) {
  if (env.GITHUB_REF !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('crates.io publishing is only allowed from a push or manual run on main');
  }
}

export async function verify(name, version, {
  attempts = 10, delayMs = 15000, lookup = isPublished,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await lookup(name, version)) {
      log(`Verified ${name}@${version} on crates.io.`);
      return;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`${name}@${version} is still absent from crates.io after ${attempts} attempts`);
}

export async function publish(manifest, {
  env = process.env,
  run = spawnSync,
} = {}) {
  assertReleaseContext(env);
  if (!env.CARGO_REGISTRY_TOKEN?.trim()) {
    throw new Error(`No crates.io publishing credential was selected.\n${publishGuidance(manifest.name)}`);
  }
  // --locked pins dependencies; verification is intentionally enabled.
  const result = run('cargo', ['publish', '--locked'], { cwd: crateDir, stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cargo publish failed (status ${result.status}). See Cargo output above.\n${publishGuidance(manifest.name)}`);
  }
}

async function main(command) {
  if (!['check', 'publish', 'verify'].includes(command)) {
    throw new Error('Usage: node scripts/crates-release.mjs <check|publish|verify>');
  }
  const { name, version } = readCrateManifest();
  if (command === 'check') {
    const published = await isPublished(name, version);
    const outputs = `name=${name}\nversion=${version}\nshould_publish=${!published}\n`;
    console.log(`${name}@${version}: ${published ? 'already published' : 'not published yet'}`);
    process.stdout.write(outputs);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  } else if (command === 'publish') {
    await publish({ name, version });
  } else {
    await verify(name, version);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
