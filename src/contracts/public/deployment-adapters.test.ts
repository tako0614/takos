import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const contract = JSON.parse(
  await readFile(new URL("deploy/product-resources.json", root), "utf8"),
) as {
  apiVersion: string;
  product: string;
  resources: Array<{ name: string; shape: string }>;
  runtimeConnections: Array<{ name: string; resource: string }>;
};
const cloudflareModule = await readFile(
  new URL("deploy/opentofu/cloudflare/modules/platform/main.tf", root),
  "utf8",
);
const cloudflareRuntime = await readFile(
  new URL("deploy/cloudflare/wrangler.toml", root),
  "utf8",
);
const agentDockerfile = await readFile(
  new URL("containers/agent/Dockerfile", root),
  "utf8",
);

test("Takos owns one provider-neutral resource contract", () => {
  expect(contract.apiVersion).toBe("takos.jp/product-resources/v1");
  expect(contract.product).toBe("takos");
  expect(
    new Set(contract.resources.map((resource) => resource.name)).size,
  ).toBe(contract.resources.length);
  const resources = new Set(
    contract.resources.map((resource) => resource.name),
  );
  for (const connection of contract.runtimeConnections) {
    expect(resources.has(connection.resource)).toBe(true);
  }
  expect(JSON.stringify(contract)).not.toMatch(
    /cloudflare|takoform|account_id|api_token/i,
  );
});

test("the current Cloudflare adapter wires every Takos runtime connection", () => {
  for (const connection of contract.runtimeConnections) {
    expect(cloudflareRuntime).toContain(connection.name);
  }
  expect(cloudflareModule).toContain('resource "cloudflare_d1_database"');
  expect(cloudflareModule).toContain('resource "cloudflare_workers_kv_namespace"');
  expect(cloudflareModule).toContain('resource "cloudflare_r2_bucket"');
  expect(cloudflareModule).toContain('resource "cloudflare_queue"');
});

test("the current agent service uses its declared container image", () => {
  expect(agentDockerfile).toContain("ENV PORT=8080");
  expect(agentDockerfile).toContain("EXPOSE 8080");
  expect(cloudflareRuntime).toContain('image = "../../containers/agent/Dockerfile"');
});

test("Takos source imports Takosumi only through contract modules", async () => {
  const sourcePatterns = [
    "src/**/*.{ts,tsx,js,mjs,cjs}",
    "web/src/**/*.{ts,tsx,js,mjs,cjs}",
    "scripts/**/*.{ts,tsx,js,mjs,cjs}",
    "website/src/**/*.{ts,tsx,js,mjs,cjs}",
  ] as const;
  const importSpecifier =
    /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/gu;
  const forbidden: string[] = [];

  for (const pattern of sourcePatterns) {
    for await (
      const path of new Bun.Glob(pattern).scan({
        cwd: fileURLToPath(root),
        onlyFiles: true,
      })
    ) {
      const source = await readFile(new URL(path, root), "utf8");
      for (const match of source.matchAll(importSpecifier)) {
        const specifier = match[1] ?? "";
        if (!/(?:^|\/)takosumi\//u.test(specifier)) continue;
        if (
          /(?:^|\/)takosumi\/(?:contract|accounts\/contract)(?:\/|$)/u.test(
            specifier,
          )
        ) {
          continue;
        }
        const line = source.slice(0, match.index).split("\n").length;
        forbidden.push(`${path}:${line}:${specifier}`);
      }
    }
  }

  expect(forbidden.sort()).toEqual([]);
});
