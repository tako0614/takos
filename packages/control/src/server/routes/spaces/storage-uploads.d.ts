import { type AuthenticatedRouteEnv } from '../route-auth';
declare const app: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:spaceId/storage/files": {
        $post: {
            input: {
                json: {
                    path: string;
                    content: string;
                    mime_type?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
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
            status: 201;
        };
    };
} & {
    "/:spaceId/storage/upload-url": {
        $post: {
            input: {
                json: {
                    name: string;
                    size: number;
                    mime_type?: string | undefined;
                    parent_path?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                file_id: string;
                upload_url: string;
                r2_key: string;
                expires_at: string;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:spaceId/storage/upload/:fileId": {
        $put: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    fileId: string;
                };
            };
            output: null;
            outputFormat: "body";
            status: 204;
        };
    };
} & {
    "/:spaceId/storage/confirm-upload": {
        $post: {
            input: {
                json: {
                    file_id: string;
                    sha256?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
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
}, "/", "/:spaceId/storage/confirm-upload">;
export default app;
//# sourceMappingURL=storage-uploads.d.ts.map