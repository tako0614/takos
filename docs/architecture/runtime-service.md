# ランタイム / エージェント

> このページでわかること: エージェント実行とランタイムの責務分担。

Takos のランタイム実行は、エージェントサービス、kernel、プロバイダープラグイン、
runtime-agent の 4 つのコンポーネントに分かれています。

## Responsibilities

| component | role |
| --- | --- |
| `takos-agent` | agent run execution and product-specific agent behavior |
| Takosumi kernel | deployment lifecycle, plan/apply/status, provider operation orchestration |
| provider plugin | target-specific resource materialization |
| runtime-agent | workload host lifecycle and implementation RPC |

Takos product code should call exported contracts owned by the service that owns
the wire shape. Cross-service types are not copied into generic common packages.

## Local execution

Local development uses the service set in [Local Development](/get-started/local-development).
Production hosting choices are covered in [Hosting](/hosting/).
