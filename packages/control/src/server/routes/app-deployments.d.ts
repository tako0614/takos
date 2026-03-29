import { type SpaceAccessRouteEnv } from './route-auth';
declare const routes: import("hono/hono-base").HonoBase<SpaceAccessRouteEnv, {
    "/spaces/:spaceId/app-deployments": {
        $post: {
            input: {
                json: {
                    ref: string;
                    repo_id: string;
                    ref_type?: "tag" | "branch" | "commit" | undefined;
                    approve_oauth_auto_env?: boolean | undefined;
                    approve_source_change?: boolean | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/spaces/:spaceId/app-deployments": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {};
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/app-deployments/:appDeploymentId": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    appDeploymentId: string;
                };
            };
            output: {
                data: {
                    hostnames?: string[] | undefined;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollback": {
        $post: {
            input: {
                json: {
                    approve_oauth_auto_env?: boolean | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                } & {
                    appDeploymentId: string;
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
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    appDeploymentId: string;
                };
            };
            output: {
                data: {
                    status: "in_progress" | "paused" | "completed" | "aborted" | "failed";
                    currentStageIndex: number;
                    stages: {
                        weight: number;
                        pauseMinutes: number;
                    }[];
                    healthCheck: {
                        errorRateThreshold: number;
                        minRequests: number;
                    } | null;
                    autoPromote: boolean;
                    stageEnteredAt: string;
                    deploymentId: string;
                    serviceId: string;
                } | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/pause": {
        $post: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    appDeploymentId: string;
                };
            };
            output: {
                success: true;
                data: {
                    status: "in_progress" | "paused" | "completed" | "aborted" | "failed";
                    currentStageIndex: number;
                    stages: {
                        weight: number;
                        pauseMinutes: number;
                    }[];
                    healthCheck: {
                        errorRateThreshold: number;
                        minRequests: number;
                    } | null;
                    autoPromote: boolean;
                    stageEnteredAt: string;
                    deploymentId: string;
                    serviceId: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/resume": {
        $post: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    appDeploymentId: string;
                };
            };
            output: {
                success: true;
                data: {
                    status: "in_progress" | "paused" | "completed" | "aborted" | "failed";
                    currentStageIndex: number;
                    stages: {
                        weight: number;
                        pauseMinutes: number;
                    }[];
                    healthCheck: {
                        errorRateThreshold: number;
                        minRequests: number;
                    } | null;
                    autoPromote: boolean;
                    stageEnteredAt: string;
                    deploymentId: string;
                    serviceId: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/abort": {
        $post: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    appDeploymentId: string;
                };
            };
            output: {
                success: true;
                data: {
                    status: "in_progress" | "paused" | "completed" | "aborted" | "failed";
                    currentStageIndex: number;
                    stages: {
                        weight: number;
                        pauseMinutes: number;
                    }[];
                    healthCheck: {
                        errorRateThreshold: number;
                        minRequests: number;
                    } | null;
                    autoPromote: boolean;
                    stageEnteredAt: string;
                    deploymentId: string;
                    serviceId: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/promote": {
        $post: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    appDeploymentId: string;
                };
            };
            output: {
                success: true;
                data: {
                    status: "in_progress" | "paused" | "completed" | "aborted" | "failed";
                    currentStageIndex: number;
                    stages: {
                        weight: number;
                        pauseMinutes: number;
                    }[];
                    healthCheck: {
                        errorRateThreshold: number;
                        minRequests: number;
                    } | null;
                    autoPromote: boolean;
                    stageEnteredAt: string;
                    deploymentId: string;
                    serviceId: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/app-deployments/:appDeploymentId": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    appDeploymentId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/spaces/:spaceId/app-deployments/:appDeploymentId">;
export default routes;
//# sourceMappingURL=app-deployments.d.ts.map