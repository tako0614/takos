import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { bodyLimit } from "./body-size.ts";

function trackedBody(text: string, chunkSize = 8) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.byteLength) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + chunkSize);
      offset += chunk.byteLength;
      pulls += 1;
      controller.enqueue(chunk);
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, get sent() { return offset; }, get cancelled() { return cancelled; }, get pulls() { return pulls; } };
}

function request(method: string, body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request("https://takos.test/body", { method, body, headers, duplex: "half" } as RequestInit & { duplex: "half" });
}

describe("API body limits", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    test(`${method} returns the documented 413 before effects for declared overflow`, async () => {
      const app = new Hono();
      let effects = 0;
      app.use("*", bodyLimit({ maxSize: 16, message: "too large" }));
      app.all("*", async (c) => { await c.req.text(); effects += 1; return c.json({ ok: true }); });
      const body = trackedBody("x".repeat(128));
      const response = await app.fetch(request(method, body.stream, { "Content-Length": "128" }));
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: { code: "PAYLOAD_TOO_LARGE", message: "too large" }, max_size: 16 });
      expect(effects).toBe(0);
      expect(body.sent).toBe(0);
    });

    test(`${method} stops a headerless overflow before a parser catch can hide it`, async () => {
      const app = new Hono();
      let effects = 0;
      app.use("*", bodyLimit({ maxSize: 16 }));
      app.all("*", async (c) => { await c.req.json().catch(() => null); effects += 1; return c.json({ ok: true }); });
      const body = trackedBody("x".repeat(128));
      const response = await app.fetch(request(method, body.stream));
      expect(response.status).toBe(413);
      expect(effects).toBe(0);
      expect(body.cancelled).toBe(true);
      expect(body.sent).toBeLessThan(128);
    });
  }

  test("counts actual bytes even when a portable Request understates its Content-Length", async () => {
    const app = new Hono();
    let effects = 0;
    app.use("*", bodyLimit({ maxSize: 16 }));
    app.delete("*", async (c) => { await c.req.text(); effects += 1; return c.json({ ok: true }); });
    const body = trackedBody("x".repeat(128));
    const response = await app.fetch(request("DELETE", body.stream, { "Content-Length": "1" }));
    expect(response.status).toBe(413);
    expect(effects).toBe(0);
    expect(body.cancelled).toBe(true);
    expect(body.sent).toBeLessThan(128);
  });

  test("allows exact-limit UTF-8 bytes through nested caps and preserves Request metadata", async () => {
    const app = new Hono();
    const controller = new AbortController();
    const text = "雪雪";
    const bytes = new TextEncoder().encode(text);
    app.use("*", bodyLimit({ maxSize: 12 }));
    app.use("*", bodyLimit({ maxSize: bytes.byteLength }));
    app.delete("*", async (c) => {
      const received = new Uint8Array(await c.req.arrayBuffer());
      expect(received).toEqual(bytes);
      expect(c.req.raw.cache).toBe("no-store");
      expect(c.req.raw.mode).toBe("same-origin");
      expect(c.req.header("X-Test")).toBe("kept");
      controller.abort();
      expect(c.req.raw.signal.aborted).toBe(true);
      return c.text("ok");
    });
    const response = await app.fetch(new Request("https://takos.test/body", {
      method: "DELETE", body: text, signal: controller.signal, cache: "no-store", mode: "same-origin", headers: { "X-Test": "kept" },
    }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("counts UTF-8 bytes rather than characters", async () => {
    const app = new Hono();
    let effects = 0;
    app.use("*", bodyLimit({ maxSize: 5 }));
    app.delete("*", async (c) => { await c.req.text(); effects += 1; return c.text("ok"); });
    const response = await app.fetch(new Request("https://takos.test/body", { method: "DELETE", body: "雪雪" }));
    expect(response.status).toBe(413);
    expect(effects).toBe(0);
  });

  test("keeps bodyless DELETE and GET/HEAD/OPTIONS available", async () => {
    const app = new Hono();
    app.use("*", bodyLimit({ maxSize: 1 }));
    app.all("*", (c) => c.text("ok"));
    for (const method of ["DELETE", "GET", "HEAD", "OPTIONS"]) {
      expect((await app.fetch(new Request("https://takos.test/body", { method }))).status).toBe(200);
    }
  });

  test("preserves explicit skipPaths", async () => {
    const app = new Hono();
    app.use("*", bodyLimit({ maxSize: 1, skipPaths: [/^\/body$/] }));
    app.delete("*", async (c) => c.text(await c.req.text()));
    const response = await app.fetch(new Request("https://takos.test/body", { method: "DELETE", body: "allowed by explicit skip" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("allowed by explicit skip");
  });

  test("cancellation failure cannot replace the overflow response", async () => {
    const app = new Hono();
    let effects = 0;
    let cancelled = 0;
    app.use("*", bodyLimit({ maxSize: 1 }));
    app.delete("*", (c) => {
      effects += 1;
      return c.text("unexpected");
    });
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(2)); },
      cancel() {
        cancelled += 1;
        throw new Error("source cancellation failed");
      },
    }, { highWaterMark: 0 });
    const response = await app.fetch(request("DELETE", body));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(1);
    expect(effects).toBe(0);
    expect(body.locked).toBe(false);
  });

  test("keeps Transfer-Encoding precedence while counting the actual stream", async () => {
    const app = new Hono();
    app.use("*", bodyLimit({ maxSize: 2 }));
    app.delete("*", async (c) => c.text(await c.req.text()));
    const response = await app.fetch(request("DELETE", trackedBody("ok").stream, {
      "Content-Length": "128",
      "Transfer-Encoding": "chunked",
    }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
