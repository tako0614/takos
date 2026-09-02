import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";

import { REQUIRED_RUNTIME_SECRET_NAMES } from "../../worker/shared/config/runtime-secrets.ts";

const root = new URL("../../../", import.meta.url);
const text = await readFile(new URL(".well-known/takosumi.json", root), "utf8");
const manifest = JSON.parse(text) as RepositoryManifest;
const packageJson = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
) as { version: string; takosRelease: { version: string } };
const websiteCloudUrlSource = await readFile(
  new URL("website/src/lib/cloud-url.ts", root),
  "utf8",
);
const installCtaSource = await readFile(
  new URL("website/src/components/InstallCTA.tsx", root),
  "utf8",
);
const modules = {
  "deploy/opentofu/cloudflare": await readFile(
    new URL("deploy/opentofu/cloudflare/variables.tf", root),
    "utf8",
  ),
};
const platformModuleSource = await readFile(
  new URL("deploy/opentofu/cloudflare/modules/platform/main.tf", root),
  "utf8",
);
const retiredTakoformEntries = await readdir(
  new URL("deploy/opentofu/takoform/", root),
);

test("Takos publishes repository install hints and service declarations", () => {
  expect(Object.keys(manifest).sort()).toEqual([
    "apiVersion",
    "install",
    "kind",
  ]);
  expect(manifest.apiVersion).toBe("takosumi.com/v2.4");
  expect(manifest.kind).toBe("Repository");
  expect(Object.keys(manifest.install)).toEqual(["modules"]);
  expect(Object.keys(manifest.install.modules)).toEqual([
    "deploy/opentofu/cloudflare",
  ]);
  const module = manifest.install.modules["deploy/opentofu/cloudflare"];
  expect(Object.keys(module).sort()).toEqual([
    "inputs",
    "interfaces",
    "requires",
    "sourceBuild",
  ]);
  expect(module.sourceBuild?.commands).toEqual([
    { argv: ["bun", "install", "--frozen-lockfile"] },
    { argv: ["bun", "run", "build:opentofu-worker-artifact"] },
  ]);
  expect(module.sourceBuild?.outputs).toEqual([
    "deploy/opentofu/cloudflare/.takos-build/worker/index.js",
    "deploy/opentofu/cloudflare/.takos-build/assets",
    "deploy/opentofu/cloudflare/.takos-build/bridge/takos-cloudflare-opentofu-bridge.ts",
    "deploy/opentofu/cloudflare/.takos-build/migrations",
    "deploy/opentofu/cloudflare/.takos-build/container-desired.json",
    "deploy/opentofu/cloudflare/.takos-build/manifest.json",
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
  expect(module.inputs.find((input) => input.name === "container_image")).toMatchObject({
    name: "container_image",
    source: { kind: "user" },
    type: "string",
    required: false,
    advanced: true,
  });
  expect(module.inputs.find((input) => input.name === "container_image")?.helper?.en).toContain(
    "GHCR is unsupported",
  );
  expect(module.inputs.find((input) => input.name === "cloudflare_provider_gap_bridge_mode")).toMatchObject({
    name: "cloudflare_provider_gap_bridge_mode",
    source: { kind: "user" },
    type: "string",
    advanced: true,
  });
  expect(module.inputs.find((input) => input.name === "cloudflare_provider_gap_bridge_mode")?.helper?.en).toContain(
    "disposable-production",
  );
  expect(module.inputs.find((input) => input.name === "cloudflare_provider_gap_bridge_acknowledgement")).toMatchObject({
    name: "cloudflare_provider_gap_bridge_acknowledgement",
    source: { kind: "user" },
    type: "string",
    advanced: true,
  });
  expect(module.inputs.find((input) => input.name === "cloudflare_provider_gap_bridge_acknowledgement")?.helper?.en).toContain(
    "DISPOSABLE_PRODUCTION_ONE_SHOT",
  );
  expect(module.inputs.find((input) => input.name === "public_url")?.required).toBe(true);
  const cloudflareVariable = variableBlock(
    modules["deploy/opentofu/cloudflare"],
    "cloudflare",
  );
  expect(cloudflareVariable).not.toMatch(/\n\s+default\s+=/);
  expect(cloudflareVariable).toMatch(/\n\s+account_id\s+=\s+string/);

  expect(retiredTakoformEntries.filter((name) => /\.(?:tf|tofu)(?:\.json)?$/u.test(name))).toEqual([]);
  expect(retiredTakoformEntries).toEqual(expect.arrayContaining([
    "main.tf.history",
    "outputs.tf.history",
  ]));
});

test("the repository source and website CTA use one exact Takos release", () => {
  const candidateTag = "v0.12.8";
  expect(packageJson.takosRelease.version).toBe(packageJson.version);
  expect(websiteCloudUrlSource).toContain(
    'const DEFAULT_TAKOS_GIT_URL = "https://github.com/tako0614/takos.git"',
  );
  expect(websiteCloudUrlSource).toContain(
    'url.searchParams.set("git", takosInstallGitUrl());',
  );
  expect(websiteCloudUrlSource).toContain(
    `const DEFAULT_TAKOS_REF = "${candidateTag}"`,
  );
  expect(websiteCloudUrlSource).toContain(
    'const DEFAULT_TAKOS_MODULE_PATH = "deploy/opentofu/cloudflare"',
  );
  expect(websiteCloudUrlSource).toContain(
    'url.searchParams.set("name", "takos");',
  );
  expect(websiteCloudUrlSource).not.toContain("var.");

  const selfHostSequence = [
    "git clone https://github.com/tako0614/takos.git",
    "git fetch --tags origin",
    "git checkout --detach v0.12.8",
    "git rev-parse --verify v0.12.8",
    "bun install --frozen-lockfile",
    "bun run build:opentofu-worker-artifact",
    'install -d -m 700 "$HOME/.config/takos"',
    'cp deploy/opentofu/cloudflare/opentofu.tfvars.example "$HOME/.config/takos/takos.tfvars"',
    'chmod 600 "$HOME/.config/takos/takos.tfvars"',
    "tofu -chdir=deploy/opentofu/cloudflare init -input=false",
    'tofu -chdir=deploy/opentofu/cloudflare plan -input=false -var-file="$HOME/.config/takos/takos.tfvars" -out="$HOME/.config/takos/takos.tfplan"',
    'tofu show "$HOME/.config/takos/takos.tfplan"',
    'tofu -chdir=deploy/opentofu/cloudflare apply "$HOME/.config/takos/takos.tfplan"',
  ];
  let previousCommandOffset = -1;
  for (const command of selfHostSequence) {
    const commandOffset = installCtaSource.indexOf(command);
    expect(commandOffset).toBeGreaterThan(previousCommandOffset);
    previousCommandOffset = commandOffset;
  }
  expect(installCtaSource).toContain("# edit external tfvars before planning");
  expect(installCtaSource).not.toContain("cloudflare_provider_gap_bridge_mode");
});

test("the Repository manifest requires explicit operator-owned OIDC client metadata", () => {
  const expected = {
    kind: "identity.oidc",
    callbackPath: "/auth/oidc/callback",
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "capsules:read",
      "capsules:write",
    ],
    deliver: {
      variables: {
        accountsUrl: "takosumi_accounts_url",
        issuerUrl: "takosumi_accounts_issuer_url",
        clientId: "takosumi_accounts_client_id",
        redirectUri: "takosumi_accounts_redirect_uri",
      },
    },
  };
  for (const module of Object.values(manifest.install.modules)) {
    expect(
      module.inputs.some((input) => input.name.startsWith("takosumi_accounts_")),
    ).toBe(false);
    expect(
      module.requires.find((requirement) => requirement.kind === "identity.oidc"),
    ).toEqual(expected);
    expect(module.inputs.find((input) => input.name === "public_url")?.required).toBe(true);
  }
});

test("the Repository manifest does not require a Takosumi AI gateway to install", () => {
  const module = manifest.install.modules["deploy/opentofu/cloudflare"];
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

/**
 * `secret.generated` is the only way a repository may ask the host to mint a
 * runtime secret, and Takosumi accepts exactly one shape for it: 32 bytes, hex,
 * delivered to a runtime binding name (`takosumi/contract/repository-manifest.ts`
 * and `validateRequirement` in the install UX compiler). Any other shape is
 * rejected at Capsule preflight rather than at install time, so pin it here.
 */
test("the manifest requests its symmetric runtime secrets as host-generated bindings", () => {
  const module = manifest.install.modules["deploy/opentofu/cloudflare"];
  const generated = module.requires.filter(
    (requirement) => requirement.kind === "secret.generated",
  );
  expect(generated.length).toBeLessThanOrEqual(8);
  expect(
    generated.map((requirement) => requirement.deliver?.bindings?.value).sort(),
  ).toEqual([
    "ENCRYPTION_KEY",
    "TAKOS_AGENT_START_TOKEN",
    "TAKOS_INTERNAL_API_SECRET",
  ]);
  for (const requirement of generated) {
    expect(Object.keys(requirement).sort()).toEqual([
      "bytes",
      "deliver",
      "encoding",
      "kind",
    ]);
    expect(requirement.bytes).toBe(32);
    expect(requirement.encoding).toBe("hex");
    expect(Object.keys(requirement.deliver ?? {})).toEqual(["bindings"]);
    const binding = requirement.deliver?.bindings?.value ?? "";
    expect(binding).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/u);
    // Host-reserved runtime binding names a repository may never claim.
    expect([
      "TAKOFORM_ENDPOINT",
      "TAKOFORM_SPACE",
      "TAKOFORM_TOKEN",
      "TAKOSUMI_CAPSULE_ID",
      "TAKOSUMI_WORKSPACE_ID",
      "TAKOSUMI_RUN_ID",
    ]).not.toContain(binding);
    expect(REQUIRED_RUNTIME_SECRET_NAMES as readonly string[]).toContain(binding);
  }
});

test("no two requirements deliver to the same variable or binding", () => {
  for (const module of Object.values(manifest.install.modules)) {
    const delivered = module.requires.flatMap((requirement) =>
      Object.values(
        requirement.deliver?.variables ?? requirement.deliver?.bindings ?? {},
      ),
    );
    expect(new Set(delivered).size).toBe(delivered.length);
  }
});

/**
 * A 32-byte hex secret cannot express an RSA key pair, so `PLATFORM_PRIVATE_KEY`
 * and `PLATFORM_PUBLIC_KEY` stay operator-supplied. The OpenTofu module still
 * has to name all five, because it binds them without holding a value.
 */
test("the OpenTofu module names every runtime secret, including the operator-supplied pair", () => {
  const declared = platformModuleSource.match(
    /runtime_secret_binding_names\s*=\s*\[([^\]]*)\]/u,
  );
  expect(declared).not.toBeNull();
  const moduleBindings = Array.from(
    declared![1]!.matchAll(/"([A-Z0-9_]+)"/gu),
    (match) => match[1]!,
  );
  expect(moduleBindings.sort()).toEqual([...REQUIRED_RUNTIME_SECRET_NAMES].sort());
  for (const module of Object.values(manifest.install.modules)) {
    for (const requirement of module.requires) {
      if (requirement.kind !== "secret.generated") continue;
      expect(moduleBindings).toContain(requirement.deliver?.bindings?.value ?? "");
    }
  }
  // The module may name a runtime secret; it may never mint or transmit one.
  expect(platformModuleSource).not.toContain('resource "random_password"');
  expect(platformModuleSource).not.toContain('resource "tls_private_key"');
  expect(platformModuleSource).not.toContain('"secret_text"');
});

test("the manifest carries no secret value of its own", () => {
  // A manifest is a public repository file: a requirement is a request, never
  // a value. No string in it may look like resolved secret material.
  expect(text).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
  const suspicious: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") {
      return Object.values(value as Record<string, unknown>).forEach(visit);
    }
    if (typeof value !== "string") return;
    if (/^[0-9a-f]{32,}$/u.test(value) || /^[A-Za-z0-9+/]{40,}={0,2}$/u.test(value)) {
      suspicious.push(value);
    }
  };
  visit(manifest);
  expect(suspicious).toEqual([]);
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
    callbackPath?: string;
    scopes?: string[];
    key?: string;
    bytes?: number;
    encoding?: string;
    interface?: { type: string; version: string };
    permissions?: string[];
    delivery?: { type?: string; variables?: Record<string, string> };
    deliver?: {
      variables?: Record<string, string>;
      bindings?: Record<string, string>;
    };
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
  sourceBuild?: {
    commands: Array<{ argv: string[]; workingDirectory?: string }>;
    outputs: string[];
  };
}
