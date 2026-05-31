export const TAKOS_PUBLIC_API_PATHS = {
  deployments: '/api/public/v1/deployments',
  spaces: '/api/spaces',
} as const;

export type TakosAppPublicApiPath = (typeof TAKOS_PUBLIC_API_PATHS)[keyof typeof TAKOS_PUBLIC_API_PATHS];

export type DeploymentMode = 'apply';

export interface DeploymentCreateRequest {
  mode: DeploymentMode;
  appSpec: unknown;
  target_id?: string;
  group?: string;
  env?: string;
  space_id?: string;
  deploy_intent?: {
    mode?: 'gitops';
  };
}

export interface DeployIntentAcceptedResponse {
  accepted: true;
  mode: 'gitops';
  intent: {
    id: string;
    driver: 'gitops';
    path: string;
    branch: string;
    commit: string;
  };
}
