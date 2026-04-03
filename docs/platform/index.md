# プラットフォーム

Takos platform は infra kernel と workspace shell
をまとめた層です。アプリの実行基盤を提供しつつ、workspace
の所有・権限・deploy・resource・metering を管理します。

`Store`、`Repos`、`Chat` のようなプロダクト UI は platform
そのものではなく、Takos 上で動く installable app です。

## プラットフォームと app / runtime の違い

| レイヤー             | 担当                                                     | 例                                        |
| -------------------- | -------------------------------------------------------- | ----------------------------------------- |
| **App Spec**         | 何を deploy するかを宣言する                             | `.takos/app.yml`                          |
| **Runtime**          | 宣言を backend に反映して動かす                          | Cloudflare Workers, CF Containers, D1, R2 |
| **Kernel**           | identity, spaces, capability, deploy, resource, metering | control plane の管理面                    |
| **Workspace Shell**  | workspace/infrastructure UI と app launcher              | installed apps, resources, deploys        |
| **Installable Apps** | workspace に接続される product UX                        | Store, Repos, Chat, third-party apps      |

`.takos/app.yml` は app の deploy/runtime contract です。workspace shell や app
launcher の契約は、現時点では manifest ではなく shell と app registry
側で扱います。詳しくは
[Kernel / Workspace Shell / Apps](/architecture/kernel-shell)
を参照してください。

## 主要コンセプト

### Workspace / Space

Space は Takos
の最上位の隔離単位です。member、repo、worker、resource、file、installed app
をまとめて管理します。

- **個人用 (`user`)**: ユーザー作成時に自動生成
- **チーム用 (`team`)**: 複数メンバーで共同利用
- ロールベースのアクセス制御 (owner / admin / editor / viewer)
- principal として user / service / agent が操作可能

### Kernel

Kernel は workspace を安全に動かすための共通基盤です。

- auth / principal / capability grant
- app install / deploy / rollback
- resource broker
- metering / billing / audit

### Workspace Shell

Shell は Takos の最小 UI です。workspace の状態を見て app を起動します。

- workspace 切り替え
- resources / deploys / members / settings
- installed apps の一覧
- app の install / uninstall / launch

### Installable Apps

Takos 上で動くプロダクト UI です。

- first-party / third-party を問わず同格
- workspace template で preinstall できる
- canonical URL は app 自身が所有する
- shell は app を iframe または redirect で開く

### 課金

使用量ベースの課金システムです。

- **Free**: 個人の検証・小規模利用向け
- **Plus**: サブスクリプション型の個人向け有料プラン
- **Pay As You Go**: プリペイド残高からの従量課金
- メーターごとのクォータ管理と自動リセット

### ActivityPub Federation

ActivityPub と ForgeFed をベースとした、インスタンス間の repository catalog
連携です。

- git データは各インスタンスに分散したまま、メタデータのみを共有
- Store app は federation を利用する catalog UI の 1 つになれる
- WebFinger による発見、Follow による購読
- リモート catalog から repository 参照を import して利用可能

## レイヤー関係

```text
installable apps (Store / Repos / Chat / third-party)
  ↑ launch / embed
workspace shell
  ↑ manage
kernel (identity / spaces / deploy / resources / metering)
  ↑ reconcile
runtime (Workers / Containers / D1 / R2 / ...)
  ↑ declared by
.takos/app.yml
```

## Default apps と bootstrap

Takos は workspace template により default apps を preinstall できます。これは
app を特権化するためではなく、workspace の初期 UX を揃えるためです。

- shell は minimal な install / uninstall / launch UI を持つ
- `Store` は richer な discovery / recommendation を提供できる
- `Store` がなくても shell は bootstrap できる

## 各ページへのリンク

| ページ                                | 説明                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| [Workspace / Space](/platform/spaces) | マルチテナントの隔離単位                                          |
| [Store](/platform/store)              | first-party installable Store app の役割と current implementation |
| [課金](/platform/billing)             | プラン・使用量・決済                                              |
| [ActivityPub](/platform/activitypub)  | 連合プロトコル対応                                                |
