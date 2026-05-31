# サービストポロジー

> このページでわかること: Takos
> のローカル開発環境を構成するサービスの一覧とポート番号。

Takos の実装は単一の `takos-worker` 入口 (`src/worker`)、UI (`web`)、Git / agent containers
(`containers/git` / `containers/agent`) に分かれます。`takos-git` と
`takos-agent` は別ユーザー向け Worker 境界を追加してデプロイするコンポーネントではなく、Takos
製品境界内の内部 capability です。ローカル環境ではこれに加えて Takosumi 系の
サービスも起動します。

## ローカルサービス一覧

上 4 つが Takos product の runtime component、残りの Takosumi 系は substrate 側です。

| サービス                  |  ポート | 配置先               | 役割                                                                                         |
| ------------------------- | ------: | -------------------- | -------------------------------------------------------------------------------------------- |
| `takos-worker`            |  `8787` | `src/worker`         | OIDC consumer、app-local profile、Web/API ゲートウェイ                                       |
| Takos UI                  |  `5173` | `web/`               | browser UI development server                                                                |
| `takosumi kernel`         |  `8788` | `../takosumi/`       | AppSpec install / Deployment apply エンジン。runtime routing は provider data plane が担当   |
| `takosumi-cloud accounts` | `8787+` | `../takosumi-cloud/` | account plane のリファレンス実装。OIDC issuer / identity broker / BillingPort / Installation |
| `takos-agent`             |  `8789` | `containers/agent/`  | エージェント実行 container                                                                   |
| `takos-git`               |  `8790` | `containers/git/`    | Git ホスティング、Smart HTTP、refs、objects                                                  |
| `postgres`                | `15432` | shell compose        | app / Takosumi / Git のローカル永続化                                                        |
| `redis`                   | `16379` | shell compose        | Takosumi の queue / cache                                                                    |

## サービス間の呼び出し

- ブラウザと API client のトラフィックは `takos-worker` から入ります
- `takos-worker` は `takosumi` / `takos-git` を signed internal RPC
  経由で呼び出します
- Git Smart HTTP の公開エンドポイントは `takos-worker`。`takos-git` は signed な
  internal リクエストのみを受け付けます
- `takos-agent` は Takos の agent workload を実行し、必要なときに kernel の
  runtime control ports と通信します
- `takos-worker` は app 固有のデータを保存しますが、account / 課金 / OIDC issuer /
  Installation のオーナーシップは持ちません
- ローカルでのサービスディスカバリは `TAKOSUMI_INTERNAL_URL`、
  `TAKOS_GIT_INTERNAL_URL`、`TAKOS_AGENT_INTERNAL_URL` を fallback
  として使います
- `TAKOS_INTERNAL_SERVICE_SECRET` はローカル compose だけで共有されます。app の
  trusted-proxy edge は `TAKOS_INTERNAL_API_SECRET`、Takosumi は
  `TAKOSUMI_INTERNAL_API_SECRET` として同じ値を受け取ります

## 責務の境界

- デプロイと runtime lifecycle のオーナーシップは 3 つの sibling product
  に分かれます:
  - **インストールパイプライン / source fetch / `.takosumi.yml` parse /
    publish-listen resolution** → `takosumi`
  - **Deployment apply / rollback / routing / resource provisioning** →
    `takosumi kernel`
  - **account / 課金 / OIDC issuer / Installation 台帳** → Takosumi Accounts
- shell compose にスタンドアロンの deploy/runtime サービスを足さないでください
- 本番・staging の deploy 設定は `takos-private` が管理します。この shell は
  ローカル合成のみを扱います
- 共有が必要な処理は、明確なオーナーを持つドメインライブラリにする場合を除き、
  サービスローカルに留めてください
