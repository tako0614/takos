import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import settingsConfig from './settings-config.ts';
import settingsEnvVars from './settings-env-vars.ts';
import settingsCommonEnv from './settings-common-env.ts';
import settingsBindings from './settings-bindings.ts';

const workersSettings = new Hono<AuthenticatedRouteEnv>()
  .route('/', settingsConfig)
  .route('/', settingsEnvVars)
  .route('/', settingsCommonEnv)
  .route('/', settingsBindings);

export default workersSettings;
