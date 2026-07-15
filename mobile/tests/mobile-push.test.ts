import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type {
  PluginListener,
  addPluginListener,
  invoke,
} from "@tauri-apps/api/core";

import { createTakosMobilePushPluginModule } from "../src/mobile-push.ts";

test("Takos native push reads FCM installation metadata and unregisters", async () => {
  const calls: Array<{ command: string; args?: unknown }> = [];
  const module = createTakosMobilePushPluginModule({
    invoke: (async (command: string, args?: unknown) => {
      calls.push({ command, args });
      if (command.endsWith("request_permission")) return { granted: true };
      if (command.endsWith("get_token")) {
        return {
          token: " fcm-installation-id ",
          provider: "fcm",
          environment: "production",
        };
      }
      return undefined;
    }) as typeof invoke,
    addPluginListener: (async () => listener()) as typeof addPluginListener,
  });

  expect(await module.requestPermission()).toEqual({ granted: true });
  expect(await module.getToken()).toEqual({
    token: "fcm-installation-id",
    provider: "fcm",
    environment: "production",
  });
  await module.unregister?.();
  expect(calls.map((call) => call.command)).toEqual([
    "plugin:mobile-push|request_permission",
    "plugin:mobile-push|get_token",
    "plugin:mobile-push|unregister",
  ]);
});

test("Takos native push activates after registering and clears after unlisten", async () => {
  const order: string[] = [];
  let receivedHandler: ((payload: unknown) => void) | undefined;
  const module = createTakosMobilePushPluginModule({
    invoke: (async (command: string, args?: unknown) => {
      order.push(`${command}:${JSON.stringify(args)}`);
    }) as typeof invoke,
    addPluginListener: (async <T>(
      plugin: string,
      event: string,
      handler: (payload: T) => void,
    ) => {
      order.push(`listen:${plugin}:${event}`);
      receivedHandler = handler as (payload: unknown) => void;
      return listener(() => order.push("unlisten"));
    }) as typeof addPluginListener,
  });

  const seen: unknown[] = [];
  const subscription = await module.onNotificationReceived!((payload) => {
    seen.push(payload);
  });
  receivedHandler?.({ title: "New message", data: { event_id: "event-1" } });
  await subscription.unregister();
  await subscription.unregister();

  expect(seen).toEqual([
    { title: "New message", data: { event_id: "event-1" } },
  ]);
  expect(order).toEqual([
    "listen:mobile-push:notification-received",
    'plugin:mobile-push|activate_event:{"payload":{"event":"notification-received"}}',
    "unlisten",
    'plugin:mobile-push|deactivate_event:{"payload":{"event":"notification-received"}}',
  ]);
});

test("Takos native push rejects malformed provider metadata", async () => {
  const module = createTakosMobilePushPluginModule({
    invoke: (async () => ({
      token: "device-token",
      provider: "unknown",
      environment: "production",
    })) as typeof invoke,
    addPluginListener: (async () => listener()) as typeof addPluginListener,
  });

  expect(module.getToken()).rejects.toThrow("provider is invalid");
});

test("Takos native push removes a listener when native activation fails", async () => {
  let unregistered = 0;
  const commands: string[] = [];
  const module = createTakosMobilePushPluginModule({
    invoke: (async (command: string) => {
      commands.push(command);
      if (command === "plugin:mobile-push|activate_event") {
        throw new Error("activation failed");
      }
    }) as typeof invoke,
    addPluginListener: (async () =>
      listener(() => {
        unregistered += 1;
      })) as typeof addPluginListener,
  });

  expect(module.onTokenRefresh!(() => undefined)).rejects.toThrow(
    "activation failed",
  );
  expect(unregistered).toBe(1);
  expect(commands).toEqual([
    "plugin:mobile-push|activate_event",
    "plugin:mobile-push|deactivate_event",
  ]);
});

test("Takos native push retries listener and native cleanup boundaries", async () => {
  let unregisterAttempts = 0;
  let deactivateAttempts = 0;
  const module = createTakosMobilePushPluginModule({
    invoke: (async (command: string) => {
      if (command === "plugin:mobile-push|deactivate_event") {
        deactivateAttempts += 1;
        if (deactivateAttempts === 1) throw new Error("response lost");
      }
    }) as typeof invoke,
    addPluginListener: (async () =>
      listener(() => {
        unregisterAttempts += 1;
        if (unregisterAttempts === 1) throw new Error("response lost");
      })) as typeof addPluginListener,
  });

  const subscription = await module.onNotificationTapped!(() => undefined);
  await subscription.unregister();

  expect(unregisterAttempts).toBe(2);
  expect(deactivateAttempts).toBe(2);
});

test("iOS native push keeps APNs tokens session-local and trusts the signed entitlement", () => {
  const source = readFileSync(
    new URL(
      "../src-tauri/plugins/mobile-push/ios/Sources/MobilePushPlugin.swift",
      import.meta.url,
    ),
    "utf8",
  );
  expect(source).toContain(
    "UIApplication.shared.registerForRemoteNotifications()",
  );
  expect(source).toContain(
    "UIApplication.shared.unregisterForRemoteNotifications()",
  );
  expect(source).toContain("registrationRequested = false");
  expect(source).toContain(
    "Registration is session-bound and starts from getToken()",
  );
  expect(source).toContain("SecTaskCopyValueForEntitlement");
  expect(source).toContain('"aps-environment" as CFString');
  expect(source).toContain('case "development":');
  expect(source).toContain('return "sandbox"');
  expect(source).toContain('case "production":');
  expect(source).toContain('return "production"');
  expect(source).not.toContain("#if DEBUG");
  expect(source).not.toContain("UserDefaults");
  expect(
    source.match(/invoke\.reject\("APNs device token is unavailable\."\)/g),
  ).toHaveLength(1);
});

test("native push token requests have an explicit timeout", () => {
  const iosSource = readFileSync(
    new URL(
      "../src-tauri/plugins/mobile-push/ios/Sources/MobilePushPlugin.swift",
      import.meta.url,
    ),
    "utf8",
  );
  const androidSource = readFileSync(
    new URL(
      "../src-tauri/plugins/mobile-push/android/src/main/java/MobilePushPlugin.kt",
      import.meta.url,
    ),
    "utf8",
  );

  expect(iosSource).toContain("tokenRequestTimeoutSeconds: TimeInterval = 20");
  expect(iosSource).toContain(
    "pendingTokenInvokes.firstIndex(where: { $0 === invoke })",
  );
  expect(iosSource).toContain("APNs device token request timed out.");
  expect(androidSource).toContain(
    "REGISTRATION_REQUEST_TIMEOUT_MILLIS = 20_000L",
  );
  expect(androidSource).toContain("AtomicBoolean(false)");
  expect(androidSource).toContain("FCM registration request timed out.");
  expect(androidSource).toContain("FirebaseMessaging.getInstance().register()");
  expect(androidSource).toContain(
    "FirebaseMessaging.getInstance().unregister()",
  );
  expect(androidSource).toContain("FirebaseInstallations.getInstance().id");
  expect(androidSource).not.toContain("FirebaseMessaging.getInstance().token");
  expect(androidSource).not.toContain(".deleteToken()");
  expect(androidSource).toContain(
    "MobilePushRuntime.publish(EVENT_TOKEN_REFRESH, payload)",
  );
  expect(androidSource.indexOf("if (!registration.isSuccessful)")).toBeLessThan(
    androidSource.indexOf("val installationId = installation.result"),
  );
});

test("Android FCM registration is FID-based and session-bound", () => {
  const service = readFileSync(
    new URL(
      "../src-tauri/plugins/mobile-push/android/src/main/java/TakosFirebaseMessagingService.kt",
      import.meta.url,
    ),
    "utf8",
  );
  const manifest = readFileSync(
    new URL(
      "../src-tauri/plugins/mobile-push/android/src/main/AndroidManifest.xml",
      import.meta.url,
    ),
    "utf8",
  );

  expect(service).toContain(
    "override fun onRegistered(installationId: String)",
  );
  expect(service).not.toContain("onNewToken");
  expect(manifest).toContain("firebase_messaging_installation_id_enabled");
  expect(manifest).toContain("firebase_messaging_auto_init_enabled");
  expect(manifest).toContain('android:value="false"');
});

test("native push event activation is an idempotent cross-session barrier", () => {
  const iosSource = readFileSync(
    new URL(
      "../src-tauri/plugins/mobile-push/ios/Sources/MobilePushPlugin.swift",
      import.meta.url,
    ),
    "utf8",
  );
  const androidSource = readFileSync(
    new URL(
      "../src-tauri/plugins/mobile-push/android/src/main/java/MobilePushRuntime.kt",
      import.meta.url,
    ),
    "utf8",
  );

  expect(iosSource).toContain("activatedEvents.contains(event)");
  expect(iosSource).toContain("UNPushNotificationTrigger.self");
  expect(iosSource).not.toContain("activeListeners");
  expect(androidSource).toContain("event in activatedEvents");
  expect(androidSource).not.toContain("activeListeners");
});

function listener(onUnregister: () => void = () => undefined): PluginListener {
  return {
    plugin: "mobile-push",
    event: "test",
    channelId: 1,
    async unregister() {
      onUnregister();
    },
  } as PluginListener;
}
