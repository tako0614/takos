import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";
import {
  isInflightInstallation,
  parseCapsuleInstallationsResponse,
} from "../../../views/apps/inflight-installs.ts";

test("capsule installations - parses Takosumi projection services", () => {
  const rows = parseCapsuleInstallationsResponse({
    installations: [
      {
        id: "inst_office",
        app_id: "jp.takos.office",
        status: "ready",
        source: {
          git: {
            url: "https://github.com/tako0614/takos-office.git",
            ref: "v1.2.6",
            commit: "1111111111111111111111111111111111111111",
          },
        },
        mode: "shared-cell",
        updated_at: "2026-04-22T01:05:00.000Z",
        services: [
          {
            id: "launch_url",
            capability: "deployment.outputs",
            status: "ready",
            endpoint: "https://office.example.test",
            secret_configured: false,
            token_expires_at: null,
          },
        ],
      },
    ],
  });

  assertEquals(rows, [
    {
      id: "inst_office",
      name: "jp.takos.office",
      status: "ready",
      freshness: null,
      environment: "production",
      mode: "shared-cell",
      sourceUrl: "https://github.com/tako0614/takos-office.git",
      sourceRef: "v1.2.6",
      sourceCommit: "1111111111111111111111111111111111111111",
      createdAt: null,
      updatedAt: "2026-04-22T01:05:00.000Z",
      services: [
        {
          id: "launch_url",
          capability: "deployment.outputs",
          status: "ready",
          endpoint: "https://office.example.test",
          secret_configured: false,
          token_expires_at: null,
        },
      ],
    },
  ]);
  assertEquals(isInflightInstallation(rows[0]!), false);
});

test("capsule installations - folds stale active projections into attention state", () => {
  const rows = parseCapsuleInstallationsResponse({
    installations: [
      {
        installation_id: "inst_waiting",
        name: "Waiting app",
        status: "active",
        freshness: "stale",
      },
    ],
  });

  assertEquals(rows[0]?.status, "stale");
  assertEquals(isInflightInstallation(rows[0]!), true);
});
