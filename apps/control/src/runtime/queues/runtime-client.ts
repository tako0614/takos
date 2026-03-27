/**
 * Runtime Client -- Typed HTTP client for runtime communication.
 *
 * Consolidates `runtimeJson()` and `runtimeDelete()` patterns from
 * workflow-runtime-client.ts into a cohesive client interface.
 *
 * Both functions follow the same pattern:
 * 1. Build a request body with `space_id` injected
 * 2. Call `callRuntimeRequest(env, endpoint, { method, body })`
 * 3. Parse the response (JSON for runtimeJson, void for runtimeDelete)
 * 4. Throw on non-OK status (except 404 for delete)
 *
 * This class wraps those patterns with typed convenience methods.
 */

import type { WorkflowQueueEnv } from '@/queues/workflow-types';
import { callRuntimeRequest } from '@/services/execution/runtime';
import { logWarn } from '@/shared/utils/logger';

/**
 * Typed HTTP client for communicating with the runtime host.
 *
 * Encapsulates the `runtimeJson` and `runtimeDelete` helper functions
 * from workflow-runtime-client.ts behind a class interface with typed convenience
 * methods for common operations (start/complete/delete jobs).
 *
 * @example
 * ```ts
 * const client = new RuntimeClient(env);
 *
 * // Start a job
 * await client.startJob(jobId, workspaceId, {
 *   runId, repoId, ref, sha,
 *   workflowPath, jobName, steps, env: jobEnv, secrets,
 * });
 *
 * // Complete a job
 * await client.completeJob(jobId, workspaceId, 'success');
 *
 * // Delete a job
 * await client.deleteJob(jobId, workspaceId);
 * ```
 */
export class RuntimeClient {
  private env: WorkflowQueueEnv;

  constructor(env: WorkflowQueueEnv) {
    this.env = env;
  }

  /**
   * Send a JSON request to the runtime host and return the parsed response.
   *
   * Mirrors `runtimeJson()` from workflow-runtime-client.ts:
   * - Injects `space_id` into the request body
   * - Delegates to `callRuntimeRequest`
   * - Throws on non-OK responses with the error text
   *
   * @param path - The endpoint path (e.g. `/actions/jobs/{jobId}/start`)
   * @param workspaceId - The workspace/space ID to scope the request
   * @param body - Optional request body (space_id is added automatically)
   * @param method - HTTP method, defaults to `'POST'`
   * @returns The parsed JSON response
   */
  async json<T = unknown>(
    path: string,
    workspaceId: string,
    body?: Record<string, unknown>,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  ): Promise<T> {
    const requestBody = {
      ...(body || {}),
      space_id: workspaceId,
    };
    const response = await callRuntimeRequest(this.env, path, { method, body: requestBody });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Runtime request failed (${response.status}): ${errorText || response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  /**
   * Send a DELETE request to the runtime host.
   *
   * Mirrors `runtimeDelete()` from workflow-runtime-client.ts:
   * - Injects `space_id` into the request body
   * - Delegates to `callRuntimeRequest` with `DELETE` method
   * - Swallows errors and 404 responses (logs a warning instead)
   *
   * @param path - The endpoint path (e.g. `/actions/jobs/{jobId}`)
   * @param workspaceId - The workspace/space ID to scope the request
   */
  async delete(path: string, workspaceId: string): Promise<void> {
    try {
      const response = await callRuntimeRequest(this.env, path, {
        method: 'DELETE',
        body: { space_id: workspaceId },
      });
      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        throw new Error(`Runtime delete failed (${response.status}): ${errorText || response.statusText}`);
      }
    } catch (err) {
      logWarn(`Failed to delete runtime job (${path})`, { module: 'queues/workflow-jobs', detail: err });
    }
  }

  /**
   * Start a job on the runtime host.
   *
   * @param jobId - The job ID
   * @param workspaceId - The workspace/space ID
   * @param params - Job start parameters (runId, repoId, ref, sha, steps, etc.)
   */
  async startJob(jobId: string, workspaceId: string, params: Record<string, unknown>): Promise<void> {
    await this.json(`/actions/jobs/${jobId}/start`, workspaceId, params);
  }

  /**
   * Complete a job on the runtime host.
   *
   * @param jobId - The job ID
   * @param workspaceId - The workspace/space ID
   * @param conclusion - The job conclusion (e.g. `'success'`, `'failure'`, `'cancelled'`)
   */
  async completeJob(jobId: string, workspaceId: string, conclusion: string): Promise<void> {
    await this.json(`/actions/jobs/${jobId}/complete`, workspaceId, {
      conclusion,
      uploadLogs: false,
    });
  }

  /**
   * Delete a job from the runtime host.
   *
   * @param jobId - The job ID
   * @param workspaceId - The workspace/space ID
   */
  async deleteJob(jobId: string, workspaceId: string): Promise<void> {
    await this.delete(`/actions/jobs/${jobId}`, workspaceId);
  }
}
