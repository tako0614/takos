import React, { useMemo } from 'react';
import { UnifiedSidebar } from '../navigation/UnifiedSidebar';
import { SidebarProvider, type SidebarCallbacks } from '../navigation/SidebarContext';
import { MobileBottomNav, type NavItem } from './MobileBottomNav';
import { MobileDrawer } from './MobileDrawer';
import { MobileHeader } from './MobileHeader';
import { getSpaceIdentifier } from '../../lib/spaces';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useI18n } from '../../providers/I18nProvider';
import { useAuth } from '../../contexts/AuthContext';
import { useModals } from '../../contexts/ModalContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { View } from '../../types';

function getMobileActiveItem(view: View): NavItem {
  switch (view) {
    case 'apps':
      return 'apps';
    case 'store':
    case 'repo':
      return 'store';
    default:
      return 'chat';
  }
}

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const { user, handleLogout: authLogout } = useAuth();
  const {
    setShowCreateSpace,
    setShowAgentModal,
    setShowSearch,
  } = useModals();
  const {
    route,
    navigate,
    replace,
    sidebarSpace,
    handleEnterSpace,
    handleExitSpace,
    showMobileNavDrawer,
    setShowMobileNavDrawer,
    mobileNavDrawerId,
    allThreads,
    threadsBySpace,
    handleNewThread,
    handleDeleteThread,
    toggleArchiveThread,
    handleSelectThread,
    navigateToChat,
    selectedSpaceId,
    runSidebarAction,
  } = useNavigation();
  const { spaces } = useAuth();

  const handleLogout = async () => {
    await authLogout();
    replace({ view: 'home' });
  };

  const handleMobileNavigate = (item: NavItem) => {
    setShowMobileNavDrawer(false);
    switch (item) {
      case 'apps':
        navigate({ view: 'apps', spaceId: selectedSpaceId ?? undefined, threadId: undefined });
        break;
      case 'chat':
        navigateToChat(selectedSpaceId ?? undefined);
        break;
      case 'store':
        navigate({ view: 'store', storeTab: 'discover' });
        break;
    }
  };

  const sidebarCallbacks = useMemo<SidebarCallbacks>(() => ({
    onNewChat: () => runSidebarAction(() => { handleNewThread(); }),
    onNavigateStorage: () => runSidebarAction(() => {
      navigate({ view: 'storage', spaceId: selectedSpaceId ?? undefined });
    }),
    onNavigateDeploy: () => runSidebarAction(() => {
      navigate({ view: 'deploy', spaceId: selectedSpaceId ?? undefined });
    }),
    onNavigateApps: () => runSidebarAction(() => {
      navigate({ view: 'apps', spaceId: selectedSpaceId ?? undefined, threadId: undefined });
    }),
    onNavigateStore: () => runSidebarAction(() => {
      navigate({ view: 'store', storeTab: 'discover' });
    }),
    onNavigateRepos: () => runSidebarAction(() => {
      navigate({ view: 'repos', spaceId: selectedSpaceId ?? undefined });
    }),
    onOpenSearch: () => runSidebarAction(() => setShowSearch(true)),
    onCreateSpace: () => runSidebarAction(() => setShowCreateSpace(true)),
    onSelectThread: (thread) => runSidebarAction(() => { handleSelectThread(thread); }),
    onDeleteThread: handleDeleteThread,
    onToggleArchiveThread: toggleArchiveThread,
    onOpenAgentModal: () => runSidebarAction(() => setShowAgentModal(true)),
    onOpenSpaceSettings: (wsId) => runSidebarAction(() => {
      navigate({ view: 'space-settings', spaceId: wsId });
    }),
    onOpenSettings: () => runSidebarAction(() => navigate({ view: 'settings' })),
    onLogout: () => runSidebarAction(handleLogout),
    onEnterSpace: (ws) => runSidebarAction(() => { handleEnterSpace(ws); }),
    onExitSpace: () => runSidebarAction(() => { handleExitSpace(); }),
    onNavigateSpaceChat: () => runSidebarAction(() => {
      if (!sidebarSpace) return;
      navigate({
        view: 'chat',
        spaceId: getSpaceIdentifier(sidebarSpace),
        threadId: undefined,
        runId: undefined,
        messageId: undefined,
      });
    }),
    onNavigateSpaceStorage: () => runSidebarAction(() => {
      if (!sidebarSpace) return;
      navigate({ view: 'storage', spaceId: getSpaceIdentifier(sidebarSpace) });
    }),
    onNavigateSpaceDeploy: () => runSidebarAction(() => {
      if (!sidebarSpace) return;
      navigate({ view: 'deploy', spaceId: getSpaceIdentifier(sidebarSpace) });
    }),
    onNavigateSpaceRepos: () => runSidebarAction(() => {
      if (!sidebarSpace) return;
      navigate({ view: 'repos', spaceId: getSpaceIdentifier(sidebarSpace) });
    }),
    onNavigateSpaceApps: () => runSidebarAction(() => {
      if (!sidebarSpace) return;
      navigate({ view: 'apps', spaceId: getSpaceIdentifier(sidebarSpace), threadId: undefined });
    }),
    onNavigateSpaceSettings: () => runSidebarAction(() => {
      if (!sidebarSpace) return;
      navigate({ view: 'space-settings', spaceId: getSpaceIdentifier(sidebarSpace) });
    }),
  }), [
    runSidebarAction, handleNewThread, navigate, selectedSpaceId,
    setShowSearch, setShowCreateSpace, handleSelectThread,
    handleDeleteThread, toggleArchiveThread, setShowAgentModal,
    handleLogout, handleEnterSpace, handleExitSpace,
    sidebarSpace,
  ]);

  const sidebar = (
    <SidebarProvider value={sidebarCallbacks}>
      <UnifiedSidebar
        activeView={route.view}
        spaceId={selectedSpaceId}
        spaces={spaces}
        threads={allThreads}
        threadsBySpace={threadsBySpace}
        selectedThreadId={route.threadId ?? null}
        user={user}
        sidebarSpace={sidebarSpace}
      />
    </SidebarProvider>
  );

  return (
    <div className="flex flex-row h-[100dvh] w-screen overflow-hidden bg-white dark:bg-zinc-900">
      {!isMobile && sidebar}
      {isMobile && (
        <MobileDrawer
          isOpen={showMobileNavDrawer}
          onClose={() => setShowMobileNavDrawer(false)}
          title={t('menu')}
          panelId={mobileNavDrawerId}
        >
          {sidebar}
        </MobileDrawer>
      )}
      {isMobile && (
        <MobileHeader
          onOpenMenu={() => setShowMobileNavDrawer(true)}
          isMenuOpen={showMobileNavDrawer}
          menuControlsId={mobileNavDrawerId}
          menuAriaLabel={t('openMenu')}
        />
      )}
      <div className={`flex-1 flex flex-col min-h-0 ${isMobile ? 'pb-[calc(var(--nav-height-mobile)+var(--spacing-safe-bottom))] pt-[calc(48px+var(--spacing-safe-top,0px))]' : ''}`}>
        {children}
      </div>
      {isMobile && (
        <MobileBottomNav
          activeItem={getMobileActiveItem(route.view)}
          onNavigate={handleMobileNavigate}
        />
      )}
    </div>
  );
}
