# Takos Check and Local Smoke

> このページでわかること: Takos product root の portable complete gate と、
> production authorityを持たない local smoke。

Takos product の smoke は `takos/` で実行します。Takosumi kernel の in-process
deploy lifecycle は `takosumi/` 側の test と local-substrate smoke が正本です。

## Product smoke

```sh
cd takos
bun run check
```

`bun run check` がformat check、lint/static analysis、type/compile、portable
tests、portable buildをまとめて実行します。leaf commandをrelease checklist
として手作業で再構成しません。

起動済み local stack に対する HTTP smoke は次です。

```sh
cd takos
bun run local:smoke
```

## Official release

production surfaceのdeployはこのrepositoryのentrypointを使います。共通ruleは
sibling `takos-control`の`engineering.policy.json`→`deploy`が正本です。

```bash
bun run deploy
```

local checkやsmokeはproductionを証明・変更せず、promotion authorityも与えません。
Cloudflare / self-hostedのlive proofはoperator-owned evidenceです。self-host先への
deploymentはそのself-hosterのauthorityであり、公式hosted promotionとは別です。
