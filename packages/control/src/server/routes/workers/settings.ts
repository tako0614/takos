import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth';
import settingsConfig from './settings-config';
import settingsEnvVars from './settings-env-vars';
import settingsCommonEnv from './settings-common-env';
import settingsBindings from './settings-bindings';

const workersSettings = new Hono<AuthenticatedRouteEnv>()
  .route('/', settingsConfig)
  .route('/', settingsEnvVars)
  .route('/', settingsCommonEnv)
  .route('/', settingsBindings);

export default workersSettings;
