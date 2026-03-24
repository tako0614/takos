# Thread / Run / Artifact

Takos の AI 実行面では、`Thread` と `Run` が中心です。

## Thread

Thread は継続する対話や作業コンテキストです。  
メッセージ列、summary、関連 artifact などが thread に紐づきます。

## Run

Run は thread 上で発生する 1 回の実行です。典型的には次を持ちます。

- status
- input / output
- started_at / completed_at
- parent / child 関係
- worker heartbeat などの execution 情報

## Artifact

Artifact は run の結果物です。コード、設定、ドキュメント、patch、report などが含まれます。

## 何が独自か

Takos は repo deploy と app runtime だけでなく、AI 実行の履歴も platform に含めます。  
そのため、Thread / Run / Artifact のモデルは app deploy や worker model と並ぶ重要な surface です。
