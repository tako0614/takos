/**
 * Remote Install Service — installs repositories from remote ActivityPub stores
 * into the local workspace by creating a local repo and cloning via git smart HTTP.
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
export interface RemoteInstallInput {
    /** Store registry entry ID */
    registryEntryId: string;
    /** Owner slug on the remote store */
    remoteOwner: string;
    /** Repository name on the remote store */
    remoteRepoName: string;
    /** Local name override */
    localName?: string;
}
export interface RemoteInstallResult {
    repositoryId: string;
    name: string;
    cloneUrl: string;
    remoteStoreActorUrl: string;
    remoteBrowseUrl: string | null;
}
/**
 * Install a repository from a remote store.
 *
 * Creates a local repository record pointing to the remote clone URL.
 * The actual git data is fetched lazily on first access via the remote's
 * git smart HTTP endpoint (tkg:cloneUrl).
 */
export declare function installFromRemoteStore(dbBinding: D1Database, accountId: string, input: RemoteInstallInput): Promise<RemoteInstallResult>;
//# sourceMappingURL=remote-install.d.ts.map