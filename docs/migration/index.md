# Migration

Takos の migration docs は、移行期間中に残る互換 surface と削除済み UX
の退避先をまとめます。

Takos product は Web/API surface を正本にします。manifest authoring、workflow
実行、artifact 生成、git push 連携は `takosumi-git` が担当し、Takos API は最終
manifest / artifact input を受け取ります。

## Guides

- [fromWorkflow / inline workflow deploy の移行](./fromworkflow-to-takosumi-git)
