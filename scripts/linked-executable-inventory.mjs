/** Repository-wide discovery, with explicit source, evidence and provider roles.
 * New maintained code is discovered by language/entrypoint, never by a small
 * allowlist of application directories. Unsupported executables fail closed. */
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';

const javascript = /\.(?:mjs|cjs|js)$/;
const rust = /\.rs$/;
const unsupportedCode = /\.(?:ts|tsx|jsx|py|rb|php|lua|wasm|node|so|dll|exe|sh|bash|ps1)$/;
const genericProviders = new Set(['.githooks/pre-commit', 'docker/ci-build.sh', 'docker/run-owned.sh', 'docker/Dockerfile.js', 'docker/Dockerfile.rust', 'scripts/build-cache-windows.ps1', 'scripts/install-rocq-kernel.sh']);
const genericVendor = 'scripts/linked-runtime-rust/vendor';
const genericConfiguration = new Set(['docs/api/jsdoc.json', 'scripts/lint-english.allowlist.json', 'docker/buildkitd.toml', 'docker/docker-compose.yml']);
const under = (path, directory) => path === directory || path.startsWith(`${directory}/`);
const evidence = path => under(path, 'test-corpus') || under(path, 'docs/case-studies') || path.split('/').some(p => ['test', 'tests', 'benches'].includes(p)) || /(?:\.test|_tests?)\.[^.]+$/.test(path);

export function safeImplementationPath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !/[\\:\u0000-\u001f]/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export function isJavaScriptImplementationPath(path) { return safeImplementationPath(path) && javascript.test(path); }
export function isRustImplementationPath(path) { return safeImplementationPath(path) && rust.test(path); }
export function isGenericExecutableProvider(path) { return genericProviders.has(path) || under(path, genericVendor); }
export function javaScriptSourceType(path, root) {
  if (path.endsWith('.mjs')) return 'module';
  if (path.endsWith('.cjs')) return 'commonjs';
  let directory = posix.dirname(path);
  for (;;) {
    const packageFile = resolve(root, directory, 'package.json');
    if (existsSync(packageFile)) {
      const type = JSON.parse(readFileSync(packageFile, 'utf8')).type;
      if (type !== undefined && !['module', 'commonjs'].includes(type)) throw new TypeError(`unsupported JavaScript package type: ${directory}`);
      return type === 'module' ? 'module' : 'commonjs';
    }
    if (directory === '.') return 'commonjs';
    directory = posix.dirname(directory);
  }
}

export function assertJavaScriptDependencyClosure(modules, root) {
  const roles = discoverExecutableInventory(root, { entrypointLanguages: ['javascript'] }), represented = new Set(Object.keys(modules));
  const dependencies = [], dynamicImports = [];
  for (const [from, tree] of Object.entries(modules)) {
    if (tree.type === 'File' && tree.program.sourceType !== (javaScriptSourceType(from, root) === 'module' ? 'module' : 'script')) throw new TypeError(`linked syntax mode differs from package loader: ${from}`);
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      let reference;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(value.type)) reference = value.source;
      else if (value.type === 'CallExpression' && value.callee?.type === 'Identifier' && value.callee.name === 'require') reference = value.arguments[0];
      if (reference) {
        if (reference.type !== 'StringLiteral') dynamicImports.push({ from, expression: value.type });
        else if (reference.value.startsWith('.')) {
          const target = posix.normalize(posix.join(posix.dirname(from), reference.value));
          if (!safeImplementationPath(target)) throw new TypeError(`escaping implementation import: ${from} -> ${reference.value}`);
          const resolved = [target, `${target}.js`, `${target}.mjs`, `${target}.cjs`, `${target}/index.js`, `${target}/index.mjs`].find(path => roles.files.includes(path));
          if (!resolved || (!represented.has(resolved) && !roles.configuration.includes(resolved))) throw new TypeError(`implementation imports unrepresented owned code/data: ${from} -> ${reference.value}`);
          dependencies.push({ from, target: resolved });
        } else dependencies.push({ from, provider: reference.value });
      }
      for (const child of Object.values(value)) visit(child);
    }
    visit(tree);
  }
  return { dependencies, dynamicImports };
}

/** These are generated/external boundaries, not unexamined runtime source roots. */
function boundaries(root) {
  const generated = ['.rml-cache'];
  const policyPath = resolve(root, 'scripts/cache-policy.json');
  if (existsSync(policyPath)) {
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
    for (const item of policy.roots ?? []) { if (!safeImplementationPath(item.path)) throw new TypeError('unsafe generated cache boundary'); generated.push(item.path); }
  }
  const external = [];
  const submodules = resolve(root, '.gitmodules');
  if (existsSync(submodules)) for (const match of readFileSync(submodules, 'utf8').matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) {
    if (!safeImplementationPath(match[1])) throw new TypeError('unsafe external submodule boundary'); external.push(match[1]);
  }
  const checkouts = [];
  const checkoutPolicy = resolve(root, 'scripts/external-checkouts.json');
  if (existsSync(checkoutPolicy)) {
    const policy = JSON.parse(readFileSync(checkoutPolicy, 'utf8'));
    if (policy.schema !== 'rml-external-checkouts/v1' || !Array.isArray(policy.checkouts)) throw new TypeError('invalid external checkout policy');
    for (const item of policy.checkouts) {
      if (!safeImplementationPath(item.path) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repository ?? '') || !/^[0-9a-f]{40}$/.test(item.revision ?? '')) throw new TypeError('unsafe or unpinned external checkout boundary');
      if ([...external, ...checkouts].some(path => under(item.path, path) || under(path, item.path))) throw new TypeError('overlapping external checkout boundary');
      checkouts.push(item.path);
    }
  }
  return { generated, external, checkouts };
}

export function discoverExecutableInventory(root, { entrypointLanguages = ['javascript', 'rust'] } = {}) {
  const boundary = boundaries(root), files = [], excluded = [];
  function visit(directory = '') {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (!safeImplementationPath(path)) throw new TypeError(`unsafe repository path: ${path}`);
      if (entry.name === '.git') { excluded.push({ path, role: 'git-metadata' }); continue; }
      if (entry.name === 'node_modules') { excluded.push({ path, role: 'external-installed-packages' }); continue; }
      if (boundary.external.some(p => under(path, p))) { excluded.push({ path, role: 'declared-external-submodule' }); continue; }
      if (boundary.checkouts.some(p => under(path, p))) { excluded.push({ path, role: 'declared-external-checkout' }); continue; }
      if (boundary.generated.some(p => under(path, p)) || (entry.name === 'target' && existsSync(resolve(root, directory, 'Cargo.toml')))) { excluded.push({ path, role: 'registered-generated-output' }); continue; }
      if (entry.isSymbolicLink() && evidence(path)) { excluded.push({ path, role: 'external-evidence-input' }); continue; }
      if (entry.isSymbolicLink()) throw new TypeError(`owned executable discovery refuses symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  visit();
  const result = { javascript: [], rust: [], providers: [], configuration: [], evidence: [], entrypoints: [], boundaries: excluded, files };
  for (const path of files) {
    const name = posix.basename(path);
    if (under(path, genericVendor)) { result.providers.push(path); continue; }
    // A Rust module under src/ can participate in an ordinary crate even when
    // its filename ends in _tests. Include it structurally; its cfg attributes
    // decide whether a particular build executes it. A filename is not proof
    // that source can be omitted from the generated crate.
    if (evidence(path) && !(rust.test(path) && path.split('/').includes('src'))) { if (javascript.test(path) || rust.test(path) || unsupportedCode.test(path)) result.evidence.push(path); continue; }
    if (genericProviders.has(path)) { result.providers.push(path); continue; }
    if (javascript.test(path)) result.javascript.push(path);
    else if (rust.test(path)) result.rust.push(path);
    else if (unsupportedCode.test(path) || /^#!/.test(readPrefix(root, path)) || (lstatSync(resolve(root, path)).mode & 0o111)) throw new TypeError(`unclassified maintained executable requires an explicit source/provider implementation: ${path}`);
    if (/^(?:package(?:-lock)?\.json|Cargo\.(?:toml|lock)|\.npmignore|\.vscodeignore)$/.test(name) || /\.(?:html?|css)$/.test(path) || genericConfiguration.has(path)) result.configuration.push(path);
  }
  const owned = new Set([...result.javascript, ...result.rust]);
  const local = (from, reference) => {
    if (typeof reference !== 'string' || /[\\%?#\u0000-\u001f]/.test(reference) || reference.startsWith('/') || /^[A-Za-z][\w+.-]*:/.test(reference)) throw new TypeError(`unsafe public entrypoint in ${from}: ${reference}`);
    const target = posix.normalize(posix.join(posix.dirname(from), reference));
    if (!safeImplementationPath(target)) throw new TypeError(`escaping public entrypoint in ${from}: ${reference}`);
    return target;
  };
  function entry(from, role, reference) {
    const target = local(from, reference);
    if (target.includes('*')) {
      const pattern = new RegExp(`^${target.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      const matches = result.files.filter(p => pattern.test(p));
      if (!matches.length) throw new TypeError(`public entrypoint matches no owned code: ${from} ${reference}`);
      for (const path of matches) entry(from, role, posix.relative(posix.dirname(from), path));
      return;
    }
    if (!owned.has(target)) throw new TypeError(`public entrypoint is not represented by structured owned code: ${from} -> ${target}`);
    result.entrypoints.push({ from, role, target });
  }
  function values(value, callback) {
    if (typeof value === 'string') callback(value);
    else if (Array.isArray(value)) value.forEach(v => values(v, callback));
    else if (value && typeof value === 'object') Object.values(value).forEach(v => values(v, callback));
    else if (value !== null && value !== false && value !== undefined) throw new TypeError('invalid package entrypoint declaration');
  }
  for (const path of result.configuration.filter(p => posix.basename(p) === 'package.json')) {
    const pkg = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    if (entrypointLanguages.includes('javascript')) for (const role of ['main', 'module', 'bin', 'exports', 'browser']) values(pkg[role], target => entry(path, `npm-${role}`, target));
    // Editor declarative providers affect the active language/server and belong
    // to the emitted configuration inventory along with the package manifest.
    for (const language of pkg.contributes?.languages ?? []) if (language.configuration) addData(path, language.configuration);
    for (const grammar of pkg.contributes?.grammars ?? []) if (grammar.path) addData(path, grammar.path);
  }
  for (const path of result.configuration.filter(p => entrypointLanguages.includes('rust') && posix.basename(p) === 'Cargo.toml')) {
    const folder = posix.dirname(path);
    for (const suffix of ['src/lib.rs', 'src/main.rs', 'build.rs']) if (files.includes(posix.join(folder, suffix))) entry(path, 'cargo-default-target', suffix);
    for (const target of result.rust.filter(p => under(p, `${folder}/src/bin`) || under(p, `${folder}/examples`))) entry(path, 'cargo-auto-target', posix.relative(folder, target));
    let section = '';
    for (const line of readFileSync(resolve(root, path), 'utf8').split(/\r?\n/)) {
      const header = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/); if (header) { section = header[1]; continue; }
      const field = line.match(/^\s*(path|build)\s*=\s*(.+?)\s*(?:#.*)?$/);
      if (!field || !((['lib', 'bin', 'example'].includes(section) && field[1] === 'path') || (section === 'package' && field[1] === 'build'))) continue;
      if (field[2] === 'false' || field[2] === 'true') continue;
      const quoted = field[2].match(/^(?:"([^"\\]*)"|'([^']*)')$/);
      if (!quoted) throw new TypeError(`unsupported Cargo entrypoint syntax requires explicit decoding: ${path}`);
      entry(path, `cargo-${section}`, quoted[1] ?? quoted[2]);
    }
  }
  function addData(from, reference) {
    const target = local(from, reference);
    if (!files.includes(target) || evidence(target) || owned.has(target)) throw new TypeError(`invalid package/browser data provider: ${from} -> ${target}`);
    result.configuration.push(target);
  }
  for (const path of result.configuration.filter(p => /\.html?$/.test(p))) {
    const text = readFileSync(resolve(root, path), 'utf8');
    if (/\son\w+\s*=/i.test(text)) throw new TypeError(`inline browser event code requires structured extraction: ${path}`);
    for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const src = match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
      if (src && entrypointLanguages.includes('javascript')) entry(path, 'browser-script', src);
      else if (match[2].trim() && type !== 'application/json') throw new TypeError(`inline browser code requires structured extraction: ${path}`);
    }
    for (const match of text.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) if (!/^(?:data:|https?:|#)/.test(match[1])) addData(path, match[1]);
  }
  for (const key of ['javascript', 'rust', 'providers', 'configuration', 'evidence']) result[key] = [...new Set(result[key])].sort();
  result.entrypoints.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
}

function readPrefix(root, path) {
  // Only files whose names do not already establish a source/provider role need
  // shebang detection. Reading a bounded header avoids loading binary assets.
  const fd = openSync(resolve(root, path), 'r');
  try { const bytes = Buffer.alloc(128); const count = readSync(fd, bytes, 0, bytes.length, 0); return bytes.subarray(0, count).toString('utf8'); }
  finally { closeSync(fd); }
}
