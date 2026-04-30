# Object Storage Smoke

`scripts/object-storage-smoke.ts` validates the object-storage plugin/adapter
surface without requiring object-storage infrastructure by default.

## Safe default

```sh
deno run --config deno.json \
  --allow-env=TAKOS_RUN_OBJECT_STORAGE_SMOKE,TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT \
  scripts/object-storage-smoke.ts
```

The default path is intentionally no-network and does not require S3
credentials. It validates:

- `MemoryObjectStorage` put/head/get/list/delete with SHA-256 digest checking.
- `S3DryRunObjectStorageClient` request construction for
  PUT/HEAD/GET/LIST/DELETE with deterministic SigV4 request signing.

If `TAKOS_RUN_OBJECT_STORAGE_SMOKE=1` is set without the second real-endpoint
flag, the script stays in dry-run mode and prints a safety warning.

## Real S3-compatible endpoint plugin opt-in

Real endpoint access is for object-storage plugin/operator validation and
requires both explicit flags plus endpoint, bucket, and credentials:

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

The real path writes one unique object under `TAKOS_OBJECT_STORAGE_SMOKE_PREFIX`
(default `takos-smoke`), then signs and runs PUT, HEAD, GET, LIST, and DELETE
requests. Secrets are never printed.

Supported env aliases for real endpoint mode:

- Endpoint: `TAKOS_OBJECT_STORAGE_SMOKE_ENDPOINT`, `S3_ENDPOINT`,
  `AWS_S3_ENDPOINT`
- Bucket: `TAKOS_OBJECT_STORAGE_SMOKE_BUCKET`, `S3_BUCKET`,
  `AWS_S3_TENANT_SOURCE_BUCKET`, `AWS_S3_BUCKET`
- Region: `TAKOS_OBJECT_STORAGE_SMOKE_REGION`, `S3_REGION`, `AWS_REGION`,
  `AWS_DEFAULT_REGION` (defaults to `us-east-1`)
- Access key: `TAKOS_OBJECT_STORAGE_SMOKE_ACCESS_KEY_ID`, `S3_ACCESS_KEY_ID`,
  `AWS_ACCESS_KEY_ID`
- Secret key: `TAKOS_OBJECT_STORAGE_SMOKE_SECRET_ACCESS_KEY`,
  `S3_SECRET_ACCESS_KEY`, `AWS_SECRET_ACCESS_KEY`
- Session token: `TAKOS_OBJECT_STORAGE_SMOKE_SESSION_TOKEN`, `AWS_SESSION_TOKEN`
- Path style: `TAKOS_OBJECT_STORAGE_SMOKE_FORCE_PATH_STYLE` (default `1`; set
  `0` for virtual-hosted style)
