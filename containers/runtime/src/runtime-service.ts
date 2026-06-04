import { Hono } from "hono";

/**
 * Minimal HTTP service that runs inside the TakosRuntimeContainer image.
 *
 * The unified takos Worker hosts this container as a Cloudflare Container
 * (Durable Object sidecar) and forwards runtime-host requests to it. This is
 * the container-side process: it exposes a health endpoint and otherwise
 * answers 503 until a self-hoster wires in their own runtime workload.
 */
export type RuntimeServiceOptions = {
  port?: number;
  serviceName?: string;
};

type BunLike = {
  serve(options: {
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }): unknown;
};

function bunLike(): BunLike {
  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) {
    throw new Error("Bun runtime is required to start the takos runtime container");
  }
  return bun;
}

export function startRuntimeService(options: RuntimeServiceOptions = {}) {
  const serviceName = options.serviceName ?? "takos-runtime";
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: serviceName }));
  app.all("*", (c) =>
    c.json({
      error:
        "takos runtime container has no workload wired in; provide your own runtime service for this image",
    }, 503));

  const server = bunLike().serve({
    port: options.port ?? 8080,
    fetch: (request) => app.fetch(request),
  });
  return { app, server };
}
