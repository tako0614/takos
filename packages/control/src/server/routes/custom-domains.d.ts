import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../../shared/types';
import type { BaseVariables } from './route-auth';
type AppEnv = {
    Bindings: Env;
    Variables: BaseVariables;
};
declare const _default: import("hono/hono-base").HonoBase<AppEnv, {
    "/services/:id/custom-domains": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                domains: {
                    id: string;
                    service_id: string;
                    domain: string;
                    status: string;
                    verification_token: string;
                    verification_host: string;
                    verification_method: string;
                    ssl_status: string | null;
                    verified_at: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: ContentfulStatusCode;
        };
    };
} & {
    "/services/:id/custom-domains": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                id: string;
                domain: string;
                status: "pending";
                verification_method: "cname" | "txt";
                verification_token: string;
                instructions: {
                    step1: {
                        type: "CNAME" | "TXT";
                        name: string;
                        value: string;
                        description: string;
                    };
                    step2: {
                        type: "CNAME" | "TXT";
                        name: string;
                        value: string;
                        description: string;
                    };
                };
            };
            outputFormat: "json";
            status: -1 | 100 | 203 | 500 | 400 | 401 | 402 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 501 | 502 | 503 | 504 | 200 | 201 | 102 | 103 | 202 | 206 | 207 | 208 | 226 | 300 | 301 | 302 | 303 | 305 | 306 | 307 | 308 | 405 | 406 | 407 | 408 | 411 | 412 | 414 | 415 | 416 | 417 | 418 | 421 | 423 | 424 | 425 | 426 | 428 | 431 | 451 | 505 | 506 | 507 | 508 | 510 | 511;
        };
    };
} & {
    "/services/:id/custom-domains/:domainId/verify": {
        $post: {
            input: {
                param: {
                    id: string;
                } & {
                    domainId: string;
                };
            };
            output: {
                status: import("../../application/services/platform/custom-domains").DomainStatus;
                message: string;
                dns_verified?: boolean | undefined;
                ssl_verified?: boolean | undefined;
                verified_at?: string | undefined;
                ssl_status?: string | undefined;
                verified?: boolean | undefined;
            } | {
                error: string;
            };
            outputFormat: "json";
            status: -1 | 100 | 203 | 500 | 400 | 401 | 402 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 501 | 502 | 503 | 504 | 200 | 201 | 102 | 103 | 202 | 206 | 207 | 208 | 226 | 300 | 301 | 302 | 303 | 305 | 306 | 307 | 308 | 405 | 406 | 407 | 408 | 411 | 412 | 414 | 415 | 416 | 417 | 418 | 421 | 423 | 424 | 425 | 426 | 428 | 431 | 451 | 505 | 506 | 507 | 508 | 510 | 511;
        };
    };
} & {
    "/services/:id/custom-domains/:domainId": {
        $get: {
            input: {
                param: {
                    id: string;
                } & {
                    domainId: string;
                };
            };
            output: {
                id: string;
                domain: string;
                status: string;
                verification_method: string;
                ssl_status: string | null;
                verified_at: string | null;
                created_at: string;
                instructions: {
                    cname_target: string;
                    verification_record: {
                        type: string;
                        name: string;
                        value: string;
                    };
                } | undefined;
            };
            outputFormat: "json";
            status: ContentfulStatusCode;
        };
    };
} & {
    "/services/:id/custom-domains/:domainId": {
        $delete: {
            input: {
                param: {
                    id: string;
                } & {
                    domainId: string;
                };
            };
            output: {
                success: boolean;
                warnings: string[];
                message: string;
            } | {
                success: boolean;
            };
            outputFormat: "json";
            status: ContentfulStatusCode;
        };
    };
} & {
    "/services/:id/custom-domains/:domainId/refresh-ssl": {
        $post: {
            input: {
                param: {
                    id: string;
                } & {
                    domainId: string;
                };
            };
            output: {
                status: string;
                ssl_status: string | null;
            } | {
                status: string;
                ssl_status: string;
                hostname_status: string;
            };
            outputFormat: "json";
            status: ContentfulStatusCode;
        };
    };
}, "/", "/services/:id/custom-domains/:domainId/refresh-ssl">;
export default _default;
//# sourceMappingURL=custom-domains.d.ts.map