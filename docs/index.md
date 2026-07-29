---
layout: home

hero:
  name: Takos
  text: AI に作業を頼み、成果を残すワークスペース
  tagline: 会話、ファイル、Git、メモリ、アプリ、外部ツールを一つの Workspace で扱えます。
  actions:
    - theme: brand
      text: はじめる
      link: /get-started/
    - theme: alt
      text: ツールを接続する
      link: /apps/mcp
    - theme: alt
      text: セルフホストする
      link: /deploy/

features:
  - title: 作業を頼む
    details: 調査、実装、文書作成などをチャットからエージェントへ依頼できます。
  - title: 成果を残す
    details: 会話だけで終わらせず、ファイル、Git、メモリ、アプリに結果を残せます。
  - title: 道具を追加する
    details: アプリや MCP サーバーが公開するツールを Workspace ごとに追加できます。
  - title: 自分で運用する
    details: OpenTofu モジュールを使って、自分の Cloudflare アカウントへ配置できます。
---

## Takos とは

Takos は AI エージェントと一緒に作業するための Web アプリです。中心になる **Workspace** には、会話、ファイル、リポジトリ、メモリ、アプリ、外部ツールがまとまっています。

新しい Workspace は空の状態から始まります。`takos-office`、`takos-computer`、`yurucommu` などのアプリが必要なら、Apps から選んで追加します。Takos が知らないアプリでも、対応する Git リポジトリから追加できます。

## 最初の5分

1. Takos にサインインする
2. Workspace を作る、または既存の Workspace を開く
3. Chat で小さな作業を一つ頼む
4. 必要なら Apps や Connections から道具を追加する
5. 実行が終わったら、回答と変更内容を確認する

[スタートガイド](/get-started/) では、最初の依頼から結果の確認までを順番に説明します。

## どこから読むか

| 目的 | ページ |
| --- | --- |
| まず使う | [スタートガイド](/get-started/) |
| アプリを追加する | [はじめてのアプリ](/get-started/your-first-app) |
| 外部ツールを使う | [ツールと接続](/apps/mcp) |
| 完了通知を受け取る | [通知](/get-started/notifications) |
| ローカルで開発する | [ローカル開発](/get-started/local-development) |
| 自分の環境で運用する | [セルフホスト](/deploy/) |
| 問題を調べる | [トラブルシューティング](/deploy/troubleshooting) |
| API や用語を確認する | [リファレンス](/reference/) |

::: info 公開サービスについて
サインアップの可否や利用条件は、Takos を提供する運営者ごとに異なります。利用 URL がない場合は、セルフホストまたはローカル開発の手順を使ってください。
:::
