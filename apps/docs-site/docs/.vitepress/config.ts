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
      { text: "概要", link: "/overview/" },
      { text: "概念", link: "/concepts/" },
      { text: "仕様", link: "/specs/" },
      { text: "アーキテクチャ", link: "/architecture/" },
      { text: "運用", link: "/operations/" },
      { text: "参照", link: "/reference/" },
    ],
    sidebar: [
      {
        text: "概要",
        items: [
          { text: "Takos Docs", link: "/" },
          { text: "Takos overview", link: "/overview/" },
        ],
      },
      {
        text: "中核概念",
        items: [
          { text: "概念マップ", link: "/concepts/" },
          { text: "Workspace / Space", link: "/concepts/spaces-and-workspaces" },
          { text: "Repo / Service / Worker", link: "/concepts/repos-services-workers" },
          { text: "Resource / Binding", link: "/concepts/resources-and-bindings" },
          { text: "Thread / Run / Artifact", link: "/concepts/threads-and-runs" },
        ],
      },
      {
        text: "独自仕様",
        items: [
          { text: "仕様の全体像", link: "/specs/" },
          { text: ".takos/app.yml", link: "/specs/app-manifest" },
          { text: "Deployment model", link: "/specs/deployment-model" },
          { text: "Deploy System v1", link: "/specs/deploy-system" },
          { text: "CLI / Auth model", link: "/specs/cli-and-auth" },
        ],
      },
      {
        text: "運用と参照",
        items: [
          { text: "アーキテクチャ", link: "/architecture/" },
          { text: "Control plane", link: "/architecture/control-plane" },
          { text: "Tenant runtime", link: "/architecture/tenant-runtime" },
          { text: "互換性と制限", link: "/architecture/compatibility-and-limitations" },
          { text: "Release system", link: "/architecture/release-system" },
          { text: "Resource governance", link: "/architecture/resource-governance" },
          { text: "運用モデル", link: "/operations/" },
          { text: "参照", link: "/reference/" },
          { text: "用語集", link: "/reference/glossary" },
          { text: "CLI command reference", link: "/reference/commands" },
        ],
      },
    ],
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
  head: [
    ["meta", { name: "theme-color", content: "#0f766e" }],
  ],
});
