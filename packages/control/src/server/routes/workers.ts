import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from './shared/helpers';
import workersBase from './workers/base';
import workersDeployments from './workers/deployments';
import workersSettings from './workers/settings';
import workersSlug from './workers/slug';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', workersBase)
  .route('/', workersDeployments)
  .route('/', workersSettings)
  .route('/', workersSlug);
