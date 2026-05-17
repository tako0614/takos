# はじめる

> このページでわかること: Takos を使い始めるための 3 つの方法と、最初のセットアップ手順。

Takos は AI エージェントと会話しながらソフトウェアを作成・編集できるセルフホスト型のプロダクトです。

## 3 つの始め方

ユースケースに合わせて選んでください。

### 1. Use Takos — すぐに使いたい人向け

operator が public signup を開いている場合の最速の方法です。Account と Space を作成するだけで、バンドルアプリが
自動インストールされ、チャットを始められます。

::: warning Public managed offering gate
この flow は local / operator-owned rehearsal では実装済みですが、public managed signup は
private readiness bundle、`acceptedReady: true` topology reports、`ready: true` public summary、saved live audit、
separate approval が揃い、`managed-offering:status` が `canOpenManagedOffering: true` を返すまで closed です。公開された operator から案内された URL 以外では、まず Self-host または開発用 local stack
を使ってください。
:::

```text
[Use Takos] → Account / Space 作成 → バンドルアプリ自動インストール → チャット開始
```

- operator が開いている shared-cell モードならビルド不要で使える
- バンドルアプリ (docs, slide, excel, computer, yurucommu) が最初から利用可能

詳しくは [Install paths § Use Takos](/apps/install-paths) を参照。

### 2. Install from Git — 開発者向け

Git URL とバージョンタグを指定して、アプリリポジトリからインストールする方法です。
ソースコードがコミット単位で追跡されるため、透明性と再現性を重視する開発者に向いています。

```text
https://<OPERATOR_INSTALL_HOST>/install?git=https://github.com/example/my-app&ref=v1.2.3
```

`<OPERATOR_INSTALL_HOST>` は、operator が public managed gate を開いた場合は
managed install host、gate が closed の間は self-host / local operator URL
を指します。

- ソースはコミットに固定される (`ref=main` は使えません)
- インストール内容がすべて記録されるため、あとから監査可能

詳しくは [Install paths § Install from Git](/apps/install-paths) を参照。

### 3. Self-host — 自前運用したい人向け

Takos をまるごと自分のサーバーにデプロイし、データ・ログイン・課金すべてを自分で管理する方法です。
AppInstallation export/import は contract / API と local proof があり、production provider ごとの full restore は
launch-readiness evidence の対象です。

```bash
# アプリのエクスポート
takosumi-git export inst_abc --output takos-export.tar.zst

# 自前環境へのインポート
takosumi-git import ./takos-export.tar.zst \
  --to https://my-takosumi.example.com \
  --account-id acct_self_host \
  --space-id space_self_host \
  --subject tsub_owner
```

Keycloak、Authentik、Auth0 などの IdP も接続できます。

詳しくは [Install paths § Self-host](/apps/install-paths) と
[ホスティングガイド](/hosting/) を参照。

---

## はじめてのデプロイ (開発者向け)

ここからは、自分のアプリを Takos にデプロイしたい開発者向けの手順です。
operator が public signup を開いている場合に「Use Takos」ですぐに使いたいだけの方は、上の方法 1
に従ってください。

### 1. Takos にログインする

```text
https://<YOUR_DOMAIN>/
```

ログインは Takosumi Accounts の OIDC で行います。
operator bootstrap の詳細は [Bootstrap](/operator/bootstrap) を参照。

### 2. API トークンを発行する

Takosumi Accounts の `Account Settings → Personal Access Tokens` で PAT を発行します。

```bash
curl -fsS \
  -H "Authorization: Bearer $TAKOS_PAT" \
  https://<YOUR_DOMAIN>/api/me
```

### 3. プロジェクトを用意する

プロジェクトのルートに `.takosumi/manifest.yml` と `.takosumi/workflows/` を作成します。

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

### 4. ビルドワークフローを書く

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

### 5. デプロイする

```bash
takosumi-git push \
  --endpoint "$TAKOSUMI_ENDPOINT" \
  --token "$TAKOSUMI_TOKEN"
```

ワークフローが実行され、ビルドされたイメージがデプロイされます。

## 次のステップ

- [はじめてのアプリ](/get-started/your-first-app) — 実際にアプリを作ってデプロイするチュートリアル
- [プロジェクト構成](/get-started/project-structure) — `.takosumi/` ディレクトリの中身
- [ローカル開発](/get-started/local-development) — ローカル環境のセットアップ
- [Deploy 構成](/apps/) — マニフェストとアプリ設定のガイド
- [サンプル集](/examples/) — コピペで始められるサンプル
- [Takos の全体像](/overview/) — 基本概念の整理
