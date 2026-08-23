import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { TAKOS_ACCOUNTS_OAUTH_SCOPES } from "./accounts-oidc.ts";

const root = new URL("../../../", import.meta.url);
const text = await readFile(new URL(".well-known/takosumi.json", root), "utf8");
const manifest = JSON.parse(text) as RepositoryManifest;
const packageJson = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
) as { version: string; takosRelease: { version: string } };
const packageTag = `v${packageJson.version}`;
const websiteCloudUrlSource = await readFile(
  new URL("website/src/lib/cloud-url.ts", root),
  "utf8",
);
const schemaBundleDigest = createHash("sha256")
  .update(
    await readFile(
      new URL(
        "deploy/opentofu/takoform/migrations/schema-bundle.json",
        root,
      ),
    ),
  )
  .digest("hex");
const options = JSON.parse(
  await readFile(new URL("install-options.json", root), "utf8"),
) as { options: Array<{ source: { path: string } }> };
const modules = {
  "deploy/opentofu/cloudflare": await readFile(
    new URL("deploy/opentofu/cloudflare/variables.tf", root),
    "utf8",
  ),
  "deploy/opentofu/takoform": await readFile(
    new URL("deploy/opentofu/takoform/main.tf", root),
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
  expect(manifest.install.defaultModule).toBe("deploy/opentofu/takoform");
  expect(Object.keys(manifest.install.modules)).toEqual([
    "deploy/opentofu/takoform",
    "deploy/opentofu/cloudflare",
  ]);
  const module = manifest.install.modules["deploy/opentofu/cloudflare"];
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
    "deploy/opentofu/takoform",
    "deploy/opentofu/cloudflare",
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
    modules["deploy/opentofu/cloudflare"],
    "cloudflare",
  );
  expect(cloudflareVariable).not.toMatch(/\n\s+default\s+=/);
  expect(cloudflareVariable).toMatch(/\n\s+account_id\s+=\s+string/);

  const portable = manifest.install.modules["deploy/opentofu/takoform"];
  expect(portable.inputs.some((input) => input.name === "runtime_image")).toBe(
    false,
  );
  expect(
    portable.inputs.find((input) => input.name === "agent_image"),
  ).toMatchObject({ source: { kind: "module_default" } });
  const portableDefaults = {
    agent_image:
      "ghcr.io/tako0614/takos-agent@sha256:09ca6ff29ed0cbbe35e0d0e76d17e7bb029bdbdfe3fb4c88b6cdbaf4d280cda2",
    worker_release_tag: packageTag,
    worker_artifact_url:
      `https://github.com/tako0614/takos/releases/download/${packageTag}/takos-worker-release.tar.gz`,
    worker_artifact_sha256:
      "sha256:dd22e2e9c7e1b5de608a4e3d018558512a3f809d5c3f5e9aabe4e9f768cf86c6",
  } as const;
  for (const [name, value] of Object.entries(portableDefaults)) {
    const input = portable.inputs.find((candidate) => candidate.name === name);
    expect(input).toMatchObject({
      source: { kind: "module_default" },
    });
    expect(input).not.toHaveProperty("required");
    expect(variableBlock(modules["deploy/opentofu/takoform"], name)).toMatch(
      new RegExp(`\\n\\s+default\\s+=\\s+"${escapeRegex(value)}"`),
    );
  }
  expect(modules["deploy/opentofu/takoform"]).toContain(
    'source  = "registry.opentofu.org/tako0614/takoform"',
  );
});

test("the selectable source and portable runtime use one exact Takos release", () => {
  expect(packageJson.takosRelease.version).toBe(packageJson.version);
  const portableSource = modules["deploy/opentofu/takoform"];

  expect(variableDefault(portableSource, "worker_release_tag")).toBe(
    packageTag,
  );
  expect(variableDefault(portableSource, "worker_artifact_url")).toBe(
    `https://github.com/tako0614/takos/releases/download/${packageTag}/takos-worker-release.tar.gz`,
  );
  expect(portableSource).toContain(
    `schema_url    = "https://raw.githubusercontent.com/tako0614/takos/${packageTag}/deploy/takoform/migrations/schema-bundle.json"`,
  );
  expect(portableSource).toContain(
    `schema_sha256 = "${schemaBundleDigest}"`,
  );
  const portableManifest =
    manifest.install.modules["deploy/opentofu/takoform"];
  expect(
    portableManifest.inputs.find(
      (input) => input.name === "worker_release_tag",
    )?.placeholder,
  ).toBe(packageTag);
  expect(
    portableManifest.inputs.find(
      (input) => input.name === "worker_artifact_url",
    )?.placeholder,
  ).toBe(
    `https://github.com/tako0614/takos/releases/download/${packageTag}/takos-worker-release.tar.gz`,
  );
  expect(websiteCloudUrlSource).toContain(
    `const DEFAULT_TAKOS_REF = "${packageTag}"`,
  );
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

function variableDefault(source: string, name: string): string | undefined {
  return variableBlock(source, name).match(/\n\s+default\s+=\s+"([^"]+)"/u)?.[1];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
