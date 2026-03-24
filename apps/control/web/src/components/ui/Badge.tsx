import { type HTMLAttributes, type CSSProperties } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';
type BadgeSize = 'sm' | 'md';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const variantStyles: Record<BadgeVariant, CSSProperties> = {
  default: {
    backgroundColor: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-primary)',
  },
  success: {
    backgroundColor: 'var(--color-success-bg)',
    color: 'var(--color-success)',
  },
  warning: {
    backgroundColor: 'var(--color-warning-bg)',
    color: 'var(--color-warning)',
  },
  error: {
    backgroundColor: 'var(--color-error-bg)',
    color: 'var(--color-error)',
  },
  info: {
    backgroundColor: 'var(--color-info-bg)',
    color: 'var(--color-info)',
  },
};

export function Badge({
  variant = 'default',
  size = 'sm',
  children,
  className = '',
  style,
  ...props
}: BadgeProps) {
  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 'var(--radius-full)',
    fontWeight: 500,
    padding: size === 'sm' ? '0.125rem 0.5rem' : '0.25rem 0.75rem',
    fontSize: size === 'sm' ? '0.75rem' : '0.875rem',
    transition: 'var(--transition-colors)',
  };

  return (
    <span
      className={className}
      style={{ ...baseStyle, ...variantStyles[variant], ...style }}
      {...props}
    >
      {children}
    </span>
  );
}
