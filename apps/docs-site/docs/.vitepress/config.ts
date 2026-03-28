import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "ja",
  title: "Takos Docs",
  description: "Takos の独自仕様、概念、アーキテクチャをまとめた product/spec docs",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    siteTitle: "Takos Docs",
    search: {
      provider: "local",
    },
    nav: [
      { text: "はじめる", link: "/get-started/" },
      { text: "アプリ開発", link: "/apps/" },
      { text: "デプロイ", link: "/deploy/" },
      { text: "プラットフォーム", link: "/platform/" },
      { text: "リファレンス", link: "/reference/" },
      { text: "サンプル", link: "/examples/" },
    ],
    sidebar: {
      "/get-started/": [
        {
          text: "はじめる",
          items: [
            { text: "Takos とは", link: "/get-started/" },
            { text: "はじめてのアプリ", link: "/get-started/your-first-app" },
            { text: "ローカル開発", link: "/get-started/local-development" },
            {
              text: "プロジェクト構成",
              link: "/get-started/project-structure",
            },
          ],
        },
      ],
      "/apps/": [
        {
          text: "アプリ開発",
          items: [
            { text: "概要", link: "/apps/" },
            { text: "app.yml の書き方", link: "/apps/manifest" },
            { text: "Containers", link: "/apps/containers" },
            { text: "Workers", link: "/apps/workers" },
            { text: "Routes", link: "/apps/routes" },
            { text: "Resources", link: "/apps/resources" },
            { text: "環境変数", link: "/apps/environment" },
            { text: "MCP Server", link: "/apps/mcp" },
            { text: "OAuth", link: "/apps/oauth" },
            { text: "File Handlers", link: "/apps/file-handlers" },
          ],
        },
      ],
      "/deploy/": [
        {
          text: "デプロイ",
          items: [
            { text: "概要", link: "/deploy/" },
            { text: "deploy-group", link: "/deploy/deploy-group" },
            { text: "Store 経由", link: "/deploy/store-deploy" },
            { text: "Namespace", link: "/deploy/namespaces" },
            { text: "ロールバック", link: "/deploy/rollback" },
            {
              text: "トラブルシューティング",
              link: "/deploy/troubleshooting",
            },
          ],
        },
      ],
      "/platform/": [
        {
          text: "プラットフォーム",
          items: [
            { text: "概要", link: "/platform/" },
            { text: "Store", link: "/platform/store" },
            { text: "Threads & Runs", link: "/platform/threads-and-runs" },
            { text: "Spaces", link: "/platform/spaces" },
            { text: "課金", link: "/platform/billing" },
            { text: "ActivityPub", link: "/platform/activitypub" },
          ],
        },
      ],
      "/architecture/": [
        {
          text: "内部構造",
          items: [
            { text: "概要", link: "/architecture/" },
            { text: "Control Plane", link: "/architecture/control-plane" },
            { text: "Tenant Runtime", link: "/architecture/tenant-runtime" },
            { text: "互換性", link: "/architecture/compatibility" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "リファレンス",
          items: [
            { text: "概要", link: "/reference/" },
            { text: "CLI", link: "/reference/cli" },
            { text: "API", link: "/reference/api" },
            { text: "Manifest Spec", link: "/reference/manifest-spec" },
            { text: "用語集", link: "/reference/glossary" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "サンプル",
          items: [
            { text: "概要", link: "/examples/" },
            { text: "シンプルな Worker", link: "/examples/simple-worker" },
            { text: "Worker + DB", link: "/examples/worker-with-db" },
            {
              text: "Worker + Container",
              link: "/examples/worker-with-container",
            },
            { text: "MCP Server", link: "/examples/mcp-server" },
          ],
        },
      ],
    },
    docFooter: {
      prev: "前のページ",
      next: "次のページ",
    },
    outline: {
      level: [2, 3],
      label: "このページの内容",
    },
    lastUpdated: {
      text: "最終更新",
    },
    returnToTopLabel: "トップへ戻る",
    sidebarMenuLabel: "メニュー",
    darkModeSwitchLabel: "テーマ切替",
    lightModeSwitchTitle: "ライトモード",
    darkModeSwitchTitle: "ダークモード",
  },
  head: [["meta", { name: "theme-color", content: "#0f766e" }]],
});
