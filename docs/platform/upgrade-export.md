# Capsule Update / Rollback / Export

このページは、Takos 上の installed app を更新・巻き戻し・持ち出すときの authority を整理します。deploy の正本は
Takosumi control plane の Workspace / Project / Capsule / Run / StateVersion / Output / AuditEvent です。provider access は
ProviderBinding が provider (+ optional alias) を explicit ProviderConnection に解決します。Accounts plane の
`/v1/capsule-projections` は installed service 向けの Capsule projection route です。OIDC client metadata、billing
usage endpoint、runtime token/secret delivery metadata、export handoff を installed service に渡す supporting route であり、
deploy-control Capsule API ではありません。

## Authority Split

| 操作                                   | 正本                                                                              | 補足                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Git URL から install                   | dashboard `/install?git=...` -> `/new` -> Capsule create / plan / apply flow      | 作成は compatibility check と明示確認後。`/install` は prefill link。                               |
| ローカル作業 tree の upload            | `takosumi deploy ./dir` -> upload-origin Source snapshot -> `POST /api/v1/deploy` | developer / operator helper。標準 product flow は Git URL install。                                 |
| update                                 | Source sync -> plan Run -> approval -> apply Run -> StateVersion / Output         | Accounts は結果を projection するだけで、Run ledger の正本ではない。                                |
| rollback                               | retained StateVersion/source identity -> rollback plan -> approval -> apply Run   | reviewed state/source に pin した新しい Run / StateVersion / Output ledger entry を作る。           |
| export / import                        | Takosumi Accounts projection API と operator helper                               | portability handoff。source/target の Accounts plane が secret/OIDC/runtime material を再発行する。 |
| billing / OIDC / runtime material 配布 | `/v1/capsule-projections/*`                                                       | supporting projection。Workspace / Source / Capsule / Run の正本ではない。                          |

## Update Flow

Update は既存 Capsule の Source ref を変え、通常の plan / apply flow をもう一度通します。

```txt
1. Source sync: Git URL / ref / module path を resolved commit に固定
2. compatibility_check: Capsule Normalizer / Gate が provider requirement と output を確認
3. plan Run: Source snapshot + dependency evidence + base StateVersion を pin
4. review: resource change / provider resolution / policy decision / cost を確認
5. apply Run: saved plan digest と generation guard を検証して apply
6. StateVersion / Output: 成功した apply だけを新しい state/output evidence として記録
7. Accounts projection: current Capsule output、OIDC/billing/runtime material を installed service 向けに更新
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

Export は Capsule を別 operator / self-host へ移すための portability handoff です。これは deploy-control の Source /
Capsule / Run API ではなく、Takosumi Accounts plane が installed service material を束ねる supporting flow です。

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

target 側の Takosumi Accounts は OIDC client、pairwise subject、runtime authority、runtime secret、billing projection を再発行します。
data dump / restore が必要な app は、その Capsule または operator runbook が restore contract を持つ必要があります。

## CLI Boundary

公開の標準導線は dashboard の Git URL install です。CLI は補助です。

```bash
takosumi deploy ./my-capsule --space @me --name my-app --provider cloudflare=conn_cf
takosumi plan ./my-capsule --space @me --name my-app
takosumi status <run-id>
takosumi logs <run-id>
```

`takosumi internal installations export ...` / `takosumi internal installations import ...` は legacy-named operator / development helper であり、
通常の install / update / rollback product path として公開しません。operator runbook では Accounts projection API と合わせて扱います。

## Current Revision Boundary

Update / rollback / export は deploy-control ledger と Accounts projection の両方にまたがります。current implementation では、
Source snapshot / plan digest / dependency evidence / base StateVersion / Output を pin した reviewed apply が
新しい StateVersion / Output revision を作る唯一の update authority です。Accounts 台帳操作は OIDC client、billing usage
endpoint、runtime material delivery metadata、export handoff を installed service に投影する supporting flow であり、deploy-control
の Capsule / Run 正本ではありません。

binding-level review は ProviderConnection / ProviderBinding / CredentialRecipe / runtime material / output allowlist の変更を確認するための
operator review です。provider data copy、schema migration の巻き戻し、source instance の audit chain continuity、pairwise
subject の移植は current guarantee としては扱わないため、必要な場合は Capsule 側 contract または operator-owned restore evidence
で別途扱います。

## Status Boundary

Capsule projection の public status は `pending` / `active` / `stale` / `error` / `disabled` / `destroyed` に固定します。
`upgrading` / `rolling-back` / `exporting` / `importing` / `materializing` は operation phase や event payload の hint であり、
public status enum ではありません。

## References

- [Install paths](../apps/install-paths.md)
- [Deploy overview](/deploy/)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
- [Takosumi CLI](https://takosumi.com/docs/reference/cli)
