# yurucommu

yurucommu は、フィード・ストーリー・プロフィール・コミュニティ・DM をひとつにまとめた
self-hostable な ActivityPub SNS です。Takos の Workspace に Capsule として install
すると、その Workspace から独立した SNS が自分のサーバー上で動きます。

## Capsule としての位置づけ

- 独立した product で、Takos の部品ではありません。Takos に install しなくても
  plain OpenTofu module として単独で deploy できます。
- Capsule として install すると、ActivityPub で他のサーバーや fediverse と
  連合する SNS が Workspace に追加されます。
- UI、API、リアルタイム配信は同梱の fullstack Worker が 1 つの origin で提供します。

## やり取りの形

- 投稿・返信・リアクション・検索・DM・コミュニティ・通知は yurucommu 自身の UI で行います。
- agent からの操作は、yurucommu が公開する MCP ツール経由で行えます。
- ActivityPub のフォロー・配送は外部サーバーとも成立します。

## 次に読む

- [yurucommu プロダクト](https://yurucommu.com/)
- [yurucommu repository](https://github.com/tako0614/yurucommu)
- [Git URL から install](/platform/store)
- [Bundled Apps](/platform/featured-apps)
