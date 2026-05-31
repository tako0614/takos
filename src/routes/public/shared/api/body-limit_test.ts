import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import {
  bodyLimitMiddleware,
  DEFAULT_BODY_LIMIT_BYTES,
  DEPLOY_BODY_LIMIT_BYTES,
  evaluateBodyLimit,
  GIT_SMART_HTTP_BODY_LIMIT_BYTES,
} from "./body-limit.ts";

Deno.test("evaluateBodyLimit allows non-body methods regardless of Content-Length", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "DELETE"]) {
    const decision = evaluateBodyLimit(
      new Request("https://t.local/x", { method }),
      { maxBytes: 16 },
    );
    assertEquals(decision.ok, true);
  }
});

Deno.test("evaluateBodyLimit allows POST without Content-Length by default", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", { method: "POST" }),
    { maxBytes: 16 },
  );
  assertEquals(decision.ok, true);
});

Deno.test("evaluateBodyLimit rejects missing Content-Length in strict mode", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", { method: "POST" }),
    { maxBytes: 16, requireContentLength: true },
  );
  assertEquals(decision.ok, false);
  if (!decision.ok) {
    assertEquals(decision.reason, "body_length_required");
  }
});

Deno.test("evaluateBodyLimit rejects oversize Content-Length", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "100" },
      body: "x".repeat(100),
    }),
    { maxBytes: 16 },
  );
  assertEquals(decision.ok, false);
  if (!decision.ok) {
    assertEquals(decision.reason, "body_too_large");
    assertEquals(decision.declared, 100);
    assertEquals(decision.limit, 16);
  }
});

Deno.test("bodyLimitMiddleware returns closed-envelope 413", async () => {
  const app = new Hono();
  app.use("*", bodyLimitMiddleware({ maxBytes: 8 }));
  app.post("/x", (c) => c.json({ ok: true }));
  const res = await app.fetch(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "32" },
      body: "x".repeat(32),
    }),
  );
  assertEquals(res.status, 413);
  const json = await res.json() as {
    error: { code: string; message: string };
  };
  assertEquals(json.error.code, "body_too_large");
});

Deno.test("bodyLimitMiddleware supports per-request resolver", async () => {
  const app = new Hono();
  app.use(
    "*",
    bodyLimitMiddleware((request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/big")) {
        return { maxBytes: 1024 };
      }
      return { maxBytes: 8 };
    }),
  );
  app.post("/big", (c) => c.json({ ok: true }));
  app.post("/small", (c) => c.json({ ok: true }));

  const big = await app.fetch(
    new Request("https://t.local/big", {
      method: "POST",
      headers: { "content-length": "512" },
      body: "x".repeat(512),
    }),
  );
  assertEquals(big.status, 200);

  const small = await app.fetch(
    new Request("https://t.local/small", {
      method: "POST",
      headers: { "content-length": "32" },
      body: "x".repeat(32),
    }),
  );
  assertEquals(small.status, 413);
});

function chunkedRequest(url: string, chunks: Uint8Array[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request(url, {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex required for stream bodies, not in lib typings
    duplex: "half",
  });
}

Deno.test("bodyLimitMiddleware caps a chunked (no Content-Length) oversize body", async () => {
  const app = new Hono();
  app.use("*", bodyLimitMiddleware({ maxBytes: 8 }));
  app.post("/x", async (c) => {
    // Consuming the capped stream past the limit must surface as an error,
    // not a silently-accepted oversize body.
    await c.req.raw.arrayBuffer();
    return c.json({ ok: true });
  });

  const big = new Uint8Array(64);
  const res = await app.fetch(chunkedRequest("https://t.local/x", [big]));
  // The stream errors while being read; Hono surfaces it as a 500 rather than
  // accepting the oversize body. The key assertion is that the handler does
  // NOT return its 200 ok-body.
  const text = await res.text();
  assertEquals(text.includes('"ok":true'), false);
});

Deno.test("bodyLimitMiddleware lets a chunked under-cap body through", async () => {
  const app = new Hono();
  app.use("*", bodyLimitMiddleware({ maxBytes: 64 }));
  app.post("/x", async (c) => {
    const buf = await c.req.raw.arrayBuffer();
    return c.json({ size: buf.byteLength });
  });

  const small = new Uint8Array(8);
  const res = await app.fetch(chunkedRequest("https://t.local/x", [small]));
  assertEquals(res.status, 200);
  const json = await res.json() as { size: number };
  assertEquals(json.size, 8);
});

Deno.test("body-limit constants stay within expected envelopes", () => {
  assertEquals(DEFAULT_BODY_LIMIT_BYTES, 1 * 1024 * 1024);
  assertEquals(DEPLOY_BODY_LIMIT_BYTES, 8 * 1024 * 1024);
  assertEquals(GIT_SMART_HTTP_BODY_LIMIT_BYTES, 256 * 1024 * 1024);
});
