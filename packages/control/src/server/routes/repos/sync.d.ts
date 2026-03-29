import type { AuthenticatedRouteEnv } from '../route-auth';
import * as gitStore from '../../../application/services/git-smart';
declare const repoSync: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/fetch": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/sync": {
        $post: {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: false;
                commits_behind: number;
                commits_ahead: number;
                new_commits: number;
                conflict: true;
                has_merge_base: false;
                merge_base: null;
                message: string;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: false;
                commits_behind: number;
                commits_ahead: number;
                new_commits: number;
                conflict: false;
                has_merge_base: true;
                message: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: false;
                commits_behind: number;
                commits_ahead: number;
                new_commits: number;
                conflict: true;
                has_merge_base: true;
                message: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: true;
                commits_behind: number;
                commits_ahead: number;
                new_commits: number;
                conflict: false;
                has_merge_base: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                status: string;
                conflicts: never[];
                merge_base: null;
                conflict: true;
                has_merge_base: false;
                message: string;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                status: string;
                conflicts: {
                    path: string;
                    type: gitStore.MergeConflictType;
                }[];
                merge_base: string;
                conflict: true;
                has_merge_base: true;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
                current: string | undefined;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                status: string;
                ref: string;
                merge_commit: string;
                parents: string[];
                conflict: false;
                has_merge_base: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
                code: import("./shared").TreeFlattenLimitErrorCode;
                detail: string;
            };
            outputFormat: "json";
            status: 413;
        };
    };
} & {
    "/repos/:repoId/sync/status": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                can_sync: false;
                can_fast_forward: false;
                commits_behind: number;
                commits_ahead: number;
                has_merge_base: true;
                conflict: false;
                error: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                can_sync: boolean;
                can_fast_forward: boolean;
                commits_behind: number;
                commits_ahead: number;
                has_merge_base: boolean;
                conflict: boolean;
                upstream: {
                    id: string;
                    name: string;
                    space_id: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/sync/status">;
export default repoSync;
//# sourceMappingURL=sync.d.ts.map