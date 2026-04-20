import { Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  TOOL_NAME_PATTERN,
} from "../../shared/config.ts";
import { getWorkerResourceLimits } from "../../runtime/validation.ts";
import { getErrorMessage } from "takos-common/errors";
import { badRequest, internalError } from "takos-common/middleware/hono";
import { createLogger } from "takos-common/logger";
import { parseFilePermission } from "../../runtime/tools/permissions.ts";
const logger = createLogger({ service: "takos-runtime" });

interface ExecuteToolRequest {
  code: string;
  toolName: string;
  parameters: Record<string, unknown>;
  secrets: Record<string, string>;
  config: Record<string, unknown>;
  permissions: {
    allowedDomains: string[];
    filePermission: "read" | "write" | "none";
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

export interface ToolWorkerMessage {
  code: string;
  toolName: string;
  parameters: Record<string, unknown>;
  secrets: Record<string, string>;
  config: Record<string, unknown>;
  allowedDomains: string[];
  filePermission: "read" | "write" | "none";
  timeout: number;
}

function resolveWorkerPath(): string {
  const baseDir = typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));
  const jsPath = path.join(baseDir, "../../runtime/tools/worker.js");
  return existsSync(jsPath)
    ? jsPath
    : path.join(baseDir, "../../runtime/tools/worker.ts");
}

export function buildToolWorkerMessage(
  body: ExecuteToolRequest,
  timeout: number,
): ToolWorkerMessage {
  return {
    code: body.code,
    toolName: body.toolName,
    parameters: body.parameters,
    secrets: body.secrets,
    config: body.config,
    allowedDomains: body.permissions?.allowedDomains || [],
    filePermission: parseFilePermission(body.permissions?.filePermission),
    timeout,
  };
}

const app = new Hono<RuntimeEnv>();

app.post("/execute-tool", async (c) => {
  const startTime = Date.now();
  const body = await c.req.json() as ExecuteToolRequest;

  if (!body.code || !body.toolName) {
    return badRequest(c, "Missing required fields: code, toolName");
  }

  if (!TOOL_NAME_PATTERN.test(body.toolName)) {
    return badRequest(c, "Invalid toolName format");
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
        settle(() =>
          reject(new Error(`Execution timed out after ${timeout}ms`))
        );
      }, timeout + 1_000 /* hard timeout margin */);

      function settle(action: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimeout);
        // Await termination to ensure clean resource cleanup
        worker.terminate().catch((err) => {
          logger.warn("Worker terminate failed (non-critical)", {
            module: "runtime/tools",
            error: err,
          });
        });
        action();
      }

      worker.on("message", (message) => {
        settle(() => resolve(message as ToolResult));
      });

      worker.on("error", (err) => {
        settle(() => reject(err));
      });

      worker.on("exit", (code) => {
        if (code !== 0) {
          settle(() =>
            reject(new Error(`Tool worker exited with code ${code}`))
          );
        }
      });

      worker.postMessage(buildToolWorkerMessage(body, timeout));
    });

    if (!result.success) {
      return internalError(c, result.error ?? "Tool execution failed");
    }

    return c.json({
      ...result,
      executionTime: result.executionTime || Date.now() - startTime,
    });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

export default app;
