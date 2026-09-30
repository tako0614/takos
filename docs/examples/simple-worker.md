# シンプルな Worker

1 つの Cloudflare Worker と、その公開 URL を返すだけの最小の Capsule module です。

## Module

```hcl
resource "cloudflare_workers_script" "app" {
  account_id  = var.account_id
  script_name = "example-worker"
  content     = file("${path.module}/worker.ts")
}

output "url" {
  description = "Worker の公開 origin"
  value       = cloudflare_workers_script.app.url
}
```

## install の流れ

1. この module を持つ repository の Git URL / ref で Capsule を作る。
2. `plan` Run で変更と policy 判定を確認し、承認して `apply` する。
3. 成功すると StateVersion と `url` Output が記録される。

Output の名前は module 側の自由です。service として公開する場合は、
Takosumi 側の Interface mapping がその名前を明示的に選びます。

## 次に読む

- [MCP Server の例](/examples/mcp-server)
- [OpenTofu Output とランタイム Interface](/deploy/runtime-interfaces)
- [Git URL から install](/platform/store)
