# トラブルシューティング

> このページでわかること: デプロイ時によくあるエラーとその対処法。

## Manifest validation

### `metadata.name is required`

compiled manifest には `metadata.name` が必要です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
resources: []
```

### unresolved placeholder

kernel request 前に `workflowRef` と installer-only placeholder は解決されている
必要があります。

```bash
takosumi-git install preview --cwd . --json
takosumi-git install apply --cwd . ...
```

`takosumi-git` の compile 後も placeholder が残る場合は、`.takosumi.yml` の
binding 宣言、workflow artifact output、install params を確認してください。

### artifact digest がない

`worker@v1` は `spec.artifact.hash` に concrete digest が必要です。workflow
output から digest を materialize する場合は `workflowRef.target` が正しい field
を指して いるか確認します。

## Binding / Accounts

### OIDC redirect が失敗する

- `.takosumi.yml` の `bindings.auth.redirectPaths` を確認する
- materialized `OIDC_REDIRECT_URI` が app の callback と一致するか確認する
- Accounts 側の client registration と issuer URL を確認する

### launch token が redeem できない

- `ACCOUNTS_BASE_URL` が install 時に materialize されているか確認する
- `INSTALL_LAUNCH_INSTALLATION_ID` が Installation id と一致するか確認する
- `INSTALL_LAUNCH_REDIRECT_URI` が Accounts 発行時に bind した URL
  と完全一致するか確認する (mismatch は 409)
- `/_takosumi/launch` の handler が
  `${ACCOUNTS_BASE_URL}/v1/installations/${INSTALL_LAUNCH_INSTALLATION_ID}/launch-token/consume`
  を TLS で叩いているか確認する
- token が one-time (used flag) で消費されたか、 期限切れ (5 分 hard cap)
  を超えていないか確認する

## Direct deploy

direct deploy では Installation ledger を経由しないため、binding 自動注入や
permission preview はありません。operator は compiled manifest と secrets を
自分で用意します。

```bash
takosumi plan ./compiled-manifest.yml --remote "$TAKOSUMI_ENDPOINT"
takosumi deploy ./compiled-manifest.yml --remote "$TAKOSUMI_ENDPOINT"
takosumi status my-app --remote "$TAKOSUMI_ENDPOINT"
```

Provider operation の失敗は Takosumi kernel の status output / conditions
を確認します。

## Auth

```bash
takos whoami
takos login --api-url https://takos.example.com --token "$TAKOSUMI_ACCOUNTS_PAT"
takos endpoint show
```

Takos CLI の auth は [CLI / Auth model](/reference/cli-auth)
を参照してください。

## Next

- [Git / Store install](/deploy/store-deploy)
- [Direct manifest deploy](/deploy/deploy)
- [ロールバック](/deploy/rollback)
