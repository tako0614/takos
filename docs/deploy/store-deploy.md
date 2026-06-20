# Source / Git URL install 手順

> このページでわかること: Store / Source 画面、または `/install?git=...` link から、Git URL の app を Workspace に追加する手順。

Takos の Store / Source 画面は、中央の公式 registry ではありません。Git URL の OpenTofu Capsule を見つけ、確認し、追加するための
discovery surface です。deploy 実行主体ではなく、install flow への入口です。

## Browser flow

通常の追加は browser から始めます。

```txt
Apps または Source を開く
  ↓
Git URL で追加
  ↓
Git URL / ref / module path を入力
  ↓
app summary と作られるものを確認
  ↓
承認
  ↓
Apps launcher に表示
```

external install link は `/install?git=...&ref=...&path=...` の形で `/new` に prefill されます。link を開いただけでは install
されません。ユーザーは必ず確認画面を通ります。

## Store / Source 画面の責務

Store / Source 画面が持つもの:

- repository / Git URL の発見
- publisher、version、tag、Git URL、module path の表示
- install candidate の説明
- install flow へ進むための入力
- install 済み app の launcher 反映

Store / Source 画面が持たないもの:

- provider credential
- secret output
- state backend
- policy decision の正本
- deploy 実行そのもの

これらは Takosumi control plane、Connections、policy、operator secret store の責務です。

## Review step

追加前に、少なくとも次を確認します。

- app name / source Git URL / ref / resolved commit
- module path
- 作られる resource と scope
- requested provider と provider connection resolution
- cost / quota の見込み
- warning / unsupported finding

production install は tag または commit SHA に pin します。`main` / `latest` / `HEAD` のような moving ref は、operator policy により拒否できます。

## App launcher への反映

追加が完了すると、Apps launcher に app が表示されます。launch URL が projection されている app は launcher から直接開けます。
準備中、失敗、確認待ちの app は launcher では状態を短く見せ、詳細は `/installations/:id` の install 管理画面に分けます。

## 管理者向け detail

operator / admin は install 管理画面で Source / Installation / Run / Deployment / OutputSnapshot / Activity を確認します。
Workspace ユーザー向けの主導線では、この台帳を最初の説明にしません。

## 関連ページ

- [Git URL からアプリを install する](/platform/store)
- [はじめてのアプリ](/get-started/your-first-app)
- [Install Paths](/apps/install-paths)
- [Deploy overview](/deploy/)
