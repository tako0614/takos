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
  srcExclude: ["**/_*.md", "contributing/**"],
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
      { text: "Operator", link: "/operator/" },
      { text: "ホスティング", link: "/hosting/" },
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
          { text: "Local Shell", link: "/get-started/local-shell" },
        ],
      },
      {
        text: "アプリ構成",
        items: [
          { text: "概要", link: "/apps/" },
          { text: "Install Paths", link: "/apps/install-paths" },
          { text: "OIDC Consumer", link: "/apps/oidc-consumer" },
          { text: "MCP Server", link: "/apps/mcp" },
          { text: "File Handlers", link: "/apps/file-handlers" },
        ],
      },
      {
        text: "Operator",
        items: [
          { text: "概要", link: "/operator/" },
          { text: "OIDC Setup", link: "/operator/oidc-setup" },
          { text: "Account Migration", link: "/operator/account-migration" },
          { text: "Bootstrap", link: "/operator/bootstrap" },
        ],
      },
      {
        text: "デプロイ",
        items: [
          { text: "概要", link: "/deploy/" },
          { text: "マニフェスト", link: "/deploy/manifest" },
          { text: "Routes", link: "/deploy/routes" },
          { text: "環境変数", link: "/deploy/environment" },
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
          { text: "概要", link: "/hosting/" },
          { text: "環境ごとの差異", link: "/hosting/differences" },
          { text: "Target Parity", link: "/hosting/target-parity" },
          { text: "Cloudflare", link: "/hosting/cloudflare" },
          { text: "AWS", link: "/hosting/aws" },
          { text: "GCP", link: "/hosting/gcp" },
          { text: "Kubernetes", link: "/hosting/kubernetes" },
          { text: "セルフホスト", link: "/hosting/self-hosted" },
          { text: "Multi-cloud", link: "/hosting/multi-cloud" },
          { text: "Secret Policy", link: "/hosting/secrets" },
          { text: "ローカル開発", link: "/hosting/local" },
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
          { text: "App Publications", link: "/architecture/app-publications" },
          { text: "Runtime / Agent", link: "/architecture/runtime-service" },
          { text: "Diagrams", link: "/architecture/diagrams" },
        ],
      },
      {
        text: "Performance",
        items: [
          { text: "Baseline", link: "/performance/baseline" },
        ],
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
          { text: "Store", link: "/platform/store" },
          { text: "課金", link: "/platform/billing" },
          { text: "Bundled Apps", link: "/platform/default-apps" },
          {
            text: "Resource Governance",
            link: "/platform/resource-governance",
          },
          { text: "takos-docs", link: "/platform/takos-docs" },
          { text: "takos-excel", link: "/platform/takos-excel" },
          { text: "takos-slide", link: "/platform/takos-slide" },
          { text: "takos-computer", link: "/platform/takos-computer" },
          { text: "yurucommu", link: "/platform/yurucommu" },
        ],
      },
      {
        text: "リファレンス",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "CLI 認証", link: "/reference/cli-auth" },
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
  head: [["meta", { name: "theme-color", content: "#0f766e" }]],
});
