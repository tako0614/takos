import { useI18n } from "../../store/i18n.ts";
import { Button } from "../../components/ui/index.ts";
import { Section } from "./SettingsShared.tsx";

export function SettingsLanguage() {
  const i18n = useI18n();
  const t = i18n.t;

  return (
    <Section title={t("language")}>
      <div class="flex gap-2">
        <Button
          variant={i18n.lang === "ja" ? "primary" : "secondary"}
          size="sm"
          class="min-h-[44px] md:min-h-[36px]"
          aria-pressed={i18n.lang === "ja"}
          onClick={() => i18n.setLang("ja")}
        >
          日本語
        </Button>
        <Button
          variant={i18n.lang === "en" ? "primary" : "secondary"}
          size="sm"
          class="min-h-[44px] md:min-h-[36px]"
          aria-pressed={i18n.lang === "en"}
          onClick={() => i18n.setLang("en")}
        >
          English
        </Button>
      </div>
    </Section>
  );
}
