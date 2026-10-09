// Runs scripts/issue-183-pr-body.mjs exactly as the tests workflow does, but
// against a local stand-in for the GitHub REST API, to show that the guard
// repairs the live PR 184 body instead of the (possibly stale) event body.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const liveBody = 'Newer summary.\r\n\r\nAdvances #183\r\n\r\n\r\n\r\nFixes #184';
const staleEventBody = 'Older summary.\n\nAdvances #183\n\nFixes #184';
const requests = [];
let storedBody = liveBody;

const server = http.createServer((request, response) => {
  let data = '';
  request.on('data', chunk => (data += chunk));
  request.on('end', () => {
    requests.push({ method: request.method, url: request.url });
    if (request.method === 'PATCH') storedBody = JSON.parse(data).body;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ number: 184, body: storedBody }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-183-live-repair-'));
const eventPath = path.join(directory, 'event.json');
const environmentFile = path.join(directory, 'github-env');
fs.writeFileSync(
  eventPath,
  JSON.stringify({
    action: 'synchronize',
    number: 184,
    pull_request: { body: staleEventBody, head: { ref: 'issue-183-7fedfddffe9c' } },
  }),
);

const run = () =>
  new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      ['scripts/issue-183-pr-body.mjs'],
      {
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          GITHUB_ENV: environmentFile,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: 'link-foundation/relative-meta-logic',
          GITHUB_TOKEN: 'local-token',
          RUNNER_TEMP: directory,
        },
      },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr)) : resolve(stdout.trim()),
    ),
  );

const first = await run();
const second = await run();
server.close();

const repairedEvent = JSON.parse(
  fs.readFileSync(path.join(directory, 'issue-183-repaired-event.json'), 'utf8'),
);
console.log(
  JSON.stringify(
    {
      firstRun: first,
      secondRun: second,
      requests,
      storedBody,
      repairedEventBody: repairedEvent.pull_request.body,
      githubEnv: fs.readFileSync(environmentFile, 'utf8').trim().split('\n'),
    },
    null,
    2,
  ),
);
fs.rmSync(directory, { recursive: true, force: true });
