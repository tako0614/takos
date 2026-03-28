import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import repoBase from './routes';
import repoGit from './git';
import repoGitAdvanced from './git-advanced';
import repoStars from './stars';
import repoForks from './forks';
import repoReleases from './releases';
import repoSync from './sync';
import repoWorkflows from './workflows';
import actionRuns from './actions/runs';
import actionJobs from './actions/jobs';
import actionSecrets from './actions/secrets';
import actionArtifacts from './actions/artifacts';
import externalImport from './external-import';

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
