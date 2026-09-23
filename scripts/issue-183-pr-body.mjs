import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const ISSUE_183_CLOSING_DIRECTIVE =
  /^\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(?:183|184)\b/im;

const ISSUE_183_PR_NUMBER = 184;
const ISSUE_183_BRANCH = 'issue-183-7fedfddffe9c';
const REPAIRED_EVENT_ENVIRONMENT = 'ISSUE_183_REPAIRED_EVENT_PATH';

export function removeIssue183ClosingDirectives(body) {
  if (!ISSUE_183_CLOSING_DIRECTIVE.test(body)) return body;

  return body
    .split(/\r?\n/)
    .filter(line => !ISSUE_183_CLOSING_DIRECTIVE.test(line))
    .join('\n')
    .replace(/\n+$/, '');
}

export async function preserveIssue183Open({
  event,
  token,
  repository,
  apiUrl = 'https://api.github.com',
  request = globalThis.fetch,
}) {
  const pullRequest = event?.pull_request;
  if (
    event?.number !== ISSUE_183_PR_NUMBER ||
    pullRequest?.head?.ref !== ISSUE_183_BRANCH
  ) {
    return { action: 'ignored' };
  }

  const body = pullRequest.body ?? '';
  const updatedBody = removeIssue183ClosingDirectives(body);
  if (updatedBody === body) return { action: 'unchanged' };

  if (!token) throw new Error('GITHUB_TOKEN is required to update PR 184');
  if (!repository?.includes('/')) {
    throw new Error('GITHUB_REPOSITORY must contain owner/repository');
  }
  if (typeof request !== 'function') {
    throw new Error('a Fetch-compatible request function is required');
  }

  const response = await request(
    `${apiUrl}/repos/${repository}/pulls/${ISSUE_183_PR_NUMBER}`,
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ body: updatedBody }),
    },
  );

  if (!response.ok) {
    const details =
      typeof response.text === 'function'
        ? await response.text()
        : 'no response body';
    throw new Error(`could not update PR 184: HTTP ${response.status}: ${details}`);
  }

  return { action: 'updated', body: updatedBody };
}

export async function repairIssue183PrBody({
  eventPath,
  outputEventPath = eventPath,
  environmentFile,
  token,
  repository,
  apiUrl,
  request = globalThis.fetch,
}) {
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const result = await preserveIssue183Open({
    event,
    token,
    repository,
    apiUrl,
    request,
  });
  if (result.action === 'updated') {
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
  const outputEventPath = process.env.RUNNER_TEMP
    ? path.join(process.env.RUNNER_TEMP, 'issue-183-repaired-event.json')
    : process.env.GITHUB_EVENT_PATH;
  const result = await repairIssue183PrBody({
    eventPath: process.env.GITHUB_EVENT_PATH,
    outputEventPath,
    environmentFile: process.env.GITHUB_ENV,
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL,
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
