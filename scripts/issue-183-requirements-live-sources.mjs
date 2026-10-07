import crypto from 'node:crypto';

const REPOSITORY = 'link-foundation/relative-meta-logic';
const REST = `https://api.github.com/repos/${REPOSITORY}`;
const GRAPHQL = 'https://api.github.com/graphql';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const fail = message => { throw new Error(message); };

// GitHub documents fullDatabaseId as the 64-bit replacement for databaseId:
// https://docs.github.com/en/graphql/reference/pulls#pullrequestreviewcomment
function record(item) {
  const id = item.fullDatabaseId ?? item.databaseId ?? item.id;
  if (id === undefined || !Object.hasOwn(item, 'body') || (item.body !== null && typeof item.body !== 'string')) fail('incomplete GitHub source record');
  return { id: String(id), bodySha256: hash(item.body ?? ''), author: item.user?.login ?? item.author?.login ?? null, url: item.html_url ?? item.url ?? null, ...(item.path ? { path: item.path } : {}) };
}

function uniqueSorted(items, label) {
  const ids = items.map(item => item.id);
  if (new Set(ids).size !== ids.length) fail(`duplicate ${label} IDs; source scan is inconsistent`);
  return items.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

export async function fetchIssue183LiveSources({ request = fetch, token, timeoutMs = 20000 } = {}) {
  if (!token) fail('live source verification requires the repository read-only GITHUB_TOKEN; use --offline only for uncertified local diagnostics');
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
  async function json(url, options = {}) {
    if (!url.startsWith(`${REST}/`) && url !== GRAPHQL) fail('refusing to send GitHub credentials outside this repository API');
    let response;
    try {
      response = await request(url, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      // Never propagate request exceptions/headers: adapters can include credentials.
      fail('GitHub source request failed or timed out; freshness was not established');
    }
    if (!response.ok) fail(`GitHub source request failed (HTTP ${response.status}); freshness was not established`);
    let value;
    try { value = await response.json(); } catch { fail('GitHub returned malformed JSON; freshness was not established'); }
    if (value.errors?.length) fail('GitHub GraphQL source scan failed; freshness was not established');
    return { value, response };
  }
  async function pages(resource) {
    const all = [];
    for (let page = 1; page <= 1000; page++) {
      const url = `${REST}/${resource}?per_page=100&page=${page}`;
      const { value, response } = await json(url);
      if (!Array.isArray(value)) fail(`invalid paginated ${resource} response`);
      all.push(...value);
      const link = response.headers?.get('link') ?? '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      if (next) {
        const nextUrl = new URL(next[1]);
        if (nextUrl.origin !== 'https://api.github.com' || nextUrl.pathname !== `/repos/${REPOSITORY}/${resource}` || nextUrl.searchParams.get('page') !== String(page + 1)) fail('unsafe or inconsistent GitHub pagination link');
      }
      if (!next && value.length < 100) return all;
    }
    fail('GitHub source scan exceeded its safety limit; no truncated inventory is accepted');
  }
  async function graph(query, variables) {
    return (await json(GRAPHQL, { method: 'POST', body: JSON.stringify({ query, variables }) })).value.data;
  }
  const threadQuery = `query($after:String) { repository(owner:"link-foundation",name:"relative-meta-logic") { pullRequest(number:184) { reviewThreads(first:100,after:$after) { nodes { id isResolved isOutdated path comments(first:100) { nodes { fullDatabaseId body url author { login } } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } } } }`;
  const commentsQuery = `query($id:ID!,$after:String) { node(id:$id) { ... on PullRequestReviewThread { comments(first:100,after:$after) { nodes { fullDatabaseId body url author { login } } pageInfo { hasNextPage endCursor } } } } }`;
  async function threads() {
    const result = [];
    const cursors = new Set();
    let after = null;
    for (;;) {
      const connection = (await graph(threadQuery, { after }))?.repository?.pullRequest?.reviewThreads;
      if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') fail('missing review-thread pagination data');
      for (const thread of connection.nodes) {
        if (!thread.id || !Array.isArray(thread.comments?.nodes) || typeof thread.comments.pageInfo?.hasNextPage !== 'boolean') fail('incomplete review thread');
        const comments = [...thread.comments.nodes];
        let pageInfo = thread.comments.pageInfo;
        const commentCursors = new Set();
        while (pageInfo.hasNextPage) {
          if (!pageInfo.endCursor || commentCursors.has(pageInfo.endCursor)) fail('inconsistent inline-thread comment cursor');
          commentCursors.add(pageInfo.endCursor);
          if (commentCursors.size > 1000) fail('inline-thread comment scan exceeded its safety limit');
          const next = (await graph(commentsQuery, { id: thread.id, after: pageInfo.endCursor }))?.node?.comments;
          if (!Array.isArray(next?.nodes) || typeof next.pageInfo?.hasNextPage !== 'boolean') fail('missing inline-thread comment page');
          comments.push(...next.nodes);
          pageInfo = next.pageInfo;
        }
        result.push({ id: thread.id, path: thread.path, resolved: thread.isResolved, outdated: thread.isOutdated, comments: uniqueSorted(comments.map(record), 'inline-thread comment') });
      }
      if (!connection.pageInfo.hasNextPage) break;
      if (!connection.pageInfo.endCursor || cursors.has(connection.pageInfo.endCursor)) fail('inconsistent review-thread cursor');
      cursors.add(connection.pageInfo.endCursor);
      if (cursors.size > 1000) fail('review-thread scan exceeded its safety limit');
      after = connection.pageInfo.endCursor;
    }
    return uniqueSorted(result, 'review thread');
  }
  const [issue, pull, issueComments, conversation, reviews, inlineComments, inlineThreads] = await Promise.all([
    json(`${REST}/issues/183`), json(`${REST}/pulls/184`),
    pages('issues/183/comments'), pages('issues/184/comments'), pages('pulls/184/reviews'), pages('pulls/184/comments'), threads(),
  ]);
  const restInline = uniqueSorted(inlineComments.map(record), 'inline comment');
  const graphInline = uniqueSorted(inlineThreads.flatMap(thread => thread.comments), 'thread comment');
  if (JSON.stringify(restInline.map(({ id, bodySha256 }) => ({ id, bodySha256 }))) !== JSON.stringify(graphInline.map(({ id, bodySha256 }) => ({ id, bodySha256 })))) fail('REST and GraphQL inline inventories disagree; source scan is inconsistent');
  return { schema: 'rml-issue-183-live-sources/v1', repository: REPOSITORY, issue: record({ ...issue.value, id: 183 }), pullRequest: record({ ...pull.value, id: 184 }), issueComments: uniqueSorted(issueComments.map(record), 'issue comment'), conversation: uniqueSorted(conversation.map(record), 'conversation comment'), reviews: uniqueSorted(reviews.map(item => ({ ...record(item), state: item.state ?? null })), 'review'), inlineComments: restInline, inlineThreads };
}

export function compareIssue183LiveSources(expected, observed) {
  if (expected?.schema !== 'rml-issue-183-live-sources/v1' || expected.repository !== REPOSITORY) fail('missing or invalid reviewed live-source inventory');
  const errors = [];
  for (const field of ['issue', 'pullRequest', 'issueComments', 'conversation', 'reviews', 'inlineComments', 'inlineThreads']) {
    if (expected[field] === undefined || JSON.stringify(expected[field]) !== JSON.stringify(observed[field])) errors.push(`GitHub ${field} changed since the reviewed snapshot; re-audit new, edited, or deleted sources`);
  }
  return { passed: errors.length === 0, errors };
}

export function validateReviewedLiveSources(expected, sources) {
  if (!Array.isArray(sources?.sources)) fail('missing original source archive for live-source traceability');
  const records = [expected?.issue, expected?.pullRequest, ...['issueComments', 'conversation', 'reviews', 'inlineComments'].flatMap(field => expected?.[field] ?? [])];
  for (const item of records) {
    if (!item || !sources.sources.some(source => source.url === item.url && source.author === item.author && source.bodySha256 === item.bodySha256 && typeof source.originalText === 'string' && hash(source.originalText) === item.bodySha256)) {
      fail(`live source ${item?.url ?? 'missing body'} has no matching original wording in the reviewed source archive; re-audit and preserve the source, not only its digest`);
    }
  }
}

export async function verifyIssue183LiveSources(expected, options = {}) {
  const startedAt = new Date().toISOString();
  try {
    const observed = await fetchIssue183LiveSources(options);
    return { ...compareIssue183LiveSources(expected, observed), startedAt, finishedAt: new Date().toISOString(), observed };
  } catch (error) {
    return { passed: false, startedAt, finishedAt: new Date().toISOString(), errors: [error.message] };
  }
}
