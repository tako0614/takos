import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const text = await readFile(
  new URL(".well-known/takosumi.json", root),
  "utf8",
);
const manifest = JSON.parse(text) as RepositoryManifest;
const options = JSON.parse(
  await readFile(new URL("install-options.json", root), "utf8"),
) as { options: Array<{ source: { path: string } }> };
const modules = {
  "deploy/opentofu": await readFile(
    new URL("deploy/opentofu/variables.tf", root),
    "utf8",
  ),
};

test("Takos publishes the closed Repository manifest for its selectable module", () => {
  expect(Object.keys(manifest).sort()).toEqual([
    "apiVersion",
    "install",
    "kind",
  ]);
  expect(manifest.apiVersion).toBe("takosumi.com/v1");
  expect(manifest.kind).toBe("Repository");
  expect(Object.keys(manifest.install)).toEqual(["modules"]);
  expect(Object.keys(manifest.install.modules)).toEqual([
    "deploy/opentofu",
  ]);
  expect(options.options.map((option) => option.source.path)).toEqual([
    "deploy/opentofu",
  ]);
});

test("manifest references real variables and only bounded presentation metadata", () => {
  for (const [path, module] of Object.entries(manifest.install.modules)) {
    const source = modules[path as keyof typeof modules];
    expect(source).toBeDefined();
    const variables = new Set(
      Array.from(
        source.matchAll(/variable\s+"([^"]+)"\s*\{/g),
        (match) => match[1],
      ),
    );
    for (const name of referencedVariables(module)) {
      expect(variables.has(name)).toBe(true);
    }
    for (const input of module.inputs) {
      expect(["user", "capsule_name", "module_default"]).toContain(
        input.source.kind,
      );
      expect(input.label.ja.length).toBeGreaterThan(0);
      expect(input.label.en.length).toBeGreaterThan(0);
      expect(input.secret).toBeUndefined();
      if (input.source.kind === "module_default") {
        expect(variableBlock(source, input.name)).toMatch(/\n\s+default\s+=/);
      }
    }
  }
  for (const forbidden of [
    "account_id",
    '"cloudflare"',
    '"env"',
    '"target"',
    "credential",
    "providerConnection",
  ]) {
    expect(text).not.toContain(forbidden);
  }
});

function variableBlock(source: string, name: string): string {
  const start = source.indexOf(`variable "${name}" {`);
  const next = source.indexOf("\nvariable ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function referencedVariables(module: RepositoryModule): Set<string> {
  const names = new Set(module.inputs.map((input) => input.name));
  for (const projection of module.installExperience?.projections ?? []) {
    if (projection.variable) names.add(projection.variable);
    for (const value of Object.values(projection.variables ?? {})) {
      names.add(value);
    }
  }
  return names;
}

interface RepositoryManifest {
  apiVersion: string;
  kind: string;
  install: { modules: Record<string, RepositoryModule> };
}

interface RepositoryModule {
  inputs: Array<{
    name: string;
    source: { kind: string };
    label: { ja: string; en: string };
    secret?: boolean;
  }>;
  installExperience?: {
    projections: Array<{
      variable?: string;
      variables?: Record<string, string>;
    }>;
  };
}
