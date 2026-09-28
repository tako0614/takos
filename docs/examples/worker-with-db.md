# Worker + DB

D1 database を binding として持つ Worker の例です。database は module が
provision し、worker は binding 経由で参照します。

## Module

```hcl
resource "cloudflare_d1_database" "db" {
  account_id = var.account_id
  name       = "example-db"
}

resource "cloudflare_workers_script" "app" {
  account_id  = var.account_id
  script_name = "example-worker-db"
  content     = file("${path.module}/worker.ts")

  bindings = [{
    name = "DB"
    type = "d1"
    id   = cloudflare_d1_database.db.id
  }]
}

output "url" {
  description = "Worker の公開 origin"
  value       = cloudflare_workers_script.app.url
}

output "database_name" {
  description = "D1 database 名"
  value       = cloudflare_d1_database.db.name
}
```

## install の流れ

Worker だけの例と同じです。plan → 確認 → apply で、D1 と binding を含む
StateVersion / Output が記録されます。既存データの引っ越し（migration や
data copy）は install の scope 外です。

## 次に読む

- [Worker + Container](/examples/worker-with-container)
- [ランタイムシークレット](/deploy/runtime-secrets)
