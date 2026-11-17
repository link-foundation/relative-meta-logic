// Small real-registry probe: no build, credentials, or publishing.
// Run from the repository root: node experiments/issue-188/registry-probe.mjs
import assert from 'node:assert/strict';
import { isPublished, readCrateManifest } from '../../scripts/crates-release.mjs';

assert.equal(await isPublished('links-notation', '0.13.0'), true);
console.log('Known dependency version: present (HTTP 200 response validated).');
const { name, version } = readCrateManifest();
console.log(`${name}@${version}: ${await isPublished(name, version) ? 'present' : 'absent'}`);
