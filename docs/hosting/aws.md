# AWS

> このページでわかること: Takosumi kernel を AWS (EKS / Fargate)
> にホストする方法。

このページは **Takosumi kernel を AWS にホストする operator** 向けです。
カバー範囲は 2 通りで、用途に応じて使い分けます:

1. **AWS 単独 hosting (EKS Helm)** ― `takos/deploy/helm/takos/values-aws.yaml`
   overlay。Kubernetes ベースで control plane / runtime / executor を運用する
   path。
2. **AWS operator implementation evidence** ― ECS Fargate / RDS / S3 / SQS /
   KMS / Secrets Manager の output を operator runtime handler が
   PlatformService inventory / Deployment evidence として記録する path。Cloudflare control plane + AWS tenant runtime
   (`composite.cf-control-aws-tenant@v1`) や AWS 単独 profile
   (`profiles/aws.example.json`) で使う。

::: tip 対象範囲 section 1 (Helm overlay) は ECS / Fargate への kernel 直接
deploy、DynamoDB を control-plane storage として使う構成、OpenTofu / CDK
overlay を扱いません。 section 2 (operator implementation evidence) は operator-owned infra workflow
が作った PlatformService inventory と Deployment evidence の接続までを扱います。 :::

Takosumi 上で Source から Installation を作り、Deployment を管理する方法は [Deploy](/deploy/)
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
bun run generate:keys:production --per-cloud
# distribution.yml を編集 (kernel_host.target = aws)
bun run distribute:dry-run --confirm production
bun run distribute:apply --confirm production
cd ../takosumi
bun packages/cli/src/main.ts accounts seed \
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
| Cloudflare で kernel を動かしつつ tenant runtime / DB を AWS に置きたい | section 2 (operator profile)  |
| AWS のみで tenant runtime + control-plane provider を組む               | section 2 + Helm    |
| 開発・検証で provider 動作確認だけしたい                                | section 2 + dry-run |

---

## Section 1: Helm overlay (kernel hosting)

### Helm overlay が行うこと

`values-aws.yaml` は base chart に対して次を設定します:

| 項目            | current value                                                                  |
| --------------- | ------------------------------------------------------------------------------ |
| source          | `deploy/distributions/aws.json` から `bun run helm:generate-overlays` で生成 |
| images          | distribution profile の service image entries を Helm image values に展開      |
| domains         | distribution profile の `routing` から admin / tenant base domain を展開       |
| runtime config  | `runtimeConfig.environment=production`、implementation binding selector は fail-closed empty |
| ingress         | ALB ingress class と ALB annotation を使う                                     |
| service account | IRSA 用 annotation を受け取る                                                  |
| workloads       | `takos-worker` / `takosumi` / `takosumi` / `takos-git` / `takos-agent`      |

overlay は generated artifact です。distribution profile を更新したら:

```bash
cd takos
bun run helm:generate-overlays
bun run helm:check-overlays
```

### 必要な外部サービス

- EKS cluster
- ALB Ingress Controller
- External Secrets Operator / Sealed Secrets などの secret 管理、または Helm
  values で secret を作成する運用
- operator-owned AWS workflow / runtime handler が参照する AWS managed-service credentials

OpenTofu apply 後の DB endpoint / Redis URL / SQS URL / S3 bucket 名は
`bun run opentofu:helm-values` で generated values に変換し、base overlay の
後に重ねます。生成 values は non-secret resource id だけを
`runtimeConfig.managedResources` へ入れ、secret は `takos-private` / external
secrets 側に残します。

OpenTofu live tfvars、provider credential、DB password の扱いは
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

## Section 2: AWS operator implementation evidence

### 構成

AWS profile は operator-owned OpenTofu / native workflow が ECS Fargate、RDS
Postgres、S3、SQS、KMS、Secrets Manager、ALB / Route53 の output を作成し、
PlatformService inventory と Deployment evidence に接続する構成です。
Takosumi core はこれらの provider state や runtime handler implementation を所有しません。

### Operator workflow がやること / operator runtime handler が記録すること

| step                                                               | operator workflow      | operator runtime handler |
| ------------------------------------------------------------------ | ---------------------- | --------------- |
| AWS account / IAM role 作成                                        | yes                    | no              |
| IAM policy attach (ECS / RDS / S3 / SQS / KMS / Secrets / Route53) | yes                    | no              |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 入手                 | yes                    | no              |
| Cloudflare Worker secret として injection                          | yes (operator-managed) | no              |
| RDS / S3 / SQS / KMS / Secrets resource provisioning               | yes                    | records evidence |
| ECS task definition apply / desired count 調整                     | yes                    | records evidence |
| ALB listener rule + Route53 record 同期                            | yes                    | records evidence |
| runtime-agent HTTP lifecycle endpoint                              | yes (process deploy)   | yes (lifecycle RPC) |
| drift 検出 / rollback                                              | yes                    | records evidence |

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

runtime handler への credential 経路は 2 通りあります:

#### A. Cloudflare Worker secret (Cloudflare control + AWS tenant の場合)

Cloudflare 上の Takosumi kernel から AWS runtime handler を呼ぶ場合、Worker
secret として AWS credentials を inject します:

```bash
cd takos-private
echo "AKIA..." | bun run control:secrets put AWS_ACCESS_KEY_ID --env production
echo "..." | bun run control:secrets put AWS_SECRET_ACCESS_KEY --env production
echo "ap-northeast-1" | bun run control:secrets put AWS_REGION --env production
```

profile (`profiles/cloudflare-aws.example.json`) で
`operatorConfig.operator.takosumi.cloudflare-aws.region` / `accountId` /
`clusterName` を合わせます。

#### B. operator-managed gateway URL (kernel が AWS の外にある場合)

runtime handler は SDK を直接 import せず、operator が用意する HTTP gateway
を介して呼ぶ前提です。operator-owned runtime endpoint の URL 構成は profile の
`operatorConfig.operator.takosumi.aws.gatewayUrl` で上書きできます:

```jsonc
{
  "operatorConfig": {
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
runtime-agent HTTP endpoint を常駐させて lifecycle RPC を実行する方式です。

**1. runtime-agent handler registry を準備**:

```ts
// /opt/takos/runtime-agent.ts
import { serveRuntimeAgent } from "@takosjp/takosumi/runtime-agent";
import { buildOperatorRuntimeHandlerRegistry } from "./operator-handlers";

const registry = buildOperatorRuntimeHandlerRegistry({
  aws: {
    region: "ap-northeast-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    fargateClusterName: "takosumi",
    fargateSubnetIds: process.env.AWS_FARGATE_SUBNET_IDS?.split(",") ?? [],
    fargateSecurityGroupIds:
      process.env.AWS_FARGATE_SECURITY_GROUP_IDS?.split(",") ?? [],
  },
});

serveRuntimeAgent({
  registry,
  token: process.env.TAKOSUMI_AGENT_TOKEN!,
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? "8789"),
});
```

Runtime handler implementation は operator distribution の実装です。OpenTofu が AWS
resource graph / state / credential を管理し、runtime-agent は Takosumi から受けた
lifecycle RPC を operator-owned runtime handler registry に dispatch します。

**2. EC2 / Fargate に deploy**:

EC2 (systemd service):

```bash
sudo tee /etc/systemd/system/takos-runtime-agent.service <<EOF
[Unit]
Description=Takos runtime-agent (AWS)
After=network.target

[Service]
Type=simple
Environment=PORT=8789
EnvironmentFile=/etc/takos/runtime-agent.env
ExecStart=/usr/local/bin/bun /opt/takos/runtime-agent.ts
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
        "name": "TAKOSUMI_AGENT_TOKEN",
        "valueFrom": "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:takos/containers/agent-token"
      }
    ],
    "environment": [
      { "name": "PORT", "value": "8789" }
    ]
  }],
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "taskRoleArn": "arn:aws:iam::123456789012:role/takos-runtime-agent",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole"
}
```

runtime-agent は bearer 保護の lifecycle HTTP API で kernel からの apply / destroy /
describe / verify envelope を受け、ECS / RDS / S3 / SQS / KMS / Secrets ops を実行して
結果を返します。詳細は
[Multi-cloud](/hosting/multi-cloud#runtime-agent-placement) を参照。

### ALB routing の DNS 設定

`aws-alb-route53-router` runtime handler は次の lifecycle を扱います:

1. ALB target group (tenant ECS service を attach)
2. ALB listener rule (host header / path matcher)
3. Route53 ALIAS record (`<tenant>.app.takos.example.com` → ALB DNS)
4. ACM certificate ARN を listener に attach (operator が事前発行)

operator がやること:

- Route53 hosted zone (`takos.example.com`) 作成
- wildcard ACM certificate (`*.app.takos.example.com`) を us-east-1 / region
  内で発行 (DNS validation 推奨)
- ALB の internet-facing security group / WAF 設定
- profile の `operatorConfig.operator.takosumi.aws.routerConfig` に `albArn` /
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
  provisioning する contract (※ section 2 は operator-owned workflow の inventory / evidence 接続を扱う)
- OpenTofu / CDK による AWS resource 作成手順
- AWS 固有 runtime handler identifier を app author 向けの public surface として固定
  する contract

必要なら operator が追加 runtime handler / inventory importer
を構成できますが、このページは Takos product/operator distribution の Helm
overlay と operator implementation evidence で実際に表現されている範囲だけを runbook
として扱います。

## 次に読むページ

- [Multi-cloud](/hosting/multi-cloud) --- 4 cloud 横断 runbook
- [Kubernetes](/hosting/kubernetes) --- base Helm chart
- [GCP](/hosting/gcp) --- GKE overlay
- [Cloudflare](/hosting/cloudflare) --- Cloudflare control plane
- [環境ごとの差異](/hosting/differences) --- current hosting surface の比較
