import { type HTMLAttributes, type CSSProperties } from 'react';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  name?: string;
  size?: AvatarSize;
}

const sizeMap: Record<AvatarSize, { size: string; fontSize: string }> = {
  xs: { size: '1.5rem', fontSize: '0.625rem' },
  sm: { size: '2rem', fontSize: '0.75rem' },
  md: { size: '2.5rem', fontSize: '0.875rem' },
  lg: { size: '3rem', fontSize: '1rem' },
  xl: { size: '4rem', fontSize: '1.25rem' },
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

export function Avatar({
  src,
  alt,
  name,
  size = 'md',
  className = '',
  style,
  ...props
}: AvatarProps) {
  const { size: dimension, fontSize } = sizeMap[size];

  const baseStyle: CSSProperties = {
    width: dimension,
    height: dimension,
    borderRadius: 'var(--radius-full)',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: name ? stringToColor(name) : 'var(--color-bg-tertiary)',
    color: 'white',
    fontSize: fontSize,
    fontWeight: 500,
  };

  if (src) {
    return (
      <div className={className} style={{ ...baseStyle, ...style }} {...props}>
        <img
          src={src}
          alt={alt || name || 'Avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  return (
    <div className={className} style={{ ...baseStyle, ...style }} {...props}>
      {name ? getInitials(name) : '?'}
    </div>
  );
}
