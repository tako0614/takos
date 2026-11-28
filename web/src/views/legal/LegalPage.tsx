import { Icons } from "../../lib/Icons.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useI18n } from "../../store/i18n.ts";
import { TermsContent } from "./content/TermsContent.tsx";
import { PrivacyContent } from "./content/PrivacyContent.tsx";
import { SecurityDisclosureContent } from "./content/SecurityDisclosureContent.tsx";
import { TokushohoContent } from "./content/TokushohoContent.tsx";

type LegalPageType = "terms" | "privacy" | "security" | "tokushoho";

interface LegalPageProps {
  page: LegalPageType;
}

// The legal documents are published in Japanese only, so the tab title
// mirrors each document's Japanese heading and footer link.
const LEGAL_PAGE_TITLES: Record<LegalPageType, string> = {
  terms: "利用規約",
  privacy: "プライバシーポリシー",
  security: "脆弱性報告",
  tokushoho: "特定商取引法に基づく表記",
};

export function LegalPage(props: LegalPageProps) {
  const { t } = useI18n();
  useDocumentTitle(() => LEGAL_PAGE_TITLES[props.page]);
  return (
    <div class="min-h-screen bg-white dark:bg-zinc-900">
      <header class="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div class="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <a
            href="/"
            aria-label={t("backToHome")}
            title={t("backToHome")}
            class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400"
          >
            <Icons.ArrowLeft class="w-4 h-4" aria-hidden="true" />
          </a>
          <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Takos
          </span>
        </div>
      </header>
      <main class="max-w-3xl mx-auto px-4 py-8">
        {props.page === "terms" && <TermsContent />}
        {props.page === "privacy" && <PrivacyContent />}
        {props.page === "security" && <SecurityDisclosureContent />}
        {props.page === "tokushoho" && <TokushohoContent />}
        <footer class="mt-12 pt-6 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 flex flex-wrap gap-x-4 gap-y-1">
          <a
            href="/terms"
            class="inline-flex min-h-[44px] items-center hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            利用規約
          </a>
          <a
            href="/privacy"
            class="inline-flex min-h-[44px] items-center hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            プライバシーポリシー
          </a>
          <a
            href="/security"
            class="inline-flex min-h-[44px] items-center hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            脆弱性報告
          </a>
          <a
            href="/legal/tokushoho"
            class="inline-flex min-h-[44px] items-center hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            特定商取引法に基づく表記
          </a>
        </footer>
      </main>
    </div>
  );
}
