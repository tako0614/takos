# Cloudflare Workload Placement

> このページでわかること: Cloudflare 環境で workload placement を operator 設定として扱う方針。

Takos product 自体は単一の public/control Worker (`takos-worker`) と Cloudflare Containers の Durable Object class
で構成します。追加の `takos-dispatch` / `takos-runtime-host` / `takos-executor-host` Worker をデプロイする前提には
しません。

Workers for Platforms の dispatch namespace は、operator が tenant workload を Cloudflare Workers backend に
明示的に載せたい場合だけ使う backend-specific option です。public Source v1 の入力には書きません。

## 役割

- Cloudflare 固有の tenant workload placement を operator 設定で扱う
- staging / production の workload namespace を分ける
- 単一 `takos-worker` の product boundary と、tenant workload backend を混同しない

## Operator setup

Workers-for-Platforms backend を使う場合だけ作成します。

```bash
wrangler dispatch-namespace create takos-tenants
wrangler dispatch-namespace create takos-staging-tenants
```

作成した namespace は Cloudflare target の operator config から control plane に接続します。local / self-host / AWS /
GCP / Kubernetes target では同じ概念を source に露出しません。

## Group との違い

| 概念               | 所有者                     | 役割                                  |
| ------------------ | -------------------------- | ------------------------------------- |
| Run/state history  | Takosumi kernel            | retained StateVersion / current Output |
| Container host     | `takos-worker`             | Cloudflare Containers DO classes      |
| Dispatch namespace | Cloudflare operator config | optional Workers backend placement    |

## Next

- [デプロイ / セルフホスト](/deploy/)
- [Run History](/deploy/deploy-group)
