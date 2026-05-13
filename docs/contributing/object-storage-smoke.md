# Object Storage Smoke

> このページでわかること: Object storage プラグインの smoke テスト。

`scripts/object-storage-smoke.ts` は object-storage plugin / adapter 表面を、object-storage インフラ無しに検証します。

## Safe default

```sh
deno run --config deno.json \
  --allow-env=TAKOS_RUN_OBJECT_STORAGE_SMOKE,TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT \
  scripts/object-storage-smoke.ts
```

default は no-network で S3 資格情報不要です。検証内容。

- `MemoryObjectStorage` の put / head / get / list / delete (SHA-256 digest チェック付き)。
- `S3DryRunObjectStorageClient` による PUT / HEAD / GET / LIST / DELETE 要求の組み立てと、決定論的な SigV4 署名。

`TAKOS_RUN_OBJECT_STORAGE_SMOKE=1` のみで real-endpoint フラグが無い場合、スクリプトは dry-run のまま安全警告を表示します。

## 実 S3 互換エンドポイントの opt-in

実エンドポイントへのアクセスは object-storage plugin / operator 検証用で、両方のフラグに加えて endpoint・bucket・認証情報が必要です。

```sh
TAKOS_RUN_OBJECT_STORAGE_SMOKE=1 \
TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT=1 \
TAKOS_OBJECT_STORAGE_SMOKE_ENDPOINT=https://s3.example.internal \
TAKOS_OBJECT_STORAGE_SMOKE_BUCKET=takos-smoke \
TAKOS_OBJECT_STORAGE_SMOKE_ACCESS_KEY_ID=... \
TAKOS_OBJECT_STORAGE_SMOKE_SECRET_ACCESS_KEY=... \
deno run --config deno.json \
  --allow-env=TAKOS_RUN_OBJECT_STORAGE_SMOKE,TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT,TAKOS_OBJECT_STORAGE_SMOKE_ENDPOINT,TAKOS_OBJECT_STORAGE_SMOKE_BUCKET,TAKOS_OBJECT_STORAGE_SMOKE_ACCESS_KEY_ID,TAKOS_OBJECT_STORAGE_SMOKE_SECRET_ACCESS_KEY,TAKOS_OBJECT_STORAGE_SMOKE_SESSION_TOKEN,TAKOS_OBJECT_STORAGE_SMOKE_REGION,TAKOS_OBJECT_STORAGE_SMOKE_FORCE_PATH_STYLE,TAKOS_OBJECT_STORAGE_SMOKE_PREFIX,S3_ENDPOINT,S3_BUCKET,S3_ACCESS_KEY_ID,S3_SECRET_ACCESS_KEY,S3_REGION,AWS_S3_ENDPOINT,AWS_S3_BUCKET,AWS_S3_TENANT_SOURCE_BUCKET,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN,AWS_REGION,AWS_DEFAULT_REGION \
  --allow-net=s3.example.internal \
  scripts/object-storage-smoke.ts
```

real パスでは `TAKOS_OBJECT_STORAGE_SMOKE_PREFIX` (default `takos-smoke`) 配下に一意なオブジェクトを 1 件作成し、署名付きで PUT / HEAD / GET / LIST / DELETE を実行します。秘密情報は出力しません。

real モードで利用可能な env エイリアス。

- Endpoint: `TAKOS_OBJECT_STORAGE_SMOKE_ENDPOINT` / `S3_ENDPOINT` / `AWS_S3_ENDPOINT`
- Bucket: `TAKOS_OBJECT_STORAGE_SMOKE_BUCKET` / `S3_BUCKET` / `AWS_S3_TENANT_SOURCE_BUCKET` / `AWS_S3_BUCKET`
- Region: `TAKOS_OBJECT_STORAGE_SMOKE_REGION` / `S3_REGION` / `AWS_REGION` / `AWS_DEFAULT_REGION` (default は `us-east-1`)
- Access key: `TAKOS_OBJECT_STORAGE_SMOKE_ACCESS_KEY_ID` / `S3_ACCESS_KEY_ID` / `AWS_ACCESS_KEY_ID`
- Secret key: `TAKOS_OBJECT_STORAGE_SMOKE_SECRET_ACCESS_KEY` / `S3_SECRET_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY`
- Session token: `TAKOS_OBJECT_STORAGE_SMOKE_SESSION_TOKEN` / `AWS_SESSION_TOKEN`
- Path style: `TAKOS_OBJECT_STORAGE_SMOKE_FORCE_PATH_STYLE` (default `1`、virtual-hosted の場合は `0`)
