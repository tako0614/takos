import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

type ResizeOption = NonNullable<TextareaProps['resize']>;

const resizeClasses: Record<ResizeOption, string> = {
  none: 'resize-none',
  vertical: 'resize-y',
  horizontal: 'resize-x',
  both: 'resize',
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, resize = 'vertical', className = '', ...props }, ref) => {
    return (
      <div>
        <textarea
          ref={ref}
          className={`
            w-full px-3 py-2.5 text-base min-h-[5rem] font-[inherit]
            bg-[var(--color-surface-primary)] text-[var(--color-text-primary)]
            border rounded-[var(--radius-md)] outline-none transition-colors
            focus:border-[var(--color-border-focus)]
            ${error ? 'border-[var(--color-error)]' : 'border-[var(--color-border-primary)]'}
            ${resizeClasses[resize]}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-[var(--color-error)]">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
