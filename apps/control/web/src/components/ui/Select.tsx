import { useState, useRef, useEffect, type CSSProperties } from 'react';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
  style?: CSSProperties;
}

export function Select({
  options,
  value,
  placeholder = 'Select an option',
  onChange,
  disabled = false,
  error,
  className = '',
  style,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const triggerStyle: CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    backgroundColor: 'var(--color-surface-primary)',
    color: selectedOption ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
    border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border-primary)'}`,
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    opacity: disabled ? 0.5 : 1,
    transition: 'var(--transition-colors)',
  };

  const dropdownStyle: CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '0.25rem',
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border-primary)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-lg)',
    zIndex: 50,
    maxHeight: '15rem',
    overflowY: 'auto',
  };

  const optionStyle = (opt: SelectOption, isSelected: boolean): CSSProperties => ({
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    cursor: opt.disabled ? 'not-allowed' : 'pointer',
    backgroundColor: isSelected ? 'var(--color-bg-tertiary)' : 'transparent',
    color: opt.disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
    opacity: opt.disabled ? 0.5 : 1,
    transition: 'var(--transition-colors)',
  });

  return (
    <div ref={ref} className={className} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        style={triggerStyle}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span>{selectedOption?.label || placeholder}</span>
        <ChevronIcon isOpen={isOpen} />
      </button>

      {isOpen && (
        <div style={dropdownStyle}>
          {options.map((opt) => (
            <div
              key={opt.value}
              style={optionStyle(opt, opt.value === value)}
              onClick={() => {
                if (!opt.disabled) {
                  onChange?.(opt.value);
                  setIsOpen(false);
                }
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--color-error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{
        transition: 'transform 0.15s ease',
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
