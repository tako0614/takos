# Legal: Cookie Policy

> このページでわかること: Takos Web / Dashboard が使用する Cookie / ブラウザ
> ストレージの種類、利用目的、同意要件、無効化方法。

**Template — operator review required before public launch.** Operators must
verify the cookie inventory against the actual production build before
publishing.

## Status

| Field         | Value                                             |
| ------------- | ------------------------------------------------- |
| Owner         | Operator data protection owner                    |
| Last reviewed | `[EFFECTIVE_DATE]`                                |
| Scope         | Takos Web, Takosumi Accounts dashboard, OIDC flow |
| Status        | Template — pre-public-launch baseline             |

## 1. 概要

`[OPERATOR_NAME]` (以下「当社」) は、本サービスを提供するために必要最小限の Cookie /
localStorage を使用します。当社は **広告 Cookie および第三者 tracking Cookie を一切使用しません**。

詳細な利用目的別の処理一覧は [Privacy Rights](/legal/privacy-rights)
の Cookie and Local Storage セクションも参照してください。

## 2. 使用する Cookie / ストレージ

### 2.1 Strictly Necessary (必須) — 同意不要

| 名前                   | 種別        | 用途                            | 有効期間            |
| ---------------------- | ----------- | ------------------------------- | ------------------- |
| `__Host-tp_session`    | HTTP Cookie | 認証済みセッションの維持        | セッション終了時    |
| OIDC `state` / `nonce` | HTTP Cookie | OIDC ログインフローの CSRF 対策 | 数分 (フロー中のみ) |
| Dashboard CSRF token   | HTTP Cookie | dashboard 操作の CSRF 対策      | セッション終了時    |

これらは本サービスの基本機能 (ログイン、セキュリティ) に必須であり、GDPR / ePrivacy
Directive 上 **同意なしに設定できます**。

### 2.2 Device-local Preference (端末内の個人設定)

| 名前                            | 種別         | 用途                           | 有効期間                   |
| ------------------------------- | ------------ | ------------------------------ | -------------------------- |
| `takos-lang`                    | localStorage | 表示言語                       | ブラウザデータ消去時まで   |
| `takos-theme`                   | localStorage | テーマ (light / dark / system) | ブラウザデータ消去時まで   |
| `takos:default-file-handlers`   | localStorage | 拡張子ごとの既定ファイル処理   | ブラウザデータ消去時まで   |

これらは同じ端末で UI 設定を維持するためだけに使用し、tracking identifier として
送信しません。

### 2.3 Analytics / Advertising — 使用しない

当社は Google Analytics、Facebook Pixel、その他の **広告・分析・tracking
Cookie を一切使用しません**。サーバーサイドの aggregate 利用統計のみを
[Privacy Policy](/legal/privacy-policy) §2.3 に従って処理します。

## 3. 現在の実装

- 現在の build は広告・分析・tracking Cookie を使用しません。
- Cookie 確認 banner は表示せず、別の同意状態も保存しません。
- 端末内の個人設定はブラウザのサイトデータ削除で消去できます。

operator が non-essential storage や tracking を追加する場合は、production で
有効にする前に inventory と文面を更新し、その deployment に必要な notice / choice
を実装しなければなりません。

## 4. ブラウザでの無効化方法

利用者は以下の手段で Cookie を制御できます:

- **ブラウザ設定**: 各ブラウザの Cookie 設定で本サービスドメインの Cookie を block / clear
- **シークレットモード**: セッション終了時にすべての Cookie が削除される
- **ブラウザ拡張**: Cookie 管理拡張 (uBlock Origin 等) で個別 block

ただし、Strictly Necessary Cookie を block するとログインできず、本サービスを利用
できなくなります。

## 5. 第三者 OIDC IdP の Cookie

Google / Apple / GitHub OIDC IdP は、利用者がそれぞれのサービスにログインする際に
自社ドメインで Cookie を設定します。これらは当該 IdP のプライバシーポリシーに従い
当社は制御できません:

- Google: https://policies.google.com/technologies/cookies
- Apple: https://www.apple.com/legal/privacy/
- GitHub: https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement

## 6. 変更

本 Cookie Policy を変更する場合、施行日の少なくとも 30 日前に通知します。

## 7. 連絡先

| 用途                  | 連絡先            |
| --------------------- | ----------------- |
| Cookie に関する問合せ | `[PRIVACY_EMAIL]` |
| DPO                   | `[DPO_EMAIL]`     |

施行日: `[EFFECTIVE_DATE]`
