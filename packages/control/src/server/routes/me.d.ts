import type { Env } from '../../shared/types';
import { type BaseVariables } from './route-auth';
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: BaseVariables;
}, {
    "/": {
        $get: {
            input: {};
            output: {
                email: string;
                name: string;
                username: string;
                picture: string | null;
                setup_completed: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/personal-space": {
        $get: {
            input: {};
            output: {
                space: {
                    id: string;
                    slug: string;
                    name: string;
                    owner_principal_id: string;
                    kind: string;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/settings": {
        $get: {
            input: {};
            output: {
                setup_completed: boolean;
                auto_update_enabled: boolean;
                private_account: boolean;
                activity_visibility: string;
                ai_model: string;
                available_models: readonly ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/settings": {
        $patch: {
            input: {};
            output: {
                setup_completed: boolean;
                auto_update_enabled: boolean;
                private_account: boolean;
                activity_visibility: string;
                ai_model: string;
                available_models: readonly ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/username": {
        $patch: {
            input: {};
            output: {
                success: true;
                username: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/oauth/consents": {
        $get: {
            input: {};
            output: {
                consents: {
                    client_id: string;
                    client_name: string | undefined;
                    client_logo: string | undefined;
                    client_uri: string | undefined;
                    scopes: string[];
                    granted_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/oauth/consents/:clientId": {
        $delete: {
            input: {
                param: {
                    clientId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/oauth/audit-logs": {
        $get: {
            input: {};
            output: {
                logs: {
                    client_id: string | null;
                    event_type: string;
                    ip_address: string | null;
                    user_agent: string | null;
                    details: {
                        [x: string]: import("hono/utils/types").JSONValue;
                    };
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/oauth/clients": {
        $get: {
            input: {};
            output: {
                clients: {
                    client_id: string;
                    name: string;
                    description: string | null;
                    logo_uri: string | null;
                    client_uri: string | null;
                    redirect_uris: string[];
                    allowed_scopes: string[];
                    client_type: import("../../shared/types").OAuthClientType;
                    status: import("../../shared/types").OAuthClientStatus;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/oauth/clients": {
        $post: {
            input: {};
            output: {
                client_id: string;
                client_secret?: string | undefined;
                client_id_issued_at: number;
                client_secret_expires_at: number;
                registration_access_token: string;
                registration_client_uri: string;
                client_name: string;
                redirect_uris: string[];
                grant_types: string[];
                response_types: string[];
                scope: string;
                client_uri?: string | undefined;
                logo_uri?: string | undefined;
                policy_uri?: string | undefined;
                tos_uri?: string | undefined;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/oauth/clients/:clientId": {
        $patch: {
            input: {
                param: {
                    clientId: string;
                };
            };
            output: {
                id: string;
                client_id: string;
                name: string;
                description: string | null;
                logo_uri: string | null;
                client_uri: string | null;
                redirect_uris: string[];
                allowed_scopes: string[];
                status: import("../../shared/types").OAuthClientStatus;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/oauth/clients/:clientId": {
        $delete: {
            input: {
                param: {
                    clientId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/personal-access-tokens": {
        $get: {
            input: {};
            output: {
                tokens: {
                    id: string;
                    name: string;
                    token_prefix: string;
                    scopes: string;
                    expires_at: string | null;
                    last_used_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/personal-access-tokens": {
        $post: {
            input: {};
            output: {
                id: string;
                name: string;
                token: string;
                token_prefix: string;
                scopes: string;
                expires_at: string | null;
                created_at: string;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/personal-access-tokens/:id": {
        $delete: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/personal-access-tokens/:id">;
export default _default;
//# sourceMappingURL=me.d.ts.map