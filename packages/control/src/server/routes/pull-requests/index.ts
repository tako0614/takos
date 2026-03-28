import pullRequestsBase from './routes';
import pullRequestsMerge from './merge-handlers';
import pullRequestsReviews from './reviews';
import pullRequestsComments from './comments';
import type { AuthenticatedRouteEnv } from '../route-auth';
import { Hono } from 'hono';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', pullRequestsBase)
  .route('/', pullRequestsMerge)
  .route('/', pullRequestsReviews)
  .route('/', pullRequestsComments);
