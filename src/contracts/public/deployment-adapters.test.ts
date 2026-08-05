import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

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
const takoformModule = await readFile(
  new URL("deploy/opentofu/takoform/main.tf", root),
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

test("Cloudflare direct and Takoform adapt every Takos runtime connection", () => {
  for (const connection of contract.runtimeConnections) {
    expect(cloudflareRuntime).toContain(connection.name);
    expect(takoformModule).toContain(connection.name);
  }
  for (const shape of new Set(
    contract.resources.map((resource) => resource.shape),
  )) {
    if (shape === "Schedule") continue;
    const token = `takoform_${shape.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "")}`;
    expect(takoformModule).toContain(token);
  }
  expect(cloudflareModule).toContain('resource "cloudflare_d1_database"');
  expect(takoformModule).not.toContain("cloudflare_");
  expect(takoformModule).not.toContain("CLOUDFLARE_");
});

test("the portable agent service uses the image's declared HTTP port", () => {
  expect(agentDockerfile).toContain("ENV PORT=8080");
  expect(agentDockerfile).toContain("EXPOSE 8080");
  expect(takoformModule).toMatch(/ports\s*=\s*\[8080\]/u);
  expect(takoformModule).toContain('health_check_path = "/health"');
});
