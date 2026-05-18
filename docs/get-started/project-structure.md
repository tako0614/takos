# プロジェクト構成

> このページでわかること: Takosumi installer が読む `.takosumi.yml` と、アプリ source root の基本構成。

## ディレクトリ構成

Takos に install するアプリは、source root に `.takosumi.yml` を 1 つ置きます。

```text
my-app/
├── .takosumi.yml
├── package.json
├── src/
│   └── index.ts
└── ...
```

`.takosumi.yml` は Takosumi の AppSpec です。アプリの display metadata、
runtime component、build recipe、component 間の dependency edge、Takos から見える
interface を同じファイルで宣言します。

## `.takosumi.yml`

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: examples.my-app
  name: My App
  description: Example worker app
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    routes:
      - my-app.example.com/*
    use:
      db:
        env: DATABASE_URL
  db:
    kind: postgres
    spec:
      class: small
interfaces:
  launch:
    target: web
    path: /
  health:
    target: web
    path: /healthz
permissions:
  requested: []
```

主な field:

| field | 役割 |
| --- | --- |
| `metadata` | App ID、表示名、publisher、homepage など |
| `components` | worker / postgres / object-store / oidc / custom-domain |
| `components.*.build` | artifact を得る最小 build recipe |
| `components.*.use` | DB、object-store、OIDC などへの構造的 dependency edge |
| `interfaces` | launch、MCP、health など Takos / operator が使う entry point |
| `permissions` | Installation が要求する Takos API scope |

## Install lifecycle

開発者は source root をそのまま dry-run / apply します。

```bash
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
```

Git URL install では operator account plane が repository を commit に pin し、
`.takosumi.yml` を読みます。

```bash
takosumi install dry-run \
  git:https://github.com/example/my-app#v1.0.0 \
  --space "$TAKOSUMI_SPACE_ID"
```

Takosumi installer は AppSpec から build output、resource dependency、OIDC
client、route output を materialize し、Installation と Deployment record を
残します。

## 制約

- `.takosumi.yml` は source root に置く
- `apiVersion: takosumi.dev/v1` と `kind: App` は必須
- workflow / CI DSL は AppSpec に入れない
- component 間の依存は `use:` edge で宣言する
- Deployment evidence や provider resource ID はユーザーが手書きしない

## 次のステップ

- [はじめてのアプリ](/get-started/your-first-app) — 実際にアプリを作って install する
- [Deploy Manifest](/deploy/manifest) — `.takosumi.yml` の field 例
- [サンプル集](/examples/) — コピペで始められるサンプル
