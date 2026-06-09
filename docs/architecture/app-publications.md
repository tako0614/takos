# アプリメタデータの境界

> このページでわかること: アプリ表示・配置に関わるメタデータを Takos と Takosumi の
> どちらが持つか。

**前提: Takos は plain OpenTofu module として self-host 完結し、Takosumi は optional です。** Takosumi は OpenTofu-native な deploy control
plane で、plain OpenTofu module を install / apply し、run ledger
(**Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment**) を記録します。provider
allowlist / credential / state backend / Cloudflare Container execution は **Connection / ProviderBinding / policy**
が所有します。アプリの「メタデータ」自体は
Takosumi の関心ではありません。

## Takos が持つメタデータ

Takos は product として、ユーザーに見えるアプリ情報を所有します。

- bundled app の launcher metadata（新規 space 作成時に auto-install される 1st-party App の表示情報）
- file-handler metadata（どのファイル種別をどのアプリで開くか）
- MCP-facing な product metadata
- chat / agent / memory / space に紐づくアプリ内データ

これらは Takos product の DB / UI に閉じており、デプロイ経路を経由しません。bundled app は通常の
AppInstallation として記録され、ユーザーが uninstall できます。

## Takosumi が記録すること

アプリの「実体」をどこに materialize するかは、Takosumi の run ledger 側の関心です。

- どの OpenTofu module をどの Git URL / commit / tag / module path で install したか（Installation）
- plan / apply / destroy の run（typed Runs）と、適用後の Deployment / OutputSnapshot
- Connection / ProviderBinding / policy に紐づく provider allowlist / state backend / execution 境界

Takos の deploy topology 自体も `deploy/opentofu` の OpenTofu module
(`var.target` ∈ `aws | gcp | cloudflare`) として Takosumi が install / apply し、cloudflare target
では backing resource (D1 / KV / R2 / Queues) を provision します。`wrangler` / `helm` /
distribute pipeline はこの同じ topology の **interim materialization** であり、別の source of
truth ではありません。

account-plane policy（account / billing / OIDC / dashboard）は operator distribution /
Takosumi Accounts が持ちます。

## References

- [内部トラスト境界](./internal-trust-boundaries.md)
- [システムアーキテクチャ](./system-architecture.md)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
