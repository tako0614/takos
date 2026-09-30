# マルチサービス構成

1 つの Capsule に複数の service surface をまとめる構成の例です。
たとえば API worker と object storage を同じ module で provision し、
それぞれの Output を返します。

## Module

```hcl
resource "cloudflare_workers_script" "api" {
  account_id  = var.account_id
  script_name = "example-api"
  content     = file("${path.module}/api.ts")
}

resource "cloudflare_r2_bucket" "objects" {
  account_id = var.account_id
  name       = "example-objects"
}

output "api_url" {
  description = "API の公開 origin"
  value       = cloudflare_workers_script.api.url
}

output "bucket_name" {
  description = "object 保存先 bucket"
  value       = cloudflare_r2_bucket.objects.name
}
```

## まとめても分けてもよい

複数 surface を 1 つの Capsule にまとめると plan / apply が 1 回で済みます。
別 Capsule に分けると、それぞれの Interface / InterfaceBinding を独立に
管理できます。takos-storage と takos-office のように「storage を提供する
Capsule」と「それを使う Capsule」に分ける構成が、first-party の普通の形です。

## 次に読む

- [OpenTofu Output とランタイム Interface](/deploy/runtime-interfaces)
- [Bundled Apps](/platform/featured-apps)
