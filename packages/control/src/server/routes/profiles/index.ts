import { Hono } from 'hono';
import type { OptionalAuthRouteEnv } from '../route-auth.ts';
import profilesApi from './api.ts';
import profilesRepo from './repo.ts';
import profilesView from './view.ts';

const profiles = new Hono<OptionalAuthRouteEnv>()
  .route('/', profilesView)
  .route('/', profilesRepo);

export default profiles;
export { profilesApi };
