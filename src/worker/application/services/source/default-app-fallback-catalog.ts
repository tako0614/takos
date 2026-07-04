// Static 1st-party fallback catalog for bundled/default seed apps plus
// catalog-only first-party entries
// (see takos/./default-app-distribution.ts).
//
// This is the hardcoded list of `takos-{docs,excel,slide,computer}`, `yurucommu`,
// and `road-to-me` entries that ship as `InstallableApp`s with Takos. Entries
// tagged `default-app` seed into new spaces when no operator-supplied
// distribution is configured; catalog-only entries such as `road-to-me` remain
// installable but do not auto-install. Each entry's `repositoryEnvKey` maps to
// an env var operators can set to override the per-app repository URL without
// replacing the whole distribution.
export const FALLBACK_DEFAULT_APP_DISTRIBUTION = [
  {
    name: "takos-office",
    title: "Office",
    appId: "jp.takos.office",
    description:
      "Docs, slides, and spreadsheets in one app with a unified Streamable HTTP MCP server.",
    publisher: "takos",
    homepage: "https://github.com/tako0614/takos-office",
    icon: "/docs/icons/docs.svg",
    category: "app",
    tags: ["default-app", "takos", "office", "docs", "slide", "spreadsheet"],
    repositoryUrl: "https://github.com/tako0614/takos-office.git",
    repositoryEnvKey: "TAKOS_DEFAULT_OFFICE_APP_REPOSITORY_URL",
    ref: "v0.1.0",
    refType: "tag",
    sourcePath: "outputs.tf",
    runtimeModes: ["shared-cell", "dedicated", "self-hosted"],
    bindings: [
      { name: "auth", type: "identity.oidc", required: true },
      {
        name: "storage",
        type: "storage.object",
        required: true,
      },
      { name: "domain", type: "protocol.http.api", required: false },
      { name: "bootstrap", type: "auth.bootstrap_token", required: true },
    ],
  },
  {
    name: "takos-computer",
    title: "Computer",
    appId: "jp.takos.computer",
    description:
      "Browser automation and sandbox computer with a Streamable HTTP MCP server.",
    publisher: "takos",
    homepage: "https://github.com/tako0614/takos-computer",
    icon: "/icons/computer.svg",
    category: "app",
    tags: ["default-app", "takos", "computer", "agent", "automation"],
    repositoryUrl: "https://github.com/tako0614/takos-computer.git",
    repositoryEnvKey: "TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL",
    ref: "v2.1.2",
    refType: "tag",
    sourcePath: "outputs.tf",
    runtimeModes: ["shared-cell", "dedicated", "self-hosted"],
    bindings: [
      { name: "auth", type: "identity.oidc", required: true },
      { name: "domain", type: "protocol.http.api", required: false },
      { name: "bootstrap", type: "auth.bootstrap_token", required: true },
    ],
  },
  {
    name: "yurucommu",
    title: "Yurucommu",
    appId: "com.yurucommu.app",
    description:
      "A self-hosted ActivityPub SNS an individual runs for themselves, reaching within their communities.",
    publisher: "takos",
    homepage: "https://github.com/tako0614/yurucommu",
    icon: undefined,
    category: "social",
    tags: ["default-app", "takos", "yurucommu", "social", "activitypub"],
    repositoryUrl: "https://github.com/tako0614/yurucommu.git",
    repositoryEnvKey: "TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL",
    ref: "main",
    refType: "branch",
    modulePath: ".",
    variables: {
      enable_cloudflare_resources: true,
      project_name: "yurucommu",
      worker_name: "yurucommu",
    },
    runtimeModes: ["shared-cell", "dedicated", "self-hosted"],
    bindings: [
      { name: "auth", type: "identity.oidc", required: true },
      { name: "db", type: "storage.sql", required: true },
      {
        name: "media",
        type: "storage.object",
        required: true,
      },
      { name: "domain", type: "protocol.http.api", required: true },
      { name: "bootstrap", type: "auth.bootstrap_token", required: true },
    ],
  },
  {
    name: "road-to-me",
    title: "Road to Me",
    appId: "jp.takos.road-to-me",
    description: "AI goal planning app for reverse timeline planning.",
    publisher: "takos",
    homepage: "https://github.com/tako0614/road-to-me",
    icon: undefined,
    category: "app",
    tags: ["takos", "road-to-me", "planning", "goals"],
    repositoryUrl: "https://github.com/tako0614/road-to-me.git",
    repositoryEnvKey: "TAKOS_DEFAULT_ROAD_TO_ME_APP_REPOSITORY_URL",
    ref: "v0.1.0",
    refType: "tag",
    sourcePath: "outputs.tf",
    runtimeModes: ["dedicated", "self-hosted"],
    bindings: [
      { name: "auth", type: "identity.oidc", required: true },
      { name: "db", type: "storage.sql", required: true },
      { name: "domain", type: "protocol.http.api", required: false },
      { name: "bootstrap", type: "auth.bootstrap_token", required: true },
    ],
    preinstall: false,
  },
] as const;
