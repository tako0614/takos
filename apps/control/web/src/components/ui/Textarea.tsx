import { splitProps } from 'solid-js';
import type { JSX } from 'solid-js';

interface TextareaProps extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  ref?: HTMLTextAreaElement | ((el: HTMLTextAreaElement) => void);
}

type ResizeOption = NonNullable<TextareaProps['resize']>;

const resizeClasses: Record<ResizeOption, string> = {
  none: 'resize-none',
  vertical: 'resize-y',
  horizontal: 'resize-x',
  both: 'resize',
};

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ['error', 'resize', 'class', 'ref']);

  return (
    <div>
      <textarea
        ref={local.ref}
        class={`
          w-full px-3 py-2.5 text-base min-h-[5rem] font-[inherit]
          bg-[var(--color-surface-primary)] text-[var(--color-text-primary)]
          border rounded-[var(--radius-md)] outline-none transition-colors
          focus:border-[var(--color-border-focus)]
          ${local.error ? 'border-[var(--color-error)]' : 'border-[var(--color-border-primary)]'}
          ${resizeClasses[local.resize ?? 'vertical']}
          ${local.class ?? ''}
        `}
        {...rest}
      />
      {local.error && (
        <p class="mt-1 text-xs text-[var(--color-error)]">
          {local.error}
        </p>
      )}
    </div>
  );
}
