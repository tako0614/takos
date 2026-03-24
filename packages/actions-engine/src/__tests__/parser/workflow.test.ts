import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Workflow } from '../../types.js';
import { validateWorkflow } from '../../parser/validator.js';
import { parseWorkflow, parseWorkflowFile, stringifyWorkflow } from '../../parser/workflow.js';

describe('workflow validation', () => {
  it('reports unknown dependency diagnostics for string and array needs inputs', () => {
    const workflows: Workflow[] = [
      {
        on: 'push',
        jobs: {
          setup: {
            'runs-on': 'ubuntu-latest',
            steps: [{ run: 'echo setup' }],
          },
          deploy: {
            'runs-on': 'ubuntu-latest',
            needs: 'missing-job',
            steps: [{ run: 'echo deploy' }],
          },
        },
      },
      {
        on: 'push',
        jobs: {
          setup: {
            'runs-on': 'ubuntu-latest',
            steps: [{ run: 'echo setup' }],
          },
          deploy: {
            'runs-on': 'ubuntu-latest',
            needs: ['setup', 'missing-job'],
            steps: [{ run: 'echo deploy' }],
          },
        },
      },
    ];

    for (const workflow of workflows) {
      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.diagnostics).toContainEqual({
        severity: 'error',
        message: 'Job "deploy" references unknown job "missing-job" in needs',
        path: 'jobs.deploy.needs',
      });
    }
  });

  it('reports duplicate step id diagnostics', () => {
    const workflow: Workflow = {
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [
            { id: 'duplicate', run: 'echo first' },
            { id: 'duplicate', run: 'echo second' },
          ],
        },
      },
    };

    const result = validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('Duplicate step ID'),
        path: 'jobs.build.steps[1].id',
      })
    );
  });
});

describe('workflow parser', () => {
  it('normalizes string trigger and needs field while preserving workflow structure', () => {
    const yaml = [
      'name: sample',
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    needs: setup',
      '    steps:',
      '      - run: echo build',
      '  setup:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo setup',
    ].join('\n');

    const parsed = parseWorkflow(yaml);

    expect(parsed.workflow.on).toEqual({ push: null });
    expect(parsed.workflow.jobs.build.needs).toEqual(['setup']);
    expect(parsed.workflow.jobs.build.steps).toHaveLength(1);
  });

  it('roundtrips workflow objects through stringifyWorkflow and parseWorkflow', () => {
    const workflow: Workflow = {
      name: 'roundtrip',
      on: { push: null },
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'echo build' }],
        },
      },
    };

    const yaml = stringifyWorkflow(workflow);
    const parsed = parseWorkflow(yaml);

    expect(parsed.workflow.name).toBe('roundtrip');
    expect(parsed.workflow.jobs.build.steps[0]?.run).toBe('echo build');
    expect(parsed.workflow.on).toEqual({ push: null });
  });

  it('parses workflow files from disk', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'actions-engine-workflow-'));
    const filePath = join(tempDir, 'workflow.yml');
    const yaml = [
      'on: [push, pull_request]',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo test',
    ].join('\n');

    try {
      await writeFile(filePath, yaml, 'utf8');
      const parsed = await parseWorkflowFile(filePath);

      expect(parsed.workflow.on).toEqual({
        push: null,
        pull_request: null,
      });
      expect(parsed.workflow.jobs.test.steps[0]?.run).toBe('echo test');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
