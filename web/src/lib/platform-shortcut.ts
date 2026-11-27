export interface NavigatorPlatformLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
}

const APPLE_PLATFORM_RE = /mac|iphone|ipad|ipod/i;

export function isApplePlatform(
  nav: NavigatorPlatformLike | undefined = globalThis.navigator as
    | NavigatorPlatformLike
    | undefined,
): boolean {
  if (!nav) return false;
  const uaPlatform = nav.userAgentData?.platform;
  if (typeof uaPlatform === "string" && uaPlatform.length > 0) {
    return APPLE_PLATFORM_RE.test(uaPlatform);
  }
  const platform = nav.platform ?? "";
  if (platform.length > 0) {
    return APPLE_PLATFORM_RE.test(platform);
  }
  return APPLE_PLATFORM_RE.test(nav.userAgent ?? "");
}

export function getSearchShortcutParts(
  nav?: NavigatorPlatformLike,
): readonly [string, string] {
  return isApplePlatform(nav) ? ["⌘", "K"] : ["Ctrl", "K"];
}

export function formatSearchShortcut(nav?: NavigatorPlatformLike): string {
  const [mod, key] = getSearchShortcutParts(nav);
  return mod === "⌘" ? `${mod}${key}` : `${mod}+${key}`;
}
