import {
  NOTIFICATION_PUSHER_REGISTRATION_PATH,
  normalizeNotificationPusherGatewayUrl,
  registerNotificationPusherWithHost,
  unregisterNotificationPusherWithHost,
  type FetchLike,
  type MobilePushRegistrationCallbackInput,
  type NotificationPusher,
} from "@takosjp/takosumi-mobile-kit";

export const TAKOS_MOBILE_NOTIFICATION_PUSHER_PATH =
  NOTIFICATION_PUSHER_REGISTRATION_PATH;
export const TAKOS_MOBILE_NOTIFICATION_PUSHER_APP_ID = "jp.takos.mobile";
export const TAKOS_MOBILE_PUSH_GATEWAY_URL_ENV =
  "VITE_TAKOS_NOTIFICATION_PUSHER_GATEWAY_URL";

export interface RegisterTakosMobilePushOptions {
  readonly path?: string;
  readonly fetch?: FetchLike;
  /** Public notify endpoint configured by the mobile build operator. */
  readonly gatewayUrl?: string | null;
}

export async function registerTakosMobilePush(
  input: MobilePushRegistrationCallbackInput,
  options: RegisterTakosMobilePushOptions = {},
): Promise<void> {
  const pusher = createTakosMobileNotificationPusher(
    input.registration,
    options.gatewayUrl === undefined
      ? readBuildGatewayUrl()
      : options.gatewayUrl,
  );
  await registerNotificationPusherWithHost({
    session: input.session,
    pusher,
    path: options.path,
    fetch: options.fetch,
  });
}

export async function unregisterTakosMobilePush(
  input: MobilePushRegistrationCallbackInput,
  options: RegisterTakosMobilePushOptions = {},
): Promise<void> {
  await unregisterNotificationPusherWithHost({
    session: input.session,
    appId: TAKOS_MOBILE_NOTIFICATION_PUSHER_APP_ID,
    pushkey: input.registration.token,
    path: options.path,
    fetch: options.fetch,
  });
}

function createTakosMobileNotificationPusher(
  registration: MobilePushRegistrationCallbackInput["registration"],
  configuredGatewayUrl: unknown,
): NotificationPusher {
  const gatewayUrl =
    normalizeNotificationPusherGatewayUrl(configuredGatewayUrl);
  if (!gatewayUrl) {
    if (
      configuredGatewayUrl == null ||
      (typeof configuredGatewayUrl === "string" &&
        configuredGatewayUrl.trim() === "")
    ) {
      throw new Error(
        `Takos mobile remote push is disabled: ${TAKOS_MOBILE_PUSH_GATEWAY_URL_ENV} is not configured.`,
      );
    }
    throw new Error(
      "Takos mobile notification gateway URL must use HTTPS without credentials; HTTP is allowed only for loopback development.",
    );
  }

  const provider = registration.provider;
  if (provider !== "apns" && provider !== "fcm") {
    throw new Error("Takos mobile push provider must be apns or fcm.");
  }
  const environment = normalizeEnvironment(registration.environment);
  if (!environment) {
    throw new Error("Takos mobile push environment is required.");
  }

  return {
    kind: "http",
    app_id: TAKOS_MOBILE_NOTIFICATION_PUSHER_APP_ID,
    app_display_name: "Takos",
    pushkey: registration.token,
    data: {
      url: gatewayUrl,
      format: "event_id_only",
      provider,
      environment,
    },
  };
}

function readBuildGatewayUrl(): unknown {
  const meta = import.meta as ImportMeta & {
    readonly env?: Readonly<Record<string, unknown>>;
  };
  return meta.env?.[TAKOS_MOBILE_PUSH_GATEWAY_URL_ENV];
}

function normalizeEnvironment(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const environment = value.trim();
  if (!environment || environment.length > 64) return undefined;
  return /^[a-z0-9._:-]+$/iu.test(environment) ? environment : undefined;
}
