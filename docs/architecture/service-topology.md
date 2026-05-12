# Service Topology

`takos` は product shell です。Takos product の実装は `app/`、`git/`、`agent/`
の各 submodule が持ちます。sibling repository の `../takosumi/`、
`../takosumi-cloud/`、`../takosumi-git/` は Takosumi substrate / account plane /
installer として local stack に参加しますが、Takos product service ではありません。
この shell はローカル起動、境界検証、全体 docs を持ちます。

## Local Services

上 3 つが Takos product services、残りの Takosumi 系 service は substrate 側です。

| Service                   |    Port | Owner                | Responsibility                                                                                                                                                                                                                                    |
| ------------------------- | ------: | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `takos-app`               |  `8787` | `app/`               | OIDC consumer、app-local profile、public/browser/CLI API gateway                                                                                                                                                                                  |
| `takosumi kernel`         |  `8788` | `../takosumi/`       | compute substrate / manifest deploy engine。compiled Shape manifest apply、routing projection、resource provisioning、provider reconciliation を担当。install pipeline / account / billing は別 sibling (takosumi-git / Takosumi Accounts) に分離 |
| `takosumi-cloud accounts` | `8787+` | `../takosumi-cloud/` | Operator account plane reference implementation。OIDC issuer / identity broker / BillingPort / AppInstallation ledger                                                                                                                            |
| `takos-agent`             |  `8789` | `agent/`             | agent execution service。Takos product の agent workload を実行し、必要な runtime coordination だけ kernel control ports と接続する                                                                                                               |
| `takos-git`               |  `8790` | `git/`               | Git hosting、Smart HTTP、refs、objects、source resolution                                                                                                                                                                                         |
| `postgres`                | `15432` | shell compose        | local persistence for app、Takosumi、Git                                                                                                                                                                                                          |
| `redis`                   | `16379` | shell compose        | local queue/cache backing for Takosumi                                                                                                                                                                                                            |

## Internal Calls

- Browser and CLI traffic enters through `takos-app`.
- `takos-app` calls `takosumi` and `takos-git` with the canonical
  `takosumi-contract/internal-rpc` envelope, actor context, caller/audience, and
  route capabilities.
- Git Smart HTTP is public at `takos-app`; `takos-git` only accepts signed
  internal Smart HTTP requests.
- `takos-agent` executes agent workloads for Takos product features. It may use
  kernel-owned runtime control ports only for deployed compute coordination and
  can read Git internal endpoints when needed.
- `takos-app` may store app-owned data, but it does not own account / billing /
  OIDC issuer / AppInstallation semantics.
- Local service discovery falls back to `TAKOSUMI_INTERNAL_URL`,
  `TAKOS_GIT_INTERNAL_URL`, and `TAKOS_AGENT_INTERNAL_URL`.
- Internal services share `TAKOS_INTERNAL_SERVICE_SECRET` only in local compose;
  the app trusted-proxy edge also gets `TAKOS_INTERNAL_API_SECRET`, and Takosumi
  receives the same value as `TAKOSUMI_INTERNAL_API_SECRET`.

## Boundary Rules

- Deploy / runtime lifecycle ownership is split across three sibling products:
  - **Install pipeline / `.takosumi/app.yml` parser / workflow runner / manifest
    compile** → `takosumi-git` (sibling product, repo-level installer)
  - **Compiled manifest apply / plan / destroy / routing projection / resource
    provisioning / provider reconciliation** → `takosumi kernel` (sibling at
    `../takosumi/`)
  - **Account / billing / OIDC issuer / AppInstallation ledger** → Takosumi
    Accounts (`takosumi-cloud` account plane)
- Shell compose must not introduce standalone deploy or runtime services.
- `takos-private` owns production and staging deploy configuration; this shell
  only models local composition.
- Shared behavior must remain service-local unless it becomes a named domain
  library with a clear owner.
