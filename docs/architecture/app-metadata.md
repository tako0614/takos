# アプリメタデータの境界

> このページでわかること: アプリ表示・配置に関わるメタデータを Takos と Takosumi の
> どちらが持つか。

**前提: Takos は OpenTofu-native, Takosumi-managed な AI workspace distribution です。** Takosumi は OpenTofu-native な deploy
control plane で、Git URL の OpenTofu Capsule を install / plan / apply し、run ledger
(**Capsule -> Run -> StateVersion -> Output**) を記録します。provider
allowlist / credential / state backend / Cloudflare Container execution は **ProviderConnection / ProviderBinding /
policy** が所有します。アプリの「ユーザーに見えるメタデータ」自体は Takos product surface が所有します。

## Capsule Runtime Projection Profile

Takos は product として、ユーザーに見える workspace experience を所有します。ただし Git / storage / agent runtime / MCP を
Takos 固有の service class として扱わず、Capsule が公開する well-known OpenTofu Output (`service_exports` /
`service_bindings` / `app_deployment`) の first-party profile として扱います。詳細は
[Capsule Runtime Projection](./capsule-runtime-projection) を参照。Output capture と output-to-input wiring の正本は
Takosumi が所有し、Takos はそれらの Output を app launcher、MCP registry、file handling、Git UX、storage UX、agent UX に
投影します。projection parser 自体は read-only / store-free で、Takosumi OSS は Service Graph ledger を持ちません。一方、
`storage.object` / `source.git.smart_http` の consume では、Takosumi deploy-control が requested scopes を検証し、
producer の protected signing material から prefix-scoped credential を bind time に生成して consumer Run へ注入します。

- explicitly installed app の launcher metadata（Git URL / ref / module path から追加された app の表示情報）
- file-handler metadata（どのファイル種別をどのアプリで開くか）
- MCP server metadata
- projected service metadata (`storage.*` / `source.*` / `automation.*` / `protocol.mcp.server` /
  `interface.file.handler` / `interface.ui.surface`)
- chat / agent / memory / Workspace に紐づくアプリ内データ

これらは Takos product の DB / UI に閉じた特殊機能ではなく、Capsule output projection に投影されます。app は通常の
Capsule として記録され、ユーザーが uninstall できます。`takos-storage` / `takos-git` / `takos-computer` も同じ通常の
installable Capsule であり、その agent tool を Takos static catalog に複製しません。Takos product 内部の
`storage.filesystem` / `source.repository` runtime projection とは別の境界です。

OpenTofu Capsule が producer-neutral service metadata を渡す場合は Capsule output projection の optional well-known output
`service_exports`、または service-side InstallConfig mapping を使います。標準 capability id は Capsule output projection の
`protocol.mcp.server` / `interface.file.handler` / `interface.ui.surface` / `storage.*` / `source.*` /
`automation.*` を使います。

### Launcher icon の安全境界

runtime `Interface` への移行中も、Takos の launcher は Takosumi contract が export する共有 Display Metadata parser を
唯一の解釈として使います。`document.display.icon` と legacy projection から移行中の同等フィールドが受け付けるのは、
credential 情報を含まない絶対 HTTPS URL、surface URL の origin を基準に解決できる先頭 `/` の path、または 16 文字以内で
`/` `.` `:` を含まない短い glyph だけです。`javascript:` / `data:` / protocol-relative URL / userinfo / fragment /
credential-named query は server 側で no-icon fallback に落とし、browser renderer へ渡しません。Store/release catalog の
icon も untrusted presentation metadata として別途検証し、不正値を launcher authority に昇格させません。

## Takosumi が記録すること

アプリの「実体」をどこに materialize するかは、Takosumi の run ledger 側の関心です。

- どの OpenTofu module をどの Git URL / commit / tag / module path で install したか（Source / Capsule）
- plan / apply / destroy の run（typed Runs）と、適用後の StateVersion / Output
- ProviderConnection / ProviderBinding / policy に紐づく provider allowlist / state backend / execution 境界

Takos の deploy topology 自体も `deploy/opentofu` の OpenTofu module
(`var.target = cloudflare`) として Takosumi が install / apply し、cloudflare target
では backing resource (D1 / KV / R2 / Queues) を provision します。手書きの `wrangler` /
distribute pipeline はこの同じ topology の **interim materialization** であり、別の source of
truth ではありません。

account-plane policy（account / billing / OIDC / dashboard）は Takosumi Accounts plane が持ちます。

## References

- [内部トラスト境界](./internal-trust-boundaries.md)
- [システムアーキテクチャ](./system-architecture.md)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
