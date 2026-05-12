# マニフェスト直接デプロイ

> このページでわかること: コンパイル済みマニフェストを kernel に直接送る方法。

通常は [Git / Store install](/deploy/store-deploy) を使います。
このページはオペレーターがマニフェストを直接 apply する場合の説明です。

## 位置づけ

direct deploy は AppInstallation ledger を経由しません。binding provision、
permission preview、launch token、billing owner、upgrade preview は Accounts の
install lifecycle にだけあります。direct deploy は operator が infrastructure
検証、kernel smoke、unmanaged workload apply を行うための経路です。

## コマンド

```bash
takosumi deploy ./compiled-manifest.yml --remote https://kernel.example.com
```

local manifest は explicit path で渡します。project layout の探索や
`.takosumi/` convention は `takosumi-git` の責務です。

## Manifest requirements

kernel に渡せる manifest は compiled Shape manifest です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
resources:
  - shape: web-service@v1
    name: web
    provider: "@takos/self-hosted-process"
    spec:
      image: ghcr.io/acme/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      port: 8080
```

次の authoring-only 要素は kernel request 前に解決されている必要があります。

- `workflowRef`
- `${bindings.*}`
- `${secrets.*}`
- `${artifacts.*}`
- `${installation.*}`
- `${params.*}`

## Preview / apply

operator workflow は次の順に分けます。

```bash
takosumi plan ./compiled-manifest.yml --remote https://kernel.example.com
takosumi deploy ./compiled-manifest.yml --remote https://kernel.example.com
takosumi status my-app --remote https://kernel.example.com
```

approval、risk、provider operation、drift detection の詳細は Takosumi kernel の
reference を参照してください。

## 使い分け

| 状況 | 使う経路 |
| --- | --- |
| user が app を install する | Git / Store install |
| bundled app lifecycle を管理する | AppInstallation |
| operator が kernel contract を検証する | direct manifest deploy |
| CI が compiled manifest を apply する | `takosumi deploy <manifest>` |

## 関連ページ

- [Git / Store install](/deploy/store-deploy)
- [マニフェスト](/deploy/manifest)
- [Takosumi manifest spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [takosumi-git installer pipeline](https://github.com/tako0614/takosumi-git/blob/master/docs/architecture/installer-pipeline.md)
