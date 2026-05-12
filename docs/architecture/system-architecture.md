# Takos System Architecture

Takos は **Takosumi PaaS の上で動作する self-hostable な product**。 AI agents /
Git / chat / spaces / memory / tools を駆使した **AI エージェントによる
ソフトウェアの民主化 (democratization of software through AI agents)** を core
concept とする。 Takosumi kernel は generic PaaS kernel、 operator account plane
(managed example: takosumi-cloud の Takosumi Accounts) は account / billing /
AppInstallation ledger、 takosumi-git は Git URL install と manifest compile を
担当します。 Takos は Takosumi 上の 1 product であり、 architecture 上の特権
layer ではありません。

## Service set

| service           | owner path        | role                                                          |
| ----------------- | ----------------- | ------------------------------------------------------------- |
| `takos-app`       | `takos/app/`      | Web UI、public API gateway、OIDC consumer、app-local profile  |
| `takos-git`       | `takos/git/`      | Git Smart HTTP、repositories、refs、object storage            |
| `takos-agent`     | `takos/agent/`    | agent execution service                                       |
| `takosumi`        | `takosumi/`       | manifest deploy engine                                        |
| Takosumi Accounts | `takosumi-cloud/` | OIDC issuer、billing owner、AppInstallation ledger            |
| `takosumi-git`    | `takosumi-git/`   | Git URL install、workflow、artifact resolve、manifest compile |

`takos-agent-engine` は service ではなく library です。

## Ownership boundaries

- identity / OIDC issuer / billing / AppInstallation ownership は Takosumi
  Accounts が持つ
- deploy / runtime lifecycle は Takosumi kernel が持つ
- Git URL install、`.takosumi/` project convention、workflow は takosumi-git
  が持つ
- Takos product は UI、public API、AI agent workflow、bundled app experience
  を持つ
- bundled apps は product root ごとに独立管理する

## Install flow

```text
Store / install UI
  -> Takosumi Accounts install preview
  -> user approval
  -> AppInstallation create
  -> takosumi-git fetch / build / compile
  -> takosumi kernel POST /v1/deployments
  -> AppInstallation ready
```

## Runtime flow

```text
Takos UI / API
  -> takos-agent
  -> takosumi internal control RPC
  -> provider / runtime-agent
  -> workload resources
```

## Product docs split

- Takos product docs: `takos/docs/`
- Takosumi kernel docs: `takosumi/docs/`
- Takosumi Accounts docs: `takosumi-cloud/docs/`
- takosumi-git docs: `takosumi-git/docs/`

Cross-product vocabulary lives in ecosystem root `docs/`.
