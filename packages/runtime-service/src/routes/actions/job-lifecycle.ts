import { Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SANDBOX_LIMITS } from "../../shared/config.ts";
import { createSandboxEnv } from "../../utils/sandbox-env.ts";
import { createSecretsSanitizer } from "../../runtime/actions/secrets.ts";
import { pushLog } from "../../runtime/logging.ts";
import { isR2Configured, s3Client } from "../../storage/r2.ts";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { R2_BUCKET } from "../../shared/config.ts";
import {
  getScopedSpaceId,
  hasSpaceScopeMismatch,
  SPACE_SCOPE_MISMATCH_ERROR,
} from "../../middleware/space-scope.ts";
import {
  jobManager,
  removeJobDirSafe,
} from "../../runtime/actions/job-manager.ts";
import type { ActiveJob } from "../../runtime/actions/job-manager.ts";
import { collectSensitiveEnvValues } from "../../runtime/actions/secrets.ts";
import type { StartJobRequest } from "./action-types.ts";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
} from "takos-common/middleware/hono";
import { ErrorCodes } from "takos-common/errors";

const app = new Hono<RuntimeEnv>();

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

app.post("/actions/jobs/:jobId/start", async (c) => {
  const jobId = c.req.param("jobId");
  const body = await c.req.json() as StartJobRequest | undefined;

  try {
    if (body?.space_id !== undefined) {
      if (typeof body.space_id !== "string" || body.space_id.length === 0) {
        return badRequest(
          c,
          "space_id must be a non-empty string when provided",
        );
      }
    }

    const scopedSpaceId = getScopedSpaceId(c);
    if (scopedSpaceId && !body?.space_id) {
      return badRequest(c, "space_id is required for space-scoped token");
    }
    if (hasSpaceScopeMismatch(c, body?.space_id)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }

    if (!body || !body.repoId || !body.ref || !body.sha) {
      return badRequest(c, "Missing required fields: repoId, ref, sha");
    }

    if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
      return badRequest(c, "Missing or invalid steps array");
    }
    if (body.steps.length > SANDBOX_LIMITS.maxStepsPerJob) {
      return badRequest(
        c,
        `Steps exceed per-job limit (max ${SANDBOX_LIMITS.maxStepsPerJob})`,
      );
    }

    if (jobManager.jobs.has(jobId)) {
      return c.json({
        error: { code: ErrorCodes.CONFLICT, message: "Job already exists" },
      }, 409);
    }

    const jobSpaceId = body.space_id ?? scopedSpaceId ??
      "__unspecified_workspace__";

    const startCheck = jobManager.canStartJob(jobSpaceId);
    if (!startCheck.allowed) {
      return c.json({
        error: {
          code: ErrorCodes.RATE_LIMITED,
          message: startCheck.reason ??
            `Concurrent job limit reached (max ${SANDBOX_LIMITS.maxConcurrentJobs})`,
        },
      }, 429);
    }

    const workspacePath = path.join(
      os.tmpdir(),
      `takos-actions-${jobId.slice(0, 8)}-${Date.now()}`,
    );
    await fs.mkdir(workspacePath, { recursive: true });

    const logs: string[] = [];
    pushLog(logs, `Starting job: ${body.jobName || jobId}`);
    pushLog(logs, `Repository: ${body.repoId}`);
    pushLog(logs, `Ref: ${body.ref} (${body.sha})`);

    const baseEnv = createSandboxEnv({
      ...body.env,
      GITHUB_ACTIONS: "true",
      CI: "true",
      GITHUB_WORKSPACE: workspacePath,
      GITHUB_REPOSITORY: body.repoId,
      GITHUB_REF: body.ref,
      GITHUB_SHA: body.sha,
      GITHUB_JOB: body.jobName || jobId,
      GITHUB_RUN_ID: jobId,
      GITHUB_WORKFLOW: body.workflowPath,
    }, SANDBOX_LIMITS.maxEnvValueLength);

    const secretsSanitizer = createSecretsSanitizer(
      body.secrets || {},
      collectSensitiveEnvValues(body.env),
    );

    const job: ActiveJob = {
      id: jobId,
      spaceId: jobSpaceId,
      repoId: body.repoId,
      ref: body.ref,
      sha: body.sha,
      workflowPath: body.workflowPath,
      jobName: body.jobName || jobId,
      workspacePath,
      status: "running",
      steps: body.steps,
      env: baseEnv,
      secrets: body.secrets || {},
      secretsSanitizer,
      logs,
      currentStep: 0,
      startedAt: Date.now(),
      outputs: {},
    };

    jobManager.jobs.set(jobId, job);

    pushLog(logs, "Job directory created successfully");
    pushLog(logs, `Working path: ${workspacePath}`);

    return c.json({
      jobId,
      status: "running",
      workspacePath,
      message: "Job started successfully",
    });
  } catch (err) {
    c.get("log")?.error("Error starting job", { jobId, error: err });
    return internalError(c, "Failed to start job");
  }
});

app.post("/actions/jobs/:jobId/complete", async (c) => {
  const jobId = c.req.param("jobId");
  const { conclusion, uploadLogs } = await c.req.json() as {
    conclusion?: "success" | "failure" | "cancelled";
    uploadLogs?: boolean;
  };

  try {
    const job = jobManager.jobs.get(jobId);
    if (!job) return notFound(c, "Job not found");
    if (hasSpaceScopeMismatch(c, job.spaceId)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }

    job.status = conclusion === "success" ? "completed" : "failed";
    job.conclusion = conclusion || "success";
    job.completedAt = Date.now();

    pushLog(job.logs, `\n=== Job ${job.conclusion} ===`, job.secretsSanitizer);
    pushLog(
      job.logs,
      `Duration: ${(job.completedAt - job.startedAt) / 1000}s`,
      job.secretsSanitizer,
    );

    let logsUrl: string | undefined;
    if (uploadLogs && isR2Configured()) {
      try {
        const logsKey = `actions/jobs/${jobId}/logs.txt`;
        const sanitizedLogs = job.secretsSanitizer.sanitizeLogs(job.logs);
        await s3Client.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: logsKey,
            Body: sanitizedLogs.join("\n"),
            ContentType: "text/plain",
            Metadata: {
              "job-id": jobId,
              "conclusion": job.conclusion,
              "completed-at": new Date(job.completedAt).toISOString(),
            },
          }),
        );
        logsUrl = logsKey;
        pushLog(
          job.logs,
          `Logs uploaded to R2: ${logsKey}`,
          job.secretsSanitizer,
        );
      } catch (uploadErr) {
        c.get("log")?.error("Failed to upload logs", {
          jobId,
          error: uploadErr,
        });
      }
    }

    try {
      await fs.rm(job.workspacePath, { recursive: true, force: true });
      pushLog(job.logs, "Job directory cleaned up", job.secretsSanitizer);
    } catch {
      c.get("log")?.warn("Failed to cleanup job directory", { jobId });
    }

    const response = {
      jobId,
      status: job.status,
      conclusion: job.conclusion,
      duration: (job.completedAt - job.startedAt) / 1000,
      outputs: job.outputs,
      logsUrl,
    };

    jobManager.scheduleJobCleanup(jobId);

    return c.json(response);
  } catch (err) {
    c.get("log")?.error("Error completing job", { jobId, error: err });
    return internalError(c, "Failed to complete job");
  }
});

// ---------------------------------------------------------------------------
// Job cancellation
// ---------------------------------------------------------------------------

app.delete("/actions/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");

  try {
    const job = jobManager.jobs.get(jobId);
    if (!job) return notFound(c, "Job not found");
    if (hasSpaceScopeMismatch(c, job.spaceId)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }

    job.status = "failed";
    job.conclusion = "cancelled";
    job.completedAt = Date.now();

    pushLog(job.logs, "\n=== Job cancelled ===", job.secretsSanitizer);

    job.secretsSanitizer.clear();

    await removeJobDirSafe(job.workspacePath, jobId, "cancelled job");

    jobManager.jobs.delete(jobId);

    return c.json({
      jobId,
      status: "cancelled",
      message: "Job cancelled and cleaned up",
    });
  } catch (err) {
    c.get("log")?.error("Error cancelling job", { jobId, error: err });
    return internalError(c, "Failed to cancel job");
  }
});

export default app;
