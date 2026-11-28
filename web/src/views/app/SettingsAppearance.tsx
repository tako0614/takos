import { useI18n } from "../../store/i18n.ts";
import { type Theme, useTheme } from "../../store/theme.ts";
import { Button } from "../../components/ui/index.ts";
import { Section } from "./SettingsShared.tsx";

const THEME_OPTIONS: ReadonlyArray<{
  value: Theme;
  labelKey: "themeSystem" | "themeLight" | "themeDark";
}> = [
  { value: "system", labelKey: "themeSystem" },
  { value: "light", labelKey: "themeLight" },
  { value: "dark", labelKey: "themeDark" },
];

export function SettingsAppearance() {
  const { t } = useI18n();
  const theme = useTheme();

  return (
    <Section title={t("appearance")}>
      <div class="flex flex-wrap gap-2">
        {THEME_OPTIONS.map((option) => (
          <Button
            variant={theme.themePreference === option.value
              ? "primary"
              : "secondary"}
            size="sm"
            class="min-h-[44px] md:min-h-[36px]"
            aria-pressed={theme.themePreference === option.value}
            onClick={() => theme.setThemePreference(option.value)}
          >
            {t(option.labelKey)}
          </Button>
        ))}
      </div>
    </Section>
  );
}
