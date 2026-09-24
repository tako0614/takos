# Capsule の update / rollback / export

このページは、Takos 上の installed app を更新・巻き戻し・持ち出すときの authority を整理します。deploy の正本 (正とする情報) は
Takosumi control plane の Workspace / Project / Capsule / Source / Run / StateVersion / Output / AuditEvent です。provider access は
ProviderBinding が provider (+ optional alias) を explicit ProviderConnection に解決します。runtime surface は
Interface、runtime authorization は InterfaceBinding が正本です。Output は apply evidence であり、runtime registry や
OIDC / billing / secret delivery schema ではありません。

## 権限の分担

| 操作                              | 正本                                                                              | 補足                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Git URL から install              | dashboard `/install?git=...` -> `/new` -> Source / Capsule plan / apply flow      | API では `POST /api/v1/sources`、Source sync、`POST /api/v1/capsules/:capsuleId/plan`、`POST /api/v1/runs/:runId/apply` を使います。作成は compatibility check と明示確認後。`/install` は prefill link。 |
| ローカル作業 tree の upload       | 現在の CLI / API に local tree upload surface はありません                           | Git URL、ref、module path を Source として登録し、commit に固定した Snapshot から plan / apply へ進みます。 |
| update                            | Source sync -> plan Run -> approval -> apply Run -> StateVersion / Output         | exact Run id と Workspace / Capsule fence を保った通常のRun flow。                        |
| rollback                          | retained StateVersion/source identity -> rollback plan -> approval -> apply Run   | reviewed state/source に pin した新しい Run / StateVersion / Output ledger entry を作ります。 |
| export / import                   | operator runbook + 正本の Source / Capsule / StateVersion / Output の read       | portability handoff。secret/OIDC/runtime credential valueは移植せずtarget 側で再発行します。 |
| runtime discovery / authorization | Interface / InterfaceBinding                                                      | Output名やAccounts固有projectionから権限を推測しません。                                    |

## Update の流れ

Update は既存 Capsule の Source ref を変え、通常の plan / apply flow をもう一度通します。

```txt
1. Source sync: Git URL / ref / module path を resolved commit に固定
2. compatibility_check: Capsule Normalizer / Gate が provider requirement と output を確認
3. plan Run: Source snapshot + dependency evidence + base StateVersion を pin
4. review: resource change / provider resolution / policy decision / cost を確認
5. apply Run: saved plan digest と generation guard を検証して apply
6. StateVersion / Output: 成功した apply だけを新しい state/output evidence として記録
7. Interface reconcile: 明示dependencyを持つruntime Interfaceだけを更新
```

自動 update は、plan が追加 approval / costAck / policy escalation を要求しない場合だけ許可できます。mutable branch を production
Capsule で拒否するかどうかは operator policy です。

## Rollback

Rollback は単なる pointer 書き換えではありません。retained StateVersion/source identity を target にして rollback plan Run を作り、通常の
approval / apply flow で新しい StateVersion / Output ledger entry を作ります。

```txt
rollback plan
  -> plan Run (target StateVersion の source snapshot / dependency evidence に pin)
  -> review / approval
  -> apply Run
  -> new StateVersion / Output
```

Rollback が保証するのは OpenTofu module / provider resource state に対する plan/apply の再実行です。Postgres rows、blob objects、
schema migration、外部 provider data の巻き戻しは自動保証ではありません。必要な場合は Capsule 側の forward-compatible migration、
backup / restore Run、または operator-owned data restorer evidence で扱います。

## Export / Import

Export は Capsule を別 operator / self-host へ移すための portability handoff です。現在の Source / Capsule /
StateVersion / Output を API で読み、operator runbook と組み合わせます。別の deploy authority や local-tree upload
surface を持つ projection API はありません。

Export bundle に入れてよいもの:

- Git URL / ref / resolved commit / module path
- reviewed plan / StateVersion / Output への non-secret reference
- public non-secret outputs
- OIDC / DB / object store / runtime authority の再発行 template
- provider が export data provider / restorer を持つ場合だけ data dump reference

Export bundle に入れないもの:

- provider credential value
- OIDC client secret / runtime token value
- source instance の audit chain continuity
- source instance の pairwise subject を target issuer でそのまま使う前提

target 側のoperatorは OIDC client、pairwise subject、InterfaceBinding由来のruntime authority、runtime secret、billing設定を再発行します。
data dump / restore が必要な app は、その Capsule または operator runbook が restore contract を持つ必要があります。

## CLI の境界

公開の標準導線は dashboard の Git URL install です。現在の CLI は Run の確認と operator 管理用の補助操作を提供します。

```bash
takosumi status <run-id>
takosumi logs <run-id>
takosumi connections list
takosumi install-configs patch <install-config-id> --file <install-config-patch.json>
```

Source / Capsule の plan / apply は dashboard または上記の deploy-control API で行います。CLI に local tree の
upload、plan、export、import の操作はありません。`installations` domain は retired で、呼び出すとエラーになります。
移行先では Git URL から Source / Capsule を作り直し、plan / apply と target 側の credential、OIDC、InterfaceBinding を
再設定します。operator runbook では正本の ledger の read と target 側の再設定を扱います。

## 現在の revision の境界

Update / rollback / export は deploy-control ledger を正本にします。current implementation では、
Source snapshot / plan digest / dependency evidence / base StateVersion / Output を pin した reviewed apply が
新しい StateVersion / Output revision を作る唯一の update authority です。runtime discoveryはInterface、認可はInterfaceBinding、
commercial billing / usage ingestはoperator extensionとして分離します。Accounts の記録操作もアプリの更新とは別に扱い、
デプロイ履歴を書き換える手段にはしません。

binding-level review は ProviderConnection / ProviderBinding / CredentialRecipe / runtime material / output allowlist の変更を確認するための
operator review です。provider data copy、schema migration の巻き戻し、source instance の audit chain continuity、pairwise
subject の移植は current guarantee としては扱わないため、必要な場合は Capsule 側 contract または operator-owned restore evidence
で別途扱います。

## Status の境界

Capsule の public status は `pending` / `active` / `stale` / `error` / `disabled` / `destroyed` に固定します。
`upgrading` / `rolling-back` / `exporting` / `importing` / `materializing` は operation phase や event payload の hint であり、
public status enum ではありません。

## 関連ページ

- [Install paths](../apps/install-paths.md)
- [Deploy overview](/deploy/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
- [Takosumi CLI](https://takosumi.com/docs/reference/cli)
