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
    "AIエージェントによるサービスとソフトウェアの民主化基盤 Takos の全体像、アプリ構成、デプロイ、プラットフォーム仕様をまとめた公式 docs",
  cleanUrls: true,
  lastUpdated: enableLastUpdated,
  themeConfig: {
    siteTitle: "Takos Docs",
    search: {
      provider: "local",
    },
    nav: [
      { text: "概要", link: "/overview/" },
      { text: "はじめる", link: "/get-started/" },
      { text: "アプリ構成", link: "/apps/" },
      { text: "デプロイ", link: "/deploy/" },
      { text: "プラットフォーム", link: "/platform/" },
      { text: "リファレンス", link: "/reference/" },
      { text: "サンプル", link: "/examples/" },
    ],
    sidebar: [
      {
        text: "概要",
        items: [
          { text: "Takos 全体像", link: "/overview/" },
        ],
      },
      {
        text: "はじめる",
        items: [
          { text: "スタートガイド", link: "/get-started/" },
          { text: "はじめてのアプリ", link: "/get-started/your-first-app" },
          { text: "プロジェクト構成", link: "/get-started/project-structure" },
          { text: "ローカル開発", link: "/get-started/local-development" },
        ],
      },
      {
        text: "アプリ構成",
        items: [
          { text: "アプリマニフェスト", link: "/apps/manifest" },
          { text: "Services", link: "/apps/services" },
          { text: "Containers", link: "/apps/containers" },
          { text: "Workers", link: "/apps/workers" },
          { text: "Routes", link: "/apps/routes" },
          { text: "環境変数", link: "/apps/environment" },
          { text: "MCP Server", link: "/apps/mcp" },
          { text: "OAuth", link: "/apps/oauth" },
          { text: "File Handlers", link: "/apps/file-handlers" },
        ],
      },
      {
        text: "デプロイ",
        items: [
          { text: "概要", link: "/deploy/" },
          { text: "deploy", link: "/deploy/deploy" },
          { text: "deploy-group", link: "/deploy/deploy-group" },
          { text: "Repository / Catalog", link: "/deploy/store-deploy" },
          { text: "Namespace", link: "/deploy/namespaces" },
          { text: "ロールバック", link: "/deploy/rollback" },
          { text: "トラブルシューティング", link: "/deploy/troubleshooting" },
        ],
      },
      {
        text: "ホスティング",
        items: [
          { text: "環境ごとの差異", link: "/hosting/differences" },
          { text: "Cloudflare", link: "/hosting/cloudflare" },
          { text: "AWS", link: "/hosting/aws" },
          { text: "GCP", link: "/hosting/gcp" },
          { text: "Kubernetes", link: "/hosting/kubernetes" },
          { text: "セルフホスト", link: "/hosting/self-hosted" },
          { text: "ローカル開発", link: "/hosting/local" },
        ],
      },
      {
        text: "アーキテクチャ",
        items: [
          { text: "概要", link: "/architecture/" },
          { text: "Kernel", link: "/architecture/kernel" },
          { text: "Deploy System", link: "/architecture/deploy-system" },
          { text: "App Publications", link: "/architecture/app-publications" },
          { text: "Control Plane", link: "/architecture/control-plane" },
          { text: "Tenant Runtime", link: "/architecture/tenant-runtime" },
          { text: "Container Hosts", link: "/architecture/container-hosts" },
          { text: "Runtime Service", link: "/architecture/runtime-service" },
          { text: "互換性と制限", link: "/architecture/compatibility" },
        ],
      },
      {
        text: "プラットフォーム",
        items: [
          { text: "Space", link: "/platform/spaces" },
          { text: "Threads and Runs", link: "/platform/threads-and-runs" },
          { text: "Store", link: "/platform/store" },
          { text: "課金", link: "/platform/billing" },
          { text: "ActivityPub", link: "/platform/activitypub" },
          { text: "Default Groups", link: "/platform/default-apps" },
          { text: "互換性", link: "/platform/compatibility" },
          {
            text: "Resource Governance",
            link: "/platform/resource-governance",
          },
          { text: "takos-docs", link: "/platform/takos-docs" },
          { text: "takos-excel", link: "/platform/takos-excel" },
          { text: "takos-slide", link: "/platform/takos-slide" },
        ],
      },
      {
        text: "リファレンス",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "CLI 認証", link: "/reference/cli-auth" },
          { text: "API", link: "/reference/api" },
          { text: "Manifest Spec", link: "/reference/manifest-spec" },
          { text: "用語集", link: "/reference/glossary" },
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
  head: [["meta", { name: "theme-color", content: "#0f766e" }]],
});
