# Worker artifact materializer

`deploy/opentofu` は D1、KV、R2、Queue などの backing resource を作ります。
Worker script/assets、Durable Object migration、4 個の Container application、Queue
consumer、Vectorize は、Takos が所有する follow-up command
`scripts/takos-product-materializer.ts` が materialize します。

この command は deploy control plane ではありません。plan、apply、destroy、Run、
StateVersion、Output、AuditEvent と credential の一時 materialization は Takosumi が
所有します。Takos の command は、Takosumi runner が渡した 1 回の lifecycle action
内でだけ動作し、別の state/ledger を保存しません。

## InstallConfig declaration

Takosumi の DB-owned `InstallConfig` は、次の field を plan に固定します。artifact
descriptor の URL と digest は例であり、選択した Takos release の create-only asset
へ置き換えます。

```ts
{
  modulePath: "deploy/opentofu",
  sourceBuild: {
    commands: [{ argv: ["bun", "install", "--frozen-lockfile"] }],
    outputs: ["node_modules/wrangler/bin/wrangler.js"],
  },
  lifecycleActions: [
    {
      apiVersion: "takosumi.dev/v1alpha1",
      kind: "command",
      id: "takos-product-activate-v1",
      phase: "post_apply",
      executor: "runner",
      command: ["bun", "run", "product:activate"],
      workingDirectory: ".",
      env: {
        TAKOS_RELEASE_ARTIFACT_DESCRIPTOR_URL:
          "https://github.com/tako0614/takos/releases/download/v0.11.11/takosumi-artifact.json",
        TAKOS_RELEASE_ARTIFACT_DESCRIPTOR_SHA256: "sha256:<64 lowercase hex>",
      },
      timeoutSeconds: 3600,
      runnerCapability: "capsule.lifecycle.command.v1",
      useProviderCredentials: true,
    },
    {
      apiVersion: "takosumi.dev/v1alpha1",
      kind: "command",
      id: "takos-product-pre-destroy-v1",
      phase: "pre_destroy",
      executor: "runner",
      command: ["bun", "run", "product:pre-destroy"],
      workingDirectory: ".",
      timeoutSeconds: 1800,
      runnerCapability: "capsule.lifecycle.command.v1",
      useProviderCredentials: true,
    },
  ],
  policy: {
    allowedProviders: ["registry.opentofu.org/cloudflare/cloudflare"],
    providerCredentials: {
      requiredProviders: ["registry.opentofu.org/cloudflare/cloudflare"],
    },
    lifecycleActions: {
      allowedExecutors: ["runner"],
      allowedRunnerCapabilities: ["capsule.lifecycle.command.v1"],
      allowProviderCredentials: true,
    },
  },
}
```

`TAKOSUMI_SOURCE_SNAPSHOT_ID` と `TAKOSUMI_SOURCE_COMMIT` は action `env` では
ありません。Takosumi host が Plan に固定した SourceSnapshot から生成する reserved
runner env です。descriptor の `commit` は必ずこの commit と一致しなければなりません。
`TAKOSUMI_OUTPUTS_JSON`、`TAKOSUMI_PROVIDER_CONFIGS_JSON`、
`TAKOSUMI_RELEASE_CONTEXT_JSON` も host-owned で、action `env` から上書きできません。

Lifecycle action は `outputAllowlist` による公開 projection ではなく、同じ apply の
non-sensitive raw outputs を受け取ります。少なくとも次を必要とします。

- `cloudflare_account_id`, `service_runtime_name`, `public_url`
- `executor_capacity`, `worker_env`
- `sql_databases.db`, `key_value_stores.hostname_routing`
- `object_buckets` の 5 entry
- `queues` の main/DLQ 8 entry
- `vector_indexes.vector` の name/dimensions/metric

Lifecycle command 自体は Bun で動きますが、SourceSnapshot に固定した Wrangler は
runner の `/usr/local/bin/node` でだけ実行します。Wrangler 4.107.0 の runtime contract
に合わせて Node 22 以上を preflight で確認し、Node がない・古い・version readback が
曖昧な場合は provider mutation を開始しません。

## CredentialRecipe declaration

Cloudflare ProviderConnection の selected auth mode は、通常の provider token と
Takos runtime secret JSON を、明示した env/file として同じ run にだけ materialize
します。概念上の recipe は次の形です。

```ts
{
  terraformSource: ["registry.opentofu.org/cloudflare/cloudflare"],
  envNames: ["CLOUDFLARE_API_TOKEN", "TAKOS_RUNTIME_SECRETS_FILE"],
  requiredEnvGroups: [
    ["CLOUDFLARE_API_TOKEN", "TAKOS_RUNTIME_SECRETS_FILE"],
  ],
  authModes: {
    api_token_with_takos_runtime: {
      env: {
        CLOUDFLARE_API_TOKEN: {
          from: "secret",
          name: "CLOUDFLARE_API_TOKEN",
        },
      },
      files: {
        "takos-runtime-secrets.json": {
          from: "secret",
          name: "TAKOS_RUNTIME_SECRETS_JSON",
          envName: "TAKOS_RUNTIME_SECRETS_FILE",
          mode: 384,
        },
      },
    },
  },
}
```

`mode: 384` は octal `0600` です。materializer は regular file、非 symlink、owner、
hard-link count、mode、size と JSON key set を mutation 前に検査します。runtime secret
は stdout、evidence、argv、OpenTofu variable/output へ出しません。

runtime secret JSON の必須 key は次の 6 個です。

```text
ENCRYPTION_KEY
OIDC_CLIENT_SECRET
PLATFORM_PRIVATE_KEY
PLATFORM_PUBLIC_KEY
TAKOS_AGENT_START_TOKEN
TAKOS_INTERNAL_API_SECRET
```

operator がこの JSON を手作業で組み立てずに用意する場合は、Takos repo の generator
で private output directory に opt-in 生成できます。通常の 6 個の個別ファイルも同時に
生成され、JSON は `takos-runtime-secrets.json` という正確な key set で mode `0600` に
なります。既存ファイルは `--force` なしでは上書きされません。

```sh
bun run generate:keys -- \
  --env=production \
  --output=/path/to/private/secrets \
  --runtime-json
```

生成した JSON は `TAKOS_RUNTIME_SECRETS_FILE` として lifecycle action に渡し、内容を
read、print、log へコピーしません。生成物は repository の外に置きます。

## Lifecycle and recovery

`post_apply` は、全入力と生成した Wrangler config の dry-run、既存 resource ownership
readback を終えてから mutation を開始します。Vectorize を idempotently 作成し、D1
migration、Worker/assets/DO/container/queue/secret を反映した後、deployment/version、
container、Queue、Vectorize、secret name、公開 `/health` を読み戻します。terminal
evidence は digest と count だけを返します。

Wrangler の deployment status が成功かつ stdout/stderr とも空の場合は、Cloudflare の
Worker settings endpoint を直接 readback します。HTTP `200` は Worker が存在するため
`resource_conflict`、HTTP `404` だけを不在として扱い、それ以外の status または通信
失敗は digest-only evidence で fail-closed にします。

同様に `wrangler deploy` の exit code `0` だけでは deployment 成功とみなしません。
exact deployment、100% traffic の version、release tag と provenance message を
Cloudflare から読み戻した後にだけ `worker_deployed` stage を記録します。

`pre_destroy` は、既存 Worker version の binding / provenance で ownership を証明して
から Queue consumer、4 Container application、Vectorize を削除し、不在が収束した後に
ownership anchor である Worker を最後に削除します。D1、KV、R2、Queue 本体は削除せず、
続く OpenTofu destroy に渡します。同名 resource の ownership を証明できない場合や途中
失敗を成功扱いにせず、同じ stale action の blind retry を要求しません。D1 migration は
forward-only なので、原則は Cloudflare の authoritative readback 後に fresh plan から
forward repair します。以前の artifact へ戻す場合も、schema compatibility を確認した
新しい plan が必要です。
