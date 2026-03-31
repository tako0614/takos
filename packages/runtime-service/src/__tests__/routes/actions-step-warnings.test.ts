import { createTestApp, testRequest } from '../setup.ts';

import { assertEquals, assert, assertObjectMatch } from 'jsr:@std/assert';

{
  Deno.env.set('TAKOS_API_URL', 'https://takos.example.test');
};

const { executeRunMock, executeActionMock, capturedStepEnvs } = ({
  executeRunMock: ((..._args: any[]) => undefined) as any,
  executeActionMock: ((..._args: any[]) => undefined) as any,
  capturedStepEnvs: [] as Array<Record<string, string>>,
});

// [Deno] vi.mock removed - manually stub imports from '../../runtime/actions/executor.ts'
import actionsRoutes from '../../routes/actions/index.ts';


  Deno.test('actions step behavior - keeps secrets masked for printenv-like commands without custom warnings field', async () => {
  executeRunMock = (async () => ({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    })) as any;
    executeActionMock = (async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    })) as any;
    capturedStepEnvs.length = 0;
  const app = createTestApp();
    app.route('/', actionsRoutes);

    executeRunMock = (async () => ({
      exitCode: 0,
      stdout: 'token=s3cr3t',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    })) as any;

    const jobId = `step-mask-${Date.now()}`;

    try {
      const startResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/start`,
        body: {
          space_id: 'workspace-step-mask',
          repoId: 'acme/repo',
          ref: 'refs/heads/main',
          sha: 'a'.repeat(40),
          workflowPath: '.takos/workflows/ci.yml',
          jobName: 'mask-job',
          secrets: {
            TOKEN: 's3cr3t',
          },
          steps: [{ name: 'step-1', run: 'echo hello' }],
        },
      });

      assertEquals(startResponse.status, 200);

      const stepResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/step/0`,
        body: {
          name: 'step-1',
          run: 'echo hello',
        },
      });

      assertEquals(stepResponse.status, 200);
      assertObjectMatch(stepResponse.body, {
        conclusion: 'success',
        stdout: 'token=***',
      });
      assert(!('warnings' in stepResponse.body));

      const logsResponse = await testRequest(app, {
        method: 'GET',
        path: `/actions/jobs/${jobId}/logs`,
      });
      const logsBody = logsResponse.body as { logs: string[] };
      assertEquals(logsResponse.status, 200);
      assertEquals(logsBody.logs.some((line) => line.includes('token=***')), true);
      assertEquals(logsBody.logs.some((line) => line.includes('s3cr3t')), false);
    } finally {
      await testRequest(app, {
        method: 'DELETE',
        path: `/actions/jobs/${jobId}`,
      });
    }
})
  Deno.test('actions step behavior - always sets GITHUB_RUN_ID to jobId', async () => {
  executeRunMock = (async () => ({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    })) as any;
    executeActionMock = (async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    })) as any;
    capturedStepEnvs.length = 0;
  const app = createTestApp();
    app.route('/', actionsRoutes);

    const jobId = `with-run-id-${Date.now()}`;

    try {
      const startResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/start`,
        body: {
          space_id: 'workspace-run-id',
          repoId: 'acme/repo',
          ref: 'refs/heads/main',
          sha: 'a'.repeat(40),
          workflowPath: '.takos/workflows/ci.yml',
          jobName: 'run-id-job',
          steps: [{ name: 'step-1', run: 'echo hello' }],
        },
      });
      assertEquals(startResponse.status, 200);

      const stepResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/step/0`,
        body: {
          name: 'step-1',
          run: 'echo hello',
        },
      });

      assertEquals(stepResponse.status, 200);
      assertEquals(capturedStepEnvs.at(-1)?.GITHUB_RUN_ID, jobId);
    } finally {
      await testRequest(app, {
        method: 'DELETE',
        path: `/actions/jobs/${jobId}`,
      });
    }
})
  Deno.test('actions step behavior - falls back to jobId for GITHUB_RUN_ID when runId is omitted', async () => {
  executeRunMock = (async () => ({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    })) as any;
    executeActionMock = (async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    })) as any;
    capturedStepEnvs.length = 0;
  const app = createTestApp();
    app.route('/', actionsRoutes);

    const jobId = `fallback-run-id-${Date.now()}`;

    try {
      const startResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/start`,
        body: {
          space_id: 'workspace-run-id-fallback',
          repoId: 'acme/repo',
          ref: 'refs/heads/main',
          sha: 'a'.repeat(40),
          workflowPath: '.takos/workflows/ci.yml',
          jobName: 'fallback-run-id-job',
          steps: [{ name: 'step-1', run: 'echo hello' }],
        },
      });
      assertEquals(startResponse.status, 200);

      const stepResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/step/0`,
        body: {
          name: 'step-1',
          run: 'echo hello',
        },
      });

      assertEquals(stepResponse.status, 200);
      assertEquals(capturedStepEnvs.at(-1)?.GITHUB_RUN_ID, jobId);
    } finally {
      await testRequest(app, {
        method: 'DELETE',
        path: `/actions/jobs/${jobId}`,
      });
    }
})