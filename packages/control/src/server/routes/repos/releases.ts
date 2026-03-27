import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import releaseCrud from './release-crud';
import releaseAssets from './release-assets';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', releaseCrud)
  .route('/', releaseAssets);
