# Operator 向けガイド

Takos を自分の環境で動かす operator 向けのページです。利用者として使う場合は
[スタートガイド](/get-started/) を参照してください。

## operator が担うもの

- Takos distribution worker と、それを provision する OpenTofu module の運用
- Takosumi Accounts plane（OIDC issuer、client projection）との接続
- app-local secret と外部 credential の管理（secret store は repo の外）
- Workspace と install される Capsule アプリの運用ポリシー

アカウント・認証の authority は Takos ではなく外部の Takosumi Accounts plane にあり、
Takos product routes は OIDC consumer として振る舞います。self-host では operator が
運用する Accounts origin が issuer です。

## このセクション

- [初回セットアップ](/operator/bootstrap) — 新規に立ち上げるときの Web ベース確認と env 一覧
- [アカウントモデル](/operator/account-model) — アカウント・認証の所有権がどこにあるか
- [OIDC Setup](/operator/oidc-setup) — OIDC client の投影と callback の設定

## 次に読む

- [セルフホスト概要](/deploy/)
- [環境と変数](/deploy/environment)
- [トラブルシューティング](/deploy/troubleshooting)
