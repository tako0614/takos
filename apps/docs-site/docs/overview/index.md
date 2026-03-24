# Takos overview

Takos は、AI を含むアプリケーションや worker ベースのサービスを、同じ control plane で管理・配備・実行するための platform です。

## Takos が提供するもの

- workspace 単位の分離
- repo と workflow artifact を起点にした app deploy
- worker を中心にした service graph
- resource と binding の一貫した扱い
- thread / run / artifact を中心にした AI 実行モデル
- Cloudflare と local をまたぐ運用面

## Takos の基本像

Takos では、利用者が目にする主な単位は次です。

- Workspace: 所有と隔離の単位
- Repo: deploy の入力になる source と artifact の単位
- Worker: 公開 surface での deployable unit
- Resource: D1, R2, KV などの backing resource
- Binding: service から resource や他 service へ渡す接続
- Thread / Run: AI 対話と実行の単位

## control plane と tenant runtime

Takos は control plane と tenant runtime を分けて扱います。

- control plane: API, deployment, routing, run lifecycle
- tenant runtime: deploy された worker bundle や image が実際に処理を受ける面

この分離によって、local と Cloudflare で control plane の adapter を変えつつ、tenant 側の contract を揃えやすくしています。

現時点の `.takos/app.yml` v1alpha1 では `worker` service を正本にしています。  
internal routing model には `http-url` target がありますが、manifest の public contract としてはまだ予約領域です。

## 想定する読者

この docs は次の読者を想定します。

- Takos を導入する platform operator
- Takos の上で app を配備する builder
- Takos CLI や `.takos/app.yml` を使う開発者

実装コードの追跡より、Takos の contract と動作モデルを把握したい人向けです。
