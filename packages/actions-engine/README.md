# takos-actions-engine

GitHub Actions-flavored CI/workflow **parser, validator, and execution
planner** for Takos. The package's stable, exported surface is:

- `parseWorkflow(yamlString)` — YAML → `ParsedWorkflow`
- `validateWorkflow(workflow)` — Zod schema + semantic checks (cycles,
  duplicate ids, unknown `needs`)
- `createExecutionPlan(workflow)` — DAG → phased execution order

The in-package `JobScheduler` / `StepRunner` are present for the kernel's
own runtime use and for tests, but they are **not exported from `index.ts`**
and are not part of the package's stable surface.

## Compatibility status

The engine implements a **subset** of GitHub Actions semantics. Many fields
are accepted by the schema but not enforced at runtime. Workflow authors
copying real-world `.github/workflows/*.yml` files should expect the
following gaps:

| Feature | Status | Notes |
| --- | --- | --- |
| `jobs.<id>.steps[*].run` | supported | shell selection per step |
| `jobs.<id>.steps[*].uses` | partial | only `actions/checkout@*` and `actions/setup-node@*` are recognised, both as **no-op stubs**. Marketplace actions throw `Unsupported action`. Pass a custom `actionResolver` via `StepRunnerOptions` for real behaviour. |
| `jobs.<id>.needs` | supported | dependency phases |
| `jobs.<id>.strategy.matrix` | **NOT IMPLEMENTED** | parser accepts it; runtime never expands matrix combinations. A job with `strategy.matrix.node: [16,18,20]` runs once with `context.matrix === undefined`. |
| `jobs.<id>.timeout-minutes` | **NOT ENFORCED at job level** | step-level timeout works. The job-level value is read into the type but no setTimeout/AbortController gates it. |
| `jobs.<id>.outputs` | **NOT EVALUATED** | `JobResult.outputs` is populated by `collectStepOutputs` (last-writer-wins flatten of all step outputs), not by evaluating the user-declared `outputs` map against `steps.*` context. |
| `defaults.run.shell` / `working-directory` (workflow / job level) | **NOT APPLIED** | only step-level `shell` / `working-directory` are honored. |
| `if: success()` / `failure()` / `cancelled()` / `always()` | **BROKEN** | the engine seeds `context.job.status = 'success'` once and never updates it as steps fail, so status-check functions always evaluate `success=true`, `failure=false`. Job-level `if:` also bypasses the dependency-skip logic incorrectly when these functions are used. |
| `steps.<id>.outcome` vs `conclusion` | not differentiated | both are set to the same value, even when `continue-on-error` rewrites the conclusion. |
| `${{ contains() }}`, `startsWith()`, arithmetic, ternary | not supported | only `success/always/failure/cancelled/format/join/toJSON/fromJSON/hashFiles` are recognised. Unknown expressions evaluate to `false`. |
| Reusable workflows (`uses: ./.github/workflows/x.yml` at job level) | **NOT IMPLEMENTED** | `workflow_call` trigger is parsed but no resolver exists. |
| `${{ secrets.X }}` masking in logs | **NO MASKING** | secret values are interpolated verbatim into commands and `StepResult.error`. Callers must wrap the runner in their own log sanitiser. |
| `GITHUB_STEP_SUMMARY` | not implemented | `$GITHUB_STEP_SUMMARY` writes are dropped. |
| Artifact upload/download | not the engine's concern | persistence is handled externally by the kernel. |

If you need any of the above, supply a custom `actionResolver`,
`shellExecutor`, or wrap the runtime invocation in your own glue code.

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
   dependencies, duplicate step IDs, and circular dependency detection via
   DAG analysis.

### Scheduling

`createExecutionPlan(workflow)` builds a dependency graph from job `needs`
fields and groups jobs into execution phases. Jobs within the same phase
can run in parallel; phases execute sequentially.

`JobScheduler` is the full runtime scheduler that:

- Resolves dependency graphs and groups jobs into phases
- Evaluates `if` conditions using GitHub Actions expression syntax
- Runs steps via a pluggable `StepRunner`
- Supports `fail-fast` mode (cancels remaining jobs on first failure)
- Supports `max-parallel` to limit concurrent jobs within a phase
- Emits lifecycle events (`workflow:start`, `phase:start`, `job:start`,
  `job:complete`, `job:skip`, `phase:complete`, `workflow:complete`)

## Key Exports

### Functions

| Export | Description |
|---|---|
| `parseWorkflow(content)` | Parse YAML workflow string into `ParsedWorkflow` |
| `validateWorkflow(workflow)` | Validate a `Workflow` object, returns `ValidationResult` |
| `createExecutionPlan(workflow)` | Build phased execution plan from job dependencies |

### Types -- Triggers

| Type | Description |
|---|---|
| `WorkflowTrigger` | Union of all trigger event configurations |
| `BranchFilter` | Branch/tag/path filter for push/PR triggers |
| `PullRequestTriggerConfig` | PR trigger with event types and filters |
| `WorkflowDispatchConfig` | Manual dispatch with typed inputs |
| `ScheduleTriggerConfig` | Cron-based schedule trigger |
| `WorkflowCallConfig` | Reusable workflow call with inputs/outputs/secrets |
| `RepositoryDispatchConfig` | Repository dispatch event trigger |

### Types -- Workflow Structure

| Type | Description |
|---|---|
| `Workflow` | Complete workflow definition (name, on, jobs, permissions, etc.) |
| `Job` | Job definition (runs-on, needs, steps, strategy, container, etc.) |
| `Step` | Step definition (uses/run, with, env, if, timeout) |
| `MatrixConfig` | Strategy matrix key-value arrays with include/exclude |
| `JobStrategy` | Matrix + fail-fast + max-parallel settings |
| `ContainerConfig` | Container image with credentials, env, ports, volumes |
| `Permissions` | Read/write/none permission levels or `read-all`/`write-all` |
| `ConcurrencyConfig` | Concurrency group with cancel-in-progress option |

### Types -- Execution State

| Type | Description |
|---|---|
| `RunStatus` | `'queued' \| 'in_progress' \| 'completed' \| 'cancelled'` |
| `Conclusion` | `'success' \| 'failure' \| 'cancelled' \| 'skipped'` |
| `StepResult` | Step execution result with outputs, timing, and error |
| `JobResult` | Job result with step results, outputs, and matrix values |
| `WorkflowResult` | Workflow result aggregating all job results |
| `ExecutionPlan` | Phased job execution order (parallel within each phase) |

### Types -- Expression Context

| Type | Description |
|---|---|
| `ExecutionContext` | Full runtime context for expression evaluation |
| `GitHubContext` | GitHub event metadata (event_name, ref, sha, repository, actor, etc.) |
| `RunnerContext` | Runner environment (OS, arch, temp dirs) |
| `JobContext` | Current job status and container info |
| `StepsContext` | Previous step outputs and outcomes |
| `NeedsContext` | Dependent job outputs and results |
| `StrategyContext` | Matrix strategy metadata (job-index, job-total) |
| `InputsContext` | workflow_dispatch input values |

## Usage

```typescript
import {
  parseWorkflow,
  validateWorkflow,
  createExecutionPlan,
} from 'takos-actions-engine';

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
    if: github.ref == 'refs/heads/main'
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
