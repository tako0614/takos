import { spawnSync } from 'node:child_process';
import { defineConfig } from 'vitepress';

function canReadGitTimestamps(): boolean {
  try {
    return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

const enableLastUpdated = canReadGitTimestamps();

export default defineConfig({
  lang: 'ja',
  title: 'Takos Docs',
  description:
    'AIエージェントによるサービスとソフトウェアの民主化基盤 Takos の全体像、アプリ構成、デプロイ、プラットフォーム仕様をまとめた公式 docs',
  cleanUrls: true,
  lastUpdated: enableLastUpdated,
  themeConfig: {
    siteTitle: 'Takos Docs',
    search: {
      provider: 'local',
    },
    nav: [
      { text: '概要', link: '/overview/' },
      { text: 'はじめる', link: '/get-started/' },
      { text: 'アプリ構成', link: '/apps/' },
      { text: 'デプロイ', link: '/deploy/' },
      { text: 'ホスティング', link: '/hosting/' },
      { text: 'プラットフォーム', link: '/platform/' },
      { text: 'PaaS Core', link: '/takos-paas/' },
      { text: 'リファレンス', link: '/reference/' },
      { text: 'Contributing', link: '/contributing/' },
      { text: 'サンプル', link: '/examples/' },
    ],
    sidebar: [
      {
        text: '概要',
        items: [
          { text: 'Takos 全体像', link: '/overview/' },
        ],
      },
      {
        text: 'はじめる',
        items: [
          { text: 'スタートガイド', link: '/get-started/' },
          { text: 'はじめてのアプリ', link: '/get-started/your-first-app' },
          { text: 'プロジェクト構成', link: '/get-started/project-structure' },
          { text: 'ローカル開発', link: '/get-started/local-development' },
          { text: 'Local Shell', link: '/get-started/local-shell' },
        ],
      },
      {
        text: 'アプリ構成',
        items: [
          { text: 'アプリマニフェスト', link: '/apps/manifest' },
          { text: 'Services', link: '/apps/services' },
          { text: 'Containers', link: '/apps/containers' },
          { text: 'Workers', link: '/apps/workers' },
          { text: 'Routes', link: '/apps/routes' },
          { text: '環境変数', link: '/apps/environment' },
          { text: 'MCP Server', link: '/apps/mcp' },
          { text: 'OAuth', link: '/apps/oauth' },
          { text: 'File Handlers', link: '/apps/file-handlers' },
        ],
      },
      {
        text: 'デプロイ',
        items: [
          { text: '概要', link: '/deploy/' },
          { text: 'deploy', link: '/deploy/deploy' },
          { text: 'deploy-group', link: '/deploy/deploy-group' },
          { text: 'Repository / Catalog', link: '/deploy/store-deploy' },
          { text: 'Namespace', link: '/deploy/namespaces' },
          { text: 'ロールバック', link: '/deploy/rollback' },
          { text: 'トラブルシューティング', link: '/deploy/troubleshooting' },
        ],
      },
      {
        text: 'ホスティング',
        items: [
          { text: '概要', link: '/hosting/' },
          { text: '環境ごとの差異', link: '/hosting/differences' },
          { text: 'Cloudflare', link: '/hosting/cloudflare' },
          { text: 'AWS', link: '/hosting/aws' },
          { text: 'GCP', link: '/hosting/gcp' },
          { text: 'Kubernetes', link: '/hosting/kubernetes' },
          { text: 'セルフホスト', link: '/hosting/self-hosted' },
          { text: 'Multi-cloud', link: '/hosting/multi-cloud' },
          { text: 'ローカル開発', link: '/hosting/local' },
        ],
      },
      {
        text: 'アーキテクチャ',
        items: [
          { text: '概要', link: '/architecture/' },
          {
            text: 'System Architecture',
            link: '/architecture/system-architecture',
          },
          { text: 'Service Topology', link: '/architecture/service-topology' },
          { text: 'Kernel', link: '/architecture/kernel' },
          { text: 'Deploy System', link: '/architecture/deploy-system' },
          { text: 'App Publications', link: '/architecture/app-publications' },
          { text: 'Control Plane', link: '/architecture/control-plane' },
          { text: 'Tenant Runtime', link: '/architecture/tenant-runtime' },
          { text: 'Container Hosts', link: '/architecture/container-hosts' },
          { text: 'Runtime Service', link: '/architecture/runtime-service' },
          { text: '互換性と制限', link: '/architecture/compatibility' },
        ],
      },
      {
        text: 'プラットフォーム',
        items: [
          { text: 'Road to 1.0', link: '/platform/road-to-1.0' },
          { text: 'Space', link: '/platform/spaces' },
          { text: 'Threads and Runs', link: '/platform/threads-and-runs' },
          { text: 'Store', link: '/platform/store' },
          { text: '課金', link: '/platform/billing' },
          { text: 'Default Groups', link: '/platform/default-apps' },
          { text: '互換性', link: '/platform/compatibility' },
          {
            text: 'Resource Governance',
            link: '/platform/resource-governance',
          },
          { text: 'takos-docs', link: '/platform/takos-docs' },
          { text: 'takos-excel', link: '/platform/takos-excel' },
          { text: 'takos-slide', link: '/platform/takos-slide' },
          { text: 'takos-computer', link: '/platform/takos-computer' },
          { text: 'yurucommu', link: '/platform/yurucommu' },
        ],
      },
      {
        text: 'Takos PaaS Core',
        collapsed: true,
        items: [
          { text: '概要', link: '/takos-paas/' },
          { text: 'Current State (実装状況)', link: '/takos-paas/current-state' },
          { text: 'Core Contract v1.0', link: '/takos-paas/core/01-core-contract-v1.0' },
          { text: 'v1.0 Implementation Checklist', link: '/takos-paas/10-v1.0-implementation-checklist' },
          {
            text: 'Authoring Guides',
            items: [
              { text: 'Authoring Guide', link: '/takos-paas/guides/authoring-guide' },
              { text: 'Descriptor Authoring', link: '/takos-paas/guides/descriptor-authoring-guide' },
              { text: 'Plugin Authoring', link: '/takos-paas/guides/plugin-authoring-guide' },
            ],
          },
          {
            text: 'Implementation',
            items: [
              { text: 'Implementation Strategy', link: '/takos-paas/implementation/implementation-strategy' },
              {
                text: 'Cloudflare Containers Strategy',
                link: '/takos-paas/implementation/cloudflare-containers-strategy',
              },
              { text: 'Provider Descriptor Catalog', link: '/takos-paas/implementation/provider-descriptor-catalog' },
              {
                text: 'Provider Descriptor Guidelines',
                link: '/takos-paas/implementation/provider-descriptor-guidelines',
              },
              {
                text: 'Cloudflare Containers Provider',
                link: '/takos-paas/implementation/providers/cloudflare-containers',
              },
              { text: 'Cloudflare Workers Provider', link: '/takos-paas/implementation/providers/cloudflare-workers' },
            ],
          },
          { text: 'Official Descriptor Set v1', link: '/takos-paas/descriptors/official-descriptor-set-v1' },
          { text: 'Migration: current → deploy-v2', link: '/takos-paas/migration/current-takos-to-deploy-v2' },
          {
            text: 'Tests',
            items: [
              { text: 'Conformance Tests', link: '/takos-paas/tests/conformance-tests' },
              { text: 'Condition Reason Catalog', link: '/takos-paas/tests/condition-reason-catalog' },
            ],
          },
        ],
      },
      {
        text: 'リファレンス',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'CLI 認証', link: '/reference/cli-auth' },
          { text: 'API', link: '/reference/api' },
          { text: 'Database', link: '/reference/database' },
          { text: 'Manifest Spec', link: '/reference/manifest-spec' },
          { text: 'Component Matrix', link: '/reference/component-matrix' },
          { text: '用語集', link: '/reference/glossary' },
        ],
      },
      {
        text: 'Contributing',
        collapsed: true,
        items: [
          { text: '概要', link: '/contributing/' },
          { text: 'Current State', link: '/contributing/current-state' },
          { text: 'Acceptance Matrix', link: '/contributing/acceptance-matrix' },
          {
            text: 'Acceptance Test Backlog',
            link: '/contributing/acceptance-test-backlog',
          },
          { text: 'API Surface', link: '/contributing/api-surface' },
          {
            text: 'System Architecture Plan',
            link: '/contributing/system-architecture-implementation-plan',
          },
          {
            text: 'Architecture Alignment',
            link: '/contributing/architecture-alignment-validation',
          },
          {
            text: 'Process Role Validation',
            link: '/contributing/process-role-validation',
          },
          {
            text: 'Kernel Plugin Boundary Audit',
            link: '/contributing/kernel-plugin-boundary-audit',
          },
          {
            text: 'Control to PaaS Migration',
            link: '/contributing/control-to-paas-migration-inventory',
          },
          {
            text: 'Deploy Topology Notes',
            link: '/contributing/deploy-topology-notes',
          },
          {
            text: 'Production Gap Burndown',
            link: '/contributing/production-gap-burndown',
          },
          { text: 'Release Gate', link: '/contributing/release-gate' },
          { text: 'CI Release Gate', link: '/contributing/ci-release-gate' },
          {
            text: 'Release Artifact Manifest',
            link: '/contributing/release-artifact-manifest',
          },
          {
            text: 'Real Backend E2E Plan',
            link: '/contributing/real-backend-e2e-plan',
          },
          { text: 'Self-host E2E', link: '/contributing/self-host-e2e' },
          {
            text: 'Self-host Runbook',
            link: '/contributing/self-host-runbook',
          },
          { text: 'Smoke', link: '/contributing/smoke' },
          { text: 'Compose Smoke', link: '/contributing/compose-smoke' },
          {
            text: 'Compose Real Smoke',
            link: '/contributing/compose-real-smoke',
          },
          {
            text: 'Docker Provider Smoke',
            link: '/contributing/docker-provider-smoke',
          },
          { text: 'Git Source Smoke', link: '/contributing/git-source-smoke' },
          {
            text: 'Postgres Storage Smoke',
            link: '/contributing/postgres-storage-smoke',
          },
          {
            text: 'Redis Queue Smoke',
            link: '/contributing/redis-queue-smoke',
          },
          {
            text: 'Object Storage Smoke',
            link: '/contributing/object-storage-smoke',
          },
          {
            text: 'Router Config Smoke',
            link: '/contributing/router-config-smoke',
          },
          {
            text: 'Runtime Agent API Smoke',
            link: '/contributing/runtime-agent-api-smoke',
          },
        ],
      },
      {
        text: 'サンプル',
        items: [
          { text: 'シンプルな Worker', link: '/examples/simple-worker' },
          { text: 'Worker + DB', link: '/examples/worker-with-db' },
          {
            text: 'Worker + Container',
            link: '/examples/worker-with-container',
          },
          { text: 'MCP Server', link: '/examples/mcp-server' },
          { text: 'マルチサービス構成', link: '/examples/multi-service' },
        ],
      },
    ],
    docFooter: {
      prev: '前のページ',
      next: '次のページ',
    },
    outline: {
      level: [2, 3],
      label: 'このページの内容',
    },
    lastUpdated: enableLastUpdated
      ? {
        text: '最終更新',
      }
      : false,
    returnToTopLabel: 'トップへ戻る',
    sidebarMenuLabel: 'メニュー',
    darkModeSwitchLabel: 'テーマ切替',
    lightModeSwitchTitle: 'ライトモード',
    darkModeSwitchTitle: 'ダークモード',
  },
  head: [['meta', { name: 'theme-color', content: '#0f766e' }]],
});
