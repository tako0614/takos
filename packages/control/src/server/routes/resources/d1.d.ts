import { type AuthenticatedRouteEnv } from '../route-auth';
declare const resourcesD1: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/d1/tables": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                tables: {
                    name: string;
                    columns: {
                        cid: number;
                        name: string;
                        type: string;
                        notnull: number;
                        dflt_value: string | null;
                        pk: number;
                    }[];
                    row_count: number;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/d1/tables/:tableName": {
        $get: {
            input: {
                param: {
                    id: string;
                } & {
                    tableName: string;
                };
            };
            output: {
                table: string;
                columns: {
                    cid: number;
                    name: string;
                    type: string;
                    notnull: number;
                    dflt_value: string | null;
                    pk: number;
                }[];
                rows: any;
                total_count: number;
                limit: number;
                offset: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/d1/query": {
        $post: {
            input: {
                json: {
                    sql: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                result: import("hono/utils/types").JSONValue;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/d1/export": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                database: string;
                tables: {
                    [x: string]: import("hono/utils/types").JSONValue[];
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id/d1/export">;
export default resourcesD1;
//# sourceMappingURL=d1.d.ts.map