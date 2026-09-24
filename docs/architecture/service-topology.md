# サービストポロジー

> このページでわかること: Takos の runtime 境界と、ローカルの Docker Compose が起動する開発用 process の違い。

Takos の product 境界は **単一の Takos distribution worker** です。self-host / hosted distribution では Takos product
surface をこの worker が提供し、Takosumi Accounts、Takosumi deploy-control、dashboard、OpenTofu runner は外部 Takosumi
control plane が提供します。
`takos-agent` は別 product ではなく、Takos product 内で使う container capability です。Git ホスティングは
worker-native で、`takos-worker` が read-only Smart HTTP clone/fetch を R2 object store から配信します
(push は Takos repository API 経由)。

ローカルの Docker Compose は実装と smoke を扱いやすくするため、Takosumi control-plane source を `takosumi` dev sidecar process として
起動します。これは product の split-service 境界ではありません。

## Local Compose Services

| service        | default port | owner               | role                                                               |
| -------------- | -----------: | ------------------- | ------------------------------------------------------------------ |
| `takos-worker` |       `8787` | `src/worker`        | Takos product の HTTP 入口と local 統合 host                       |
| `takosumi`     |       `8788` | `../takosumi`       | Takosumi control-plane の確認と Run ledger 用の local 開発 sidecar |
| `takos-agent`  |       `8789` | `containers/agent`  | agent 実行 container                                               |
| `postgres`     |      `15432` | `compose.local.yml` | Takos / Takosumi の local 永続ストア                               |
| `redis`        |      `16379` | `compose.local.yml` | local queue / cache の実行基盤                                     |

この service 一式は `bun run doctor`、`bun run local:config`、`bun run local:e2e` で検査します。`local:e2e` は
この一式の上に証明専用の Docker Compose override を重ねます。そこに出る local issuer、固定の model endpoint、
executor bridge は製品の service ではなく test harness です。

## 呼び出しの形

- ブラウザと API の通信は `takos-worker` に入ります。
- 通常の実行経路は、公開 Takos API → `RUN_QUEUE` → executor / container の
  dispatch → `takos-agent` → token で絞った control RPC → 永続化された Run の
  status、output、event、assistant message です。`bun run local:e2e` は、health
  や gateway の到達性を agent の証拠として扱わず、この経路を終端の Run まで
  証明します。
- Docker Compose 内の `takosumi` は、Takosumi control-plane source の開発用 sidecar
  です。production / self-host の構成では、self-hoster または operator が運用する
  外部の Takosumi control-plane origin / API を使います。Takos Worker は
  Accounts、deploy-control、dashboard、OpenTofu runner の handler を
  プロセス内に載せません。
- Git Smart HTTP (read-only の clone / fetch) は `takos-worker` が R2 object
  store から worker-native に配信します。リポジトリへの書き込みは Git Smart
  HTTP ではなく Takos repository API を通ります。
- `takos-agent` は agent の workload を実行し、設定された control-plane /
  runtime endpoint を local smoke のために呼びます。

local の env 名 `TAKOSUMI_INTERNAL_URL`、`TAKOS_AGENT_INTERNAL_URL`、
`TAKOS_INTERNAL_SERVICE_SECRET`、`TAKOS_INTERNAL_API_SECRET`、
`TAKOSUMI_INTERNAL_API_SECRET` は Docker Compose / 開発用の配線です。hosted product の
サブドメインとして扱ったり、分割された公開 worker を再導入する理由にしたり
しないでください。

## 所有権のルール

- Takos が持つのは product 面です。chat、agent、memory、Workspace、アプリの
  起動、worker-native の Git と agent-container の UX、first-party の Takos
  Capsule output projection profile です。
- Takosumi が持つのは、OpenTofu control-plane の Workspace、Project、Capsule、
  Source、ProviderConnection、ProviderBinding、OpenTofu Run、StateVersion、
  Output、policy、監査、provider resolver、Capsule output projection 標準、
  Accounts plane です。Takos の会話 Thread / agent Run は Takos product の
  state のままで、2 つの Run の履歴は互換ではありません。
- production と staging の deploy 設定と secret は、この repo の外の operator
  環境に置きます。
- product model に独立した deploy / runtime service を足さないでください。
  local の sidecar は開発用の便利さの範囲に留めます。
