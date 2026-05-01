---
layout: home

hero:
  name: Takos
  text: AIエージェントによるサービスとソフトウェアの民主化基盤
  tagline: AIエージェント時代の infra kernel を定義する Takos の公式 docs
  actions:
    - theme: brand
      text: はじめる
      link: /get-started/
    - theme: alt
      text: Takos の全体像
      link: /overview/
    - theme: alt
      text: Deploy 構成を見る
      link: /apps/

features:
  - icon: 🧭
    title: Takos 全体像
    details: "infra kernel と group の境界から Takos を理解する"
    link: /overview/
  - icon: 🚀
    title: はじめる
    details: "CLI ログインから最初の group 作成、`.takos/` ディレクトリ構成、最初の deploy まで順に追う"
    link: /get-started/
  - icon: 🧩
    title: Deploy 構成
    details: "Deploy Manifest、Workers、Containers、Routes、環境変数、MCP、OAuth の public surface をまとめて確認する"
    link: /apps/
  - icon: 🌐
    title: デプロイと配布
    details: "`takos deploy` / `takos deploy --preview` / `takos install` / `takos rollback` の違いと使い分けを整理する"
    link: /deploy/
  - icon: 🏪
    title: プラットフォーム
    details: "kernel、課金、federation と group の関係を確認する"
    link: /platform/
  - icon: 📚
    title: リファレンス
    details: "CLI、API、deploy manifest、用語集を参照する"
    link: /reference/
---

## Single Source of Truth

このサイトの canonical な参照点。各章はこれらを引用する立場で書かれており、定義の重複を避けてここから参照してください。

- [System Architecture](/architecture/system-architecture) — service set / repository boundary の正本
- [PaaS Core Contract v1.0](/takos-paas/core/01-core-contract-v1.0) — Core meta-objects の normative spec
- [Current State](/takos-paas/current-state) — 実装ステータスと split shell の現状
- [Manifest Reference](/reference/manifest-spec) — Deploy manifest spec
- [Glossary](/reference/glossary) — 用語集と canonical ref

開発者向け運用 docs は [Contributing](/contributing/) を参照。
