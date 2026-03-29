/**
 * Git Smart HTTP Client — fetch pack (clone/fetch).
 *
 * Speaks the client side of the git upload-pack protocol.
 * This is the inverse of `handleUploadPack` in `smart-http/upload-pack.ts`:
 * the server builds want/have negotiation and constructs a packfile response;
 * this module *sends* want/have lines and *receives* the packfile.
 *
 * The returned packfile bytes can be passed directly to `readPackfileAsync`
 * from `protocol/packfile-reader.ts` to unpack objects into R2.
 */
/**
 * Fetch a packfile from a remote git HTTP server.
 *
 * Sends a `POST <url>/git-upload-pack` request with want/have negotiation
 * and returns the raw packfile bytes (starting with `PACK` signature).
 *
 * @param url       Base git URL (e.g. `https://github.com/owner/repo.git`)
 * @param authHeader  Authorization header value, or null for public repos
 * @param wants     SHA-1 hashes of refs we want
 * @param haves     SHA-1 hashes of refs we already have locally (empty for initial clone)
 * @param options   Optional fetch configuration
 * @returns Raw packfile bytes suitable for `readPackfileAsync`
 */
export declare function fetchPackFromRemote(url: string, authHeader: string | null, wants: string[], haves: string[], options?: {
    maxPackfileBytes?: number;
}): Promise<Uint8Array>;
//# sourceMappingURL=fetch-pack.d.ts.map