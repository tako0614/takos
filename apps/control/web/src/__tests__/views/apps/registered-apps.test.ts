import { assertEquals } from "jsr:@std/assert";
import { createRoot, createSignal } from "solid-js";
import {
  clearRegisteredAppsCacheForTests,
  formatAppStatusLabel,
  formatAppTypeLabel,
  getAppIconImageSrc,
  getAppStatusVariant,
  loadRegisteredApps,
  type RegisteredApp,
  useRegisteredApps,
} from "../../../views/apps/registered-apps.ts";

function makeRegisteredApp(overrides: Partial<RegisteredApp> = {}) {
  return {
    id: "app-1",
    name: "Docs",
    description: "Docs app",
    icon: "D",
    app_type: "custom",
    url: "/apps/docs",
    space_id: "space-123",
    space_name: "Personal",
    service_hostname: "docs.example.com",
    service_status: "deployed",
    source_type: "manifest",
    group_id: "group-docs",
    publication_name: "docs-ui",
    category: "office",
    sort_order: 10,
    ...overrides,
  } satisfies RegisteredApp;
}

function appsResponse(apps: RegisteredApp[]): Response {
  return new Response(JSON.stringify({ apps }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 10; index++) {
    if (predicate()) return;
    await nextTick();
  }
}

Deno.test(
  "registered apps - requests the current space inventory with the space header",
  async () => {
    let capturedHeaders: HeadersInit | undefined;

    const apps = await loadRegisteredApps("space-123", async (_input, init) => {
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          apps: [makeRegisteredApp()],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    assertEquals(
      new Headers(capturedHeaders).get("X-Takos-Space-Id"),
      "space-123",
    );
    assertEquals(apps, [makeRegisteredApp()]);
  },
);

Deno.test("registered apps - formats app labels and status variants", () => {
  assertEquals(formatAppTypeLabel("platform"), "Platform");
  assertEquals(formatAppTypeLabel("custom"), "Custom");
  assertEquals(formatAppStatusLabel("pending_queue"), "Pending Queue");
  assertEquals(getAppStatusVariant("deployed"), "success");
  assertEquals(getAppStatusVariant("failed"), "error");
  assertEquals(getAppStatusVariant("pending_queue"), "warning");
});

Deno.test("registered apps - treats safe icon URLs as images", () => {
  assertEquals(
    getAppIconImageSrc("https://cdn.example.com/apps/docs.png"),
    "https://cdn.example.com/apps/docs.png",
  );
  assertEquals(getAppIconImageSrc("/icons/docs.svg"), "/icons/docs.svg");
  assertEquals(getAppIconImageSrc("Docs"), null);
  assertEquals(getAppIconImageSrc("//cdn.example.com/apps/docs.png"), null);
  assertEquals(getAppIconImageSrc("javascript:alert(1)"), null);
  assertEquals(getAppIconImageSrc("data:image/svg+xml,<svg />"), null);
});

Deno.test(
  "registered apps - keeps cached apps visible while revalidating",
  async () => {
    clearRegisteredAppsCacheForTests();
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    let resolveSecondFetch: (() => void) | undefined;

    globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
      fetchCount++;
      if (fetchCount === 1) {
        return Promise.resolve(appsResponse([makeRegisteredApp()]));
      }
      return new Promise<Response>((resolve) => {
        resolveSecondFetch = () =>
          resolve(appsResponse([makeRegisteredApp({ name: "Docs Updated" })]));
      });
    }) as typeof fetch;

    try {
      let disposeFirst: (() => void) | undefined;
      let first: ReturnType<typeof useRegisteredApps> | undefined;
      createRoot((dispose) => {
        disposeFirst = dispose;
        const [spaceId] = createSignal("space-123");
        first = useRegisteredApps(spaceId);
      });

      await waitFor(() => first?.apps().length === 1);
      assertEquals(first?.apps().map((app) => app.name), ["Docs"]);
      disposeFirst?.();

      let disposeSecond: (() => void) | undefined;
      let second: ReturnType<typeof useRegisteredApps> | undefined;
      createRoot((dispose) => {
        disposeSecond = dispose;
        const [spaceId] = createSignal("space-123");
        second = useRegisteredApps(spaceId);
      });

      assertEquals(second?.apps().map((app) => app.name), ["Docs"]);
      assertEquals(second?.loading(), false);
      await nextTick();
      assertEquals(second?.apps().map((app) => app.name), ["Docs"]);
      assertEquals(second?.loading(), false);

      resolveSecondFetch?.();
      await waitFor(() => second?.apps()[0]?.name === "Docs Updated");
      assertEquals(second?.apps().map((app) => app.name), ["Docs Updated"]);

      disposeSecond?.();
    } finally {
      globalThis.fetch = originalFetch;
      clearRegisteredAppsCacheForTests();
    }
  },
);
