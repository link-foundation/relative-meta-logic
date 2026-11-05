/** Make an independent working-source snapshot, including indexed submodules. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function copyMeasurementSources(source, fixture) {
  // A Git submodule is an indexed commit, not a regular source file. Preserve
  // that boundary in the measurement checkout rather than silently omitting
  // its runtime or copying the original worktree's .git indirection.
  const gitlinks = execFileSync('git', ['-C', source, 'ls-files', '--stage', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean).filter(line => line.startsWith('160000 '));
  for (const entry of gitlinks) {
    const [, revision, stage, relative] = entry.match(/^160000 ([a-f0-9]{40}) (\d)\t(.+)$/) ?? [];
    if (!relative || stage !== '0') throw new Error('Cannot measure an unresolved submodule index');
    const upstream = path.join(source, relative);
    const git = args => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' }).trim();
    if (git(['rev-parse', 'HEAD']) !== revision || git(['status', '--porcelain'])) {
      throw new Error(`Measurement requires a clean initialized submodule at the indexed revision: ${relative}`);
    }
    const destination = path.join(fixture, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    execFileSync('git', ['clone', '--local', '--no-hardlinks', '--quiet', upstream, destination], { stdio: 'pipe' });
    execFileSync('git', ['-C', destination, 'checkout', '--detach', '--quiet', revision], { stdio: 'pipe' });
  }
  const files = execFileSync('git', ['-C', source, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const relative of new Set(files)) {
    const from = path.join(source, relative);
    if (!fs.existsSync(from) || !fs.lstatSync(from).isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(fixture, relative)), { recursive: true });
    fs.copyFileSync(from, path.join(fixture, relative));
  }
}
