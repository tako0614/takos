import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import repoBase from './routes.ts';
import repoGit from './git.ts';
import repoGitAdvanced from './git-advanced.ts';
import repoStars from './stars.ts';
import repoForks from './forks.ts';
import repoReleases from './releases.ts';
import repoSync from './sync.ts';
import repoWorkflows from './workflows.ts';
import actionRuns from './actions/runs.ts';
import actionJobs from './actions/jobs.ts';
import actionSecrets from './actions/secrets.ts';
import actionArtifacts from './actions/artifacts.ts';
import externalImport from './external-import.ts';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', repoBase)
  .route('/', repoGit)
  .route('/', repoGitAdvanced)
  .route('/', repoStars)
  .route('/', repoForks)
  .route('/', repoReleases)
  .route('/', repoSync)
  .route('/', repoWorkflows)
  .route('/', actionRuns)
  .route('/', actionJobs)
  .route('/', actionSecrets)
  .route('/', actionArtifacts)
  .route('/', externalImport);
