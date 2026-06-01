import { test } from "bun:test";
import { assertEquals, assertThrows } from "@takos/test/assert";
import { BadRequestError } from "@takos/worker-platform-utils/errors";

import type { Env } from "../../../../shared/types/index.ts";
import {
  buildTakosRepositoryUrl,
  buildWorkflowRunRef,
  isDirectoryMode,
  looksLikeInlineSql,
  normalizeRepoPath,
  normalizeRepoRef,
  normalizeRepositoryUrl,
  parseTakosRepositoryUrl,
  repositoryUrlKey,
} from "../repository-source.ts";

const env = {
  ADMIN_DOMAIN: "takos.example.com",
} as unknown as Env;

test("normalizeRepositoryUrl canonicalizes valid repository URLs", () => {
  assertEquals(
    normalizeRepositoryUrl("https://GitHub.com/acme//demo/"),
    "https://github.com/acme/demo.git",
  );
});

test("normalizeRepositoryUrl rejects non-https repository URLs", () => {
  assertThrows(
    () => normalizeRepositoryUrl("http://github.com/acme/demo"),
    BadRequestError,
    "repository_url must use https://",
  );
});

test("repositoryUrlKey normalizes .git suffixes and trailing slashes", () => {
  assertEquals(
    repositoryUrlKey("https://github.com/acme/demo.git/"),
    "https://github.com/acme/demo",
  );
});

test("buildTakosRepositoryUrl builds canonical Takos-hosted repository URLs", () => {
  assertEquals(
    buildTakosRepositoryUrl(env, "team-alpha", "demo"),
    "https://takos.example.com/git/team-alpha/demo.git",
  );
});

test("parseTakosRepositoryUrl parses Takos-hosted repository URLs", () => {
  assertEquals(
    parseTakosRepositoryUrl(
      env,
      "https://takos.example.com/git/team-alpha/demo.git",
    ),
    { ownerSlug: "team-alpha", repoName: "demo" },
  );
});

test("parseTakosRepositoryUrl ignores external repository URLs", () => {
  assertEquals(
    parseTakosRepositoryUrl(env, "https://github.com/acme/demo.git"),
    null,
  );
});

test("normalizeRepoPath removes leading markers and duplicate separators", () => {
  assertEquals(
    normalizeRepoPath("./infra\\\\sql//001-init.sql"),
    "infra/sql/001-init.sql",
  );
});

test("normalizeRepoRef normalizes branch and tag refs", () => {
  assertEquals(normalizeRepoRef("branch", "refs/heads/main"), "main");
  assertEquals(normalizeRepoRef("tag", "refs/tags/v1.2.3"), "v1.2.3");
  assertEquals(normalizeRepoRef("commit", "abc123"), "abc123");
});

test("buildWorkflowRunRef formats branch and tag refs", () => {
  assertEquals(buildWorkflowRunRef("branch", "main"), "refs/heads/main");
  assertEquals(buildWorkflowRunRef("tag", "v1.2.3"), "refs/tags/v1.2.3");
  assertEquals(buildWorkflowRunRef("commit", "abc123"), null);
});

test("isDirectoryMode recognizes git tree entries", () => {
  assertEquals(isDirectoryMode("040000"), true);
  assertEquals(isDirectoryMode("40000"), true);
  assertEquals(isDirectoryMode("100644"), false);
});

test("looksLikeInlineSql detects inline migration content", () => {
  assertEquals(looksLikeInlineSql("CREATE TABLE users (id integer);"), true);
  assertEquals(
    looksLikeInlineSql("-- migration\nCREATE TABLE users (id integer);"),
    true,
  );
  assertEquals(looksLikeInlineSql("migrations/001-init.sql"), false);
});
