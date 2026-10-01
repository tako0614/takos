# Run 履歴と通知の復旧

Takos は所有者 1 人のインスタンスです。Run の履歴は Run ごとに、通知のストリームは
その所有者の Principal ごとに保存します。通知の宛先や外部参加者を新しいインスタンス
所有者として登録する仕組みではありません。

## 保存と再送

`RunNotifierDO` と `NotificationNotifierDO` の `bufferState` は v2 の commit head です。
JSON と flush 用 gzip を 64 KiB ごとの変更しない chunk に分割し、SHA-256 と完全な
readback を確認してから、一つの head を保存します。chunk の base64 値は約 88 KiB で、
legacy KV の文書上の 128 KiB 制限より小さくします。head、参照先、payload の検証が
済むまで状態をインストールしません。保存結果が不明なら head を再読し、その読み込みも
失敗すれば次の操作を拒否します。ACK と WebSocket の配信は head 保存の後です。

Run の R2 書き込みは、送る gzip の正確なバイト列と flush intent を先に DO に保存します。
R2 が同じバイト列なら完了できます。不存在なら条件付き作成と readback を行い、違う
バイト列なら intent を残して停止します。成功後の head 保存に失敗しても、再起動後は
同じ intent を処理します。最終保存は直列化した最新状態に対して行い、自分が処理した
prefix だけを除くため、処理中に届いた後続イベントを失いません。

歴史的な inline state は読み込めます。旧 state に由来する pending のみ、既存 gzip の
JSONL が同一ならその実バイト列を intent に保存して採用できます。新規 v2 intent は
JSONL が同じでも圧縮バイト列が違えば採用しません。異なる履歴や壊れた chunk を自動で
上書き・削除して復旧することはありません。

Run producer は SQL event ID を含む安定した再送キーを使います。usage は異なる計測を
同一 payload だけで重複と判断しません。再送には安定した `request_id` が必要です。
SQL の `runs.last_event_id` は単調な投影であり、R2 の保存済み範囲の証明には使いません。

## Run の索引と旧履歴の移行

Run の論理 snapshot は schema3、Notification は schema2 です。外側の commit head は
どちらも v2 のままです。Run は既存 DO KV の point read で SHA-256 を検証する B+tree を
持ち、各 segment の正確な R2 key、gzip digest/bytes、event の範囲・件数を記録します。
root の切替と対応する pending prefix の除去を同じ head へ保存します。node を書く前に
挿入計画を保存し、退役 node の掃除も同じ head に結び付いた記録に従います。
新入力の受理前に、将来の挿入計画用 3 MiB と 48 chunk 分も予約します。

公開 replay/SSE と InfoUnitIndexer は内部 `/archive` から必要な descriptor と pending を
取得し、必要な gzip だけを検証して読みます。ready 後の通常読取は R2 catalog を列挙
しません。SQL の terminal 証拠も merge しますが、索引・必須 body の読取失敗を無視して
terminal stream を完了させません。event ID は preferred SQL ID により飛ぶことがあるため、
counter 以下の全整数が存在するとは仮定しません。

旧履歴は building 中に一度列挙し、再起動できる frontier を保存します。1 page は 32 key、
1 request/alarm は最大 8 step・20 秒の開始判定で処理し、remote read は別途期限を持ちます。
building 中は新規受理と flush を止めます。無効 key、重複範囲、既知 ring/pending との矛盾、
破損 body はデータを保って repair にします。通信障害・読取期限切れは再試行対象です。
32768 個を超える cursor、圧縮・展開とも 8 MiB を超える segment は自動移行の対象外です。
旧 reader の展開上限は 200 MiB だったため、合法な大きい旧 segment にもこの制限が及びます。
大きい旧 segment は [オフライン候補の道具](run-archive-candidate.md) で再分割できます。
実環境の export、全インスタンスの restore、対象 backend の資格確認は未完了です。

実環境の切替前に旧 writer と遅延書込を止め、元 head・R2・SQL witness の copy を照合して
保存する必要があります。大きい旧 segment の forward repair は、その copy をオフラインで
分割し、ID/type/data/時刻を保った各 gzip の件数・範囲・digest を検証します。オフラインの
道具は Run 一件の schema3 head と gzip を新しい隔離 namespace 用に作り、cold reader で
全件を照合します。同じ論理 key の bytes が変わるため、元 bucket／prefix に適用できません。
upload、本番 head の置換、他 Run を含む切替は実行しません。移行が証明するのは現存検証済み body と既知の
pending/ring の対応であり、過去の消失復元や SQL 全 witness の照合ではありません。

## 通知の長期利用と容量

`notification.new` は `notification_id` による SQL inbox の更新ヒントです。
正本は SQL の通知行で、ストリームは現在の 100 件の replay と再送 receipt を保持します。
その範囲の再送は同じ cursor を返します。範囲外に退いた通知は同じ ID の新しいヒントを
配信できますが、固定 ID の SQL 行を追加・置換しません。任意の期間にわたるヒントの
exactly-once 配信は保証しません。HTTP 失敗や保存失敗後のヒント再送は可能です。
ヒントの配信失敗だけでは SQL inbox の作成を取り消しません。

Run receipt と未処理データは容量を理由に捨てません。snapshot と live blob の合計は
8 MiB、参照 descriptor は 128 chunk までです。新しい入力が収まらなければ、ID を
進める前に 503 で拒否します。Run が非常に長い場合の容量・性能の資格確認は残ります。
recovery alarm は pending を公開する head より先に設定します。途中で失敗した staging
コピーも、次の入力がなくても alarm で片付けます。片付けるのは検証済み head から
参照されない内部 chunk だけで、通知行・履歴・Workspace を削除しません。

## GA と後戻りの条件

ローカル workerd での chunk/restart と fault injection は、Cloudflare 本番や別 backend の
永続性・alarm 配送・容量制限を証明しません。実測したローカル KV は `useSQLite:false`
でも 133120 bytes を受理したため、文書上の制限の検証には使えません。R2 の
`onlyIf` を無視する adapter に、条件付き作成の競合保護を主張しません。主担当には
single-key storage commit、authoritative R2 read、条件付き作成、alarm/restart の
exact target 資格確認を引き継ぎます。

v2 head への移行後、`6066a1a5c` より古いコードは新 state を空とみなす危険があります。
Run schema3 を読めない旧 source（`a8411bb315` を含む）は cold load を拒否し、履歴を
そのまま提供できません。旧稼働 writer は新しい building fence を認識しません。guard のある
artifact が実際に保存・配備された証明はまだありません。古い artifact への deploy は
オフライン restore または forward repair が必要です。この source 検証は deploy 許可や
実環境の restore 完了ではありません。

実装の検証記録は `tasks/TASK-takos-ga-notifier-journal-20261001.md` と
`tasks/TASK-takos-ga-run-archive-index-20261001.md` と
`tasks/TASK-takos-ga-archive-candidate-20261001.md` にあります。
