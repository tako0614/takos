import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import repoBase from "./routes.ts";
import repoGit from "./git.ts";
import repoGitAdvanced from "./git-advanced.ts";
import repoForks from "./forks.ts";
import repoReleases from "./releases.ts";
import repoSync from "./sync.ts";
import externalImport from "./external-import.ts";

export default new Hono<AuthenticatedRouteEnv>()
  .route("/", repoBase)
  .route("/", repoGit)
  .route("/", repoGitAdvanced)
  .route("/", repoForks)
  .route("/", repoReleases)
  .route("/", repoSync)
  .route("/", externalImport);
