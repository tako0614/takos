# プロジェクト構成

Takos / InstallableApp プロジェクトで使う `.takosumi/` ディレクトリと
関連ファイルの役割を整理する。

## 2 段の manifest 構造 {#two-tier-manifests}

Installable App Model では、project root の `.takosumi/` 配下に **2 段** の
manifest を置きます。

| ファイル                 | 用途                                | 渡し先                                                   | 仕様                                                |
| ------------------------ | ----------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `.takosumi/app.yml`      | InstallableApp v1 (installer-bound) | takosumi-git (install UI / binding / permission preview) | [reference/app-yml-spec](/reference/app-yml-spec)   |
| `.takosumi/manifest.yml` | kernel-bound compute manifest       | takosumi kernel (`POST /v1/deployments`)                 | [reference/manifest-spec](/reference/manifest-spec) |

`.takosumi/app.yml` (installer-bound; InstallableApp v1) と
`.takosumi/manifest.yml` (kernel-bound; compute manifest) の **二段構造** が
正本です。新規 app では `.takosumi/` 配下で install metadata と compute manifest
を分離してください。

## ディレクトリ構成

current project tree はこうなります。

```text
my-app/
├── .takosumi/
│   ├── app.yml              ← installer-bound (InstallableApp v1)
│   ├── manifest.yml         ← kernel-bound (compute manifest)
│   └── workflows/
│       ├── build-api.yml
│       ├── build-web.yml
│       └── build-agent.yml
├── src/
│   └── index.ts
└── ...
```

`workflows/*.yml` は takosumi-git の workflow runner に渡される build job
定義で、`.takosumi/manifest.yml` から `${artifacts.<job>.<key>}` 形式で build
出力を参照します
([reference/manifest-spec § Compile-time placeholders](/reference/manifest-spec#compile-time-placeholders))。

## 各ファイルの役割

### Deploy Manifest (`.takosumi/manifest.yml`)

Takos で「何をデプロイするか」を宣言する kernel-bound
manifest。`apiVersion:
"1.0"` / `kind: Manifest` / `resources[]` の closed
envelope で、compute resource、route、resource dependency、service import
を定義します。

`.takosumi/manifest.yml` は group の deploy/runtime contract です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
serviceResolvers:
  - kind: anchor
    url: https://anchor.example.com/v1/services/
    publicKey: BASE64_ED25519_PUBLIC_KEY
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      routes:
        - my-app.example.com/*
      env:
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
        OIDC_CLIENT_ID: ${bindings.auth.clientId}
        OIDC_CLIENT_SECRET: ${secrets.auth.clientSecret}
    workflowRef:
      file: .takosumi/workflows/build-web.yml
      job: build
      artifact: web
      target: spec.artifact.hash
```

詳しくは [Deploy Manifest](/deploy/manifest) を参照。 フィールド一覧は
[マニフェストリファレンス](/reference/manifest-spec)。 kernel と group の 境界は
[Kernel](/architecture/kernel) を参照。

### Installable App (`.takosumi/app.yml`)

install UI / permission preview / AppBinding request の正本です。OIDC client、
database、object store、launch token などの install-time binding はここで宣言
し、takosumi-git / Takosumi Accounts が `.takosumi/manifest.yml` の
`${bindings.*}` / `${secrets.*}` を materialize します。

```yaml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp
id: examples.my-app
name: My App
bindings:
  auth:
    type: identity.oidc@v1
    redirectPaths:
      - /auth/oidc/callback
  bootstrap:
    type: install-launch-token@v1
```

### `.takosumi/workflows/*.yml`

ビルド手順と artifact の出力先を記述します。`.takosumi/manifest.yml` の
`workflowRef.file` がこのファイルを参照し、takosumi-git が artifact digest を
`workflowRef.target` に書き込んでから `workflowRef` を strip します。kernel に
`workflowRef` は届きません。

stateful resource は `.takosumi/manifest.yml` の `resources[]` で claim
します。runtime env は resource output (`${ref:...}` / `${secret-ref:...}`)、
AppBinding placeholder (`${bindings.*}` / `${secrets.*}`)、または service import
placeholder (`${imports.*}`) から materialize します。詳細は
[環境変数](/deploy/environment) と
[Binding Catalog](/reference/binding-catalog#_1-identity-oidc-v1) を参照。

## 制約

- 新規 app: `.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml`
  (kernel-bound) を `.takosumi/` 直下に置く
- workflow: `.takosumi/workflows/` 配下に置く (それ以外はバリデーションエラー)
- `.takosumi/manifest.yml` は `apiVersion: "1.0"` と `kind: Manifest` が必須
- kernel-bound manifest に `workflowRef` / `${bindings.*}` / `${secrets.*}` は
  残さない

## 次のステップ

- [Installable App Model](/architecture/installable-app-model) -- app が
  AppInstallation として install される仕組み
- [reference/app-yml-spec](/reference/app-yml-spec) -- `.takosumi/app.yml`
  の正本仕様
- [reference/manifest-spec](/reference/manifest-spec) --
  `.takosumi/manifest.yml` の正本仕様
- [Takos 全体像](/overview/) -- platform と用語を先に整理する
- [Deploy 構成](/apps/) -- deploy manifest と周辺 public surface を確認する
