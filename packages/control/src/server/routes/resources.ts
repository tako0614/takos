import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from './shared/route-auth';
import resourcesAccess from './resources/access';
import resourcesBase from './resources/base';
import resourcesBindings from './resources/bindings';
import resourcesD1 from './resources/d1';
import resourcesR2 from './resources/r2';
import resourcesTokens from './resources/tokens';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', resourcesBase)
  .route('/', resourcesAccess)
  .route('/', resourcesBindings)
  .route('/', resourcesD1)
  .route('/', resourcesR2)
  .route('/', resourcesTokens);
