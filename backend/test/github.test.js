import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createGitHubClient, AuthError, PermissionError } from "../src/github.js";

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function response({ status = 200, headers = {}, body = [] } = {}) {
  return {
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

describe("createGitHubClient", () => {
  let originalFetch, calls;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(...responses) {
    let i = 0;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return responses[Math.min(i++, responses.length - 1)];
    };
  }

  it("requests the pulls endpoint with the auth and API version headers", async () => {
    stubFetch(response({ body: [] }));

    await createGitHubClient({ token: "secret", logger: silentLogger })
      .fetchPullRequests("octocat", "hello-world");

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.github.com/repos/octocat/hello-world/pulls?state=all&per_page=100&sort=updated&direction=desc",
    );
    assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
    assert.equal(calls[0].options.headers["X-GitHub-Api-Version"], "2022-11-28");
  });

  it("passes the requested state through to the query string", async () => {
    stubFetch(response({ body: [] }));

    await createGitHubClient({ token: "secret", logger: silentLogger })
      .fetchPullRequests("octocat", "hello-world", "open");

    assert.ok(calls[0].url.includes("state=open"));
  });

  it("returns the body, a trace id and the GitHub request id on 200", async () => {
    stubFetch(response({ body: [{ number: 1 }], headers: { "x-github-request-id": "GH-123" } }));

    const result = await createGitHubClient({ token: "secret", logger: silentLogger })
      .fetchPullRequests("octocat", "hello-world");

    assert.deepEqual(result.data, [{ number: 1 }]);
    assert.equal(result.githubRequestId, "GH-123");
    assert.match(result.traceId, /^[0-9a-f-]{36}$/);
  });

  it("returns a null request id when GitHub omits the header", async () => {
    stubFetch(response({ body: [] }));

    const result = await createGitHubClient({ token: "secret", logger: silentLogger })
      .fetchPullRequests("octocat", "hello-world");

    assert.equal(result.githubRequestId, null);
  });

  it("throws AuthError on 401 without retrying", async () => {
    stubFetch(response({ status: 401 }));

    await assert.rejects(
      () => createGitHubClient({ token: "bad", logger: silentLogger }).fetchPullRequests("octocat", "hello-world"),
      AuthError,
    );
    assert.equal(calls.length, 1);
  });

  it("throws PermissionError on a 403 that is not a rate limit", async () => {
    stubFetch(response({ status: 403 }));

    await assert.rejects(
      () => createGitHubClient({ token: "secret", logger: silentLogger }).fetchPullRequests("octocat", "private"),
      PermissionError,
    );
    assert.equal(calls.length, 1);
  });

  it("honours retry-after on a 403 and retries the request", async () => {
    stubFetch(
      response({ status: 403, headers: { "retry-after": "0" } }),
      response({ body: [{ number: 7 }] }),
    );

    const result = await createGitHubClient({ token: "secret", logger: silentLogger })
      .fetchPullRequests("octocat", "hello-world");

    assert.equal(calls.length, 2);
    assert.deepEqual(result.data, [{ number: 7 }]);
  });

  it("waits for the rate limit reset when the remaining quota is zero", async () => {
    stubFetch(
      response({ status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0" } }),
      response({ body: [] }),
    );

    const result = await createGitHubClient({ token: "secret", logger: silentLogger })
      .fetchPullRequests("octocat", "hello-world");

    assert.equal(calls.length, 2);
    assert.deepEqual(result.data, []);
  });

  it("backs off and retries a 503 before succeeding", async () => {
    stubFetch(response({ status: 503 }), response({ body: [] }));

    const result = await createGitHubClient({ token: "secret", logger: silentLogger })
      .fetchPullRequests("octocat", "hello-world");

    assert.equal(calls.length, 2);
    assert.deepEqual(result.data, []);
  });

  it("reports an unexpected status instead of throwing", async () => {
    stubFetch(response({ status: 404, headers: { "x-github-request-id": "GH-404" } }));

    const result = await createGitHubClient({ token: "secret", logger: silentLogger })
      .fetchPullRequests("octocat", "missing");

    assert.equal(result.data, null);
    assert.equal(result.httpStatus, 404);
    assert.equal(result.githubRequestId, "GH-404");
  });
});
