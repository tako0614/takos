# Architecture Diagrams

> このページでわかること: Takos エコシステムの主要な component / sequence /
> state 関係を mermaid 図で俯瞰する。文字情報は
> [System Architecture](./system-architecture.md) と
> [Takosumi AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md) を元にした図示版。

## ねらい

- 新規参加者が Takos の主要 component を 1 枚で把握できるようにする
- `resolveDeployment` / `applyDeployment` / rollback の主要 sequence を可視化する
- Deployment lifecycle の state 遷移を condition reason との対応付きで示す

## Component Diagram

Takosumi kernel (`takosumi`) を中心に、user / AI agent から provider 実体まで
の主要 component を表す。 `takos-app` は public API gateway として user request
を kernel に橋渡しする。 provider plugin bundle は kernel の lookup で動的に
読み込まれ、Cloudflare / AWS / GCP / Kubernetes / Self-hosted 各 target に
materialize する。

```mermaid
graph TB
  User[User / AI Agent]
  CLI[takos-cli]
  AppGateway[takos-app<br/>public API gateway]
  Kernel[takosumi Kernel<br/>resolveDeployment / applyDeployment]
  Storage[(Deployment Store<br/>Postgres / D1)]
  Plugin[Provider Plugin Bundle<br/>composite resolver / binding resolver / materializer]
  Agent[takos-agent<br/>Rust execution service]
  Git[takos-git<br/>Git Smart HTTP / object storage]
  CF[Cloudflare<br/>Workers / D1 / R2 / Queues / OCI adapter]
  AWS[AWS<br/>Lambda / Fargate / S3 / RDS]
  GCP[GCP<br/>Cloud Run / GCS / Cloud SQL]
  K8S[Kubernetes<br/>Deployment / Service / PVC]
  Self[Self-hosted<br/>Compose / local runtime]

  User --> CLI
  User --> AppGateway
  CLI --> AppGateway
  AppGateway --> Kernel
  Kernel --> Storage
  Kernel --> Plugin
  Kernel --> Agent
  Kernel --> Git
  Plugin --> CF
  Plugin --> AWS
  Plugin --> GCP
  Plugin --> K8S
  Plugin --> Self
  Agent -. internal control RPC .-> Kernel
```

ポイント:

- kernel は plugin bundle を介してのみ provider に到達する。直接 Cloudflare /
  AWS SDK を call しない
- agent service は kernel の internal control RPC を呼び戻す single-direction
  dependency を持つ。tenant runtime からの直接 outbound は存在しない
- public API surface は `takos-app` に閉じ、kernel は internal API のみ公開する

## Sequence Diagram: Installation Dry-run

Takosumi installer の dry-run シーケンス。`.takosumi.yml` (= AppSpec) を読み、
変更差分と expected pin を response として返す。dry-run は Deployment entity
として永続化しない。

```mermaid
sequenceDiagram
  participant User
  participant Installer as takosumi / CI
  participant CLI as takosumi CLI
  participant K as Kernel<br/>(takosumi)
  participant PG as Policy Gate

  User->>CLI: takosumi install dry-run
  CLI->>K: POST /v1/installations/dry-run
  K->>Installer: fetch source / parse AppSpec / resolve artifacts
  Installer-->>K: AppSpec + source pin
  K->>K: validate components / refs / provider decision
  K->>PG: evaluate policies (boundary, approval)
  PG-->>K: PolicyDecision
  K-->>CLI: dry-run result + expected pin
  CLI-->>User: changes / cost / expected
```

dry-run 段階では provider への副作用はない。失敗時は validation / policy /
provider resolution の理由が response error として返る。

## Sequence Diagram: applyDeployment

resolved Deployment を実際に provider に materialize する更新系シーケンス。
provider plugin の `materialize` は冪等であることを契約とし、kernel は
`ProviderObservation` を介して drift を観測する。

```mermaid
sequenceDiagram
  participant User
  participant CLI as takosumi CLI
  participant K as Kernel
  participant DS as DeploymentService
  participant DB as Deployment Store
  participant Plug as Provider Plugin
  participant Cloud as Cloudflare / AWS / GCP / K8s
  participant Obs as ProviderObservation

  User->>CLI: takosumi deploy <installation-id> --source <source>
  CLI->>K: POST /v1/installations/{id}/deployments
  K->>DS: load Deployment(resolved)
  DS->>DB: SELECT
  DB-->>DS: row
  DS-->>K: Deployment
  K->>DS: transition resolved -> applying
  DS->>DB: UPDATE state=applying
  K->>Plug: materialize(plan)
  Plug->>Cloud: provider API calls (idempotent)
  Cloud-->>Plug: object refs / status
  Plug->>Obs: emit ProviderObservation
  Obs-->>K: drift / convergence signals
  alt all converged
    K->>DS: transition applying -> applied
    DS->>DB: UPDATE state=applied
  else materialization failure
    K->>DS: transition applying -> failed
    DS->>DB: UPDATE state=failed, conditions[]
  end
  K-->>CLI: Deployment + ServingConverged|Degraded
  CLI-->>User: apply result
```

## State Machine: Deployment Lifecycle

Deployment 行が取りうる主要 state とその遷移。 condition reason との対応は
[Condition Reason Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/status-output.md) を参照。

```mermaid
stateDiagram-v2
  [*] --> running: POST /v1/installations
  running --> succeeded: ServingConverged
  running --> failed: ProviderMaterializationFailed<br/>ProviderRateLimited (exhausted)
  succeeded --> running: POST /v1/installations/{id}/deployments
  succeeded --> rolled_back: POST /v1/installations/{id}/rollback
  failed --> rolled_back: POST /v1/installations/{id}/rollback
  rolled_back --> [*]
  succeeded --> [*]: superseded by next Deployment
  failed --> [*]: superseded by next Deployment
```

state 遷移の補足:

- `running -> failed`: provider 側で `ProviderMaterializationFailed` /
  `ProviderRateLimited` が観測されると failed に落ちる。retry policy が許す限り
  running のまま retry する
- `succeeded -> running`: 新しい Deployment append または repair が始まる
- `rolled_back`: 直近 healthy Deployment の resolved graph を再 apply する。
  `RollbackIncompatible` 等で失敗した場合は failed に落ちる

## 関連ドキュメント

- [System Architecture](./system-architecture.md) — service / repository
  boundary の詳細
- [Deploy System](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/deploy-system.md) — primitive と group 機能の deploy
  pipeline
- [Takosumi AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md) — AppSpec /
  Installation / Deployment の current contract
- [Condition Reason Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/status-output.md) —
  `Deployment.conditions[].reason` の一覧
- [Operations: Troubleshooting](https://github.com/tako0614/takos-private/blob/master/docs/operations/troubleshooting.md) — 実運用での
  failure 対応
- [Performance Baseline](/performance/baseline) — kernel resolve / apply の
  baseline 値
