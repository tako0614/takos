import * as gitStore from '../../../application/services/git-smart';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';

export type GitBucket = Parameters<typeof gitStore.getBlob>[0];

export function toGitBucket(
  bucket: NonNullable<AuthenticatedRouteEnv['Bindings']['GIT_OBJECTS']>,
): GitBucket {
  return bucket as unknown as GitBucket;
}
