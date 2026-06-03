export const TAKOS_PUBLIC_API_PATHS = {
  deployments: '/api/public/v1/deployments',
  spaces: '/api/spaces',
} as const;

export type TakosAppPublicApiPath = (typeof TAKOS_PUBLIC_API_PATHS)[keyof typeof TAKOS_PUBLIC_API_PATHS];

export type DeploymentMode = 'apply';

export interface DeploymentCreateRequest {
  mode: DeploymentMode;
  source?: {
    kind: 'git' | 'prepared' | 'local';
    url: string;
    ref?: string;
    digest?: string;
  };
  expected?: {
    commit?: string;
    sourceDigest?: string;
    planDigest: string;
    currentDeploymentId?: string | null;
  };
  target_id?: string;
  group?: string;
  env?: string;
  space_id?: string;
}

export interface RetiredDeploymentCreateResponse {
  error: {
    code: 'GONE';
    message: string;
  };
}
