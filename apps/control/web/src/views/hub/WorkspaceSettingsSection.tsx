import { useCallback, useEffect, useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../providers/ConfirmDialogProvider';
import { rpc, rpcJson } from '../../lib/rpc';
import { getErrorMessage } from '../../lib/errors';
import { splitWorkspaces, findWorkspaceByIdentifier, getWorkspaceIdentifier } from '../../lib/workspaces';
import type { Workspace } from '../../types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../components/ui/Card';

interface WorkspaceMember {
  username: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

interface WorkspaceSettingsSectionProps {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (id: string) => void;
  onWorkspaceDeleted?: () => void;
  onWorkspaceUpdated?: () => void;
}

export function WorkspaceSettingsSection({
  workspaces,
  selectedWorkspaceId,
  setSelectedWorkspaceId,
  onWorkspaceDeleted,
  onWorkspaceUpdated,
}: WorkspaceSettingsSectionProps) {
  const { t, tOr } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [workspaceName, setWorkspaceName] = useState('');
  const [isPersonal, setIsPersonal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);

  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const { personalWorkspace, otherWorkspaces } = splitWorkspaces(workspaces || [], t('personal'));
  const selectedWorkspace = selectedWorkspaceId
    ? findWorkspaceByIdentifier(workspaces || [], selectedWorkspaceId, t('personal'))
    : null;

  useEffect(() => {
    if (selectedWorkspace) {
      setWorkspaceName(selectedWorkspace.name);
      setIsPersonal(selectedWorkspace.is_personal);
    }
  }, [selectedWorkspace]);

  const fetchMembers = useCallback(async () => {
    if (!selectedWorkspaceId) return;
    try {
      setLoadingMembers(true);
      const res = await rpc.spaces[':spaceId'].members.$get({
        param: { spaceId: selectedWorkspaceId },
      });
      const data = await rpcJson<{ members: WorkspaceMember[] }>(res);
      setMembers(data.members || []);
    } catch (err) {
      console.error('Failed to fetch members:', err);
    } finally {
      setLoadingMembers(false);
    }
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (selectedWorkspaceId && !selectedWorkspace?.is_personal) {
      fetchMembers();
    } else {
      setMembers([]);
    }
  }, [selectedWorkspaceId, selectedWorkspace?.is_personal, fetchMembers]);

  const handleSaveWorkspace = async () => {
    if (!selectedWorkspaceId || !workspaceName.trim()) return;
    try {
      setSaving(true);
      const res = await rpc.spaces[':spaceId'].$patch({
        param: { spaceId: selectedWorkspaceId },
        json: { name: workspaceName.trim() },
      });
      await rpcJson(res);
      showToast('success', t('saved'));
      onWorkspaceUpdated?.();
    } catch (err) {
      showToast('error', t('failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleInviteMember = async () => {
    if (!selectedWorkspaceId || !inviteEmail.trim()) return;
    try {
      setInviting(true);
      const res = await rpc.spaces[':spaceId'].members.$post({
        param: { spaceId: selectedWorkspaceId },
        json: { email: inviteEmail.trim(), role: inviteRole },
      });
      await rpcJson(res);
      showToast('success', t('memberInvited') || 'Member invited');
      setInviteEmail('');
      fetchMembers();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToInvite') || 'Failed to invite member'));
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (member: WorkspaceMember) => {
    if (!selectedWorkspaceId) return;
    const confirmed = await confirm({
      title: t('removeMember') || 'Remove Member',
      message: t('removeMemberWarning') || `Are you sure you want to remove ${member.name || member.email || 'this member'} from the workspace?`,
      confirmText: t('remove') || 'Remove',
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.spaces[':spaceId'].members[':username'].$delete({
        param: { spaceId: selectedWorkspaceId, username: member.username },
      });
      await rpcJson(res);
      showToast('success', t('memberRemoved') || 'Member removed');
      fetchMembers();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToRemove') || 'Failed to remove member'));
    }
  };

  const handleChangeMemberRole = async (member: WorkspaceMember, newRole: 'admin' | 'member') => {
    if (!selectedWorkspaceId || member.role === newRole) return;
    try {
      const res = await rpc.spaces[':spaceId'].members[':username'].$patch({
        param: { spaceId: selectedWorkspaceId, username: member.username },
        json: { role: newRole },
      });
      await rpcJson(res);
      showToast('success', t('memberUpdated') || 'Member role updated');
      fetchMembers();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToUpdate') || 'Failed to update member'));
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!selectedWorkspaceId || isPersonal) return;
    const confirmed = await confirm({
      title: t('deleteWorkspace') || 'Delete Workspace',
      message: t('deleteWorkspaceWarning') || 'Are you sure you want to delete this workspace? This action cannot be undone and all data will be permanently deleted.',
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.spaces[':spaceId'].$delete({
        param: { spaceId: selectedWorkspaceId },
      });
      await rpcJson(res);
      showToast('success', t('workspaceDeleted') || 'Workspace deleted');
      onWorkspaceDeleted?.();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToDelete')));
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner': return t('roleOwner') || 'Owner';
      case 'admin': return t('roleAdmin') || 'Admin';
      case 'member': return t('roleMember') || 'Member';
      default: return role;
    }
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    try {
      setCreatingWorkspace(true);
      const res = await rpc.spaces.$post({
        json: { name: newWorkspaceName.trim() },
      });
      const data = await rpcJson<{ space: { slug: string } }>(res);
      showToast('success', t('workspaceCreated') || 'Workspace created');
      setNewWorkspaceName('');
      setShowCreateWorkspace(false);
      onWorkspaceUpdated?.();
      setSelectedWorkspaceId(data.space.slug);
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToCreate')));
    } finally {
      setCreatingWorkspace(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-50/30 dark:bg-zinc-900/30">
      <div className="flex items-center gap-3 px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
          <Icons.Settings className="w-4 h-4" />
        </div>
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t('workspaceSettings') || 'Workspace Settings'}
        </h3>
      </div>

      <div className="px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t('selectWorkspace') || 'Select Workspace'}
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCreateWorkspace(true)}
          >
            <Icons.Plus className="w-4 h-4 mr-1" />
            {t('createWorkspace') || 'Create'}
          </Button>
        </div>
        <select
          className="w-full max-w-md px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
          value={selectedWorkspaceId || ''}
          onChange={(e) => setSelectedWorkspaceId(e.target.value)}
        >
          <option value="" disabled>{t('selectWorkspace') || 'Select a workspace'}</option>
          {personalWorkspace && (
            <option value="me">{t('personal')} ({personalWorkspace.name})</option>
          )}
          {otherWorkspaces.map((ws) => (
            <option key={ws.slug} value={ws.slug}>{ws.name}</option>
          ))}
        </select>

        {showCreateWorkspace && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {t('createWorkspace') || 'Create Workspace'}
                </h3>
                <button
                  className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                  onClick={() => {
                    setShowCreateWorkspace(false);
                    setNewWorkspaceName('');
                  }}
                >
                  <Icons.X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  {t('workspaceName')}
                </label>
                <Input
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder={t('workspaceNamePlaceholder')}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newWorkspaceName.trim()) {
                      handleCreateWorkspace();
                    }
                  }}
                />
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {t('createWorkspaceHint') || 'Create a team workspace to collaborate with others'}
                </p>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCreateWorkspace(false);
                    setNewWorkspaceName('');
                  }}
                >
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreateWorkspace}
                  isLoading={creatingWorkspace}
                  disabled={!newWorkspaceName.trim()}
                >
                  {t('create')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedWorkspace ? (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('workspaceInfo') || 'Workspace Information'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('workspaceName')}
                  </label>
                  <Input
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder={t('workspaceNamePlaceholder')}
                    disabled={isPersonal}
                  />
                  {isPersonal && (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {t('personalWorkspaceNameHint') || 'Personal workspace name cannot be changed'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {tOr('workspaceSlug', 'Workspace Slug')}
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 font-mono truncate">
                      {getWorkspaceIdentifier(selectedWorkspace)}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(getWorkspaceIdentifier(selectedWorkspace));
                        showToast('success', t('copied'));
                      }}
                    >
                      <Icons.Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
            {!isPersonal && (
              <CardFooter>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveWorkspace}
                  isLoading={saving}
                  disabled={!workspaceName.trim() || workspaceName === selectedWorkspace.name}
                >
                  {t('save')}
                </Button>
              </CardFooter>
            )}
          </Card>

          {!isPersonal && (
            <Card>
              <CardHeader>
                <CardTitle>{t('members') || 'Members'}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
                  <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
                    {t('inviteMember') || 'Invite Member'}
                  </h4>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder={t('emailPlaceholder') || 'email@example.com'}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="flex-1"
                    />
                    <select
                      className="px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                    >
                      <option value="member">{getRoleLabel('member')}</option>
                      <option value="admin">{getRoleLabel('admin')}</option>
                    </select>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleInviteMember}
                      isLoading={inviting}
                      disabled={!inviteEmail.trim()}
                    >
                      {t('invite') || 'Invite'}
                    </Button>
                  </div>
                </div>

                {loadingMembers ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
                  </div>
                ) : members.length === 0 ? (
                  <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
                    {t('noMembers') || 'No members yet'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {members.map((member) => (
                      <div
                        key={member.username}
                        className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl"
                      >
                        {member.picture ? (
                          <img
                            src={member.picture}
                            alt=""
                            className="w-10 h-10 rounded-full"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                            <Icons.User className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {member.name || member.email || member.username}
                          </div>
                          <div className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                            @{member.username}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {member.role === 'owner' ? (
                            <span className="px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-200 dark:bg-zinc-700 rounded-lg">
                              {getRoleLabel('owner')}
                            </span>
                          ) : (
                            <>
                              <select
                                className="px-2 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                                value={member.role}
                                onChange={(e) => handleChangeMemberRole(member, e.target.value as 'admin' | 'member')}
                              >
                                <option value="member">{getRoleLabel('member')}</option>
                                <option value="admin">{getRoleLabel('admin')}</option>
                              </select>
                              <button
                                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                                onClick={() => handleRemoveMember(member)}
                                title={t('remove') || 'Remove'}
                              >
                                <Icons.Trash className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!isPersonal && (
            <Card>
              <CardHeader>
                <CardTitle className="text-red-600 dark:text-red-400">{t('dangerZone')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                  <div>
                    <h4 className="font-medium text-zinc-900 dark:text-zinc-100">
                      {t('deleteWorkspace') || 'Delete Workspace'}
                    </h4>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {t('deleteWorkspaceHint') || 'Permanently delete this workspace and all its data'}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleDeleteWorkspace}
                  >
                    {t('delete')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isPersonal && (
            <Card>
              <CardContent>
                <div className="flex items-start gap-3 text-zinc-500 dark:text-zinc-400">
                  <Icons.Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p className="text-sm">
                    {t('personalWorkspaceNote') || 'This is your personal workspace. It cannot be deleted or shared with others. Use team workspaces to collaborate with others.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
          {t('selectWorkspaceHint') || 'Select a workspace to view settings'}
        </div>
      )}
    </div>
  );
}
