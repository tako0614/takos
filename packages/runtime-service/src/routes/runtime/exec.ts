import { Hono } from 'hono';
import type { RuntimeEnv } from '../../types/hono.d.ts';
import {
  MAX_EXEC_COMMANDS,
  MAX_EXEC_FILE_BYTES,
  MAX_EXEC_FILES,
  MAX_EXEC_OUTPUTS,
  MAX_EXEC_TOTAL_BYTES,
} from '../../shared/config.ts';
import { writeAuditLog, type AuditEntry } from '../../utils/audit-log.ts';
import { badRequest, forbidden, internalError, notFound } from 'takos-common/middleware/hono';
import { ErrorCodes } from 'takos-common/errors';
import { createLogger } from 'takos-common/logger';
import { hasSpaceScopeMismatch, SPACE_SCOPE_MISMATCH_ERROR } from '../../middleware/space-scope.ts';
import { validateRuntimeExecEnv } from '../../utils/sandbox-env.ts';

import { Buffer } from "node:buffer";
import {
  type ExecInput,
  getProcess,
  isSpaceConcurrencyExceeded,
  ensureProcessCapacity,
  sanitizeErrorMessage,
  runExec,
} from '../../runtime/exec-runner.ts';

const logger = createLogger({ service: 'takos-runtime' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fireAuditLog(entry: AuditEntry): void {
  void writeAuditLog(entry).catch((err: unknown) => logger.error('[audit] writeAuditLog failed', { error: err }));
}

/**
 * Validate the exec request body. Returns an error string if invalid, null if valid.
 */
function validateExecBody(body: ExecInput): string | null {
  if (!body.space_id || !body.commands || body.commands.length === 0) {
    return 'Missing required fields: space_id, commands';
  }
  if (body.commands.length > MAX_EXEC_COMMANDS) {
    return `Too many commands (max ${MAX_EXEC_COMMANDS})`;
  }
  if (body.files && body.files.length > MAX_EXEC_FILES) {
    return `Too many files (max ${MAX_EXEC_FILES})`;
  }
  if (body.return_outputs && body.return_outputs.length > MAX_EXEC_OUTPUTS) {
    return `Too many output files requested (max ${MAX_EXEC_OUTPUTS})`;
  }
  if (body.files && body.files.length > 0) {
    let totalBytes = 0;
    for (const file of body.files) {
      const bytes = Buffer.byteLength(file.content ?? '', 'utf-8');
      if (bytes > MAX_EXEC_FILE_BYTES) {
        return `File too large: ${file.path}`;
      }
      totalBytes += bytes;
      if (totalBytes > MAX_EXEC_TOTAL_BYTES) {
        return 'Total file size exceeded';
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono<RuntimeEnv>();

app.post('/exec', async (c) => {
  const execStartTime = Date.now();
  try {
    const body = await c.req.json() as ExecInput;

    const validationError = validateExecBody(body);
    if (validationError) {
      return badRequest(c, validationError);
    }

    if (hasSpaceScopeMismatch(c, body.space_id)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }

    // Validate user-supplied environment variables
    if (body.env) {
      const envValidation = validateRuntimeExecEnv(body.env as Record<string, string> | undefined);
      if (envValidation.ok === false) {
        return badRequest(c, envValidation.error);
      }
    }

    const auditBase: Omit<AuditEntry, 'timestamp' | 'status'> = {
      event: 'exec',
      spaceId: body.space_id,
      commands: body.commands,
      ip: c.req.header('x-forwarded-for') || 'unknown',
      requestId: c.get('requestId'),
    };

    fireAuditLog({ ...auditBase, timestamp: new Date().toISOString(), status: 'started' });

    if (isSpaceConcurrencyExceeded(body.space_id)) {
      return c.json({ error: { code: ErrorCodes.RATE_LIMITED, message: 'Space concurrency limit reached (max concurrent executions)' } }, 429);
    }

    if (!ensureProcessCapacity()) {
      return c.json({ error: { code: ErrorCodes.SERVICE_UNAVAILABLE, message: 'Server at capacity. Please try again later.' } }, 503);
    }

    const result = await runExec(body);

    fireAuditLog({
      ...auditBase,
      timestamp: new Date().toISOString(),
      exitCode: result.exit_code,
      durationMs: Date.now() - execStartTime,
      status: result.status === 'completed' ? 'completed' : 'failed',
      error: result.error,
    });

    return c.json(result);
  } catch (err) {
    c.get('log')?.error('Exec error', { error: err });
    return internalError(c, sanitizeErrorMessage(err));
  }
});

app.get('/status/:id', (c) => {
  const proc = getProcess(c.req.param('id'));

  if (!proc) {
    return notFound(c, 'Process not found');
  }

  return c.json({
    runtime_id: proc.id,
    status: proc.status,
    output: proc.output,
    error: proc.error,
    exit_code: proc.exit_code,
  });
});

export default app;
