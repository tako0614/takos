import { Hono } from 'hono';
import type { Env, User } from '../../../shared/types/index.ts';
import repoRoutes from './repos.ts';
import packageRoutes from './packages.ts';
import userRoutes from './users.ts';

type Variables = {
  user?: User;
};

export default new Hono<{ Bindings: Env; Variables: Variables }>()
  .route('/', repoRoutes)
  .route('/', packageRoutes)
  .route('/', userRoutes);
