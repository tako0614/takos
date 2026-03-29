import { type AuthenticatedRouteEnv } from '../route-auth';
declare const app: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:spaceId/storage/file-handlers": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                handlers: {
                    id: string;
                    name: string;
                    mime_types: string[];
                    extensions: string[];
                    open_url: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage": {
        $get: {
            input: {
                query: {
                    path?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                files: {
                    id: string;
                    space_id: string;
                    parent_id: string | null;
                    name: string;
                    path: string;
                    type: import("../../../shared/types").SpaceStorageFileType;
                    size: number;
                    mime_type: string | null;
                    sha256: string | null;
                    uploaded_by: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
                path: string;
                truncated: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage/folders": {
        $post: {
            input: {
                json: {
                    name: string;
                    parent_path?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                folder: {
                    id: string;
                    space_id: string;
                    parent_id: string | null;
                    name: string;
                    path: string;
                    type: import("../../../shared/types").SpaceStorageFileType;
                    size: number;
                    mime_type: string | null;
                    sha256: string | null;
                    uploaded_by: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:spaceId/storage/:fileId": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    fileId: string;
                };
            };
            output: {
                file: {
                    id: string;
                    space_id: string;
                    parent_id: string | null;
                    name: string;
                    path: string;
                    type: import("../../../shared/types").SpaceStorageFileType;
                    size: number;
                    mime_type: string | null;
                    sha256: string | null;
                    uploaded_by: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage/:fileId": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    fileId: string;
                };
            };
            output: {
                success: true;
                deleted_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage/:fileId": {
        $patch: {
            input: {
                json: {
                    name?: string | undefined;
                    parent_path?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                } & {
                    fileId: string;
                };
            };
            output: {
                file: {
                    id: string;
                    space_id: string;
                    parent_id: string | null;
                    name: string;
                    path: string;
                    type: import("../../../shared/types").SpaceStorageFileType;
                    size: number;
                    mime_type: string | null;
                    sha256: string | null;
                    uploaded_by: string | null;
                    created_at: string;
                    updated_at: string;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage/bulk-delete": {
        $post: {
            input: {
                json: {
                    file_ids: string[];
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                success: true;
                deleted_count: number;
                error_count: number;
                failed_ids: string[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage/bulk-move": {
        $post: {
            input: {
                json: {
                    parent_path: string;
                    file_ids: string[];
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                moved: {
                    id: string;
                    space_id: string;
                    parent_id: string | null;
                    name: string;
                    path: string;
                    type: import("../../../shared/types").SpaceStorageFileType;
                    size: number;
                    mime_type: string | null;
                    sha256: string | null;
                    uploaded_by: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
                errors: {
                    file_id: string;
                    error: string;
                }[];
                success_count: number;
                error_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage/bulk-rename": {
        $post: {
            input: {
                json: {
                    renames: {
                        name: string;
                        file_id: string;
                    }[];
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                renamed: {
                    id: string;
                    space_id: string;
                    parent_id: string | null;
                    name: string;
                    path: string;
                    type: import("../../../shared/types").SpaceStorageFileType;
                    size: number;
                    mime_type: string | null;
                    sha256: string | null;
                    uploaded_by: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
                errors: {
                    file_id: string;
                    error: string;
                }[];
                success_count: number;
                error_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:spaceId/storage/bulk-rename">;
export default app;
//# sourceMappingURL=storage-management.d.ts.map