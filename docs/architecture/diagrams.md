# Architecture Diagrams

> このページでわかること: Takos エコシステムの主要な component / sequence / state 関係を mermaid
> 図で俯瞰する。文字情報は [System Architecture](./system-architecture.md) と
> [Takosumi AppSpec](https://takosumi.com/docs/reference/manifest) を元にした図示版。

## ねらい

- 新規参加者が Takos の主要 component を 1 枚で把握できるようにする
- AppSpec / Installation / Deployment の public model を可視化する
- reference implementation internals は別 section として読む

## Component Diagram

Public model は AppSpec → Installation → Deployment で止まります。`takos-app` は Takos product API を所有し、install /
update workflow は operator account plane (リファレンス実装: Takosumi Accounts) を経由して Takosumi Installer API に接続します。

```mermaid
graph TB
  User[User / AI Agent]
  CLI[takos-cli]
  AppGateway[takos-app<br/>public API gateway]
  Accounts[Takosumi Accounts<br/>operator account plane]
  Kernel[Takosumi Installer API]
  Storage[(Installation / Deployment Ledger)]
  Agent[takos-agent<br/>Rust execution service]
  Git[takos-git<br/>Git Smart HTTP / object storage]

  User --> CLI
  User --> AppGateway
  CLI --> AppGateway
  AppGateway --> Accounts
  Accounts --> Kernel
  Kernel --> Storage
  Kernel --> Agent
  Kernel --> Git
```

ポイント:

- Takosumi public concept は AppSpec / Installation / Deployment
- cloud / OS credential、provider adapter、runtime-agent、WAL は reference implementation internals
- Takos product public API surface は `takos-app` が所有する。Takosumi Installer API は operator / CLI / automation
  向けの別 surface として扱う

## Sequence Diagram: Installation Dry-run

Takosumi installer の dry-run シーケンス。`.takosumi.yml` (= AppSpec) を読み、変更差分と expected pin を response
として返す。dry-run は Deployment entity として永続化しない。

```mermaid
sequenceDiagram
  participant User
  participant Installer as takosumi / CI
  participant CLI as takosumi CLI
  participant K as Kernel<br/>(takosumi)
  participant PG as Policy Gate

  User->>CLI: takosumi install dry-run
  CLI->>K: POST /v1/installations/dry-run
  K->>Installer: fetch source / parse AppSpec / resolve publish-listen
  Installer-->>K: AppSpec + resolved source identity
  K->>K: validate components / bindings / provider decision
  K->>PG: evaluate policies (boundary, approval)
  PG-->>K: PolicyDecision
  K-->>CLI: dry-run result + expected pin
  CLI-->>User: changes / cost / expected
```

dry-run 段階では provider への副作用はない。失敗時は validation / policy / provider resolution の理由が response error
として返る。

## Reference Implementation Internals: applyDeployment

Installer API apply が Deployment を append し、provider / runtime-agent 側に operation envelope
を渡す更新系シーケンス。reference kernel は内部 WAL で retry を整理できますが、public Installer API は caller-supplied
idempotency key を受け取りません。

```mermaid
sequenceDiagram
  participant User
  participant CLI as takosumi CLI
  participant K as Kernel
  participant DS as DeploymentService
  participant DB as Deployment Store
  participant Binding as Provider Adapter
  participant Cloud as Cloudflare / AWS / GCP / K8s
  participant Obs as ProviderObservation

  User->>CLI: takosumi deploy <installation-id> --source <source>
  CLI->>K: POST /v1/installations/{id}/deployments
  K->>DS: resolve source / validate AppSpec / plan operation
  DS->>DB: INSERT Deployment(status=running)
  K->>Binding: apply(operation envelope)
  Binding->>Cloud: provider/runtime-agent operation
  Cloud-->>Binding: object refs / status
  Binding->>Obs: emit ProviderObservation
  Obs-->>K: drift / convergence signals
  alt apply succeeded
    K->>DS: complete Deployment
    DS->>DB: UPDATE status=succeeded, outputs, evidence
  else materialization failure
    K->>DS: fail Deployment
    DS->>DB: UPDATE status=failed, evidence, InstallationEvent
  end
  K-->>CLI: Deployment(status=succeeded|failed)
  CLI-->>User: apply result
```

## State Machine: Deployment Lifecycle

Deployment 行が取りうる主要 state とその遷移。`succeeded` / `failed` は terminal status です。新しい apply は新しい
Deployment を作り、rollback は `Installation.currentDeploymentId` と retained activation evidence を retained `succeeded`
Deployment へ戻します。

```mermaid
stateDiagram-v2
  [*] --> running: POST /v1/installations
  running --> succeeded: apply completed
  running --> failed: operator execution failed<br/>rate limit exhausted
  succeeded --> [*]: terminal history row
  failed --> [*]: terminal history row
```

```mermaid
stateDiagram-v2
  [*] --> current: retained succeeded Deployment
  current --> current: rollback pointer moves to another retained succeeded Deployment
  current --> current: new succeeded Deployment becomes current
```

state 遷移の補足:

- `running -> failed`: operator execution 側で recoverable retry を使い切った failure が観測されると failed
  に落ちる。retry policy が許す限り running のまま retry する
- new apply / repair: 既存 Deployment を running に戻さず、新しい Deployment row を append して `running` から始める
- rollback: retained succeeded Deployment を current pointer と retained activation evidence の authority
  として再選択する。historical Deployment record は改竄せず、新しい Deployment も作らない

## 関連ドキュメント

- [System Architecture](./system-architecture.md) — service / repository boundary の詳細
- [Deploy System](https://github.com/tako0614/takosumi/blob/main/docs/reference/architecture/deploy-system.md) —
  primitive と group 機能の deploy pipeline
- [Takosumi AppSpec](https://takosumi.com/docs/reference/manifest) — AppSpec /
  Installation / Deployment の current contract
- [Status Output](https://github.com/tako0614/takosumi/blob/main/docs/reference/status-output.md) — operator-facing
  status summary と InstallationEvent の読み方
- [Operations: Troubleshooting](https://github.com/tako0614/takos-private/blob/master/docs/operations/troubleshooting.md)
  —実運用での failure 対応
- [Performance Baseline](/performance/baseline) — kernel resolve / apply の baseline 値
