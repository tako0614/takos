/**
 * Unified spaces router — aggregates all space sub-routers into a single mount point.
 */
import { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { ApiVariables } from '../api';

import spacesBase from './routes';
import spacesMembers from './members';
import spacesRepos from './repositories';
import spacesStorage from './storage';
import spacesCommonEnv from './common-env';
import spacesStores from './stores';
import spacesStoreRegistry from './store-registry';

const spaces = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

spaces.route('/', spacesBase);
spaces.route('/', spacesMembers);
spaces.route('/', spacesRepos);
spaces.route('/', spacesStorage);
spaces.route('/', spacesCommonEnv);
spaces.route('/', spacesStores);
spaces.route('/', spacesStoreRegistry);

export default spaces;
