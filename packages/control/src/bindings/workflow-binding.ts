/**
 * Non-Cloudflare implementation of the Workflow binding.
 *
 * Stores workflow instance state in the database (D1/PostgreSQL).
 * This provides the API surface for `env.MY_WORKFLOW.create()` and
 * instance lifecycle methods. Actual step execution is NOT implemented
 * in this adapter — instances are created with status 'queued' and
 * must be processed by an external runner.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowInstance {
  id: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  terminate(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<WorkflowInstanceStatus>;
}

export interface WorkflowInstanceStatus {
  status: 'queued' | 'running' | 'paused' | 'completed' | 'errored' | 'terminated';
  output?: unknown;
  error?: string;
}

export interface WorkflowBinding {
  create(options?: { id?: string; params?: unknown }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

// Minimal DB interface (compatible with D1Database and PostgreSQL adapter)
interface DbLike {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export type WorkflowBindingConfig = {
  db: DbLike;
  serviceId: string;
  workflowName: string;
};

export function createWorkflowBinding(config: WorkflowBindingConfig): WorkflowBinding {
  const { db, serviceId, workflowName } = config;

  function makeInstance(id: string): WorkflowInstance {
    return {
      id,
      async pause() {
        await db.prepare(
          'UPDATE tenant_workflow_instances SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
        ).bind('paused', new Date().toISOString(), id, 'running').run();
      },
      async resume() {
        await db.prepare(
          'UPDATE tenant_workflow_instances SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
        ).bind('queued', new Date().toISOString(), id, 'paused').run();
      },
      async terminate() {
        await db.prepare(
          'UPDATE tenant_workflow_instances SET status = ?, updated_at = ? WHERE id = ?',
        ).bind('terminated', new Date().toISOString(), id).run();
      },
      async restart() {
        await db.prepare(
          'UPDATE tenant_workflow_instances SET status = ?, output = NULL, error = NULL, updated_at = ? WHERE id = ?',
        ).bind('queued', new Date().toISOString(), id).run();
      },
      async status(): Promise<WorkflowInstanceStatus> {
        const row = await db.prepare(
          'SELECT status, output, error FROM tenant_workflow_instances WHERE id = ?',
        ).bind(id).first<{ status: string; output: string | null; error: string | null }>();

        if (!row) {
          throw new Error(`Workflow instance ${id} not found`);
        }

        return {
          status: row.status as WorkflowInstanceStatus['status'],
          ...(row.output ? { output: JSON.parse(row.output) } : {}),
          ...(row.error ? { error: row.error } : {}),
        };
      },
    };
  }

  return {
    async create(options?: { id?: string; params?: unknown }): Promise<WorkflowInstance> {
      const id = options?.id ?? crypto.randomUUID();
      const now = new Date().toISOString();

      await db.prepare(
        'INSERT INTO tenant_workflow_instances (id, service_id, workflow_name, params, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        id,
        serviceId,
        workflowName,
        options?.params !== undefined ? JSON.stringify(options.params) : null,
        'queued',
        now,
        now,
      ).run();

      return makeInstance(id);
    },

    async get(id: string): Promise<WorkflowInstance> {
      const row = await db.prepare(
        'SELECT id FROM tenant_workflow_instances WHERE id = ?',
      ).bind(id).first<{ id: string }>();

      if (!row) {
        throw new Error(`Workflow instance ${id} not found`);
      }

      return makeInstance(id);
    },
  };
}
