#!/usr/bin/env node
/** Explicit developer bootstrap; npm prepare invokes this only for this checkout. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeMetaLanguage } from './initialize-meta-language.mjs';

const rootHere = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = '# RML composed cache hook v1';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function bootstrap(root = rootHere) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    // A package in node_modules, a registry/git dependency, and an exported source
    // tree may not reconfigure the consuming developer's Git repository.
    if (fs.realpathSync(git(['rev-parse', '--show-toplevel'])) !== fs.realpathSync(root)) return { installed: false, reason: 'not repository root' };
    git(['ls-files', '--error-unmatch', 'scripts/bootstrap.mjs', 'scripts/cache-policy.json', 'js/package.json', 'rust/Cargo.toml']);
    if (process.env.npm_lifecycle_event === 'prepare' && process.env.INIT_CWD && !path.resolve(process.env.INIT_CWD).startsWith(`${root}${path.sep}`) && path.resolve(process.env.INIT_CWD) !== root) return { installed: false, reason: 'downstream package installation' };
  } catch { return { installed: false, reason: 'not a tracked RML developer checkout' }; }
  initializeMetaLanguage(root);
  const gitDir = git(['rev-parse', '--absolute-git-dir']);
  const local = path.join(gitDir, 'rml-hooks');
  const configured = (() => { try { return git(['config', '--path', '--get', 'core.hooksPath']); } catch { return null; } })();
  const previous = configured ? path.resolve(root, configured) : path.resolve(root, git(['rev-parse', '--git-path', 'hooks']));
  fs.mkdirSync(local, { recursive: true });
  if (fs.lstatSync(local).isSymbolicLink()) throw new Error('Refusing symlink hook installation directory');
  const sourceFile = path.join(local, 'previous-hooks.json');
  if (fs.lstatSync(sourceFile, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Refusing symlink hook composition record');
  if ((fs.lstatSync(sourceFile, { throwIfNoEntry: false })?.nlink ?? 0) > 1) throw new Error('Refusing hard link hook composition record');
  let source = previous;
  if (previous === local) {
    if (!fs.existsSync(sourceFile)) throw new Error('Existing hook installation is missing its composition record');
    source = JSON.parse(fs.readFileSync(sourceFile, 'utf8')).path;
  } else fs.writeFileSync(sourceFile, JSON.stringify({ path: previous }));
  // Delegate every existing hook, not only pre-commit. Never rewrite the user's
  // old hook directory, global config, or pre-commit framework configuration.
  const names = new Set(['pre-commit', ...(fs.existsSync(source) && fs.statSync(source).isDirectory() ? fs.readdirSync(source).filter(n => !n.includes('.') && fs.statSync(path.join(source, n)).isFile()) : [])]);
  for (const name of names) {
    const target = path.join(local, name);
    if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Refusing symlink hook ${target}`);
    if ((fs.lstatSync(target, { throwIfNoEntry: false })?.nlink ?? 0) > 1) throw new Error(`Refusing hard link hook ${target}`);
    if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(marker)) throw new Error(`Refusing to overwrite unknown hook ${target}`);
    const old = path.join(source, name);
    let script = `#!/bin/sh\n${marker}\nstatus=0\nif [ -x ${quote(old)} ]; then\n  ${quote(old)} "$@" || status=$?\nfi\n`;
    if (name === 'pre-commit') script += 'root=$(git rev-parse --show-toplevel) || exit $?\nif ! command -v node >/dev/null 2>&1; then\n  echo "RML cache cleanup requires Node.js 18.15+; hook not skipped" >&2\n  [ "$status" -ne 0 ] && exit "$status"\n  exit 127\nfi\nnode "$root/scripts/build-cache.mjs"\ncleanup_status=$?\n[ "$status" -ne 0 ] && exit "$status"\nexit "$cleanup_status"\n';
    else script += 'exit "$status"\n';
    fs.writeFileSync(target, script, { mode: 0o755 });
    fs.chmodSync(target, 0o755);
  }
  // Keep another linked worktree's effective hook configuration unchanged.
  // Enabling worktree config is safe for ordinary non-bare clones. An unusual
  // core.worktree/bare setup needs its owner to migrate those settings first.
  let configuredWorktree;
  try { configuredWorktree = git(['config', '--local', '--get', 'core.worktree']); } catch { /* unset */ }
  if (configuredWorktree || git(['rev-parse', '--is-bare-repository']) === 'true') throw new Error('Explicit core.worktree/bare configuration requires manual hook setup');
  git(['config', '--local', 'extensions.worktreeConfig', 'true']);
  git(['config', '--worktree', 'core.hooksPath', local]);
  return { installed: true, path: local, composedWith: source };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = bootstrap();
    console.log(`bootstrap: ${result.installed ? `installed composed hooks at ${result.path}` : result.reason}`);
    if (process.argv.includes('--install')) {
      if (!result.installed) throw new Error('Dependency bootstrap requires a tracked developer checkout');
      const run = spawnSync(process.execPath, [path.join(rootHere, 'scripts', 'run-with-cache.mjs'), '--', 'npm', '--prefix', path.join(rootHere, 'js'), 'ci'], { stdio: 'inherit' });
      process.exitCode = run.status ?? 1;
    }
  } catch (error) { console.error(`bootstrap: ${error.message}`); process.exitCode = 1; }
}
