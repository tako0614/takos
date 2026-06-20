# Current Takos Smoke Commands

> このページでわかること: Takos product root で使う current smoke / release
> gate。

Takos product の smoke は `takos/` で実行します。Takosumi kernel の in-process
deploy lifecycle は `takosumi/` 側の test と local-substrate smoke が正本です。

## Product smoke

```sh
cd takos
bun run check
bun run docs:build
bun run web:build
bun run validate:opentofu-secrets
bun scripts/build-release-manifest.ts
```

起動済み local stack に対する HTTP smoke は次です。

```sh
cd takos
bun run local:smoke
```

## Broad local gate

リリース候補の広い local proof は次です。

```sh
cd takos
bun run release-gate
```

Cloudflare / self-hosted の live proof は operator-owned evidence です。public
source の release manifest は distribution profile と artifact metadata を記録しますが、
live URL、provider credential、実 runner の成功までは証明しません。
