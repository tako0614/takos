import { createTestApp, testRequest } from '../setup.ts';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';

{
  Deno.env.set('TAKOS_API_URL', 'https://takos.example.test');
};

import actionsRoutes from '../../routes/actions/index.ts';
import { SANDBOX_LIMITS } from '../../shared/config.ts';

function createStartBody(jobName: string, spaceId: string, stepCount = 1) {
  return {
    space_id: spaceId,
    repoId: 'acme/repo',
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    workflowPath: '.takos/workflows/ci.yml',
    jobName,
    steps: Array.from({ length: stepCount }, (_, i) => ({
      name: `noop-${i + 1}`,
      run: 'echo hello',
    })),
  };
}


  Deno.test('actions start step limits - rejects start when step count exceeds maxStepsPerJob', async () => {
  const app = createTestApp();
    app.route('/', actionsRoutes);

    const jobId = `steps-over-limit-${Date.now()}`;
    const response = await testRequest(app, {
      method: 'POST',
      path: `/actions/jobs/${jobId}/start`,
      body: createStartBody(
        'over-limit',
        'workspace-step-limit',
        SANDBOX_LIMITS.maxStepsPerJob + 1,
      ),
    });

    assertEquals(response.status, 400);
    assertEquals(response.body, {
      error: {
        code: 'BAD_REQUEST',
        message: `Steps exceed per-job limit (max ${SANDBOX_LIMITS.maxStepsPerJob})`,
      },
    });
})
  Deno.test('actions start step limits - accepts start when step count equals maxStepsPerJob', async () => {
  const app = createTestApp();
    app.route('/', actionsRoutes);

    const jobId = `steps-at-limit-${Date.now()}`;

    try {
      const response = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/start`,
        body: createStartBody(
          'at-limit',
          'workspace-step-limit',
          SANDBOX_LIMITS.maxStepsPerJob,
        ),
      });

      assertEquals(response.status, 200);
      assertObjectMatch(response.body, {
        jobId,
        status: 'running',
        message: 'Job started successfully',
      });
    } finally {
      await testRequest(app, {
        method: 'DELETE',
        path: `/actions/jobs/${jobId}`,
      });
    }
})

  Deno.test('actions start concurrency limits - applies maxConcurrentJobs per workspace', async () => {
  const app = createTestApp();
    app.route('/', actionsRoutes);

    const startedJobIds: string[] = [];
    const prefix = `concurrency-${Date.now()}`;
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';

    try {
      for (let i = 0; i < SANDBOX_LIMITS.maxConcurrentJobs; i++) {
        const jobId = `${prefix}-${i}`;
        const response = await testRequest(app, {
          method: 'POST',
          path: `/actions/jobs/${jobId}/start`,
          body: createStartBody(`job-${i}`, workspaceA),
        });

        assertEquals(response.status, 200);
        startedJobIds.push(jobId);
      }

      const otherWorkspaceJobId = `${prefix}-other-workspace`;
      const otherWorkspaceResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${otherWorkspaceJobId}/start`,
        body: createStartBody('job-other-workspace', workspaceB),
      });

      assertEquals(otherWorkspaceResponse.status, 200);
      startedJobIds.push(otherWorkspaceJobId);

      const overflowJobId = `${prefix}-overflow`;
      const overflowResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${overflowJobId}/start`,
        body: createStartBody('overflow-job', workspaceA),
      });

      assertEquals(overflowResponse.status, 429);
      assertEquals(overflowResponse.body, {
        error: {
          code: 'RATE_LIMITED',
          message: `Concurrent job limit reached (max ${SANDBOX_LIMITS.maxConcurrentJobs})`,
        },
      });
    } finally {
      for (const jobId of startedJobIds) {
        await testRequest(app, {
          method: 'DELETE',
          path: `/actions/jobs/${jobId}`,
        });
      }
    }
})