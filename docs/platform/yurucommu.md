# yurucommu

yurucommu は、フィード、ストーリー、プロフィール、コミュニティ、ダイレクト
メッセージをひとつにまとめた SNS です。ActivityPub (異なる SNS サーバー同士を
つなぐ共通仕様) に対応し、ほかのサーバーのユーザーともやり取りできます。
Takos Workspace には普通の Capsule アプリとして明示的に install します。

## 主な機能

- フィードへの投稿、返信、リアクション、検索
- 画像や動画を使ったストーリー
- 公開範囲を選べるプロフィールとコミュニティ
- ユーザーやコミュニティとのダイレクトメッセージ
- ActivityPub による、別の対応サーバーとのフォローや投稿配送

## 運用先の選び方

yurucommu が所有するのは必要な役割と接続名です。Takosumi ではトップレベルで
Takoform または Cloudflare のデプロイ adapter を選び、そのあとに別の
ProviderConnection で接続先を選びます。Takoform の接続先は Host としての
Takoserver、Cloudflare の接続先は利用者が接続した Cloudflare アカウントで、
D1、R2、Workers KV、Queues がデータの置き場所になります。

## 関連ページ

- [Installable Apps](/platform/featured-apps)
- [Install paths](/apps/install-paths)
- [yurucommu ドキュメント](https://yurucommu.com/help/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
