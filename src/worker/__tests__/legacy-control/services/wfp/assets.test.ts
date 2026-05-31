import {
  assetUploadDeps,
  type AssetUploadFile,
  createAssetsUploadSession,
  uploadAllAssets,
  uploadAssets,
} from "@/services/wfp/assets";
import type {
  CFAPIResponse,
  WFPConfig,
  WfpFetcher,
} from "@/services/wfp/client";

// ---------------------------------------------------------------------------
// createAssetsUploadSession
// ---------------------------------------------------------------------------

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch =
    originalFetch;
}

Deno.test("createAssetsUploadSession - returns jwt and flattened uploadNeeded from buckets", async () => {
  const fetchSpy = spy(async (_path?: string) =>
    ({
      result: {
        jwt: "session-jwt-token",
        buckets: [["hash1", "hash2"], ["hash3"]],
      },
      success: true,
      errors: [] as Array<{ code: number; message: string }>,
      messages: [] as string[],
    }) satisfies CFAPIResponse<{ jwt: string; buckets: string[][] }>
  );
  const mockClient: WfpFetcher = {
    fetch: fetchSpy as WfpFetcher["fetch"],
  };

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
  const fetchSpy = spy(async (_path?: string) =>
    ({
      result: { jwt: "token" },
      success: true,
      errors: [] as Array<{ code: number; message: string }>,
      messages: [] as string[],
    }) satisfies CFAPIResponse<{ jwt: string }>
  );
  const mockClient: WfpFetcher = {
    fetch: fetchSpy as WfpFetcher["fetch"],
  };

  const config: WFPConfig = {
    accountId: "a",
    apiToken: "t",
    dispatchNamespace: "ns",
  };
  const result = await createAssetsUploadSession(mockClient, config, "w", {});
  assertEquals(result.uploadNeeded, []);
});
Deno.test("createAssetsUploadSession - calls the correct API path", async () => {
  const fetchSpy = spy(async (_path: string) =>
    ({
      result: { jwt: "x" },
      success: true,
      errors: [] as Array<{ code: number; message: string }>,
      messages: [] as string[],
    }) satisfies CFAPIResponse<{ jwt: string }>
  );
  const mockClient: WfpFetcher = {
    fetch: fetchSpy as WfpFetcher["fetch"],
  };
  const config: WFPConfig = {
    accountId: "acc-1",
    apiToken: "t",
    dispatchNamespace: "ns-1",
  };

  await createAssetsUploadSession(mockClient, config, "my-worker", {});

  assertSpyCalls(fetchSpy, 1);
  const path = fetchSpy.calls[0].args[0];
  assertStringIncludes(path, "/accounts/acc-1/");
  assertStringIncludes(path, "/scripts/my-worker/assets-upload-session");
});
// ---------------------------------------------------------------------------
// uploadAssets
// ---------------------------------------------------------------------------

Deno.test("uploadAssets - posts FormData to the upload endpoint and returns completion JWT", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
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
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

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
    const [url, init] = fetchMock.calls[0].args as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    assertStringIncludes(url, "/accounts/acc-1/workers/assets/upload");
    assertEquals(init.method, "POST");
    assertEquals(headers.Authorization, "Bearer session-jwt");
  } finally {
    restoreFetch();
  }
});
Deno.test("uploadAssets - throws on non-ok response", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      new Response("Internal Server Error", { status: 500 })
    );
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const config: WFPConfig = {
      accountId: "a",
      apiToken: "t",
      dispatchNamespace: "ns",
    };
    await assertRejects(async () => {
      await uploadAssets(config, "jwt", {});
    }, "Assets upload failed");
  } finally {
    restoreFetch();
  }
});
Deno.test("uploadAssets - throws when response is ok but missing completion JWT", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      new Response(JSON.stringify({ success: false, result: {} }), {
        status: 200,
      })
    );
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const config: WFPConfig = {
      accountId: "a",
      apiToken: "t",
      dispatchNamespace: "ns",
    };
    await assertRejects(async () => {
      await uploadAssets(config, "jwt", {});
    }, "no completion JWT");
  } finally {
    restoreFetch();
  }
});
Deno.test("uploadAssets - throws timeout error on abort", async () => {
  try {
    const fetchMock = spy(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const config: WFPConfig = {
      accountId: "a",
      apiToken: "t",
      dispatchNamespace: "ns",
    };
    await assertRejects(async () => {
      await uploadAssets(config, "jwt", {});
    }, "timeout");
  } finally {
    restoreFetch();
  }
});
// ---------------------------------------------------------------------------
// uploadAllAssets
// ---------------------------------------------------------------------------

Deno.test("uploadAllAssets - returns session JWT directly when all assets are cached", async () => {
  try {
    const fetchSpy = spy(async (_path?: string) =>
      ({
        result: { jwt: "cached-jwt", buckets: [] as string[][] },
        success: true,
        errors: [] as Array<{ code: number; message: string }>,
        messages: [] as string[],
      }) satisfies CFAPIResponse<{ jwt: string; buckets: string[][] }>
    );
    const mockClient: WfpFetcher = {
      fetch: fetchSpy as WfpFetcher["fetch"],
    };

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
    restoreFetch();
  }
});
Deno.test("uploadAllAssets - uploads needed files and returns completion JWT", async () => {
  const originalDigest = assetUploadDeps.digestSha256;
  try {
    // We need to mock crypto.subtle.digest for hash computation
    const mockDigest = async () => new ArrayBuffer(32);
    assetUploadDeps.digestSha256 =
      mockDigest as typeof assetUploadDeps.digestSha256;

    // Client returns one hash that needs uploading
    const sessionResponse = {
      result: {
        jwt: "session-jwt",
        buckets: [["00000000000000000000000000000000"]],
      },
      success: true,
      errors: [] as Array<{ code: number; message: string }>,
      messages: [] as string[],
    } satisfies CFAPIResponse<{ jwt: string; buckets: string[][] }>;
    const sessionFetch = (_path?: string) => Promise.resolve(sessionResponse);
    const mockClient: WfpFetcher = {
      fetch: sessionFetch as WfpFetcher["fetch"],
    };

    // Mock global fetch for the upload call
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
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
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

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
    restoreFetch();
  }
});
