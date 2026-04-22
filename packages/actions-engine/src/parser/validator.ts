/**
 * Zod を使ったワークフロー検証
 */
import { z } from "zod";
import {
  buildDependencyGraph,
  DependencyError,
  detectCycle,
} from "../scheduler/dependency.ts";
import type { Workflow, WorkflowDiagnostic } from "../workflow-models.ts";
import { normalizeNeedsInput } from "../scheduler/job.ts";

// =============================================================================
// Zod スキーマ
// =============================================================================

/**
 * ブランチフィルターのスキーマ
 */
const branchFilterSchema = z.object({
  branches: z.array(z.string()).optional(),
  "branches-ignore": z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  "tags-ignore": z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
  "paths-ignore": z.array(z.string()).optional(),
});

/**
 * push トリガーのスキーマ
 */
const pushTriggerSchema = branchFilterSchema.nullable();

/**
 * pull_request イベント種別の enum
 * GitHub Actions 互換。
 */
const pullRequestEventTypeEnum = z.enum([
  "assigned",
  "unassigned",
  "labeled",
  "unlabeled",
  "opened",
  "edited",
  "closed",
  "reopened",
  "synchronize",
  "converted_to_draft",
  "ready_for_review",
  "locked",
  "unlocked",
  "review_requested",
  "review_request_removed",
  "auto_merge_enabled",
  "auto_merge_disabled",
  "milestoned",
  "demilestoned",
  "enqueued",
  "dequeued",
]);

/**
 * pull_request トリガーのスキーマ
 */
const pullRequestTriggerSchema = branchFilterSchema
  .extend({
    types: z.array(pullRequestEventTypeEnum).optional(),
  })
  .nullable();

/**
 * issues イベント種別の enum
 */
const issuesEventTypeEnum = z.enum([
  "opened",
  "edited",
  "deleted",
  "transferred",
  "pinned",
  "unpinned",
  "closed",
  "reopened",
  "assigned",
  "unassigned",
  "labeled",
  "unlabeled",
  "locked",
  "unlocked",
  "milestoned",
  "demilestoned",
]);

/**
 * issue_comment イベント種別の enum
 */
const issueCommentEventTypeEnum = z.enum(["created", "edited", "deleted"]);

/**
 * release イベント種別の enum
 */
const releaseEventTypeEnum = z.enum([
  "published",
  "unpublished",
  "created",
  "edited",
  "deleted",
  "prereleased",
  "released",
]);

/**
 * watch イベント種別の enum
 */
const watchEventTypeEnum = z.enum(["started"]);

/**
 * workflow_dispatch 入力のスキーマ
 */
const workflowDispatchInputSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
  type: z.enum(["string", "boolean", "choice", "environment"]).optional(),
  options: z.array(z.string()).optional(),
});

/**
 * workflow_dispatch トリガーのスキーマ
 */
const workflowDispatchSchema = z
  .object({
    inputs: z.record(workflowDispatchInputSchema).optional(),
  })
  .nullable();

/**
 * schedule トリガーのスキーマ
 */
const scheduleTriggerSchema = z.object({
  cron: z.string(),
});

/**
 * workflow_call 入力のスキーマ
 */
const workflowCallInputSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.boolean(), z.number()]).optional(),
  type: z.enum(["string", "boolean", "number"]),
});

/**
 * workflow_call 出力のスキーマ
 */
const workflowCallOutputSchema = z.object({
  description: z.string().optional(),
  value: z.string(),
});

/**
 * workflow_call シークレットのスキーマ
 */
const workflowCallSecretSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
});

/**
 * workflow_call トリガーのスキーマ
 */
const workflowCallSchema = z
  .object({
    inputs: z.record(workflowCallInputSchema).optional(),
    outputs: z.record(workflowCallOutputSchema).optional(),
    secrets: z.record(workflowCallSecretSchema).optional(),
  })
  .nullable();

/**
 * ワークフロートリガーのスキーマ
 *
 * `repository_dispatch.types` は workflow 側で自由に定義する活動名なので
 * `z.string()` を受け入れる (GH Actions も enum を強制しない)。
 */
const workflowTriggerSchema = z.object({
  push: pushTriggerSchema.optional(),
  pull_request: pullRequestTriggerSchema.optional(),
  pull_request_target: pullRequestTriggerSchema.optional(),
  workflow_dispatch: workflowDispatchSchema.optional(),
  workflow_call: workflowCallSchema.optional(),
  schedule: z.array(scheduleTriggerSchema).optional(),
  repository_dispatch: z
    .object({
      types: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  issues: z
    .object({
      types: z.array(issuesEventTypeEnum).optional(),
    })
    .nullable()
    .optional(),
  issue_comment: z
    .object({
      types: z.array(issueCommentEventTypeEnum).optional(),
    })
    .nullable()
    .optional(),
  release: z
    .object({
      types: z.array(releaseEventTypeEnum).optional(),
    })
    .nullable()
    .optional(),
  create: z.null().optional(),
  delete: z.null().optional(),
  fork: z.null().optional(),
  watch: z
    .object({
      types: z.array(watchEventTypeEnum).optional(),
    })
    .nullable()
    .optional(),
});

/**
 * ステップのスキーマ
 */
const stepSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    uses: z.string().optional(),
    run: z.string().optional(),
    "working-directory": z.string().optional(),
    shell: z.enum(["bash", "pwsh", "python", "sh", "cmd", "powershell"])
      .optional(),
    with: z.record(z.unknown()).optional(),
    env: z.record(z.string()).optional(),
    if: z.string().optional(),
    "continue-on-error": z.boolean().optional(),
    "timeout-minutes": z.number().positive().optional(),
  })
  .refine(
    (step) => step.uses !== undefined || step.run !== undefined,
    {
      message: 'Step must have either "uses" or "run"',
    },
  )
  .refine(
    (step) => !(step.uses !== undefined && step.run !== undefined),
    {
      message: 'Step cannot have both "uses" and "run"',
    },
  );

/**
 * Matrix 設定のスキーマ
 */
const matrixConfigSchema = z
  .record(z.unknown())
  .refine(
    (obj) => {
      // 'include' と 'exclude' を特別キーとして許可
      for (const [key, value] of Object.entries(obj)) {
        if (key === "include" || key === "exclude") {
          if (!Array.isArray(value)) return false;
        } else if (!Array.isArray(value)) {
          return false;
        }
      }
      return true;
    },
    {
      message: "Matrix values must be arrays (except include/exclude)",
    },
  );

/**
 * ジョブ戦略のスキーマ
 */
const jobStrategySchema = z.object({
  matrix: matrixConfigSchema.optional(),
  "fail-fast": z.boolean().optional(),
  "max-parallel": z.number().positive().optional(),
});

/**
 * コンテナ設定のスキーマ
 */
const containerConfigSchema = z.union([
  z.string(),
  z.object({
    image: z.string(),
    credentials: z
      .object({
        username: z.string(),
        password: z.string(),
      })
      .optional(),
    env: z.record(z.string()).optional(),
    ports: z.array(z.union([z.number(), z.string()])).optional(),
    volumes: z.array(z.string()).optional(),
    options: z.string().optional(),
  }),
]);

/**
 * 権限のスキーマ
 */
const permissionsSchema = z.union([
  z.literal("read-all"),
  z.literal("write-all"),
  z.record(z.enum(["read", "write", "none"])),
]);

/**
 * 同時実行制御のスキーマ
 */
const concurrencySchema = z.union([
  z.string(),
  z.object({
    group: z.string(),
    "cancel-in-progress": z.boolean().optional(),
  }),
]);

/**
 * 環境設定のスキーマ
 */
const environmentSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    url: z.string().optional(),
  }),
]);

/**
 * ジョブ既定値のスキーマ
 */
const jobDefaultsSchema = z.object({
  run: z
    .object({
      shell: z.string().optional(),
      "working-directory": z.string().optional(),
    })
    .optional(),
});

/**
 * ジョブのスキーマ
 */
const jobSchema = z.object({
  name: z.string().optional(),
  "runs-on": z.union([z.string(), z.array(z.string())]),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  if: z.string().optional(),
  env: z.record(z.string()).optional(),
  steps: z.array(stepSchema).min(1, "Job must have at least one step"),
  outputs: z.record(z.string()).optional(),
  strategy: jobStrategySchema.optional(),
  container: containerConfigSchema.optional(),
  services: z.record(containerConfigSchema).optional(),
  "timeout-minutes": z.number().positive().optional(),
  "continue-on-error": z.boolean().optional(),
  permissions: permissionsSchema.optional(),
  concurrency: concurrencySchema.optional(),
  defaults: jobDefaultsSchema.optional(),
  environment: environmentSchema.optional(),
});

/**
 * 完全なワークフローのスキーマ
 */
const workflowSchema = z.object({
  name: z.string().optional(),
  "run-name": z.string().optional(),
  on: z.union([
    workflowTriggerSchema,
    z.string(),
    z.array(z.string()),
  ]),
  env: z.record(z.string()).optional(),
  jobs: z
    .record(jobSchema)
    .refine((jobs) => Object.keys(jobs).length > 0, {
      message: "Workflow must have at least one job",
    }),
  permissions: permissionsSchema.optional(),
  concurrency: concurrencySchema.optional(),
  defaults: jobDefaultsSchema.optional(),
});

// =============================================================================
// 検証関数
// =============================================================================

/**
 * 検証結果
 */
export interface ValidationResult {
  valid: boolean;
  diagnostics: WorkflowDiagnostic[];
}

/**
 * ZodIssue の union error を再帰的に展開して詳細 issue を収集する。
 *
 * z.union は最上位の invalid_union issue で path を失いがちなので、
 * nested unionErrors から最も具体的な branch error を選んで返す。
 */
function flattenZodIssues(issues: readonly z.ZodIssue[]): z.ZodIssue[] {
  const flat: z.ZodIssue[] = [];
  for (const issue of issues) {
    if (issue.code === "invalid_union") {
      // invalid_type で 'expected' と実際の型が大きく違う branch はスキップし、
      // より深い path を報告する branch を優先する
      const branches = issue.unionErrors ?? [];
      // 最も深い path を持つ branch を選ぶ (= 実際に drill down できた validator)
      let best: z.ZodIssue[] | undefined;
      let bestDepth = -1;
      for (const branch of branches) {
        for (const inner of branch.issues) {
          if (inner.path.length > bestDepth) {
            bestDepth = inner.path.length;
            best = branch.issues;
          }
        }
      }
      if (best) {
        flat.push(...flattenZodIssues(best));
      } else {
        flat.push(issue);
      }
    } else {
      flat.push(issue);
    }
  }
  return flat;
}

/**
 * Zod の issue をワークフロー診断に変換して収集
 */
function collectSchemaDiagnostics(
  schema: z.ZodTypeAny,
  input: unknown,
  diagnostics: WorkflowDiagnostic[],
  formatPath: (issuePath: Array<string | number>) => string,
): void {
  const result = schema.safeParse(input);
  if (result.success) {
    return;
  }

  for (const issue of flattenZodIssues(result.error.issues)) {
    diagnostics.push({
      severity: "error",
      message: issue.message,
      path: formatPath(issue.path),
    });
  }
}

/**
 * 診断結果から検証結果を構築
 */
function buildValidationResult(
  diagnostics: WorkflowDiagnostic[],
): ValidationResult {
  return {
    valid: !diagnostics.some((d) => d.severity === "error"),
    diagnostics,
  };
}

/**
 * スキーマに対してワークフローを検証
 */
export function validateWorkflow(workflow: Workflow): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [];

  // スキーマ検証
  collectSchemaDiagnostics(
    workflowSchema,
    workflow,
    diagnostics,
    (issuePath) => issuePath.join("."),
  );

  // 追加のセマンティック検証
  const semanticDiagnostics = validateSemantics(workflow);
  diagnostics.push(...semanticDiagnostics);

  return buildValidationResult(diagnostics);
}

/**
 * セマンティック検証を実行
 */
function validateSemantics(workflow: Workflow): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];

  // ジョブ依存関係を検証
  const jobNames = new Set(Object.keys(workflow.jobs));

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    const needs = normalizeNeedsInput(job.needs);

    for (const need of needs) {
      if (!jobNames.has(need)) {
        diagnostics.push({
          severity: "error",
          message: `Job "${jobId}" references unknown job "${need}" in needs`,
          path: `jobs.${jobId}.needs`,
        });
      }

      if (need === jobId) {
        diagnostics.push({
          severity: "error",
          message: `Job "${jobId}" cannot depend on itself`,
          path: `jobs.${jobId}.needs`,
        });
      }
    }

    // ステップ ID の重複チェック
    const stepIds = new Set<string>();
    for (let i = 0; i < job.steps.length; i++) {
      const step = job.steps[i];
      if (step.id) {
        if (stepIds.has(step.id)) {
          diagnostics.push({
            severity: "error",
            message: `Duplicate step ID "${step.id}" in job "${jobId}"`,
            path: `jobs.${jobId}.steps[${i}].id`,
          });
        }
        stepIds.add(step.id);
      }
    }
  }

  // 共有の依存グラフで循環依存を検出
  try {
    const graph = buildDependencyGraph(workflow);
    const cycle = detectCycle(graph);
    if (cycle.length > 0) {
      diagnostics.push({
        severity: "error",
        message: `Circular dependency detected: ${cycle.join(" -> ")}`,
        path: "jobs",
      });
    }
  } catch (e) {
    // buildDependencyGraph は未知のジョブ参照時に DependencyError を投げるが、
    // 同内容は上で needs 検証により既に報告されている。
    if (!(e instanceof DependencyError)) {
      throw e;
    }
  }

  return diagnostics;
}
