# Hosting Secret Policy

このページは AWS / GCP / Kubernetes / self-hosted を含む hosting target で、
Terraform / Helm / `takos-private` の secret 境界を固定する operator 向け
policy です。

Takos product shell (`takos/`) は distribution profile、Terraform composition、
Helm chart、non-secret managed resource id を持ちます。実 environment の
secret 値、deploy credential、state backend credential、rotation 手順は
`takos-private` が正本です。Takosumi kernel は secret value を知らず、
manifest / runtime には secret reference または platform secret binding だけを
渡します。

## Ownership

| owner           | 持つもの                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------- |
| `takos/`        | Terraform module shape、plan fixture、Helm chart、non-secret output bridge、validator          |
| `takos-private` | production / staging tfvars 生成元、cloud credentials、runtime secrets、rotation runbook       |
| cloud secret manager / k8s external secret | Secrets Manager / Secret Manager / External Secrets / Sealed Secrets などの値保管先 |
| Takosumi kernel | `resource.secret@v1` / secret-ref / runtime binding contract。raw value は保持しない            |

## Terraform rules

Terraform は infrastructure shape と managed resource id を扱います。raw secret を
repository や generated Helm values に残してはいけません。

- `deploy/terraform/environments/**/terraform.tfvars` と
  `*.auto.tfvars(.json)` は commit しない。`.gitignore` で env root の local
  tfvars を除外する
- committed `deploy/terraform/plan/*.tfvars` は CI review 専用。必ず
  `terraform_plan_mode = true` と placeholder password だけを使い、apply に使わない
- `db_password` は provider が要求する bootstrap-only sensitive input として扱う。
  live apply では `takos-private` の operator wrapper / secret service から注入し、
  CLI history や tracked tfvars に書かない
- Terraform output の `database_url` は sensitive output のままにする。Helm values
  bridge は sensitive output を拒否し、`database_endpoint` と non-secret resource id
  だけを `runtimeConfig.managedResources` に渡す
- provider credential (`AWS_SECRET_ACCESS_KEY`、service account JSON、OAuth token、
  kubeconfig token など) は Terraform module input / Helm values / workflow yaml に
  直接書かない。GitHub Actions では environment secret か OIDC / Workload Identity
  を使う

AWS RDS / GCP Cloud SQL の初期 password は current Terraform module に
`db_password` として渡します。この値が Terraform state に残り得る target では、
state backend 自体を encrypted / access-controlled にし、rotation と runtime
secret injection は `takos-private` 側で行います。provider-managed master password
や cloud secret manager へ移せる target は Phase E で raw state secret をさらに
減らします。

## Helm rules

Helm chart は既定で `secrets.create: false` を使い、外部 secret を参照します。
chart が受け取るのは Secret 名と non-secret managed resource id です。

| value                                  | policy                                      |
| -------------------------------------- | ------------------------------------------- |
| `secrets.existingSecrets.platform`     | platform key / internal RPC secret を持つ既存 Secret 名 |
| `secrets.existingSecrets.auth`         | OAuth / session / PAT signing 系 secret の既存 Secret 名 |
| `secrets.existingSecrets.llm`          | LLM / embedding provider credential の既存 Secret 名 |
| `runtimeConfig.managedResources`       | DB endpoint、Redis URL、queue、bucket、network、workload identity だけ |
| `TAKOS_MANAGED_RESOURCES_JSON`         | non-secret JSON。credential や password を含めない |

外部 secret backend は target に合わせます:

- AWS: External Secrets Operator + AWS Secrets Manager
- GCP: External Secrets Operator + Google Secret Manager
- Kubernetes: Sealed Secrets / External Secrets Operator / platform secret manager
- self-hosted: `takos-private` secret service + encrypted local store

## Review checklist

PR / release review では次を確認します:

1. `deno task validate:terraform-secrets` が green
2. `deno task terraform:helm-values:check` が sensitive output を Helm values に流していない
3. `deno task terraform:plan-gate` の `.terraform-plan/summary.md` は credential-free plan だけを示す
4. `deploy/terraform/environments/**/terraform.tfvars`、provider credential、service account JSON が tracked file にない
5. live backend plan / apply は `takos-private` 側の operator workflow で実行する
