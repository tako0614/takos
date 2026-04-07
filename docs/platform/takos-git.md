# Git

Takos kernel の Git ホスティング機能。

## 役割

- Git smart HTTP protocol
- リポジトリ管理（create / fork / delete）
- branch, tag, release 管理
- Pull Request

## API

kernel API の一部として提供される。

```text
/api/repos                       → リポジトリ一覧
/api/repos/:owner/:repo          → リポジトリ詳細
/api/repos/:owner/:repo/branches → ブランチ一覧
/api/repos/:owner/:repo/commits  → コミット履歴
/api/repos/:owner/:repo/pulls    → Pull Request
/api/repos/:owner/:repo/releases → リリース
/api/git/:owner/:repo/info/refs          → Git smart HTTP (discovery)
/api/git/:owner/:repo/git-upload-pack    → Git smart HTTP (fetch)
/api/git/:owner/:repo/git-receive-pack   → Git smart HTTP (push)
```

## 他の機能からの利用

- `git clone` は kernel ドメイン経由で行う
- kernel が repo 情報を表示したい場合は内部 API 経由
- Store がパッケージ source を deploy する際に Git を参照

## Release と Version

Git repo の release/tag が group の version 管理に使われる。

- release を作成 → installable な version が増える
- `takos install owner/repo` は最新 release から deploy
- `takos install owner/repo@v1.2.0` は特定 tag から deploy
- `takos update my-app` は Git repo の新 release を確認する

### Installable リポジトリ

リポジトリに `.takos/app.yml` が含まれていれば installable。
Store のフィードに「installable」マークが付く。

## 管理する data

kernel が保持する概念的な data types:

| data type | 内容 |
| --- | --- |
| repository | リポジトリメタデータ |
| commit | コミット |
| branch | ブランチ |
| blob / file | ファイル内容 |
| pull request | Pull Request |
| tag / release | タグとリリース |

内部の table 名やスキーマは kernel の実装詳細であり、public contract ではありません。
利用側は上記の API を通じてアクセスしてください。
