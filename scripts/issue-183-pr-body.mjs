import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// GitHub's closing-keyword grammar: the keyword may appear anywhere, may be
// followed by a colon, and may name the issue as #N, owner/repo#N, or its URL.
const CLOSING_DIRECTIVE_SOURCE = String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?:\s+|\s*:\s*)(?:#|[\w.-]+/[\w.-]+#|https://github\.com/[^/\s]+/[^/\s]+/issues/)(?:183|184)\b`;

export const ISSUE_183_CLOSING_DIRECTIVE = new RegExp(
  CLOSING_DIRECTIVE_SOURCE,
  'i',
);
const CLOSING_DIRECTIVE_LINE = new RegExp(
  String.raw`^\s*${CLOSING_DIRECTIVE_SOURCE}\.?\s*$`,
  'i',
);

const ISSUE_183_PR_NUMBER = 184;
const ISSUE_183_BRANCH = 'issue-183-7fedfddffe9c';
const REPAIRED_EVENT_ENVIRONMENT = 'ISSUE_183_REPAIRED_EVENT_PATH';

export function removeIssue183ClosingDirectives(body, reviewedBody) {
  // The solver can append a Markdown divider along with its closing line.
  // Restore the exact reviewed bytes when the entire addition is that footer.
  if (reviewedBody && body.startsWith(reviewedBody)) {
    const suffix = body.slice(reviewedBody.length);
    const lines = suffix.split(/\r?\n/);
    if (lines[0] === '' &&
      lines.some(line => CLOSING_DIRECTIVE_LINE.test(line)) &&
      lines.every(line => line.trim() === '' || line === '---' || CLOSING_DIRECTIVE_LINE.test(line))) {
      return reviewedBody;
    }
  }
  const lines = body.split(/\r?\n/);
  const keptLines = lines.filter(line => !CLOSING_DIRECTIVE_LINE.test(line));
  if (keptLines.length === lines.length) return body;

  return keptLines.join('\n').replace(/\n+$/, '');
}

async function requestPullRequest({ token, repository, apiUrl, request, body }) {
  const method = body === undefined ? 'GET' : 'PATCH';
  const response = await request(
    `${apiUrl}/repos/${repository}/pulls/${ISSUE_183_PR_NUMBER}`,
    {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify({ body }) }),
    },
  );

  if (!response.ok) {
    const details =
      typeof response.text === 'function'
        ? await response.text()
        : 'no response body';
    const verb = method === 'GET' ? 'read' : 'update';
    throw new Error(`could not ${verb} PR 184: HTTP ${response.status}: ${details}`);
  }
  return response;
}

export async function preserveIssue183Open({
  event,
  token,
  repository,
  allowWrite = true,
  reviewedBody,
  apiUrl = 'https://api.github.com',
  request = globalThis.fetch,
}) {
  if (
    event?.number !== ISSUE_183_PR_NUMBER ||
    event?.pull_request?.head?.ref !== ISSUE_183_BRANCH
  ) {
    return { action: 'ignored' };
  }

  if (!token) throw new Error('GITHUB_TOKEN is required to read PR 184');
  if (!repository?.includes('/')) {
    throw new Error('GITHUB_REPOSITORY must contain owner/repository');
  }
  if (typeof request !== 'function') {
    throw new Error('a Fetch-compatible request function is required');
  }

  // The event body is a snapshot: a queued, cancelled, or re-run event can
  // carry text that has been edited since, so only the live body is repaired
  // and checked.
  const api = { token, repository, apiUrl, request };
  const current = await requestPullRequest(api);
  const liveBody = (await current.json()).body ?? '';
  const body = removeIssue183ClosingDirectives(liveBody, reviewedBody);
  if (ISSUE_183_CLOSING_DIRECTIVE.test(body)) {
    throw new Error(
      'PR 184 has an issue-closing directive inside other text; remove it by hand',
    );
  }
  if (body === liveBody) return { action: 'unchanged', body };

  if (!allowWrite) {
    throw new Error('PR 184 still has a live issue-closing directive. Remove it from the PR description and rerun the acceptance workflow.');
  }
  await requestPullRequest({ ...api, body });
  return { action: 'updated', body };
}

export async function repairIssue183PrBody({
  eventPath,
  outputEventPath = eventPath,
  environmentFile,
  token,
  repository,
  allowWrite,
  reviewedBody,
  apiUrl,
  request = globalThis.fetch,
}) {
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const result = await preserveIssue183Open({
    event,
    token,
    repository,
    allowWrite,
    reviewedBody,
    apiUrl,
    request,
  });
  if (result.body !== undefined) {
    event.pull_request.body = result.body;
    fs.writeFileSync(outputEventPath, `${JSON.stringify(event)}\n`);
    if (environmentFile) {
      fs.appendFileSync(
        environmentFile,
        `${REPAIRED_EVENT_ENVIRONMENT}=${outputEventPath}\n`,
      );
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--read-only')) {
    throw new Error('Usage: node scripts/issue-183-pr-body.mjs [--read-only]');
  }
  const outputEventPath = process.env.RUNNER_TEMP
    ? path.join(process.env.RUNNER_TEMP, 'issue-183-repaired-event.json')
    : process.env.GITHUB_EVENT_PATH;
  const archive = JSON.parse(fs.readFileSync(new URL('../docs/case-studies/issue-183/requirements.sources.json', import.meta.url), 'utf8'));
  const reviewedBody = archive.sources.find(source => source.id === archive.currentPrBodySourceId)?.originalText;
  const result = await repairIssue183PrBody({
    eventPath: process.env.GITHUB_EVENT_PATH,
    reviewedBody,
    outputEventPath,
    environmentFile: process.env.GITHUB_ENV,
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL,
    allowWrite: args.length === 0,
  });
  console.log(`issue 183 PR metadata: ${result.action}`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
