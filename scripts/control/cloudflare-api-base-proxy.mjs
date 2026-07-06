#!/usr/bin/env bun
import process from "node:process";

const targetBase = requiredEnv("TAKOS_CLOUDFLARE_API_PROXY_TARGET_BASE")
  .replace(/\/+$/u, "");
const apiToken = requiredEnv("TAKOS_CLOUDFLARE_API_PROXY_TOKEN");
const contextHeaders = parseContextHeaders(
  process.env.TAKOS_CLOUDFLARE_API_PROXY_CONTEXT_HEADERS,
);
const hostname = process.env.TAKOS_CLOUDFLARE_API_PROXY_HOST ?? "127.0.0.1";
const port = Number.parseInt(
  process.env.TAKOS_CLOUDFLARE_API_PROXY_PORT ?? "0",
  10,
);

const server = Bun.serve({
  hostname,
  port: Number.isFinite(port) && port >= 0 ? port : 0,
  async fetch(request) {
    try {
      return await proxyRequest(request);
    } catch (error) {
      return Response.json(
        {
          success: false,
          errors: [
            {
              code: 9901,
              message: error instanceof Error ? error.message : String(error),
            },
          ],
          messages: [],
          result: null,
        },
        { status: 502 },
      );
    }
  },
});

console.log(
  `TAKOS_CLOUDFLARE_API_PROXY_READY=${JSON.stringify({
    hostname,
    port: server.port,
  })}`,
);

process.on("SIGTERM", () => {
  server.stop(true);
  process.exit(0);
});
process.on("SIGINT", () => {
  server.stop(true);
  process.exit(0);
});

async function proxyRequest(request) {
  const input = new URL(request.url);
  const target = new URL(`${targetBase}${input.pathname}`);
  target.search = input.search;
  const headers = upstreamHeaders(request.headers);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    redirect: "manual",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

function upstreamHeaders(source) {
  const headers = new Headers(source);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("authorization", `Bearer ${apiToken}`);
  for (const [name, value] of Object.entries(contextHeaders)) {
    headers.set(name, value);
  }
  return headers;
}

function parseContextHeaders(raw) {
  if (typeof raw !== "string" || !raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([name, value]) => [
        name.toLowerCase(),
        typeof value === "string" ? value.trim() : "",
      ])
      .filter(([name, value]) => name && value),
  );
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}
