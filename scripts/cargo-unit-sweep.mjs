#!/usr/bin/env node
/**
 * Fingerprint-aware sweep of superseded Cargo units in a private target.
 *
 * Cargo never removes a unit whose metadata hash changed (a dependency
 * upgrade, a feature or profile change, a new rustc). A warm generation is
 * seeded from the previous one, so without eviction those units are carried
 * forward forever. Modification times cannot tell a stale unit from a fresh
 * one Cargo merely did not need to rebuild, so this sweep uses Cargo's own
 * answer instead: after a successful operation the same Cargo command is
 * re-queried with `--message-format=json` (and `--no-run` for tests), which
 * reports every unit of the build, including fresh ones. A unit is removed
 * only when the build referenced a unit with the same artifact stem under a
 * different hash, i.e. it was superseded. Kinds the build did not touch at all
 * (for example test binaries after a library-only build) are retained.
 * Failures never delete anything: the sweep is skipped with a recorded reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const hashed = /^(.+)-([0-9a-f]{16})(\..+)?$/;
const sweepable = new Set(['build', 'check', 'test', 'bench']);

/** The reference query for a Cargo command, or a reason it cannot be swept. */
export function cargoReferenceCommand(command) {
  const [program, ...rest] = command;
  if (!program || !/^cargo(?:\.exe)?$/i.test(path.basename(program))) return { reason: 'not a Cargo command' };
  const separator = rest.indexOf('--');
  const args = separator >= 0 ? rest.slice(0, separator) : rest;
  const index = args.findIndex(argument => !argument.startsWith('-') && !argument.startsWith('+'));
  const subcommand = args[index];
  if (!sweepable.has(subcommand)) return { reason: `cargo ${subcommand ?? '(none)'} does not report a complete build unit set` };
  if (args.some(argument => argument === '--message-format' || argument.startsWith('--message-format='))) return { reason: 'caller already selected a message format' };
  if (args.includes('--doc')) return { reason: 'documentation tests do not report compiled units' };
  const query = [program, ...args, '--message-format=json'];
  if (['test', 'bench'].includes(subcommand) && !args.includes('--no-run')) query.push('--no-run');
  return { query };
}

/**
 * Units the build referenced: all hashes, plus artifact stems per profile
 * directory (`debug`, `release`, `<triple>/debug`, ...). A debug build says
 * nothing about which release units are current, so stems never cross profiles.
 */
export function referencedUnits(stdout, targetDirectory) {
  const root = path.resolve(targetDirectory);
  const profiles = new Map(), hashes = new Set();
  let messages = 0;
  const note = file => {
    const relative = path.relative(root, path.resolve(file));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
    const parts = relative.split(path.sep);
    const area = parts.findIndex(part => part === 'deps' || part === 'build');
    if (area < 1 || area + 1 >= parts.length) return;
    const match = parts[area + 1].match(hashed);
    if (!match) return;
    hashes.add(match[2]);
    const profile = parts.slice(0, area).join('/');
    if (!profiles.has(profile)) profiles.set(profile, { stems: new Set(), buildStems: new Set() });
    if (parts[area] === 'deps') { if (match[3] !== '.d') profiles.get(profile).stems.add(match[1]); }
    else profiles.get(profile).buildStems.add(match[1]);
  };
  for (const line of String(stdout).split('\n')) {
    if (!line.startsWith('{')) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.reason === 'compiler-artifact') {
      messages += 1;
      for (const file of message.filenames ?? []) note(file);
      if (message.executable) note(message.executable);
    } else if (message.reason === 'build-script-executed' && message.out_dir) {
      messages += 1;
      note(message.out_dir);
    }
  }
  return { profiles, hashes, messages };
}

function bytesOf(full) {
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return stat.isFile() ? stat.size : 0;
  let total = 0;
  for (const entry of fs.readdirSync(full)) total += bytesOf(path.join(full, entry));
  return total;
}

/**
 * Remove superseded units below a private target. Never follows links and
 * never touches uplifted (unhashed) artifacts, untouched profiles, or units of
 * kinds the build did not reference.
 */
export function sweepSupersededUnits(targetDirectory, referenced, { dryRun = false } = {}) {
  const root = fs.realpathSync(targetDirectory);
  if (!referenced.messages || !referenced.hashes.size) return { skipped: 'Cargo reported no build units; nothing is provably superseded', removed: [], reclaimedBytes: 0 };
  const removed = [];
  let reclaimedBytes = 0;
  for (const [relative, { stems, buildStems }] of referenced.profiles) {
    let profile = root;
    // Every component must be a real directory inside the target, never a link.
    for (const part of relative.split('/')) {
      profile = path.join(profile, part);
      const stat = fs.lstatSync(profile, { throwIfNoEntry: false });
      if (!stat?.isDirectory() || stat.isSymbolicLink()) { profile = null; break; }
    }
    if (!profile) continue;
    const superseded = new Set();
    const listing = area => {
      const directory = path.join(profile, area);
      const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
      return stat?.isDirectory() && !stat.isSymbolicLink() ? fs.readdirSync(directory) : [];
    };
    for (const name of listing('deps')) {
      const match = name.match(hashed);
      if (match && match[3] !== '.d' && stems.has(match[1]) && !referenced.hashes.has(match[2])) superseded.add(match[2]);
    }
    for (const name of listing('build')) {
      const match = name.match(hashed);
      if (match && !match[3] && buildStems.has(match[1]) && !referenced.hashes.has(match[2])) superseded.add(match[2]);
    }
    if (!superseded.size) continue;
    for (const area of ['deps', 'build', '.fingerprint']) {
      for (const name of listing(area)) {
        const match = name.match(hashed);
        if (!match || !superseded.has(match[2]) || referenced.hashes.has(match[2])) continue;
        const full = path.join(profile, area, name);
        const bytes = bytesOf(full);
        if (!dryRun) fs.rmSync(full, { recursive: true, force: true });
        removed.push(path.relative(root, full).split(path.sep).join('/'));
        reclaimedBytes += bytes;
      }
    }
  }
  return { removed, reclaimedBytes };
}

/** Query Cargo for the build's units and sweep superseded ones. */
export function sweepAfterCargo(command, env, targetDirectory, { run = spawnSync } = {}) {
  if (env.RML_CACHE_CARGO_SWEEP === '0') return { skipped: 'disabled by RML_CACHE_CARGO_SWEEP=0' };
  const { query, reason } = cargoReferenceCommand(command);
  if (!query) return { skipped: reason };
  const result = run(query[0], query.slice(1), { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1800000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) return { skipped: `reference query failed: ${result.error?.message ?? `exit ${result.status}`}` };
  const referenced = referencedUnits(result.stdout, targetDirectory);
  return { query, referencedUnits: referenced.hashes.size, ...sweepSupersededUnits(targetDirectory, referenced) };
}
