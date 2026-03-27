import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import storageDownloads from './storage-downloads';
import storageUploads from './storage-uploads';
import storageManagement from './storage-management';

export default new Hono<AuthenticatedRouteEnv>()
  .route('/', storageDownloads)
  .route('/', storageUploads)
  .route('/', storageManagement);
