import { Hono } from 'hono';
import type { OptionalAuthRouteEnv } from '../shared/route-auth';
import { profileCrudRoutes } from './profile-crud';
import { followRoutes } from './follow';
import { blockMuteRoutes } from './block-mute';

export type { UserProfileResponse, ProfileRepoResponse, FollowUserResponse, FollowRequestResponse } from './dto';

const profilesApi = new Hono<OptionalAuthRouteEnv>()
  .route('/', profileCrudRoutes)
  .route('/', followRoutes)
  .route('/', blockMuteRoutes);

export default profilesApi;
