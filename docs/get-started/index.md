# はじめる

Takos の最初の成功状態は、Workspace を開いて、bundled app を起動し、chat で agent に作業を頼み、その結果が Git / files /
memory / app launcher に残ることです。OpenTofu や Takosumi の実行台帳は重要ですが、通常の Workspace ユーザーが最初に理解するものではありません。

## 1. Workspace を開く

公開 operator、operator が用意した rehearsal 環境、または self-host した Takos で sign in すると、最初に Workspace と app
launcher が表示されます。Workspace は chat、agent、memory、Git、files、apps をまとめる作業場所です。public Takosumi for
Platforms signup が closed の間も、rehearsal / self-host では同じ product journey を確認します。

最初に見るもの:

- **Apps**: `takos-docs` / `takos-slide` / `takos-excel` / `takos-computer` など、すぐ開ける bundled app
- **Chat**: agent に作業を依頼する入口
- **Memory**: project notes、決定事項、繰り返し使う context
- **Repos / Files**: agent が作ったコードやファイルを確認する場所

新規 Workspace では bundled app が seed されます。install の途中状態や失敗は Apps 画面から管理できますが、通常は「開ける app」が主役です。

## 2. Chat で最初の作業を頼む

Chat では、agent に調査、実装、文書化、file 更新、repo 操作を依頼できます。作業結果は会話だけで終わらず、必要に応じて Git diff、files、
memory、app の状態に反映されます。

例:

- `この Workspace の README を読んで、次にやることを整理して`
- `takos-docs に新しいメモページを作って`
- `この app の設定を確認して、必要な変更を PR にして`

Takos は chat だけの UI ではなく、agent が使う Git / files / memory / apps を同じ Workspace に置くための product です。

## 3. Apps から成果物を開く

Apps 画面は Workspace の launcher です。bundled app や Git URL から追加した app がここに並びます。app に launch URL がある場合は、
ここから直接開けます。install 中のものは管理 link から Installation detail に進めます。

新しい app を追加したい場合は、Apps 画面から Source / Git URL の追加導線に進みます。Takos に中央の公式 app store はありません。
Store / Source 画面は、Git URL の OpenTofu Capsule を見つけて追加するための discovery surface です。

## 4. Git URL から app を追加する

任意の app は、Git URL、ref、module path を指定して追加します。通常の Workspace ユーザーに見える流れは次の形です。

```txt
Git URL を入力
  ↓
作られるものと注意点を確認
  ↓
承認
  ↓
Apps launcher に表示
```

裏側では Takosumi が compatibility check、plan、apply、Deployment / OutputSnapshot 記録を行います。ただし product 導線では、
まず「何が追加され、どこから開けるか」を確認できることが重要です。詳細は [はじめてのアプリ](/get-started/your-first-app) を参照してください。

## 5. 管理者向けの裏側

operator / self-host 管理者は、Takos distribution を OpenTofu module と wrangler artifact upload で deploy します。この worker は
Takos product surface と embedded Takosumi Accounts / deploy-control / dashboard / OpenTofu runner を同一 origin に compose します。

管理者が見るもの:

- backing resources: D1 / KV / R2 / Queues / Durable Objects / containers
- account / OIDC / billing / domain policy
- Source / Connection / Installation / Run / Deployment / OutputSnapshot / Activity
- provider connection outcome: Gateway coverage, Space-owned Connection, or policy block

Workspace ユーザー向けの導線では、これらは Apps、Chat、Memory、Git、Files の裏側に隠れます。

## 次に読むページ

- [はじめてのアプリ](/get-started/your-first-app)
- [インストール方法](/apps/install-paths)
- [Git URL からアプリを install する](/platform/store)
- [Self-host / deploy](/deploy/)
