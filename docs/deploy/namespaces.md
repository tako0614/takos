# Dispatch Namespace

Dispatch namespace は Cloudflare Workers backend が tenant worker を論理分離する
ための operator-side detail です。portable manifest に書く値ではありません。

## 役割

- tenant worker を control plane から分離する
- staging / production の worker placement を分ける
- Cloudflare 固有の worker routing を operator 設定で扱う

## Operator setup

```bash
wrangler dispatch-namespace create takos-tenants
wrangler dispatch-namespace create takos-staging-tenants
```

作成した namespace は Cloudflare target の operator config から control plane に
接続します。local / self-host / AWS / GCP / Kubernetes target では同じ概念を
manifest に露出しません。

## Group との違い

| 概念 | 所有者 | 役割 |
| --- | --- | --- |
| Deployment group | Takosumi kernel | Deployment history / GroupHead |
| Dispatch namespace | Cloudflare operator config | Workers backend の worker placement |

## Next

- [Cloudflare](/hosting/cloudflare)
- [Deployment Group](/deploy/deploy-group)
