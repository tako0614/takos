# デプロイ

Takos のアプリ配布は **Installable App Model** を入口にします。Git URL と ref を
指定して AppInstallation を作り、`takosumi-git` が `.takosumi/app.yml` と
`.takosumi/manifest.yml` を読み、compile 済み Shape manifest を Takosumi kernel
の `POST /v1/deployments` に渡します。

## 使う入口

| 目的 | 入口 | 所有者 |
| --- | --- | --- |
| bundled / third-party app を install する | `POST /v1/installations` または install UI | Takosumi Accounts |
| Git URL から manifest を compile する | `takosumi-git install <git-url> --ref <tag>` | takosumi-git |
| operator が compiled manifest を直接 apply する | `takosumi deploy <manifest>` | Takosumi kernel |

Takos product は Web UI / public API / bundled app lifecycle を提供します。Git fetch、
workflow、artifact 解決、manifest compile は `takosumi-git`、kernel への direct
apply は `takosumi` CLI の責務です。

## デプロイの流れ

1. app author は `.takosumi/app.yml` に install metadata、binding、permission を書く
2. `.takosumi/manifest.yml` に compute / storage / route などの Shape resource を書く
3. install preview で source、grant、binding、cost、runtime mode を確認する
4. user approval 後に `takosumi-git` が build / artifact resolve / manifest compile を行う
5. Accounts が AppInstallation ledger に source commit と manifest digest を pin する
6. compiled manifest が Takosumi kernel に apply される

## 2 つの manifest

| ファイル / payload | 読む主体 | 役割 |
| --- | --- | --- |
| `.takosumi/app.yml` | takosumi-git / Takosumi Accounts | InstallableApp metadata、binding、grant、permission preview |
| `.takosumi/manifest.yml` | takosumi-git compiler | authoring 用 Shape manifest。placeholder や `workflowRef` は compile 前だけ許可 |
| compiled manifest | Takosumi kernel | `resources[]` の closed Shape declarations |

kernel に渡るのは compiled manifest だけです。install 用 binding や permission は
Accounts と takosumi-git の install pipeline で解決されます。

## 関連ページ

- [Git / Store install](/deploy/store-deploy)
- [Direct manifest deploy](/deploy/deploy)
- [マニフェスト](/deploy/manifest)
- [環境変数](/deploy/environment)
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
