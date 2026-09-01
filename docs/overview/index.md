# Takos の全体像

Takos は、一人の利用者が AI エージェントへの依頼と、その作業に必要なファイル・Git・メモリ・アプリ・外部ツールをまとめるソフトウェアです。

## 利用者が触るもの

- **Chat**: エージェントへ依頼し、進行状況と回答を確認する
- **Files / Repositories**: 作成・変更された成果物を確認する
- **Memory**: 次の作業でも使う前提や決定を保存する
- **Apps**: Workspace に追加したアプリを開く
- **Connections**: MCP サーバーを接続し、利用できるツールを管理する

この作業場所を **Workspace** と呼びます。仕事・趣味・案件などを分ける private なカテゴリーとして複数作れます。他のアカウントを招待する共同作業単位ではありません。新しい Workspace にアプリは自動追加されません。

## 裏側の役割分担

Takos と Takosumi は別のソフトウェアです。Takos の基本機能は単独で動き、
Takosumi へ接続した場合だけ Principal に委任された state、canonical Capsule lifecycle、Interface
を利用します。公式 hosted service の Takosumi Cloud も optional です。

| ソフトウェア | 担当すること |
| --- | --- |
| Takos | Chat、エージェント、Files、Memory、Apps、Connections |
| Takosumi | ホスト環境のアカウント、アプリのインストール、OpenTofu の実行と履歴 |

Takosumi 未接続時も Chat、エージェント、Files、Memory、app-local Workspace は
利用できます。外部 OIDC identity やアプリ lifecycle が必要な場合に、運営者または
self-hoster が Takosumi を接続します。Takosumi Accounts が他 product 向けに持つ
組織・team 機能は Takos Workspace へ投影しません。

## アプリとツール

アプリは Workspace に明示的に追加します。追加に成功すると、アプリを開く URL や、アプリが提供するツールが Takos に表示されます。

ツールには二つの種類があります。

1. Takos に最初から含まれる基本ツール
2. アプリや外部 MCP サーバーから実行時に取得するツール

シェル、Git ホスティング、Web 検索などは常に使えるとは限りません。エージェントは、その Workspace で実際に公開されている機能を `toolbox` から探します。

## 運用方法

- 運営者が提供する Takos を使う
- ローカルの開発環境を起動する
- OpenTofu moduleで自分のCloudflare accountへ配置し、必要ならTakosumiを接続する

いずれの場合も、利用者から見える基本操作は同じです。

## 次に読む

- [スタートガイド](/get-started/)
- [ツールと接続](/apps/mcp)
- [セルフホスト](/deploy/)
- [アーキテクチャ](/architecture/)
