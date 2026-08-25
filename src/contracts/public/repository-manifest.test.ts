import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

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
const options = JSON.parse(
  await readFile(new URL("install-options.json", root), "utf8"),
) as { options: Array<{ source: { path: string } }> };
const modules = {
  "deploy/opentofu/cloudflare": await readFile(
    new URL("deploy/opentofu/cloudflare/variables.tf", root),
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
  expect(manifest.install.defaultModule).toBe("deploy/opentofu/cloudflare");
  expect(Object.keys(manifest.install.modules)).toEqual([
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
    "deploy/opentofu/cloudflare",
  ]);
  expect(options.options.map((option) => option.id)).toEqual(["cloudflare"]);
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

  expect(text).not.toContain("deploy/opentofu/takoform");
});

test("the selectable source and website use one exact Takos release", () => {
  expect(packageJson.takosRelease.version).toBe(packageJson.version);
  expect(websiteCloudUrlSource).toContain(
    `const DEFAULT_TAKOS_REF = "${packageTag}"`,
  );
});

test("the Repository manifest requires explicit operator-owned OIDC client metadata", () => {
  const module = manifest.install.modules[manifest.install.defaultModule];
  expect(module.requires.some((requirement) => requirement.kind === "identity.oidc")).toBe(
    false,
  );

  expect(
    module.inputs
      .filter((input) => input.name.startsWith("takosumi_accounts_"))
      .map((input) => ({
        name: input.name,
        source: input.source,
        type: input.type,
        format: input.format,
        required: input.required,
      })),
  ).toEqual([
    {
      name: "takosumi_accounts_url",
      source: { kind: "user" },
      type: "string",
      format: "url",
      required: false,
    },
    {
      name: "takosumi_accounts_issuer_url",
      source: { kind: "user" },
      type: "string",
      format: "url",
      required: false,
    },
    {
      name: "takosumi_accounts_client_id",
      source: { kind: "user" },
      type: "string",
      format: undefined,
      required: false,
    },
    {
      name: "takosumi_accounts_redirect_uri",
      source: { kind: "user" },
      type: "string",
      format: "url",
      required: false,
    },
  ]);
});

test("the Repository manifest does not require a Takosumi AI gateway to install", () => {
  const module = manifest.install.modules[manifest.install.defaultModule];
  expect(module.requires.some((candidate) => candidate.kind === "interface.consume")).toBe(
    false,
  );
  expect(text).not.toContain('"takosumi.ai.gateway"');
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
    format?: string;
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
