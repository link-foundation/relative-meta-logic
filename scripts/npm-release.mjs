#!/usr/bin/env node
// npm release helper for the `relative-meta-logic` library (issue #189).
//
// Used by `.github/workflows/release.yml`, the single workflow file that is
// registered as the npm trusted publisher for the package. npm trusted
// publishing (OIDC) binds one workflow file per package, so every npm release
// must go through that workflow. crates.io publishing is tracked separately
// in issue #188 and is intentionally not handled here.
//
// Subcommands:
//   check   Decide whether js/package.json's version still needs publishing.
//           Writes `name`, `version`, `tag` and `should_publish` to
//           $GITHUB_OUTPUT when it is set.
//   publish Run `npm publish --provenance --access public` in js/ and, when the
//           registry refuses it, print what a maintainer has to do.
//   verify  Poll the registry until `name@version` is visible.
//
// Set RML_RELEASE_DEBUG=1 to print every npm command and its raw output.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORY = 'link-foundation/relative-meta-logic';
export const WORKFLOW_FILE = 'release.yml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIBRARY_DIR = path.join(repoRoot, 'js');

const debug = process.env.RML_RELEASE_DEBUG === '1';

export function readLibraryManifest(dir = LIBRARY_DIR) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (!manifest.name || !manifest.version) {
    throw new Error(`${dir}/package.json must declare both "name" and "version"`);
  }
  return manifest;
}

export function releaseTag(version) {
  return `js-v${version}`;
}

function runNpm(args, { cwd = LIBRARY_DIR } = {}) {
  if (debug) console.log(`[debug] npm ${args.join(' ')} (cwd: ${cwd})`);
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8' });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (debug) {
    console.log(`[debug] exit status: ${result.status}`);
    if (stdout) console.log(`[debug] stdout:\n${stdout}`);
    if (stderr) console.log(`[debug] stderr:\n${stderr}`);
  }
  return { status: result.status, stdout, stderr, output: `${stdout}\n${stderr}` };
}

// Interpret the result of `npm view <name>@<version> version --json`.
// Returns true when the version is on the registry, false when the registry
// answered E404 (package or version missing), and throws on anything else so
// a registry outage never turns into a duplicate publish attempt.
export function interpretViewResult({ status, stdout, output }, version) {
  if (status === 0) {
    const text = stdout.trim();
    if (!text) return false;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    const versions = Array.isArray(parsed) ? parsed : [parsed];
    return versions.includes(version);
  }
  if (/\bE404\b|404 Not Found|is not in this registry/i.test(output)) return false;
  throw new Error(`npm view failed with status ${status}:\n${output.trim()}`);
}

export function isPublished(name, version) {
  return interpretViewResult(runNpm(['view', `${name}@${version}`, 'version', '--json']), version);
}

// Classify a failed `npm publish` so the log says exactly what to do.
export function classifyPublishFailure(output) {
  if (/cannot publish over|previously published|EPUBLISHCONFLICT/i.test(output)) {
    return 'already-published';
  }
  if (/\bE404\b|404 Not Found/i.test(output)) return 'not-found';
  if (/ENEEDAUTH|\bE401\b|need auth|not logged in|requires you to be logged in/i.test(output)) {
    return 'unauthenticated';
  }
  if (/\bE403\b|403 Forbidden/i.test(output)) return 'forbidden';
  if (/provenance|sigstore|id-token|OIDC/i.test(output)) return 'provenance';
  return 'unknown';
}

export function trustedPublisherCommand(name) {
  return `npm trust github ${name} --file ${WORKFLOW_FILE} --repository ${REPOSITORY} --allow-publish --yes`;
}

export function buildPublishGuidance(name, version, kind) {
  const settings = `https://www.npmjs.com/package/${name}/access`;
  const trust = [
    `Configure the trusted publisher for ${name} once, as an npm owner of the package:`,
    `  - npm CLI (>= 11.10): ${trustedPublisherCommand(name)}`,
    `  - or ${settings} -> "Trusted publishing" -> GitHub Actions, organization/user "link-foundation",`,
    `    repository "relative-meta-logic", workflow filename "${WORKFLOW_FILE}", no environment.`,
  ];
  const bootstrap = [
    `If ${name} does not exist on npm yet, a trusted publisher cannot be attached to it.`,
    'Bootstrap the very first version with one of:',
    `  - package-registry-manager setup --repository . --registry npm --execute`,
    '    (publishes with a short-lived token, registers the trusted publisher, revokes the token), or',
    `  - add a short-lived granular npm token as the NPM_TOKEN repository secret, re-run this workflow,`,
    '    configure the trusted publisher as described above, then delete the NPM_TOKEN secret.',
  ];
  const header = `npm publish of ${name}@${version} failed`;
  switch (kind) {
    case 'already-published':
      return [`${header}: this version already exists on npm.`, `Bump "version" in js/package.json to release a new version.`].join('\n');
    case 'not-found':
    case 'unauthenticated':
      return [`${header}: the registry did not accept the GitHub Actions OIDC identity (${kind}).`, ...bootstrap, ...trust].join('\n');
    case 'forbidden':
      return [`${header}: the registry refused the publish (403).`, ...trust, 'Also check that the trusted publisher allows publishing and that 2FA settings permit automation.'].join('\n');
    case 'provenance':
      return [`${header}: provenance generation failed.`, `The job needs "permissions: id-token: write" and must run on a GitHub-hosted runner for ${REPOSITORY}.`].join('\n');
    default:
      return [`${header}. See the npm output above.`, ...trust].join('\n');
  }
}

function writeOutputs(outputs) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

function check() {
  const { name, version } = readLibraryManifest();
  const published = isPublished(name, version);
  console.log(published
    ? `${name}@${version} is already on npm; nothing to publish.`
    : `${name}@${version} is not on npm yet; it will be published.`);
  writeOutputs({ name, version, tag: releaseTag(version), should_publish: String(!published) });
}

function publish() {
  const { name, version } = readLibraryManifest();
  const result = runNpm(['publish', '--provenance', '--access', 'public']);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status === 0) {
    console.log(`Published ${name}@${version} through npm trusted publishing.`);
    return;
  }
  const kind = classifyPublishFailure(result.output);
  console.error(`::error title=npm publish failed::${buildPublishGuidance(name, version, kind).replace(/\n/g, '%0A')}`);
  console.error(buildPublishGuidance(name, version, kind));
  process.exit(1);
}

async function verify({ attempts = 10, delayMs = 15000 } = {}) {
  const { name, version } = readLibraryManifest();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (isPublished(name, version)) {
      console.log(`Verified: npm view ${name}@${version} version succeeds.`);
      return;
    }
    console.log(`Attempt ${attempt}/${attempts}: ${name}@${version} not visible yet.`);
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  console.error(`::error::${name}@${version} is still not visible on npm after ${attempts} attempts.`);
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const command = process.argv[2];
  if (command === 'check') check();
  else if (command === 'publish') publish();
  else if (command === 'verify') await verify();
  else {
    console.error('Usage: node scripts/npm-release.mjs <check|publish|verify>');
    process.exit(2);
  }
}
