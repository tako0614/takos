import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import gitRefs from './git-refs';
import gitCommits from './git-commits';
import gitFiles from './git-files';

const repoGit = new Hono<AuthenticatedRouteEnv>()
  .route('/', gitRefs)
  .route('/', gitFiles)
  .route('/', gitCommits);

export default repoGit;
