import { assertEquals } from "@std/assert";
import {
  repoBlob,
  repoBranches,
  repoClosePullRequest,
  repoCommits,
  repoCreatePullRequestComment,
  repoCreatePullRequestReview,
  repoMergePullRequest,
  repoPullRequestComments,
  repoPullRequestDiff,
  repoPullRequestReviews,
  repoPullRequests,
  repoRunPullRequestAiReview,
  repoTree,
} from "../../lib/rpc.ts";

Deno.test("repository read helpers use split gateway repository routes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; accept: string | null }> = [];

  try {
    globalThis.fetch = ((input, init) => {
      calls.push({
        url: String(input),
        accept: new Headers(init?.headers).get("Accept"),
      });
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch;

    await repoTree("repo/one", "feature/ref", { path: "src" });
    await repoBlob("repo/one", "main", { path: "README.md" });

    assertEquals(calls, [
      {
        url: "/api/repositories/repo%2Fone/tree?path=src&ref=feature%2Fref",
        accept: "application/json",
      },
      {
        url: "/api/repositories/repo%2Fone/blob?path=README.md&ref=main",
        accept: "application/json",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("repository commits helper normalizes split gateway responses", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  try {
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
      });
      return Promise.resolve(Response.json({
        commits: [{
          sha: "abc123",
          tree: "tree_1",
          parents: ["parent_1"],
          authorName: "Tako",
          authorEmail: "tako@example.com",
          authorDate: "2026-05-12T00:00:00.000Z",
          committerName: "Tako",
          committerEmail: "tako@example.com",
          committerDate: "2026-05-12T00:01:00.000Z",
          message: "Add docs",
        }],
      }));
    }) as typeof fetch;

    const result = await repoCommits("repo/one", "feature/docs", {
      page: 2,
      limit: 20,
    });

    assertEquals(calls, [{
      url:
        "/api/repositories/repo%2Fone/commits?ref=feature%2Fdocs&limit=20&offset=20",
      method: "GET",
    }]);
    assertEquals(result.commits, [{
      sha: "abc123",
      message: "Add docs",
      author: {
        name: "Tako",
        email: "tako@example.com",
      },
      date: "2026-05-12T00:01:00.000Z",
      parents: ["parent_1"],
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("repository branches helper normalizes split gateway refs", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  try {
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
      });
      if (url.endsWith("/branches")) {
        return Promise.resolve(Response.json({
          refs: [
            { name: "refs/heads/main", target: "abc123" },
            { name: "refs/heads/feature/docs", target: "def456" },
          ],
        }));
      }
      return Promise.resolve(Response.json({ defaultBranch: "main" }));
    }) as typeof fetch;

    const result = await repoBranches("repo/one");

    assertEquals(calls, [
      { url: "/api/repositories/repo%2Fone", method: "GET" },
      { url: "/api/repositories/repo%2Fone/branches", method: "GET" },
    ]);
    assertEquals(result.branches, [
      {
        name: "main",
        commit_sha: "abc123",
        is_default: true,
      },
      {
        name: "feature/docs",
        commit_sha: "def456",
        is_default: false,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("repository pull request helper normalizes split gateway responses", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  try {
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      if (url.includes("/compare?")) {
        return Promise.resolve(Response.json({
          baseCommit: "abc123",
          headCommit: "def456",
          mergeBase: "abc123",
          aheadBy: 2,
          behindBy: 0,
          files: [],
        }));
      }
      return Promise.resolve(Response.json({
        pullRequests: [{
          id: "pr_1",
          number: 1,
          title: "Add docs",
          description: "Docs update",
          status: "open",
          authorAccountId: "tsub_author",
          headBranch: "feature/docs",
          baseBranch: "main",
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:01:00.000Z",
          comments: [{ id: "comment_1" }],
          reviews: [{ id: "review_1" }],
        }],
      }));
    }) as typeof fetch;

    const list = await repoPullRequests("repo/one", { status: "open" });

    assertEquals(calls, [
      {
        url: "/api/repositories/repo%2Fone/pull-requests?status=open",
        method: "GET",
      },
      {
        url:
          "/api/repositories/repo%2Fone/compare?base=main&head=feature%2Fdocs",
        method: "GET",
      },
    ]);
    assertEquals(list.pull_requests[0], {
      id: "pr_1",
      number: 1,
      title: "Add docs",
      description: "Docs update",
      status: "open",
      author: { id: "tsub_author", name: null },
      source_branch: "feature/docs",
      target_branch: "main",
      commits_count: 2,
      comments_count: 1,
      reviews_count: 1,
      is_mergeable: true,
      created_at: "2026-05-12T00:00:00.000Z",
      updated_at: "2026-05-12T00:01:00.000Z",
      merged_at: null,
      closed_at: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("repository pull request action helpers post to split gateway routes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    url: string;
    method: string;
    accept: string | null;
    contentType: string | null;
    body?: string;
  }> = [];

  try {
    globalThis.fetch = ((input, init) => {
      const headers = new Headers(init?.headers);
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        accept: headers.get("Accept"),
        contentType: headers.get("Content-Type"),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      if (init?.method === "PATCH") {
        return Promise.resolve(Response.json({
          pullRequest: {
            id: "pr_1",
            repositoryId: "repo/one",
            number: 1,
            title: "Add docs",
            description: "Docs update",
            status: "closed",
            authorAccountId: "tsub_author",
            headBranch: "feature/docs",
            baseBranch: "main",
            createdAt: "2026-05-12T00:00:00.000Z",
            updatedAt: "2026-05-12T00:05:00.000Z",
            comments: [],
            reviews: [],
          },
        }));
      }
      if (url.endsWith("/comments")) {
        return Promise.resolve(Response.json({
          comment: {
            id: "comment_1",
            pullRequestId: "pr_1",
            authorAccountId: "acct_1",
            body: "Looks good",
            createdAt: "2026-05-12T00:02:00.000Z",
          },
        }, { status: 201 }));
      }
      if (url.endsWith("/reviews")) {
        return Promise.resolve(Response.json({
          review: {
            id: "review_1",
            pullRequestId: "pr_1",
            reviewerAccountId: "acct_2",
            status: "approved",
            body: "Approved",
            analysis: null,
            createdAt: "2026-05-12T00:03:00.000Z",
          },
        }, { status: 201 }));
      }
      return Promise.resolve(Response.json({
        merged: true,
        pullRequest: {
          id: "pr_1",
          repositoryId: "repo/one",
          number: 1,
          title: "Add docs",
          description: "Docs update",
          status: "merged",
          authorAccountId: "tsub_author",
          headBranch: "feature/docs",
          baseBranch: "main",
          mergedAt: "2026-05-12T00:04:00.000Z",
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:04:00.000Z",
          comments: [],
          reviews: [],
        },
      }));
    }) as typeof fetch;

    const comment = await repoCreatePullRequestComment("repo/one", 1, {
      body: "Looks good",
    });
    const review = await repoCreatePullRequestReview("repo/one", 1, {
      status: "approved",
      body: "Approved",
    });
    const merge = await repoMergePullRequest("repo/one", 1);
    const close = await repoClosePullRequest("repo/one", 1);

    assertEquals(calls, [
      {
        url: "/api/repositories/repo%2Fone/pull-requests/1/comments",
        method: "POST",
        accept: "application/json",
        contentType: "application/json",
        body: JSON.stringify({ body: "Looks good" }),
      },
      {
        url: "/api/repositories/repo%2Fone/pull-requests/1/reviews",
        method: "POST",
        accept: "application/json",
        contentType: "application/json",
        body: JSON.stringify({ status: "approved", body: "Approved" }),
      },
      {
        url: "/api/repositories/repo%2Fone/pull-requests/1/merge",
        method: "POST",
        accept: "application/json",
        contentType: "application/json",
        body: JSON.stringify({}),
      },
      {
        url: "/api/repositories/repo%2Fone/pull-requests/1",
        method: "PATCH",
        accept: "application/json",
        contentType: "application/json",
        body: JSON.stringify({ status: "closed" }),
      },
    ]);
    assertEquals(comment.comment, {
      id: "comment_1",
      author: { id: "acct_1", name: null },
      body: "Looks good",
      author_type: "user",
      path: null,
      line: null,
      created_at: "2026-05-12T00:02:00.000Z",
    });
    assertEquals(review.review, {
      id: "review_1",
      author: { id: "acct_2", name: null },
      reviewer_type: "user",
      status: "approved",
      body: "Approved",
      analysis: null,
      created_at: "2026-05-12T00:03:00.000Z",
    });
    assertEquals(merge.pull_request, {
      id: "pr_1",
      number: 1,
      title: "Add docs",
      description: "Docs update",
      status: "merged",
      author: { id: "tsub_author", name: null },
      source_branch: "feature/docs",
      target_branch: "main",
      commits_count: 0,
      comments_count: 0,
      reviews_count: 0,
      is_mergeable: false,
      created_at: "2026-05-12T00:00:00.000Z",
      updated_at: "2026-05-12T00:04:00.000Z",
      merged_at: "2026-05-12T00:04:00.000Z",
      closed_at: null,
    });
    assertEquals(close.pull_request?.status, "closed");
    assertEquals(close.pull_request?.closed_at, "2026-05-12T00:05:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("repository pull request discussion helpers read split gateway routes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  try {
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
      });
      if (url.endsWith("/comments")) {
        return Promise.resolve(Response.json({
          comments: [{
            id: "comment_1",
            pullRequestId: "pr_1",
            authorAccountId: "acct_1",
            body: "Looks good",
            path: "README.md",
            line: 12,
            createdAt: "2026-05-12T00:02:00.000Z",
          }],
        }));
      }
      return Promise.resolve(Response.json({
        reviews: [{
          id: "review_1",
          pullRequestId: "pr_1",
          reviewerAccountId: "acct_2",
          status: "changes_requested",
          body: "Please update",
          analysis: "One issue found",
          createdAt: "2026-05-12T00:03:00.000Z",
        }],
      }));
    }) as typeof fetch;

    const comments = await repoPullRequestComments("repo/one", 1);
    const reviews = await repoPullRequestReviews("repo/one", 1);

    assertEquals(calls, [
      {
        url: "/api/repositories/repo%2Fone/pull-requests/1/comments",
        method: "GET",
      },
      {
        url: "/api/repositories/repo%2Fone/pull-requests/1/reviews",
        method: "GET",
      },
    ]);
    assertEquals(comments.comments, [{
      id: "comment_1",
      author: { id: "acct_1", name: null },
      body: "Looks good",
      author_type: "user",
      path: "README.md",
      line: 12,
      created_at: "2026-05-12T00:02:00.000Z",
    }]);
    assertEquals(reviews.reviews, [{
      id: "review_1",
      author: { id: "acct_2", name: null },
      reviewer_type: "user",
      status: "changes_requested",
      body: "Please update",
      analysis: "One issue found",
      created_at: "2026-05-12T00:03:00.000Z",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("repository pull request diff helper normalizes hunked diff", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  try {
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
      });
      return Promise.resolve(Response.json({
        files: [{
          path: "GUIDE.md",
          status: "added",
          additions: 1,
          deletions: 0,
          hunks: [{
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            lines: [{
              type: "addition",
              content: "guide",
              newLine: 1,
            }],
          }],
        }],
      }));
    }) as typeof fetch;

    const diff = await repoPullRequestDiff("repo/one", 1);

    assertEquals(calls, [{
      url: "/api/repositories/repo%2Fone/pull-requests/1/diff",
      method: "GET",
    }]);
    assertEquals(diff.files, [{
      path: "GUIDE.md",
      old_path: undefined,
      status: "added",
      additions: 1,
      deletions: 0,
      hunks: [{
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: 1,
        lines: [{
          type: "addition",
          content: "guide",
          old_line: undefined,
          new_line: 1,
        }],
      }],
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("repository pull request AI review helper uses split gateway route", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  try {
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
      });
      return Promise.resolve(Response.json({
        review: { id: "review_ai" },
        comments: [],
      }, { status: 201 }));
    }) as typeof fetch;

    await repoRunPullRequestAiReview("repo/one", 1);

    assertEquals(calls, [{
      url: "/api/repositories/repo%2Fone/pull-requests/1/ai-review",
      method: "POST",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
