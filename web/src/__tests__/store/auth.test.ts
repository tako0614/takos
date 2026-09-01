import { expect, test } from "bun:test";
import {
  fetchSpaces,
  fetchUserSettings,
  handleLogout,
  loadAuthSnapshot,
  type AuthActionDeps,
} from "../../store/auth.ts";
import type { Space } from "../../types/index.ts";

const now = "2026-08-10T10:00:00.000Z";
const personalSpace: Space = {
  id: "space-personal",
  slug: "personal-slug",
  name: "Personal",
  description: null,
  is_default: true,
  security_posture: "standard",
  created_at: now,
  updated_at: now,
};

const deps: AuthActionDeps = {
  showToast: () => undefined,
  t: () => "Failed to load",
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("Workspace refresh keeps the last verified inventory on malformed success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => jsonResponse({ spaces: [{}] })) as unknown as typeof fetch;
  try {
    const result = await fetchSpaces(deps, null, {
      notifyOnError: false,
      fallbackSpaces: [personalSpace],
    });
    expect(result).toEqual([personalSpace]);

    await expect(fetchSpaces(deps, null, {
      notifyOnError: false,
      throwOnError: true,
      fallbackSpaces: [personalSpace],
    })).rejects.toThrow(TypeError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("initial auth bootstrap exposes invalid Workspace inventory as retryable failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/me") {
      return jsonResponse({
        email: "owner@example.com",
        name: "Owner",
        username: "owner",
        picture: null,
        setup_completed: true,
      });
    }
    if (path === "/api/spaces") return jsonResponse({ spaces: [] });
    if (path === "/api/me/settings") return jsonResponse({});
    throw new Error(`Unexpected request: ${path}`);
  }) as unknown as typeof fetch;

  try {
    const snapshot = await loadAuthSnapshot(deps);
    expect(snapshot.authState).toBe("loading");
    expect(snapshot.spacesLoaded).toBe(false);
    expect(snapshot.spaces).toEqual([]);
    expect(snapshot.bootstrapError).toBe("Invalid Workspace inventory response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("initial auth bootstrap rejects malformed current-user authority", async () => {
  const originalFetch = globalThis.fetch;
  let spacesCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/me") {
      return jsonResponse({
        email: "owner@example.com",
        name: "Owner",
        username: "owner",
        picture: null,
        setup_completed: "true",
      });
    }
    if (path === "/api/spaces") spacesCalls += 1;
    return jsonResponse({});
  }) as unknown as typeof fetch;

  try {
    const snapshot = await loadAuthSnapshot(deps);
    expect(snapshot.authState).toBe("loading");
    expect(snapshot.bootstrapError).toBe("Invalid current user response");
    expect(spacesCalls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("user-settings revalidation preserves the last verified settings", async () => {
  const originalFetch = globalThis.fetch;
  const verified = {
    setup_completed: true,
    auto_update_enabled: false,
    private_account: true,
    activity_visibility: "private" as const,
    ai_model: "gpt-5.5",
    available_models: ["gpt-5.5"],
  };
  globalThis.fetch = (async () => jsonResponse({
    ...verified,
    activity_visibility: "forged",
  })) as unknown as typeof fetch;

  try {
    expect(await fetchUserSettings(verified)).toEqual(verified);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logout is single-flight and rejects malformed success", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let resolveResponse: ((response: Response) => void) | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return await new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
  }) as unknown as typeof fetch;

  try {
    const first = handleLogout();
    const replay = handleLogout();
    expect(replay).toBe(first);
    expect(calls).toBe(1);
    resolveResponse?.(jsonResponse({ success: "true" }));
    await expect(first).rejects.toThrow("Invalid logout response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logout rejects HTTP failures and accepts only canonical success", async () => {
  const originalFetch = globalThis.fetch;
  let response = new Response("unavailable", { status: 503 });
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  try {
    await expect(handleLogout()).rejects.toThrow();
    response = jsonResponse({ success: true });
    await expect(handleLogout()).resolves.toBeUndefined();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
