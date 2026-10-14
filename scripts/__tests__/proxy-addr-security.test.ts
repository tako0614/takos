import { expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { type AddressInfo } from "node:net";

// Resolve from the production dependency owner so these tests exercise the
// Express/proxy-addr instance used by the installed MCP SDK, including nesting.
const requireFromSdk = createRequire(
  import.meta.resolve("@modelcontextprotocol/sdk/server/streamableHttp.js"),
);
const { rateLimit, MemoryStore } = requireFromSdk("express-rate-limit") as
  typeof import("express-rate-limit");

type Request = IncomingMessage & { ip: string; ips: string[] };
type Response = ServerResponse & { json(body: unknown): void };
type ExpressApp = {
  (request: IncomingMessage, response: ServerResponse): void;
  set(name: string, value: unknown): void;
  use(handler: unknown): void;
  get(path: string, handler: (request: Request, response: Response) => void): void;
};
const express = requireFromSdk("express") as () => ExpressApp;

async function withApp(
  trust: string[],
  run: (url: string) => Promise<void>,
  limit?: number,
): Promise<void> {
  const app = express();
  app.set("trust proxy", trust);
  const store = limit === undefined ? undefined : new MemoryStore();
  if (store) {
    app.use(rateLimit({ windowMs: 60_000, limit, store }));
  }
  app.get("/ip", (request, response) => {
    response.json({ ip: request.ip, ips: request.ips });
  });
  const server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    store?.shutdown();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

test("an IPv4 client cannot spoof Express IP through a short IPv4-mapped trust subnet", async () => {
  // GHSA-jqcg-44mw-7w3h: /8 omits the IPv4-mapped marker; it must not trust
  // every IPv4 socket and thereby believe attacker-controlled forwarded IPs.
  await withApp(["::ffff:10.0.0.0/8"], async (url) => {
    const response = await fetch(`${url}/ip`, {
      headers: { "X-Forwarded-For": "203.0.113.23, 10.1.2.3" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ip: "127.0.0.1", ips: [] });
  });
});

test("an IPv4 client cannot spoof Express IP through a zero-leading IPv6 trust subnet", async () => {
  await withApp(["::/1"], async (url) => {
    const response = await fetch(`${url}/ip`, {
      headers: { "X-Forwarded-For": "203.0.113.23" },
    });
    expect(await response.json()).toEqual({ ip: "127.0.0.1", ips: [] });
  });
});

test("Express preserves socket IP without forwarding and ignores forwarding from an untrusted socket", async () => {
  await withApp(["10.0.0.0/8"], async (url) => {
    const forwardedHeaders: HeadersInit[] = [
      {},
      { "X-Forwarded-For": "203.0.113.23" },
    ];
    for (const headers of forwardedHeaders) {
      const response = await fetch(`${url}/ip`, { headers });
      expect(await response.json()).toEqual({ ip: "127.0.0.1", ips: [] });
    }
  });
});

test("valid IPv4 and fully mapped trust subnets preserve trusted hops and stop at the first untrusted IP", async () => {
  for (const trust of [
    ["127.0.0.0/8", "10.0.0.0/8"],
    ["::ffff:127.0.0.0/104", "::ffff:10.0.0.0/104"],
  ]) {
    await withApp(trust, async (url) => {
      const response = await fetch(`${url}/ip`, {
        headers: {
          "X-Forwarded-For": "198.51.100.77, 203.0.113.23, 10.1.2.3",
        },
      });
      expect(await response.json()).toEqual({
        ip: "203.0.113.23",
        ips: ["203.0.113.23", "10.1.2.3"],
      });
    });
  }
});

test("rotating spoofed forwarded IPs cannot evade an IPv4 client's rate limit", async () => {
  await withApp(["::ffff:10.0.0.0/8"], async (url) => {
    for (const spoofedIp of ["203.0.113.23", "203.0.113.24"]) {
      const response = await fetch(`${url}/ip`, {
        headers: { "X-Forwarded-For": spoofedIp },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ip: "127.0.0.1", ips: [] });
    }
    const blocked = await fetch(`${url}/ip`, {
      headers: { "X-Forwarded-For": "203.0.113.25" },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    await blocked.text();
  }, 2);
});

test("legitimate clients behind a trusted proxy retain independent rate-limit budgets", async () => {
  await withApp(["127.0.0.0/8"], async (url) => {
    for (const clientIp of ["203.0.113.23", "203.0.113.24", "203.0.113.23"]) {
      const response = await fetch(`${url}/ip`, {
        headers: { "X-Forwarded-For": clientIp },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ip: clientIp, ips: [clientIp] });
    }
    const blocked = await fetch(`${url}/ip`, {
      headers: { "X-Forwarded-For": "203.0.113.23" },
    });
    expect(blocked.status).toBe(429);
    await blocked.text();
    const otherClient = await fetch(`${url}/ip`, {
      headers: { "X-Forwarded-For": "203.0.113.24" },
    });
    expect(otherClient.status).toBe(200);
    expect(await otherClient.json()).toEqual({
      ip: "203.0.113.24",
      ips: ["203.0.113.24"],
    });
  }, 2);
});
