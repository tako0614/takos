/**
 * Git Smart HTTP Client — fetch remote refs.
 *
 * Speaks the client side of the git smart HTTP info/refs protocol.
 * This is the inverse of `handleInfoRefs` in `smart-http/info-refs.ts`:
 * the server *constructs* the pkt-line response; this module *parses* it.
 *
 * Usage:
 *   const { refs, capabilities } = await fetchRemoteRefs(
 *     'https://github.com/owner/repo.git',
 *     null, // no auth for public repos
 *   );
 */
export interface RemoteRef {
    /** Fully qualified ref name, e.g. `refs/heads/main`. */
    name: string;
    /** 40-character hex SHA-1. */
    sha: string;
}
export interface FetchRefsResult {
    refs: RemoteRef[];
    capabilities: string[];
    /** The SHA advertised as HEAD (if present via symref). */
    headSha: string | null;
    /** The branch HEAD points to (parsed from symref capability). */
    headTarget: string | null;
}
/**
 * Fetch the ref list from a remote git HTTP server.
 *
 * Sends `GET <url>/info/refs?service=git-upload-pack` and parses the
 * pkt-line response into structured ref entries and capabilities.
 */
export declare function fetchRemoteRefs(url: string, authHeader: string | null): Promise<FetchRefsResult>;
//# sourceMappingURL=fetch-refs.d.ts.map