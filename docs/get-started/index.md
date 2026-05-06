# はじめる

> このページでわかること: Takos が何をするプラットフォームで、どう始めるか。

Takos は、AIエージェントによるサービスとソフトウェアの民主化基盤です。worker
ベースの service は group deploy で配備し、resource は同じ control plane の
resource API / runtime binding で管理・利用できます。

group を構成するときは `.takos/app.yml` と `.takos/workflows/`
を使いますが、Takos Docs は manifest だけの説明書ではありません。この章では、
Takos Web での初回操作と、manifest / workflow authoring を担当する
Takosumi 系 CLI との境界を揃えます。

## 3 分で始める

### 1. Takos Web に入る

Takos product の primary surface は Web UI です。operator bootstrap の詳細は
[Bootstrap](/operator/bootstrap) を参照してください。

```text
https://<ADMIN_DOMAIN>/
```

未ログインなら `/auth/login` から Google OAuth へ進みます。初回ユーザーは
`/setup` で username を決めます。

### 2. API token を発行する

Takos Web の account settings から OAuth settings を開き、Personal Access
Tokens tab で PAT を発行します。automation には Web UI で発行した
`tak_pat_...` を使います。

```bash
curl -fsS \
  -H "Authorization: Bearer $TAKOS_PAT" \
  https://<ADMIN_DOMAIN>/api/me
```

### 3. app project を用意する

application の manifest / workflow / git bridge は `takosumi-git` が担当します。
Takos product 側に app authoring 用の primary CLI を増やしません。

プロジェクトのルートに、Takosumi-git の project convention
`.takosumi/manifest.yml` と `.takosumi/workflows/` を用意します。

```yaml
# .takosumi/manifest.yml
resources:
  - name: web
    shape: web-service@v1
    provider: "@takos/aws-fargate"
    spec:
      port: 8080
    workflowRef:
      file: build.yml
      job: image
      artifact: image
```

実際の manifest vocabulary は `takosumi-git` docs を正本にします。

### 4. ビルドワークフローを書く

`workflowRef` で参照する workflow を作ります。

```yaml
# .takosumi/workflows/build.yml
version: "0"
jobs:
  - name: image
    steps:
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: |
          npm run build
          echo "ghcr.io/example/my-app@sha256:0123456789abcdef"
    artifact:
      name: image
```

workflow / git event / artifact resolution は `takosumi-git` の責務です。
Takosumi kernel は build concept を持たず、最終 manifest を受け取って deploy
します。

### 5. デプロイ

```bash
takosumi-git push \
  --endpoint "$TAKOSUMI_ENDPOINT" \
  --token "$TAKOSUMI_TOKEN"
```

`takosumi-git` は workflow を実行して artifact URI を確定し、Takosumi kernel
の `POST /v1/deployments` に manifest を渡します。Takos product は Web UI
と public API で multi-tenant / OAuth / billing / catalog を扱う層です。

## 次のステップ

- [Takos 全体像](/overview/) --- Space / Repo / Worker / Run
  などの基本単位から理解する
- [はじめての group](/get-started/your-first-app) --- 実際に group
  を作ってデプロイするチュートリアル
- [プロジェクト構成](/get-started/project-structure) --- `.takos/`
  ディレクトリの中身を理解する
- [ローカル開発](/get-started/local-development) --- ローカル環境をセットアップ
- [Deploy 構成](/apps/) --- deploy manifest と周辺 public surface のガイド
- [サンプル集](/examples/) --- コピペで始められるサンプル
