import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth';
import resourcesAccess from './access';
import resourcesBase from './routes';
import resourcesBindings from './bindings';
import resourcesD1 from './d1';
import resourcesKv from './kv';
import resourcesR2 from './r2';
import resourcesTokens from './tokens';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', resourcesBase)
  .route('/', resourcesAccess)
  .route('/', resourcesBindings)
  .route('/', resourcesD1)
  .route('/', resourcesKv)
  .route('/', resourcesR2)
  .route('/', resourcesTokens);
