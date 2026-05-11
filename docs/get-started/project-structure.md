# プロジェクト構成

Takos / InstallableApp プロジェクトで使う `.takosumi/` ディレクトリと
関連ファイルの役割を整理する。

## 2 段の manifest 構造 {#two-tier-manifests}

Installable App Model では、project root の `.takosumi/` 配下に **2 段** の
manifest を置きます。

| ファイル                 | 用途                                | 渡し先                                                   | 仕様                                                                                                          |
| ------------------------ | ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.takosumi/app.yml`      | InstallableApp v1 (installer-bound) | takosumi-git (install UI / binding / permission preview) | [reference/app-yml-spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md) |
| `.takosumi/manifest.yml` | authoring compute manifest          | takosumi-git compiler                                    | [reference/manifest-spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)   |
| compiled manifest        | closed Shape manifest               | takosumi kernel (`POST /v1/deployments`)                 | [reference/manifest-spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)   |

`.takosumi/app.yml` (installer-bound; InstallableApp v1) と
`.takosumi/manifest.yml` (takosumi-git-owned authoring compute manifest) の
**二段構造** が正本です。kernel が読むのは takosumi-git が `workflowRef` /
installer-only placeholder を解決・除去した compiled manifest だけです。

## ディレクトリ構成

current project tree はこうなります。

```text
my-app/
├── .takosumi/
│   ├── app.yml              ← installer-bound (InstallableApp v1)
│   ├── manifest.yml         ← authoring compute manifest
│   └── workflows/
│       ├── build-api.yml
│       ├── build-web.yml
│       └── build-agent.yml
├── src/
│   └── index.ts
└── ...
```

`workflows/*.yml` は takosumi-git の workflow runner に渡される build job
定義です。current manifest では `workflowRef.target` に build 出力を書き込み、
`workflowRef` は kernel 到達前に strip されます
([reference/manifest-spec § Compile-time placeholders](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md#compile-time-placeholders))。

## 各ファイルの役割

### Authoring Compute Manifest (`.takosumi/manifest.yml`)

Takos で「何をデプロイするか」を宣言する authoring compute
manifest。`apiVersion:
"1.0"` / `kind: Manifest` / `resources[]` の closed
envelope で、compute resource、route、resource dependency
を定義します。`workflowRef` や installer-only placeholder は takosumi-git
が解決・除去し、takosumi kernel には compiled manifest
だけを渡します。operator-owned dependency は namespace export と account API /
OIDC discovery / BillingPort で扱い、kernel manifest には書きません。

`.takosumi/manifest.yml` は group の deploy/runtime contract を作るための source
input です。kernel が読む contract は compiled manifest です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
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
        OIDC_ISSUER_URL: https://accounts.example.com
        OIDC_CLIENT_ID: takos_inst_abc
        OIDC_CLIENT_SECRET: resolved-client-secret
    workflowRef:
      file: .takosumi/workflows/build-web.yml
      job: build
      artifact: web
      target: spec.artifact.hash
```

詳しくは [Deploy Manifest](/deploy/manifest) を参照。 フィールド一覧は
[マニフェストリファレンス](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)。
kernel と group の 境界は
[Kernel](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/kernel.md)
を参照。

### Installable App (`.takosumi/app.yml`)

install UI / permission preview / AppBinding request の正本です。OIDC client、
database、object store、launch token などの install-time binding はここで宣言
します。current `takosumi-git` は `.takosumi/manifest.yml` に unresolved
`${bindings.*}` / `${secrets.*}` が Accounts materialization
後も残っている場合、kernel request の前に失敗します。

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
します。runtime env は static value、resource output (`${ref:...}` /
`${secret-ref:...}`)、または installer / account plane が materialize した
concrete value / secret ref から渡します。installer-only placeholder
(`${bindings.*}` / `${secrets.*}` など) と removed `${imports.*}` placeholder は
compiled manifest に残せません。詳細は [環境変数](/deploy/environment) と
[Binding Catalog](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/binding-catalog.md#_1-identity-oidc-v1)
を参照。

## 制約

- 新規 app: `.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml`
  (authoring compute manifest) を `.takosumi/` 直下に置く
- workflow: `.takosumi/workflows/` 配下に置く (それ以外はバリデーションエラー)
- `.takosumi/manifest.yml` は `apiVersion: "1.0"` と `kind: Manifest` が必須
- compiled manifest に `workflowRef` / `${bindings.*}` / `${secrets.*}` は
  残さない

## 次のステップ

- [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  -- app が AppInstallation として install される仕組み
- [reference/app-yml-spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
  -- `.takosumi/app.yml` の正本仕様
- [reference/manifest-spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
  -- `.takosumi/manifest.yml` の正本仕様
- [Takos 全体像](/overview/) -- platform と用語を先に整理する
- [Deploy 構成](/apps/) -- deploy manifest と周辺 public surface を確認する
