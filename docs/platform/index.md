# プラットフォーム

::: tip このセクションは deploy manifest author / Takos developer
向けのプラットフォーム概念を整理したセクションです。Takos kernel をホストする
operator は [Hosting](/hosting/) を参照してください。 :::

Takos platform は Takos product layer、Takosumi Accounts、takosumi-git、
takosumi kernel を組み合わせた運用面です。**takosumi kernel 単体** は compiled
Shape manifest を `POST /v1/deployments` で受ける compute substrate であり、
account / billing / OAuth / app catalog / workflow は持ちません。

`Agent / Chat`、`Git`、`Storage`、`Store` は Takos product 側の feature です。
`Deploy` / `Routing` / `Resources` の kernel-bound 部分は takosumi kernel が
compiled manifest apply、route projection、resource provisioning、provider
reconciliation として扱います。install UI / AppInstallation ledger / billing /
OIDC issuer は [Takosumi Accounts](/architecture/takosumi-accounts)、Git URL
install / workflow / artifact resolution / manifest compile は
[Installer Pipeline](/architecture/installer-pipeline) の責務です。

## プラットフォームと primitive / runtime の違い

| レイヤー                   | 担当                                                               | 例                                               |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| **Install metadata**       | Git install する app の metadata / binding / permission            | `.takosumi/app.yml` (takosumi-git-bound)         |
| **Deploy Manifest**        | 何を deploy するかを宣言する                                       | `.takosumi/manifest.yml` (compiled kernel-bound) |
| **Runtime**                | 宣言を operator-selected backend に反映して動かす                  | worker runtime, sql / object-store backend       |
| **Takos product features** | Takos app として提供する常設機能                                   | Agent / Chat, Git, Storage, Store                |
| **Takosumi Accounts**      | identity / billing / AppInstallation owner                         | OIDC issuer, billing, launch token               |
| **takosumi kernel**        | compiled manifest apply / route projection / resource provisioning | `POST /v1/deployments`, Shape resources          |
| **Groups**                 | primitive を束ねる compatibility state scope                       | legacy deploy history / rollback scope           |

`.takosumi/app.yml` は takosumi-git が読む installer-bound metadata です。
`.takosumi/manifest.yml` は compile 後に kernel へ渡る Shape manifest です (旧
`.takos/app.yml` / `.takos/app.yaml` は deprecated alias)。詳しくは
[Kernel](/architecture/kernel) と
[`.takosumi/app.yml` Spec](/reference/app-yml-spec) を参照してください。

## 主要コンセプト

### Space

Space は Takosumi Account 配下の install scope です。

- Takosumi Account 配下の install scope (kernel 内の isolation unit として 1
  space = 1 tenant unit に相当。tenant の契約主体は Takosumi Account 側で、
  Space はその下の AppInstallation 親)
- domain: AppInstallation / domain binding 側で割り当てる (custom domain も可)
- member、repo、worker、resource、file、installed app をまとめて見る UX scope
- ロールベースのアクセス制御は Takosumi Accounts / AppGrant と Takos app-local
  policy を組み合わせて扱う
- principal として user / service / agent が操作可能

### Kernel

Kernel は primitive を安全に動かすための共通基盤です。

- compiled manifest apply (`apiVersion: "1.0"` / `kind: Manifest`)
- Deployment lifecycle (Deployment record / GroupHead / rollback)
- route projection / resource provisioning / provider reconciliation
- cross-instance `imports[]` / `serviceResolvers[]` の descriptor verify / pin
- kernel audit (billing 主体は Takosumi Accounts)

### Groups

Takos 上に deploy される外部ワークロードを束ねる compatibility state scope。
Agent / Chat / Git / Storage / Store は Takos product feature、Auth / Billing は
Takosumi Accounts、workflow / install は takosumi-git の責務です。kernel は
group 固有 UI や app catalog を持ちません。

- default app distribution と third-party primitive / group は同じ model で扱う
- default apps は distribution / catalog metadata として扱う
- group 間・service 間の current dependency は Shape resource、AppBinding、
  `imports[]` / `serviceResolvers[]` で宣言する

### 課金

使用量ベースの課金システムです。

- **Free**: 個人の検証・小規模利用向け
- **Plus**: サブスクリプション型の個人向け有料プラン
- **Pay As You Go**: プリペイド残高からの従量課金
- メーターごとのクォータ管理と自動リセット

### Store Network

Store と repository 参照を共有するための、インスタンス間の公開 REST API です。

- git データは各インスタンスに分散したまま、参照 metadata のみを共有
- `slug@domain` は `https://domain/api/public/stores/:slug` に解決
- feed は pull 型で inventory / repository event を同期
- リモート catalog から repository reference を import して利用可能

## レイヤー関係

```text
installed apps / workloads
  examples: takos-docs / takos-excel / takos-slide / takos-computer / yurucommu / third-party
  ↑ AppBinding / AppGrant / service imports
Takos product features (Agent / Chat, Git, Storage, Store)
  ↑ OIDC / billing / installation ledger
Takosumi Accounts
  ↑ install / workflow / compile
takosumi-git
  ↑ POST /v1/deployments (compiled manifest)
takosumi kernel (compiled manifest apply / routes / resources)
  ↑ reconcile
runtime (Workers / container workloads / sql / object-store / ... = abstract; backend では D1 / R2 等)
  ↑ declared by
deploy manifest (.takosumi/manifest.yml after compile)
```

## Default app distribution

Takos は takos-docs, takos-excel, takos-slide, takos-computer, yurucommu を
default app distribution の初期セットとして扱います。これは新規 space に
preinstall する app 候補であり、operator は別の app set
に差し替えられる。default set に含まれても primitive や group
は特権化されません。

- preinstall は Takosumi Accounts の AppInstallation ledger に source metadata /
  resolved commit / digest を保存する
- takosumi-git が source 解決、workflow、artifact resolution、manifest compile
  を 担当し、compiled manifest だけを kernel に投下する
- install / uninstall / launch UI は Takos product / Takosumi Accounts 側の
  surface であり、kernel feature ではない
- Store は Takos product feature として discovery / recommendation を提供する

## 各ページへのリンク

| ページ                                               | 説明                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| [Space](/platform/spaces)                            | マルチテナントの隔離単位                                             |
| [Store](/platform/store)                             | Takos product feature としての Store の役割と current implementation |
| [課金](/platform/billing)                            | プラン・使用量・決済                                                 |
| [Store Network](/platform/store-network)             | Store と repository 参照の公開 REST API                              |
| [Default App Distribution](/platform/default-apps)   | takos-docs, takos-excel, takos-slide, takos-computer, yurucommu      |
| [互換性](/platform/compatibility)                    | tracked template と supported backend surfaces の整理                |
| [Resource Governance](/platform/resource-governance) | resource CRUD / grant / billing gate の整理                          |
