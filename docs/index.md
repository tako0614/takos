---
layout: home

hero:
  name: Takos
  text: AI-first chat & agent platform
  tagline: chat / agent / memory / space を core に持ち、Takosumi を consuming substrate として使う unique top consumer
  actions:
    - theme: brand
      text: Use Takos
      link: /apps/install-paths
    - theme: alt
      text: Installable App Model を読む
      link: https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md
    - theme: alt
      text: Takos の全体像
      link: /overview/

features:
  - icon: 📦
    title: Installable App Model
    details: 'Takos が bundled / third-party app を install するときの ownership model。OAuth provider は Takosumi Accounts に集約し、takosumi kernel は deploy engine に専念する'
    link: https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md
  - icon: 🛣️
    title: 3 つの install path
    details: 'Use Takos (instant managed) / Install from Git (app install transparency) / Self-host (退出) の 3 経路。AppInstallation は bundled / third-party apps の所有権を表す'
    link: /apps/install-paths
  - icon: ⚡
    title: 3 つの runtime mode
    details: 'shared-cell で instant chat、dedicated に materialize、self-hosted で完全退出。所有権は AppInstallation に固定したまま runtime だけ差し替える'
    link: https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md
  - icon: 🧭
    title: Takos 全体像
    details: 'Takosumi Account → Space → AppInstallation の階層と、Takos platform features (Agent/Chat, Git, Storage, Store) の関係を整理する'
    link: /overview/
  - icon: 🧩
    title: Deploy 構成
    details: '`.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml` (takosumi-git authoring input)、compiled manifest、binding catalog、install API を確認する'
    link: /apps/
  - icon: 📚
    title: リファレンス
    details: 'app.yml spec / binding catalog / install API / manifest spec / 用語集を参照する'
    link: /reference/
---

## Use Takos / Install Apps

Takos を使い始める場合は `Use Takos` で Takosumi Account / Space を作ります。bundled / third-party app を配布する
場合は、operator-selected install UI に Git URL を渡す install link を使います。下は managed example です。

```html
<a
  href="https://takosumi.cloud/install?git=https://github.com/example/my-app&ref=v1.2.3"
>
  Install App
</a>
```

README に貼る場合:

```md
[![Install App](https://takosumi.cloud/badges/install-app.svg)](https://takosumi.cloud/install?git=https://github.com/example/my-app&ref=v1.2.3)
```

`ref` は tag か commit に pin します (`ref=main` / `ref=latest` は禁止)。詳細は [Install paths](/apps/install-paths)
を参照。

## Docs map

このサイトは Takos product の docs です。platform 全体の仕様は別 repository の docs を参照します。

| 目的                                       | 読む場所                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Takos が何を提供するか                     | [概要](/overview/)                                                                 |
| install / Git URL / self-host の入口       | [Install paths](/apps/install-paths)                                               |
| Takos product の構造                       | [Architecture](/architecture/)                                                     |
| deploy manifest の Takos 向け authoring    | [Deploy](/deploy/)                                                                 |
| bundled apps / Store label / OIDC consumer | [Apps](/apps/)                                                                     |
| Takos API / CLI                            | [Reference](/reference/)                                                           |
| cross-product model                        | [ecosystem docs](https://github.com/tako0614/takos-ecosystem/tree/master/docs)     |
| kernel manifest / Shape / deploy API       | [takosumi docs](https://github.com/tako0614/takosumi/tree/master/docs)             |
| account / billing / launch token           | [takosumi-cloud docs](https://github.com/tako0614/takosumi-cloud/tree/master/docs) |
| `.takosumi/` project convention            | [takosumi-git docs](https://github.com/tako0614/takosumi-git/tree/master/docs)     |
