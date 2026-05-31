# システムアーキテクチャ

> このページでわかること: Takos を構成するサービスとその役割分担。

Takos は Takosumi PaaS の上で動作するセルフホスト型プロダクトです。 AI
エージェントと会話してソフトウェアを作る「ソフトウェアの民主化」を目指しています。

## プロダクトサービスと substrate

Takos product は単一の public/control Worker と Git / agent containers で構成します。`takos-git` と
`takos-agent` はユーザー向けワーカーを追加でデプロイする境界ではなく、Takos 製品境界内の
内部 capability です。表の Takosumi 系は Takos が動く substrate / account plane / installer
であり、 Takos の product service ではありません。

| service            | owner path        | role                                                                             |
| ------------------ | ----------------- | -------------------------------------------------------------------------------- |
| `takos-worker`     | `takos/src/worker` | public/control Worker、Hono API、OIDC consumer、app-local profile               |
| Takos UI           | `takos/web/`      | browser UI                                                                       |
| `takos-git`        | `takos/containers/git/` | Git Smart HTTP、repositories、refs、object storage                         |
| `takos-agent`      | `takos/containers/agent/` | agent execution container                                                  |
| `takosumi`         | `takosumi/`       | AppSpec install / Deployment apply engine                                        |
| Takosumi Accounts  | `takosumi-cloud/` | operator account plane reference implementation                                  |
| Takosumi installer | `takosumi/`       | source fetch/verify、AppSpec parse、connect/listen/publication resolution、Deployment append |

`takos-agent-engine` は service ではなく library です。

## 責務の境界

- ID / OIDC issuer / 課金 / Installation のオーナーシップは operator account
  plane が持ちます (リファレンス実装: Takosumi Accounts)
- デプロイと runtime lifecycle は Takosumi kernel が持ちます
- Git URL からのインストール、`.takosumi.yml` AppSpec、workflow は takosumi
  が持ちます
- Takos product は UI / public API / AI agent / バンドルアプリ体験を持ちます
- バンドルアプリは各 product root で独立管理されます

## Install flow

```text
Store / install UI
  -> Takosumi installer POST /v1/installations/dry-run
  -> user approval
  -> Takosumi installer POST /v1/installations
  -> takosumi fetch / verify source / resolve AppSpec
  -> Deployment record
```

Build service / CI は Installer API の前に source を prepare します。kernel が
build command を実行したり、AppSpec を generated manifest に rewrite したりは
しません。

## Agent / Control-Plane Flow

```text
Takos UI / API
  -> takos-worker
  -> takos-agent container
  -> takosumi internal control RPC
  -> provider / runtime-agent
  -> workload resources
```

This is an agent/control-plane operation path. It is not the installed app public
HTTP request path.

```text
installed app HTTP request:
  client
    -> provider-native ingress
    -> installed workload
    -> provider-native ingress
    -> client
```

## ドキュメントの配置

- Takos product docs: `takos/docs/`
- Takosumi kernel docs: `takosumi/docs/`
- Takosumi Accounts docs: `takosumi-cloud/docs/`
- Takosumi docs: `takosumi/docs/`

プロダクト横断の用語集は ecosystem root の `docs/` にあります。
