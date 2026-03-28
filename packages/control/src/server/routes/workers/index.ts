import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth';
import workersBase from './routes';
import workersDeployments from './deployments';
import workersSettings from './settings';
import workersSlug from './slug';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', workersBase)
  .route('/', workersDeployments)
  .route('/', workersSettings)
  .route('/', workersSlug);
