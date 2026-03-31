import { splitProps } from 'solid-js';
import type { JSX } from 'solid-js';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: JSX.Element;
  rightIcon?: JSX.Element;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-primary)] text-[var(--color-text-inverted)] hover:bg-[var(--color-primary-hover)]',
  secondary: 'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border-primary)] hover:bg-[var(--color-bg-tertiary)]',
  ghost: 'bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]',
  danger: 'bg-[var(--color-error)] text-white hover:opacity-90',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-xs min-h-[36px]',
  md: 'px-4 py-2.5 text-sm min-h-[44px]',
  lg: 'px-6 py-3 text-base min-h-[48px]',
};

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    'variant', 'size', 'isLoading', 'leftIcon', 'rightIcon', 'children', 'disabled', 'class',
  ]);

  const baseClasses = 'inline-flex items-center justify-center gap-2 font-medium rounded-[var(--radius-md)] transition-colors cursor-pointer border-none outline-none';

  return (
    <button
      class={`${baseClasses} ${variantClasses[local.variant ?? 'primary']} ${sizeClasses[local.size ?? 'md']} ${local.disabled || local.isLoading ? 'opacity-50 cursor-not-allowed' : ''} ${local.class ?? ''}`}
      disabled={local.disabled || local.isLoading}
      {...rest}
    >
      {local.isLoading ? <LoadingSpinner /> : local.leftIcon}
      {local.children}
      {!local.isLoading && local.rightIcon}
    </button>
  );
}

function LoadingSpinner() {
  return (
    <svg
      class="w-4 h-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"
      />
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
