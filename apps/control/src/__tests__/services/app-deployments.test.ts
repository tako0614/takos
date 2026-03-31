import { AppDeploymentService } from '@/services/platform/app-deployments';

import { assertRejects } from 'jsr:@std/assert';

const removedMessage = /App deployment API is not available in the current implementation|Legacy bundle deployment pipeline has been removed/;

const service = new AppDeploymentService({} as never);

for (const [name, call] of [
  ['deployFromRepoRef', () => service.deployFromRepoRef('space-1', 'user-1', { repoId: 'repo-1', ref: 'main' })],
  ['list', () => service.list('space-1')],
  ['get', () => service.get('space-1', 'appdep-1')],
  ['remove', () => service.remove('space-1', 'appdep-1')],
  ['rollback', () => service.rollback('space-1', 'user-1', 'appdep-1')],
] as const) {
  Deno.test(`${name} rejects as removed`, async () => {
    await assertRejects(async () => { await call(); }, removedMessage);
  });
}
