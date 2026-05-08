# はじめる

> このページでわかること: Takos が何をするプラットフォームで、どの経路で
> 始められるか。

Takos は、Takosumi Account に install して使う AI ワークスペースです。
Installable App Model のもとで、Takos 自身も Git URL から install できる 1 つの
InstallableApp として扱われます。OAuth provider は Takosumi Accounts
(`takosumi.account.auth@v1` を anchor resolve した operator endpoint)
に集約され、takosumi kernel は compute-only を保ち、Takos は OIDC consumer
として動きます。

## 3 つの始め方

ユースケースに合わせて、3 つの install path から選べます (詳細は
[apps/install-paths](/apps/install-paths))。

### 1. Use Takos (一般ユーザー)

最速の経路。Takosumi Account を作るだけで、shared-cell の AppInstallation
が即座に作られ、launch token 経由でそのまま chat が開きます。

- runtime mode: `shared-cell` (build なし、warm 済み runtime に bind)
- 認証: Takosumi Accounts OIDC
- 所有権: あなたの Takosumi Account 配下の AppInstallation

```text
takos.jp → [Use Takos] → Takosumi Account 作成 → 即 chat
```

詳しくは [apps/install-paths § Use Takos](/apps/install-paths) を参照。

### 2. Install from Git (開発者)

Git URL + ref を指定し、commit pin、install preview、build / deploy を経て
任意の repo / fork から install できる経路。透明性と再現性を重視する
開発者向け。

```text
https://takosumi.cloud/install
  ?git=https://github.com/takos/takos
  &ref=v1.2.3
```

- runtime mode: `shared-cell` または `dedicated`
- source は commit に pin される (`ref=main` は基本禁止)
- AppInstallation 台帳に source commit と manifest digest が記録される

詳しくは [apps/install-paths § Install from Git](/apps/install-paths) を参照。

### 3. Self-host (退出 / 企業 / 主権重視)

`takosumi export` で installation bundle を取り出し、自前の takosumi 環境
(Keycloak / Authentik / 自前 Postgres / MinIO 等の任意 binding) に import
する完全退出経路。OIDC issuer も自由に差し替えられます。

```bash
takosumi export inst_abc --output takos-export.tar.zst
takosumi install ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --auth-issuer https://keycloak.example.com/realms/takos
```

詳しくは [apps/install-paths § Self-host](/apps/install-paths) と
[platform/upgrade-export](/platform/upgrade-export) を参照。

---

以下は、Takos product の現行 surface と、manifest / workflow authoring を
担当する Takosumi 系 CLI の境界を揃えるためのガイドです。group を構成する ときは
`.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml` (kernel-bound)
と `.takosumi/workflows/` を使います。

## 3 分で始める

> このセクションは **operator (= self-host bootstrap 担当)** 向けのガイド
> です。一般ユーザーが Takos を試したいだけなら上記の **3 つの install path**
> (Use Takos / Install from Git / Self-host) のうち
> [Use Takos](/apps/install-paths) に従ってください。一般ユーザーのログインは
> Takosumi Accounts OIDC (`/auth/oidc/login` → callback) で完結し、PAT 発行は
> Takosumi Account の 設定 UI で行います。

### 1. Takos Web に入る (operator)

Takos product の primary surface は Web UI です。operator bootstrap の詳細は
[Bootstrap](/operator/bootstrap) を参照してください。

```text
https://<ADMIN_DOMAIN>/
```

operator として未ログインなら `/auth/login` から bootstrap login (Google OAuth
など operator 用 upstream) に進みます。一般ユーザーの login は Takosumi Accounts
OIDC (`/auth/oidc/login`) を使うため、ここではなく
[apps/install-paths](/apps/install-paths) の Use Takos 経路を参照してください。

### 2. API token を発行する (operator)

operator account の `account settings → Personal Access Tokens` tab で PAT
を発行します。automation には Web UI で発行した `tak_pat_...` を使います。
(installation に紐づく自動化を行いたい場合は、PAT ではなく
[Install API](/reference/install-api) の AppGrant 経由で credential を発行
してください。)

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
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
resources:
  - shape: web-service@v1
    name: web
    provider: "@takos/aws-fargate"
    spec:
      image: PLACEHOLDER
      port: 8080
      scale: { min: 1, max: 2 }
    workflowRef:
      file: .takosumi/workflows/build.yml
      job: image
      artifact: image
      target: spec.image
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

`takosumi-git` は workflow を実行して artifact URI を確定し、Takosumi kernel の
`POST /v1/deployments` に manifest を渡します。Takos product は Web UI と public
API で multi-tenant / OAuth / billing / catalog を扱う層です。

## Takosumi Account を作る (簡略手順)

どの install path でも、契約 / billing / app installation owner となる Takosumi
Account が起点になります。

1. Takos product の `[Use Takos]` / `[Install from Git]` ボタン、または operator
   が提示する Takosumi Accounts URL にアクセス
2. Passkey / Google / GitHub / Apple / Enterprise OIDC など好きな upstream IdP
   でログイン
3. Takosumi Accounts が stable subject を発行 (= Takosumi Account 作成完了)
4. AppInstallation が作られ、launch token 経由で Takos が開く

Takosumi Account / OIDC issuer の endpoint は service identifier
`takosumi.account.auth@v1` と anchor resolution で決まります。詳細は
[architecture/takosumi-accounts](/architecture/takosumi-accounts) を参照。

## 次のステップ

- [Installable App Model](/architecture/installable-app-model) --- Git URL
  install / AppInstallation / runtime modes の正本
- [Takos 全体像](/overview/) --- Space / Repo / Worker / Run
  などの基本単位から理解する
- [はじめての group](/get-started/your-first-app) --- 実際に group
  を作ってデプロイするチュートリアル
- [プロジェクト構成](/get-started/project-structure) --- `.takosumi/`
  ディレクトリの中身を理解する
- [ローカル開発](/get-started/local-development) --- ローカル環境をセットアップ
- [Deploy 構成](/apps/) --- deploy manifest と周辺 public surface のガイド
- [サンプル集](/examples/) --- コピペで始められるサンプル
