import {
  NOTIFICATION_PUSHER_REGISTRATION_PATH,
  createTakosumiProductCapabilities,
  createTakosumiWellKnownDocument,
  type CreateTakosumiDiscoveryOptions,
} from "takosumi-contract";

const TAKOS_MOBILE_PUSH_REGISTRATION_PATH =
  "/api/mobile/push-registrations" as const;

export function createTakosDistributionWellKnown(origin: string) {
  return createTakosumiWellKnownDocument(
    takosDistributionDiscoveryOptions(origin),
  );
}

export function createTakosDistributionProductCapabilities(origin: string) {
  return createTakosumiProductCapabilities(
    takosDistributionDiscoveryOptions(origin),
  );
}

export interface TakosProductWellKnown {
  readonly product: "takos";
  readonly name: "Takos";
  readonly issuer: string;
  readonly apiBaseUrl: string;
  readonly endpoints: {
    readonly api: string;
    readonly currentUser: string;
    readonly spaces: string;
    readonly apps: string;
    readonly notifications: string;
    readonly notificationPushers: string;
    readonly mobilePushRegistrations: string;
  };
}

export function createTakosProductWellKnown(
  origin: string,
): TakosProductWellKnown {
  const baseUrl = trimTrailingSlash(origin);
  return {
    product: "takos",
    name: "Takos",
    issuer: baseUrl,
    apiBaseUrl: baseUrl,
    endpoints: {
      api: `${baseUrl}/api`,
      currentUser: `${baseUrl}/api/auth/me`,
      spaces: `${baseUrl}/api/spaces`,
      apps: `${baseUrl}/api/apps`,
      notifications: `${baseUrl}/api/notifications`,
      notificationPushers: `${baseUrl}${NOTIFICATION_PUSHER_REGISTRATION_PATH}`,
      mobilePushRegistrations: `${baseUrl}${TAKOS_MOBILE_PUSH_REGISTRATION_PATH}`,
    },
  };
}

function takosDistributionDiscoveryOptions(
  origin: string,
): CreateTakosumiDiscoveryOptions {
  return {
    origin,
    resources: {
      Stack: false,
      EdgeWorker: false,
      ObjectBucket: false,
      KVStore: false,
      Queue: false,
      SQLDatabase: false,
      ContainerService: false,
    },
    adapters: {
      opentofu: false,
    },
    identity: {
      oidc_issuer: false,
      external_oidc_login: false,
      workload_identity: false,
    },
    resourceShapesEnabled: false,
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
