# プラットフォーム

::: tip このセクションは deploy manifest author / Takos developer
向けのプラットフォーム概念を整理したセクションです。Takos kernel をホストする
operator は [Hosting](/hosting/) を参照してください。:::

Takos platform は infra kernel の層です。primitive の実行基盤を提供しつつ、
space の所有・権限・deploy・resource・metering を管理します。

`Agent / Chat`、`Git`、`Storage`、`Store`、`Auth` は kernel に常設される機能。
uninstall 不可。group ではない。第三者の product は Store / UI 上で app label
を持つことがあるが、deploy model では primitive / group として扱う。

## プラットフォームと primitive / runtime の違い

| レイヤー            | 担当                                              | 例                                           |
| ------------------- | ------------------------------------------------- | -------------------------------------------- |
| **Deploy Manifest** | 何を deploy するかを宣言する                      | `.takos/app.yml` / `.takos/app.yaml`         |
| **Runtime**         | 宣言を operator-selected backend に反映して動かす | worker runtime, sql / object-store backend   |
| **Kernel features** | 常設機能（uninstall 不可）                        | Agent / Chat, Git, Storage, Store, Auth      |
| **Kernel**          | identity, space, deploy, resource, metering       | control plane の管理面                       |
| **Groups**          | primitive を束ねる optional state scope           | default app distribution, third-party groups |

`.takos/app.yml` / `.takos/app.yaml` は primitive desired declaration の
manifest です。詳しくは [Kernel](/architecture/kernel) を参照してください。

## 主要コンセプト

### Space

Space は Takos の最上位の隔離単位です。

- 1 space = 1 tenant
- domain: `{KERNEL_DOMAIN}`（custom domain も可）
- member、repo、worker、resource、file、installed group / package をまとめて管理
- ロールベースのアクセス制御 (owner / admin / editor / viewer)
- principal として user / service / agent が操作可能

### Kernel

Kernel は primitive を安全に動かすための共通基盤です。

- auth / principal / capability grant
- deploy / group snapshot / rollback
- resource broker
- publication index
- metering / billing / audit

### Groups

Takos 上に deploy される外部ワークロード。kernel features (Agent / Chat, Git,
Storage, Store, Auth) は group ではなく kernel に統合されている。

- default app distribution と third-party primitive / group は同じ model で扱う
- default apps は distribution / catalog metadata として扱う
- group 間の連携は publication / Takos capability grant で宣言する

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
group workloads
  examples: takos-docs / takos-excel / takos-slide / third-party
  ↑ publications / capability grants
kernel features (Agent / Chat, Git, Storage, Store, Auth) ← kernel に常設、uninstall 不可
  ↑
kernel (identity / space / deploy / resources / metering)
  ↑ reconcile
runtime (Workers / container workloads / sql / object-store / ... = abstract; backend では D1 / R2 等)
  ↑ declared by
deploy manifest (.takos/app.yml / .takos/app.yaml)
```

## Default app distribution

Takos は takos-docs, takos-excel, takos-slide を default app distribution
の初期セットとして扱います。これは新規 space に preinstall する app
候補であり、operator は別の app set に差し替えられる。default set に含まれても
primitive や group は特権化されません。

- preinstall は default app source を解決し、必要に応じて group scope と group
  snapshot job を deploy queue に enqueue する
- worker が job を消費し、manifest 解決と reconcile を通常の deploy pipeline
  で完了させる
- deploy dashboard は kernel feature として常設され、minimal な install /
  uninstall / launch UI を提供する
- kernel の Store features は richer な discovery / recommendation を提供する
- Store は kernel features の一部であり常に利用可能

## 各ページへのリンク

| ページ                                               | 説明                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| [Space](/platform/spaces)                            | マルチテナントの隔離単位                                      |
| [Store](/platform/store)                             | kernel feature としての Store の役割と current implementation |
| [課金](/platform/billing)                            | プラン・使用量・決済                                          |
| [ActivityPub](/platform/activitypub)                 | 連合プロトコル対応                                            |
| [Default App Distribution](/platform/default-apps)   | takos-docs, takos-excel, takos-slide                          |
| [互換性](/platform/compatibility)                    | tracked template と supported backend surfaces の整理         |
| [Resource Governance](/platform/resource-governance) | resource CRUD / grant / billing gate の整理                   |
