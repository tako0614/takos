import { describe, expect, it } from 'vitest';
import { AppDeploymentService } from '@/services/platform/app-deployments';

const removedMessage = /App deployment API is not available in the current implementation|Legacy bundle deployment pipeline has been removed/;

describe('AppDeploymentService', () => {
  const service = new AppDeploymentService({} as never);

  it.each([
    ['deployFromRepoRef', () => service.deployFromRepoRef('space-1', 'user-1', { repoId: 'repo-1', ref: 'main' })],
    ['list', () => service.list('space-1')],
    ['get', () => service.get('space-1', 'appdep-1')],
    ['remove', () => service.remove('space-1', 'appdep-1')],
    ['rollback', () => service.rollback('space-1', 'user-1', 'appdep-1')],
  ] as const)('%s rejects as removed', async (_name, call) => {
    await expect(call()).rejects.toThrow(removedMessage);
  });
});
