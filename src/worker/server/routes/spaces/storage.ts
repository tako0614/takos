import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import storageDownloads from "./storage-downloads.ts";
import storageUploads from "./storage-uploads.ts";
import storageManagement from "./storage-management.ts";

export default new Hono<AuthenticatedRouteEnv>()
  .route("/", storageDownloads)
  .route("/", storageUploads)
  .route("/", storageManagement);
