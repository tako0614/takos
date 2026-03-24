import { Fragment, useState, useEffect, useRef, type ReactNode } from 'react';
import { Icons } from '../../lib/Icons';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
  maxItems?: number;
  separator?: ReactNode;
}

export function Breadcrumb({
  items,
  className = '',
  maxItems = 4,
  separator,
}: BreadcrumbProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  useEffect(() => {
    const checkWidth = () => {
      if (containerRef.current) {
        setIsCollapsed(containerRef.current.offsetWidth < 400 || items.length > maxItems);
      }
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, [items.length, maxItems]);

  if (items.length === 0) return null;

  const separatorElement = separator || (
    <Icons.ChevronRight className="w-4 h-4 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
  );

  const renderItem = (item: BreadcrumbItem, index: number, isLast: boolean) => {
    const content = (
      <span
        className={`
          text-sm truncate max-w-[150px]
          ${isLast
            ? 'text-zinc-900 dark:text-zinc-100 font-medium'
            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
          }
          ${!isLast && (item.href || item.onClick) ? 'cursor-pointer' : ''}
        `}
      >
        {item.label}
      </span>
    );

    if (isLast) {
      return content;
    }

    if (item.href) {
      return (
        <a
          href={item.href}
          className="hover:underline transition-colors"
          onClick={(e) => {
            if (item.onClick) {
              e.preventDefault();
              item.onClick();
            }
          }}
        >
          {content}
        </a>
      );
    }

    if (item.onClick) {
      return (
        <button
          className="hover:underline transition-colors bg-transparent border-none p-0 cursor-pointer"
          onClick={item.onClick}
        >
          {content}
        </button>
      );
    }

    return content;
  };

  if (isCollapsed && items.length > 2) {
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    const middleItems = items.slice(1, -1);

    return (
      <nav
        ref={containerRef}
        className={`flex items-center gap-2 min-w-0 ${className}`}
        aria-label="Breadcrumb"
      >
        <div className="flex items-center gap-2 min-w-0">
          {renderItem(firstItem, 0, false)}
          {separatorElement}
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            className="flex items-center justify-center w-6 h-6 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 transition-colors"
            onClick={() => setShowDropdown(!showDropdown)}
            aria-label="Show more items"
          >
            <Icons.MoreHorizontal className="w-4 h-4" />
          </button>

          {showDropdown && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[150px] py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg">
              {middleItems.map((item, index) => (
                <button
                  key={index}
                  className="w-full px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  onClick={() => {
                    if (item.onClick) item.onClick();
                    else if (item.href) window.location.href = item.href;
                    setShowDropdown(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {separatorElement}

        <div className="flex items-center min-w-0">
          {renderItem(lastItem, items.length - 1, true)}
        </div>
      </nav>
    );
  }

  return (
    <nav
      ref={containerRef}
      className={`flex items-center gap-2 min-w-0 flex-wrap ${className}`}
      aria-label="Breadcrumb"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Fragment key={index}>
            <div className="flex items-center min-w-0">
              {renderItem(item, index, isLast)}
            </div>
            {!isLast && separatorElement}
          </Fragment>
        );
      })}
    </nav>
  );
}
