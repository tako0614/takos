# トラブルシューティング

> このページでわかること: デプロイ時によくあるエラーとその対処法。

## AppSpec validation

### `metadata.id` / `metadata.name` is required

`.takosumi.yml` AppSpec には `metadata.id` と `metadata.name` が必要です。

```yaml
apiVersion: v1
metadata:
  id: com.example.my-app
  name: my-app
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
```

### AppSpec の解決に失敗する

通常の install / deploy は `.takosumi.yml` を Takosumi installer が読み、
AppSpec `connect`、platform service `listen`、root `publish`、gateway descriptor
spec を解決してから apply します。build が必要な source は、Installer API の前に
build service / CI で prepared source archive にします。

Local checkout preflight:

```bash
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
```

Apply uses direct Git/local source only when every runtime file referenced by
kind-specific `spec` already exists in that source snapshot. Build-required apps
are applied from a prepared source URL + digest produced by the build service /
CI.

dry-run が失敗する場合は、`.takosumi.yml` の kind-specific `spec`、
`components.*.connect` / `components.*.listen` 宣言、 install 時の `source` と
`spaceId` を確認してください。malformed な local `component.output` ref や cycle
は `400 invalid_argument` です。required platform service (e.g.
`identity.primary.oidc`) が current Space state に無い場合や、同じ path の
visible declaration が重複している場合は provider side effect 前に
`409 failed_precondition` で失敗します。operator が採用していない extension kind
/ projection は `501 not_implemented` です。request body や manifest が size
上限を超える場合は `413 Payload Too Large` です。

### runtime file path がない

`worker` component は kind-specific `spec.entrypoint` に runtime file path
を書きます。build service / CI を使う場合は、prepared source archive の中にその
path が含まれるか確認します。

## Binding / Accounts

### OIDC redirect が失敗する

- `.takosumi.yml` の `listen.oidc.path: identity.primary.oidc` 宣言を確認する
- materialized `OIDC_REDIRECT_URI` が app の callback と一致するか確認する
- Takosumi Accounts (takosumi-cloud) 側の client registration と issuer URL
  を確認する

### launch token が redeem できない

- `ACCOUNTS_BASE_URL` が install 時に materialize されているか確認する
- `INSTALL_LAUNCH_INSTALLATION_ID` が Installation id と一致するか確認する
- `INSTALL_LAUNCH_REDIRECT_URI` が Accounts 発行時に bind した URL
  と完全一致するか確認する (Accounts API は
  `409 launch_token_redirect_mismatch`)。Installer API の expected guard
  mismatch は `409 failed_precondition`
- `/_takosumi/launch` の handler が
  `${ACCOUNTS_BASE_URL}/v1/installations/${INSTALL_LAUNCH_INSTALLATION_ID}/launch-token/consume`
  を TLS で叩いているか確認する
- token が one-time (used flag) で消費されたか、期限切れ (5 分 hard cap)
  を超えていないか確認する

## Install / Deployment apply

Installation ledger を経由する current path は install dry-run / apply
です。Provider operation の失敗は Takosumi kernel の Deployment status / output
/ evidence と Accounts 側 InstallationEvent を確認します。

Local checkout preflight:

```bash
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
takosumi deploy dry-run "$INSTALLATION_ID" --source .
```

Managed apply for build-required apps passes prepared source material:

```json
{
  "source": {
    "kind": "prepared",
    "url": "https://build.example.com/snapshots/app-123.archive",
    "digest": "sha256:..."
  },
  "expected": {
    "manifestDigest": "sha256:...",
    "sourceDigest": "sha256:...",
    "currentDeploymentId": "deployment:..."
  }
}
```

## Auth

Takos product の primary access path は Web UI と public API です。API
automation では Takosumi Accounts の bearer / OIDC grant を使い、app-local PAT
や Takos product 固有の login state は扱いません。

## Next

- [Git / Store install](/deploy/store-deploy)
- [AppSpec deployment lifecycle](/deploy/deploy)
- [ロールバック](/deploy/rollback)
