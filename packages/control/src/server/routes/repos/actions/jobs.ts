import { Hono } from "hono";
import { z } from "zod";
import { checkRepoAccess } from "../../../../application/services/source/repos.ts";
import type { AuthenticatedRouteEnv } from "../../route-auth.ts";
import { getDb } from "../../../../infra/db/index.ts";
import {
  workflowJobs,
  workflowRuns,
  workflowSteps,
} from "../../../../infra/db/schema.ts";
import { and, asc, eq } from "drizzle-orm";
import { zValidator } from "../../zod-validator.ts";
import { LogsNotFoundError, parseLogRange, readJobLogs } from "./logs.ts";
import { logError } from "../../../../shared/utils/logger.ts";
import { InternalError, NotFoundError } from "takos-common/errors";

export default new Hono<AuthenticatedRouteEnv>()
  .get("/repos/:repoId/actions/jobs/:jobId", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const jobId = c.req.param("jobId");
    const db = getDb(c.env.DB);

    const repoAccess = await checkRepoAccess(
      c.env,
      repoId,
      user?.id,
      undefined,
      { allowPublicRead: true },
    );
    if (!repoAccess) {
      throw new NotFoundError("Repository");
    }

    // Join workflowJobs with workflowRuns to filter by repoId
    const jobResult = await db.select({
      id: workflowJobs.id,
      runId: workflowJobs.runId,
      name: workflowJobs.name,
      status: workflowJobs.status,
      conclusion: workflowJobs.conclusion,
      runnerName: workflowJobs.runnerName,
      startedAt: workflowJobs.startedAt,
      completedAt: workflowJobs.completedAt,
      logsR2Key: workflowJobs.logsR2Key,
    })
      .from(workflowJobs)
      .innerJoin(workflowRuns, eq(workflowJobs.runId, workflowRuns.id))
      .where(and(
        eq(workflowJobs.id, jobId),
        eq(workflowRuns.repoId, repoId),
      ))
      .get();

    if (!jobResult) {
      throw new NotFoundError("Job");
    }

    const steps = await db.select().from(workflowSteps)
      .where(eq(workflowSteps.jobId, jobId))
      .orderBy(asc(workflowSteps.number))
      .all();

    return c.json({
      job: {
        id: jobResult.id,
        run_id: jobResult.runId,
        name: jobResult.name,
        status: jobResult.status,
        conclusion: jobResult.conclusion,
        runner_name: jobResult.runnerName,
        started_at: jobResult.startedAt,
        completed_at: jobResult.completedAt,
        steps: steps.map((s) => ({
          number: s.number,
          name: s.name,
          status: s.status,
          conclusion: s.conclusion,
          exit_code: s.exitCode,
          error_message: s.errorMessage,
          started_at: s.startedAt,
          completed_at: s.completedAt,
        })),
      },
    });
  })
  .get(
    "/repos/:repoId/actions/jobs/:jobId/logs",
    zValidator(
      "query",
      z.object({
        offset: z.string().optional(),
        limit: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const repoId = c.req.param("repoId");
      const jobId = c.req.param("jobId");
      const { offset, limit } = c.req.valid("query");
      const range = parseLogRange(offset, limit);

      const repoAccess = await checkRepoAccess(
        c.env,
        repoId,
        user?.id,
        undefined,
        { allowPublicRead: true },
      );
      if (!repoAccess) {
        throw new NotFoundError("Repository");
      }

      const db = getDb(c.env.DB);

      // Join workflowJobs with workflowRuns to filter by repoId
      const job = await db.select({
        id: workflowJobs.id,
        logsR2Key: workflowJobs.logsR2Key,
      })
        .from(workflowJobs)
        .innerJoin(workflowRuns, eq(workflowJobs.runId, workflowRuns.id))
        .where(and(
          eq(workflowJobs.id, jobId),
          eq(workflowRuns.repoId, repoId),
        ))
        .get();

      if (!job) {
        throw new NotFoundError("Job");
      }

      if (!job.logsR2Key) {
        throw new NotFoundError("Logs");
      }

      const bucket = c.env.GIT_OBJECTS;
      if (!bucket) {
        throw new InternalError("Storage not configured");
      }

      try {
        const result = await readJobLogs(bucket, job.logsR2Key, range);
        return c.json({
          logs: result.logs,
          job_id: jobId,
          offset: result.offset,
          next_offset: result.next_offset,
          has_more: result.has_more,
          total_size: result.total_size,
        });
      } catch (err) {
        logError("Failed to read job logs", err, {
          module: "routes/repos/actions/jobs",
        });
        if (err instanceof LogsNotFoundError) {
          throw new NotFoundError("Logs");
        }
        throw new InternalError("Failed to read logs");
      }
    },
  );
