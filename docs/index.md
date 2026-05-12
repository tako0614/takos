---
layout: home

hero:
  name: Takos
  text: AI エージェントによるソフトウェアの民主化
  tagline: Takosumi PaaS の上で動作する self-hostable な AI-first chat & agent platform。chat / agent / memory / space を core 機能として持つ
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
    details: "Takosumi Accounts が ownership を持つ install model。Takos は consumer product として bundled / third-party app を扱い、OAuth provider は operator account plane に集約し、takosumi kernel は deploy engine に専念する"
    link: https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md
  - icon: 🧭
    title: Takos 全体像
    details: "Takosumi Account → Space → AppInstallation の階層と、Takos core features (chat, agent, memory, space) の関係を整理する"
    link: /overview/
  - icon: 🧩
    title: Deploy 構成
    details: "`.takosumi/app.yml` (installer-bound) と `.takosumi/manifest.yml` (takosumi-git authoring input)、compiled manifest、binding catalog、install API を確認する"
    link: /apps/
  - icon: 📚
    title: リファレンス
    details: "app.yml spec / binding catalog / install API / manifest spec / 用語集を参照する"
    link: /reference/
---

## Use Takos / Install Apps

Takos を使い始める場合は、operator Accounts の `/start?takos_url=...` に向く
`Use Takos` で Takosumi Account / Space を作ります。bundled / third-party app
を配布する場合は、operator-selected install UI に Git URL を渡す install link
を使います。下は managed example です。

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

`ref` は tag か commit に pin します (`ref=main` / `ref=latest` は禁止)。詳細は
[Install paths](/apps/install-paths) を参照。

## Docs map

このサイトは Takos product の docs です。platform 全体の仕様は別 repository の
docs を参照します。

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
