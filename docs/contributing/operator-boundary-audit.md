# Operator Boundary Audit

> このページでわかること: Takos product docs が Takosumi v1 と operator-owned
> infrastructure の境界を崩していないか確認するチェックリスト。

Takos は Takosumi に Installation / Run / Deployment /
OutputSnapshot として deploy される product です。OpenTofu state、Cloudflare
credential、runtime-agent runtime handler、Connection / ProviderBinding / policy で解決する provider
allowlist は in-process deploy-control plane の Connection / ProviderBinding / policy の責務です。

## Source of truth

- `../takosumi` は Takosumi public contract、OpenTofu-native deploy control
  API、Installation / Run / Deployment / OutputSnapshot の run
  ledger の **実装 source owner**。単一 Takos worker が in-process import する。
- `takos/deploy/cloudflare`、`takos/deploy/opentofu` (Cloudflare module)、
  `takos/deploy/distributions/cloudflare.json` は Takos product の Cloudflare
  deploy artifacts を所有する。
- `takos-private` が concrete Cloudflare credential、OpenTofu state、
  runtime-agent handler wiring、live proof evidence を所有する。

## Takos docs に書いてよいこと

- Takos product service、Hono route、UI、Git container、agent container の構成。
- Takos distribution が必要とする backing resource topology、Cloudflare
  OpenTofu output bridge、provider proof task。
- self-host / cloud proof を source-controlled plan review と live operator
  evidence (`apply` type Run / OutputSnapshot) に分けること。

## NG パターン

- provider / backend / adapter selection を Takos の public deploy API
  authoring field として露出すること (それは Connection / ProviderBinding / policy の責務)。
- OpenTofu が state を持つ resource lifecycle を Takosumi public contract の一部
  として説明すること。
- cloud provider credential を Takos product repo の deploy artifact に埋め込むこと。
- Takosumi internal implementation binding を Takos product feature として説明すること。

## Current Audit

- runtime / routing docs は Takos service ports、backing resource topology、
  OutputSnapshot を説明する。
- 実 backend と self-host docs は operator-owned proof として扱う。
- README / current-state / hosting docs は `Connection / ProviderBinding / policy` / OpenTofu /
  Deployment / OutputSnapshot の語彙を使う。
- Takos product release gate は source-controlled plan review までを扱い、live
  provider proof は operator evidence (`apply` type Run / OutputSnapshot) として分離する。
