import { splitProps } from 'solid-js';
import type { JSX } from 'solid-js';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';
type BadgeSize = 'sm' | 'md';

interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const variantStyles: Record<BadgeVariant, JSX.CSSProperties> = {
  default: {
    'background-color': 'var(--color-bg-tertiary)',
    color: 'var(--color-text-primary)',
  },
  success: {
    'background-color': 'var(--color-success-bg)',
    color: 'var(--color-success)',
  },
  warning: {
    'background-color': 'var(--color-warning-bg)',
    color: 'var(--color-warning)',
  },
  error: {
    'background-color': 'var(--color-error-bg)',
    color: 'var(--color-error)',
  },
  info: {
    'background-color': 'var(--color-info-bg)',
    color: 'var(--color-info)',
  },
};

export function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'children', 'class', 'style']);

  const baseStyle = (): JSX.CSSProperties => ({
    display: 'inline-flex',
    'align-items': 'center',
    'border-radius': 'var(--radius-full)',
    'font-weight': '500',
    padding: (local.size ?? 'sm') === 'sm' ? '0.125rem 0.5rem' : '0.25rem 0.75rem',
    'font-size': (local.size ?? 'sm') === 'sm' ? '0.75rem' : '0.875rem',
    transition: 'var(--transition-colors)',
    ...variantStyles[local.variant ?? 'default'],
    ...(typeof local.style === 'object' ? local.style : {}),
  });

  return (
    <span
      class={local.class}
      style={baseStyle()}
      {...rest}
    >
      {local.children}
    </span>
  );
}
