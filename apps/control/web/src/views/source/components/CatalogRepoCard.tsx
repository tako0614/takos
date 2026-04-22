import { createSignal } from "solid-js";
import { Icons } from "../../../lib/Icons.tsx";
import type {
  SourceItem,
  SourceItemPackage,
} from "../../../hooks/useSourceData.ts";

interface CatalogRepoCardProps {
  item: SourceItem;
  pkg: SourceItemPackage;
  installingId: string | null;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onStar: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
  onManage: (action: "rollback" | "uninstall", item: SourceItem) => void;
}

export function CatalogRepoCard(props: CatalogRepoCardProps) {
  const [manageOpen, setManageOpen] = createSignal(false);
  const installing = () => props.installingId === props.item.id;
  const installed = () => props.item.installation?.installed ?? false;
  const canStar = () => props.item.catalog_origin !== "default_app";

  const ownerUsername = () =>
    props.item.owner.username || props.item.owner.name || "?";
  const ownerInitial = () => ownerUsername().charAt(0).toUpperCase();

  return (
    <article
      class="group relative rounded-2xl bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col p-3"
      onClick={() => props.onSelect(props.item)}
    >
      {/* App icon */}
      <div class="mb-2.5">
        {props.item.owner.avatar_url
          ? (
            <img
              src={props.item.owner.avatar_url}
              alt=""
              class="w-12 h-12 rounded-xl object-cover"
            />
          )
          : (
            <div class="w-12 h-12 rounded-xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xl font-bold text-zinc-500 dark:text-zinc-300">
              {ownerInitial()}
            </div>
          )}
      </div>

      {/* Name */}
      <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight">
        {props.item.name}
      </h3>

      {/* Owner */}
      <p class="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5 mb-1.5">
        @{ownerUsername()}
      </p>

      {/* Description */}
      {props.item.description
        ? (
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed flex-1">
            {props.item.description}
          </p>
        )
        : <div class="flex-1" />}

      {/* Bottom row */}
      <div
        class="flex items-center justify-between mt-2.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Star */}
        {canStar()
          ? (
            <button
              type="button"
              class={`flex items-center gap-1 text-[11px] transition-colors ${
                props.item.is_starred
                  ? "text-amber-500 dark:text-amber-400"
                  : "text-zinc-400 dark:text-zinc-500 hover:text-amber-500"
              }`}
              onClick={() => props.onStar(props.item)}
            >
              <Icons.Star class="w-3.5 h-3.5" />
              {props.item.stars > 0 ? props.item.stars : ""}
            </button>
          )
          : (
            <span class="text-[11px] font-medium text-blue-500 dark:text-blue-400">
              Default
            </span>
          )}

        {/* Primary action */}
        {props.item.is_mine
          ? (
            <button
              type="button"
              class="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              onClick={() => props.onOpenRepo(props.item)}
            >
              Open
            </button>
          )
          : installed()
          ? (
            <div class="relative">
              <button
                type="button"
                class="flex items-center gap-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
                onClick={() => setManageOpen((prev) => !prev)}
              >
                <Icons.Check class="w-3 h-3" />
                {props.item.installation?.installed_version
                  ? `v${props.item.installation.installed_version}`
                  : "Installed"}
                <Icons.ChevronDown class="w-2.5 h-2.5 ml-0.5" />
              </button>
              {manageOpen() && (
                <>
                  <div
                    class="fixed inset-0 z-10"
                    onClick={() => setManageOpen(false)}
                  />
                  <div class="absolute right-0 bottom-full mb-1 z-20 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-[130px]">
                    <button
                      type="button"
                      class="w-full text-left px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      onClick={() => {
                        props.onManage("rollback", props.item);
                        setManageOpen(false);
                      }}
                    >
                      Rollback
                    </button>
                    <button
                      type="button"
                      class="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      onClick={() => {
                        props.onManage("uninstall", props.item);
                        setManageOpen(false);
                      }}
                    >
                      Uninstall
                    </button>
                  </div>
                </>
              )}
            </div>
          )
          : props.pkg.available
          ? (
            <button
              type="button"
              disabled={installing()}
              class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 disabled:opacity-40 transition-colors"
              onClick={() => props.onInstall(props.item)}
            >
              {installing()
                ? <Icons.Loader class="w-3.5 h-3.5 animate-spin inline" />
                : (
                  "Install"
                )}
            </button>
          )
          : (
            <button
              type="button"
              class="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
              onClick={() => props.onOpenRepo(props.item)}
            >
              View
            </button>
          )}
      </div>
    </article>
  );
}
