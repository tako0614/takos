import { useI18n } from '../../store/i18n.ts';
import { Button } from '../../components/ui/index.ts';
import { Section } from './SettingsShared.tsx';

export function SettingsLanguage() {
  const { t, lang, setLang } = useI18n();

  return (
    <Section title={t('language')}>
      <div class="flex gap-2">
        <Button
          variant={lang === 'ja' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setLang('ja')}
        >
          日本語
        </Button>
        <Button
          variant={lang === 'en' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setLang('en')}
        >
          English
        </Button>
      </div>
    </Section>
  );
}
