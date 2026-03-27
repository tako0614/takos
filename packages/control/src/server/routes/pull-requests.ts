import pullRequestsBase from './pull-requests/base';
import pullRequestsReviews from './pull-requests/reviews';
import pullRequestsComments from './pull-requests/comments';
import type { AuthenticatedRouteEnv } from './shared/route-auth';
import { Hono } from 'hono';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', pullRequestsBase)
  .route('/', pullRequestsReviews)
  .route('/', pullRequestsComments);
