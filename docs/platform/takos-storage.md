# Storage

Takos kernel のファイル管理機能。

## 役割

- space 内のファイル管理（upload / download / list / delete）
- blob ストレージ

## API

kernel API の一部として提供される。

```text
/api/files              → ファイル一覧
/api/files/:id          → ファイル CRUD
/api/files/:id/content  → ファイル内容取得
/api/files/:id/download → ダウンロード
/api/files/upload       → アップロード
```

## 他の機能からの利用

group が Storage を使いたい場合は kernel API 経由でアクセスする。

```typescript
// group から Storage API を呼ぶ例
const files = await fetch(
  `${kernelApiUrl}/files`,
  { headers: { "Authorization": `Bearer ${appToken}` } },
);
```

## 管理する data

kernel が保持する概念的な data types:

| data type | 内容 |
| --- | --- |
| storage file | ファイルメタデータ（owner, path, size, content type, timestamps） |
| blob | blob 参照（object-store 上の実データへのポインタ） |

内部の table 名やスキーマは kernel の実装詳細であり、public contract ではありません。
利用側は上記の API を通じてアクセスしてください。
