# Capsule を発見して install する

> このページでわかること: Takos はcatalog authorityを持たず、TCS v2 Storeから
> credential-freeなGit URLを発見し、Takosumiのreviewed install-planへ渡すこと。

Takos では、install できる app は **OpenTofu Capsule** — Git URL から取れる plain な OpenTofu module — として扱います。
公開候補の発見にはdecentralizedなTakosumi Capsule Store (TCS) v2を使えます。
Store listingが返すのは表示情報とGit URLだけです。ref、module path、provider、
InstallConfig、credential、Run actionはlistingに含まれません。選択後にTakosumiが
SourceSnapshotを作り、repositoryの`.well-known/takosumi.json`とOpenTofu moduleを
exact snapshotで検査します。

## agent discovery と install authority は別

Takos agentの`store_search`は、operatorが設定した最大4件のTCS v2 originを
read-onlyで問い合わせます。未設定時は`https://store.takosumi.com`を使い、
`TAKOS_CAPSULE_STORE_URLS=[]`でremote discoveryを無効化できます。TCSのbadgeや
publisher表示はserver-localなcurationであり、Takosはcertificationや実行権限へ
昇格させません。

Takosが行うこと:

- TCS v2または手入力からcredential-freeなGit URLを得る
- Takosumi operator-control MCPへidempotent install-planを要求する
- reviewable Runを表示し、ユーザーの明示確認後だけapprove/applyする
- install 済み app の状態を Apps launcher に反映する

Source 画面が行わないこと:

- deploy 実行主体になる
- Git Source / SourceSnapshot / CapsuleをTakos内に新規作成する
- provider credential や secret output を保持する
- app を公式審査済みとして保証する
- listingを発行・moderate・certifyする(それは各TCS serverの責務)
- Takosumi の Source / Capsule / Run ledger を置き換える

したがって`store_search`の結果だけでは何もdeployされません。agentは候補を選んだ後も、
Takosumiのinstall-plan/reconcileとRun reviewを通り、provider credentialを受け取りません。
TCS候補には`takosumi.git-install-plan@v1`の`deployment_intent`も付けます。これは
Git URL、既定ref/path、推奨Capsule名だけを持つ非権限データです。agentは固定の
Takosumi tool一覧を持たず、`toolbox`で現在ReadyなOperator Control MCPを発見し、
そのschemaに合わせてinstall-planを作ります。

## 関連 app も同じ仕組みに乗る

`takos-office` / `takos-computer` / `yurucommu` は、ユーザーが選んで追加できる installable app です。
新規 Workspace に自動 install されるものではありません。install の仕組みとしては通常の Git URL Capsule と同じで、
user は不要なら uninstall を要求できます。uninstall は直ちに削除せず、Takosumi の destroy-plan Run を作成するため、
レビューと承認が完了するまで Apps launcher の Capsule は残ります。

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

裏側では compatibility check、plan、apply、StateVersion / Output 記録が走ります。これらは audit と operator 管理には重要ですが、
Source 画面では「追加して使えるか」を先に見せます。

## 関連ページ

- [Install Paths](/apps/install-paths)
- [Source / Git URL install 手順](/deploy/store-deploy)
- [はじめてのアプリ](/get-started/your-first-app)
- [Installable Apps](/platform/featured-apps)
- [課金](/platform/billing)
