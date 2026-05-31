/**
 * Remote Git protocol client — public API.
 *
 * Enables fetching refs and packfiles from any remote git HTTP server
 * (GitHub, GitLab, self-hosted, etc.).
 */

export {
  type FetchRefsResult,
  fetchRemoteRefs,
  type RemoteRef,
} from "./fetch-refs.ts";
export { fetchPackFromRemote } from "./fetch-pack.ts";
