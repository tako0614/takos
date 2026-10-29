import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

import { staticAssetsMiddleware } from "../static-assets.ts";

// Home-screen install contract. web/public/ is copied into dist/ by Vite and
// shipped as the Worker's ASSETS (deploy/cloudflare/wrangler.toml and the
// OpenTofu artifact's .takos-build/assets).
const PUBLIC_DIR = new URL("../../../../../web/public/", import.meta.url);
const INDEX_HTML = new URL("../../../../../web/index.html", import.meta.url);

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

function publicFile(path: string): Uint8Array<ArrayBuffer> {
  expect(path.startsWith("/")).toBe(true);
  return new Uint8Array(readFileSync(new URL(path.slice(1), PUBLIC_DIR)));
}

function manifest(): { icons: ManifestIcon[] } & Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(publicFile("/manifest.webmanifest")));
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  // PNG signature, then the IHDR chunk: width/height are big-endian u32 at 16/20.
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe("IHDR");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function cspDirectives(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/u);
    if (name) directives.set(name.toLowerCase(), values);
  }
  return directives;
}

// A Cloudflare ASSETS stand-in that labels files the way an OpenTofu runner
// without a mime.types entry for `.webmanifest` would: PNG is known to Go's
// built-in table, the manifest is not.
const assets = {
  fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      return Promise.resolve(
        new Response(publicFile(path), {
          headers: {
            "content-type": path.endsWith(".png")
              ? "image/png"
              : "application/octet-stream",
          },
        }),
      );
    } catch {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
  },
};

function appWithAuthWall(): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("platform" as never, {
      config: {},
      services: { assets: { binding: assets } },
      bindings: {},
    } as never);
    await next();
  });
  app.use("*", staticAssetsMiddleware as never);
  // Stands in for every authenticated route and the SPA fallback.
  app.all("*", (c) => c.json({ error: "unauthenticated" }, 401));
  return app;
}

test("web app manifest declares a standalone same-origin app", () => {
  expect(manifest()).toMatchObject({
    id: "/",
    name: "Takos",
    short_name: "Takos",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#e53935",
    background_color: "#ffffff",
  });
  expect(String(manifest().description).length).toBeGreaterThan(0);
});

test("every declared icon exists at its declared pixel size", () => {
  const icons = manifest().icons;
  expect(icons.map((icon) => `${icon.sizes}:${icon.purpose}`).sort()).toEqual([
    "192x192:any",
    "512x512:any",
    "512x512:maskable",
  ]);
  for (const icon of icons) {
    expect(icon.type).toBe("image/png");
    const [width, height] = icon.sizes.split("x").map(Number);
    expect(pngSize(publicFile(icon.src))).toEqual({ width, height });
  }
});

test("index.html links the manifest and a 180px apple-touch-icon under its CSP", () => {
  const html = readFileSync(INDEX_HTML, "utf8");
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  expect(html).toContain('<meta name="theme-color" content="#E53935">');
  // Existing brand icons keep working.
  expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
  expect(html).toContain('<link rel="icon" type="image/png" href="/logo.png">');
  const touch = /<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)">/u
    .exec(html);
  expect(touch).not.toBeNull();
  expect(pngSize(publicFile(touch![1]!))).toEqual({ width: 180, height: 180 });

  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(
    html,
  );
  expect(meta).not.toBeNull();
  const csp = cspDirectives(meta![1]!);
  expect(csp.get("manifest-src") ?? csp.get("default-src")).toContain("'self'");
  expect(csp.get("img-src") ?? csp.get("default-src")).toContain("'self'");
});

test("static assets serve the manifest and icons anonymously with their types", async () => {
  const app = appWithAuthWall();

  const manifestResponse = await app.request(
    "https://takos.example/manifest.webmanifest",
  );
  expect(manifestResponse.status).toBe(200);
  expect(manifestResponse.headers.get("content-type")).toBe(
    "application/manifest+json; charset=utf-8",
  );
  expect(await manifestResponse.json()).toEqual(manifest());

  const iconPaths = [
    ...new Set(manifest().icons.map((icon) => icon.src)),
    "/apple-touch-icon.png",
  ];
  for (const path of iconPaths) {
    const response = await app.request(`https://takos.example${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      ...publicFile(path),
    ]);
  }

  // The auth wall still answers everything that is not a shipped asset.
  const missing = await app.request("https://takos.example/settings");
  expect(missing.status).toBe(401);
});
