import { createSignal, onMount, Show } from "solid-js";

import { Button } from "../ui/Button.tsx";
import { Icons } from "../../lib/Icons.tsx";

const CONSENT_STORAGE_KEY = "takos-cookie-consent";
const CONSENT_VERSION = "2026-05-07";

type CookieConsent = {
  version: string;
  essential: true;
  preferences: boolean;
  analytics: false;
  updated_at: string;
};

function readConsent(): CookieConsent | null {
  try {
    const raw = globalThis.localStorage?.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsent>;
    if (parsed.version !== CONSENT_VERSION || parsed.essential !== true) {
      return null;
    }
    return parsed as CookieConsent;
  } catch {
    return null;
  }
}

function storeConsent(preferences: boolean): void {
  const value: CookieConsent = {
    version: CONSENT_VERSION,
    essential: true,
    preferences,
    analytics: false,
    updated_at: new Date().toISOString(),
  };
  try {
    globalThis.localStorage?.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify(value),
    );
  } catch {
    // Privacy-restricted browsers may reject localStorage. The app can proceed
    // with essential session cookies only.
  }
}

export function CookieConsentBanner() {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    setVisible(readConsent() === null);
  });

  const choose = (preferences: boolean) => {
    storeConsent(preferences);
    setVisible(false);
  };

  return (
    <Show when={visible()}>
      <div
        role="region"
        aria-label="Cookie preferences"
        class="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] px-4 py-3 shadow-lg"
      >
        <div class="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="m-0 text-xs leading-5 text-[var(--color-text-secondary)] sm:max-w-2xl">
            Takos uses essential session cookies. Preference storage keeps
            choices like language and theme on this device. Analytics and ad
            tracking are disabled.{" "}
            <a
              href="/privacy"
              class="font-medium text-[var(--color-text-primary)] underline underline-offset-2"
            >
              Privacy
            </a>
          </p>
          <div class="flex shrink-0 gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icons.X class="h-4 w-4" aria-hidden="true" />}
              onClick={() => choose(false)}
            >
              Essential only
            </Button>
            <Button
              size="sm"
              leftIcon={<Icons.Check class="h-4 w-4" aria-hidden="true" />}
              onClick={() => choose(true)}
            >
              Allow preferences
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
