# トラブルシューティング

> このページでわかること: デプロイ時によくあるエラーとその対処法。

## AppSpec validation

### `metadata.id` / `metadata.name` is required

`.takosumi.yml` AppSpec には `metadata.id` と `metadata.name` が必要です。

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: com.example.my-app
  name: my-app
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
```

### AppSpec の解決に失敗する

通常の install / deploy は `.takosumi.yml` を Takosumi installer が読み、
build / dependency edge / OIDC / route output を解決してから apply します。

```bash
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
```

dry-run が失敗する場合は、`.takosumi.yml` の `components.*.build.output`、
`components.*.use` edge、OIDC `redirectPaths`、install 時の `source` と
`spaceId` を確認してください。

### build output がない

`worker` component は `components.<name>.build.output` に concrete bundle path が必要です。build command 後に
その path が存在するか確認します。

## Binding / Accounts

### OIDC redirect が失敗する

- `.takosumi.yml` の `components.<auth>.redirectPaths` を確認する
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

## Install / Deployment apply

Installation ledger を経由する current path は install dry-run / apply です。Provider operation の失敗は
Takosumi kernel の Deployment output / conditions と Accounts 側 InstallationEvent を確認します。

```bash
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
takosumi deploy dry-run "$INSTALLATION_ID" --source .
takosumi deploy "$INSTALLATION_ID" --source .
```

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
- [AppSpec deployment lifecycle](/deploy/deploy)
- [ロールバック](/deploy/rollback)
