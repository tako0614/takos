# Legal: Acceptable Use Policy

> このページでわかること: Takos / Takosumi Cloud リファレンスディストリビューションの
> 禁止行為、AI エージェント利用上の追加制限、違反時のエンフォースメントプロセス。

**Template — operator review required before public launch.** Operators must
review and customize for jurisdiction-specific prohibitions before publishing.

## Status

| Field         | Value                                                |
| ------------- | ---------------------------------------------------- |
| Owner         | Operator trust & safety owner                        |
| Last reviewed | `[EFFECTIVE_DATE]`                                   |
| Scope         | All Takos services and bundled apps                  |
| Status        | Template — pre-public-launch baseline                |

## 1. 適用範囲

本ポリシーは、`[OPERATOR_NAME]` (以下「当社」) が提供する Takos / Takosumi Cloud
リファレンスディストリビューション (以下「本サービス」) の全利用者に適用されます。
[Terms of Service](/legal/terms-of-service) と一体として適用されます。

## 2. 禁止コンテンツ

利用者は以下のコンテンツを本サービス上で送信、保存、生成、配布してはなりません:

- **違法コンテンツ**: 児童性的搾取コンテンツ (CSAM)、テロリズム宣伝、人身売買、麻薬密売、
  違法武器売買、その他の刑法違反コンテンツ
- **有害コンテンツ**: 自殺・自傷の助長、暴力扇動、ヘイトスピーチ、ハラスメント
- **侵害コンテンツ**: 第三者の著作権、商標権、特許権、営業秘密を侵害する素材
- **プライバシー侵害**: 同意なしの個人情報・私的画像 (doxxing / 非合意的親密画像) の公開
- **詐欺・誤情報**: フィッシング、ソーシャルエンジニアリング、なりすまし、選挙妨害
- **マルウェア**: ウイルス、ワーム、ランサムウェア、その他の悪意あるコード

## 3. 禁止行為

- **サービス濫用**: rate limit 回避、利用規約違反目的での複数アカウント作成、API キー転売
- **インフラ攻撃**: DDoS、ポートスキャン、認証情報総当たり、SQL injection 試行など
- **不正アクセス**: 他者アカウントへのログイン試行、権限昇格試行、internal API の reverse engineering
- **無許可セキュリティテスト**: 当社事前許可なしの脆弱性スキャン、ペネトレーションテスト
  (許可された coordinated disclosure は [Security Disclosure](/legal/security-disclosure) 参照)
- **自動化濫用**: bot による登録、scraping、credential stuffing、API スパム
- **資源濫用**: 暗号通貨マイニング、ボットネット運用、無関係な大量計算

## 4. AI エージェント固有の制限

AI エージェント機能を利用するうえで、以下を追加で禁止します:

- **Prompt injection 利用**: 本サービスまたは第三者サービスを操作する目的で、AI への
  prompt injection ペイロードを作成・配布すること
- **悪意あるコード生成**: マルウェア、エクスプロイト、回避ツールを生成させること
- **欺瞞的 deepfake / 偽情報生成**: 実在人物のなりすまし、選挙妨害目的のコンテンツ生成
- **ガードレール回避**: 安全機能・コンテンツフィルタの回避を目的とした jailbreak 試行
- **無許可のスクレイピング・自動化**: AI エージェントを使った第三者サイトの規約違反スクレイピング
- **個人データ大量抽出**: 第三者の個人情報を大量に推論・収集させる利用

## 5. 報告と enforcement

### 5.1 通報窓口

違反コンテンツまたは違反行為を発見した場合、以下から通報できます:

| 用途                       | 連絡先                     |
| -------------------------- | -------------------------- |
| 一般的な濫用通報           | `[ABUSE_EMAIL]`            |
| 緊急 (CSAM / 暴力扇動 等) | `[EMERGENCY_ABUSE_EMAIL]`  |
| 法的通知 (DMCA 等)         | `[LEGAL_EMAIL]`            |
| セキュリティ脆弱性         | [Security Disclosure](/legal/security-disclosure) を参照 |

### 5.2 段階的 enforcement

軽度違反から重大違反まで、以下の段階で対応します:

1. **警告**: 違反内容の通知と是正期限を提示
2. **一時停止**: 機能制限またはアカウント suspension (調査期間中)
3. **コンテンツ削除**: 違反コンテンツを削除し、利用者に通知
4. **アカウント解除**: 重大または継続違反の場合、アカウントを解除
5. **法的措置**: 違法行為の場合、当局への通報および法的措置を講じる

CSAM、ライブ脅威、ライブ暴力に関しては即時アカウント停止と当局通報を行います。

### 5.3 異議申立

アカウント停止・解除を受けた利用者は、`[APPEALS_EMAIL]` に異議申立を提出できます。
当社は 14 営業日以内に再審査結果を通知します。

## 6. オペレーター側の対応義務

オペレーターは違反通報を受領後:

- **24 時間以内**: CSAM および immediate threats を当局通報・コンテンツ削除
- **72 時間以内**: 重大違反 (ハラスメント、侵害コンテンツ) の初期対応
- **14 日以内**: その他の違反通報の最終判断と通知

施行日: `[EFFECTIVE_DATE]`
