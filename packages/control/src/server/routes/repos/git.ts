import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import gitRefs from "./git-refs.ts";
import gitCommits from "./git-commits.ts";
import gitFiles from "./git-files.ts";

const repoGit = new Hono<AuthenticatedRouteEnv>()
  .route("/", gitRefs)
  .route("/", gitFiles)
  .route("/", gitCommits);

export default repoGit;
