# Kubernetes

Takos を Kubernetes クラスタにホストする方法。このページは **takos オペレーター**向け。

::: info アプリ開発者へ
アプリ開発者は takos がどのクラウドで動いているか意識する必要はない。app.yml を書いて `takos deploy-group --env staging` するだけ。
:::

::: warning experimental
k8s ホスティングは experimental ステータス。アダプタは実装済みだけど、Helm chart はまだ計画中。現時点では手動で k8s マニフェストを構成する必要がある。
:::

## リソースマッピング

| app.yml | k8s リソース | 備考 |
| --- | --- | --- |
| `d1` | PostgreSQL (StatefulSet or 外部) | Operator or Cloud-managed 推奨 |
| `r2` | MinIO (StatefulSet) or S3 互換 | S3 互換ならどれでも OK |
| `kv` | Redis (StatefulSet) | DynamoDB / Firestore も選択可 |
| `queue` | SQS / Redis Streams / PostgreSQL | 環境に応じて選択 |
| `vectorize` | PostgreSQL + pgvector | pgvector Operator or 手動セットアップ |
| `workers` | Pod (Node.js) | local-platform adapter で実行 |
| `services` | Pod (Docker) | 標準の k8s Deployment |

## 必要なもの

- Kubernetes クラスタ (1.28+)
- `kubectl` が設定済み
- `takos-cli` がインストール済み
- コンテナレジストリへのアクセス（Takos の Docker イメージを push する場所）

## アーキテクチャ

```
┌─────────────────────────────────────────────┐
│  k8s Cluster                                │
│                                             │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ control-web │  │ control-dispatch     │  │
│  │ (Deployment)│  │ (Deployment)         │  │
│  └──────┬──────┘  └──────────┬───────────┘  │
│         │                    │              │
│  ┌──────┴──────┐  ┌─────────┴────────┐     │
│  │ control-    │  │ runtime-host     │     │
│  │ worker      │  │ (Deployment)     │     │
│  │ (Deployment)│  └──────────────────┘     │
│  └─────────────┘                            │
│                                             │
│  ┌────────┐ ┌───────┐ ┌───────┐ ┌───────┐  │
│  │PostgreSQL│ │ Redis │ │ MinIO │ │pgvector│ │
│  │(SS/Ext)│ │ (SS)  │ │ (SS)  │ │(SS/Ext)│  │
│  └────────┘ └───────┘ └───────┘ └───────┘  │
└─────────────────────────────────────────────┘
```

## セットアップ

### 1. Namespace

```bash
kubectl create namespace takos
```

### 2. バッキングサービス

#### PostgreSQL

CloudNativePG Operator を使う場合:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: takos-db
  namespace: takos
spec:
  instances: 2
  postgresql:
    parameters:
      shared_preload_libraries: "vector"
  storage:
    size: 10Gi
```

または外部の managed PostgreSQL（RDS, Cloud SQL など）を使ってもいい。

#### Redis

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: takos
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          volumeMounts:
            - name: data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: takos
spec:
  selector:
    app: redis
  ports:
    - port: 6379
```

#### MinIO

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: minio
  namespace: takos
spec:
  replicas: 1
  selector:
    matchLabels:
      app: minio
  template:
    metadata:
      labels:
        app: minio
    spec:
      containers:
        - name: minio
          image: minio/minio:latest
          args: ["server", "/data"]
          ports:
            - containerPort: 9000
          env:
            - name: MINIO_ROOT_USER
              valueFrom:
                secretKeyRef:
                  name: takos-secrets
                  key: minio-root-user
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: takos-secrets
                  key: minio-root-password
          volumeMounts:
            - name: data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 20Gi
---
apiVersion: v1
kind: Service
metadata:
  name: minio
  namespace: takos
spec:
  selector:
    app: minio
  ports:
    - port: 9000
```

### 3. Secrets

```bash
kubectl create secret generic takos-secrets \
  --namespace takos \
  --from-literal=database-url="postgresql://takos:password@takos-db-rw:5432/takos" \
  --from-literal=redis-url="redis://redis:6379" \
  --from-literal=s3-access-key="takos" \
  --from-literal=s3-secret-key="takos-secret" \
  --from-literal=minio-root-user="takos" \
  --from-literal=minio-root-password="takos-secret" \
  --from-literal=platform-private-key="$(cat private.pem)" \
  --from-literal=platform-public-key="$(cat public.pem)" \
  --from-literal=google-client-id="your-client-id" \
  --from-literal=google-client-secret="your-client-secret"
```

### 4. Control Plane の Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: control-web
  namespace: takos
spec:
  replicas: 2
  selector:
    matchLabels:
      app: control-web
  template:
    metadata:
      labels:
        app: control-web
    spec:
      containers:
        - name: control-web
          image: your-registry/takos-control:latest
          command: ["pnpm", "local:web"]
          ports:
            - containerPort: 8787
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: takos-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: takos-secrets
                  key: redis-url
            - name: S3_ENDPOINT
              value: "http://minio:9000"
            - name: S3_REGION
              value: "us-east-1"
            - name: TAKOS_ADMIN_DOMAIN
              value: "admin.takos.example.com"
            - name: TAKOS_TENANT_BASE_DOMAIN
              value: "app.takos.example.com"
---
apiVersion: v1
kind: Service
metadata:
  name: control-web
  namespace: takos
spec:
  selector:
    app: control-web
  ports:
    - port: 8787
```

同様に `control-dispatch`, `control-worker`, `runtime-host` の Deployment を作成する。

## takos のデプロイ

takos 自体を k8s にデプロイするには、上記のマニフェストを apply する:

```bash
kubectl apply -f takos-deployment.yaml
```

アプリ開発者がアプリをデプロイするときは、環境を問わず同じコマンド:

```bash
takos deploy-group --env production
```

## バッキングサービスの選択

k8s 環境では、バッキングサービスをクラスタ内で動かすか外部の managed サービスを使うか選べる:

| リソース | クラスタ内 | 外部 managed |
| --- | --- | --- |
| PostgreSQL | CloudNativePG Operator | RDS / Cloud SQL |
| Redis | StatefulSet | ElastiCache / Memorystore |
| Object Storage | MinIO | S3 / GCS |
| Queue | PostgreSQL / Redis Streams | SQS / Pub/Sub |

外部 managed サービスを使う場合は、対応するアダプタ（`s3-object-store`, `dynamo-kv-store` など）の環境変数を設定する。

## 次に読むページ

- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [AWS](/hosting/aws) --- AWS にデプロイする場合
- [GCP](/hosting/gcp) --- GCP にデプロイする場合
- [セルフホスト](/hosting/self-hosted) --- Docker Compose でのセルフホスト
