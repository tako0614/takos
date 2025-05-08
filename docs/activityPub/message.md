# ChatMessage オブジェクト仕様(完全)


## 1. 目的・位置づけ

* **目的**：ActivityPub 互換のメッセージを、**単一のマルチレシピエント KEM** で鍵共有しながら、暗号化／非暗号化を切り替えつつ **耐量子安全かつ小サイズ** で送受信する。

  * 鍵包化方式を **mKEM（マルチレシピエント KEM）** に統一
  * `messageKey` エンドポイント廃止。メッセージ本文に mKEM 暗号文（`crypto:kemCipherText`）を直接インライン
  * 添付ファイルはメッセージ共有鍵 **K** を再利用（`crypto:keyId` を廃止）

---

## 2. 使用アルゴリズムと用語

- sharedKey K から以下のようにサブキーを派生して使用  
  - 本文用サブキー: `HKDF-Expand(K, "body")`  
  - 添付用サブキー: `HKDF-Expand(K, "attachment")`

| 用途      | アルゴリズム                                                              | 説明                                                                 |
| ------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 本文暗号    | **AES-256-GCM (sub-key = HKDF-Expand(K, "body"))**                       | 12 byte IV (96bit)＋16 byte TAG。IV はメッセージごとに一意となるようにする。 |
| 添付暗号    | **AES-256-GCM (sub-key = HKDF-Expand(K, "attachment"))**                 | 12 byte IV＋16 byte TAG。ストリーミング復号時は復号後にタグ検証。                         |
| **鍵包化** | **mHPKE-Base(ML-KEM-768-mR, HKDF-SHA-512, AES-256-GCM)**                | Kyber 派生 mKEM。暗号文長は O(N) で N≤500 程度まで実用              |
| 署名      | **ML-DSA-44**                                                           | RFC 9381 draft 相当                                                  |

**用語**

| 用語              | 意味                                            |
| --------------- | --------------------------------------------- |
| **accountKey**  | ML‑KEM 公開鍵（各受信者）                              |
| **sharedKey K** | mKEM で一括共有される AES 対称鍵（本文/添付共通、メッセージ毎にローテーション） |
| **signingKey**  | ML‑DSA 公開鍵（送信者）                               |

> 🔗 **アルゴリズム識別子はキーに集約** — すべてのキー（accountKey, signingKey）は `crypto:algorithm` メタデータを保持し、 メッセージ側は `crypto:keyId` ではなく \*\*暗号文 \*\*\`\` のみで鍵を参照。

---

## 3. Actor プロファイル拡張

`messageKey` API は不要になり、`accountKey` と `signingKey` だけを公開する。

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    { "crypto": "https://example.com/ns/crypto#" }
  ],
  "type": "Person",
  "id": "https://example.com/users/alice",
  "preferredUsername": "alice",

  "crypto:keyService": {
    "crypto:accountKeyUrl": "https://keys.example.com/alice/accountKey",
    "crypto:ttl": "10d" // accountKey の TTL
  }
}
```

---

## 4. ChatMessage JSON‑LD 構造

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    { "crypto": "https://example.com/ns/crypto#" }
  ],

  "type": "ChatMessage",
  "id": "https://example.com/messages/123",
  "attributedTo": "https://example.com/users/alice",
  "to": [
    "https://example.org/users/bob",
    "https://fedi.example.net/users/carla"
  ],
  "conversation": "https://example.com/conversations/42",
  "inReplyTo": "https://example.com/messages/120",
  "published": "2025-05-03T14:30:00+09:00",

  /* ---------- 本文 ---------- */
  /* ▼暗号化メッセージ（GCM） */
  "crypto:kemCipherText": "Base64URL(mKEM_ct)",
  "crypto:cipherText": "Base64URL(iv‖ciphertext‖tag)",
  /* ▲非暗号化の場合は 2 行を削除し、代わりに:
     "content": "Hi Bob & Carla, this is plaintext!" */

  /* ---------- 添付 ---------- */
  "attachment": [{
    "type": "ChatAttachment",
    "mediaType": "image/png",

    /* ▼暗号化ファイル (GCM) — 鍵は sharedKey K を再利用 */
    "url": "https://example.com/media/img1", // 暗号化されたコンテンツ (ciphertext)
    "crypto:encrypted": true,
    "crypto:iv": "Base64URL(ivBytes)",
    "crypto:tag": "Base64URL(tagBytes)"

    /* ▲平文ファイルの場合:
       "url": "https://example.com/media/img1.png",
       "crypto:encrypted": false */
  }],

  /* ---------- 署名（必須） ---------- */
  "crypto:signature": {
    "crypto:keyId": "https://example.com/keys/sigkey-ef56",
    "crypto:signatureUrl": "https://example.com/messages/123.sig",
    "crypto:created": "2025-05-03T14:30:05+09:00"
  }
}
```

### 4.1 mKEM 暗号文フォーマット

```
ct = kemCt ‖ ( hint₁ ‖ tag₁ ) ‖ ( hint₂ ‖ tag₂ ) ‖ … ‖ ( hint_N ‖ tag_N )
```
hint_i = Trunc16(BLAKE3(accountKeyId_id ‖ kemCt)) // 16 bytes
```
```

受信者は自分の accountKeyId による hint_i を照合し、対応する tag_i を用いて sharedKey K を復元します。

---

## 5. 鍵サービス & 署名 API

| HTTP | URL 例                             | 説明                                          |
| ---- | --------------------------------- | ------------------------------------------- |
| GET  | `…/accountKey?userId={recipient}` | ML‑KEM 公開鍵（`crypto:algorithm` 含む、常に最新の鍵） |
| GET  | `…/signingKey`                    | ML‑DSA 公開鍵                                  |
| GET  | `…/signatures/{messageId}`        | **Base64URL 署名値**（Content‑Type: text/plain） |

レスポンス例：

```jsonc
// accountKey
{
  "keyId": "https://example.com/keys/kem-111",
  "crypto:algorithm": "mHPKE-Base(ML-KEM-768-mR,HKDF-SHA-512,AES-256-GCM)",
  "key": "Base64(pub)"
}

// signingKey
{
  "keyId": "https://example.com/keys/sigkey-ef56",
  "crypto:algorithm": "ML-DSA-44",
  "key": "Base64(pub)"
}

// signature (plain text body)
Base64URL(signatureBytes)
```

---

## 6. 署名生成・検証

### 6.1 署名対象範囲

* `ChatMessage` オブジェクト全体（`crypto:signature` フィールド自身を除く）

### 6.2 正規化 (Canonicalization) — JSON Canonicalization Scheme (JCS)

JCS により負荷を低減しつつ、LD 展開なしで確定的ハッシュを実現する。 手順は v1.3 と同一。詳細は Appendix A を参照。

---

## 7. メンション記法（変更なし）

```
!@<userId>
```

---

## 8. 将来拡張指針

* KEM の置き換えは `accountKey` の `crypto:algorithm` を差し替えるだけ。
* mKEM の O(N) 暗号文長が課題となる場合、格子系 Broadcast Encryption への移行も設計上容易。
* 署名 URL を外部 CDN に載せ、本文サイズを最小化。

---

## Appendix A – 署名時 JCS 正規化フロー

この仕様では、署名対象データの正規化に **JSON Canonicalization Scheme (JCS; RFC 8785)** を採用します。これにより、JSON-LD 展開などの複雑な処理を必要とせず、クライアント負荷を低減しつつ、確定的ハッシュを実現します。

### A.1 適用範囲

*   正規化対象は、`ChatMessage` オブジェクトから `crypto:signature` フィールドを除いた **JSON オブジェクト自身** とします。
*   `@context` フィールドは、メッセージの送信者と受信者の間で常に同一の文字列表現（例: 配列内のURLの順序も含む）を用いるものとし、バインド先の意味論的展開は行いません。

### A.2 正規化手順

1.  **`crypto:signature` フィールドの除去**:
    `ChatMessage` オブジェクトから `crypto:signature` フィールド（存在する場合）を除去します。

2.  **JSON パース**:
    結果の JSON テキストをパースし、ネイティブ言語のオブジェクト／ハッシュマップ構造に格納します。

3.  **キーのソート**:
    各オブジェクト（JSON オブジェクト）について、そのメンバー（キーと値のペア）をキーの Unicode コードポイント順にソートします。

4.  **値の最小表現への変換**:
    *   **文字列**:
        *   JSON 仕様でエスケープが必須な文字（例: `"`、`\`、制御文字 U+0000 から U+001F）以外はエスケープしません。
        *   スラッシュ (`/`) はエスケープしません（例: `\/` ではなく `/` とします）。
        *   UTF-8 バイト列として表現した際に最短となるようにエンコードします。
    *   **数値**:
        *   先頭の不要なゼロ（例: `01` は `1` に）や、小数点以下の末尾の不要なゼロ（例: `1.2300` は `1.23` に）を削除した最短表記とします。
        *   指数表記は使用しません（例: `1e6` ではなく `1000000`）。（JCS 仕様では指数表記も許容されますが、本仕様では相互運用性の観点から非指数表記を推奨します。）
    *   **ブール値**: `true` または `false` の小文字リテラルとします。
    *   **null**: `null` の小文字リテラルとします。

5.  **直列化 (Serialization)**:
    ソートおよび最小表現化されたオブジェクトを、メンバー間に空白や改行を挟まずに JSON テキスト形式で直列化します。オブジェクトのメンバー間（キーと値の間、およびキーバリューペア間）には、JSON 仕様で規定される最小限の区切り文字（`:` と `,`）のみを使用します。

6.  **バイト列化**:
    直列化された JSON テキストを UTF-8 エンコーディングのバイト列に変換します。このバイト列が署名対象データ **C** となります。

### A.3 サンプル

以下は、正規化前の `ChatMessage` オブジェクトの例です（`crypto:signature` フィールドは署名前のため存在しないか、除去済みとします）。このオブジェクトに対して A.2 の正規化手順を適用すると、署名対象となる UTF-8 バイト列 **C** が得られます。

```jsonc
// 元の ChatMessage （crypto:signature フィールドは除去済みと仮定）
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    { "crypto": "https://example.com/ns/crypto#" }
  ],
  "type": "ChatMessage",
  "id": "https://example.com/messages/123",
  "attributedTo": "https://example.com/users/alice",
  "to": [
    "https://example.org/users/bob",
    "https://fedi.example.net/users/carla"
  ],
  "conversation": "https://example.com/conversations/42",
  "inReplyTo": "https://example.com/messages/120",
  "published": "2025-05-03T14:30:00+09:00",
  "crypto:kemCipherText": "Base64URL(mKEM_ct)",
  "crypto:cipherText": "Base64URL(iv‖ciphertext‖tag)",
  "attachment": [{
    "type": "ChatAttachment",
    "mediaType": "image/png",
    "url": "https://example.com/media/img1",
    "crypto:encrypted": true,
    "crypto:iv": "Base64URL(ivBytes)",
    "crypto:tag": "Base64URL(tagBytes)"
  }]
}
```

検証側は、受信したメッセージから `crypto:signature` フィールドを除去した後、上記と同一の手順で署名対象データ **C'** を再構築し、送信者の公開鍵を用いて署名値 **S** と **C'** を検証します。