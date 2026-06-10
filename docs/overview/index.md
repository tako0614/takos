# Takos 全体像

> このページでわかること: Takos が何をするプロダクトで、どんな概念で構成されているか。

Takos は AI エージェントと会話しながらソフトウェアを作成・編集できるセルフホスト型のプロダクトです。チャット、AI
エージェント、メモリ、スペースの 4 つを中心機能として持ちます。Takos は plain OpenTofu module として self-host
だけで完結し、Takosumi (OpenTofu-native deploy control plane) で運用するのは optional です。

バンドルアプリ (`takos-docs`, `takos-slide`, `takos-excel`, `takos-computer`, `yurucommu`) は新しい Space
を作成すると自動的にインストールされます。不要なアプリはいつでもアンインストールできます。

::: warning Managed offering status `Use Takos` は local / operator-owned rehearsal path として実装済みですが、public
managed signup は `takosumi` の launch-readiness evidence、`acceptedReady: true` topology reports、saved live
audit、operator approval が揃い、 `managed-offering:status` が `canOpenManagedOffering: true` を返すまで closed です。
公開 operator から案内された入口がない場合は、Self-host または local stack の手順を使ってください。 :::

## 基本概念

Takos は以下の 4 つの階層で構成されています。Account / Space は Takosumi の managed / control-plane を使う場合の所有モデルで、self-host
単体では必須ではありません。

### Account

Takosumi Account は課金・契約・ログインの単位です。メールアドレスや外部 IdP で作成します。

### Space

Account の下に作る作業領域です。個人用 (`personal`)、チーム用 (`team`)、組織用 (`org`) の種類があり、アプリはすべて
Space 単位でインストールされます。

### App (アプリ)

Space にインストールされた個々のソフトウェアです。バンドルアプリもサードパーティアプリも
同じ仕組みで管理されます。各アプリは Git リポジトリのコミットに紐づいているため、バージョンが透明に追跡できます。

### Deploy

アプリの実行環境です。3 つのモードがあります。

| モード      | 用途                                         |
| ----------- | -------------------------------------------- |
| shared-cell | すぐに使える共有環境。ビルド不要             |
| dedicated   | 専用のリソースが必要な場合                   |
| self-hosted | 自前のサーバーで完全にコントロールしたい場合 |

shared-cell で始めて、あとから dedicated や self-hosted に切り替えることもできます。これは Installation の runtime mode
を変える account-plane operation です。public managed offering での live data continuity / clean self-host restore は
operator readiness evidence が揃った環境で提供されます。

## 3 つの始め方

| 方法             | 対象             | 概要                                                                          |
| ---------------- | ---------------- | ----------------------------------------------------------------------------- |
| Use Takos        | すぐに使いたい人 | operator が public signup を開いた場合、Account と Space 作成から chat へ進む |
| Install from Git | 開発者           | Git URL を指定してアプリをインストール。ソースが透明に追跡される              |
| Self-host        | 自前運用したい人 | Takos をまるごと自分のサーバーにデプロイ                                      |

詳細は [Install paths](/apps/install-paths) を参照。

## 代表的なユースケース

### すぐに Takos を使いたい

operator が public signup を開いている場合、「Use Takos」ボタンから Account / Space を作成すれば、バンドルアプリが
自動的にインストールされてチャットを始められます。public managed offering が closed の間は、この path は local / staged
rehearsal または operator-internal flow として扱います。

### 自分のアプリをデプロイしたい

アプリのコードを plain OpenTofu module として Git リポジトリに追加し、 Git URL
を指定してインストールします。Takosumi が Installation を作り、typed Runs を経て Deployment / OutputSnapshot
まで自動で記録します。

- [はじめてのアプリ](/get-started/your-first-app)
- [デプロイの設定](/deploy/)

### shared-cell から専用環境に切り替えたい

shared-cell → dedicated は Installation の runtime mode / operator binding selection の変更です。current public docs では live data copy
guarantee ではなく、operator evidence 対象として扱います。

- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)

### 完全にセルフホストしたい

Takos を自分のサーバーにデプロイし、データ・ログイン・課金すべてを自分で管理します。既存 Installation の export/import
は contract / API と local proof があります。production provider ごとの full restore は launch-readiness evidence
の対象です。

- [デプロイ / セルフホスト](/deploy/)

## データモデルの詳細

より詳しいデータモデル (Installation、`plan` type Run、`apply` type Run、Deployment、OutputSnapshot、operator account-plane records
など) については以下を参照してください。

- [Takosumi Installation Lifecycle](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  —アプリインストールの仕組み
- [Installation](https://takosumi.com/docs/reference/model) —
  所有権の台帳

## 次に読むページ

- [はじめる](/get-started/) —最初のセットアップ手順
- [Install paths](/apps/install-paths) —インストール方法の詳細
- [Deploy 構成](/apps/) —OpenTofu module とアプリ設定
- [アーキテクチャ](/architecture/) —内部構造の詳細
- [用語集](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/glossary.md)
