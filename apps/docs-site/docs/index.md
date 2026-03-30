---
layout: home

hero:
  name: Takos
  text: アプリを宣言的にデプロイ
  tagline: app.yml を書くだけで Worker、Container、データベースをまとめてデプロイ
  actions:
    - theme: brand
      text: はじめる
      link: /get-started/
    - theme: alt
      text: app.yml を書く
      link: /apps/manifest
    - theme: alt
      text: GitHub
      link: https://github.com/tako0614/takos

features:
  - icon: 🚀
    title: 宣言的デプロイ
    details: app.yml にアプリの構成を書くだけ。リソース作成、binding 接続、ドメイン設定を自動化
    link: /apps/manifest
  - icon: 📦
    title: Workers + Containers
    details: CF Workers と Docker Container を1つのマニフェストで管理。CF Containers で自動スケール
    link: /apps/containers
  - icon: 🔌
    title: MCP Server
    details: MCP server をワンライン宣言で自動公開。認証トークンも自動生成
    link: /apps/mcp
  - icon: 🏪
    title: App Store
    details: アプリを Store に公開してワンクリックインストール。公式パッケージも自動表示
    link: /platform/store
  - icon: 🌐
    title: マルチテナント
    details: dispatch namespace でテナントごとに Worker を分離。apply で一括管理
    link: /deploy/namespaces
  - icon: 🔧
    title: テンプレート変数
    details: デプロイ後のURL・IPを環境変数に自動注入。サービス間の接続を宣言的に
    link: /apps/environment
---
