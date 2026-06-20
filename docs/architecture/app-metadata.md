# アプリメタデータの境界

> このページでわかること: アプリ表示・配置に関わるメタデータを Takos と Takosumi の
> どちらが持つか。

**前提: Takos は OpenTofu-native, Takosumi-managed な first-party AI workspace distribution です。** Takosumi は OpenTofu-native な deploy
control plane で、Git URL の OpenTofu Capsule を install / plan / apply し、run ledger
(**Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment**) を記録します。provider
allowlist / credential / state backend / Cloudflare Container execution は **Connection / Installation provider connection /
policy** が所有します。アプリの「ユーザーに見えるメタデータ」自体は Takos product surface が所有します。

## Takos Service Graph Profile

Takos は product として、ユーザーに見える workspace experience を所有します。ただし Git / storage / agent runtime / MCP を
Takos 固有の service class として扱わず、[Takosumi Service Graph](https://takosumi.com/docs/service-graph-spec) の
first-party profile として扱います。ServiceExport / ServiceBinding / ServiceGrant の標準は Takosumi が所有し、Takos は
app launcher、MCP registry、file handling、Git UX、storage UX、agent UX に投影します。

- bundled app の launcher metadata（新規 Workspace 作成時に distribution seed として install される 1st-party App の表示情報）
- file-handler metadata（どのファイル種別をどのアプリで開くか）
- MCP server metadata
- Service Graph metadata (`storage.*` / `source.*` / `automation.*` / `protocol.mcp.server` /
  `interface.file.handler` / `interface.ui.surface`)
- chat / agent / memory / Workspace に紐づくアプリ内データ

これらは Takos product の DB / UI に閉じた特殊機能ではなく、Takosumi Service Graph に投影されます。bundled app は通常の
AppInstallation として記録され、ユーザーが uninstall できます。

OpenTofu Capsule が producer-neutral service metadata を渡す場合は Service Graph の optional well-known output
`service_exports`、または service-side InstallConfig mapping を使います。標準 capability id は Service Graph の
`protocol.mcp.server` / `interface.file.handler` / `interface.ui.surface` / `storage.*` / `source.*` /
`automation.*` を使います。

## Takosumi が記録すること

アプリの「実体」をどこに materialize するかは、Takosumi の run ledger 側の関心です。

- どの OpenTofu module をどの Git URL / commit / tag / module path で install したか（Installation）
- plan / apply / destroy の run（typed Runs）と、適用後の Deployment / OutputSnapshot
- Connection / Installation provider connection / policy に紐づく provider allowlist / state backend / execution 境界

Takos の deploy topology 自体も `deploy/opentofu` の OpenTofu module
(`var.target = cloudflare`) として Takosumi が install / apply し、cloudflare target
では backing resource (D1 / KV / R2 / Queues) を provision します。手書きの `wrangler` /
distribute pipeline はこの同じ topology の **interim materialization** であり、別の source of
truth ではありません。

account-plane policy（account / billing / OIDC / dashboard）は embedded Takosumi Accounts
plane が持ちます。

## References

- [内部トラスト境界](./internal-trust-boundaries.md)
- [システムアーキテクチャ](./system-architecture.md)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
