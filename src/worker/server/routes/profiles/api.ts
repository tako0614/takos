import { Hono } from "hono";
import type { OptionalAuthRouteEnv } from "../route-auth.ts";
import { profileCrudRoutes } from "./profile-crud.ts";
import { followRoutes } from "./follow.ts";
import { blockMuteRoutes } from "./block-mute.ts";

export type {
  FollowRequestResponse,
  FollowUserResponse,
  ProfileRepoResponse,
  UserProfileResponse,
} from "./dto.ts";

const profilesApi = new Hono<OptionalAuthRouteEnv>()
  .route("/", profileCrudRoutes)
  .route("/", followRoutes)
  .route("/", blockMuteRoutes);

export default profilesApi;
