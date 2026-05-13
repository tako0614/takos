# Git source smoke

> このページでわかること: Git source アダプターの smoke テスト。

source adapter の safe-by-default smoke は `scripts/git-source-smoke.ts` にあります。

## カバレッジ

- immutable manifest adapter: 公開 manifest をスナップショットし、manifest / source digest の形を検証。
- local upload adapter: 一時ディレクトリをスナップショットし、ファイル発見と local tree digest を検証。
- git adapter: default ではネットワークも git 実行もせずに ref をスナップショット。
- 実 git 実行は次の両方が揃ったときのみ opt-in 有効。
  - `TAKOS_RUN_GIT_SMOKE=1`
  - `TAKOS_GIT_SMOKE_REPO=<local-git-repo>`

opt-in 時は `DenoGitCommandRunner` で `TAKOS_GIT_SMOKE_REF` (default: `HEAD`) を解決し、解決された commit / tree object id を検証します。

## コマンド

Default dry-run。

```sh
deno run --allow-env=TAKOS_RUN_GIT_SMOKE,TAKOS_GIT_SMOKE_REPO,TAKOS_GIT_SMOKE_REF --allow-read --allow-write scripts/git-source-smoke.ts
```

ローカル checkout を対象にした real git 実行 (opt-in)。

```sh
TAKOS_RUN_GIT_SMOKE=1 TAKOS_GIT_SMOKE_REPO=/path/to/repo TAKOS_GIT_SMOKE_REF=HEAD \
  deno run --allow-env=TAKOS_RUN_GIT_SMOKE,TAKOS_GIT_SMOKE_REPO,TAKOS_GIT_SMOKE_REF --allow-read --allow-write --allow-run=git scripts/git-source-smoke.ts
```
