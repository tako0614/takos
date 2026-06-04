import { Icons } from "../../lib/Icons.tsx";
import { TermsContent } from "./content/TermsContent.tsx";
import { PrivacyContent } from "./content/PrivacyContent.tsx";
import { SecurityDisclosureContent } from "./content/SecurityDisclosureContent.tsx";
import { TokushohoContent } from "./content/TokushohoContent.tsx";

type LegalPageType = "terms" | "privacy" | "security" | "tokushoho";

interface LegalPageProps {
  page: LegalPageType;
}

export function LegalPage(props: LegalPageProps) {
  return (
    <div class="min-h-screen bg-white dark:bg-zinc-900">
      <header class="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div class="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <a
            href="/"
            class="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400"
          >
            <Icons.ArrowLeft class="w-4 h-4" />
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
        <footer class="mt-12 pt-6 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-400 dark:text-zinc-500 flex gap-4">
          <a href="/terms" class="hover:text-zinc-600">
            利用規約
          </a>
          <a href="/privacy" class="hover:text-zinc-600">
            プライバシーポリシー
          </a>
          <a href="/security" class="hover:text-zinc-600">
            脆弱性報告
          </a>
          <a href="/legal/tokushoho" class="hover:text-zinc-600">
            特定商取引法に基づく表記
          </a>
        </footer>
      </main>
    </div>
  );
}
