# Git URL からアプリを install する

> このページでわかること: Takos / Takosumi には「Store」や「公式カタログ」という機能は
> なく、アプリの install は「任意の Git URL の OpenTofu Capsule を install する」という
> 1 つのプリミティブに集約されていること。

アプリ (install できるもの) は **OpenTofu Capsule** — Git URL から取れる plain な
OpenTofu module — です。install の入口はギャラリーやストアではなく、「Git URL を指して
install する」プリミティブ 1 つです。専用の登録手続きや独自のメタデータファイルは要りません。

ダッシュボードの導線も同じで、Git URL / ref (tag・commit) / module path を入力して
Capsule を install します。fork や派生版も、Git URL を差し替えるだけで同じように扱えます。

## 中央の公式階層は無い

どの Capsule も同じ仕組みで入ります。

- Takosumi 自身が配る OpenTofu module も、まったく無関係な誰かが書いた Capsule も、install
  の扱いは同じです。「特権アプリ」や「公式カタログで優先される枠」はありません。
- `takos` 本体や、`takos-docs` / `takos-slide` / `takos-excel` / `takos-computer` /
  `yurucommu` のようなアプリも、install の仕組みから見れば「ただの Git URL の Capsule」です。
  Takos 製品の中では新規 Space 作成時に自動で入る first-party アプリですが、install の
  仕組みとして特別扱いされているわけではありません。

つまり「運営が認めた公式リストから選ぶ」のではなく、「Git URL さえあれば、誰のアプリでも
install できる」開かれた形です。

## install policy は「何を作れるか」の天井

アプリを install すると、その Capsule はクラウド上にリソース (データベース・ストレージ・
キューなど) を作ろうとします。何を作れてよいかは install policy が天井 (instance
ceiling) として決めます。Capsule が「これも作りたい」と書いていても、policy が許可した
範囲を超えるものは作れません。

managed (operator が運用する形) での既定の方針は次のとおりです。

- **標準的な Cloudflare リソースは既定で許可** します。アプリが普通に動くために必要な
  Workers / D1 / KV / R2 / Queues といった、それ自体では無害なリソースが対象です。
  これにより、ふつうのアプリはそのまま install して動かせます。
- **危険なものは既定から除外** します。除外の理由は次の節にまとめます。
- **濫用には歯止め** をかけます。作れる量や金額は課金・クレジットと結びつき、極端な
  消費は止まります。また、Capsule の中身は install 前に Capsule Gate で検査され、
  許可されていない振る舞いを含む Capsule は弾かれます。

self-host する場合は、利用者自身が operator として policy を決めます。managed の
既定はあくまで「運営が安全に開けられる初期値」です。

## 既定で許可しないもの

標準で無害な Cloudflare リソースだけを許可し、影響範囲が広いものは既定の許可から
外します。主な除外と理由は次のとおりです。

- **DNS レコードの作成・変更** — ドメインの向き先を書き換えられると、ドメイン乗っ取りや
  なりすましにつながるため、既定では許可しません。
- **アカウント / ゾーン全体の設定変更** — 1 つのアプリが、アカウントやゾーン全体の設定を
  触れると、同じ環境の他のアプリにも影響が及ぶため除外します。
- **他テナントに影響しうる操作** — 自分の install の範囲を越えて、他の利用者の領域に
  作用しうる操作は許可しません。
- **任意コマンド実行などの抜け道** — Capsule から外部の任意処理を呼び出すような書き方は
  Capsule Gate で禁止し、policy の天井をすり抜けられないようにします。

これらが必要なアプリは、self-host で利用者自身が責任を持って許可するか、必要な接続を
個別に用意した上で install する形になります。managed の既定では開けません。

## install の流れ

Git URL を指定したあとの流れは次のとおりです。

- 任意の Git URL (と tag / commit などの ref、module path) を指定する
- その Git URL の Capsule をそのまま install candidate として扱う
- 内容と作られるものの確認 (`plan` 相当のレビュー) を見て承認する
- install が完了し、Space で使い始める

公式の審査を通さなくても、Git URL さえあれば自分のアプリを配って install して
もらえます。

## 関連ページ

- [Install Paths](/apps/install-paths) — 一般ユーザー / 開発者 / self-host の各導線
- [Git からのインストール](/deploy/store-deploy) — install の具体的な手順
- [Bundled Apps](/platform/default-apps) — 新規 Space で自動 install される first-party アプリ
- [課金](/platform/billing) — 濫用の歯止めになる課金・クレジットの仕組み
