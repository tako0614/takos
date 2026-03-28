import pullRequestsBase from './routes';
import pullRequestsReviews from './reviews';
import pullRequestsComments from './comments';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { Hono } from 'hono';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', pullRequestsBase)
  .route('/', pullRequestsReviews)
  .route('/', pullRequestsComments);
