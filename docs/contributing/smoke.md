# Current Takos Smoke Commands

> このページでわかること: Takos product root で使う current smoke / release
> gate。

Takos product の smoke は `takos/` で実行します。Takosumi kernel の in-process
deploy lifecycle は `takosumi/` 側の test と local-substrate smoke が正本です。

## Product smoke

```sh
cd takos
deno task check
deno task validate:distributions
deno task distribution:smoke
```

起動済み local stack に対する HTTP smoke は次です。

```sh
cd takos
deno task local:smoke
```

## Broad local gate

リリース候補の広い local proof は次です。

```sh
cd takos
deno task release-gate
```

Cloudflare / AWS / GCP / Kubernetes / self-hosted の live proof は
operator-owned evidence です。public source の distribution smoke は manifest と
dry-run path を検証し、live URL や provider credential
の存在までは証明しません。
