import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml nested cache '));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const name of ['build-cache.mjs', 'docker-cache-budget.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'run-with-cache.mjs', 'cargo.mjs', 'bootstrap.mjs', 'initialize-meta-language.mjs']) fs.copyFileSync(path.join(source, name), path.join(root, 'scripts', name));
  fs.mkdirSync(path.join(root, 'js'));
  fs.mkdirSync(path.join(root, 'rust'));
  fs.writeFileSync(path.join(root, 'js/package.json'), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(root, 'rust/Cargo.toml'), '[package]\nname="fixture"\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.rml-cache/\ntarget/\n');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', 'Cache fixture'); git('config', 'user.email', 'cache@example.invalid'); git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (args, extra = {}) => spawnSync(node, args, { cwd: root, env: { ...process.env, RML_CACHE_MIN_FREE_BYTES: '0', RML_CACHE_LOCK_TIMEOUT_MS: '1000', ...extra }, encoding: 'utf8', timeout: 30000 });
  const wrap = (command, flags = [], extra = {}) => run(['scripts/run-with-cache.mjs', ...flags, '--', ...command], extra);
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const evidence = () => fs.readdirSync(path.join(root, '.rml-cache/evidence')).filter(name => name.endsWith('.json')).map(name => ({ id: name.slice(0, -5), ...JSON.parse(read(`.rml-cache/evidence/${name}`)) }));
  return { root, run, wrap, read, evidence };
}
function ok(result) { assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`); }
const nested = (command, flags = []) => [node, 'scripts/run-with-cache.mjs', ...flags, '--', ...command];

test('direct nested wrapper composes registration, retention, isolation, placeholders and archive before outer cleanup', t => {
  const f = fixture(t);
  const program = `const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
    const output=process.env.RML_CACHE_OUTPUT_DIR;
    assert.notEqual(output,process.env.TMPDIR);
    assert.equal(process.env.CARGO_TARGET_DIR,output);
    assert.deepEqual(process.argv.slice(1),['--target-dir='+output,output+'/argument']);
    fs.writeFileSync(path.join(output,'native.bin'),'native output');
    require('./scripts/build-cache.mjs').writeProducedFile('custom-cache/publish.bin','published output');
    fs.writeFileSync('nested-result.json',JSON.stringify({output,tmp:process.env.TMPDIR}));
    console.log('nested evidence log');`;
  ok(f.wrap(nested([node, '-e', program, '--', '--target-dir={output}', '{output}/argument'], ['--cache', 'custom-cache', '--class', 'compiler', '--retain', 'custom-cache', '--isolate-output', '.rml-cache/parser', '--archive', '.rml-cache/parser'])));
  const observation = JSON.parse(f.read('nested-result.json'));
  assert.equal(fs.existsSync(path.join(observation.output, 'native.bin')), false, 'outer cleanup owns the disposable nested output');
  assert.equal(f.read('custom-cache/publish.bin'), 'published output');
  const registry = JSON.parse(f.read('.git/rml-cache/registry.json'));
  assert.equal(registry.files['custom-cache/publish.bin'].class, 'compiler');
  assert.deepEqual(registry.retained, ['custom-cache']);
  const receipt = f.evidence().find(item => item.nested);
  assert.ok(receipt);
  assert.equal(receipt.isolatedOutput, path.relative(f.root, observation.output));
  assert.equal(f.read(path.join('.rml-cache/evidence', receipt.id, receipt.isolatedOutput, 'native.bin')), 'native output');
  const logs = fs.readdirSync(path.join(f.root, '.rml-cache/evidence')).filter(name => name.endsWith('.log')).map(name => f.read(`.rml-cache/evidence/${name}`)).join('');
  assert.match(logs, /nested evidence log/);
  ok(f.run(['scripts/build-cache.mjs', '--full']));
  assert.equal(fs.existsSync(path.join(f.root, 'custom-cache/publish.bin')), false);
});

test('nested wrapper without isolation inherits output and temporary directories without cleaning its caller', t => {
  const f = fixture(t);
  const inner = `const fs=require('node:fs'),path=require('node:path');
    fs.writeFileSync(path.join(process.env.RML_CACHE_OUTPUT_DIR,'inner.bin'),'inner');
    fs.writeFileSync('inner-environment.json',JSON.stringify({output:process.env.RML_CACHE_OUTPUT_DIR,tmp:process.env.TMPDIR}));`;
  const outer = `const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
    cp.execFileSync(process.execPath,${JSON.stringify(nested([node, '-e', inner]).slice(1))},{stdio:'inherit'});
    assert.equal(fs.readFileSync(path.join(process.env.RML_CACHE_OUTPUT_DIR,'inner.bin'),'utf8'),'inner');
    assert.deepEqual(JSON.parse(fs.readFileSync('inner-environment.json')),{output:process.env.RML_CACHE_OUTPUT_DIR,tmp:process.env.TMPDIR});`;
  ok(f.wrap([node, '-e', outer], ['--isolate-output', '.rml-cache/parser']));
  const { output } = JSON.parse(f.read('inner-environment.json'));
  assert.equal(fs.existsSync(path.join(output, 'inner.bin')), false);
});

test('cargo entry point nested in an outer operation owns and reuses isolated compiler output', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'bin'));
  fs.writeFileSync(path.join(f.root, 'bin/cargo'), `#!/usr/bin/env node
    const fs=require('node:fs'),path=require('node:path');
    const target=process.env.CARGO_TARGET_DIR;
    if(target!==process.env.RML_CACHE_OUTPUT_DIR||!target.includes('/rust/target/.rml-producer-'))process.exit(81);
    const output=path.join(target,'dependency.bin');
    const reused=fs.existsSync(output);
    if(!reused)fs.writeFileSync(output,'compiled dependency fixture');
    fs.writeFileSync('cargo-result.json',JSON.stringify({target,reused,args:process.argv.slice(2)}));
  `, { mode: 0o755 });
  const env = { PATH: `${path.join(f.root, 'bin')}${path.delimiter}${process.env.PATH}` };
  ok(f.wrap([node, 'scripts/cargo.mjs', 'build'], [], env));
  const first = JSON.parse(f.read('cargo-result.json'));
  assert.equal(first.reused, false);
  assert.deepEqual(first.args, ['build']);
  ok(f.wrap([node, 'scripts/cargo.mjs', 'build'], [], env));
  const second = JSON.parse(f.read('cargo-result.json'));
  assert.equal(second.reused, true);
  assert.notEqual(second.target, first.target);
  assert.notEqual(fs.statSync(path.join(first.target, 'dependency.bin')).ino, fs.statSync(path.join(second.target, 'dependency.bin')).ino);
  ok(f.run(['scripts/build-cache.mjs', '--full']));
  assert.equal(fs.existsSync(path.join(first.target, 'dependency.bin')), false);
  assert.equal(fs.existsSync(path.join(second.target, 'dependency.bin')), false);
});

test('concurrent nested wrappers merge independent roots and retention without registry writes or premature cleanup', t => {
  const f = fixture(t);
  const program = `const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
    const registry=fs.readFileSync('.git/rml-cache/registry.json','utf8');
    const jobs=[0,1,2,3].map(index=>{
      const root='sibling-cache-'+index;
      const childProgram="const fs=require('node:fs'),path=require('node:path');"+
        "require('./scripts/build-cache.mjs').writeProducedFile("+JSON.stringify(root+'/receipted.bin')+",'receipted output');"+
        "fs.writeFileSync(path.join(process.env.RML_CACHE_OUTPUT_DIR,'native.bin'),'native output');"+
        "fs.writeFileSync("+JSON.stringify('ready-'+index)+",process.env.RML_CACHE_OUTPUT_DIR);"+
        "const poll=setInterval(()=>{if(fs.existsSync('release-siblings')){clearInterval(poll);process.exit(0)}},10);";
      const child=cp.spawn(process.execPath,['scripts/run-with-cache.mjs','--cache',root,'--class','compiler','--retain',root,'--isolate-output',root,'--',process.execPath,'-e',childProgram],{stdio:'inherit'});
      return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('nested status '+code)))});
    });
    const poll=setInterval(()=>{
      if(![0,1,2,3].every(index=>fs.existsSync('ready-'+index)))return;
      clearInterval(poll);
      assert.equal(fs.readFileSync('.git/rml-cache/registry.json','utf8'),registry);
      fs.writeFileSync('release-siblings','yes');
    },10);
    Promise.all(jobs).then(()=>{for(const index of [0,1,2,3])assert.equal(fs.readFileSync(path.join(fs.readFileSync('ready-'+index,'utf8'),'native.bin'),'utf8'),'native output')}).catch(error=>{console.error(error);process.exitCode=1});`;
  ok(f.wrap([node, '-e', program]));
  const registry = JSON.parse(f.read('.git/rml-cache/registry.json'));
  for (const index of [0, 1, 2, 3]) {
    const root = `sibling-cache-${index}`;
    const output = f.read(`ready-${index}`);
    assert.equal(registry.roots.find(item => item.path === root).class, 'compiler');
    assert.ok(registry.retained.includes(root));
    assert.equal(registry.files[`${root}/receipted.bin`].proof, 'producer-v2');
    assert.equal(registry.files[path.relative(f.root, path.join(output, 'native.bin')).split(path.sep).join('/')].proof, 'producer-v2');
  }
  assert.equal(f.evidence().filter(item => item.nested).length, 4);
  ok(f.run(['scripts/build-cache.mjs', '--full']));
  for (const index of [0, 1, 2, 3]) assert.equal(fs.existsSync(path.join(f.root, `sibling-cache-${index}/receipted.bin`)), false);
});

for (const status of [0, 43]) {
  test(`nested archive failure preserves command status ${status} and defers outer cleanup`, t => {
    const f = fixture(t);
    const program = `require('./scripts/build-cache.mjs').writeProducedFile('.rml-cache/scratch/diagnostics','valuable failure evidence');process.exit(${status});`;
    const result = f.wrap(nested([node, '-e', program], ['--archive', '../unsafe']));
    assert.equal(result.status, status || 2, result.stderr);
    assert.match(result.stderr, /evidence archive failed; cache retained/);
    assert.equal(f.read('.rml-cache/scratch/diagnostics'), 'valuable failure evidence');
    ok(f.run(['scripts/build-cache.mjs', '--full']));
    assert.equal(fs.existsSync(path.join(f.root, '.rml-cache/scratch/diagnostics')), false);
  });
}

test('nested missing command preserves status 127 in its evidence and outer status', t => {
  const f = fixture(t);
  const result = f.wrap(nested(['no-such-nested-cache-command']));
  assert.equal(result.status, 127, result.stderr);
  assert.equal(f.evidence().find(item => item.nested).exitCode, 127);
});

for (const status of [0, 39]) {
  test(`nested source migration validates success and preserves command failure ${status}`, t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, 'scripts/check-linked-implementation.mjs'), `import fs from 'node:fs';import path from 'node:path';export function checkCurrentLinkedImplementation(root){if(fs.existsSync(path.join(root,'inconsistent-source')))throw new Error('inconsistent linked source fixture')}`);
    const result = f.wrap(nested([node, '-e', `require('node:fs').writeFileSync('inconsistent-source','yes');process.exit(${status})`], ['--source-migration']));
    assert.equal(result.status, status || 2, result.stderr);
    const receipt = f.evidence().find(item => item.nested);
    assert.equal(receipt.sourceMigration, true);
    assert.equal(receipt.commandExitCode, status);
    assert.equal(receipt.sourceValidationPassed, false);
    if (!status) assert.match(result.stderr, /inconsistent linked source fixture/);
  });
}

test('nested registration validates source paths before the command starts', t => {
  const f = fixture(t);
  const result = f.wrap(nested([node, '-e', "require('node:fs').writeFileSync('must-not-start','yes')"], ['--cache', 'scripts']));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Source directory cannot become a cache/);
  assert.equal(fs.existsSync(path.join(f.root, 'must-not-start')), false);
});

for (const nestedRun of [false, true]) {
  for (const status of [0, 29]) test(`private report archive resolves ${nestedRun ? 'nested' : 'outer'} output before cleanup and preserves status ${status}`, t => {
    const f = fixture(t);
    const program = `const fs=require('node:fs'),path=require('node:path');
      const output=process.env.RML_CACHE_OUTPUT_DIR;
      fs.mkdirSync(path.join(output,'oracle/report'),{recursive:true});
      fs.writeFileSync(path.join(output,'oracle/report/receipt.json'),JSON.stringify({status:${status}}));
      fs.writeFileSync(path.join(output,'unarchived.bin'),'compiler intermediate');
      fs.writeFileSync('archive-output.json',JSON.stringify({ output }));
      process.exitCode=${status};`;
    const flags = ['--isolate-output', '.rml-cache/compiler', '--archive', '{output}/oracle/report'];
    const command = [node, '-e', program];
    const result = nestedRun ? f.wrap(nested(command, flags)) : f.wrap(command, flags);
    assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
    const { output } = JSON.parse(f.read('archive-output.json'));
    const receipt = f.evidence().find(item => !!item.nested === nestedRun && item.isolatedOutput);
    assert.ok(receipt);
    const archived = path.join('.rml-cache/evidence', receipt.id, receipt.isolatedOutput);
    assert.deepEqual(JSON.parse(f.read(path.join(archived, 'oracle/report/receipt.json'))), { status });
    assert.equal(fs.existsSync(path.join(f.root, archived, 'unarchived.bin')), false);
    assert.equal(fs.existsSync(path.join(output, 'oracle/report/receipt.json')), false);
    assert.equal(fs.existsSync(path.join(output, 'unarchived.bin')), false);
  });
}

for (const requested of ['{output}/../outside', '{output}/report/../../outside', '/tmp/outside', 'prefix/{output}/report']) {
  test(`archive placeholder retains existing path rejection for ${requested}`, t => {
    const f = fixture(t);
    const result = f.wrap([node, '-e', `require('node:fs').writeFileSync(require('node:path').join(process.env.RML_CACHE_OUTPUT_DIR,'retained.bin'),'owned output');`], ['--isolate-output', '.rml-cache/compiler', '--archive', requested]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Unsafe cache path|placeholder must start/);
    const receipt = f.evidence().find(item => item.isolatedOutput);
    assert.equal(f.read(path.join(receipt.isolatedOutput, 'retained.bin')), 'owned output', 'failed evidence archive retains generated outputs');
  });
}

test('archive placeholder rejects a report symlink and retains evidence without following it', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'user-data'));
  fs.writeFileSync(path.join(f.root, 'user-data/private.txt'), 'private user bytes');
  const result = f.wrap([node, '-e', `const fs=require('node:fs'),path=require('node:path');fs.symlinkSync(path.resolve('user-data'),path.join(process.env.RML_CACHE_OUTPUT_DIR,'report'),'dir');`], ['--isolate-output', '.rml-cache/compiler', '--archive', '{output}/report']);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Symlink cache path is protected/);
  assert.equal(f.read('user-data/private.txt'), 'private user bytes');
  const receipt = f.evidence().find(item => item.isolatedOutput);
  assert.equal(fs.existsSync(path.join(f.root, '.rml-cache/evidence', receipt.id)), false);
});

function acceptanceParityFixture(t) {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'scripts/acceptance'));
  fs.copyFileSync(path.join(source, 'acceptance/issue-183-parity.test.mjs'), path.join(f.root, 'scripts/acceptance/issue-183-parity.test.mjs'));
  fs.mkdirSync(path.join(f.root, 'test-corpus'));
  fs.writeFileSync(path.join(f.root, 'test-corpus/probe.lino'), '(probe)\n');
  fs.mkdirSync(path.join(f.root, 'bin'));
  // These tools test routing only; they do not count as native parity evidence.
  fs.writeFileSync(path.join(f.root, 'bin/cargo'), `#!/usr/bin/env node
    const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2);
    const target=a[a.indexOf('--target-dir')+1];
    fs.writeFileSync('cargo-routing.json',JSON.stringify({target,environment:process.env.CARGO_TARGET_DIR,args:a}));
    fs.mkdirSync(path.join(target,'debug'),{recursive:true});
    fs.writeFileSync(path.join(target,'debug/rml'),'mock routing artifact');
  `, { mode: 0o755 });
  fs.writeFileSync(path.join(f.root, 'scripts/check-corpus-parity.mjs'), `import fs from 'node:fs';import assert from 'node:assert/strict';
    const a=process.argv.slice(2),binary=a[a.indexOf('--rust-bin')+1];
    assert.equal(fs.readFileSync(binary,'utf8'),'mock routing artifact');
    fs.appendFileSync('consumed-binary.txt',binary+'\\n');
    if(a.includes('--js-cli')){console.error('stdout differs: injected-parity-drift');process.exitCode=1}
    else console.log('Corpus parity passed for 1 file(s).');
  `);
  const env = { PATH: `${path.join(f.root, 'bin')}${path.delimiter}${process.env.PATH}`, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: undefined, NODE_UNIQUE_ID: undefined };
  return { ...f, env };
}

test('acceptance parity builds and consumes the same active private Cargo target while shared output stays protected', { skip: process.platform === 'win32' }, t => {
  const f = acceptanceParityFixture(t);
  fs.mkdirSync(path.join(f.root, 'rust/target'));
  fs.writeFileSync(path.join(f.root, 'rust/target/user-note'), 'protected shared output');
  ok(f.wrap([node, '--test', 'scripts/acceptance/issue-183-parity.test.mjs'], ['--isolate-output', 'rust/target'], f.env));
  const routing = JSON.parse(f.read('cargo-routing.json'));
  assert.equal(routing.target, routing.environment);
  assert.ok(routing.target.startsWith(path.join(f.root, 'rust/target/.rml-producer-')));
  const consumed = f.read('consumed-binary.txt').trim().split('\n');
  assert.deepEqual(consumed, [path.join(routing.target, 'debug/rml'), path.join(routing.target, 'debug/rml')]);
  assert.equal(f.read('rust/target/user-note'), 'protected shared output');
  ok(f.run(['scripts/build-cache.mjs', '--full']));
  assert.equal(fs.existsSync(path.join(routing.target, 'debug/rml')), false);
  assert.equal(f.read('rust/target/user-note'), 'protected shared output');
});

for (const variant of ['missing', 'stale']) test(`acceptance parity rejects a ${variant} private target before invoking Cargo`, { skip: process.platform === 'win32' }, t => {
  const f = acceptanceParityFixture(t);
  let command = [node, '--test', 'scripts/acceptance/issue-183-parity.test.mjs'];
  let flags = [];
  const env = { ...f.env, CARGO_TARGET_DIR: '' };
  if (variant === 'stale') {
    const stale = path.join(f.root, 'rust/target/.rml-producer-stale');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'user-note'), 'previous target user data');
    command = [node, '-e', `const cp=require('node:child_process');process.env.CARGO_TARGET_DIR=${JSON.stringify(stale)};const r=cp.spawnSync(process.execPath,['--test','scripts/acceptance/issue-183-parity.test.mjs'],{stdio:'inherit'});process.exitCode=r.status;`];
    flags = ['--isolate-output', 'rust/target'];
  }
  const result = f.wrap(command, flags, env);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Acceptance parity requires/);
  assert.equal(fs.existsSync(path.join(f.root, 'cargo-routing.json')), false);
  if (variant === 'stale') assert.equal(f.read('rust/target/.rml-producer-stale/user-note'), 'previous target user data');
});

test('acceptance Cargo producers inherit one private target for the complete outer operation', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  fs.copyFileSync(path.join(source, 'issue-183-requirements.mjs'), path.join(f.root, 'scripts/issue-183-requirements.mjs'));
  fs.mkdirSync(path.join(f.root, 'rust/tests'));
  fs.writeFileSync(path.join(f.root, 'rust/tests/routing.rs'), '// Independent routing fixture: positive and negative controls.\n');
  fs.writeFileSync(path.join(f.root, 'rust/Cargo.lock'), 'fixture lock\n');
  fs.writeFileSync(path.join(f.root, 'implementation.rs'), '// Routing implementation input\n');
  fs.mkdirSync(path.join(f.root, 'bin'));
  fs.writeFileSync(path.join(f.root, 'bin/cargo'), `#!/usr/bin/env node
    const fs=require('node:fs'),path=require('node:path');
    if(process.argv[2]==='--version'){console.log('cargo routing mock');process.exit(0)}
    const target=process.env.CARGO_TARGET_DIR;
    if(!target||!path.isAbsolute(target))process.exit(91);
    fs.appendFileSync('cargo-targets.jsonl',JSON.stringify({target,args:process.argv.slice(2)})+'\\n');
    fs.writeFileSync(path.join(target,'test-artifact'),'mock native output');
    console.log('running 2 tests\\ntest positive ... ok\\ntest negative ... ok\\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s');
  `, { mode: 0o755 });
  fs.writeFileSync(path.join(f.root, 'bin/rustc'), '#!/usr/bin/env node\nconsole.log("rustc routing mock");\n', { mode: 0o755 });
  const program = `const fs=require('node:fs'),assert=require('node:assert/strict');
    const {executeIssue183Check,sha256}=require('./scripts/issue-183-requirements.mjs');
    const pin=(name,role)=>({path:name,role,sha256:sha256(fs.readFileSync(name))});
    const check={id:'routing',kind:'cargo-test',testTarget:'routing',testFiles:['rust/tests/routing.rs'],files:[pin('rust/Cargo.toml','configuration'),pin('rust/Cargo.lock','configuration'),pin('implementation.rs','implementation'),pin('rust/tests/routing.rs','test-and-fixture')],assertions:[{file:'rust/tests/routing.rs',name:'positive',polarity:'positive'},{file:'rust/tests/routing.rs',name:'negative',polarity:'negative'}]};
    for(let i=0;i<2;i++){const result=executeIssue183Check(process.cwd(),check);assert.equal(result.passed,true,result.error);assert.equal(result.assertions.length,2);}
  `;
  ok(f.wrap([node, '-e', program], ['--isolate-output', 'rust/target'], { PATH: `${path.join(f.root, 'bin')}${path.delimiter}${process.env.PATH}` }));
  const calls = f.read('cargo-targets.jsonl').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].target, calls[1].target);
  assert.ok(calls[0].target.startsWith(path.join(f.root, 'rust/target/.rml-producer-')));
  assert.ok(calls.every(call => call.args.includes('test') && !call.args.includes('--target-dir')));
});
