import { createUniqueId, splitProps } from "solid-js";
import type { JSX } from "solid-js";

interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: JSX.Element;
  rightIcon?: JSX.Element;
  error?: string;
  ref?: HTMLInputElement | ((el: HTMLInputElement) => void);
}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, [
    "leftIcon",
    "rightIcon",
    "error",
    "class",
    "ref",
    "aria-describedby",
    "aria-invalid",
  ]);

  const errorId = createUniqueId();
  const describedBy = () =>
    [local["aria-describedby"], local.error ? errorId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div>
      <div class="relative flex items-center">
        {local.leftIcon && (
          <span
            aria-hidden="true"
            class="pointer-events-none absolute left-3 text-[var(--color-text-tertiary)] flex items-center justify-center w-5 h-5"
          >
            {local.leftIcon}
          </span>
        )}
        <input
          ref={local.ref}
          class={`
            w-full py-2.5 text-base min-h-[44px]
            bg-[var(--color-surface-primary)] text-[var(--color-text-primary)]
            border rounded-[var(--radius-md)] outline-none transition-colors
            focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-border-focus)]/20
            ${local.leftIcon ? "pl-10" : "pl-3"}
            ${local.rightIcon ? "pr-12" : "pr-3"}
            ${
            local.error
              ? "border-[var(--color-error)]"
              : "border-[var(--color-border-primary)]"
          }
            ${local.class ?? ""}
          `}
          {...rest}
          aria-invalid={local.error ? "true" : local["aria-invalid"]}
          aria-describedby={describedBy()}
        />
        {local.rightIcon && (
          <span class="absolute right-1 text-[var(--color-text-tertiary)] flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-8 sm:min-h-8">
            {local.rightIcon}
          </span>
        )}
      </div>
      {local.error && (
        <p id={errorId} role="alert" class="mt-1 text-xs text-[var(--color-error)]">
          {local.error}
        </p>
      )}
    </div>
  );
}
