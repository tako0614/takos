/**
 * Workflow schema validation using Zod
 */
import { z } from 'zod';
import { buildDependencyGraph, detectCycle, DependencyError } from '../scheduler/dependency.js';
import type { Workflow, WorkflowDiagnostic } from '../types.js';
import { normalizeNeedsInput } from '../scheduler/job.js';

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Branch filter schema
 */
const branchFilterSchema = z.object({
  branches: z.array(z.string()).optional(),
  'branches-ignore': z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  'tags-ignore': z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
  'paths-ignore': z.array(z.string()).optional(),
});

/**
 * Push trigger schema
 */
const pushTriggerSchema = branchFilterSchema.nullable();

/**
 * Pull request trigger schema
 */
const pullRequestTriggerSchema = branchFilterSchema
  .extend({
    types: z.array(z.string()).optional(),
  })
  .nullable();

/**
 * Workflow dispatch input schema
 */
const workflowDispatchInputSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
  type: z.enum(['string', 'boolean', 'choice', 'environment']).optional(),
  options: z.array(z.string()).optional(),
});

/**
 * Workflow dispatch trigger schema
 */
const workflowDispatchSchema = z
  .object({
    inputs: z.record(workflowDispatchInputSchema).optional(),
  })
  .nullable();

/**
 * Schedule trigger schema
 */
const scheduleTriggerSchema = z.object({
  cron: z.string(),
});

/**
 * Workflow call input schema
 */
const workflowCallInputSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.boolean(), z.number()]).optional(),
  type: z.enum(['string', 'boolean', 'number']),
});

/**
 * Workflow call output schema
 */
const workflowCallOutputSchema = z.object({
  description: z.string().optional(),
  value: z.string(),
});

/**
 * Workflow call secret schema
 */
const workflowCallSecretSchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
});

/**
 * Workflow call trigger schema
 */
const workflowCallSchema = z
  .object({
    inputs: z.record(workflowCallInputSchema).optional(),
    outputs: z.record(workflowCallOutputSchema).optional(),
    secrets: z.record(workflowCallSecretSchema).optional(),
  })
  .nullable();

/**
 * Workflow trigger schema
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
      types: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  issue_comment: z
    .object({
      types: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  release: z
    .object({
      types: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  create: z.null().optional(),
  delete: z.null().optional(),
  fork: z.null().optional(),
  watch: z
    .object({
      types: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
});

/**
 * Step schema
 */
const stepSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    uses: z.string().optional(),
    run: z.string().optional(),
    'working-directory': z.string().optional(),
    shell: z.enum(['bash', 'pwsh', 'python', 'sh', 'cmd', 'powershell']).optional(),
    with: z.record(z.unknown()).optional(),
    env: z.record(z.string()).optional(),
    if: z.string().optional(),
    'continue-on-error': z.boolean().optional(),
    'timeout-minutes': z.number().positive().optional(),
  })
  .refine(
    (step) => step.uses !== undefined || step.run !== undefined,
    {
      message: 'Step must have either "uses" or "run"',
    }
  )
  .refine(
    (step) => !(step.uses !== undefined && step.run !== undefined),
    {
      message: 'Step cannot have both "uses" and "run"',
    }
  );

/**
 * Matrix config schema
 */
const matrixConfigSchema = z
  .record(z.unknown())
  .refine(
    (obj) => {
      // Allow 'include' and 'exclude' as special keys
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'include' || key === 'exclude') {
          if (!Array.isArray(value)) return false;
        } else if (!Array.isArray(value)) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Matrix values must be arrays (except include/exclude)',
    }
  );

/**
 * Job strategy schema
 */
const jobStrategySchema = z.object({
  matrix: matrixConfigSchema.optional(),
  'fail-fast': z.boolean().optional(),
  'max-parallel': z.number().positive().optional(),
});

/**
 * Container config schema
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
 * Permissions schema
 */
const permissionsSchema = z.union([
  z.literal('read-all'),
  z.literal('write-all'),
  z.record(z.enum(['read', 'write', 'none'])),
]);

/**
 * Concurrency schema
 */
const concurrencySchema = z.union([
  z.string(),
  z.object({
    group: z.string(),
    'cancel-in-progress': z.boolean().optional(),
  }),
]);

/**
 * Environment schema
 */
const environmentSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    url: z.string().optional(),
  }),
]);

/**
 * Job defaults schema
 */
const jobDefaultsSchema = z.object({
  run: z
    .object({
      shell: z.string().optional(),
      'working-directory': z.string().optional(),
    })
    .optional(),
});

/**
 * Job schema
 */
const jobSchema = z.object({
  name: z.string().optional(),
  'runs-on': z.union([z.string(), z.array(z.string())]),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  if: z.string().optional(),
  env: z.record(z.string()).optional(),
  steps: z.array(stepSchema).min(1, 'Job must have at least one step'),
  outputs: z.record(z.string()).optional(),
  strategy: jobStrategySchema.optional(),
  container: containerConfigSchema.optional(),
  services: z.record(containerConfigSchema).optional(),
  'timeout-minutes': z.number().positive().optional(),
  'continue-on-error': z.boolean().optional(),
  permissions: permissionsSchema.optional(),
  concurrency: concurrencySchema.optional(),
  defaults: jobDefaultsSchema.optional(),
  environment: environmentSchema.optional(),
});

/**
 * Complete workflow schema
 */
const workflowSchema = z.object({
  name: z.string().optional(),
  on: z.union([
    workflowTriggerSchema,
    z.string(),
    z.array(z.string()),
  ]),
  env: z.record(z.string()).optional(),
  jobs: z
    .record(jobSchema)
    .refine((jobs) => Object.keys(jobs).length > 0, {
      message: 'Workflow must have at least one job',
    }),
  permissions: permissionsSchema.optional(),
  concurrency: concurrencySchema.optional(),
  defaults: jobDefaultsSchema.optional(),
});

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  diagnostics: WorkflowDiagnostic[];
}

/**
 * Collect Zod issues as workflow diagnostics
 */
function collectSchemaDiagnostics(
  schema: z.ZodTypeAny,
  input: unknown,
  diagnostics: WorkflowDiagnostic[],
  formatPath: (issuePath: Array<string | number>) => string
): void {
  const result = schema.safeParse(input);
  if (result.success) {
    return;
  }

  for (const issue of result.error.issues) {
    diagnostics.push({
      severity: 'error',
      message: issue.message,
      path: formatPath(issue.path),
    });
  }
}

/**
 * Build validation result from diagnostics
 */
function buildValidationResult(diagnostics: WorkflowDiagnostic[]): ValidationResult {
  return {
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
  };
}

/**
 * Validate workflow against schema
 */
export function validateWorkflow(workflow: Workflow): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [];

  // Schema validation
  collectSchemaDiagnostics(workflowSchema, workflow, diagnostics, (issuePath) => issuePath.join('.'));

  // Additional semantic validation
  const semanticDiagnostics = validateSemantics(workflow);
  diagnostics.push(...semanticDiagnostics);

  return buildValidationResult(diagnostics);
}

/**
 * Perform semantic validation
 */
function validateSemantics(workflow: Workflow): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];

  // Validate job dependencies
  const jobNames = new Set(Object.keys(workflow.jobs));

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    const needs = normalizeNeedsInput(job.needs);

    for (const need of needs) {
      if (!jobNames.has(need)) {
        diagnostics.push({
          severity: 'error',
          message: `Job "${jobId}" references unknown job "${need}" in needs`,
          path: `jobs.${jobId}.needs`,
        });
      }

      if (need === jobId) {
        diagnostics.push({
          severity: 'error',
          message: `Job "${jobId}" cannot depend on itself`,
          path: `jobs.${jobId}.needs`,
        });
      }
    }

    // Validate step IDs are unique
    const stepIds = new Set<string>();
    for (let i = 0; i < job.steps.length; i++) {
      const step = job.steps[i];
      if (step.id) {
        if (stepIds.has(step.id)) {
          diagnostics.push({
            severity: 'error',
            message: `Duplicate step ID "${step.id}" in job "${jobId}"`,
            path: `jobs.${jobId}.steps[${i}].id`,
          });
        }
        stepIds.add(step.id);
      }
    }
  }

  // Check for circular dependencies using the shared dependency graph
  try {
    const graph = buildDependencyGraph(workflow);
    const cycle = detectCycle(graph);
    if (cycle.length > 0) {
      diagnostics.push({
        severity: 'error',
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        path: 'jobs',
      });
    }
  } catch (e) {
    // buildDependencyGraph throws DependencyError for unknown job references,
    // which are already reported by the needs-validation above.
    if (!(e instanceof DependencyError)) {
      throw e;
    }
  }

  return diagnostics;
}

