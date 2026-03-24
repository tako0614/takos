import type { Lang } from '../types';

interface BilingualProps {
  lang: Lang;
  ja: React.ReactNode;
  en: React.ReactNode;
}

export function Bilingual({ lang, ja, en }: BilingualProps) {
  return <>{lang === 'ja' ? ja : en}</>;
}
