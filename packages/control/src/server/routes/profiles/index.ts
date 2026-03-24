import { Hono } from 'hono';
import type { OptionalAuthRouteEnv } from '../shared/helpers';
import profilesApi from './api';
import profilesRepo from './repo';
import profilesView from './view';

const profiles = new Hono<OptionalAuthRouteEnv>()
  .route('/', profilesView)
  .route('/', profilesRepo);

export default profiles;
export { profilesApi };
