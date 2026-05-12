# Git / Store install

Store は install 可能な Git repository を発見する surface です。install の所有権、
approval、billing、binding、launch token は operator account plane の
AppInstallation ledger が持ちます (reference impl: Takosumi Accounts)。

## 基本

```bash
takosumi-git install https://github.com/acme/my-app --ref v1.2.0
```

browser / dashboard から始める場合も、最終的には同じ install lifecycle に入ります。

```text
User
  -> Store / install UI
  -> Takosumi Accounts: POST /v1/install/preview
  -> user approval
  -> Takosumi Accounts: POST /v1/installations
  -> takosumi-git: fetch / build / compile
  -> Takosumi kernel: POST /v1/deployments
  -> AppInstallation: ready
```

## Store の責務

- repository を検索・発見する
- publisher、version、tag、source URL を表示する
- `.takosumi/app.yml` がある repository を install candidate として扱う
- install preview へ進むための source metadata を渡す

Store は deploy 実行主体ではありません。compile と artifact 解決は
`takosumi-git`、ownership と approval は operator account plane (reference impl:
Takosumi Accounts)、runtime apply は Takosumi kernel が担当します。

## Install preview

install preview は mutate しない確認 step です。少なくとも次を表示します。

- source Git URL / ref / resolved commit
- publisher と署名状態
- requested bindings
- requested grants
- runtime mode
- estimated cost
- data exportability

user approval 後に AppInstallation が作成され、source commit、
`.takosumi/app.yml` digest、compiled manifest digest、runtime binding が ledger
に記録されます。

## Version pinning

install は tag または commit SHA に pin します。mutable branch を production
install の identity として扱いません。upgrade は新しい ref で preview を作り直し、
approval 後に新しい compiled manifest digest を AppInstallation に記録します。

## 関連ページ

- [Install Paths](/apps/install-paths)
- [Apps overview](/apps/)
- [Project structure](/get-started/project-structure)
- [Direct manifest deploy](/deploy/deploy)
