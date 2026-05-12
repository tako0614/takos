# はじめる

> このページでわかること: Takos が何をする product で、どの経路で始められるか。

Takos は **Takosumi PaaS の上で動作する self-hostable な product**。 AI agents /
Git / chat / spaces / memory / tools を駆使した **AI エージェントによる
ソフトウェアの民主化 (democratization of software through AI agents)** を core
concept とする (詳細は
[ecosystem design-principles §0](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/design-principles.md))。
OAuth provider は operator が運用する account plane (`operator.identity.oidc`
namespace export / OIDC discovery で得る operator-configured endpoint) に集約
され、 takosumi kernel は JSON-LD Shape manifest / resource graph / provider
materialization に専念し、 Takos は OIDC consumer として動く。 Takos は Takosumi
上の 1 product であり、 architecture 上の特権 layer ではない。

## 3 つの始め方

ユースケースに合わせて、3 つの entry path から選べます (詳細は
[apps/install-paths](/apps/install-paths))。

### 1. Use Takos (一般ユーザー)

最速の経路。Takosumi Account / Space を作るだけで、bundled apps が auto-install
され、opaque launch token を Accounts `/consume` で redeem してそのまま chat
が開きます。

- runtime mode: `shared-cell` (build なし、warm 済み runtime に bind)
- 認証: Takosumi Accounts OIDC
- 所有権: あなたの Takosumi Account / Space。bundled apps は AppInstallation
  として記録される

```text
operator Accounts /start?takos_url=... → [Use Takos] → Takosumi Account / Space 作成 → 即 chat
```

詳しくは [apps/install-paths § Use Takos](/apps/install-paths) を参照。

### 2. Install from Git (開発者)

Git URL + ref を指定し、commit pin、install preview、build / deploy を経て
bundled / third-party app repo から install できる経路。透明性と再現性を重視する
開発者向け。base URL は operator-selected で、下は managed example です。

```text
https://takosumi.cloud/install
  ?git=https://github.com/example/my-app
  &ref=v1.2.3
```

- runtime mode: `shared-cell` または `dedicated`
- source は commit に pin される (`ref=main` は基本禁止)
- AppInstallation 台帳に source commit と manifest digest が記録される

詳しくは [apps/install-paths § Install from Git](/apps/install-paths) を参照。

### 3. Self-host (退出 / 企業 / 主権重視)

Takos product distribution を自前で deploy し、必要に応じて
`takosumi-git
export` で app installation bundle を取り出して自前の Takosumi
環境 (自前 Takosumi Accounts + Keycloak / Authentik 等の upstream IdP、自前
Postgres / MinIO 等の任意 binding) に import する完全退出経路。OIDC issuer は
import 先 Takosumi Accounts が担います。

```bash
takosumi-git export inst_abc --output takos-export.tar.zst
takosumi-git import ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

Keycloak / Authentik / Auth0 などを使う場合も、import 先の Takosumi Accounts に
upstream IdP として接続します。Takos runtime がそれらを Takosumi Accounts の代替
issuer として直接 consume する経路は canonical では ありません。

詳しくは [apps/install-paths § Self-host](/apps/install-paths) と
[platform/upgrade-export](/platform/upgrade-export) を参照。

---

以下は、Takos product の現行 surface と、manifest / workflow authoring を
担当する Takosumi 系 CLI の境界を揃えるためのガイドです。group を構成する ときは
`.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml`
(takosumi-git-owned authoring input) と `.takosumi/workflows/` を使います。
kernel に渡るのは compiled Shape manifest だけです。

## 3 分で始める

> このセクションは **operator (= self-host bootstrap 担当)** 向けのガイド
> です。一般ユーザーが Takos を試したいだけなら上記の **3 つの entry path** (Use
> Takos / Install from Git / Self-host) のうち [Use Takos](/apps/install-paths)
> に従ってください。一般ユーザーのログインは Takosumi Accounts OIDC
> (`/auth/oidc/login` → callback) で完結し、PAT 発行は Takosumi Accounts の設定
> UI / API で行います。

### 1. Takos Web に入る (operator)

Takos product の primary surface は Web UI です。operator bootstrap の詳細は
[Bootstrap](/operator/bootstrap) を参照してください。

```text
https://<ADMIN_DOMAIN>/
```

operator として未ログインなら `/auth/oidc/login` から Takosumi Accounts OIDC
に進みます。`/auth/login` は公開 route ではありません。一般ユーザーは
[apps/install-paths](/apps/install-paths) の Use Takos 経路を参照してください。

### 2. API token を発行する (operator)

Takosumi Accounts の `account settings → Personal Access Tokens` tab で PAT
を発行します。automation には Accounts で発行した `takpat_...` を使います。
(installation に紐づく自動化を行いたい場合は、PAT ではなく
[Install API](https://github.com/tako0614/takosumi-cloud/blob/master/docs/accounts-service.md)
の AppGrant 経由で credential を発行 してください。)

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
`POST /v1/deployments` に manifest を渡します。Takos product は Web UI / public
API / app catalog を扱い、identity / OIDC issuer / billing は operator account
plane (Takosumi Accounts) に委ねます。

## Takosumi Account を作る (簡略手順)

どの install path でも、契約 / billing / app installation owner となる Takosumi
Account が起点になります。

1. Takos product の `[Use Takos]` / `[Install from Git]` ボタン、または operator
   が提示する Takosumi Accounts URL にアクセス
2. Passkey / Google / GitHub / Apple / Enterprise OIDC など好きな upstream IdP
   でログイン
3. Takosumi Accounts が stable subject を発行 (= Takosumi Account 作成完了)
4. Space が作られ、bundled app AppInstallation が必要に応じて作成される
5. Takos product runtime が opaque launch token を Accounts `/consume` で redeem
   し、成功後に owner session を作って chat が開く

Takosumi Account / OIDC issuer の endpoint は `operator.identity.oidc` namespace
export と OIDC discovery で決まります。詳細は
[architecture/takosumi-accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
を参照。

## 次のステップ

- [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  --- Git URL install / AppInstallation / runtime modes の正本
- [Takos 全体像](/overview/) --- Space / Repo / Worker / Run
  などの基本単位から理解する
- [はじめての group](/get-started/your-first-app) --- 実際に group
  を作ってデプロイするチュートリアル
- [プロジェクト構成](/get-started/project-structure) --- `.takosumi/`
  ディレクトリの中身を理解する
- [ローカル開発](/get-started/local-development) --- ローカル環境をセットアップ
- [Deploy 構成](/apps/) --- deploy manifest と周辺 public surface のガイド
- [サンプル集](/examples/) --- コピペで始められるサンプル
