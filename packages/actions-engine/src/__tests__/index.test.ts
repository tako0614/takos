import { describe, expect, it } from 'vitest';

import { JobScheduler } from '../scheduler/job.js';
import { createBaseContext } from '../context.js';
import type { Workflow } from '../types.js';

describe('JobScheduler', () => {
  it('resets scheduler state across repeated runs and preserves listeners', async () => {
    const workflow: Workflow = {
      name: 'runner-reset',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: '${{ env.BUILD_COMMAND }}' }],
        },
        deploy: {
          'runs-on': 'ubuntu-latest',
          needs: 'build',
          steps: [{ run: 'echo deploy=ok' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow);
    const lifecycleEvents: string[] = [];
    scheduler.on((event) => {
      if (event.type === 'workflow:start' || event.type === 'workflow:complete') {
        lifecycleEvents.push(event.type);
      }
    });

    const firstContext = createBaseContext({
      env: { BUILD_COMMAND: 'exit 1' },
    });
    const firstResults = await scheduler.run(firstContext);
    expect(firstResults.build.conclusion).toBe('failure');
    expect(firstResults.deploy.conclusion).toBe('cancelled');
    expect(scheduler.getConclusion()).toBe('failure');

    const secondContext = createBaseContext({
      env: { BUILD_COMMAND: 'echo build=ok' },
    });
    const secondResults = await scheduler.run(secondContext);
    expect(secondResults.build.conclusion).toBe('success');
    expect(secondResults.deploy.conclusion).toBe('success');
    expect(scheduler.getConclusion()).toBe('success');
    expect(lifecycleEvents).toEqual([
      'workflow:start',
      'workflow:complete',
      'workflow:start',
      'workflow:complete',
    ]);
  });
});
