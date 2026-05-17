# Object Storage Proof

> このページでわかること: object-store / export artifact surface の current proof。

Takosumi object-store contract and in-memory storage behavior are covered in
Takosumi tests.

```sh
cd ../takosumi
deno test --allow-all \
  packages/contract/src/plugin-sdk_test.ts \
  packages/kernel/src/adapters/object-storage/memory_test.ts \
  packages/kernel/src/api/artifact_routes_test.ts
```

Takosumi Accounts Cloudflare Worker stores metadata-only export artifacts in R2
and serves signed same-origin downloads. Verify that path with:

```sh
cd ../takosumi-cloud
deno test --allow-all deploy/cloudflare/src/worker_test.ts
```

Provider-owned S3 / R2 / GCS live proof belongs in managed-offering or
distribution target evidence.
