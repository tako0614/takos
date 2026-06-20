# Git URL からアプリを install する

> このページでわかること: Takos の Source 画面は、中央の公式 app store でも catalog browse でもなく、Git URL の
> OpenTofu Capsule を貼って追加するための install 入口であること(Takos は単一オーナーの個人 product で、app の
> 公開・発見・連合 store network は持ちません)。

Takos では、install できる app は **OpenTofu Capsule** — Git URL から取れる plain な OpenTofu module — として扱います。
専用の登録手続きや Takosumi 独自 manifest は要りません。Git URL、ref、module path が分かれば、fork や派生版も同じ流れで追加できます。

## Source 画面は install 入口であって registry ではない

Takos UI には Source 画面があります。これは「運営が認めた公式 app を一覧・検索する場所」ではなく、Git URL を貼って
追加するための入口です(中央 catalog の browse / search / publisher 一覧や、store を公開・連合する仕組みは持ちません)。

Source 画面が行うこと:

- Git URL / ref / module path を入力して app を追加する
- ローカル repository を新規作成する
- 追加前に作られるものや注意点を確認できる install flow へ送る
- install 済み app の状態を Apps launcher に反映する

Source 画面が行わないこと:

- deploy 実行主体になる
- provider credential や secret output を保持する
- app を公式審査済みとして保証する
- app を公開・発見・連合する(Takos は単一オーナー product で store network を持たない)
- Takosumi の Source / Installation / Run ledger を置き換える

つまり product copy では「Store から追加」と言ってよいですが、architecture と policy の意味では「Git URL の Capsule を追加する」が正本です。

## first-party app も同じ仕組みに乗る

`takos-docs` / `takos-slide` / `takos-excel` / `takos-computer` / `yurucommu` は、新規 Workspace で seed される
first-party bundled app です。Takos product では最初から使える convenience として扱いますが、install の仕組みとしては通常の
Git URL Capsule と同じです。user は不要なら uninstall できます。

## install policy は「何を作れるか」の天井

app を追加すると、その Capsule は cloud resource、storage、queue、service endpoint などを作ろうとします。何を作れてよいかは
operator policy が天井として決めます。Capsule が「これも作りたい」と書いていても、policy が許可した範囲を超えるものは作れません。

managed operator の初期方針は、標準的な Cloudflare resource を中心に許可し、影響範囲が広いものは既定から外す形です。

- Workers / D1 / KV / R2 / Queues など、通常 app に必要な resource は許可しやすい対象
- DNS、account / zone 全体設定、他 tenant に影響しうる操作は既定では許可しない
- 任意コマンド実行など policy をすり抜ける書き方は Capsule Gate で拒否する
- 量や金額は billing / credit / quota と結びつき、極端な消費を止める

self-host では利用者自身が operator として policy を決めます。managed の既定は、public offering を安全に開くための初期値です。

## Git URL install の流れ

Workspace ユーザーに見える流れは、次のように outcome-first です。

```txt
Git URL / ref / module path を入力
  ↓
app と作られるものを確認
  ↓
承認
  ↓
Apps launcher に表示
  ↓
app を開く、または Chat で使う
```

裏側では compatibility check、plan、apply、Deployment / OutputSnapshot 記録が走ります。これらは audit と operator 管理には重要ですが、
Source 画面では「追加して使えるか」を先に見せます。

## 関連ページ

- [Install Paths](/apps/install-paths)
- [Source / Git URL install 手順](/deploy/store-deploy)
- [はじめてのアプリ](/get-started/your-first-app)
- [Bundled Apps](/platform/default-apps)
- [課金](/platform/billing)
