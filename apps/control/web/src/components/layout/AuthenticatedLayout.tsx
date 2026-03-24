import React from 'react';
import { UnifiedSidebar } from '../navigation/UnifiedSidebar';
import { MobileBottomNav, type NavItem } from './MobileBottomNav';
import { MobileDrawer } from './MobileDrawer';
import { MobileHeader } from './MobileHeader';
import { getWorkspaceIdentifier } from '../../lib/workspaces';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useI18n } from '../../providers/I18nProvider';
import { useAuth } from '../../contexts/AuthContext';
import { useModals } from '../../contexts/ModalContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { RouteState, View } from '../../types';

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
    setShowCreateWorkspace,
    setShowAgentModal,
    setShowSearch,
  } = useModals();
  const {
    route,
    navigate,
    replace,
    sidebarWorkspace,
    handleEnterWorkspace,
    handleExitWorkspace,
    showMobileNavDrawer,
    setShowMobileNavDrawer,
    mobileNavDrawerId,
    allThreads,
    threadsByWorkspace,
    handleNewThread,
    handleDeleteThread,
    toggleArchiveThread,
    handleSelectThread,
    navigateToChat,
    selectedWorkspaceId,
    runSidebarAction,
  } = useNavigation();
  const { workspaces } = useAuth();

  const handleLogout = async () => {
    await authLogout();
    replace({ view: 'home' });
  };

  const handleMobileNavigate = (item: NavItem) => {
    setShowMobileNavDrawer(false);
    switch (item) {
      case 'apps':
        navigate({ view: 'apps', spaceId: selectedWorkspaceId ?? undefined, threadId: undefined });
        break;
      case 'chat':
        navigateToChat(selectedWorkspaceId ?? undefined);
        break;
      case 'store':
        navigate({ view: 'store', storeTab: 'discover' });
        break;
    }
  };

  const sidebar = (
    <UnifiedSidebar
      activeView={route.view}
      onNewChat={() => runSidebarAction(() => { handleNewThread(); })}
      onNavigateStorage={() => runSidebarAction(() => {
        navigate({ view: 'storage', spaceId: selectedWorkspaceId ?? undefined });
      })}
      onNavigateDeploy={() => runSidebarAction(() => {
        navigate({ view: 'deploy', spaceId: selectedWorkspaceId ?? undefined });
      })}
      onNavigateApps={() => runSidebarAction(() => {
        navigate({ view: 'apps', spaceId: selectedWorkspaceId ?? undefined, threadId: undefined });
      })}
      onNavigateStore={() => runSidebarAction(() => {
        navigate({ view: 'store', storeTab: 'discover' });
      })}
      onNavigateRepos={() => runSidebarAction(() => {
        navigate({ view: 'repos', spaceId: selectedWorkspaceId ?? undefined });
      })}
      onOpenSearch={() => runSidebarAction(() => setShowSearch(true))}
      spaceId={selectedWorkspaceId}
      workspaces={workspaces}
      onCreateWorkspace={() => runSidebarAction(() => setShowCreateWorkspace(true))}
      threads={allThreads}
      threadsByWorkspace={threadsByWorkspace}
      selectedThreadId={route.threadId ?? null}
      onSelectThread={(thread) => runSidebarAction(() => { handleSelectThread(thread); })}
      onDeleteThread={handleDeleteThread}
      onToggleArchiveThread={toggleArchiveThread}
      user={user}
      onOpenAgentModal={() => runSidebarAction(() => setShowAgentModal(true))}
      onOpenWorkspaceSettings={(wsId) => runSidebarAction(() => {
        navigate({ view: 'space-settings', spaceId: wsId });
      })}
      onOpenSettings={() => runSidebarAction(() => navigate({ view: 'settings' }))}
      onLogout={() => runSidebarAction(handleLogout)}
      sidebarWorkspace={sidebarWorkspace}
      onEnterWorkspace={(ws) => runSidebarAction(() => { handleEnterWorkspace(ws); })}
      onExitWorkspace={() => runSidebarAction(() => { handleExitWorkspace(); })}
      onNavigateWorkspaceChat={() => runSidebarAction(() => {
        if (!sidebarWorkspace) return;
        navigate({
          view: 'chat',
          spaceId: getWorkspaceIdentifier(sidebarWorkspace),
          threadId: undefined,
          runId: undefined,
          messageId: undefined,
        });
      })}
      onNavigateWorkspaceStorage={() => runSidebarAction(() => {
        if (!sidebarWorkspace) return;
        navigate({ view: 'storage', spaceId: getWorkspaceIdentifier(sidebarWorkspace) });
      })}
      onNavigateWorkspaceDeploy={() => runSidebarAction(() => {
        if (!sidebarWorkspace) return;
        navigate({ view: 'deploy', spaceId: getWorkspaceIdentifier(sidebarWorkspace) });
      })}
      onNavigateWorkspaceRepos={() => runSidebarAction(() => {
        if (!sidebarWorkspace) return;
        navigate({ view: 'repos', spaceId: getWorkspaceIdentifier(sidebarWorkspace) });
      })}
      onNavigateWorkspaceApps={() => runSidebarAction(() => {
        if (!sidebarWorkspace) return;
        navigate({ view: 'apps', spaceId: getWorkspaceIdentifier(sidebarWorkspace), threadId: undefined });
      })}
      onNavigateWorkspaceSettings={() => runSidebarAction(() => {
        if (!sidebarWorkspace) return;
        navigate({ view: 'space-settings', spaceId: getWorkspaceIdentifier(sidebarWorkspace) });
      })}
    />
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
