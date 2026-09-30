# Worker + Container

container 対応の Durable Object class を持つ Worker の例です。
takos-computer のような隔離実行環境を持つアプリがこの形を使います。

## Module

```hcl
resource "cloudflare_workers_script" "app" {
  account_id  = var.account_id
  script_name = "example-worker-container"
  content     = file("${path.module}/worker.ts")

  bindings = [{
    name       = "SANDBOX"
    type       = "durable_object_namespace"
    class_name = "SandboxSession"
  }]
}

output "url" {
  description = "Worker の公開 origin"
  value       = cloudflare_workers_script.app.url
}
```

Durable Object class と container image は module の worker 実装側で宣言します。
container の起動条件や image の pin は Capsule の deploy 事実として扱い、
OpenTofu plan で差分を確認してから apply します。

## 次に読む

- [takos-computer](/platform/takos-computer) — この形を使う first-party アプリ
- [実行場所](/deploy/namespaces)
