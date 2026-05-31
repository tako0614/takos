import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  formatInstalledValue,
  formatRepositorySourceLabel,
  formatTrackingRefLabel,
  getDisplaySource,
  shortCommit,
} from "../../../views/source/sourceDisplay.ts";
import type { SourceItem } from "../../../hooks/useSourceData.ts";
import { test } from "bun:test";

function makeItem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    id: "repo-1",
    name: "demo",
    description: null,
    visibility: "public",
    default_branch: "main",
    updated_at: "2026-04-01T00:00:00.000Z",
    stars: 0,
    forks: 0,
    is_starred: false,
    is_mine: false,
    owner: {
      name: "Acme",
      username: "acme",
      avatar_url: null,
    },
    ...overrides,
  };
}

test("source display - derives source from explicit git_ref metadata", () => {
  const item = makeItem({
    source: {
      kind: "git_ref",
      repository_url: "https://github.com/acme/demo.git",
      ref: "release",
      ref_type: "branch",
      env: "staging",
    },
  });

  assertEquals(getDisplaySource(item), item.source);
  assertEquals(
    formatRepositorySourceLabel(item.source!.repository_url),
    "acme/demo",
  );
});

test("source display - falls back to install source for deployable catalog items", () => {
  const originalLocation = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin: "https://takos.example" },
  });

  try {
    const item = makeItem({
      package: {
        available: true,
        app_id: "demo",
        latest_version: "1.2.3",
        latest_tag: "v1.2.3",
        release_tag: "v1.2.3",
        asset_id: null,
        tags: [],
        downloads: 0,
        certified: false,
        description: null,
        icon: null,
      },
    });

    assertEquals(getDisplaySource(item), {
      kind: "git_ref",
      repository_url: "https://takos.example/git/acme/demo.git",
      ref: "v1.2.3",
      ref_type: "tag",
      env: "staging",
    });
  } finally {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: originalLocation,
    });
  }
});

test("source display - formats tracking and installed commit labels", () => {
  assertEquals(shortCommit("abcdef1234567890"), "abcdef123456");
  assertEquals(
    formatTrackingRefLabel(
      {
        kind: "git_ref",
        repository_url: "https://github.com/acme/demo.git",
        ref: "abcdef1234567890",
        ref_type: "commit",
      },
      {
        branch: "branch",
        tag: "tag",
        commit: "commit",
      },
    ),
    "commit abcdef123456",
  );
  assertEquals(
    formatInstalledValue({
      installed: true,
      installed_version: null,
      installed_commit: "abcdef1234567890",
      deployed_at: "2026-04-01T00:00:00.000Z",
    }),
    {
      kind: "commit",
      value: "abcdef123456",
    },
  );
});
