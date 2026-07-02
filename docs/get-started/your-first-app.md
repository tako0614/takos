# はじめてのアプリ

このページの「アプリ」は、Takos Workspace に追加して Apps launcher から開く app を指します。Takos distribution 自体を
deploy する手順ではありません。deploy / self-host の手順は [Deploy overview](/deploy/) に分けています。

## 1. まず bundled app を開く

新しい Workspace には、first-party bundled app が seed されます。まず Apps を開き、利用可能な app を確認します。

- `takos-office`: 文書、スライド、表計算を 1 つの Office worker で扱う
- `takos-computer`: agent が browser automation / computer use を行う
- `yurucommu`: 自分の Workspace から使える social / community app

launch URL がある app は、Apps launcher から直接開けます。準備中の app は状態だけを表示し、管理 detail は install 管理 link に分けます。

## 2. Chat から app を使う

Takos の app は launcher で開くだけではなく、agent の作業にもつながります。Chat で app や Workspace の文脈を使って作業を頼みます。

例:

```txt
takos-office の Docs に、この Workspace のセットアップメモを作って。
```

作業結果は会話だけでなく、files、Git diff、memory、app の状態として残ります。必要な context は Memory に保存して、次の作業でも使えます。

## 3. Git URL から app を追加する

自分の app、fork、third-party app は Git URL から追加します。Takos の Store / Source 画面は中央の公式 registry ではなく、
Git URL の OpenTofu Capsule を見つけて追加するための discovery surface です。

基本の流れ:

1. Apps から **Git URL で追加** に進む
2. Git URL、ref、module path を入力する
3. 追加される app、作られる resource、注意点を確認する
4. 承認する
5. Apps launcher に app が表示される

production で使う app は、tag または commit に pin します。`main` や `latest` のような moving ref は、operator policy により拒否される場合があります。

## 4. 追加後に確認するもの

Workspace ユーザーが確認するもの:

- app が Apps launcher に表示される
- app を開ける、または準備中 / 失敗が分かる
- Chat で app や files に対する作業を頼める
- Memory に必要な context が残る

管理者 / operator が確認するもの:

- Source / Capsule / Run / StateVersion / Output
- provider binding outcome (explicit ProviderConnection, required manual input, or policy block)
- policy decision、cost、audit trail

通常の product 導線では、後者は Apps と install 管理の裏側に置きます。

## 次に読むページ

- [Git URL からアプリを install する](/platform/store)
- [Source / Git URL install 手順](/deploy/store-deploy)
- [Bundled Apps](/platform/default-apps)
- [Deploy overview](/deploy/)
