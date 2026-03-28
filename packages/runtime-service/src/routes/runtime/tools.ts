import { Hono } from 'hono';
import { Worker } from 'worker_threads';
import { existsSync } from 'fs';
import path from 'path';
import { TOOL_NAME_PATTERN, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from '../../shared/config.js';
import { getWorkerResourceLimits } from '../../runtime/validation.js';
import { getErrorMessage } from 'takos-common/errors';
import { badRequest } from 'takos-common/middleware/hono';
import { createLogger } from 'takos-common/logger';
const logger = createLogger({ service: 'takos-runtime' });

interface ExecuteToolRequest {
  code: string;
  toolName: string;
  parameters: Record<string, unknown>;
  secrets: Record<string, string>;
  config: Record<string, unknown>;
  permissions: {
    allowedDomains: string[];
    filePermission: 'read' | 'write' | 'none';
  };
  timeout?: number;
  maxMemory?: number;
}

interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
}

function resolveWorkerPath(): string {
  const jsPath = path.join(__dirname, '../../runtime/tools/worker.js');
  return existsSync(jsPath) ? jsPath : path.join(__dirname, '../../runtime/tools/worker.ts');
}

const app = new Hono();

app.post('/execute-tool', async (c) => {
  const startTime = Date.now();
  const body = await c.req.json() as ExecuteToolRequest;

  if (!body.code || !body.toolName) {
    return badRequest(c, 'Missing required fields: code, toolName');
  }

  if (!TOOL_NAME_PATTERN.test(body.toolName)) {
    return badRequest(c, 'Invalid toolName format');
  }

  const timeout = Math.min(body.timeout || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  try {
    const result = await new Promise<ToolResult>((resolve, reject) => {
      const worker = new Worker(resolveWorkerPath(), {
        execArgv: process.execArgv,
        resourceLimits: getWorkerResourceLimits(body.maxMemory),
      });
      let settled = false;

      const hardTimeout = setTimeout(() => {
        settle(() => reject(new Error(`Execution timed out after ${timeout}ms`)));
      }, timeout + 1_000 /* hard timeout margin */);

      function settle(action: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimeout);
        // Await termination to ensure clean resource cleanup
        worker.terminate().catch((err) => { logger.warn('Worker terminate failed (non-critical)', { module: 'runtime/tools', error: err }); });
        action();
      }

      worker.on('message', (message) => {
        settle(() => resolve(message as ToolResult));
      });

      worker.on('error', (err) => {
        settle(() => reject(err));
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          settle(() => reject(new Error(`Tool worker exited with code ${code}`)));
        }
      });

      worker.postMessage({
        code: body.code,
        toolName: body.toolName,
        parameters: body.parameters,
        secrets: body.secrets,
        config: body.config,
        allowedDomains: body.permissions?.allowedDomains || [],
        timeout,
      });
    });

    return c.json({
      ...result,
      executionTime: result.executionTime || Date.now() - startTime,
    });
  } catch (err) {
    return c.json({
      error: getErrorMessage(err),
      output: '',
      executionTime: Date.now() - startTime,
    });
  }
});

export default app;
