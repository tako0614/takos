import { Hono } from 'hono';
import type { Env, User } from '../../../shared/types';
import repoRoutes from './repos';
import packageRoutes from './packages';
import userRoutes from './users';

type Variables = {
  user?: User;
};

export default new Hono<{ Bindings: Env; Variables: Variables }>()
  .route('/', repoRoutes)
  .route('/', packageRoutes)
  .route('/', userRoutes);
