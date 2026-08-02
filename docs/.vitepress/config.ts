import { spawnSync } from "node:child_process";
import { defineConfig } from "vitepress";

function canReadGitTimestamps(): boolean {
  try {
    return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

const enableLastUpdated = canReadGitTimestamps();

export default defineConfig({
  lang: "ja",
  title: "Takos Docs",
  description:
    "AI エージェントに作業を頼み、ファイル・Git・メモリ・アプリへ成果を残す Takos のドキュメント",
  cleanUrls: true,
  lastUpdated: enableLastUpdated,
  srcExclude: ["**/_*.md", "contributing/**", "releases/**"],
  themeConfig: {
    siteTitle: "Takos Docs",
    search: {
      provider: "local",
    },
    nav: [
      { text: "はじめる", link: "/get-started/" },
      { text: "アプリと接続", link: "/apps/" },
      { text: "セルフホスト", link: "/deploy/" },
      { text: "アーキテクチャ", link: "/architecture/" },
      { text: "リファレンス", link: "/reference/" },
    ],
    sidebar: [
      {
        text: "概要",
        items: [{ text: "Takos 全体像", link: "/overview/" }],
      },
      {
        text: "はじめる",
        items: [
          { text: "スタートガイド", link: "/get-started/" },
          { text: "はじめてのアプリ", link: "/get-started/your-first-app" },
          { text: "通知", link: "/get-started/notifications" },
          { text: "プロジェクト構成", link: "/get-started/project-structure" },
          { text: "ローカル開発", link: "/get-started/local-development" },
          { text: "Local Shell", link: "/get-started/local-shell" },
        ],
      },
      {
        text: "アプリと接続",
        items: [
          { text: "概要", link: "/apps/" },
          { text: "インストール方法", link: "/apps/install-paths" },
          { text: "ツールと接続", link: "/apps/mcp" },
          { text: "ファイルを開くアプリ", link: "/apps/file-handlers" },
          { text: "OIDC 連携", link: "/apps/oidc-consumer" },
        ],
      },
      {
        text: "Operator",
        items: [
          { text: "概要", link: "/operator/" },
          { text: "OIDC Setup", link: "/operator/oidc-setup" },
          { text: "Account Model", link: "/operator/account-model" },
          { text: "Bootstrap", link: "/operator/bootstrap" },
        ],
      },
      {
        text: "セルフホスト",
        items: [
          { text: "概要", link: "/deploy/" },
          {
            text: "アプリの公開先",
            link: "/deploy/runtime-interfaces",
          },
          { text: "ルートとドメイン", link: "/deploy/routes" },
          { text: "環境と変数", link: "/deploy/environment" },
          { text: "デプロイ手順", link: "/deploy/deploy" },
          {
            text: "Artifact materializer",
            link: "/deploy/product-materializer",
          },
          {
            text: "Release artifact publication",
            link: "/deploy/release-artifact",
          },
          { text: "複数サービス", link: "/deploy/deploy-group" },
          { text: "Git ソース", link: "/deploy/store-deploy" },
          { text: "実行場所", link: "/deploy/namespaces" },
          { text: "ロールバック", link: "/deploy/rollback" },
          { text: "トラブルシューティング", link: "/deploy/troubleshooting" },
        ],
      },
      {
        text: "アーキテクチャ",
        items: [
          { text: "概要", link: "/architecture/" },
          {
            text: "System Architecture",
            link: "/architecture/system-architecture",
          },
          { text: "Service Topology", link: "/architecture/service-topology" },
          { text: "Takos App Interface", link: "/architecture/app-interface" },
          {
            text: "Capsule Runtime Projection",
            link: "/architecture/capsule-runtime-projection",
          },
          { text: "App Metadata", link: "/architecture/app-metadata" },
          { text: "Runtime / Agent", link: "/architecture/runtime-service" },
          { text: "Diagrams", link: "/architecture/diagrams" },
        ],
      },
      {
        text: "Performance",
        items: [{ text: "Baseline", link: "/performance/baseline" }],
      },
      {
        text: "Legal",
        items: [
          {
            text: "Overview",
            link: "/legal/",
          },
          {
            text: "Data Processing Agreement",
            link: "/legal/data-processing-agreement",
          },
          {
            text: "Sub-processors",
            link: "/legal/subprocessors",
          },
          {
            text: "Data Residency",
            link: "/legal/data-residency",
          },
          {
            text: "Privacy Rights",
            link: "/legal/privacy-rights",
          },
          {
            text: "Security Disclosure",
            link: "/legal/security-disclosure",
          },
          {
            text: "License Compliance",
            link: "/legal/license-compliance",
          },
          {
            text: "Third-party Licenses",
            link: "/legal/third-party-license-inventory",
          },
          {
            text: "SOC 2 Readiness",
            link: "/legal/soc2-readiness",
          },
        ],
      },
      {
        text: "プラットフォーム",
        items: [
          { text: "Space", link: "/platform/spaces" },
          { text: "Threads and Runs", link: "/platform/threads-and-runs" },
          { text: "Upgrade / Export", link: "/platform/upgrade-export" },
          { text: "Git URL から install", link: "/platform/store" },
          { text: "課金", link: "/platform/billing" },
          { text: "Bundled Apps", link: "/platform/default-apps" },
          {
            text: "Resource Governance",
            link: "/platform/resource-governance",
          },
          { text: "takos-office", link: "/platform/takos-office" },
          { text: "takos-computer", link: "/platform/takos-computer" },
          { text: "yurucommu", link: "/platform/yurucommu" },
        ],
      },
      {
        text: "リファレンス",
        items: [
          { text: "概要", link: "/reference/" },
          { text: "用語集", link: "/reference/glossary" },
          { text: "API", link: "/reference/api" },
          { text: "Database Ownership", link: "/reference/database" },
        ],
      },
      {
        text: "サンプル",
        items: [
          { text: "シンプルな Worker", link: "/examples/simple-worker" },
          { text: "Worker + DB", link: "/examples/worker-with-db" },
          {
            text: "Worker + Container",
            link: "/examples/worker-with-container",
          },
          { text: "MCP Server", link: "/examples/mcp-server" },
          { text: "マルチサービス構成", link: "/examples/multi-service" },
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
    lastUpdated: enableLastUpdated
      ? {
          text: "最終更新",
        }
      : false,
    returnToTopLabel: "トップへ戻る",
    sidebarMenuLabel: "メニュー",
    darkModeSwitchLabel: "テーマ切替",
    lightModeSwitchTitle: "ライトモード",
    darkModeSwitchTitle: "ダークモード",
  },
  head: [["meta", { name: "theme-color", content: "#dc2626" }]],
});
