import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from './shared/helpers';
import repoBase from './repos/base';
import repoGit from './repos/git';
import repoGitAdvanced from './repos/git-advanced';
import repoStars from './repos/stars';
import repoForks from './repos/forks';
import repoReleases from './repos/releases';
import repoSync from './repos/sync';
import repoWorkflows from './repos/workflows';
import actionRuns from './repos/actions/runs';
import actionJobs from './repos/actions/jobs';
import actionSecrets from './repos/actions/secrets';
import actionArtifacts from './repos/actions/artifacts';
import externalImport from './repos/external-import';

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
