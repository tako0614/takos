# Operator Boundary Audit

> このページでわかること: Takos product docs が Takosumi v1 と operator-owned
> infrastructure の境界を崩していないか確認するチェックリスト。

Takos は Source / Installation / Deployment / PlatformService を消費する product
です。OpenTofu state、cloud credential、native controller、runtime-agent
runtime handler、PlatformService inventory は operator distribution の責務です。

## Source of truth

- `../takosumi` は Takosumi public contract、Installer API、Source /
  Installation / Deployment / PlatformService の記録を所有する。
- `takos/deploy/opentofu`、`takos/deploy/helm`、`takos/deploy/distributions`
  は Takos product distribution の template を所有する。
- `takos-private` または operator distribution が concrete provider
  credential、OpenTofu state、runtime-agent handler wiring、live proof evidence
  を所有する。

## Takos docs に書いてよいこと

- Takos product service、Hono route、UI、Git container、agent container の構成。
- Takos distribution が必要とする PlatformService、Helm values、OpenTofu output
  bridge、provider proof task。
- self-host / cloud proof を source-controlled dry-run と live operator evidence
  に分けること。

## NG パターン

- provider / backend / adapter selection を Takos Source や public deploy API の
  authoring field として露出すること。
- OpenTofu が state を持つ resource lifecycle を Takosumi public contract の一部
  として説明すること。
- cloud provider credential を Takos product repo の deploy artifact に埋め込むこと。
- Takosumi internal implementation binding を Takos product feature として説明すること。

## Current Audit

- runtime / routing docs は Takos service ports、PlatformService inventory、
  deployment outputs を説明する。
- 実 backend と self-host docs は operator-owned proof として扱う。
- README / current-state / hosting docs は `operatorProfile` / OpenTofu /
  PlatformService inventory の語彙を使う。
- Takos product release gate は source-controlled proof までを扱い、live provider
  proof は operator evidence として分離する。
