import { afterEach, expect, test } from "bun:test";

import type { Env } from "../../../../shared/types/index.ts";
import { storeSearchHandler, workspaceSourceToolDeps } from "../space-source.ts";

const originalList = workspaceSourceToolDeps.listCatalogItems;
const originalTcsList = workspaceSourceToolDeps.listTcsStoreListings;

afterEach(() => {
  workspaceSourceToolDeps.listCatalogItems = originalList;
  workspaceSourceToolDeps.listTcsStoreListings = originalTcsList;
});

test("store_search discovers a TCS Capsule without installing it", async () => {
  workspaceSourceToolDeps.listCatalogItems = async () => ({
    total: 0,
    has_more: false,
    items: [],
  });
  workspaceSourceToolDeps.listTcsStoreListings = async (_env, options) => {
    expect(options).toEqual({
      query: "takos git",
      category: undefined,
      limit: 10,
      certifiedOnly: false,
    });
    return {
      warnings: [],
      items: [
        {
          id: "listing-takos-git",
          scope: "tako",
          slug: "takos-git",
          source: { git: "https://github.com/tako0614/takos-git" },
          suggestedName: "git",
          name: { ja: "Takos Git", en: "Takos Git" },
          description: {
            ja: "Git hosting",
            en: "Git hosting",
          },
          badge: { ja: "追加候補", en: "Installable" },
          category: "developer",
          tags: ["git", "source"],
          createdAt: "2026-08-21T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:00.000Z",
          storeOrigin: "https://store.takosumi.com",
        },
      ],
    };
  };

  const output = await storeSearchHandler(
    { query: "takos git", type: "deployable-app" },
    {
      spaceId: "space-1",
      threadId: "thread-1",
      runId: "run-1",
      userId: "user-1",
      capabilities: [],
      env: {} as Env,
      db: {} as never,
    },
  );

  expect(JSON.parse(output)).toEqual({
    total: 1,
    has_more: false,
    items: [
      {
        repo_id: "tcs:https://store.takosumi.com:listing-takos-git",
        repo_name: "Takos Git",
        owner: "tako",
        description: "Git hosting",
        stars: null,
        language: null,
        license: null,
        capsule: {
          app_id: "tako/takos-git",
          version: null,
          category: "developer",
          tags: ["git", "source"],
          certified: false,
        },
        git_address: {
          url: "https://github.com/tako0614/takos-git",
        },
        install_defaults: {
          ref: "HEAD",
          path: ".",
          suggested_name: "git",
        },
        deployment_intent: {
          kind: "takosumi.git-install-plan@v1",
          source: {
            url: "https://github.com/tako0614/takos-git",
            ref: "HEAD",
            path: ".",
          },
          capsule: { suggested_name: "git" },
          lifecycle_authority: "takosumi-api",
          review_required: true,
        },
        source_catalog: {
          protocol: "tcs.v2",
          origin: "https://store.takosumi.com",
          listing_id: "listing-takos-git",
        },
        installed_in_current_workspace: null,
      },
    ],
  });
});
