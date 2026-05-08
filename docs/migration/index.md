# Migration

Takos の migration docs は、移行期間中に残る互換 surface と削除済み UX
の退避先をまとめます。

Takos product は Web/API surface を正本にします。manifest authoring、workflow
実行、artifact 生成、git push 連携は `takosumi-git` が担当し、Takos API は最終
manifest / artifact input を受け取ります。

## Guides

- [fromWorkflow / inline workflow deploy の移行](./fromworkflow-to-takosumi-git)

## Installable App Model migration path

Phase 1.1-1.7 (ROADMAP.md Part II) で Installable App Model に移行します:

- Phase 1.1 で Takosumi Accounts service を新設、takos-app から identity /
  billing (OAuth issuer / Stripe / consent / device code 等) を抽出
- Phase 1.2 で AppInstallation ledger を Takosumi Accounts に新設
- Phase 1.3 で takosumi-git に `.takosumi/app.yml` parser / install preview /
  Git URL installer を実装
- Phase 1.4 で Takos を OIDC consumer 化し、`/oauth/*` 系を削除
- Phase 1.5 で shared-cell runtime mode、Phase 1.6 で dedicated / self-hosted
  への materialize / export を実装
- Phase 1.7 で GitOps deploy intent binding を実装
- 詳細は [Installable App Model](/architecture/installable-app-model) と
  [Install Paths](/apps/install-paths) を参照
