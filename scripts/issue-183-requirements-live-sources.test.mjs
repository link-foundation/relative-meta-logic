import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchIssue183LiveSources, verifyIssue183LiveSources, compareIssue183LiveSources, validateReviewedLiveSources } from './issue-183-requirements-live-sources.mjs';

const REPO = 'https://api.github.com/repos/link-foundation/relative-meta-logic';
const publicRoot = 'https://github.com/link-foundation/relative-meta-logic';
const comment = id => ({ id, body: `requirement ${id}`, user: { login: 'maintainer' }, html_url: `${publicRoot}/pull/184#issuecomment-${id}` });
const threadComment = id => ({ fullDatabaseId: String(id), body: `requirement ${id}`, author: { login: 'reviewer' }, url: `${publicRoot}/pull/184#discussion_r${id}` });
const pageInfo = (hasNextPage = false, endCursor = null) => ({ hasNextPage, endCursor });
const response = (value, status = 200, link = '') => ({ ok: status === 200, status, headers: { get: name => name === 'link' ? link : null }, json: async () => value });

function api({ conversation = [comment(1)], issueComments = [], reviews = [], inlineComments = [], threads = [], threadComments = {} } = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    if (url === 'https://api.github.com/graphql') {
      const { query, variables } = JSON.parse(options.body);
      if (query.includes('node(id:')) {
        const all = threadComments[variables.id] ?? [];
        const offset = Number(variables.after);
        return response({ data: { node: { comments: { nodes: all.slice(offset, offset + 100), pageInfo: pageInfo(all.length > offset + 100, String(offset + 100)) } } } });
      }
      const offset = Number(variables.after ?? 0);
      const nodes = threads.slice(offset, offset + 100).map(thread => {
        const all = threadComments[thread.id] ?? [];
        return { ...thread, comments: { nodes: all.slice(0, 100), pageInfo: pageInfo(all.length > 100, '100') } };
      });
      return response({ data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: pageInfo(threads.length > offset + 100, String(offset + 100)) } } } } });
    }
    const parsed = new URL(url);
    const resource = parsed.pathname.slice('/repos/link-foundation/relative-meta-logic/'.length);
    if (resource === 'issues/183') return response({ id: 9183, body: 'Original issue', user: { login: 'maintainer' }, html_url: `${publicRoot}/issues/183` });
    if (resource === 'pulls/184') return response({ id: 9184, body: 'Current PR', user: { login: 'maintainer' }, html_url: `${publicRoot}/pull/184` });
    const lists = { 'issues/183/comments': issueComments, 'issues/184/comments': conversation, 'pulls/184/reviews': reviews, 'pulls/184/comments': inlineComments };
    const all = lists[resource];
    assert.ok(all, `unexpected API resource ${resource}`);
    const page = Number(parsed.searchParams.get('page'));
    const offset = (page - 1) * 100;
    return response(all.slice(offset, offset + 100), 200, all.length > offset + 100 ? `<${REPO}/${resource}?per_page=100&page=${page + 1}>; rel="next"` : '');
  };
  return { request, calls };
}

async function snapshot(config = {}) {
  const mock = api(config);
  return { expected: await fetchIssue183LiveSources({ request: mock.request, token: 'test-secret' }), ...mock };
}

test('scans all six source channels and accepts identical reviewed content', async () => {
  const { expected, request, calls } = await snapshot();
  const result = await verifyIssue183LiveSources(expected, { request, token: 'test-secret' });
  assert.equal(result.passed, true);
  assert.equal(expected.issue.id, '183');
  assert.equal(expected.pullRequest.id, '184');
  assert.equal(expected.conversation.length, 1);
  assert.ok(calls.some(call => call.url.includes('/issues/183/comments')));
  assert.ok(calls.some(call => call.url.includes('/pulls/184/reviews')));
  assert.ok(calls.some(call => call.url.includes('/pulls/184/comments')));
  assert.ok(calls.some(call => call.url === 'https://api.github.com/graphql'));
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('paginates conversation, issue comments and review submissions beyond 100', async () => {
  const items = Array.from({ length: 205 }, (_, index) => comment(index + 1));
  const { expected, calls } = await snapshot({ conversation: items, issueComments: items, reviews: items });
  assert.equal(expected.conversation.length, 205);
  assert.equal(expected.issueComments.length, 205);
  assert.equal(expected.reviews.length, 205);
  assert.equal(calls.filter(call => call.url.includes('page=3')).length, 3);
});

test('accepts the verified canonical repository-ID pagination path without following header URLs', async () => {
  const items = Array.from({ length: 205 }, (_, index) => comment(index + 1));
  const expected = (await snapshot({ conversation: items })).expected;
  const base = api({ conversation: items });
  const request = async (url, options) => {
    const result = await base.request(url, options);
    const link = result.headers.get('link').replace(REPO, 'https://api.github.com/repositories/1071238333');
    return { ...result, headers: { get: name => name === 'link' ? link : null } };
  };
  const result = await verifyIssue183LiveSources(expected, { request, token: 'test-secret' });
  assert.equal(result.passed, true);
  assert.equal(result.observed.conversation.length, 205);
  assert.ok(base.calls.some(call => call.url === `${REPO}/issues/184/comments?per_page=100&page=3`));
  assert.ok(base.calls.every(call => call.url.startsWith(`${REPO}/`) || call.url === 'https://api.github.com/graphql'));
});

test('canonical pagination still rejects foreign repositories, resources, credentials and altered paging', async () => {
  const expected = (await snapshot()).expected;
  const valid = 'https://api.github.com/repositories/1071238333/issues/184/comments?per_page=100&page=2';
  for (const next of [
    valid.replace('1071238333', '1'), valid.replace('/184/', '/183/'),
    valid.replace('https://', 'http://'), valid.replace('https://', 'https://attacker@'),
    valid.replace('page=2', 'page=3'), valid.replace('per_page=100', 'per_page=99'),
    `${valid}&page=2`, `${valid}&other=1`, `${valid}#fragment`, '/relative/path',
  ]) {
    const base = api();
    const request = async (url, options) => url.includes('issues/184/comments')
      ? response([comment(1)], 200, `<${next}>; rel="next"`)
      : base.request(url, options);
    const result = await verifyIssue183LiveSources(expected, { request, token: 'test-secret' });
    assert.equal(result.passed, false, next);
    assert.match(result.errors[0], /unsafe or inconsistent/, next);
    assert.ok(base.calls.every(call => call.url.startsWith(`${REPO}/`) || call.url === 'https://api.github.com/graphql'));
  }
});

test('paginates both review threads and their nested comment connections', async () => {
  const threads = Array.from({ length: 101 }, (_, index) => ({ id: `thread-${index}`, path: 'a.mjs', isResolved: false, isOutdated: false }));
  const comments = Array.from({ length: 105 }, (_, index) => threadComment(index + 1));
  const inlineComments = comments.map(item => ({ id: item.fullDatabaseId, body: item.body, user: item.author, html_url: item.url }));
  const { expected, calls } = await snapshot({ threads, threadComments: { 'thread-0': comments }, inlineComments });
  assert.equal(expected.inlineThreads.length, 101);
  assert.equal(expected.inlineThreads[0].comments.length, 105);
  assert.ok(calls.some(call => call.options.body?.includes('"after":"100"')));
});

test('rejects new edited deleted sources, changed bodies and changed thread resolution', async () => {
  const { expected } = await snapshot();
  for (const config of [{ conversation: [comment(1), comment(2)] }, { conversation: [{ ...comment(1), body: 'Edited requirement' }] }, { conversation: [] }, { issueComments: [comment(2)] }, { reviews: [comment(2)] }]) {
    const result = await verifyIssue183LiveSources(expected, { request: api(config).request, token: 'test-secret' });
    assert.equal(result.passed, false);
    assert.match(result.errors.join(' '), /changed since the reviewed snapshot/);
  }
  for (const field of ['issue', 'pullRequest']) {
    const changed = structuredClone(expected);
    changed[field].bodySha256 = 'changed';
    assert.equal(compareIssue183LiveSources(expected, changed).passed, false);
  }
  const reviewBefore = await snapshot({ reviews: [{ ...comment(2), body: null, state: 'APPROVED' }] });
  const reviewAfter = structuredClone(reviewBefore.expected);
  reviewAfter.reviews[0].state = 'DISMISSED';
  assert.equal(compareIssue183LiveSources(reviewBefore.expected, reviewAfter).passed, false);
  const before = await snapshot({ threads: [{ id: 'thread', path: 'a.mjs', isResolved: false, isOutdated: false }] });
  const after = structuredClone(before.expected);
  after.inlineThreads[0].resolved = true;
  assert.equal(compareIssue183LiveSources(before.expected, after).passed, false);
});

test('requires actual live access; a missing token is never a passing offline certificate', async () => {
  const { expected } = await snapshot();
  const result = await verifyIssue183LiveSources(expected, { request: () => assert.fail('must not request without token') });
  assert.equal(result.passed, false);
  assert.match(result.errors[0], /read-only GITHUB_TOKEN/);
});

test('fails closed on rate limiting, auth failure, server failure and malformed JSON', async () => {
  const { expected } = await snapshot();
  for (const status of [401, 403, 429, 500]) {
    const result = await verifyIssue183LiveSources(expected, { token: 'test-secret', request: async () => response(null, status) });
    assert.equal(result.passed, false);
    assert.match(result.errors[0], new RegExp(`HTTP ${status}`));
  }
  const result = await verifyIssue183LiveSources(expected, { token: 'test-secret', request: async () => ({ ...response(null), json: async () => { throw new Error('test-secret'); } }) });
  assert.equal(result.passed, false);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('does not expose tokens in network or GraphQL error reports', async () => {
  const { expected } = await snapshot();
  for (const request of [async () => { throw new Error('Authorization: Bearer test-secret'); }, async () => response({ errors: [{ message: 'test-secret' }] })]) {
    const result = await verifyIssue183LiveSources(expected, { token: 'test-secret', request });
    assert.equal(result.passed, false);
    assert.ok(!JSON.stringify(result).includes('test-secret'));
  }
});

test('rejects off-repository pagination without sending a token there', async () => {
  const { expected } = await snapshot();
  const base = api();
  const result = await verifyIssue183LiveSources(expected, { token: 'test-secret', request: async (url, options) => {
    assert.ok(url.startsWith(REPO) || url === 'https://api.github.com/graphql');
    if (url.includes('issues/184/comments')) return response([comment(1)], 200, '<https://example.invalid/steal?page=2>; rel="next"');
    return base.request(url, options);
  } });
  assert.equal(result.passed, false);
  assert.match(result.errors[0], /unsafe or inconsistent/);
});

test('rejects duplicated pages and REST/GraphQL disagreement rather than truncating', async () => {
  const { expected } = await snapshot();
  for (const config of [{ conversation: [comment(1), comment(1)] }, { inlineComments: [comment(1)] }]) {
    const result = await verifyIssue183LiveSources(expected, { request: api(config).request, token: 'test-secret' });
    assert.equal(result.passed, false);
    assert.match(result.errors[0], /duplicate|inventories disagree/);
  }
});


test('does not bless new source digests without preserving and reviewing the actual source text', async () => {
  const { expected } = await snapshot();
  const sources = { sources: [
    { ...expected.issue, originalText: 'Original issue' },
    { ...expected.pullRequest, originalText: 'Current PR' },
    { ...expected.conversation[0], originalText: 'requirement 1' },
  ] };
  assert.doesNotThrow(() => validateReviewedLiveSources(expected, sources));
  sources.sources.pop();
  assert.throws(() => validateReviewedLiveSources(expected, sources), /no matching original wording/);
  const forged = structuredClone(expected);
  forged.conversation[0].bodySha256 = 'invented digest';
  sources.sources.push({ ...forged.conversation[0], originalText: 'requirement 1' });
  assert.throws(() => validateReviewedLiveSources(forged, sources), /no matching original wording/);
});
