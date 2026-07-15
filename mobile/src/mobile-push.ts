import { addPluginListener, invoke } from "@tauri-apps/api/core";
import type {
  TauriMobilePushNotification,
  TauriMobilePushPluginModule,
  TauriMobilePushTokenRefresh,
  TauriPushToken,
} from "@takosjp/takosumi-mobile-kit";

const PLUGIN_NAME = "mobile-push";
const COMMAND_PREFIX = `plugin:${PLUGIN_NAME}|`;

type PushEventName =
  "notification-received" | "notification-tapped" | "token-refresh";

export interface TakosMobilePushTauriAdapters {
  readonly invoke: typeof invoke;
  readonly addPluginListener: typeof addPluginListener;
}

const defaultAdapters: TakosMobilePushTauriAdapters = {
  invoke,
  addPluginListener,
};

export function createTakosMobilePushPluginModule(
  adapters: TakosMobilePushTauriAdapters = defaultAdapters,
): TauriMobilePushPluginModule {
  return {
    async requestPermission() {
      const result = await adapters.invoke<unknown>(
        `${COMMAND_PREFIX}request_permission`,
      );
      return { granted: readGranted(result) };
    },
    async getToken() {
      const result = await adapters.invoke<unknown>(
        `${COMMAND_PREFIX}get_token`,
      );
      return readToken(result);
    },
    async unregister() {
      await adapters.invoke(`${COMMAND_PREFIX}unregister`);
    },
    async onNotificationReceived(handler) {
      return await addActivatedListener<TauriMobilePushNotification>(
        adapters,
        "notification-received",
        handler,
      );
    },
    async onNotificationTapped(handler) {
      return await addActivatedListener<TauriMobilePushNotification>(
        adapters,
        "notification-tapped",
        handler,
      );
    },
    async onTokenRefresh(handler) {
      return await addActivatedListener(adapters, "token-refresh", handler);
    },
  };
}

export const takosMobilePushPlugin = createTakosMobilePushPluginModule();

async function addActivatedListener<
  Payload extends TauriMobilePushNotification | TauriMobilePushTokenRefresh,
>(
  adapters: TakosMobilePushTauriAdapters,
  event: PushEventName,
  handler: (payload: Payload) => void,
): Promise<{ readonly unregister: () => Promise<void> }> {
  const listener = await adapters.addPluginListener<Payload>(
    PLUGIN_NAME,
    event,
    handler,
  );
  try {
    await setEventActive(adapters, event, true);
  } catch (error) {
    try {
      await unregisterListenerWithRetry(listener);
    } catch {
      // Preserve the activation failure while still attempting native cleanup.
    }
    await deactivateEventWithRetry(adapters, event).catch(() => undefined);
    throw error;
  }

  let registered = true;
  return {
    async unregister() {
      if (!registered) return;
      await unregisterListenerWithRetry(listener);
      registered = false;
      await deactivateEventWithRetry(adapters, event);
    },
  };
}

async function deactivateEventWithRetry(
  adapters: TakosMobilePushTauriAdapters,
  event: PushEventName,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await setEventActive(adapters, event, false);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function unregisterListenerWithRetry(listener: {
  readonly unregister: () => Promise<void>;
}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await listener.unregister();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function setEventActive(
  adapters: TakosMobilePushTauriAdapters,
  event: PushEventName,
  active: boolean,
): Promise<void> {
  await adapters.invoke(
    `${COMMAND_PREFIX}${active ? "activate_event" : "deactivate_event"}`,
    { payload: { event } },
  );
}

function readGranted(value: unknown): boolean {
  if (value === true || value === "granted") return true;
  if (!isRecord(value)) return false;
  return value.granted === true || value.permission === "granted";
}

function readToken(value: unknown): TauriPushToken {
  if (!isRecord(value))
    throw new Error("Native push token response is invalid.");
  const token = readNonEmptyString(value.token, 4096);
  if (!token) throw new Error("Native push token is missing.");
  if (value.provider !== "apns" && value.provider !== "fcm") {
    throw new Error("Native push provider is invalid.");
  }
  const environment = readNonEmptyString(value.environment, 64);
  if (!environment) throw new Error("Native push environment is missing.");
  return { token, provider: value.provider, environment };
}

function readNonEmptyString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
