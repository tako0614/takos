# Bundled Apps

Workspace には、必要なアプリだけを明示的に追加します。first-party の Capsule アプリは
どれも普通の installable product で、Workspace 作成時に自動追加されるものはありません。

## 主な Capsule アプリ

| アプリ | 何をするか |
| --- | --- |
| [takos-office](/platform/takos-office) | docs・slide・sheet を 1 worker に統合した office suite。agent が MCP 経由でファイルを直接編集できる |
| [takos-computer](/platform/takos-computer) | agent から呼べる computer use 環境。ブラウザ操作やコマンド実行を隔離コンテナで任せられる |
| takos-storage | `storage.object` 相当の HTTP object API と drive / MCP を提供する standalone Capsule。ファイルの実体を自分の環境に置く |
| takos-git | 標準 `git clone` / `fetch` / `push` が使える collaborative Git hosting。R2 を data plane に使う |
| [yurucommu](/platform/yurucommu) | self-hosted ActivityPub SNS。fediverse に繋がる独立 product |

## どう見つけて入れるか

アプリは Apps 画面の「Add from Git URL」から Capsule として install します。
install に成功すると Workspace に tile が並び、そのアプリが公開する tool が
MCP 経由で agent の toolbox に加わります。

一覧と install の流れは [Git URL から install](/platform/store) 、
公開される tool の扱いは [ツールと接続](/apps/mcp) を参照してください。
