import { Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import * as fs from "node:fs/promises";
import {
  type ExecutorStepResult,
  StepExecutor,
} from "../../runtime/actions/executor.ts";
import { SANDBOX_LIMITS } from "../../shared/config.ts";
import {
  mightExposeSecrets,
  shouldBlockForSecretExposure,
} from "../../runtime/actions/secrets.ts";
import { pushLog } from "../../runtime/logging.ts";
import { cloneAndCheckout } from "../../runtime/git.ts";
import { resolvePathWithin } from "../../runtime/paths.ts";
import { GIT_ENDPOINT_URL } from "../../shared/config.ts";
import { collectSensitiveEnvValues } from "../../runtime/actions/secrets.ts";
import {
  hasSpaceScopeMismatch,
  SPACE_SCOPE_MISMATCH_ERROR,
} from "../../middleware/space-scope.ts";

interface ExecuteStepRequest {
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  name?: string;
  shell?: string;
  "working-directory"?: string;
  "continue-on-error"?: boolean;
  "timeout-minutes"?: number;
}
import {
  jobManager,
  sanitizeOutputs,
} from "../../runtime/actions/job-manager.ts";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
} from "takos-common/middleware/hono";

const app = new Hono<RuntimeEnv>();

// ---------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------

app.post("/actions/jobs/:jobId/checkout", async (c) => {
  const jobId = c.req.param("jobId");
  const { repoUrl, ref, path: checkoutPath } = await c.req.json() as {
    repoUrl?: string;
    ref?: string;
    path?: string;
  };

  try {
    const job = jobManager.jobs.get(jobId);
    if (!job || job.status !== "running") {
      return notFound(c, "Job not found or not running");
    }
    if (hasSpaceScopeMismatch(c, job.spaceId)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }

    const targetPath = checkoutPath
      ? resolvePathWithin(
        job.workspacePath,
        checkoutPath,
        "checkout path",
        true,
      )
      : job.workspacePath;

    await fs.mkdir(targetPath, { recursive: true });

    pushLog(job.logs, `Checking out repository...`);

    // Validate repoUrl to prevent SSRF — only allow the configured git endpoint or default
    if (repoUrl && !repoUrl.startsWith(GIT_ENDPOINT_URL)) {
      return badRequest(
        c,
        "Invalid repoUrl: must use the configured git endpoint",
      );
    }
    const gitUrl = repoUrl || `${GIT_ENDPOINT_URL}/${job.repoId}.git`;
    const gitRef = ref || job.ref;
    const cloneResult = await cloneAndCheckout({
      repoUrl: gitUrl,
      targetDir: targetPath,
      ref: gitRef,
      shallow: true,
      env: job.env,
    });

    if (!cloneResult.success) {
      pushLog(job.logs, `Checkout failed: ${cloneResult.output}`);
      return internalError(c, "Checkout failed", {
        output: cloneResult.output,
      });
    }

    pushLog(job.logs, "Checkout completed successfully");

    return c.json({
      success: true,
      path: targetPath,
    });
  } catch (err) {
    c.get("log")?.error("Error during checkout", { jobId, error: err });
    return internalError(c, "Checkout failed");
  }
});

// ---------------------------------------------------------------------------
// step execution
// ---------------------------------------------------------------------------

app.post("/actions/jobs/:jobId/step/:stepNumber", async (c) => {
  const jobId = c.req.param("jobId");
  const stepNumber = c.req.param("stepNumber");
  const body = (await c.req.json().catch(() => ({}))) as ExecuteStepRequest;

  try {
    const job = jobManager.jobs.get(jobId);
    if (!job || job.status !== "running") {
      return notFound(c, "Job not found or not running");
    }
    if (hasSpaceScopeMismatch(c, job.spaceId)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }

    const stepNum = parseInt(stepNumber, 10);
    if (!Number.isFinite(stepNum) || stepNum < 0) {
      return badRequest(c, "Invalid step number");
    }

    const elapsedMs = Date.now() - job.startedAt;
    const remainingBudgetMs = SANDBOX_LIMITS.maxJobDuration - elapsedMs;
    if (remainingBudgetMs <= 0) {
      await jobManager.failCloseJob(
        jobId,
        job,
        `Job exceeded max duration (${SANDBOX_LIMITS.maxJobDuration}ms)`,
      );
      // 408 Request Timeout — common envelope shape
      return c.json({
        error: {
          code: "GATEWAY_TIMEOUT",
          message: "Job exceeded maximum duration",
          details: { elapsedMs, maxDurationMs: SANDBOX_LIMITS.maxJobDuration },
        },
      }, 408);
    }

    const stepEnv = {
      ...job.env,
      ...body.env,
    };

    for (const [key, value] of Object.entries(job.secrets)) {
      stepEnv[`GITHUB_SECRET_${key}`] = value;
    }

    const sensitiveStepValues = collectSensitiveEnvValues(stepEnv);
    if (sensitiveStepValues.length > 0) {
      job.secretsSanitizer.registerSecretValues(sensitiveStepValues);
    }

    const stepName = body.name || `Step ${stepNum}`;
    pushLog(job.logs, `\n=== ${stepName} ===`, job.secretsSanitizer);

    const workingDirectory = body["working-directory"]
      ? resolvePathWithin(
        job.workspacePath,
        body["working-directory"],
        "working directory",
        true,
      )
      : job.workspacePath;
    const executor = new StepExecutor(job.workspacePath, stepEnv);

    const requestedTimeoutMs = body["timeout-minutes"]
      ? body["timeout-minutes"] * 60 * 1000
      : SANDBOX_LIMITS.maxExecutionTime;
    const timeoutMs = Math.max(
      1,
      Math.min(
        requestedTimeoutMs,
        SANDBOX_LIMITS.maxExecutionTime,
        remainingBudgetMs,
      ),
    );

    let result: ExecutorStepResult;

    if (body.run) {
      // Block commands that would dump all environment variables (secrets included)
      if (shouldBlockForSecretExposure(body.run)) {
        const reason = mightExposeSecrets(body.run);
        pushLog(
          job.logs,
          `[SECURITY] Command blocked: ${reason ?? "may expose secrets"}`,
          job.secretsSanitizer,
        );
        return badRequest(
          c,
          `Command blocked for security: ${
            reason ?? "may expose environment secrets"
          }`,
        );
      }

      pushLog(
        job.logs,
        `Run: ${body.run.substring(0, 100)}${
          body.run.length > 100 ? "..." : ""
        }`,
        job.secretsSanitizer,
      );
      result = await executor.executeRun(body.run, timeoutMs, {
        shell: body.shell,
        workingDirectory,
      });
    } else if (body.uses) {
      pushLog(job.logs, `Uses: ${body.uses}`, job.secretsSanitizer);
      result = await executor.executeAction(
        body.uses,
        (body.with || {}) as Record<string, unknown>,
        timeoutMs,
      );
    } else {
      return badRequest(c, 'Step must have either "run" or "uses"');
    }

    const sanitizedStdout = job.secretsSanitizer.sanitize(result.stdout);
    const sanitizedStderr = job.secretsSanitizer.sanitize(result.stderr);

    if (sanitizedStdout) {
      for (const line of sanitizedStdout.split("\n")) {
        pushLog(job.logs, line, job.secretsSanitizer);
      }
    }
    if (sanitizedStderr) {
      for (const line of sanitizedStderr.split("\n")) {
        pushLog(job.logs, `[stderr] ${line}`, job.secretsSanitizer);
      }
    }

    const continueOnError = body["continue-on-error"] === true;
    const { conclusion } = result;

    if (conclusion === "failure" && !continueOnError) {
      pushLog(
        job.logs,
        `Step failed with exit code ${result.exitCode}`,
        job.secretsSanitizer,
      );
    } else if (conclusion === "failure" && continueOnError) {
      pushLog(
        job.logs,
        `Step failed but continuing (continue-on-error: true)`,
        job.secretsSanitizer,
      );
    } else {
      pushLog(job.logs, `Step completed successfully`, job.secretsSanitizer);
    }

    const sanitizedOutputsMap = sanitizeOutputs(
      result.outputs,
      job.secretsSanitizer,
    );
    for (const [key, value] of Object.entries(sanitizedOutputsMap)) {
      job.outputs[`step_${stepNum}_${key}`] = value;
    }

    job.currentStep = stepNum + 1;

    return c.json({
      exitCode: result.exitCode,
      stdout: sanitizedStdout,
      stderr: sanitizedStderr,
      outputs: sanitizedOutputsMap,
      conclusion: continueOnError && conclusion === "failure"
        ? "success"
        : conclusion,
    });
  } catch (err) {
    c.get("log")?.error("Error executing step", {
      jobId,
      stepNumber,
      error: err,
    });
    return internalError(c, "Step execution failed");
  }
});

export default app;
