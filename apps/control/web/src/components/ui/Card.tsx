import { type HTMLAttributes, type CSSProperties } from 'react';

type CardVariant = 'default' | 'elevated' | 'outlined';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = {
  none: '0',
  sm: '0.75rem',
  md: '1rem',
  lg: '1.5rem',
};

export function Card({
  variant = 'default',
  padding = 'md',
  children,
  className = '',
  style,
  ...props
}: CardProps) {
  const baseStyle: CSSProperties = {
    backgroundColor: 'var(--color-surface-primary)',
    borderRadius: 'var(--radius-lg)',
    padding: paddingMap[padding],
    transition: 'var(--transition-colors)',
  };

  const variantStyles: Record<CardVariant, CSSProperties> = {
    default: {
      border: '1px solid var(--color-border-primary)',
    },
    elevated: {
      boxShadow: 'var(--shadow-md)',
      backgroundColor: 'var(--color-surface-elevated)',
    },
    outlined: {
      border: '1px solid var(--color-border-secondary)',
      backgroundColor: 'transparent',
    },
  };

  return (
    <div
      className={className}
      style={{ ...baseStyle, ...variantStyles[variant], ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '', style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{
        marginBottom: '1rem',
        paddingBottom: '0.75rem',
        borderBottom: '1px solid var(--color-border-primary)',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className = '', style, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={className}
      style={{
        fontSize: '1rem',
        fontWeight: 600,
        color: 'var(--color-text-primary)',
        margin: 0,
        ...style,
      }}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardContent({ children, className = '', style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className} style={{ color: 'var(--color-text-secondary)', ...style }} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = '', style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{
        marginTop: '1rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid var(--color-border-primary)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
