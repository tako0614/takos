/**
 * Remote Store Client — fetches ActivityPub store data from remote Takos instances.
 * Handles WebFinger resolution, actor fetching, and repository browsing.
 */
export interface RemoteStoreActor {
    id: string;
    type: string;
    preferredUsername: string;
    name: string;
    summary: string;
    url: string;
    icon?: {
        type: string;
        url: string;
    } | null;
    inbox: string;
    outbox: string;
    followers: string;
    publicKey?: {
        id: string;
        owner: string;
        publicKeyPem: string;
    } | null;
    repositories?: string;
    search?: string;
    repositorySearch?: string;
    distributionMode?: string;
}
export interface RemoteRepository {
    id: string;
    type: string | string[];
    name: string;
    summary: string;
    url: string;
    published: string;
    updated: string;
    attributedTo: string;
    owner?: string;
    visibility?: string;
    defaultBranch?: string;
    cloneUrl?: string;
    browseUrl?: string;
}
export interface RemoteCollection {
    id: string;
    type: string;
    totalItems: number;
    orderedItems?: RemoteRepository[];
    first?: string;
    next?: string;
}
/** Preserves the activity wrapper when parsing outbox items. */
export interface RemoteActivity {
    activityId: string;
    activityType: string;
    published: string;
    object: RemoteRepository;
}
export interface RemoteOutboxResult {
    id: string;
    type: string;
    totalItems: number;
    activities?: RemoteActivity[];
    first?: string;
    next?: string;
}
export interface WebFingerResult {
    actorUrl: string;
    domain: string;
    storeSlug: string;
}
/**
 * Error type for remote store operations.
 * Uses a safe message that can be shown to clients without leaking internal URLs.
 */
export declare class RemoteStoreError extends Error {
    constructor(message: string);
}
export declare function apFetch(url: string, accept?: string): Promise<Response>;
/**
 * Resolve a store identifier via WebFinger.
 * Accepts formats:
 *   - "store-slug@domain.example" (acct URI)
 *   - "https://domain.example/ap/stores/store-slug" (direct URL)
 */
export declare function resolveStoreViaWebFinger(identifier: string): Promise<WebFingerResult>;
/**
 * Fetch an ActivityPub store actor from its URL.
 */
export declare function fetchRemoteStoreActor(actorUrl: string): Promise<RemoteStoreActor>;
/**
 * Fetch repositories from a remote store.
 */
export declare function fetchRemoteRepositories(repositoriesUrl: string, options?: {
    page?: number;
    limit?: number;
    expand?: boolean;
}): Promise<RemoteCollection>;
/**
 * Search repositories in a remote store.
 */
export declare function searchRemoteRepositories(searchUrl: string, query: string, options?: {
    page?: number;
    limit?: number;
    expand?: boolean;
}): Promise<RemoteCollection>;
/**
 * Fetch the outbox of a remote store (activities).
 * Unlike fetchRemoteRepositories, this preserves the activity wrapper
 * so callers can access activityId, activityType, and published.
 */
export declare function fetchRemoteOutbox(outboxUrl: string, options?: {
    page?: number;
    limit?: number;
}): Promise<RemoteOutboxResult>;
export declare function extractTkgField(body: Record<string, unknown>, field: string): string | undefined;
//# sourceMappingURL=remote-store-client.d.ts.map