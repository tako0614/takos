import { type AuthenticatedRouteEnv } from '../route-auth';
declare const app: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:spaceId/storage/:fileId/content": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    fileId: string;
                };
            };
            output: {
                content: string;
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
                encoding: "base64" | "utf-8";
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage/:fileId/content": {
        $put: {
            input: {
                json: {
                    content: string;
                    mime_type?: string | undefined;
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
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/storage/download/:fileId": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    fileId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/:spaceId/storage/download-url": {
        $get: {
            input: {
                query: {
                    file_id?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                download_url: string;
                expires_at: string;
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
    "/:spaceId/storage/download-zip": {
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
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
}, "/", "/:spaceId/storage/download-zip">;
export default app;
//# sourceMappingURL=storage-downloads.d.ts.map