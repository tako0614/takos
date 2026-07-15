import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { appDataDir, join } from "@tauri-apps/api/path";
import { scan, Format } from "@tauri-apps/plugin-barcode-scanner";
import { authenticate } from "@tauri-apps/plugin-biometric";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import { load } from "@tauri-apps/plugin-store";
import { Stronghold } from "@tauri-apps/plugin-stronghold";
import {
  createTauriMobileDefaultProductBridge,
  type NativeBridge,
  type TauriPushNotificationsAdapter,
} from "@takosjp/takosumi-mobile-kit";
import { takosMobilePushPlugin } from "./mobile-push.ts";
import { productAdapter } from "./product.ts";

export interface ProductNativeBridgeOptions {
  readonly pushNotifications?: TauriPushNotificationsAdapter;
}

export function createProductNativeBridge(
  options: ProductNativeBridgeOptions = {},
): NativeBridge {
  const opener = { openUrl };
  const store = { load };
  return createTauriMobileDefaultProductBridge({
    productAdapter,
    keychainService: "jp.takos.mobile",
    invoke,
    path: {
      appDataDir,
      join,
    },
    deepLink: {
      getCurrent,
      onOpenUrl,
    },
    opener,
    store,
    stronghold: Stronghold,
    platform: {
      platform,
    },
    notification: {
      isPermissionGranted,
      requestPermission,
      sendNotification,
    },
    barcodeScanner: {
      scan,
      qrCodeFormat: Format.QRCode,
    },
    pushNotifications: options.pushNotifications,
    mobilePush: takosMobilePushPlugin,
    biometric: {
      authenticate,
    },
    clipboard: {
      writeText,
    },
  });
}
