import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { JSX } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  class?: string;
  maxItems?: number;
  separator?: JSX.Element;
}

export function Breadcrumb(props: BreadcrumbProps) {
  const [isCollapsed, setIsCollapsed] = createSignal(false);
  const [showDropdown, setShowDropdown] = createSignal(false);
  let containerRef: HTMLElement | undefined;
  let dropdownRef: HTMLDivElement | undefined;

  const checkWidth = () => {
    setIsCollapsed(
      (containerRef?.offsetWidth ?? Infinity) < 400 ||
        props.items.length > (props.maxItems ?? 4),
    );
  };

  createEffect(checkWidth);

  onMount(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() =>
      document.removeEventListener("mousedown", handleClickOutside)
    );

    checkWidth();
    globalThis.addEventListener("resize", checkWidth);
    onCleanup(() => globalThis.removeEventListener("resize", checkWidth));
  });

  const separatorElement = () =>
    props.separator ?? (
      <Icons.ChevronRight class="w-4 h-4 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
    );

  const renderItem = (
    item: BreadcrumbItem,
    _index: number,
    isLast: boolean,
  ) => {
    const content = (
      <span
        class={`
          text-sm truncate max-w-[150px]
          ${
          isLast
            ? "text-zinc-900 dark:text-zinc-100 font-medium"
            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        }
          ${!isLast && (item.href || item.onClick) ? "cursor-pointer" : ""}
        `}
      >
        {item.label}
      </span>
    );

    if (isLast) {
      return content;
    }

    if (item.href) {
      return (
        <a
          href={item.href}
          class="hover:underline transition-colors"
          onClick={(e) => {
            if (item.onClick) {
              e.preventDefault();
              item.onClick();
            }
          }}
        >
          {content}
        </a>
      );
    }

    if (item.onClick) {
      return (
        <button
          type="button"
          class="hover:underline transition-colors bg-transparent border-none p-0 cursor-pointer"
          onClick={item.onClick}
        >
          {content}
        </button>
      );
    }

    return content;
  };

  return (
    <Show when={props.items.length > 0}>
      <Show
        when={isCollapsed() && props.items.length > 2}
        fallback={
          <nav
            ref={containerRef}
            class={`flex items-center gap-2 min-w-0 flex-wrap ${
              props.class ?? ""
            }`}
            aria-label="Breadcrumb"
          >
            <For each={props.items}>
              {(item, index) => {
                const isLast = index() === props.items.length - 1;
                return (
                  <>
                    <div class="flex items-center min-w-0">
                      {renderItem(item, index(), isLast)}
                    </div>
                    <Show when={!isLast}>{separatorElement()}</Show>
                  </>
                );
              }}
            </For>
          </nav>
        }
      >
        <nav
          ref={containerRef}
          class={`flex items-center gap-2 min-w-0 ${props.class ?? ""}`}
          aria-label="Breadcrumb"
        >
          <div class="flex items-center gap-2 min-w-0">
            {renderItem(props.items[0], 0, false)}
            {separatorElement()}
          </div>

          <div class="relative" ref={dropdownRef}>
            <button
              type="button"
              class="flex items-center justify-center w-6 h-6 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 transition-colors"
              onClick={() => setShowDropdown(!showDropdown())}
              aria-label="Show more items"
            >
              <Icons.MoreHorizontal class="w-4 h-4" />
            </button>

            <Show when={showDropdown()}>
              <div class="absolute left-0 top-full mt-1 z-50 min-w-[150px] py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg">
                <For each={props.items.slice(1, -1)}>
                  {(item) => (
                    <button
                      type="button"
                      class="w-full px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                      onClick={() => {
                        if (item.onClick) item.onClick();
                        else if (item.href) {
                          globalThis.location.href = item.href;
                        }
                        setShowDropdown(false);
                      }}
                    >
                      {item.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {separatorElement()}

          <div class="flex items-center min-w-0">
            {renderItem(
              props.items[props.items.length - 1],
              props.items.length - 1,
              true,
            )}
          </div>
        </nav>
      </Show>
    </Show>
  );
}
