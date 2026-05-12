# Hosting Secret Policy

このページは AWS / GCP / Kubernetes / self-hosted を含む hosting target で、 Terraform / Helm / `takos-private` の
secret 境界を固定する operator 向け policy です。

Takos product shell (`takos/`) は distribution profile、Terraform composition、 Helm chart、non-secret managed resource
id を持ちます。実 environment の secret 値、deploy credential、state backend credential、rotation 手順は `takos-private`
が正本です。Takosumi kernel は secret value を知らず、 manifest / runtime には secret reference または platform secret
binding だけを 渡します。

## Ownership

base layer (deploy / infra / runtime contract):

| owner                                      | 持つもの                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `takos/`                                   | Terraform module shape、plan fixture、Helm chart、non-secret output bridge、validator    |
| `takos-private`                            | production / staging tfvars 生成元、cloud credentials、runtime secrets、rotation runbook |
| cloud secret manager / k8s external secret | Secrets Manager / Secret Manager / External Secrets / Sealed Secrets などの値保管先      |
| Takosumi kernel                            | `resource.secret@v1` / secret-ref / runtime binding contract。raw value は保持しない     |

OIDC / launch token layer (mode 別。AppInstallation の identity 配線):

| mode                                    | OIDC client (`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`) の発行・rotation owner                                          | launch token (opaque) の発行・consume owner                                                                                | Takos runtime での受け取り                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Managed (Takosumi Accounts)**         | `operator.identity.oidc` namespace export で resolve される Takosumi Accounts が per-AppInstallation で発行・rotation | Takosumi Accounts が one-shot opaque token を発行し、`/consume` で redeem (token 本体は signing key を持たない)            | `identity.oidc@v1` / `install-launch-token@v1` AppBinding 経由で env (`ACCOUNTS_BASE_URL` / `INSTALL_LAUNCH_*`) を注入    |
| **Self-host (operator-owned Accounts)** | import 先の Takosumi Accounts が client を登録・rotation。Keycloak / Authentik / Auth0 等は upstream IdP として接続   | operator-owned Takosumi Accounts が opaque token を発行・consume を担う。launch token を使わない構成では env 自体が不要   | `takos-private` の `.secrets/<env>/` から AppBinding env として注入                                                       |
| **Takos runtime (consumer)**            | (生成しない。consumer として受け取るだけ)                                                                             | (生成しない。受け取った opaque token を Accounts `/consume` で redeem する relying party)                                  | AppBinding ベースで env (`OIDC_*` / `ACCOUNTS_BASE_URL` / `INSTALL_LAUNCH_*`) として消費                                  |

::: info OAuth client secret は Takos 自前ではない Installable App Model では Takos は OIDC consumer であり、OAuth
client を 自分では発行しません。**Takosumi Accounts** (`operator.identity.oidc` namespace export で resolve) が
installation ごとに OIDC client を発行し、`identity.oidc@v1` AppBinding の `secretRefs.clientSecret` を通じて
`OIDC_CLIENT_SECRET` を Takos runtime (Cloudflare Workers / k8s pod / docker container) に渡します。Takos operator
が触るのは consumer 側 secret (`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI`) と launch token redeem
の context env (`ACCOUNTS_BASE_URL` / `INSTALL_LAUNCH_INSTALLATION_ID` / `INSTALL_LAUNCH_REDIRECT_URI` /
`INSTALL_LAUNCH_CONSUME_PATH`) の **配置と rotation 反映** だけで、client 自身の発行・revoke は Takosumi Accounts 側の
installation lifecycle が起点になります。

self-host 環境では、operator-owned Takosumi Accounts 側で OIDC client を登録し、 Keycloak / Authentik / Auth0 / 自前
OIDC issuer は upstream IdP として接続します。 同じ env 名で `takos-private` の `.secrets/<env>/` に投入します。 :::

## Auth-related runtime secrets

Takos runtime に渡す auth 関連 secret の最低集合は以下です。値は `takos-private/apps/control/.secrets/<env>/`
に配置し、`secrets:sync:*` / `wrangler secret put` で deploy target に流します。

| name                              | 由来                                                          | 用途                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_CLIENT_ID`                  | Takosumi Accounts (managed / self-host)                       | OIDC consumer の client id                                                                                                                      |
| `OIDC_CLIENT_SECRET`              | Takosumi Accounts (managed / self-host)                       | OIDC consumer の client secret。`identity.oidc@v1` AppBinding 経由                                                                              |

launch token は v1 から **opaque token + Accounts `/consume`** model に統一されており、app 側で JWS を local verify
する必要はありません。app は `/_takosumi/launch` に着弾した opaque token を、TLS 越しに Takosumi Accounts の
`/consume` endpoint へ POST して redeem します (OAuth 2.0 authorization code grant に相当)。redeem に必要な context
は secret ではない env として供給します。

| name                              | 由来                                                          | 用途                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNTS_BASE_URL`               | `install-launch-token@v1` AppBinding                          | Takosumi Accounts service の base URL (例: `https://accounts.example.com`)。`${ACCOUNTS_BASE_URL}${INSTALL_LAUNCH_CONSUME_PATH}` へ redeem 要求 |
| `INSTALL_LAUNCH_INSTALLATION_ID`  | `install-launch-token@v1` AppBinding                          | この AppInstallation の id (`inst_xxx`)。redeem 要求の identity context                                                                         |
| `INSTALL_LAUNCH_REDIRECT_URI`     | `install-launch-token@v1` AppBinding                          | Accounts が token 発行時に bind した redirect URI。redeem 時に完全一致比較                                                                      |
| `INSTALL_LAUNCH_CONSUME_PATH`     | static (default `/_takosumi/launch`)                          | app 側の consume handler path                                                                                                                   |

`OIDC_ISSUER_URL` / `OIDC_REDIRECT_URI` / `ACCOUNTS_BASE_URL` / `INSTALL_LAUNCH_*` はすべて非 secret として
`wrangler.toml` の `[vars]` や Helm `runtimeConfig` 側に置きます (TLS + digest pin で context を運ぶだけで、token
の verify に必要な公開鍵は存在しません)。

::: warning Legacy JWS env (v0 で deprecated) `INSTALL_LAUNCH_PUBLIC_KEY` / `INSTALL_LAUNCH_AUDIENCE` /
`INSTALL_LAUNCH_ISSUER` は JWS-based launch token を local verify する旧 model の env で、v0 で deprecated
されています。新規 deploy では設定不要であり、spec 上の正本は opaque token + `/consume` です。 :::

### Rotation owner (secret 種類別)

rotation の起点 owner は secret 種類で分かれます。Takos runtime / `takos-private` 側は **値の取り込みと配信**
を担当するだけで、新値そのものを生成する責務は 持ちません。

| secret                            | rotation owner (managed)                                                  | rotation owner (self-host)                                                              | Takos runtime 側の動作                                                            |
| --------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `OIDC_CLIENT_ID`                  | Takosumi Accounts                                                         | operator-owned Takosumi Accounts                                                        | AppBinding (`identity.oidc@v1`) 経由で自動更新を受け取るだけ                      |
| `OIDC_CLIENT_SECRET`              | Takosumi Accounts                                                         | operator-owned Takosumi Accounts                                                        | AppBinding (`identity.oidc@v1`) 経由で自動更新を受け取るだけ                      |
| launch token redeem context (`ACCOUNTS_BASE_URL` / `INSTALL_LAUNCH_*`) | Takosumi Accounts (installation lifecycle で再計算)               | operator-owned Takosumi Accounts (launch token を使わない構成では env 自体が無い)        | AppBinding (`install-launch-token@v1`) 経由で context env を受け取るだけ。token 自体は `/consume` で都度 redeem |
| その他 Takos runtime secret       | `takos-private` operator                                                  | `takos-private` operator                                                                | AppBinding / wrangler secret / Helm `existingSecrets.*` 経由で注入                |

### Rotation 手順

managed / self-host いずれも次の順序で進めます:

1. rotation owner (managed / self-host Takosumi Accounts) 側で新 `OIDC_CLIENT_SECRET` を発行する (launch token は
   都度 opaque token を発行するため、rotation 対象は OIDC client secret と TLS / digest pin の 1 signing domain のみ)
2. `takos-private/apps/control/.secrets/<env>/` の対応 file を更新する
3. `cd takos-private/apps/control && deno task secrets:sync:<env>` で Worker secret / k8s Secret を同期する (単発更新は
   `deno task secrets put OIDC_CLIENT_SECRET --env <env>`)
4. 旧 secret を rotation owner 側で revoke する

managed mode では 1 と 2 の間に Takosumi Accounts が AppBinding (`identity.oidc@v1` / `install-launch-token@v1`)
を更新し、`takos-private` の取り込み自動化が 新値 (OIDC client secret や launch token redeem context) を pull する
流れになります。self-host mode では operator が手動で 1 と 2 を繋ぎます。

Cloudflare Workers backend の場合、内部的には `wrangler secret put` が upload を担います。AWS / GCP / Kubernetes では
Helm values の `secrets.existingSecrets.auth` 経由で External Secrets / Sealed Secrets が 同じ name を解決します。

## Terraform rules

Terraform は infrastructure shape と managed resource id を扱います。raw secret を repository や generated Helm values
に残してはいけません。

- `deploy/terraform/environments/**/terraform.tfvars` と `*.auto.tfvars(.json)` は commit しない。`.gitignore` で env
  root の local tfvars を除外する
- committed `deploy/terraform/plan/*.tfvars` は CI review 専用。必ず `terraform_plan_mode = true` と placeholder
  password だけを使い、apply に使わない
- `db_password` は provider が要求する bootstrap-only sensitive input として扱う。 live apply では `takos-private` の
  operator wrapper / secret service から注入し、 CLI history や tracked tfvars に書かない
- Terraform output の `database_url` は sensitive output のままにする。Helm values bridge は sensitive output
  を拒否し、`database_endpoint` と non-secret resource id だけを `runtimeConfig.managedResources` に渡す
- provider credential (`AWS_SECRET_ACCESS_KEY`、service account JSON、OAuth token、 kubeconfig token など) は Terraform
  module input / Helm values / workflow yaml に 直接書かない。GitHub Actions では environment secret か OIDC / Workload
  Identity を使う

AWS RDS / GCP Cloud SQL の初期 password は current Terraform module に `db_password` として渡します。この値が Terraform
state に残り得る target では、 state backend 自体を encrypted / access-controlled にし、rotation と runtime secret
injection は `takos-private` 側で行います。provider-managed master password や cloud secret manager へ移せる target は
Phase E で raw state secret をさらに 減らします。

## Helm rules

Helm chart は既定で `secrets.create: false` を使い、外部 secret を参照します。 chart が受け取るのは Secret 名と
non-secret managed resource id です。

| value                              | policy                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `secrets.existingSecrets.platform` | platform key / internal RPC secret を持つ既存 Secret 名                |
| `secrets.existingSecrets.auth`     | OAuth / session / PAT signing 系 secret の既存 Secret 名               |
| `secrets.existingSecrets.llm`      | LLM / embedding provider credential の既存 Secret 名                   |
| `runtimeConfig.managedResources`   | DB endpoint、Redis URL、queue、bucket、network、workload identity だけ |
| `TAKOS_MANAGED_RESOURCES_JSON`     | non-secret JSON。credential や password を含めない                     |

外部 secret backend は target に合わせます:

- AWS: External Secrets Operator + AWS Secrets Manager
- GCP: External Secrets Operator + Google Secret Manager
- Kubernetes: Sealed Secrets / External Secrets Operator / platform secret manager
- self-hosted: `takos-private` secret service + encrypted local store

## Review checklist

PR / release review では次を確認します:

1. `deno task validate:terraform-secrets` が green
2. `deno task terraform:helm-values:check` が sensitive output を Helm values に流していない
3. `deno task terraform:plan-gate` の `.terraform-plan/summary.md` は credential-free plan だけを示す
4. `deploy/terraform/environments/**/terraform.tfvars`、provider credential、service account JSON が tracked file にない
5. live backend plan / apply は `takos-private` 側の operator workflow で実行する

## 次に読むページ

- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md) ---
  OIDC client を発行し、launch token の `/consume` を提供する正本 plane
- [Launch Token (opaque + /consume)](https://github.com/tako0614/takosumi-cloud/blob/master/docs/apps/launch-token.md) ---
  one-shot opaque token と `/_takosumi/launch` → Accounts `/consume` redeem の正本 spec
- [Binding Catalog § install-launch-token@v1](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md#6-install-launch-tokenv1) ---
  `ACCOUNTS_BASE_URL` / `INSTALL_LAUNCH_*` env を materialize する AppBinding
