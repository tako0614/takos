# Operator Boundary Audit

> このページでわかること: Takos product docs が Takosumi v1 と operator-owned
> infrastructure の境界を崩していないか確認するチェックリスト。

Takos は Takosumi に Capsule / Run / StateVersion / Output として deploy される product です。OpenTofu state、Cloudflare
credential、runtime-agent runtime handler、ProviderConnection / ProviderBinding / policy で解決する provider
allowlist は Takosumi deploy-control plane の ProviderConnection / ProviderBinding / policy の責務です。

## 正とする情報

- `../takosumi` は Takosumi public contract、OpenTofu-native deploy control
  API、Capsule / Run / StateVersion / Output の run
  ledger の **実装 source owner**。Takos worker は contract を参照し、runtime では Takosumi API を読み込む。
- `takos/deploy/cloudflare` と `takos/deploy/opentofu/cloudflare` は direct
  Cloudflare adapter の artifact を所有する。`takos/deploy/opentofu/takoform`
  は同じ中立resource contractをTakoform対応hostへ写す。
- `takosumi-private` と operator-local environment が concrete Cloudflare credential、OpenTofu state、
  runtime-agent handler wiring、live proof evidence を所有する。

## Takos docs に書いてよいこと

- Takos product service、Hono route、UI、Git container、agent container の構成。
- Takos distribution が必要とする backing resource topology、Cloudflare
  OpenTofu output bridge、provider proof task。
- self-host / cloud proof を source-controlled plan review と live operator
  evidence (`apply` type Run / Output) に分けること。

## NG パターン

- provider / backend / adapter selection を Takos の public deploy API
  authoring field として露出すること (それは ProviderConnection / ProviderBinding / policy の責務)。
- OpenTofu が state を持つ resource lifecycle を Takosumi public contract の一部
  として説明すること。
- cloud provider credential を Takos product repo の deploy artifact に埋め込むこと。
- Takosumi internal implementation binding を Takos product feature として説明すること。

## Current Audit

- runtime / routing docs は Takos service ports、backing resource topology、
  Output を説明する。
- 実 backend と self-host docs は operator-owned proof として扱う。
- README / current-state / hosting docs は `ProviderConnection / ProviderBinding / policy` / OpenTofu /
  StateVersion / Output の語彙を使う。
- Takos portable source check は repository consistency だけを扱う。deploy は
  owning repository の entrypoint、live provider proof は別 cadence の operator
  evidence (`apply` type Run / Output) として分離する。
