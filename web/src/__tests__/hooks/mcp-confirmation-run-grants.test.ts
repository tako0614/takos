import { describe, expect, test } from "bun:test";
import {
  peekMcpConfirmationRunGrant,
  removeMcpConfirmationRunGrant,
  storeMcpConfirmationRunGrant,
} from "../../hooks/mcp-confirmation-run-grants.ts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("MCP confirmation Run grant handoff", () => {
  test("queues one scoped grant and removes only the accepted identity", () => {
    const storage = memoryStorage();
    const grant = {
      confirmationGrantId: "confirmation_1",
      workspaceId: "workspace_1",
      threadId: "thread_1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    storeMcpConfirmationRunGrant(storage, grant);
    expect(peekMcpConfirmationRunGrant(
      storage,
      "workspace_1",
      "thread_1",
    )).toEqual(grant);
    expect(peekMcpConfirmationRunGrant(
      storage,
      "workspace_1",
      "thread_2",
    )).toBeNull();
    removeMcpConfirmationRunGrant(storage, grant);
    expect(peekMcpConfirmationRunGrant(
      storage,
      "workspace_1",
      "thread_1",
    )).toBeNull();
  });

  test("ignores expired, corrupt, and cross-scope persisted values", () => {
    const storage = memoryStorage();
    const prefix = "takos:mcp-confirmation-run-grants:v1:";
    storage.setItem(
      `${prefix}workspace_2:thread_2`,
      JSON.stringify([
        {
          confirmationGrantId: "expired_1",
          workspaceId: "workspace_2",
          threadId: "thread_2",
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
        {
          confirmationGrantId: "wrong_scope",
          workspaceId: "workspace_3",
          threadId: "thread_2",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        { injected: true },
      ]),
    );
    expect(peekMcpConfirmationRunGrant(
      storage,
      "workspace_2",
      "thread_2",
    )).toBeNull();
    expect(storage.getItem(`${prefix}workspace_2:thread_2`)).toBeNull();
  });
});
