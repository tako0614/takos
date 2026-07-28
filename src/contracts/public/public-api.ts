export const TAKOS_PUBLIC_API_PATHS = {
  spaces: '/api/spaces',
} as const;

export type TakosAppPublicApiPath = (typeof TAKOS_PUBLIC_API_PATHS)[keyof typeof TAKOS_PUBLIC_API_PATHS];
