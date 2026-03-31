import { splitProps } from 'solid-js';
import type { JSX } from 'solid-js';

interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: JSX.Element;
  rightIcon?: JSX.Element;
  error?: string;
  ref?: HTMLInputElement | ((el: HTMLInputElement) => void);
}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ['leftIcon', 'rightIcon', 'error', 'class', 'ref']);

  return (
    <div>
      <div class="relative flex items-center">
        {local.leftIcon && (
          <span class="absolute left-3 text-[var(--color-text-tertiary)] flex items-center justify-center w-5 h-5">
            {local.leftIcon}
          </span>
        )}
        <input
          ref={local.ref}
          class={`
            w-full py-2.5 text-base min-h-[44px]
            bg-[var(--color-surface-primary)] text-[var(--color-text-primary)]
            border rounded-[var(--radius-md)] outline-none transition-colors
            focus:border-[var(--color-border-focus)]
            ${local.leftIcon ? 'pl-10' : 'pl-3'}
            ${local.rightIcon ? 'pr-10' : 'pr-3'}
            ${local.error ? 'border-[var(--color-error)]' : 'border-[var(--color-border-primary)]'}
            ${local.class ?? ''}
          `}
          {...rest}
        />
        {local.rightIcon && (
          <span class="absolute right-3 text-[var(--color-text-tertiary)] flex items-center justify-center w-5 h-5">
            {local.rightIcon}
          </span>
        )}
      </div>
      {local.error && (
        <p class="mt-1 text-xs text-[var(--color-error)]">
          {local.error}
        </p>
      )}
    </div>
  );
}
