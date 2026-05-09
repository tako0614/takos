# Installable App Model

Takos は **Git URL から Takosumi Account に install される app** です。OAuth
provider は Takos でも takosumi kernel でもなく **Takosumi Accounts**
に置かれ、consumer からは service identifier `takosumi.account.auth@v1` を
anchor / resolver で解決して参照します。kernel は manifest を apply するだけの
compute substrate に保たれます。所有権は **AppInstallation 台帳** で表現され、
runtime は **shared-cell / dedicated / self-hosted** の 3 mode で同じ binary を
動かします。これが Takos の最終モデル = **Installable App Model** (別名:
Git-installed Materializable App Model) です。

## このページで依存してよい範囲

- ecosystem の 5 product / layer (Takosumi Accounts / takosumi kernel /
  takosumi-cloud / takosumi-git / Takos) の責務分離
- Takos が install される app であり OIDC consumer であるという立場
- `.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml`
  (kernel-bound) の役割の違い
- 「OAuth provider は Takosumi Accounts、kernel は compute-only」という不変条件

## このページで依存してはいけない範囲

- `.takosumi/app.yml` の field 定義 ([app.yml spec](/reference/app-yml-spec)
  を参照)
- AppInstallation の table 設計 ([AppInstallation 台帳](./app-installation.md)
  を参照)
- Takosumi Accounts の OIDC endpoint 一覧
  ([Takosumi Accounts](./takosumi-accounts.md) を参照)
- runtime mode 個別の materialize / export 手順
  ([Runtime Modes](./runtime-modes.md) を参照)
- installer pipeline の 13 step 詳細
  ([Installer Pipeline](./installer-pipeline.md) を参照)
- billing 主体の課金構造 ([Takosumi Cloud billing](/platform/billing) (Takosumi
  Account に紐づく) を参照)

## 最終結論

Installable App Model は次の 1 文に集約されます。

> **OAuth provider は必要。 その置き場所は Takosumi Accounts。 ただしそれは
> takosumi kernel ではなく、takosumi-cloud の account plane。 Takos は Git URL
> から install できる OIDC consumer app にする。 takosumi-git が
> installer、takosumi kernel が compute、AppInstallation 台帳が
> 所有権、shared-cell が UX、export / materialize が支配性を担保する。**

これにより以下が同時に成立します。

- 現在の ChatGPT 風 instant UX を維持できる (shared-cell)
- Takos からは OAuth provider を廃止できる
- OAuth/OIDC issuer は Takosumi Accounts に集約できる
- takosumi kernel の純粋性 (compute substrate のみ) を保てる
- takosumi-git を installer / workflow runner / manifest compiler として full
  に活用できる
- ユーザー契約 / 請求は Takosumi Account に寄せられる
- ユーザー支配性 (export / materialize / self-host) を機能として保証できる
- Takos runtime の依存集合は OIDC / Postgres / Object Store / Git binding に
  閉じ、Takosumi 専用 SDK を必要としない

## 5 product / layer の責務分離

ecosystem は 5 つの独立 product / layer から構成されます。各 product / layer
は持たないものを明確に持たないことで、後工程の混入を防ぎます。

```txt
Takosumi Accounts
  = identity broker
  = OIDC issuer
  = billing owner
  = app installation owner
  ⚠ compute apply / workflow / chat は持たない

takosumi kernel
  = compute substrate
  = manifest apply engine
  ⚠ identity / billing / OAuth / workflow / cron は持たない

takosumi-cloud
  = managed PaaS dashboard
  = install UI / domain mgmt / usage UI
  ⚠ OIDC issue / billing 実装本体は持たない (Accounts に委譲)

takosumi-git
  = Git URL installer
  = workflow runner
  = manifest compiler
  = deploy bridge to kernel
  ⚠ identity issue / billing / chat は持たない

Takos
  = installable app
  = OIDC consumer
  ⚠ OAuth provider / 契約主体 / billing owner / Takosumi Account は持たない
```

詳細な責務 table は次の各ページを参照してください。

- [Takosumi Accounts](./takosumi-accounts.md)
- [takosumi kernel (compute substrate)](./kernel.md)
- [Installer Pipeline (takosumi-git)](./installer-pipeline.md)
- [Runtime Modes](./runtime-modes.md)

## 全体アーキテクチャ図

User の install action から Installed Takos の chat 表示までの流れと、各 entity
の境界をまとめた図です (出典: `new.md` §33)。

```txt
                           ┌──────────────────────────────┐
                           │       Takosumi Accounts      │
                           │                              │
                           │ - account                    │
                           │ - billing                    │
                           │ - OAuth / OIDC issuer        │
                           │ - upstream IdP broker        │
                           │ - app installation owner     │
                           └───────────────┬──────────────┘
                                           │
                                           │ OIDC / launch token
                                           ▼
┌──────────────────────┐       ┌──────────────────────────────┐
│   Install Takos UI   │──────▶│       AppInstallation        │
│                      │       │                              │
│ git URL + ref        │       │ - appId: takos.chat          │
│ preview              │       │ - source commit              │
│ approve              │       │ - manifest digest            │
└──────────┬───────────┘       │ - runtime mode               │
           │                   │ - bindings                   │
           │                   │ - grants                     │
           │                   └───────────────┬──────────────┘
           │                                   │
           │ Git URL                           │ compile / bind
           ▼                                   ▼
┌──────────────────────┐       ┌──────────────────────────────┐
│      takosumi-git    │──────▶│        takosumi kernel       │
│                      │       │                              │
│ - fetch repo         │       │ - manifest apply only        │
│ - parse app.yml      │       │ - provider DAG               │
│ - run workflows      │       │ - no OAuth                   │
│ - compile manifest   │       │ - no billing                 │
│ - deploy bridge      │       │ - no account                 │
└──────────────────────┘       └───────────────┬──────────────┘
                                               │
                                               │ runtime
                                               ▼
                                  ┌──────────────────────────────┐
                                  │        Installed Takos       │
                                  │                              │
                                  │ - chat UX                    │
                                  │ - agent                      │
                                  │ - memory                     │
                                  │ - OIDC consumer              │
                                  │ - app-local profile          │
                                  │ - optional GitOps deploy     │
                                  └──────────────────────────────┘
```

## install から chat までの流れ

1. User が `https://takosumi.cloud/install?git=...&ref=v1.2.3` を開く (もしくは
   takos.jp で **Use Takos** を押す)
2. Takosumi Accounts でログイン / 新規 account 作成 / 支払い設定
3. takosumi-git が Git URL を fetch し、`.takosumi/app.yml` と
   `.takosumi/manifest.yml` を parse
4. install preview (publisher / commit / requested bindings / requested grants /
   estimated cost) を提示し、user の approve を待つ
5. workflows を sandbox で実行して artifact (image digest 等) を解決
6. AppInstallation 台帳に entry を作成し、AppBinding (OIDC client / DB / blob /
   domain / GitOps / launch token) を Takosumi Accounts が provision
7. takosumi-git が manifest を compile (placeholder ゼロ) し、kernel に
   `POST /v1/deployments` で投下
8. Installed Takos に launch token JWS で redirect → owner session 作成 → chat
   が開く

詳細な step 分解は [Installer Pipeline](./installer-pipeline.md)、launch token
の検証は [Launch Token](/apps/launch-token) を参照。

## なぜ Takos と kernel に OAuth を置かないか

OAuth provider はどこかに置く必要があります。理由は、Takos を installable app
にした瞬間「この installation の owner は誰か / 誰に請求するか / 誰が revoke
できるか / redirect_uri は誰が管理するか」という stable identity の問いが
生まれるからです。

ただし置き場所として **Takos と kernel は不適切** です。

- **Takos に置くと**: Takos が「アカウントの王様」のままになり、契約 / billing /
  installation owner も Takos 側に残る。「installable app」ではなくなる。 自前の
  OAuth IdP は外部から見ても「Takos が支配的 SaaS」に見え続ける。
- **kernel に置くと**: kernel が compute substrate でなくなる。account / OAuth /
  consent screen / Stripe を kernel が抱え、長期保守が困難になる。kernel は
  小麦を粉にする石臼であって、パン屋の会計はしないという原則が壊れる。

そこで OAuth/OIDC issuer は **takosumi-cloud の account plane = Takosumi
Accounts** に置きます。kernel と同じ "takosumi" の名を持ちますが、kernel の
内側ではなく takosumi-cloud product の中の plane として運用されます。

```txt
takosumi kernel       : OAuth なし (compute substrate のみ)
takosumi-cloud accounts: OAuth/OIDC あり (issuer)
```

この対応は AWS / Vercel の構造と相似形です。

```txt
EC2 instance runtime  = OAuth なし
AWS account / IAM     = identity あり

deployment runtime    = OAuth なし
Vercel account        = login / billing あり
```

## 2 つの manifest

`.takosumi/` には役割が異なる 2 つの manifest
が並びます。**絶対に混同しません**。

| ファイル                 | 用途                                                          | 受領者                   | 解釈タイミング             |
| ------------------------ | ------------------------------------------------------------- | ------------------------ | -------------------------- |
| `.takosumi/app.yml`      | install 用 metadata + binding 宣言 + permission 宣言          | takosumi-git (installer) | install pipeline 起動時    |
| `.takosumi/manifest.yml` | compute resource 宣言 (installer-only placeholder を含み得る) | takosumi-git → kernel    | compile 後 kernel が apply |

- `app.yml` は **kernel に渡してはいけない**。kernel は `identity.oidc@v1` の
  ような binding type を知りません。
- `manifest.yml` には `${bindings.*}` / `${secrets.*}` / `${refs.*.outputs.*}` /
  `${artifacts.*}` / `${installation.*}` / `${params.*}` の installer-only
  placeholder が含まれ得ます。これも **そのまま kernel に 渡してはいけない**。
- kernel に渡るのは **Compiled manifest** だけです。current `takosumi-git` は
  installer-only placeholder が未解決なら Accounts / kernel request の前に
  compile error にします。`${imports.*}` / `${ref:...}` / `${secret-ref:...}` の
  kernel-bound references は残り得ます。

field 定義は [app.yml spec](/reference/app-yml-spec)、placeholder 文法と binding
catalog は [Binding Catalog](/reference/binding-catalog) を参照。

## 3 つの install path

ユーザー像に合わせて install 経路は 3 つあります。AppInstallation model は
共通なので、後から path を切り替えても同じ ledger に乗ります。

| path             | 想定ユーザー        | 起点                                                                       |
| ---------------- | ------------------- | -------------------------------------------------------------------------- |
| Use Takos        | 一般ユーザー        | `takos.jp` の "Use Takos" ボタン (shared-cell instant install)             |
| Install from Git | 開発者 / 透明性重視 | `https://takosumi.cloud/install?git=...&ref=v1.2.3`                        |
| Self-host        | 退出 / 企業 / 主権  | `takosumi-git export` / `takosumi-git install bundle --to <self-takosumi>` |

詳細は [Install Paths](/apps/install-paths)、Git URL install の preview 仕様は
[Install API](/reference/install-api)、self-host への export は
[Upgrade / Export](/platform/upgrade-export) を参照。

## 3 つの runtime mode

AppInstallation は同じ source commit / app manifest digest を保ったまま、 3 つの
runtime mode を跨いで物理化を変更できます。

| mode          | 起動性能 | 隔離                         | 用途                           |
| ------------- | -------- | ---------------------------- | ------------------------------ |
| `shared-cell` | instant  | per-installation namespace   | 既存 instant UX を保つ default |
| `dedicated`   | 数分     | per-installation deployment  | usage / compliance / 性能要求  |
| `self-hosted` | 任意     | operator-owned takosumi 全体 | 完全退出 / 自社インフラ運用    |

各 mode の物理配置と materialize / export の仕様は
[Runtime Modes](./runtime-modes.md) を参照。

## Takos が知らないもの (依存削減のコア)

Takos の runtime 依存集合は次の標準 contract に閉じ込めます。

```txt
Required:
  DATABASE_URL
  OBJECT_STORE_ENDPOINT / ACCESS_KEY / SECRET_KEY
  AUTH_DRIVER=oidc + OIDC_ISSUER_URL / CLIENT_ID / CLIENT_SECRET / REDIRECT_URI
  BASE_URL
  TAKOS_INSTALLATION_ID

Optional:
  DEPLOY_INTENT_DRIVER=gitops + DEPLOY_INTENT_REMOTE / TOKEN
  INSTALL_LAUNCH_PUBLIC_KEY / AUDIENCE
  LLM_PROVIDER / API_KEY
```

これにより、Takos は次のものに **依存しません**。

- Takosumi Accounts internal API (OIDC standard だけを見る)
- Takosumi billing API
- takosumi kernel API (deploy は GitOps binding 経由)
- Takosumi 専用 SDK

managed Takos では Takosumi がこれらの binding を提供します。self-host では
Keycloak / MinIO / 任意 Postgres など別 provider に差し替えられます。Takos は
同じ binary のままです (詳細は [OIDC Consumer](/apps/oidc-consumer))。

## 既存 docs との接続

- 既存 [System Architecture](./system-architecture.md) は Takos service set の
  repository boundary を扱います。本ページの product / layer
  責務分離と整合します。
- 既存 [Kernel](./kernel.md) は kernel features を説明します。Installable App
  Model では kernel features に **Auth と Billing を含めません**。 Auth/identity
  は Takosumi Accounts の責務、Billing は Takosumi Cloud billing (請求主体は
  Takosumi Account) の責務です。
- 既存 [Control Plane](./control-plane.md) は kernel control 面を扱います。
  Takosumi Accounts (account plane) と kernel control は別レイヤーである点に
  注意してください。
- 既存 [Deploy System](./deploy-system.md) は deploy pipeline を扱います。
  Installable App Model では Takos が直接 kernel を叩かず、GitOps deploy binding
  経由の indirection を取ります。

## 強い禁則 (本モデルの不変条件)

設計レビュー時の checklist として参照してください。

1. kernel に identity / billing / workflow を持ち込まない
2. Takos に OAuth provider を残さない / 新規追加しない
3. kernel に `.takosumi/app.yml` を渡さない
4. mutable git ref (`ref=main` / `ref=latest`) で install / upgrade させない
5. 任意 Git repo の workflow に secrets を渡さない (build phase は secrets ゼロ)
6. AppInstallation 1 つにつき所有権 chain を 1 本完全に追える (Takosumi Account
   → Space → AppInstallation → Source pin → Compiled manifest digest →
   RuntimeBinding)
7. shared-cell でも AppInstallation は完全に隔離される (DB schema / blob
   namespace / OIDC client / cookie / domain)
8. export bundle に必要なもの (source pin / data / pairwise salt / secrets
   template) を欠かさない

## 次に読むページ

- [Takosumi Accounts](./takosumi-accounts.md) — OIDC issuer の詳細、upstream
  IdP、pairwise subject、ID token claim
- [AppInstallation 台帳](./app-installation.md) — ownership primitive の table
  設計と status 遷移
- [Runtime Modes](./runtime-modes.md) — shared-cell / dedicated / self-hosted
  の比較と materialize 流れ
- [Installer Pipeline](./installer-pipeline.md) — takosumi-git の install
  pipeline 13 step
- [Install Paths](/apps/install-paths) — Use Takos / Install from Git /
  Self-host の 3 path 詳細
- [Glossary](/reference/glossary) — Installable App Model 関連語の定義
