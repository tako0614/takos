import { Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import * as fs from "node:fs/promises";
import { ALLOWED_COMMANDS_SET, SANDBOX_LIMITS } from "../../shared/config.ts";
import { runCommand } from "../../runtime/command.ts";
import {
  createSandboxEnv,
  validateRuntimeExecEnv,
} from "../../utils/sandbox-env.ts";
import { pushLog } from "../../runtime/logging.ts";
import {
  resolvePathWithin,
  verifyNoSymlinkPathComponents,
  verifyPathWithinAfterAccess,
  verifyPathWithinBeforeCreate,
} from "../../runtime/paths.ts";
import { writeFileWithinSpace } from "../../runtime/secure-fs.ts";
import {
  isValidSessionId,
  validateCommandLine,
} from "../../runtime/validation.ts";
import { sessionStore } from "./storage.ts";
import { getErrorMessage } from "takos-common/errors";
import { writeAuditLog } from "../../utils/audit-log.ts";
import {
  getOwnerSubFromServiceContext,
  getSessionOwnerSub,
  parseRequiredSessionSpaceIds,
  resolveSessionWorkDir,
} from "./session-utils.ts";
import {
  badRequest,
  forbidden,
  internalError,
} from "takos-common/middleware/hono";
import {
  isBoundaryViolationError,
  OwnerBindingError,
} from "../../shared/errors.ts";
import {
  hasSpaceScopeMismatch,
  SPACE_SCOPE_MISMATCH_ERROR,
} from "../../middleware/space-scope.ts";
import { Buffer } from "node:buffer";

const app = new Hono<RuntimeEnv>();

// ---------------------------------------------------------------------------
// exec
// ---------------------------------------------------------------------------

app.post("/session/exec", async (c) => {
  const execStartTime = Date.now();
  const body = await c.req.json() as {
    session_id: string;
    space_id: string;
    commands: string[];
    working_dir?: string;
    env?: Record<string, string>;
  };

  function buildAuditEntry(
    extra: {
      exitCode?: number;
      durationMs?: number;
      status: "started" | "completed" | "failed";
      error?: string;
    },
  ): import("../../utils/audit-log.ts").AuditEntry {
    return {
      timestamp: new Date().toISOString(),
      event: "session_exec",
      spaceId: body.space_id || "unknown",
      sessionId: body.session_id,
      commands: body.commands,
      ip: c.req.header("x-forwarded-for") || "unknown",
      requestId: c.get("requestId"),
      ...extra,
    };
  }

  try {
    const ids = parseRequiredSessionSpaceIds(body);
    const { commands, working_dir, env } = body;

    if (!ids || !commands || commands.length === 0) {
      return badRequest(c, "session_id, space_id, and commands required");
    }

    const { sessionId: session_id, spaceId: space_id } = ids;

    if (hasSpaceScopeMismatch(c, space_id)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }
    const ownerSub = getSessionOwnerSub(c);

    void writeAuditLog(buildAuditEntry({ status: "started" }));

    const workDir = await sessionStore.getSessionDir(
      session_id,
      space_id,
      ownerSub,
    );
    const execDir = working_dir
      ? resolvePathWithin(workDir, working_dir, "working_dir", true)
      : workDir;

    await verifyNoSymlinkPathComponents(workDir, execDir, "working_dir");
    await verifyPathWithinBeforeCreate(workDir, execDir, "working_dir");
    await fs.mkdir(execDir, { recursive: true });
    await verifyPathWithinAfterAccess(workDir, execDir, "working_dir");

    const logs: string[] = [];
    let lastExitCode = 0;

    const validatedEnvResult = validateRuntimeExecEnv(env);
    if (validatedEnvResult.ok === false) {
      pushLog(logs, `Error: ${validatedEnvResult.error}`);
      return badRequest(c, "Invalid environment variables", {
        output: logs.join("\n"),
      });
    }
    const sandboxEnv = createSandboxEnv(
      validatedEnvResult.env,
      SANDBOX_LIMITS.maxEnvValueLength,
    );

    for (const cmd of commands) {
      const trimmedCmd = cmd.trim();
      try {
        validateCommandLine(trimmedCmd);
      } catch (err) {
        const message = getErrorMessage(err);
        pushLog(logs, `Error: ${message}`);
        return badRequest(c, message);
      }

      const parts = trimmedCmd.split(/\s+/);
      const command = parts[0];
      const args = parts.slice(1);

      pushLog(logs, `$ ${trimmedCmd}`);

      if (!ALLOWED_COMMANDS_SET.has(command)) {
        pushLog(logs, `Error: Command not allowed: ${command}`);
        return badRequest(c, `Command not allowed: ${command}`);
      }

      try {
        const exitCode = await runCommand(command, args, {
          cwd: execDir,
          logs,
          env: sandboxEnv,
        });
        lastExitCode = exitCode;
        if (exitCode !== 0) {
          pushLog(logs, `Command exited with code ${exitCode}`);
        }
      } catch (err) {
        const sanitizedError = getErrorMessage(err);
        const cleanError = sanitizedError.replace(
          /([A-Za-z]:)?[/\\][\w./\\-]+/g,
          "[path]",
        );
        pushLog(logs, `Error: ${cleanError}`);
        lastExitCode = 1;
        break;
      }
    }

    void writeAuditLog(buildAuditEntry({
      exitCode: lastExitCode,
      durationMs: Date.now() - execStartTime,
      status: lastExitCode === 0 ? "completed" : "failed",
    }));

    return c.json({
      success: lastExitCode === 0,
      exit_code: lastExitCode,
      output: logs.join("\n"),
    });
  } catch (err) {
    const message = getErrorMessage(err);

    if (err instanceof OwnerBindingError) {
      return forbidden(c, message);
    }
    if (isBoundaryViolationError(err)) {
      return forbidden(c, "Path escapes workspace boundary");
    }

    void writeAuditLog(buildAuditEntry({
      durationMs: Date.now() - execStartTime,
      status: "failed",
      error: message,
    }));

    c.get("log")?.error("Session exec error", { error: err as Error });
    return internalError(
      c,
      "An internal error occurred while executing the command",
    );
  }
});

// ---------------------------------------------------------------------------
// lifecycle: init + destroy
// ---------------------------------------------------------------------------

app.post("/session/init", async (c) => {
  try {
    const body = await c.req.json() as {
      session_id: string;
      space_id: string;
      files?: Array<
        {
          path: string;
          content: string;
          encoding?: "utf-8" | "base64";
          is_binary?: boolean;
        }
      >;
    };
    const { files } = body;

    const session = await resolveSessionWorkDir(c, body);
    if ("error" in session) return session.error;
    const { sessionId: session_id, workDir } = session;

    let fileCount = 0;
    const writtenFiles: string[] = [];

    if (files && files.length > 0) {
      try {
        for (const file of files) {
          const filePath = resolvePathWithin(workDir, file.path, "file");

          const isBinary = file.encoding === "base64" || file.is_binary;
          if (isBinary) {
            await writeFileWithinSpace(
              workDir,
              filePath,
              Buffer.from(file.content, "base64"),
            );
          } else {
            await writeFileWithinSpace(
              workDir,
              filePath,
              file.content,
              "utf-8",
            );
          }

          await verifyPathWithinAfterAccess(workDir, filePath, "file");
          writtenFiles.push(filePath);
          fileCount++;
        }
      } catch (writeErr) {
        // Best-effort cleanup of already-written files
        for (const writtenFile of writtenFiles) {
          try {
            await fs.unlink(writtenFile);
          } catch (cleanupErr) {
            c.get("log")?.warn(
              "Failed to cleanup written file after session init failure",
              {
                file: writtenFile,
                error: cleanupErr as Error,
              },
            );
          }
        }
        throw writeErr;
      }
    }

    return c.json({
      success: true,
      session_id,
      work_dir: workDir,
      files_written: fileCount,
    });
  } catch (err) {
    if (err instanceof OwnerBindingError) {
      return forbidden(c, (err as Error).message);
    }
    c.get("log")?.error("Session init error", { error: err as Error });
    return internalError(c, "Session initialization failed");
  }
});

app.post("/session/destroy", async (c) => {
  try {
    const { session_id, space_id } = await c.req.json() as {
      session_id: string;
      space_id?: string;
    };

    if (!session_id) {
      return badRequest(c, "session_id required");
    }
    if (!isValidSessionId(session_id)) {
      return badRequest(c, "Invalid session_id");
    }

    const payload = c.get("serviceToken");
    const authMethod = c.get("serviceAuthMethod");
    const ownerSub = getOwnerSubFromServiceContext(payload);

    // When a JWT carries a space scope, enforce it
    const scopedSpaceId = authMethod === "jwt" && payload
      ? payload.scope_space_id as string | undefined
      : undefined;

    if (typeof scopedSpaceId === "string") {
      if (space_id && hasSpaceScopeMismatch(c, space_id)) {
        return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
      }
      await sessionStore.destroySession(session_id, scopedSpaceId, ownerSub);
    } else {
      await sessionStore.destroySession(session_id, undefined, ownerSub);
    }

    return c.json({ success: true });
  } catch (err) {
    if (err instanceof OwnerBindingError) {
      return forbidden(c, (err as Error).message);
    }
    c.get("log")?.error("Session destroy error", { error: err as Error });
    return internalError(c, "Session destruction failed");
  }
});

export default app;
