import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");

test("package exposes the portable gate without release mutation aliases", async () => {
  const packageConfig = JSON.parse(
    await readFile(resolve(repoRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const scripts = packageConfig.scripts ?? {};

  expect(scripts["docs:deploy"]).toBeUndefined();
  expect(scripts["deploy:service"]).toBeUndefined();
  expect(scripts["deploy:takosumi-release"]).toBeUndefined();
  expect(scripts["release-gate"]).toBeUndefined();
  expect(scripts["release-manifest:check-clean"]).toBeUndefined();
  expect(scripts["release-manifest:check-artifacts"]).toBeUndefined();
  expect(scripts["check"]).toBe(
    "bun run format:check && bun run lint && bun run typecheck && bun run test:portable && bun run build:portable",
  );
  expect(scripts["typecheck"]).toBe(
    "bun run check:worker && bun run check:web && cargo check --manifest-path containers/agent/Cargo.toml --all-targets",
  );
  expect(scripts["check:worker"]).toBe("tsc -p tsconfig.worker.json --noEmit");
  expect(scripts["check:web"]).toBe("tsc -p web/tsconfig.json --noEmit");
  expect(scripts["web:check"]).toBe("bun run check:web && bun run web:build");
  expect(scripts["validate:featured-app-opentofu"]).toBeUndefined();
  expect(scripts["validate:source-launcher-proof"]).toBeUndefined();
  expect(scripts["deploy:render-wrangler"]).toBeUndefined();
  expect(scripts["selfhost:bootstrap"]).toBeUndefined();
});

test("release gate cannot pass without worker and web diagnostics", async () => {
  const releaseGate = await readFile(
    resolve(repoRoot, "scripts/release-gate.ts"),
    "utf8",
  );

  expect(releaseGate).toContain("worker-typecheck");
  expect(releaseGate).toMatch(
    /command:\s*\[\s*["']bun["'],\s*["']run["'],\s*["']check:worker["']\s*\]/u,
  );
  expect(releaseGate).toContain("web-typecheck");
  expect(releaseGate).toMatch(
    /command:\s*\[\s*["']bun["'],\s*["']run["'],\s*["']check:web["']\s*\]/u,
  );
});
