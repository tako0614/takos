/**
 * File Tool Helpers.
 *
 * Shared setup and response handling for file tool handlers.
 * Eliminates duplicated initialization and error checking across
 * read, write, delete, list, and other file handlers.
 *
 * Every file handler repeats the same three-step preamble:
 *   1. `resolveMountPath(context, args.repo_id, args.mount_path)`
 *   2. `buildSessionPath(mountPath, args.path)`
 *   3. `requireContainer(context)`
 *
 * `setupFileOperation` collapses that into a single call that returns
 * a validated {@link FileOperationContext}.
 */

import type { ToolContext } from '../../types';
import { buildSessionPath, requireContainer, resolveMountPath } from './session';

/**
 * Pre-validated context returned after common file operation setup.
 *
 * - `path`      — fully resolved session-relative path (mount + relative).
 * - `mountPath` — the resolved mount root for the active repo / mount arg.
 * - `sessionId` — the container session ID (guaranteed non-empty after setup).
 */
export interface FileOperationContext {
  /** Fully resolved path inside the session (mountPath + relative path). */
  path: string;
  /** Resolved mount root for the current session repository. */
  mountPath: string;
  /** Container session ID (guaranteed present after setup). */
  sessionId: string;
}

/**
 * Common setup for all file operations.
 *
 * Validates context, resolves mount path, builds the session path,
 * and ensures a container is running. Throws if any precondition fails.
 *
 * @param args    — raw tool arguments (expects `path`, optional `repo_id` and `mount_path`).
 * @param context — current tool execution context.
 * @returns a validated {@link FileOperationContext}.
 *
 * @example
 * ```ts
 * const fileCtx = await setupFileOperation(args, context);
 * const response = await callSessionApi(context, '/session/file/read', {
 *   path: fileCtx.path,
 * });
 * ```
 */
export async function setupFileOperation(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<FileOperationContext> {
  const mountPath = await resolveMountPath(
    context,
    args.repo_id as string | undefined,
    args.mount_path as string | undefined,
  );

  const rawPath = (args.path as string) || '';
  const path = buildSessionPath(mountPath, rawPath);

  requireContainer(context);

  return {
    path,
    mountPath,
    // requireContainer throws when sessionId is missing, so this is safe.
    sessionId: context.sessionId!,
  };
}

/**
 * Handle a session API response with consistent error formatting.
 *
 * Parses the JSON body on success, or extracts an error message on failure
 * and throws a descriptive `Error`.
 *
 * @param response  — the `Response` from `callSessionApi`.
 * @param operation — human-readable operation name for error messages
 *                    (e.g. `"read file"`, `"delete file"`).
 * @returns the parsed JSON body of type `T`.
 *
 * @example
 * ```ts
 * const result = await handleSessionApiResponse<{ content: string }>(
 *   response,
 *   'read file',
 * );
 * ```
 */
export async function handleSessionApiResponse<T = unknown>(
  response: Response,
  operation: string,
): Promise<T> {
  if (!response.ok) {
    let errorMessage: string;
    try {
      const body = (await response.json()) as { error?: string };
      errorMessage =
        body.error || `${operation} failed with status ${response.status}`;
    } catch {
      errorMessage = `${operation} failed with status ${response.status}`;
    }
    throw new Error(errorMessage);
  }
  return response.json() as Promise<T>;
}
