---
layout: home

hero:
  name: Takos Docs
  text: Takos の public contract と動作モデル
  tagline: 利用者・運用者・内部実装者が、public surface と internal model を混ぜずに読めるように整理した docs です。
  actions:
    - theme: brand
      text: 概要から読む
      link: /overview/
    - theme: alt
      text: 仕様の読み方
      link: /specs/reading-the-spec
    - theme: alt
      text: 独自仕様
      link: /specs/

features:
  - title: Contract first
    details: "依存してよい surface を先に示し、architecture は internal model として後ろに分離します。"
  - title: Status explicit
    details: "差分がある surface は implementation note で明示し、contract と current wiring を混ぜません。"
  - title: Reader-oriented
    details: "overview / concepts / specs / reference の役割を分け、最初にどこを読むべきかを揃えます。"
---

## この docs が対象にすること

- Takos が扱う中核概念
- Takos の独自仕様
- app deploy と resource binding の契約
- control plane / tenant runtime / provider の関係
- CLI と運用モデル

## 最初に読む順

- まず [仕様の読み方](/specs/reading-the-spec)
- Takos の全体像は [Takos overview](/overview/)
- 用語とモデルは [中核概念](/concepts/)
- `.takos/app.yml` と deploy 契約は [独自仕様](/specs/)
- 動作構成は [アーキテクチャ](/architecture/)
- 実運用の見方は [運用モデル](/operations/)
- CLI と API は [参照](/reference/)
- 手元で動かすには [ローカル開発ガイド](/guides/local-development)
