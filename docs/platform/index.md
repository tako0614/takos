# プラットフォーム

::: tip このセクションは app developer 向け
Takos 上で **app を作る developer** 向けのプラットフォーム概念を整理したセクションです。Takos kernel をホストする operator は [Hosting](/hosting/) を参照してください。
:::

Takos platform は infra kernel
の層です。app の実行基盤を提供しつつ、space
の所有・権限・deploy・resource・metering を管理します。

`Agent / Chat`、`Git`、`Storage`、`Store`、`Auth` は kernel に常設される機能。
uninstall 不可。group ではない。第三者 app は group として deploy される。

## プラットフォームと app / runtime の違い

| レイヤー | 担当 | 例 |
| --- | --- | --- |
| **App Spec** | 何を deploy するかを宣言する | `.takos/app.yml` |
| **Runtime** | 宣言を backend に反映して動かす | Cloudflare Workers (compute), sql / object-store backend (D1 / R2 等) |
| **Kernel features** | 常設機能（uninstall 不可） | Agent / Chat, Git, Storage, Store, Auth |
| **Kernel** | identity, space, deploy, resource, metering | control plane の管理面 |
| **Apps (groups)** | space に接続される product UX | takos-computer, takos-docs, takos-excel, takos-slide, third-party apps |

`.takos/app.yml` は app の deploy/runtime contract です。詳しくは
[Kernel](/architecture/kernel) を参照してください。

## 主要コンセプト

### Space

Space は Takos の最上位の隔離単位です。

- 1 space = 1 tenant
- domain: `{KERNEL_DOMAIN}`（custom domain も可）
- member、repo、worker、resource、file、installed app をまとめて管理
- ロールベースのアクセス制御 (owner / admin / editor / viewer)
- principal として user / service / agent が操作可能

### Kernel

Kernel は app を安全に動かすための共通基盤です。

- auth / principal / capability grant
- app install / deploy / rollback
- resource broker
- publication index
- metering / billing / audit

### Apps (groups)

Takos 上に deploy される外部ワークロード。kernel features (Agent / Chat, Git,
Storage, Store, Auth) は app ではなく kernel に統合されている。

- first-party (default groups) / third-party を問わず同格
- space template で preinstall できる（default groups のみ）
- app 間の連携は [App Publications](/architecture/app-publications) で宣言する

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
- kernel の Store features は federation を利用する catalog UI の 1 つになれる
- WebFinger による発見、Follow による購読
- リモート catalog から repository 参照を import して利用可能

## レイヤー関係

```text
apps / groups (takos-computer / takos-docs / takos-excel / takos-slide / third-party)
  ↑ publications
kernel features (Agent / Chat, Git, Storage, Store, Auth) ← kernel に常設、uninstall 不可
  ↑
kernel (identity / space / deploy / resources / metering)
  ↑ reconcile
runtime (Workers / container workloads / sql / object-store / ... = abstract; backend では D1 / R2 等)
  ↑ declared by
.takos/app.yml
```

## Default groups と bootstrap

Takos は space template により default groups (takos-computer / takos-docs /
takos-excel / takos-slide) を preinstall します。これは group を特権化するため
ではなく、space の初期 UX を揃えるためです。

- deploy dashboard は kernel feature として常設され、minimal な install /
  uninstall / launch UI を提供する
- kernel の Store features は richer な discovery / recommendation を提供する
- Store は kernel features の一部であり常に利用可能

## 各ページへのリンク

| ページ | 説明 |
| --- | --- |
| [Space](/platform/spaces) | マルチテナントの隔離単位 |
| [Store](/platform/store) | kernel feature としての Store の役割と current implementation |
| [課金](/platform/billing) | プラン・使用量・決済 |
| [ActivityPub](/platform/activitypub) | 連合プロトコル対応 |
| [Default Apps](/platform/default-apps) | takos-computer, takos-docs, takos-excel, takos-slide |
