import type { Context } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth';
import type { RepoAccess } from '../../../application/services/source/repos';
import { type PullRequestWorkflowEvent } from '../../../application/services/actions';
/** Trigger the PR workflow event using common repo-access fields. */
export declare function triggerPrEvent(c: Context<AuthenticatedRouteEnv>, repoAccess: RepoAccess, actorId: string, event: PullRequestWorkflowEvent): void;
//# sourceMappingURL=workflow-trigger.d.ts.map