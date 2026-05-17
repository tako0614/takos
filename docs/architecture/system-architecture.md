# システムアーキテクチャ

> このページでわかること: Takos を構成するサービスとその役割分担。

Takos は Takosumi PaaS の上で動作するセルフホスト型プロダクトです。
AI エージェントと会話してソフトウェアを作る「ソフトウェアの民主化」を目指しています。

## プロダクトサービスと substrate

Takos product のサービスは `takos-app` / `takos-git` / `takos-agent` の 3 つです。
表の Takosumi 系は Takos が動く substrate / account plane / installer であり、
Takos の product service ではありません。

| service           | owner path        | role                                                          |
| ----------------- | ----------------- | ------------------------------------------------------------- |
| `takos-app`       | `takos/app/`      | Web UI、public API gateway、OIDC consumer、app-local profile  |
| `takos-git`       | `takos/git/`      | Git Smart HTTP、repositories、refs、object storage            |
| `takos-agent`     | `takos/agent/`    | agent execution service                                       |
| `takosumi`        | `takosumi/`       | manifest deploy engine                                        |
| Takosumi Accounts | `takosumi-cloud/` | operator account plane reference implementation               |
| `takosumi-git`    | `takosumi-git/`   | Git URL install、workflow、artifact resolve、manifest compile |

`takos-agent-engine` は service ではなく library です。

## 責務の境界

- ID / OIDC issuer / 課金 / Installation のオーナーシップは operator account
  plane が持ちます (リファレンス実装: Takosumi Accounts)
- デプロイと runtime lifecycle は Takosumi kernel が持ちます
- Git URL からのインストール、`.takosumi/` プロジェクト規約、workflow は
  takosumi-git が持ちます
- Takos product は UI / public API / AI agent / バンドルアプリ体験を持ちます
- バンドルアプリは各 product root で独立管理されます

## Install flow

```text
Store / install UI
  -> Takosumi Accounts install preview
  -> user approval
  -> Installation create
  -> takosumi-git fetch / build / compile
  -> takosumi kernel POST /v1/deployments
  -> Installation ready
```

## Runtime flow

```text
Takos UI / API
  -> takos-agent
  -> takosumi internal control RPC
  -> provider / runtime-agent
  -> workload resources
```

## ドキュメントの配置

- Takos product docs: `takos/docs/`
- Takosumi kernel docs: `takosumi/docs/`
- Takosumi Accounts docs: `takosumi-cloud/docs/`
- takosumi-git docs: `takosumi-git/docs/`

プロダクト横断の用語集は ecosystem root の `docs/` にあります。
