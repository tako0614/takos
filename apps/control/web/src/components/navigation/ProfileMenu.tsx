import { useEffect, useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { useSidebarCallbacks } from './SidebarContext';
import type { User } from '../../types';

const ROW_BASE =
  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors min-h-[36px]';
const ROW_DEFAULT = `${ROW_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;

const PROFILE_MENU_BTN =
  'flex items-center gap-2 w-full px-4 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors min-h-[36px]';

interface ProfileMenuProps {
  user: User | null;
}

export function ProfileMenu({ user }: ProfileMenuProps) {
  const { t } = useI18n();
  const { onOpenSettings, onLogout } = useSidebarCallbacks();
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  useEffect(() => {
    if (!showProfileMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (e.target instanceof Element && !e.target.closest('.unified-profile-menu')) {
        setShowProfileMenu(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showProfileMenu]);

  return (
    <div className="relative unified-profile-menu">
      <button
        className={ROW_DEFAULT}
        onClick={(e) => {
          e.stopPropagation();
          setShowProfileMenu(!showProfileMenu);
        }}
        aria-label={t('profileMenu')}
        aria-expanded={showProfileMenu}
        aria-haspopup="menu"
      >
        {user?.picture ? (
          <img
            src={user.picture}
            alt={(user?.name || user?.username || '') + "'s avatar"}
            className="w-5 h-5 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-600 dark:text-zinc-300 text-xs font-semibold shrink-0">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="truncate min-w-0 text-zinc-700 dark:text-zinc-300">
          {user?.username
            ? `@${user.username}`
            : user?.name || user?.email || '-'}
        </span>
      </button>

      {showProfileMenu && (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-xl shadow-xl overflow-hidden z-50"
          onClick={(e) => e.stopPropagation()}
          role="menu"
          aria-label={t('profileMenu')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setShowProfileMenu(false);
            }
          }}
        >
          <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-700">
            <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              {user?.username ? `@${user.username}` : '-'}
            </span>
            {user?.name && (
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {user.name}
              </span>
            )}
            {user?.email && (
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {user.email}
              </span>
            )}
          </div>
          <button
            className={PROFILE_MENU_BTN}
            role="menuitem"
            onClick={() => {
              setShowProfileMenu(false);
              onOpenSettings();
            }}
          >
            <Icons.Settings className="w-4 h-4" />
            <span>{t('accountSettings')}</span>
          </button>
          <button
            className={PROFILE_MENU_BTN}
            role="menuitem"
            onClick={() => {
              setShowProfileMenu(false);
              onLogout();
            }}
          >
            <Icons.X className="w-4 h-4" />
            <span>{t('logout')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
