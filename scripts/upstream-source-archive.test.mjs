import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyUpstreamSourceArchive } from './upstream-source-archive.mjs';
import { assertCorpusMatchesUpstream } from './check-meta-theory-corpus.mjs';
import { FormalCorpus } from '../js/src/rml-formal-corpus.mjs';
const archive = fileURLToPath(new URL('../lib/meta-theory/upstream-0.0.3-source/', import.meta.url));
const corpus = () => FormalCorpus.fromRml(fs.readFileSync(new URL('../lib/meta-theory/upstream-0.0.3.lino', import.meta.url), 'utf8'), fs.readFileSync(new URL('../lib/meta-theory/upstream-0.0.3-foundation.lino', import.meta.url), 'utf8'));
function copy(context) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'rml-raw-corpus-'));fs.cpSync(archive,root,{recursive:true});context.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root; }

test('preserves all original formal source bytes configurations and license at the requested Git revision', () => {
 const report=verifyUpstreamSourceArchive();assert.equal(report.files,22);assert.equal(report.formalModules,18);assert.equal(report.projectConfigurations,3);assert.equal(report.revision,'087f4515d0652925eecc54bcade724445c3978f1');assert.ok(report.totalBytes>20000);
});
test('the archived raw source reconstructs exactly the trusted 229-declaration semantic corpus', () => {
 assert.equal(assertCorpusMatchesUpstream(archive,corpus()).length,229);
});
test('detects comment and layout corruption even when the semantic-token fingerprint is unchanged', context => {
 for(const kind of ['comment','layout']) {
  const root=copy(context);const file=path.join(root,'drafts/0.0.3/src/lean/MetaDefinitions.lean');const raw=fs.readFileSync(file,'utf8');
  const changed=kind==='comment'?`${raw}\n-- altered raw-source comment\n`:raw.replace(/\n( +)(?=\S)/,'\n$1 ');assert.notEqual(raw,changed);fs.writeFileSync(file,changed);
  assert.equal(assertCorpusMatchesUpstream(root,corpus()).length,229);
  assert.throws(()=>verifyUpstreamSourceArchive(root),/archived source bytes changed/);
 }
});
test('rejects deleted source and omitted or duplicated manifest entries', context => {
 for(const kind of ['deleted','omitted','duplicated']) {
  const root=copy(context);const file=path.join(root,'manifest.json');const manifest=JSON.parse(fs.readFileSync(file));
  if(kind==='deleted')fs.unlinkSync(path.join(root,manifest.files[1].path));else if(kind==='omitted')manifest.files.pop();else manifest.files.push(manifest.files[0]);
  fs.writeFileSync(file,JSON.stringify(manifest));assert.throws(()=>verifyUpstreamSourceArchive(root),/inventory|source files differ/);
 }
});
test('rejects source replacement by a symlink before reading outside the archive', context => {
 const root=copy(context);const file=path.join(root,'LICENSE');fs.renameSync(file,path.join(root,'saved-license'));fs.symlinkSync('saved-license',file);assert.throws(()=>verifyUpstreamSourceArchive(root),/symbolic-link/);
});
