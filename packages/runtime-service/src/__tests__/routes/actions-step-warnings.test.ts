import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, testRequest } from '../setup.js';

vi.hoisted(() => {
  process.env.TAKOS_API_URL = 'https://takos.example.test';
});

const { executeRunMock, executeActionMock, capturedStepEnvs } = vi.hoisted(() => ({
  executeRunMock: vi.fn(),
  executeActionMock: vi.fn(),
  capturedStepEnvs: [] as Array<Record<string, string>>,
}));

vi.mock('../../runtime/actions/executor.js', () => ({
  StepExecutor: class {
    constructor(_workspacePath: string, env: Record<string, string>) {
      capturedStepEnvs.push(env);
    }

    executeRun = executeRunMock;

    executeAction = executeActionMock;
  },
}));

import actionsRoutes from '../../routes/actions/index.js';

describe('actions step behavior', () => {
  beforeEach(() => {
    executeRunMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    });
    executeActionMock.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    });
    capturedStepEnvs.length = 0;
  });

  it('keeps secrets masked for printenv-like commands without custom warnings field', async () => {
    const app = createTestApp();
    app.route('/', actionsRoutes);

    executeRunMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'token=s3cr3t',
      stderr: '',
      outputs: {},
      conclusion: 'success',
    });

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

      expect(startResponse.status).toBe(200);

      const stepResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/step/0`,
        body: {
          name: 'step-1',
          run: 'echo hello',
        },
      });

      expect(stepResponse.status).toBe(200);
      expect(stepResponse.body).toMatchObject({
        conclusion: 'success',
        stdout: 'token=***',
      });
      expect(stepResponse.body).not.toHaveProperty('warnings');

      const logsResponse = await testRequest(app, {
        method: 'GET',
        path: `/actions/jobs/${jobId}/logs`,
      });
      const logsBody = logsResponse.body as { logs: string[] };
      expect(logsResponse.status).toBe(200);
      expect(logsBody.logs.some((line) => line.includes('token=***'))).toBe(true);
      expect(logsBody.logs.some((line) => line.includes('s3cr3t'))).toBe(false);
    } finally {
      await testRequest(app, {
        method: 'DELETE',
        path: `/actions/jobs/${jobId}`,
      });
    }
  });

  it('always sets GITHUB_RUN_ID to jobId', async () => {
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
      expect(startResponse.status).toBe(200);

      const stepResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/step/0`,
        body: {
          name: 'step-1',
          run: 'echo hello',
        },
      });

      expect(stepResponse.status).toBe(200);
      expect(capturedStepEnvs.at(-1)?.GITHUB_RUN_ID).toBe(jobId);
    } finally {
      await testRequest(app, {
        method: 'DELETE',
        path: `/actions/jobs/${jobId}`,
      });
    }
  });

  it('falls back to jobId for GITHUB_RUN_ID when runId is omitted', async () => {
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
      expect(startResponse.status).toBe(200);

      const stepResponse = await testRequest(app, {
        method: 'POST',
        path: `/actions/jobs/${jobId}/step/0`,
        body: {
          name: 'step-1',
          run: 'echo hello',
        },
      });

      expect(stepResponse.status).toBe(200);
      expect(capturedStepEnvs.at(-1)?.GITHUB_RUN_ID).toBe(jobId);
    } finally {
      await testRequest(app, {
        method: 'DELETE',
        path: `/actions/jobs/${jobId}`,
      });
    }
  });
});
