import pullRequestsBase from './routes.ts';
import pullRequestsMerge from './merge-handlers.ts';
import pullRequestsReviews from './reviews.ts';
import pullRequestsComments from './comments.ts';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import { Hono } from 'hono';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', pullRequestsBase)
  .route('/', pullRequestsMerge)
  .route('/', pullRequestsReviews)
  .route('/', pullRequestsComments);
