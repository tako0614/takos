import {
  type AssetUploadFile,
  assetUploadDeps,
  createAssetsUploadSession,
  uploadAllAssets,
  uploadAssets,
} from "@/services/wfp/assets";
import type {
  CFAPIResponse,
  WfpClient,
  WFPConfig,
} from "@/services/wfp/client";

// ---------------------------------------------------------------------------
// createAssetsUploadSession
// ---------------------------------------------------------------------------

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

Deno.test("createAssetsUploadSession - returns jwt and flattened uploadNeeded from buckets", async () => {
  const mockClient = {
    fetch: spy(async () => ({
      result: {
        jwt: "session-jwt-token",
        buckets: [["hash1", "hash2"], ["hash3"]],
      },
      success: true,
      errors: [],
      messages: [],
    } satisfies CFAPIResponse<{ jwt: string; buckets: string[][] }>)),
  } as unknown as WfpClient;

  const config: WFPConfig = {
    accountId: "acc-1",
    apiToken: "token-1",
    dispatchNamespace: "ns-1",
  };

  const result = await createAssetsUploadSession(
    mockClient,
    config,
    "worker-1",
    {
      "index.html": { hash: "hash1", size: 100 },
    },
  );

  assertEquals(result.jwt, "session-jwt-token");
  assertEquals(result.uploadNeeded, ["hash1", "hash2", "hash3"]);
});
Deno.test("createAssetsUploadSession - returns empty uploadNeeded when buckets is absent", async () => {
  const mockClient = {
    fetch: spy(async () => ({
      result: { jwt: "token" },
      success: true,
      errors: [],
      messages: [],
    })),
  } as unknown as WfpClient;

  const config: WFPConfig = {
    accountId: "a",
    apiToken: "t",
    dispatchNamespace: "ns",
  };
  const result = await createAssetsUploadSession(mockClient, config, "w", {});
  assertEquals(result.uploadNeeded, []);
});
Deno.test("createAssetsUploadSession - calls the correct API path", async () => {
  const mockFetch = spy(async () => ({
    result: { jwt: "x" },
    success: true,
    errors: [],
    messages: [],
  }));
  const mockClient = { fetch: mockFetch } as unknown as WfpClient;
  const config: WFPConfig = {
    accountId: "acc-1",
    apiToken: "t",
    dispatchNamespace: "ns-1",
  };

  await createAssetsUploadSession(mockClient, config, "my-worker", {});

  assertSpyCalls(mockFetch, 1);
  const path = (mockFetch.calls[0] as any).args[0] as string;
  assertStringIncludes(path, "/accounts/acc-1/");
  assertStringIncludes(path, "/scripts/my-worker/assets-upload-session");
});
// ---------------------------------------------------------------------------
// uploadAssets
// ---------------------------------------------------------------------------

Deno.test("uploadAssets - posts FormData to the upload endpoint and returns completion JWT", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: { jwt: "completion-jwt" },
          errors: [],
          messages: [],
        }),
        { status: 200 },
      )
    );
    (globalThis as any).fetch = fetchMock;

    const config: WFPConfig = {
      accountId: "acc-1",
      apiToken: "tok",
      dispatchNamespace: "ns",
    };
    const files: Record<string, AssetUploadFile> = {
      "hash1": { base64Content: "aGVsbG8=", contentType: "text/html" },
    };

    const jwt = await uploadAssets(config, "session-jwt", files);
    assertEquals(jwt, "completion-jwt");

    assertSpyCalls(fetchMock, 1);
    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    assertStringIncludes(url, "/accounts/acc-1/workers/assets/upload");
    assertEquals(init.method, "POST");
    assertEquals(headers.Authorization, "Bearer session-jwt");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("uploadAssets - throws on non-ok response", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response("Internal Server Error", { status: 500 })
    );
    (globalThis as any).fetch = fetchMock;

    const config: WFPConfig = {
      accountId: "a",
      apiToken: "t",
      dispatchNamespace: "ns",
    };
    await assertRejects(async () => {
      await uploadAssets(config, "jwt", {});
    }, "Assets upload failed");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("uploadAssets - throws when response is ok but missing completion JWT", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(JSON.stringify({ success: false, result: {} }), {
        status: 200,
      })
    );
    (globalThis as any).fetch = fetchMock;

    const config: WFPConfig = {
      accountId: "a",
      apiToken: "t",
      dispatchNamespace: "ns",
    };
    await assertRejects(async () => {
      await uploadAssets(config, "jwt", {});
    }, "no completion JWT");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("uploadAssets - throws timeout error on abort", async () => {
  try {
    const fetchMock = spy(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    (globalThis as any).fetch = fetchMock;

    const config: WFPConfig = {
      accountId: "a",
      apiToken: "t",
      dispatchNamespace: "ns",
    };
    await assertRejects(async () => {
      await uploadAssets(config, "jwt", {});
    }, "timeout");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
// ---------------------------------------------------------------------------
// uploadAllAssets
// ---------------------------------------------------------------------------

Deno.test("uploadAllAssets - returns session JWT directly when all assets are cached", async () => {
  try {
    const mockClient = {
      fetch: spy(async () => ({
        result: { jwt: "cached-jwt", buckets: [] },
        success: true,
        errors: [],
        messages: [],
      })),
    } as unknown as WfpClient;

    const config: WFPConfig = {
      accountId: "a",
      apiToken: "t",
      dispatchNamespace: "ns",
    };
    const content = new TextEncoder().encode("hello").buffer as ArrayBuffer;

    const jwt = await uploadAllAssets(mockClient, config, "worker-1", [
      { path: "index.html", content },
    ]);

    assertEquals(jwt, "cached-jwt");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("uploadAllAssets - uploads needed files and returns completion JWT", async () => {
  const originalDigest = assetUploadDeps.digestSha256;
  try {
    // We need to mock crypto.subtle.digest for hash computation
    const mockDigest = async () => new ArrayBuffer(32);
    assetUploadDeps.digestSha256 = mockDigest as typeof assetUploadDeps.digestSha256;

    // Client returns one hash that needs uploading
    const mockClient = {
      fetch: async () => ({
        result: {
          jwt: "session-jwt",
          buckets: [["00000000000000000000000000000000"]],
        },
        success: true,
        errors: [],
        messages: [],
      }),
    } as unknown as WfpClient;

    // Mock global fetch for the upload call
    const fetchMock = spy(async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: { jwt: "completion-jwt" },
          errors: [],
          messages: [],
        }),
        { status: 200 },
      )
    );
    (globalThis as any).fetch = fetchMock;

    const config: WFPConfig = {
      accountId: "a",
      apiToken: "t",
      dispatchNamespace: "ns",
    };
    const content = new TextEncoder().encode("test").buffer as ArrayBuffer;

    const jwt = await uploadAllAssets(mockClient, config, "w", [
      { path: "index.html", content },
    ]);

    assertEquals(jwt, "completion-jwt");
  } finally {
    assetUploadDeps.digestSha256 = originalDigest;
  }
});
