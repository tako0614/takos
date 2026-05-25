# AWS

> このページでわかること: Takosumi kernel を AWS (EKS / Fargate)
> にホストする方法。

このページは **Takosumi kernel を AWS にホストする operator** 向けです。
カバー範囲は 2 通りで、用途に応じて使い分けます:

1. **AWS 単独 hosting (EKS Helm)** ― `takos/deploy/helm/takos/values-aws.yaml`
   overlay。Kubernetes ベースで control plane / runtime / executor を運用する
   path。
2. **AWS reference provider adapter client** ― ECS Fargate / RDS / S3 / SQS /
   KMS / Secrets Manager の adapter を takosumi.com reference implementation
   の配線として呼び出す path。Cloudflare control plane + AWS tenant runtime
   (`composite.cf-control-aws-tenant@v1`) や AWS 単独 profile
   (`profiles/aws.example.json`) で使う。

::: tip 対象範囲 section 1 (Helm overlay) は ECS / Fargate への kernel 直接
deploy、DynamoDB を control-plane storage として使う構成、Terraform / CDK
overlay を扱いません。 section 2 (reference provider adapter client) は provider
materialization までを扱います。 :::

Takosumi 上に AppSpec を install し、Installation / Deployment を管理する方法は [Deploy](/deploy/)
を参照してください。 5 target 横断 runbook は
[Multi-cloud](/hosting/multi-cloud) を参照してください。

## 統合 distribution からこの target を選ぶ

Takos product distribution artifact は `takos/deploy/` にあり、
`takos-private/distribution.yml` は private operator が target を選ぶ instance
config です。AWS EKS を kernel host に選ぶには:

```yaml
# takos-private/distribution.yml
distribution:
  kernel_host:
    target: aws
    region: us-east-1
    cluster_name: takos-control
    values_file: deploy/helm/values-aws.yaml
```

## target-specific 設定

AWS EKS target に固有の prerequisites:

- AWS account + IAM admin
- EKS cluster (managed node group / Fargate profile いずれも可)
- RDS PostgreSQL endpoint
- ElastiCache Redis endpoint
- S3 bucket または S3-compatible object storage
- ALB Ingress Controller (cluster 上に install 済み)
- ACM certificate ARN (wildcard 推奨)
- IRSA-enabled service account (`eks.amazonaws.com/role-arn` annotation 用)
- External Secrets Operator / Sealed Secrets などの secret 管理

詳細な values overlay と外部 secret 構成は
[Section 1: Helm overlay (kernel hosting)](#section-1-helm-overlay-kernel-hosting)
を参照してください。

## deploy 実行

5 target 共通の quick runbook です。target ごとの差は `distribution.yml` の
`kernel_host.target` だけで、`distribute:apply` が target 固有 backend (wrangler
/ Helm / docker-compose) に dispatch します:

```bash
# 共通手順 (5 target で同じ)
cd takos-private
deno task generate:keys:production --per-cloud
# distribution.yml を編集 (kernel_host.target = aws)
deno task distribute:dry-run --confirm production
deno task distribute:apply --confirm production
cd ../takosumi-cloud
deno run --config deno.json --allow-all packages/cli/src/main.ts accounts seed \
  --issuer https://accounts.aws.example.com \
  --subject tsub_admin \
  --client-id takos-admin \
  --redirect-uri https://admin.takos.example.com/auth/oidc/callback \
  > accounts-seed-plan.json
```

`distribute:apply` は `kernel_host.target=aws` を見て内部で
`helm upgrade --install takos-control deploy/helm/takos -f deploy/helm/values-aws.yaml`
を呼び出します。

## どちらを選ぶか

| 状況                                                                    | 推奨 path           |
| ----------------------------------------------------------------------- | ------------------- |
| Takosumi kernel 全体を AWS の k8s に置く                                | section 1 (Helm)    |
| Cloudflare で kernel を動かしつつ tenant runtime / DB を AWS に置きたい | section 2 (plugin)  |
| AWS のみで tenant runtime + control-plane provider を組む               | section 2 + Helm    |
| 開発・検証で provider 動作確認だけしたい                                | section 2 + dry-run |

---

## Section 1: Helm overlay (kernel hosting)

### Helm overlay が行うこと

`values-aws.yaml` は base chart に対して次を設定します:

| 項目            | current value                                                                  |
| --------------- | ------------------------------------------------------------------------------ |
| source          | `deploy/distributions/aws.json` から `deno task helm:generate-overlays` で生成 |
| images          | distribution profile の service image entries を Helm image values に展開      |
| domains         | distribution profile の `routing` から admin / tenant base domain を展開       |
| runtime config  | `runtimeConfig.environment=production`、implementation binding selector は fail-closed empty |
| ingress         | ALB ingress class と ALB annotation を使う                                     |
| service account | IRSA 用 annotation を受け取る                                                  |
| workloads       | `takos-app` / `takosumi` / `takosumi-cloud` / `takos-git` / `takos-agent`      |

overlay は generated artifact です。distribution profile を更新したら:

```bash
cd takos
deno task helm:generate-overlays
deno task helm:check-overlays
```

### 必要な外部サービス

- EKS cluster
- ALB Ingress Controller
- External Secrets Operator / Sealed Secrets などの secret 管理、または Helm
  values で secret を作成する運用
- Takosumi reference provider adapter が参照する AWS managed-service credentials

Terraform apply 後の DB endpoint / Redis URL / SQS URL / S3 bucket 名は
`deno task terraform:helm-values` で generated values に変換し、base overlay の
後に重ねます。生成 values は non-secret resource id だけを
`runtimeConfig.managedResources` へ入れ、secret は `takos-private` / external
secrets 側に残します。

Terraform live tfvars、provider credential、DB password の扱いは
[Hosting Secret Policy](/hosting/secrets) に従います。`takos/` に committed する
tfvars は CI plan fixture だけで、production / staging の raw secret は
`takos-private` から注入します。

`values-aws.yaml` は `secrets.create: false` を前提に、既定では chart の release
fullname 由来の Secret 名を参照します。`<release>` は Helm release
名から決まり、各 Secret は `<release>-platform` / `<release>-auth` /
`<release>-llm` になります。外部 secret を使っていて名前が異なる場合だけ
`secrets.existingSecrets.*` を設定してください。

外部 secret の `platform` には `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` /
`ENCRYPTION_KEY` / `EXECUTOR_PROXY_SECRET` / `TAKOS_INTERNAL_API_SECRET`
を含めてください。

### インストール

```bash
cd takos/deploy/helm/takos

helm upgrade --install takos . \
  --namespace takos-system \
  --create-namespace \
  -f values.yaml \
  -f values-aws.yaml \
  --set serviceAccount.annotations."eks\\.amazonaws\\.com/role-arn"="arn:aws:iam::123456789012:role/takos"
```

ALB TLS は overlay の
`ingress.annotations.alb.ingress.kubernetes.io/certificate-arn` に ACM
certificate ARN を設定します。

---

## Section 2: AWS reference provider adapter

### 構成

Takosumi reference implementation の AWS profile は次の adapter clients
を使います:

| provider client              | 用途                          | 参照クラス                             |
| ---------------------------- | ----------------------------- | -------------------------------------- |
| `aws-control-plane`          | ECS Fargate task / service    | `src/providers/aws/ecs_fargate.ts`     |
| `aws-rds-postgres`           | RDS Postgres provisioning     | `src/providers/aws/rds.ts`             |
| `aws-s3-artifacts`           | S3 bucket lifecycle           | `src/providers/aws/s3.ts`              |
| `aws-sqs-control-plane`      | SQS queue / DLQ               | `src/providers/aws/sqs.ts`             |
| `aws-kms`                    | KMS key + grant boundary      | `src/providers/aws/kms.ts`             |
| `aws-secrets-manager`        | Secrets Manager rotation      | `src/providers/aws/secrets_manager.ts` |
| `aws-alb-route53-router`     | ALB target group + Route53    | `src/providers/aws/load_balancer.ts`   |
| `aws-runtime-agent-registry` | runtime-agent enrolment store | `src/providers/aws/gateway.ts`         |

profile JSON (`profiles/aws.example.json`) で `clients.*` を上記 client
名に向けると、takosumi.com reference implementation の provider adapter wiring
が AWS resource lifecycle を実行します。

### Operator が手動でやること / reference binding が行うこと

| step                                                               | operator               | reference binding |
| ------------------------------------------------------------------ | ---------------------- | --------------- |
| AWS account / IAM role 作成                                        | yes                    | no              |
| IAM policy attach (ECS / RDS / S3 / SQS / KMS / Secrets / Route53) | yes                    | no              |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 入手                 | yes                    | no              |
| Cloudflare Worker secret として injection                          | yes (operator-managed) | no              |
| RDS / S3 / SQS / KMS / Secrets resource の lifecycle               | no                     | yes (provider)  |
| ECS task definition apply / desired count 調整                     | no                     | yes (provider)  |
| ALB listener rule + Route53 record 同期                            | no                     | yes (provider)  |
| runtime-agent enrolment + work lease                               | yes (process deploy)   | yes (work pull) |
| drift 検出 / rollback                                              | no                     | yes (provider)  |

### IAM role / policy 設計

最小限の IAM policy 例 (production では condition を絞ること):

```jsonc
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:CreateService",
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:RegisterTaskDefinition",
        "ecs:DeregisterTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "rds:CreateDBInstance",
        "rds:DescribeDBInstances",
        "rds:ModifyDBInstance",
        "rds:DeleteDBInstance"
      ],
      "Resource": "arn:aws:rds:ap-northeast-1:123456789012:db:takos-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:PutBucketTagging",
        "s3:PutBucketPolicy",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": ["arn:aws:s3:::takos-*", "arn:aws:s3:::takos-*/*"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:CreateQueue",
        "sqs:GetQueueAttributes",
        "sqs:SetQueueAttributes",
        "sqs:DeleteQueue"
      ],
      "Resource": "arn:aws:sqs:ap-northeast-1:123456789012:takos-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:CreateAlias",
        "kms:DescribeKey",
        "kms:ScheduleKeyDeletion",
        "kms:CreateGrant"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:GetSecretValue",
        "secretsmanager:RotateSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:takos/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:*",
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets"
      ],
      "Resource": "*"
    }
  ]
}
```

### Credential injection 方式

provider adapter への credential 経路は 2 通りあります:

#### A. Cloudflare Worker secret (Cloudflare control + AWS tenant の場合)

Cloudflare 上の Takosumi kernel から AWS provider adapter を呼ぶ場合、Worker
secret として AWS credentials を inject します:

```bash
cd takos-private/apps/control
echo "AKIA..." | deno task secrets put AWS_ACCESS_KEY_ID --env production
echo "..." | deno task secrets put AWS_SECRET_ACCESS_KEY --env production
echo "ap-northeast-1" | deno task secrets put AWS_REGION --env production
```

profile (`profiles/cloudflare-aws.example.json`) で
`pluginConfig.operator.takosumi.cloudflare-aws.region` / `accountId` /
`clusterName` を合わせます。

#### B. operator-managed gateway URL (kernel が AWS の外にある場合)

provider adapter は SDK を直接 import せず、operator が用意する HTTP gateway
を介して呼ぶ前提です。`src/providers/aws/gateway.ts` の URL 構成は profile の
`pluginConfig.operator.takosumi.aws.gatewayUrl` で上書きできます:

```jsonc
{
  "pluginConfig": {
    "operator.takosumi.aws": {
      "clients": { "...": "..." },
      "region": "ap-northeast-1",
      "accountId": "123456789012",
      "gatewayUrl": "https://aws-gateway.internal.takos.example/v1/",
      "gatewayToken": "operator-issued-token"
    }
  }
}
```

gateway URL を使うと Cloudflare Worker から AWS SDK を直接呼べない制約を
迂回できます。gateway 自体は operator が EC2 / Fargate に配置します。

### runtime-agent を AWS に置く

Cloudflare 上の kernel が直接 AWS resource を触るのではなく、AWS 側に
runtime-agent を常駐させて work lease を pull する方式です。

**1. runtime-agent process を準備**:

```ts
// /opt/takos/runtime-agent.ts
import {
  RuntimeAgentHttpClient,
  RuntimeAgentLoop,
} from "@takos/takosumi-plugins/runtime-agent";
import { awsProviderExecutors } from "@takos/takosumi-plugins/providers/aws";

const client = new RuntimeAgentHttpClient({
  baseUrl: Deno.env.get("TAKOS_KERNEL_URL")!,
  enrollmentToken: Deno.env.get("TAKOS_RUNTIME_AGENT_TOKEN")!,
});

const loop = new RuntimeAgentLoop({
  client,
  agentId: Deno.hostname(),
  provider: "aws",
  capabilities: {
    kinds: ["aws.ecs.deploy", "aws.rds.materialize", "aws.s3.materialize"],
  },
  executors: awsProviderExecutors({
    region: "ap-northeast-1",
    accountId: "123456789012",
  }),
});
await loop.run();
```

**2. EC2 / Fargate に deploy**:

EC2 (systemd service):

```bash
sudo tee /etc/systemd/system/takos-runtime-agent.service <<EOF
[Unit]
Description=Takos runtime-agent (AWS)
After=network.target

[Service]
Type=simple
Environment=TAKOS_KERNEL_URL=https://admin.takos.example.com
EnvironmentFile=/etc/takos/runtime-agent.env
ExecStart=/usr/local/bin/deno run --allow-net --allow-env /opt/takos/runtime-agent.ts
Restart=always
User=takos

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now takos-runtime-agent
```

Fargate (ECS task definition):

```jsonc
{
  "family": "takos-runtime-agent",
  "networkMode": "awsvpc",
  "containerDefinitions": [{
    "name": "agent",
    "image": "ghcr.io/takos/runtime-agent:latest",
    "essential": true,
    "secrets": [
      {
        "name": "TAKOS_RUNTIME_AGENT_TOKEN",
        "valueFrom": "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:takos/agent-token"
      }
    ],
    "environment": [
      { "name": "TAKOS_KERNEL_URL", "value": "https://admin.takos.example.com" }
    ]
  }],
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "taskRoleArn": "arn:aws:iam::123456789012:role/takos-runtime-agent",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole"
}
```

agent は kernel に enroll → heartbeat → lease pull → ECS / RDS / S3 / SQS / KMS
/ Secrets ops を実行→結果を report します。詳細は
[Multi-cloud](/hosting/multi-cloud#runtime-agent-placement) を参照。

### ALB routing の DNS 設定

`aws-alb-route53-router` provider client は次を materialize します:

1. ALB target group (tenant ECS service を attach)
2. ALB listener rule (host header / path matcher)
3. Route53 ALIAS record (`<tenant>.app.takos.example.com` → ALB DNS)
4. ACM certificate ARN を listener に attach (operator が事前発行)

operator がやること:

- Route53 hosted zone (`takos.example.com`) 作成
- wildcard ACM certificate (`*.app.takos.example.com`) を us-east-1 / region
  内で発行 (DNS validation 推奨)
- ALB の internet-facing security group / WAF 設定
- profile の `pluginConfig.operator.takosumi.aws.routerConfig` に `albArn` /
  `hostedZoneId` / `certificateArn` を設定

kernel がやること:

- target group 作成 / ECS service attach / health check 設定
- listener rule の host header matcher 同期
- Route53 ALIAS record の create / update / delete
- drift 検出 (ALB target / Route53 record の actual state vs desired)

---

## chart contract に含まれないもの (section 1)

- ECS / Fargate への Takosumi kernel self-deploy automation
- ECS は tenant image workload adapter として OCI orchestrator
  経由で使う対象であり、 kernel hosting surface ではない
- DynamoDB / SQS / Secrets Manager を app resource backend として自動
  provisioning する contract (※ section 2 の provider adapter はこれを担う)
- Terraform / CDK による AWS resource 作成手順
- AWS 固有 adapter 名を AppSpec author 向けの public surface として固定
  する contract

必要なら operator が追加 adapter / external service
を構成できますが、このページは Takos product/operator distribution の Helm
overlay と reference provider adapter で実際に表現されている範囲だけを runbook
として扱います。

## 次に読むページ

- [Multi-cloud](/hosting/multi-cloud) --- 4 cloud 横断 runbook
- [Kubernetes](/hosting/kubernetes) --- base Helm chart
- [GCP](/hosting/gcp) --- GKE overlay
- [Cloudflare](/hosting/cloudflare) --- Cloudflare control plane
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
