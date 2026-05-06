# fromWorkflow / inline workflow deploy の移行

このページは `compute.build.fromWorkflow`、Takos CLI の local workflow
runner、または `source.kind="inline"` workflow artifact payload から
`takosumi-git` 経由 deploy へ移るための guide です。

## 境界

Takos app/API gateway は deploy lifecycle の Web/API surface です。workflow /
build / git push 連携は Takos app や Takos CLI では実行しません。

| 項目                     | 移行前                                               | 移行後                                             |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------- |
| workflow 実行            | `compute.build.fromWorkflow` / local workflow runner | `takosumi-git`                                     |
| project convention       | `.takos/` 側の private build metadata                | `takosumi-git` の `.takosumi/` convention          |
| local worker bundle 収集 | Takos CLI / app 側                                   | `takosumi-git push` が artifact を解決             |
| Takos API source kind    | `inline` / `git`                                     | `manifest` / `git_ref`                             |
| Takos の責務             | build + deploy が混在                                | final manifest / artifact input を resolve + apply |

## 旧 manifest の検出

```bash
rg -n 'fromWorkflow|source\.kind\s*=\s*"inline"|source\.kind="inline"' .
```

`compute.*.build` は Takos app manifest parser では current contract
ではありません。worker は explicit `kind: worker` とし、bundle artifact は
upstream で解決します。image-backed service は digest-pinned image
を指定します。

```yaml
name: my-app

compute:
  web:
    image: ghcr.io/acme/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    port: 8080
  jobs:
    kind: worker

routes:
  - target: web
    path: /
```

## takosumi-git へ移す

1. project root で `takosumi-git init` を実行する。
2. `.takosumi/manifest.yml` に deploy manifest を置く。
3. `.takosumi/workflows/*.yml` に build workflow を置く。
4. worker compute は `workflowRef` で build workflow の artifact output
   を参照する。
5. `takosumi-git push` で workflow 実行、artifact 解決、Takos への manifest
   deploy を行う。

```bash
takosumi-git init
takosumi-git push
```

`takosumi-git` が生成した artifact input は Takos の `source.kind="manifest"`
deploy に渡されます。API caller が直接渡す場合も、 worker bundle は
`source.kind="manifest"` の artifact input として渡してください。

## API 互換性

current Takos public deploy API の source kind は次の 2 つです。

- `manifest`: caller が manifest snapshot と必要な artifacts を渡す
- `git_ref`: repository URL / ref から Takos 側が manifest を解決する

旧 `source.kind="inline"` + workflow artifact payload は apps/api gateway で
reject されます。error response は `takosumi-git init` / `takosumi-git push` と
`source.kind="manifest"` artifact input を案内します。

## removal status

temporary accept-time guard は削除済みです。current parser は `compute.build` を
retired contract として reject し、raw manifest object を受ける route も legacy
build metadata を reject します。deploy config / Helm values には互換 toggle
を置きません。

release note には、Takos は Web/API first、workflow / manifest authoring CLI は
`takosumi-git`、Takosumi kernel の explicit manifest apply は `takosumi`
であることを明記します。
