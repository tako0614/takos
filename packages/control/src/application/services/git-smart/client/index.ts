/**
 * Git Smart HTTP Client — public API.
 *
 * Provides the client-side counterpart to the server-side git smart HTTP
 * handlers in `smart-http/`. Enables fetching refs and packfiles from
 * any remote git HTTP server (GitHub, GitLab, self-hosted, etc.).
 */

export { fetchRemoteRefs, type RemoteRef, type FetchRefsResult } from './fetch-refs';
export { fetchPackFromRemote } from './fetch-pack';
