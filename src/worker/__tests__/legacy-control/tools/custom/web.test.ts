import type { ToolContext } from "@/tools/types";
import type { Env } from "@/types";
import { createMockEnv } from "../../../../test/integration/setup.ts";

// Mock the isPrivateIP validation
// [Deno] vi.mock removed - manually stub imports from '@takos/worker-platform-utils/validation'
import { WEB_FETCH, WEB_TOOLS, webFetchHandler } from "@/tools/custom/web";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";
import { noopDep } from "@test/dep-stubs";

type FetchFn = typeof globalThis.fetch;
type EgressFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: ["egress.http"],
    env: createMockEnv({
      TAKOS_EGRESS: {
        fetch: (...args: Parameters<EgressFetchFn>) => mockEgressFetch(...args),
      },
    }),
    db: noopSqlDatabaseBinding(),
    setSessionId: noopDep<ToolContext["setSessionId"]>("setSessionId"),
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: noopDep<
      ToolContext["setLastContainerStartFailure"]
    >("setLastContainerStartFailure"),
    ...overrides,
  };
}

let mockEgressFetch: EgressFetchFn = () =>
  Promise.resolve(mockOkResponse("OK", "text/plain"));

function setEgressFetch(fn: EgressFetchFn): void {
  mockEgressFetch = fn;
}

/** Stub globalThis.fetch to always return a DNS-JSON response that resolves
 * to a public IP. Used as the default DNS resolver mock for web tests. */
function stubPublicDnsResolution(): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          Status: 0,
          Answer: [{ type: 1, data: "93.184.216.34" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/dns-json" },
        },
      ),
    )) as FetchFn;
}

function setGlobalFetch(fn: FetchFn): void {
  globalThis.fetch = fn;
}

function _makeReadableStream(text: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

function mockOkResponse(body: string, contentType = "text/html"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("web tools - WEB_FETCH definition - has correct name and required params", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  assertEquals(WEB_FETCH.name, "web_fetch");
  assertEquals(WEB_FETCH.category, "web");
  assertEquals(WEB_FETCH.parameters.required, ["url"]);
});
Deno.test("web tools - WEB_FETCH definition - has extract enum options", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const extractParam = WEB_FETCH.parameters.properties.extract;
  assertEquals(extractParam.enum, ["text", "main", "links"]);
});
Deno.test("web tools - WEB_TOOLS - exports web_fetch", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  assertEquals(WEB_TOOLS.length, 1);
  assertEquals(WEB_TOOLS[0].name, "web_fetch");
});
Deno.test("web tools - webFetchHandler - throws on invalid URL", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  await assertRejects(async () => {
    await webFetchHandler({ url: "not-a-url" }, makeContext());
  }, "Invalid URL format");
});
Deno.test("web tools - webFetchHandler - throws on non-HTTP protocol", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  await assertRejects(async () => {
    await webFetchHandler({ url: "ftp://example.com/file" }, makeContext());
  }, "Only HTTP/HTTPS URLs are allowed");
});
Deno.test("web tools - webFetchHandler - throws on URLs with credentials", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  await assertRejects(async () => {
    await webFetchHandler(
      { url: "https://user:pass@example.com/" },
      makeContext(),
    );
  }, "credentials are not allowed");
});
Deno.test("web tools - webFetchHandler - throws on non-standard ports", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  await assertRejects(async () => {
    await webFetchHandler({ url: "https://example.com:8080/" }, makeContext());
  }, "Port 8080 is not allowed");
});
Deno.test("web tools - webFetchHandler - throws when accessing localhost", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  await assertRejects(async () => {
    await webFetchHandler({ url: "http://localhost/" }, makeContext());
  }, "internal/private");
});
Deno.test("web tools - webFetchHandler - throws when accessing private IP addresses", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  await assertRejects(async () => {
    await webFetchHandler({ url: "http://192.168.1.1/" }, makeContext());
  }, "internal/private");
});
Deno.test("web tools - webFetchHandler - throws when egress proxy is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const ctx = makeContext({ env: {} as Env });
  // Stub fetch to resolve DNS to a public IP
  stubPublicDnsResolution();

  await assertRejects(async () => {
    await webFetchHandler({ url: "https://example.com/" }, ctx);
  }, "Egress proxy not configured");
});
Deno.test("web tools - webFetchHandler - returns deprecation message for render mode", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  // Mock DNS to not block
  stubPublicDnsResolution();

  const ctx = makeContext();
  const result = await webFetchHandler(
    { url: "https://example.com/", render: true },
    ctx,
  );

  assertStringIncludes(result, "no longer supported");
  assertStringIncludes(result, "core Takos");
});
Deno.test("web tools - webFetchHandler - fetches and returns JSON content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const ctx = makeContext();
  setEgressFetch(() =>
    Promise.resolve(mockOkResponse('{"key": "value"}', "application/json"))
  );

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://api.example.com/data" },
    ctx,
  );

  assertStringIncludes(result, '"key"');
  assertStringIncludes(result, '"value"');
});
Deno.test("web tools - webFetchHandler - fetches and returns plain text content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const ctx = makeContext();
  setEgressFetch(() =>
    Promise.resolve(mockOkResponse("Hello world", "text/plain"))
  );

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://example.com/readme.txt" },
    ctx,
  );

  assertEquals(result, "Hello world");
});
Deno.test("web tools - webFetchHandler - extracts links from HTML", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const html = `
        <html><body>
          <a href="https://example.com/page1">Page 1</a>
          <a href="/page2">Page 2</a>
          <a href="#anchor">Anchor</a>
          <a href="javascript:void(0)">JS</a>
        </body></html>
  `;

  const ctx = makeContext();
  setEgressFetch(() => Promise.resolve(mockOkResponse(html, "text/html")));

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://example.com/", extract: "links" },
    ctx,
  );

  assertStringIncludes(result, "Found");
  assertStringIncludes(result, "Page 1");
  assertStringIncludes(result, "page2");
  // # and javascript: links should be excluded
  assert(!result.includes("Anchor"));
});
Deno.test("web tools - webFetchHandler - handles redirect responses", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const ctx = makeContext();
  setEgressFetch(() =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/new-page" },
      }),
    )
  );

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://example.com/old" },
    ctx,
  );

  assertStringIncludes(result, "redirects to");
  assertStringIncludes(result, "https://example.com/new-page");
});
Deno.test("web tools - webFetchHandler - rejects when content-length exceeds limit", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const ctx = makeContext();
  setEgressFetch(() =>
    Promise.resolve(
      new Response("", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": String(30 * 1024 * 1024), // 30MB
        },
      }),
    )
  );

  stubPublicDnsResolution();

  await assertRejects(async () => {
    await webFetchHandler({ url: "https://example.com/large" }, ctx);
  }, "Response too large");
});
Deno.test("web tools - webFetchHandler - throws on non-ok HTTP responses with details", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const ctx = makeContext();
  setEgressFetch(() =>
    Promise.resolve(
      new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/plain" },
      }),
    )
  );

  stubPublicDnsResolution();

  await assertRejects(async () => {
    await webFetchHandler({ url: "https://example.com/missing" }, ctx);
  }, "Failed to fetch: 404");
});
Deno.test("web tools - webFetchHandler - blocks access to metadata.google.internal", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  await assertRejects(async () => {
    await webFetchHandler(
      { url: "http://metadata.google.internal/computeMetadata/v1/" },
      makeContext(),
    );
  }, "internal/private");
});
Deno.test("web tools - webFetchHandler - extracts main content from HTML with <main> tag", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const html = `
        <html>
          <head><title>Test</title></head>
          <body>
            <nav>Navigation bar</nav>
            <main><p>This is the main content of the page.</p></main>
            <footer>Footer info</footer>
          </body>
        </html>
  `;

  const ctx = makeContext();
  setEgressFetch(() => Promise.resolve(mockOkResponse(html, "text/html")));

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://example.com/", extract: "main" },
    ctx,
  );

  assertStringIncludes(result, "main content of the page");
  // Navigation and footer should not be in the extracted main content
  // (though extractAllText removes tags, main content matching means only inner content)
});
Deno.test("web tools - webFetchHandler - extracts main content from HTML with <article> tag when no <main>", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const html = `
        <html>
          <body>
            <div>Sidebar stuff</div>
            <article><h2>Article Title</h2><p>Article body text here.</p></article>
          </body>
        </html>
  `;

  const ctx = makeContext();
  setEgressFetch(() => Promise.resolve(mockOkResponse(html, "text/html")));

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://example.com/", extract: "main" },
    ctx,
  );

  assertStringIncludes(result, "Article Title");
  assertStringIncludes(result, "Article body text here");
});
Deno.test("web tools - webFetchHandler - falls back to body when no main/article/content div", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const html = `
        <html>
          <body>
            <div><p>Just some body content here.</p></div>
          </body>
        </html>
  `;

  const ctx = makeContext();
  setEgressFetch(() => Promise.resolve(mockOkResponse(html, "text/html")));

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://example.com/", extract: "main" },
    ctx,
  );

  assertStringIncludes(result, "body content here");
});
Deno.test('web tools - webFetchHandler - extracts all text from HTML via extract="text"', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const html = `
        <html>
          <head><title>Title</title><style>body{color:red}</style></head>
          <body>
            <script>console.log('hidden');</script>
            <h1>Heading</h1>
            <p>Paragraph text.</p>
          </body>
        </html>
  `;

  const ctx = makeContext();
  setEgressFetch(() => Promise.resolve(mockOkResponse(html, "text/html")));

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://example.com/", extract: "text" },
    ctx,
  );

  assertStringIncludes(result, "Heading");
  assertStringIncludes(result, "Paragraph text");
  // Script and style content should be stripped
  assert(!result.includes("console.log"));
  assert(!result.includes("color:red"));
});
Deno.test("web tools - webFetchHandler - decodes HTML entities in extracted text", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const html = `
        <html><body>
          <p>Tom &amp; Jerry &lt;3 each other. &quot;Hello&quot; said he&#39;s friend.</p>
          <p>Price:&nbsp;$10</p>
        </body></html>
  `;

  const ctx = makeContext();
  setEgressFetch(() => Promise.resolve(mockOkResponse(html, "text/html")));

  stubPublicDnsResolution();

  const result = await webFetchHandler(
    { url: "https://example.com/", extract: "text" },
    ctx,
  );

  assertStringIncludes(result, "Tom & Jerry");
  assertStringIncludes(result, "<3");
  assertStringIncludes(result, '"Hello"');
  assertStringIncludes(result, "he's friend");
  assertStringIncludes(result, "Price: $10");
});
Deno.test("web tools - webFetchHandler - follows CNAME records and blocks private CNAME targets", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  // DNS resolution returns a CNAME pointing to a blocked domain
  setGlobalFetch(
    ((url: string | URL) => {
      const u = new URL(url);
      const name = u.searchParams.get("name");
      const type = u.searchParams.get("type");

      if (name === "evil.example.com" && type === "CNAME") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{ type: 5, data: "localhost" }],
            }),
            {
              status: 200,
              headers: { "content-type": "application/dns-json" },
            },
          ),
        );
      }

      // A and AAAA queries return empty
      return Promise.resolve(
        new Response(
          JSON.stringify({
            Status: 0,
            Answer: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/dns-json" },
          },
        ),
      );
    }) as FetchFn,
  );

  await assertRejects(async () => {
    await webFetchHandler({ url: "https://evil.example.com/" }, makeContext());
  }, "CNAME points to internal/private domain");
});
Deno.test("web tools - webFetchHandler - follows CNAME chain to resolve final IPs", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  // CNAME chain: target.example.com -> cdn.example.net -> 93.184.216.34
  setGlobalFetch(
    ((url: string | URL) => {
      const u = new URL(url);
      const name = u.searchParams.get("name");
      const type = u.searchParams.get("type");

      if (name === "target.example.com" && type === "CNAME") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{ type: 5, data: "cdn.example.net" }],
            }),
            {
              status: 200,
              headers: { "content-type": "application/dns-json" },
            },
          ),
        );
      }

      if (name === "cdn.example.net" && type === "A") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{ type: 1, data: "93.184.216.34" }],
            }),
            {
              status: 200,
              headers: { "content-type": "application/dns-json" },
            },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            Status: 0,
            Answer: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/dns-json" },
          },
        ),
      );
    }) as FetchFn,
  );

  const ctx = makeContext();
  setEgressFetch(() =>
    Promise.resolve(
      mockOkResponse("<html><body>OK</body></html>", "text/html"),
    )
  );

  // Should not throw — CNAME chain resolves to a public IP
  const result = await webFetchHandler(
    { url: "https://target.example.com/" },
    ctx,
  );
  assert(result !== undefined);
});
Deno.test("web tools - webFetchHandler - blocks CNAME that resolves to a private IP", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  setGlobalFetch(
    ((url: string | URL) => {
      const u = new URL(url);
      const name = u.searchParams.get("name");
      const type = u.searchParams.get("type");

      if (name === "sneaky.example.com" && type === "CNAME") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{ type: 5, data: "internal-host.example.com" }],
            }),
            {
              status: 200,
              headers: { "content-type": "application/dns-json" },
            },
          ),
        );
      }

      if (name === "internal-host.example.com" && type === "A") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{ type: 1, data: "10.0.0.1" }],
            }),
            {
              status: 200,
              headers: { "content-type": "application/dns-json" },
            },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            Status: 0,
            Answer: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/dns-json" },
          },
        ),
      );
    }) as FetchFn,
  );

  await assertRejects(async () => {
    await webFetchHandler(
      { url: "https://sneaky.example.com/" },
      makeContext(),
    );
  }, "Resolved to private/internal IP address");
});
Deno.test("web tools - webFetchHandler - throws when streaming body exceeds size limit", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock global fetch for DNS resolution — must return a fresh Response each time
  // because Response.body can only be consumed once
  stubPublicDnsResolution();
  const ctx = makeContext();
  mockEgressFetch = async () => response;

  // Create a response that streams more than MAX_RESPONSE_SIZE (25MB)
  // We create chunks that add up to > 25MB
  const chunkSize = 1024 * 1024; // 1MB per chunk
  const totalChunks = 26; // 26MB total
  let chunkIndex = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunkIndex < totalChunks) {
        controller.enqueue(new Uint8Array(chunkSize));
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });

  const response = new Response(stream, {
    status: 200,
    headers: { "content-type": "text/html" },
  });

  stubPublicDnsResolution();

  await assertRejects(
    async () => {
      await webFetchHandler({ url: "https://example.com/huge" }, ctx);
    },
    Error,
    "Response too large",
  );
});
