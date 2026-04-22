import { createSignal } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Button } from "../../components/ui/index.ts";
import type { UserSettings } from "../../types/index.ts";
import { Section, Toggle } from "./SettingsShared.tsx";

export function SettingsPreferences(props: {
  userSettings: UserSettings;
  onSettingsChange?: (settings: UserSettings) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = createSignal(false);

  const updateSetting = async (patch: Partial<UserSettings>) => {
    if (saving()) return;
    setSaving(true);
    try {
      const res = await rpc.me.settings.$patch({ json: patch });
      const settings = await rpcJson<UserSettings>(res);
      props.onSettingsChange?.(settings);
    } catch (err) {
      console.error("Failed to update settings:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Section title={t("autoUpdateSettings")}>
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm text-zinc-500 dark:text-zinc-400">
              {t("autoUpdateHint")}
            </p>
          </div>
          <div class="flex items-center gap-3">
            {saving() && (
              <Icons.Loader class="h-4 w-4 animate-spin text-zinc-400" />
            )}
            <Toggle
              checked={props.userSettings.auto_update_enabled}
              onChange={(v) => updateSetting({ auto_update_enabled: v })}
              disabled={saving()}
            />
          </div>
        </div>
      </Section>

      <Section title={t("privacyTitle")}>
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t("privateAccount")}
              </div>
              <div class="text-sm text-zinc-500 dark:text-zinc-400">
                {t("requireApprovalForFollowers")}
              </div>
            </div>
            <Toggle
              checked={props.userSettings.private_account}
              onChange={(v) => updateSetting({ private_account: v })}
              disabled={saving()}
            />
          </div>

          <div>
            <div class="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
              {t("activityVisibility")}
            </div>
            <div class="flex flex-wrap gap-2">
              {(["public", "followers", "private"] as const).map((v) => (
                <Button
                  variant={props.userSettings.activity_visibility === v
                    ? "primary"
                    : "secondary"}
                  size="sm"
                  onClick={() => updateSetting({ activity_visibility: v })}
                  disabled={saving()}
                >
                  {v === "public"
                    ? t("visibilityPublic")
                    : v === "followers"
                    ? t("visibilityFollowers")
                    : t("visibilityPrivate")}
                </Button>
              ))}
              {saving() && (
                <Icons.Loader class="h-4 w-4 animate-spin text-zinc-400" />
              )}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
