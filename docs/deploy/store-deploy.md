# Git / Store からのインストール

> このページでわかること: Store や Git URL からアプリをインストールする手順。

Store はインストール可能な Git リポジトリを見つけるための画面です。
インストールの所有権、承認、課金、バインディングは Takosumi Accounts が管理します。

## 基本

```bash
takosumi install --source https://github.com/acme/my-app --ref v1.2.0 --space "$TAKOSUMI_SPACE_ID"
```

browser / dashboard から始める場合も、最終的には同じ install lifecycle に入ります。

```text
User
  -> Store / install UI
  -> Takosumi installer: POST /v1/installations/dry-run
  -> user approval
  -> Takosumi installer: POST /v1/installations
  -> Takosumi: fetch / build / provider materialization
  -> Deployment record
```

## Store の責務

- repository を検索・発見する
- publisher、version、tag、source URL を表示する
- `.takosumi.yml` がある repository を install candidate として扱う
- install dry-run へ進むための source metadata を渡す

Store は deploy 実行主体ではありません。source fetch と artifact 解決は
Takosumi installer、ownership と approval は operator account plane (reference impl:
Takosumi Accounts)、runtime apply は Takosumi kernel が担当します。

## Install dry-run

install dry-run は mutate しない確認 step です。少なくとも次を表示します。

- source Git URL / ref / resolved commit
- publisher と署名状態
- requested bindings
- requested grants
- runtime mode
- estimated cost
- data exportability

user approval 後に Installation が作成され、source commit、
`.takosumi.yml` digest、Deployment evidence、runtime target metadata が ledger
に記録されます。

## Version pinning

install は tag または commit SHA に pin します。mutable branch を production
install の identity として扱いません。upgrade は新しい ref で dry-run を作り直し、
approval 後に新しい Deployment を Installation に記録します。

## 関連ページ

- [Install Paths](/apps/install-paths)
- [Apps overview](/apps/)
- [Project structure](/get-started/project-structure)
- [AppSpec deployment lifecycle](/deploy/deploy)
