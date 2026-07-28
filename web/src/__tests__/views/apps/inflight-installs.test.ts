import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";
import {
  isInflightCapsule,
  parseCapsulesResponse,
} from "../../../views/apps/inflight-installs.ts";

test("Capsules - parses authorized Takosumi Interface services", () => {
  const rows = parseCapsulesResponse({
    capsules: [
      {
        capsule_id: "cap_office",
        app_id: "jp.takos.office",
        status: "active",
        source: {
          url: "https://github.com/tako0614/takos-office.git",
          ref: "v1.2.6",
        },
        source_commit: "1111111111111111111111111111111111111111",
        updated_at: "2026-04-22T01:05:00.000Z",
        services: [
          {
            id: "interface:office",
            capability: "interface.ui.surface",
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
      id: "cap_office",
      name: "jp.takos.office",
      status: "active",
      freshness: null,
      environment: "production",
      sourceUrl: "https://github.com/tako0614/takos-office.git",
      sourceRef: "v1.2.6",
      sourceCommit: "1111111111111111111111111111111111111111",
      createdAt: null,
      updatedAt: "2026-04-22T01:05:00.000Z",
      services: [
        {
          id: "interface:office",
          capability: "interface.ui.surface",
          status: "ready",
          endpoint: "https://office.example.test",
          secret_configured: false,
          token_expires_at: null,
        },
      ],
    },
  ]);
  assertEquals(isInflightCapsule(rows[0]!), false);
});

test("Capsules - folds stale active records into attention state", () => {
  const rows = parseCapsulesResponse({
    capsules: [
      {
        capsule_id: "cap_waiting",
        name: "Waiting app",
        status: "active",
        freshness: "stale",
      },
    ],
  });

  assertEquals(rows[0]?.status, "stale");
  assertEquals(isInflightCapsule(rows[0]!), true);
});
