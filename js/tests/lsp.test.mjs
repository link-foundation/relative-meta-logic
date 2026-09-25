// Smoke tests for the stdio Language Server Protocol implementation
// (issue #78). The test drives the server through real LSP framing so it
// catches protocol regressions, not just helper-level behavior.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SERVER = path.resolve('src/rml-lsp.mjs');

class LspClient {
  constructor() {
    this.child = spawn(process.execPath, [SERVER], {
      cwd: path.resolve('.'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.buffer = Buffer.alloc(0);
    this.stderr = '';

    this.child.stdout.on('data', chunk => this._onData(chunk));
    this.child.stderr.on('data', chunk => { this.stderr += String(chunk); });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString('ascii');
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      assert.ok(lengthMatch, `missing Content-Length in ${header}`);
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.slice(bodyEnd);
      this._onMessage(JSON.parse(body));
    }
  }

  _onMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        pending.resolve(message);
        return;
      }
    }
    this.notifications.push(message);
  }

  _write(message) {
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }

  request(method, params) {
    const id = this.nextId++;
    this._write({ jsonrpc: '2.0', id, method, params });
    return this._waitForResponse(id);
  }

  notify(method, params) {
    this._write({ jsonrpc: '2.0', method, params });
  }

  _waitForResponse(id) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for response ${id}; stderr: ${this.stderr}`));
      }, 2000);
      this.pending.set(id, {
        resolve: message => {
          clearTimeout(timeout);
          resolve(message);
        },
      });
    });
  }

  waitForNotification(method, predicate = () => true) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const index = this.notifications.findIndex(message =>
          message.method === method && predicate(message.params || {}));
        if (index !== -1) {
          const [message] = this.notifications.splice(index, 1);
          clearInterval(timer);
          resolve(message);
          return;
        }
        if (Date.now() - started > 2000) {
          clearInterval(timer);
          reject(new Error(`timed out waiting for ${method}; stderr: ${this.stderr}`));
        }
      }, 10);
    });
  }

  async close() {
    if (!this.child.killed) {
      this.child.kill();
    }
  }
}

describe('rml-lsp stdio server', () => {
  it('publishes diagnostics and answers hover, definition, and completion', async t => {
    const client = new LspClient();
    t.after(() => client.close());

    const init = await client.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(path.resolve('..')).href,
      capabilities: {},
    });
    assert.ifError(init.error);
    assert.strictEqual(init.result.capabilities.hoverProvider, true);
    assert.strictEqual(init.result.capabilities.definitionProvider, true);
    assert.deepStrictEqual(init.result.capabilities.completionProvider.triggerCharacters, ['(', ' ', ':']);

    client.notify('initialized', {});

    const uri = 'file:///workspace/demo.lino';
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'lino',
        version: 1,
        text: '(=: missing_op identity)\n',
      },
    });
    const bad = await client.waitForNotification('textDocument/publishDiagnostics', p =>
      p.uri === uri && p.diagnostics.length === 1);
    assert.strictEqual(bad.params.diagnostics[0].code, 'E001');
    assert.deepStrictEqual(bad.params.diagnostics[0].range.start, { line: 0, character: 0 });

    client.notify('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{
        text: '(a: a is a)\n((a = a) has probability 1)\n(? (a = a))\n',
      }],
    });
    await client.waitForNotification('textDocument/publishDiagnostics', p =>
      p.uri === uri && p.diagnostics.length === 0);

    const hover = await client.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 0, character: 1 },
    });
    assert.match(hover.result.contents.value, /Definition `a`/);

    const definition = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: 2, character: 4 },
    });
    assert.strictEqual(definition.result.uri, uri);
    assert.deepStrictEqual(definition.result.range.start, { line: 0, character: 1 });

    const completion = await client.request('textDocument/completion', {
      textDocument: { uri },
      position: { line: 2, character: 3 },
    });
    const labels = completion.result.items.map(item => item.label);
    assert.ok(labels.includes('a'), labels);
    assert.ok(labels.includes('probability'), labels);

    const shutdown = await client.request('shutdown', null);
    assert.strictEqual(shutdown.result, null);
    client.notify('exit', null);
  });

  it('places LiNo parse failures and definitions at UTF-16 positions', async t => {
    const client = new LspClient();
    t.after(() => client.close());

    const init = await client.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(path.resolve('..')).href,
      capabilities: {},
    });
    assert.ifError(init.error);
    client.notify('initialized', {});

    // RML spans count code points; LSP counts UTF-16 code units, so the
    // emoji before the stray `)` moves it one character to the right.
    const uri = 'file:///workspace/emoji.lino';
    client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'lino', version: 1, text: '(\u{1F600} a))\n' },
    });
    const bad = await client.waitForNotification('textDocument/publishDiagnostics', p =>
      p.uri === uri && p.diagnostics.length === 1);
    assert.strictEqual(bad.params.diagnostics[0].code, 'E006');
    assert.strictEqual(bad.params.diagnostics[0].message, 'LiNo parse failure: unexpected ")"');
    assert.deepStrictEqual(bad.params.diagnostics[0].range, {
      start: { line: 0, character: 6 },
      end: { line: 0, character: 7 },
    });

    // The front end drops a leading byte order mark before it counts columns.
    client.notify('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{
        text: '\uFEFF(\u{1F600}x: a is a)\n(? (\u{1F600}x = \u{1F600}x))\n',
      }],
    });
    await client.waitForNotification('textDocument/publishDiagnostics', p =>
      p.uri === uri && p.diagnostics.length === 0);
    const definition = await client.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: 1, character: 5 },
    });
    assert.deepStrictEqual(definition.result.range, {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 5 },
    });

    const shutdown = await client.request('shutdown', null);
    assert.strictEqual(shutdown.result, null);
    client.notify('exit', null);
  });
});
