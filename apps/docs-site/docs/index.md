---
layout: home

hero:
  name: Takos Docs
  text: Takos の独自仕様とアーキテクチャ
  tagline: 利用者・運用者・組み込み側が、Takos の概念、契約、動作モデルをこの site だけで把握できるようにするための docs です。
  actions:
    - theme: brand
      text: 概要から読む
      link: /overview/
    - theme: alt
      text: 独自仕様
      link: /specs/
    - theme: alt
      text: アーキテクチャ
      link: /architecture/

features:
  - title: Product-spec oriented
    details: "repo の実装ガイドではなく、Takos を使う上で知るべき概念、仕様、運用モデルを整理します。"
  - title: Self-contained
    details: "README や別 docs を前提にせず、この site のページ群だけで Takos の contract を理解できる構成にします。"
  - title: Runtime-aware
    details: "Cloudflare / local / tenant runtime の関係や、public `/workers` と internal service model の違いまで含めて説明します。"
---

## この docs が対象にすること

- Takos が扱う中核概念
- Takos の独自仕様
- app deploy と resource binding の契約
- control plane / tenant runtime / provider の関係
- CLI と運用モデル

## 入口

- Takos の全体像は [Takos overview](/overview/)
- 用語とモデルは [中核概念](/concepts/)
- `.takos/app.yml` と deploy 契約は [独自仕様](/specs/)
- 動作構成は [アーキテクチャ](/architecture/)
- 実運用の見方は [運用モデル](/operations/)
