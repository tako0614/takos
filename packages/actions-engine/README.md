# takos-actions-engine

GitHub Actions-flavored CI/workflow **parser, validator, and execution engine**
for Takos. The package's stable, exported surface is:

- `parseWorkflow(yamlString)` — YAML → `ParsedWorkflow`
- `validateWorkflow(workflow)` — Zod schema + semantic checks (cycles, duplicate
  ids, unknown `needs`)
- `createExecutionPlan(workflow)` — DAG → phased execution order
- `JobScheduler` / `StepRunner` — runtime job and step execution
- `createBaseContext` / `parseGitHubEnvFile` — context helpers

## Compatibility status

The engine implements a **subset** of GitHub Actions semantics. Many fields are
accepted by the schema but not enforced at runtime. Workflow authors copying
real-world `.github/workflows/*.yml` files should expect the following gaps:

| Feature                                                              | Status                   | Notes                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jobs.<id>.steps[*].run`                                             | supported                | shell selection per step                                                                                                                                                                                                             |
| `jobs.<id>.steps[*].uses`                                            | partial                  | `actions/checkout@*` and `actions/setup-node@*` have compatibility no-op resolvers for standalone engine tests. Real action execution is provided by runtime-service managed actions or a custom `actionResolver`.                   |
| `jobs.<id>.needs`                                                    | supported                | dependency phases                                                                                                                                                                                                                    |
| `jobs.<id>.strategy.matrix`                                          | supported                | cartesian product with `include` / `exclude`, expanded into separate job entries (`${baseId}-${hash}`). Downstream jobs via `needs` wait for all matrix expansions. `context.matrix` and `context.strategy` are populated per entry. |
| `jobs.<id>.timeout-minutes`                                          | supported                | job wall-clock is gated by an `AbortController`; the step loop aborts and the job is marked `failure` on timeout.                                                                                                                    |
| `jobs.<id>.outputs`                                                  | supported                | `JobResult.outputs` is populated by interpolating the user-declared `outputs` map against the finalized `steps.*` context; legacy last-writer-wins flatten is used as a fallback when `outputs` is undefined.                        |
| `defaults.run.shell` / `working-directory` (workflow / job level)    | supported                | resolution order: `step.shell` → `job.defaults.run.shell` → `workflow.defaults.run.shell` → runner default. Same for `working-directory`.                                                                                            |
| `if: success()` / `failure()` / `cancelled()` / `always()`           | supported                | `context.job.status` is tracked through the step loop and promoted on unguarded step failures. Job-level dependency-aware status semantics are not implemented.                                                                      |
| `steps.<id>.outcome` vs `conclusion`                                 | not differentiated       | `outcome` mirrors `conclusion`; `continue-on-error` status rewriting is not implemented.                                                                                                                                             |
| `${{ contains() }}`, `startsWith()`, `==`, `&&`, arithmetic, ternary | **NOT IMPLEMENTED**      | `contains()` / `startsWith()` / `endsWith()`, comparison/logical operators, arithmetic, and ternary expressions are rejected by the evaluator.                                                                                       |
| Reusable workflows (`uses: ./.github/workflows/x.yml` at job level)  | **NOT IMPLEMENTED**      | `workflow_call` trigger is parsed but no resolver exists.                                                                                                                                                                            |
| `${{ secrets.X }}` masking in logs                                   | supported                | resolved secret values are collected per-step and replaced with `***` in step output, command-file outputs, and `StepResult.error`.                                                                                                  |
| `GITHUB_STEP_SUMMARY`                                                | partial                  | runtime-service では command file を用意するが、summary の persist / render は未実装。standalone engine では step process に露出しない。                                                                                             |
| Artifact upload/download                                             | not the engine's concern | persistence is handled externally by the kernel.                                                                                                                                                                                     |

If you need any of the above, supply a custom `actionResolver`, `shellExecutor`,
or wrap the runtime invocation in your own glue code.

## Architecture

```
src/
  index.ts                 -- public API surface (re-exports)
  workflow-models.ts       -- all TypeScript type definitions
  constants.ts             -- shared constants
  context.ts               -- execution context helpers
  parser/
    workflow.ts            -- YAML parser (yaml npm) + normalization
    validator.ts           -- Zod schema validation + semantic checks
    expression.ts          -- GitHub Actions expression evaluator
  scheduler/
    job.ts                 -- JobScheduler class + createExecutionPlan
    step.ts                -- StepRunner (individual step execution)
    dependency.ts          -- DAG builder, cycle detection, phase grouping
    job-policy.ts          -- job-level control flow helpers
```

### Parsing

`parseWorkflow(yamlString)` converts a raw YAML string into a `ParsedWorkflow`
containing the normalized `Workflow` object and any `WorkflowDiagnostic`
entries. The parser handles all trigger shorthand forms (`on: push`,
`on: [push, pull_request]`, full object) and normalizes `needs` fields.

### Validation

`validateWorkflow(workflow)` runs two-pass validation:

1. **Schema validation** -- Zod schemas enforce structural correctness for
   triggers, steps, jobs, matrix configs, permissions, concurrency, and
   environment settings.
2. **Semantic validation** -- checks for unknown `needs` references, self-
   dependencies, duplicate step IDs, and circular dependency detection via DAG
   analysis.

### Scheduling

`createExecutionPlan(workflow)` builds a dependency graph from job `needs`
fields and groups jobs into execution phases. Jobs within the same phase can run
in parallel; phases execute sequentially.

`JobScheduler` is the full runtime scheduler that:

- Resolves dependency graphs and groups jobs into phases
- Evaluates `if` conditions using GitHub Actions expression syntax
- Runs steps via a pluggable `StepRunner`
- Supports `fail-fast` mode (cancels remaining jobs on first failure)
- Supports `max-parallel` to limit concurrent jobs within a phase
- Emits lifecycle events (`workflow:start`, `phase:start`, `job:start`,
  `job:complete`, `job:skip`, `phase:complete`, `workflow:complete`)

## Key Exports

### Functions and classes

| Export                          | Description                                                          |
| ------------------------------- | -------------------------------------------------------------------- |
| `parseWorkflow(content)`        | Parse YAML workflow string into `ParsedWorkflow`                     |
| `validateWorkflow(workflow)`    | Validate a `Workflow` object, returns `ValidationResult`             |
| `createExecutionPlan(workflow)` | Build phased execution plan from job dependencies (matrix-aware)     |
| `JobScheduler`                  | Runtime scheduler (matrix expansion, status tracking, event emitter) |
| `StepRunner`                    | Per-step executor (shell/action, secret masking, defaults fallback)  |
| `createBaseContext(options)`    | Create a default `ExecutionContext`                                  |
| `parseGitHubEnvFile(content)`   | Parse a `$GITHUB_ENV` / `$GITHUB_OUTPUT` file                        |

### Types -- Triggers

| Type                       | Description                                        |
| -------------------------- | -------------------------------------------------- |
| `WorkflowTrigger`          | Union of all trigger event configurations          |
| `BranchFilter`             | Branch/tag/path filter for push/PR triggers        |
| `PullRequestTriggerConfig` | PR trigger with event types and filters            |
| `WorkflowDispatchConfig`   | Manual dispatch with typed inputs                  |
| `ScheduleTriggerConfig`    | Cron-based schedule trigger                        |
| `WorkflowCallConfig`       | Reusable workflow call with inputs/outputs/secrets |
| `RepositoryDispatchConfig` | Repository dispatch event trigger                  |

### Types -- Workflow Structure

| Type                | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `Workflow`          | Complete workflow definition (name, on, jobs, permissions, etc.)  |
| `Job`               | Job definition (runs-on, needs, steps, strategy, container, etc.) |
| `Step`              | Step definition (uses/run, with, env, if, timeout)                |
| `MatrixConfig`      | Strategy matrix key-value arrays with include/exclude             |
| `JobStrategy`       | Matrix + fail-fast + max-parallel settings                        |
| `ContainerConfig`   | Container image with credentials, env, ports, volumes             |
| `Permissions`       | Read/write/none permission levels or `read-all`/`write-all`       |
| `ConcurrencyConfig` | Concurrency group with cancel-in-progress option                  |

### Types -- Execution State

| Type             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `RunStatus`      | `'queued' \| 'in_progress' \| 'completed' \| 'cancelled'` |
| `Conclusion`     | `'success' \| 'failure' \| 'cancelled' \| 'skipped'`      |
| `StepResult`     | Step execution result with outputs, timing, and error     |
| `JobResult`      | Job result with step results, outputs, and matrix values  |
| `WorkflowResult` | Workflow result aggregating all job results               |
| `ExecutionPlan`  | Phased job execution order (parallel within each phase)   |

### Types -- Expression Context

| Type               | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `ExecutionContext` | Full runtime context for expression evaluation                        |
| `GitHubContext`    | GitHub event metadata (event_name, ref, sha, repository, actor, etc.) |
| `RunnerContext`    | Runner environment (OS, arch, temp dirs)                              |
| `JobContext`       | Current job status and container info                                 |
| `StepsContext`     | Previous step outputs and outcomes                                    |
| `NeedsContext`     | Dependent job outputs and results                                     |
| `StrategyContext`  | Matrix strategy metadata (job-index, job-total)                       |
| `InputsContext`    | workflow_dispatch input values                                        |

## Usage

```typescript
import {
  createExecutionPlan,
  parseWorkflow,
  validateWorkflow,
} from "takos-actions-engine";

// Parse a workflow YAML string
const { workflow, diagnostics } = parseWorkflow(`
name: CI
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint
  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - run: npm test
  deploy:
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - run: echo "Deploying..."
`);

// Validate the parsed workflow
const validation = validateWorkflow(workflow);
// validation.valid === true
// validation.diagnostics === []

// Build an execution plan
const plan = createExecutionPlan(workflow);
// plan.phases === [['lint'], ['test'], ['deploy']]
```

## Dependencies

- `yaml` -- YAML parsing
- `zod` -- schema validation

## Commands

```bash
cd takos && deno test --allow-all packages/actions-engine/src/
```
