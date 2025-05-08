## ChatMessage オブジェクト仕様（統合版 v1.3）

### 1. 目的・位置づけ

* **目的**：ActivityPub 互換のメッセージを「暗号化しても／しなくても」「耐量子安全に」「小さく」送受信する。

### 2. 使用アルゴリズムと用語

| 用途   | アルゴリズム                                               | 説明                                                              |
| ---- | ---------------------------------------------------- | --------------------------------------------------------------- |
| 本文暗号 | **AES‑256‑GCM**                                      | 12 byte IV＋16 byte TAG を付け、`iv‖ct‖tag` を Base64URL でエンコード       |
| 添付暗号 | **AES‑256‑CTR**                                      | ストリーミング復号向け。完全性は HTTPS で担保                                      |
| 鍵包化  | **HPKE‑Base(ML‑KEM‑768, HKDF‑SHA‑512, AES‑256‑GCM)** | ML‑KEM‑768 の KEM 出力のみを利用。KDF/AEAD は **固定値** としてスイートに含め、将来拡張に備える |
| 署名   | **ML‑DSA‑44**                                        | RFC 9381 draft 相当                                               |

**用語**

* **accountKey** — ML‑KEM 公開鍵（受信者ごと）
* **messageKey** — AES 対称鍵（受信者ごとにローテーション）
* **signingKey** — ML‑DSA 公開鍵（送信者）

> 🔗 **アルゴリズム識別子はキーに集約** — すべてのキー（accountKey, messageKey, signingKey）は
> `crypto:algorithm` を自身のメタデータとして持つ。メッセージ側は `crypto:keyId` でキーを参照するのみ。

---

### 3. Actor プロファイル拡張

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
    "crypto:accountKeyUrl":
      "https://keys.example.com/alice/accountKey",
    "crypto:messageKeyUrlTemplate":
      "https://keys.example.com/alice/messageKeys/{keyId}?userId={recipient}",
    "crypto:signingKeyUrl":
      "https://keys.example.com/alice/signingKey"
  }
}
```

---

### 4. ChatMessage JSON‑LD 構造

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    { "crypto": "https://example.com/ns/crypto#" }
  ],

  "type": "ChatMessage",
  "id": "https://example.com/messages/123",
  "attributedTo": "https://example.com/users/alice",
  "to": ["https://example.org/users/bob"],
  "conversation": "https://example.com/conversations/42",
  "inReplyTo": "https://example.com/messages/120",
  "published": "2025-05-03T14:30:00+09:00",

  /* ---------- 本文 ---------- */
  /* ▼暗号化する場合（GCM） */
  "crypto:keyId": "msgkey-abcd1234",
  "crypto:cipherText": "Base64URL(iv‖ciphertext‖tag)",
  /* ▲非暗号化の場合は 2 行を削除し、代わりに:
     "content": "Hi Bob, this is plaintext!" */

  /* ---------- 添付 ---------- */
  "attachment": [{
    "type": "ChatAttachment",
    "mediaType": "image/png",

    /* ▼暗号化ファイル (CTR) */
    "url": "https://example.com/media/img1",
    "crypto:encrypted": true,
    "crypto:keyId": "msgkey-abcd1235",
    "crypto:iv": "Base64URL(ivBytes)"

    /* ▲平文ファイルの場合:
       "url": "https://example.com/media/img1.png",
       "crypto:encrypted": false */
  }],

  /* ---------- 署名（必須） ---------- */
  "crypto:signature": {
    "crypto:keyId": "sigkey-ef56",
    "crypto:signatureUrl": "https://example.com/messages/123.sig",
    "crypto:created": "2025-05-03T14:30:05+09:00"
  }
}
```

---

### 5. 鍵サービス & 署名 API

| HTTP | URL 例                                      | 説明                                          |
| ---- | ------------------------------------------ | ------------------------------------------- |
| GET  | `…/accountKey?userId={recipient}`          | ML‑KEM 公開鍵（`crypto:algorithm` 含む）           |
| GET  | `…/messageKeys/{keyId}?userId={recipient}` | HPKE で暗号化された messageKey を取得                 |
| GET  | `…/signingKey`                             | ML‑DSA 公開鍵                                  |
| GET  | `…/signatures/{messageId}`                 | **Base64URL 署名値**（Content‑Type: text/plain） |

レスポンス例：

```jsonc
// accountKey
{
  "keyId": "kem-111",
  "crypto:algorithm": "HPKE-Base(ML-KEM-768,HKDF-SHA-512,AES-256-GCM)",
  "key": "Base64(pub)"
}

// messageKey
{
  "keyId": "msgkey-abcd1234",
  "crypto:algorithm": "AES-256",
  "cipherText": "Base64URL(hpke ct)"
}

// signingKey
{
  "keyId": "sigkey-ef56",
  "crypto:algorithm": "ML-DSA-44",
  "key": "Base64(pub)"
}

// signature (plain text body)
Base64URL(signatureBytes)
```

---

### 6. 署名生成・検証

#### 6.1 署名対象範囲

* `ChatMessage` オブジェクト全体（`crypto:signature` フィールド自身を除く）

### 6.2 正規化 (Canonicalization) — JCS による軽量方式

この仕様では、署名対象データの正規化に JSON-LD 展開＋URDNA2015 を用いるとクライアント負荷が高くなるため、**JSON Canonicalization Scheme （JCS; RFC 8785）** を採用します。これにより、実装は以下のごく単純なステップで完結します。

#### 6.2.1 適用範囲

* 正規化対象は、`ChatMessage` オブジェクトから `crypto:signature` フィールドを除いた **JSON オブジェクト自身** とする。
* `@context` フィールドは必ず同一の文字列表現を用いるものとし、バインド先の意味論的展開は行わない。

#### 6.2.2 正規化手順

1. **パース＆再構築**
   受信した JSON テキストをパースし、ネイティブ言語のオブジェクト／ハッシュマップ構造に格納する。

2. **キーのソート**
   各オブジェクトについて、キーを Unicode コードポイント順にソートする。

3. **最小表現への変換**

   * 文字列はエスケープを最小限にし、UTF-8 バイト列を直接エンコードする。
   * 数値は先頭の不要なゼロ、小数点以下のトレーリングゼロを削除した最短表記とする（例: `1.2300` → `1.23`、`01` → `1`）。
   * ブール値、null は `true`/`false`/`null` とする。

4. **直列化**
   ソート済みのオブジェクトを、余計な空白／改行なしで JSON テキストにシリアライズする。

5. **バイト列化**
   シリアライズ結果を UTF-8 のバイト列に変換し、これを署名対象データ **C** とする。

#### 6.2.3 サンプル

```jsonc
// 元の ChatMessage （crypto:signature フィールドは省略）
{
  "@context":["https://www.w3.org/ns/activitystreams","https://example.com/ns/crypto#"],
  "type":"ChatMessage",
  "id":"https://example.com/messages/123",
  "attributedTo":"https://example.com/users/alice",
  "published":"2025-05-03T14:30:00+09:00",
  "crypto:keyId":"msgkey-abcd1234",
  "crypto:cipherText":"Base64URL(iv‖ct‖tag)",
  "attachment":[
    {
      "type":"ChatAttachment",
      "mediaType":"image/png",
      "url":"https://example.com/media/img1",
      "crypto:encrypted":true,
      "crypto:keyId":"msgkey-abcd1235",
      "crypto:iv":"Base64URL(ivBytes)"
    }
  ]
}
```

1. 上記をパース → オブジェクト
2. 各オブジェクトのキーをソート
3. 最小表現ルール適用
4. 空白なしでシリアライズ
5. UTF-8 バイト列化 → 署名対象 


#### 6.3 署名生成

1. 送信者の ML‑DSA‑44 秘密鍵で **C** を署名 → **S**
2. **S** を Base64URL エンコードし、署名 URL 先（`…/signatures/{messageId}`）に **text/plain** で配置

#### 6.4 検証手順

1. `crypto:signature.signatureUrl` から Base64URL 署名値 **S** を取得
2. メッセージから `crypto:signature` を除き、**6.1** と同一手順で **C'** を再構築
3. `crypto:keyId` → `crypto:keyUrl` から公開鍵を取得
4. 公開鍵で **C'**, **S** を検証

---

### 7. メンション記法（変更なし）

```
!@<userId>
```

---

### 8. 将来拡張指針

* アルゴリズムの追加は **キー定義だけ** で完結。メッセージ構造は変わらない
* 署名 URL を外部 CDN に載せることでメッセージ本文のサイズ増を最小化
* HPKE スイートを固定することで、将来的に KEM 以外を利用する実験的実装と共存可能
