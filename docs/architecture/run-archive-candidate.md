# 旧 Run 履歴のオフライン候補

索引付き reader は一つの gzip の圧縮・展開サイズをそれぞれ 8 MiB に制限します。
旧 reader の展開上限は 200 MiB だったため、個々のイベントは小さくても、一つの旧
segment が大きすぎて自動移行できないことがあります。

scripts/run-archive-candidate.ts は、operator が保存したコピーから、新しい隔離された
KV／object-store namespace 用の **Run 一件の候補**を作ります。元ファイルは読み取り
専用です。live source の export、upload、apply、deploy、削除を実行する道具ではありません。

候補では同じ Run のイベントを ID 順に再分割し、canonical key を 1 から振り直します。
元と同じ論理 key に異なる bytes が入る場合があります。**元の bucket／prefix にそのまま
適用してはいけません。** 主担当が全インスタンス・他 Run のデータを含むコピーと
新しい対象 namespace を組み立て、切替・復旧の条件を別に検証する必要があります。

## 入力コピー

operator が owning backend から、停止・snapshot・遅延書込の照合条件を満たすコピーを
取得して保管します。その操作と live copy の完全性は、この道具では証明しません。
SQL の export があっても last_event_id を R2 の保存済み範囲とみなしません。

入力 directory は現在の operator が所有する private directory（POSIX では 0700）に
します。manifest と参照ファイルは regular file、所有者一致、hardlink 無しにします。
symlink、相対 path の脱出、重複 key／file、途中で変わった file を拒否します。
manifest は 32 MiB、KV と object の各 inventory は 100,000 件までです。KV value の
JSON file は 8 MiB、圧縮 object と任意の SQL witness は 256 MiB までです。
KV は一件ずつ検証し、必要な value を file から読むため、全 tree の payload を同時に
保持しません。内部 KV list は最大 1,000 件／32 MiB で、不正 option は拒否します。

manifest の形は次です。digest は各ファイルの実 bytes に対する SHA-256、bytes は
実バイト数です。例中の値は自分のコピーから求めて置き換えます。

~~~json
{
  "kind": "takos.run-archive-export@1",
  "runId": "run-example",
  "sourceCommit": "<元 source の 40 桁 commit>",
  "kv": [
    {
      "key": "bufferState",
      "path": "kv/head.json",
      "bytes": 1234,
      "sha256": "<64 桁 lowercase SHA-256>"
    }
  ],
  "objects": [
    {
      "key": "runs/run-example/events/000001.jsonl.gz",
      "path": "objects/segment-1.gz",
      "bytes": 12345,
      "sha256": "<64 桁 lowercase SHA-256>"
    }
  ]
}
~~~

v2 head の参照先 chunk、既存索引 node、退役記録も kv に含めます。KV の file は、
storage value 自体を JSON にした bytes です。R2 の file は圧縮された実 bytes です。
objects には当該 Run の events と usage を含めます。usage object の任意の
metadata object は、候補でもそのまま保持します。任意の sqlWitness は
{path,bytes,sha256} として指定でき、その不透明な bytes を保持します。SQL の解釈や
履歴全体との照合を済ませた証拠にはなりません。sourceCommit は入力側の宣言であり、
live source identity をこの文字列だけで確認したことにはなりません。

## 作成と再検証

元コピーの manifest bytes を選び、その digest を必須引数で固定します。出力 parent も
現在の operator が所有する private directory にし、出力先自身は新規 directory にします。
出力を元コピー内に置いたり、既存出力を再利用したりすることはできません。

~~~sh
bun scripts/run-archive-candidate.ts \
  --input /operator-private/source/export.json \
  --expected-input-sha256 <選んだ manifest の 64 桁 SHA-256> \
  --output /operator-private/run-candidate
~~~

成功時は verified-isolated-candidate と候補 manifest の digest を返します。入力の
private data は stdout に出しません。失敗した候補 directory が残っても、
manifest.json が seal されていなければ成功した artifact ではありません。
元コピーを修正したり、partial directory を復旧結果として採用したりしないでください。

~~~sh
bun scripts/run-archive-candidate.ts \
  --verify /operator-private/run-candidate/manifest.json \
  --expected-manifest-sha256 <作成時に保存した 64 桁 SHA-256>
~~~

候補は private directory／file として作り、全 file と runtime readback を検証してから
manifest を最後に保存して readback します。再検証でも caller が選んだ正確な manifest
bytes を固定します。manifest 自身の整合性を、source の真正性や live snapshot の
完全性と混同しません。

## 保持するものと拒否するもの

既存 head／chunk／intent、索引に結び付いた body と既知の pending／ring／receipt を
照合します。preferred SQL ID の合法的な欠番を許し、全整数 ID があるとは仮定しません。
head が保存済みと記録した events／usage の最終 key は、入力 inventory に必要です。
未確定の physical object を、accepted pending／intent の witness 無しで取り込みません。

各 event の ID、type、data、created_at を保ち、最大 100 event と圧縮・展開各 8 MiB の
gzip に分割します。一つの event がこの形式に収まらなければ拒否します。counter、ring、
再送 receipt、usage pending／intent／blob と usage object を保持し、Run pending は候補の
archive に一度収めます。Run の schema3 ready root と外側 v2 head を作り、production
RunNotifierDO の cold /archive と現在の indexed reader で全履歴を照合します。出力 object も
合計 100,000 件までです。候補の KV を最後の空 page まで列挙し、head／chunk／root の
参照先と inventory が正確に一致することを確認します。

元の private Workspace、owner、参加者、通知や SQL usage を書き換えません。道具は
source で見えなかった過去の消失イベントを復元しません。未知・欠落・矛盾した witness
を無視して成功した候補にすることもありません。

## 実環境の解除条件

候補の source 成功とは別に、主担当が次を確認します。

- 元 head／R2／SQL の copy と complete instance closure、old writer 停止・遅延書込。
- 当該 candidate を含む新 target の head durability、object read／no-overwrite、
  restart／alarm／quota と exact resource／artifact identity。
- 実利用者の読取・Run／tool／checkpoint 復旧、監視、retained artifact と restore drill。

long Run receipt 容量、usage 50,000 超の集計、実 owner-sub と mobile の対応は
この変換とは別の GA 項目です。[保存の正本](notifier-journal.md) と、repository 内の
tasks/TASK-takos-ga-archive-candidate-20261001.md を参照してください。
