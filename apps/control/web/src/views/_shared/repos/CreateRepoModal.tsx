import { createSignal } from "solid-js";
import { useI18n } from "../../../store/i18n.ts";
import { Icons } from "../../../lib/Icons.tsx";

interface CreateRepoModalProps {
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    visibility: "public" | "private",
  ) => void;
}

export function CreateRepoModal(props: CreateRepoModalProps) {
  const { t } = useI18n();
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [visibility, setVisibility] = createSignal<"public" | "private">(
    "private",
  );

  const handleSubmit = (e: Event & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    if (!name().trim()) return;
    props.onCreate(name().trim(), description().trim(), visibility());
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      props.onClose();
    }
  };

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={() => props.onClose()}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-repo-modal-title"
        class="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl w-full max-w-lg mx-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h2
            id="create-repo-modal-title"
            class="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {t("createRepository") || "Create Repository"}
          </h2>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900"
            onClick={() => props.onClose()}
            aria-label={t("close") || "Close"}
          >
            <Icons.X class="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div class="px-6 py-4 space-y-4">
            <div class="space-y-2">
              <label
                for="repo-name"
                class="block text-sm font-medium text-zinc-500 dark:text-zinc-400"
              >
                {t("repositoryName") || "Repository name"}{" "}
                <span class="text-zinc-500">*</span>
              </label>
              <input
                id="repo-name"
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="my-awesome-project"
                autofocus
                class="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors"
                aria-required="true"
              />
            </div>
            <div class="space-y-2">
              <label
                for="repo-description"
                class="block text-sm font-medium text-zinc-500 dark:text-zinc-400"
              >
                {t("description") || "Description"}{" "}
                <span class="text-zinc-500">
                  ({t("optional") || "optional"})
                </span>
              </label>
              <textarea
                id="repo-description"
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder={t("repositoryDescriptionPlaceholder") ||
                  "A short description of your repository"}
                rows={3}
                class="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors resize-none"
              />
            </div>
            <div class="space-y-2">
              <span class="block text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {t("visibility") || "Visibility"}
              </span>
              <div class="space-y-2">
                <label
                  class={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    visibility() === "public"
                      ? "border-zinc-900 dark:border-zinc-100 bg-white/10"
                      : "border-zinc-200 dark:border-zinc-700 hover:bg-white/10"
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    checked={visibility() === "public"}
                    onChange={() => setVisibility("public")}
                    class="sr-only"
                  />
                  <Icons.Globe class="w-5 h-5 text-zinc-900" />
                  <div class="flex-1">
                    <strong class="block text-sm text-zinc-900 dark:text-zinc-100">
                      Public
                    </strong>
                    <span class="text-xs text-zinc-500 dark:text-zinc-400">
                      Anyone can see this repository
                    </span>
                  </div>
                </label>
                <label
                  class={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    visibility() === "private"
                      ? "border-zinc-900 dark:border-zinc-100 bg-white/10"
                      : "border-zinc-200 dark:border-zinc-700 hover:bg-white/10"
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    checked={visibility() === "private"}
                    onChange={() => setVisibility("private")}
                    class="sr-only"
                  />
                  <Icons.Lock class="w-5 h-5 text-zinc-500" />
                  <div class="flex-1">
                    <strong class="block text-sm text-zinc-900 dark:text-zinc-100">
                      Private
                    </strong>
                    <span class="text-xs text-zinc-500 dark:text-zinc-400">
                      Only you can see this repository
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              class="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500"
              onClick={() => props.onClose()}
            >
              {t("cancel") || "Cancel"}
            </button>
            <button
              type="submit"
              class="px-4 py-2 bg-zinc-900 dark:bg-zinc-700 text-white rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 focus:ring-offset-zinc-950"
              disabled={!name().trim()}
              aria-disabled={!name().trim()}
            >
              {t("createRepository") || "Create Repository"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
