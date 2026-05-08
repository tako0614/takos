---
layout: home

hero:
  name: Takos
  text: Takosumi Account に install する AI workspace
  tagline: Git URL から Takosumi Account に install できる Installable App。chat / agent / memory を提供する OIDC consumer app として動く
  actions:
    - theme: brand
      text: Install Takos
      link: /apps/install-paths
    - theme: alt
      text: Installable App Model を読む
      link: /architecture/installable-app-model
    - theme: alt
      text: Takos の全体像
      link: /overview/

features:
  - icon: 📦
    title: Installable App Model
    details: "Takos は Takosumi Account の AppInstallation 台帳に install される app。OAuth provider は Takosumi Accounts に集約し、takosumi kernel は compute-only を保つ"
    link: /architecture/installable-app-model
  - icon: 🛣️
    title: 3 つの install path
    details: "Use Takos (instant managed) / Install from Git (透明性) / Self-host (退出) の 3 経路。同じ AppInstallation model で全部包む"
    link: /apps/install-paths
  - icon: ⚡
    title: 3 つの runtime mode
    details: "shared-cell で instant chat、dedicated に materialize、self-hosted で完全退出。所有権は AppInstallation に固定したまま runtime だけ差し替える"
    link: /architecture/runtime-modes
  - icon: 🧭
    title: Takos 全体像
    details: "Takosumi Account → Space → AppInstallation の階層と、Takos platform features (Agent/Chat, Git, Storage, Store) の関係を整理する"
    link: /overview/
  - icon: 🧩
    title: Deploy 構成
    details: "`.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml` (kernel-bound) を分離した manifest pair、binding catalog、install API を確認する"
    link: /apps/
  - icon: 📚
    title: リファレンス
    details: "app.yml spec / binding catalog / install API / manifest spec / 用語集を参照する"
    link: /reference/
---

## Install Takos

Git URL を Takosumi Cloud に渡すと、Takosumi Account の AppInstallation
が作られて Takos がすぐ起動します。

```html
<a
  href="https://takosumi.cloud/install?git=https://github.com/takos/takos&ref=v1.2.3"
>
  Install Takos
</a>
```

README に貼る場合:

```md
[![Install Takos](https://takosumi.cloud/badges/install-takos.svg)](https://takosumi.cloud/install?git=https://github.com/takos/takos&ref=v1.2.3)
```

`ref` は tag か commit に pin します (`ref=main` / `ref=latest` は禁止)。詳細は
[Install paths](/apps/install-paths) を参照。

## Single Source of Truth

このサイトの canonical
な参照点。各章はこれらを引用する立場で書かれており、定義の重複を避けてここから参照してください。

- [Installable App Model](/architecture/installable-app-model) — Git-installed
  Materializable App Model の正本
- [Takosumi Accounts](/architecture/takosumi-accounts) — OIDC issuer / billing
  owner / app installation owner の正本
- [AppInstallation](/architecture/app-installation) — 所有権 ledger と
  AppBinding / AppGrant / RuntimeBinding の正本
- [Runtime Modes](/architecture/runtime-modes) — shared-cell / dedicated /
  self-hosted の遷移正本
- [Installer Pipeline](/architecture/installer-pipeline) — takosumi-git の Git
  URL install pipeline
- [System Architecture](/architecture/system-architecture) — service set /
  repository boundary の正本
- [PaaS Core Contract v1.0](/takosumi/core/01-core-contract-v1.0) — Core
  meta-objects の normative spec
- [`.takosumi/app.yml` Spec](/reference/app-yml-spec) — InstallableApp v1
  manifest spec
- [Binding Catalog](/reference/binding-catalog) — AppBinding kind の canonical
  catalog
- [Install API](/reference/install-api) — install / preview / launch /
  materialize / export API
- [Manifest Reference](/reference/manifest-spec) — `.takosumi/manifest.yml`
  (kernel-bound) spec
- [Glossary](/reference/glossary) — 用語集と canonical ref

開発者向け運用 docs は [Contributing](/contributing/) を参照。
