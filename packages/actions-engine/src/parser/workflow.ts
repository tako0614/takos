/**
 * YAML workflow parser
 */
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import type {
  Workflow,
  ParsedWorkflow,
  WorkflowDiagnostic,
  WorkflowTrigger,
} from '../types.js';
import { normalizeNeedsInput } from '../scheduler/job.js';

/**
 * Error thrown when workflow parsing fails
 */
export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: WorkflowDiagnostic[]
  ) {
    super(message);
    this.name = 'WorkflowParseError';
  }
}

/**
 * Normalize workflow trigger from various formats
 */
function normalizeTrigger(on: unknown): WorkflowTrigger {
  // String format: on: push
  if (typeof on === 'string') {
    return { [on]: null } as WorkflowTrigger;
  }

  // Array format: on: [push, pull_request]
  if (Array.isArray(on)) {
    const trigger: Record<string, unknown> = {};
    for (const event of on) {
      if (typeof event === 'string') {
        trigger[event] = null;
      }
    }
    return trigger as WorkflowTrigger;
  }

  // Object format: on: { push: { branches: [...] } }
  if (typeof on === 'object' && on !== null) {
    return on as WorkflowTrigger;
  }

  return {};
}

/**
 * Normalize workflow structure
 */
function normalizeWorkflow(raw: unknown): Workflow {
  if (typeof raw !== 'object' || raw === null) {
    throw new WorkflowParseError('Workflow must be an object', [
      { severity: 'error', message: 'Workflow must be an object' },
    ]);
  }

  const obj = raw as Record<string, unknown>;

  // Normalize 'on' trigger
  const on = normalizeTrigger(obj.on);

  // Normalize jobs
  const jobs: Workflow['jobs'] = {};
  const rawJobs = obj.jobs;
  if (typeof rawJobs === 'object' && rawJobs !== null) {
    for (const [jobId, job] of Object.entries(
      rawJobs as Record<string, unknown>
    )) {
      if (typeof job !== 'object' || job === null) {
        continue;
      }
      const jobObj = job as Record<string, unknown>;
      const normalizedNeeds = normalizeNeedsInput(jobObj.needs);
      jobs[jobId] = {
        ...jobObj,
        needs: normalizedNeeds.length > 0 ? normalizedNeeds : undefined,
        steps: Array.isArray(jobObj.steps) ? jobObj.steps : [],
      } as Workflow['jobs'][string];
    }
  }

  return {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    on,
    env:
      typeof obj.env === 'object' && obj.env !== null
        ? (obj.env as Record<string, string>)
        : undefined,
    jobs,
    permissions: obj.permissions as Workflow['permissions'],
    concurrency: obj.concurrency as Workflow['concurrency'],
    defaults: obj.defaults as Workflow['defaults'],
  };
}

/**
 * Parse YAML workflow content
 *
 * @param content - YAML content string
 * @returns Parsed workflow with diagnostics
 */
export function parseWorkflow(content: string): ParsedWorkflow {
  const diagnostics: WorkflowDiagnostic[] = [];

  try {
    const parsed = parseYaml(content, {
      strict: false,
      uniqueKeys: true,
    });

    const workflow = normalizeWorkflow(parsed);

    return {
      workflow,
      diagnostics,
    };
  } catch (error) {
    if (error instanceof YAMLParseError) {
      diagnostics.push({
        severity: 'error',
        message: error.message,
        line: error.linePos?.[0]?.line,
        column: error.linePos?.[0]?.col,
      });
    } else if (error instanceof WorkflowParseError) {
      diagnostics.push(...error.diagnostics);
    } else if (error instanceof Error) {
      diagnostics.push({
        severity: 'error',
        message: error.message,
      });
    } else {
      diagnostics.push({
        severity: 'error',
        message: 'Unknown parse error',
      });
    }

    throw new WorkflowParseError('Failed to parse workflow', diagnostics);
  }
}

/**
 * Parse workflow from file path (for Node.js environments)
 *
 * @param filePath - Path to workflow file
 * @returns Parsed workflow
 */
export async function parseWorkflowFile(
  filePath: string
): Promise<ParsedWorkflow> {
  // Dynamic import for Node.js fs
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(filePath, 'utf-8');
  return parseWorkflow(content);
}

/**
 * Stringify workflow back to YAML
 *
 * @param workflow - Workflow object
 * @returns YAML string
 */
export function stringifyWorkflow(workflow: Workflow): string {
  return stringifyYaml(workflow, {
    indent: 2,
    lineWidth: 0,
  });
}
