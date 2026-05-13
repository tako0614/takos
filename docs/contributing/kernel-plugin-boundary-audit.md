# Kernel / Plugin Boundary Audit

> このページでわかること: Kernel と Plugin の境界に関するドキュメント整合性チェックリスト。

Takosumi のドキュメントを kernel-only 実装モデルと整合させるためのチェックリストです。

## Source of truth

- `../takosumi` が kernel を所有: コントロールプレーンのセマンティクス、ドメイン、API contract、署名付き internal RPC、plan / apply、activation truth、resource、routing projection、publication、event、audit、security policy。
- `../takosumi/packages/contract/src/plugin.ts` が公開 kernel plugin ABI を所有。
- `../takosumi/packages/kernel/src/plugins/` が registry・env module loader・no-I/O reference plugin を所有。
- self-host、cloud provider、database、queue、object-storage、KMS、secret backend、runtime host の実装は plugin 側の責務。

## kernel 内に置いてよい実装

- conformance / ローカルテスト用の in-memory / noop / reference adapter。
- ローカル adapter と dry-run smoke スクリプト。ただし docs では「adapter / plugin conformance パス」として扱い、kernel 本番配線として書かない。
- operator 専用の runtime config セレクタ。`plugin` を選択でき、未登録 plugin ID なら fail fast する。

## NG パターン

- Docker、Cloudflare、Postgres、Redis、S3、KMS、secret backend を「kernel の完了に必要な作業」として記述すること。
- self-host / cloud deploy proof を kernel release gate に含めること。
- provider / backend / plugin の選択を public manifest や public deploy API に露出させること。
- `takos-deploy` / `takos-runtime` を PaaS internal domain ではなく default の top-level service 境界として書くこと。

## 2026-04-29 audit 結果

- runtime / routing 完了はローカル Docker のマイルストーンではなく、kernel の port / projection slice として記述するよう更新。
- 実バックエンドと self-host docs は plugin-backed operator proof として再分類。
- README / current-state / system-plan の plugin boundary 表現に validation チェックを追加。
- kernel 検証ベースライン: `cd ../takosumi && deno task test` が `240 passed | 0 failed` で通過。
