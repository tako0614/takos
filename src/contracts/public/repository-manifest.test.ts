import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { TAKOS_ACCOUNTS_OAUTH_SCOPES } from "./accounts-oidc.ts";

const root = new URL("../../../", import.meta.url);
const text = await readFile(new URL(".well-known/takosumi.json", root), "utf8");
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
  expect(manifest.apiVersion).toBe("takosumi.com/v2.2");
  expect(manifest.kind).toBe("Repository");
  expect(Object.keys(manifest.install)).toEqual(["defaultModule", "modules"]);
  expect(manifest.install.defaultModule).toBe("deploy/opentofu");
  expect(Object.keys(manifest.install.modules)).toEqual(["deploy/opentofu"]);
  const module = manifest.install.modules["deploy/opentofu"];
  expect(Object.keys(module).sort()).toEqual([
    "inputs",
    "interfaces",
    "requires",
  ]);
  expect(module.interfaces).toEqual([
    {
      key: "launcher",
      name: "takos.launcher",
      spec: {
        type: "interface.ui.surface",
        version: "1",
        document: {
          launcher: true,
          display: { title: "Takos", icon: "/logo.png" },
        },
        inputs: {
          url: {
            source: "output",
            outputName: "launch_url",
            outputType: "url",
          },
        },
        access: { visibility: "workspace" },
      },
      bindingRequests: [
        {
          key: "installer",
          subject: { source: "installing_principal" },
          permissions: ["ui.open"],
          delivery: { type: "none" },
        },
      ],
    },
  ]);
  expect(options.options.map((option) => option.source.path)).toEqual([
    "deploy/opentofu",
  ]);
  expect(module.inputs.find((input) => input.name === "cloudflare")).toEqual({
    name: "cloudflare",
    source: { kind: "user" },
    type: "json",
    required: true,
    label: {
      ja: "Cloudflare デプロイ設定",
      en: "Cloudflare deployment settings",
    },
    helper: {
      ja: "Cloudflare の account_id と、必要なら workers_subdomain を JSON で指定します。認証情報は Provider Connection から別に渡されます。",
      en: "Provide the Cloudflare account_id and optional workers_subdomain as JSON. Credentials are delivered separately through a Provider Connection.",
    },
    placeholder: '{"account_id":"...","workers_subdomain":"..."}',
    advanced: true,
  });
  const cloudflareVariable = variableBlock(
    modules["deploy/opentofu"],
    "cloudflare",
  );
  expect(cloudflareVariable).not.toMatch(/\n\s+default\s+=/);
  expect(cloudflareVariable).toMatch(/\n\s+account_id\s+=\s+string/);
});

test("the Repository manifest declares every OAuth scope requested by Takos", () => {
  const module = manifest.install.modules[manifest.install.defaultModule];
  const oidcRequirement = module.requires.find(
    (requirement) => requirement.kind === "identity.oidc",
  );

  expect(oidcRequirement?.scopes).toEqual([...TAKOS_ACCOUNTS_OAUTH_SCOPES]);
});

test("the Repository manifest requests AI through the portable host Interface", () => {
  const module = manifest.install.modules[manifest.install.defaultModule];
  const requirement = module.requires.find(
    (candidate) => candidate.kind === "interface.consume",
  );

  expect(requirement).toEqual({
    kind: "interface.consume",
    key: "ai",
    interface: { type: "takosumi.ai.gateway", version: "1" },
    permissions: ["ai.chat"],
    delivery: { type: "oauth2" },
  });
  expect(text).not.toContain('"interfaceId"');
  expect(text).not.toContain('"endpoint"');
  expect(text).not.toContain('"credentialRef"');
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
    for (const declaration of module.interfaces) {
      expect(Object.keys(declaration).sort()).toEqual([
        "bindingRequests",
        "key",
        "name",
        "spec",
      ]);
      expect(declaration.key).toBe("launcher");
      expect(declaration.name).toBe("takos.launcher");
      expect(Object.keys(declaration.spec).sort()).toEqual([
        "access",
        "document",
        "inputs",
        "type",
        "version",
      ]);
      expect(declaration.spec.type).toBe("interface.ui.surface");
      expect(declaration.spec.version).toBe("1");
      expect(declaration.spec.document).toEqual({
        launcher: true,
        display: { title: "Takos", icon: "/logo.png" },
      });
      expect(declaration.spec.inputs).toEqual({
        url: {
          source: "output",
          outputName: "launch_url",
          outputType: "url",
        },
      });
      expect(declaration.spec.access).toEqual({ visibility: "workspace" });
      expect(declaration.bindingRequests).toEqual([
        {
          key: "installer",
          subject: { source: "installing_principal" },
          permissions: ["ui.open"],
          delivery: { type: "none" },
        },
      ]);
    }
  }
  for (const forbidden of [
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
  install: {
    defaultModule: string;
    modules: Record<string, RepositoryModule>;
  };
}

interface RepositoryModule {
  inputs: Array<{
    name: string;
    source: { kind: string };
    type?: string;
    required?: boolean;
    label: { ja: string; en: string };
    helper?: { ja: string; en: string };
    placeholder?: string;
    advanced?: boolean;
    secret?: boolean;
  }>;
  installExperience?: {
    projections: Array<{
      variable?: string;
      variables?: Record<string, string>;
    }>;
  };
  requires: Array<{
    kind: string;
    scopes?: string[];
    key?: string;
    interface?: { type: string; version: string };
    permissions?: string[];
    delivery?: { type: string };
  }>;
  interfaces: Array<{
    key: string;
    name: string;
    spec: {
      type: string;
      version: string;
      document: Record<string, unknown>;
      inputs: Record<string, Record<string, unknown>>;
      access: Record<string, unknown>;
    };
    bindingRequests: Array<{
      key: string;
      subject: { source: string };
      permissions: string[];
      delivery: { type: string };
    }>;
  }>;
}
