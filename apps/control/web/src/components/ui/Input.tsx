import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ leftIcon, rightIcon, error, className = '', ...props }, ref) => {
    return (
      <div>
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3 text-[var(--color-text-tertiary)] flex items-center justify-center w-5 h-5">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            className={`
              w-full py-2.5 text-base min-h-[44px]
              bg-[var(--color-surface-primary)] text-[var(--color-text-primary)]
              border rounded-[var(--radius-md)] outline-none transition-colors
              focus:border-[var(--color-border-focus)]
              ${leftIcon ? 'pl-10' : 'pl-3'}
              ${rightIcon ? 'pr-10' : 'pr-3'}
              ${error ? 'border-[var(--color-error)]' : 'border-[var(--color-border-primary)]'}
              ${className}
            `}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 text-[var(--color-text-tertiary)] flex items-center justify-center w-5 h-5">
              {rightIcon}
            </span>
          )}
        </div>
        {error && (
          <p className="mt-1 text-xs text-[var(--color-error)]">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
