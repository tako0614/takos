# Dispatch Namespace

> このページでわかること: Cloudflare Workers 環境での Worker 分離の仕組み (オペレーター向け)。

Dispatch namespace は Cloudflare Workers backend が Worker を論理分離するための仕組みです。マニフェストには書きません。

## 役割

- tenant worker を control plane から分離する
- staging / production の worker placement を分ける
- Cloudflare 固有の worker routing を operator 設定で扱う

## Operator setup

```bash
wrangler dispatch-namespace create takos-tenants
wrangler dispatch-namespace create takos-staging-tenants
```

作成した namespace は Cloudflare target の operator config から control plane に接続します。local / self-host / AWS /
GCP / Kubernetes target では同じ概念を manifest に露出しません。

## Group との違い

| 概念               | 所有者                     | 役割                                  |
| ------------------ | -------------------------- | ------------------------------------- |
| Deployment history | Takosumi kernel            | retained Deployment / current pointer |
| Dispatch namespace | Cloudflare operator config | Workers backend の worker placement   |

## Next

- [Cloudflare](/hosting/cloudflare)
- [Deployment History](/deploy/deploy-group)
