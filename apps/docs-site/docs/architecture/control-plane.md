# Control Plane

::: tip Status
このページは current implementation の構成を説明します。ここでいう control plane は Takos の web/API worker、dispatch、background worker、container host 群をまとめたものです。
:::

## 役割

Takos control plane は次を担当します。

- browser/CLI からの `/api/*` request
- auth / OAuth / billing / setup
- app deployment と rollout
- repo / resource / skill / notification / session の管理
- runtime-host / executor-host / browser-host との連携

## 実行コンポーネント

```text
browser / CLI
  -> takos (web/API worker)
     -> app services / DB / queues / R2 / DO
     -> takos-dispatch
     -> takos-worker (egress / background)
     -> takos-runtime-host
        -> takos-executor-host
        -> takos-browser-host
```

main worker (`takos`) は `takos-dispatch`、`takos-worker`、`takos-runtime-host` に直接の service binding を持ちます。`takos-executor-host` と `takos-browser-host` は main worker から直接接続せず、runtime-host や worker を経由して到達します。

### `takos`

`wrangler.toml` で定義される main worker です。役割:

- SPA + `/api/*`
- session / PAT / OAuth
- setup
- billing webhook 以外の billing UI API
- route registration と control-plane cron

### `takos-dispatch`

tenant hostname routing を受け持つ dispatch worker です。WFP dispatch namespace と Routing DO を使って tenant request を正しい runtime へ渡します。

### `takos-worker`

background worker です。役割:

- run queue
- index queue
- workflow queue
- deployment queue
- egress proxy
- background cron / recovery

### container host 群

| worker | role |
| --- | --- |
| `takos-runtime-host` | runtime container の host |
| `takos-executor-host` | agent executor container の host |
| `takos-browser-host` | browser automation container の host |

host worker は request の入口であると同時に、container から control plane へ戻る proxy contract の境界でもあります。

## API surface

current API router は route family 単位で次をまとめます。

- public/optional auth: explore, profiles, public share, MCP callback
- authenticated console APIs: me, spaces, repos, resources, threads, runs, skills, sessions, notifications
- operator APIs: services, custom domains, app deployments, billing
- session-auth SPA APIs: OAuth consent

詳しくは [API リファレンス](/reference/api) を参照してください。

## 永続化の構成

control plane の state は D1 schema group に分かれています。

| schema group | responsibility |
| --- | --- |
| Accounts | account, membership, profile, follow/block/mute |
| Auth | auth session, PAT, service token |
| Billing | billing account, plan, usage event, usage rollup, transaction |
| Repos | repository, commit/blob/tree, releases, PR, workflow sync |
| Agents | thread, message, run, artifact, memory, skill, agent task |
| Services | service, binding, common env links |
| OAuth | client, consent, token, auth code, MCP OAuth state |
| Platform | resource, session, notification, shortcut, infra endpoint |
| Workflows | workflow run, job, step, secret, artifact |
| Workers | app, deployment, custom domain, runtime setting, managed token |

この構成は old docs の `app_environments` / `tracks` / `space_plans` 中心モデルとは異なります。現在の docs では schema group と責務のほうを正本として扱います。

## Request flow

### browser / CLI -> API

```text
client
  -> takos
  -> auth middleware
  -> route family
  -> application service
  -> D1 / R2 / queues / service bindings
```

### tenant / agent runtime

```text
client or agent
  -> takos / takos-dispatch
  -> runtime-host / executor-host / browser-host
  -> container
  -> proxy back to takos or takos-worker when needed
```

この構成により、runtime の compute と control-plane の stateful API を分離しています。

## Queue と stream

Takos は queue と DO ベースの notifier を併用します。

- queue: run, index, workflow, deployment
- DO stream: run notifier, notification notifier
- DO infra: session, routing, git push lock
- container DO: runtime, executor, browser

`/api/runs/:id/sse` と `/api/notifications/sse` は current public stream surface です。

## Locking / state management

current implementation は「単一の `tracks` テーブル」に依存しません。代わりに次の単位で状態を持ちます。

- app deployment state
- rollout state
- service / worker deployment state
- resource / binding / common env reconcile state
- DO-local session / proxy token state

operator が見るべき詳細は [Release System](./release-system.md) と [Resource Governance](./resource-governance.md) を参照してください。
