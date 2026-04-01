import { createEffect, createSignal } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import { useI18n } from '../../store/i18n.ts';
import { useToast } from '../../store/toast.ts';
import { useConfirmDialog } from '../../store/confirm-dialog.ts';
import { rpc, rpcJson } from '../../lib/rpc.ts';
import { getErrorMessage } from '../../lib/errors.ts';
import { splitSpaces, findSpaceByIdentifier } from '../../lib/spaces.ts';
import type { Space } from '../../types/index.ts';
import { Button } from '../../components/ui/Button.tsx';
import {
  SpaceInfoCard,
  MembersCard,
  DangerZoneCard,
  PersonalSpaceNote,
  CreateSpaceModal,
  type SpaceMember,
} from './SpaceSettingsCards.tsx';

interface SpaceSettingsSectionProps {
  spaces: Space[];
  selectedSpaceId: string | null;
  setSelectedSpaceId: (id: string) => void;
  onSpaceDeleted?: () => void;
  onSpaceUpdated?: () => void;
}

export function SpaceSettingsSection({
  spaces,
  selectedSpaceId,
  setSelectedSpaceId,
  onSpaceDeleted,
  onSpaceUpdated,
}: SpaceSettingsSectionProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [spaceName, setSpaceName] = createSignal('');
  const [isPersonal, setIsPersonal] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const [members, setMembers] = createSignal<SpaceMember[]>([]);
  const [loadingMembers, setLoadingMembers] = createSignal(false);

  const [inviteEmail, setInviteEmail] = createSignal('');
  const [inviteRole, setInviteRole] = createSignal<'admin' | 'member'>('member');
  const [inviting, setInviting] = createSignal(false);

  const [showCreateSpace, setShowCreateSpace] = createSignal(false);
  const [creatingSpace, setCreatingSpace] = createSignal(false);

  const { personalSpace, otherSpaces } = splitSpaces(spaces || [], t('personal'));
  const selectedSpace = selectedSpaceId
    ? findSpaceByIdentifier(spaces || [], selectedSpaceId, t('personal'))
    : null;

  createEffect(() => {
    if (selectedSpace) {
      setSpaceName(selectedSpace.name as string);
      setIsPersonal(selectedSpace.is_personal as boolean);
    }
  });

  const fetchMembers = async () => {
    if (!selectedSpaceId) return;
    try {
      setLoadingMembers(true);
      const res = await rpc.spaces[':spaceId'].members.$get({
        param: { spaceId: selectedSpaceId },
      });
      const data = await rpcJson<{ members: SpaceMember[] }>(res);
      setMembers(data.members || []);
    } catch {
      // member fetch failed silently
    } finally {
      setLoadingMembers(false);
    }
  };

  createEffect(() => {
    if (selectedSpaceId && !selectedSpace?.is_personal) {
      fetchMembers();
    } else {
      setMembers([]);
    }
  });

  const handleSaveSpace = async () => {
    if (!selectedSpaceId || !spaceName().trim()) return;
    try {
      setSaving(true);
      const res = await rpc.spaces[':spaceId'].$patch({
        param: { spaceId: selectedSpaceId },
        json: { name: spaceName().trim() },
      });
      await rpcJson(res);
      showToast('success', t('saved'));
      onSpaceUpdated?.();
    } catch {
      showToast('error', t('failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleInviteMember = async () => {
    if (!selectedSpaceId || !inviteEmail().trim()) return;
    try {
      setInviting(true);
      const res = await rpc.spaces[':spaceId'].members.$post({
        param: { spaceId: selectedSpaceId },
        json: { email: inviteEmail().trim(), role: inviteRole() },
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

  const handleRemoveMember = async (member: SpaceMember) => {
    if (!selectedSpaceId) return;
    const confirmed = await confirm({
      title: t('removeMember') || 'Remove Member',
      message: t('removeMemberWarning') || `Are you sure you want to remove ${member.name || member.email || 'this member'} from the space?`,
      confirmText: t('remove') || 'Remove',
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.spaces[':spaceId'].members[':username'].$delete({
        param: { spaceId: selectedSpaceId, username: member.username },
      });
      await rpcJson(res);
      showToast('success', t('memberRemoved') || 'Member removed');
      fetchMembers();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToRemove') || 'Failed to remove member'));
    }
  };

  const handleChangeMemberRole = async (member: SpaceMember, newRole: 'admin' | 'member') => {
    if (!selectedSpaceId || member.role === newRole) return;
    try {
      const res = await rpc.spaces[':spaceId'].members[':username'].$patch({
        param: { spaceId: selectedSpaceId, username: member.username },
        json: { role: newRole },
      });
      await rpcJson(res);
      showToast('success', t('memberUpdated') || 'Member role updated');
      fetchMembers();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToUpdate') || 'Failed to update member'));
    }
  };

  const handleDeleteSpace = async () => {
    if (!selectedSpaceId || isPersonal()) return;
    const confirmed = await confirm({
      title: t('deleteSpace') || 'Delete Space',
      message: t('deleteSpaceWarning') || 'Are you sure you want to delete this space? This action cannot be undone and all data will be permanently deleted.',
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.spaces[':spaceId'].$delete({
        param: { spaceId: selectedSpaceId },
      });
      await rpcJson(res);
      showToast('success', t('spaceDeleted') || 'Space deleted');
      onSpaceDeleted?.();
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToDelete')));
    }
  };

  const handleCreateSpace = async (name: string) => {
    if (!name) return;
    try {
      setCreatingSpace(true);
      const res = await rpc.spaces.$post({
        json: { name },
      });
      const data = await rpcJson<{ space: { slug: string } }>(res);
      showToast('success', t('spaceCreated') || 'Space created');
      setShowCreateSpace(false);
      onSpaceUpdated?.();
      setSelectedSpaceId(data.space.slug);
    } catch (err: unknown) {
      showToast('error', getErrorMessage(err, t('failedToCreate')));
    } finally {
      setCreatingSpace(false);
    }
  };

  return (
    <div class="h-full flex flex-col bg-zinc-50/30 dark:bg-zinc-900/30">
      <div class="flex items-center gap-3 px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
          <Icons.Settings class="w-4 h-4" />
        </div>
        <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t('spaceSettings') || 'Space Settings'}
        </h3>
      </div>

      <div class="px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t('selectSpace') || 'Select Space'}
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCreateSpace(true)}
          >
            <Icons.Plus class="w-4 h-4 mr-1" />
            {t('createSpace') || 'Create'}
          </Button>
        </div>
        <select
          class="w-full max-w-md px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
          value={selectedSpaceId ?? ''}
          onChange={(e) => setSelectedSpaceId(e.target.value)}
        >
          <option value="" disabled>{t('selectSpace') || 'Select a space'}</option>
          {personalSpace && (
            <option value="me">{t('personal')} ({personalSpace.name})</option>
          )}
          {otherSpaces.map((ws) => (
            <option value={ws.slug ?? ''}>{ws.name}</option>
          ))}
        </select>

        {showCreateSpace() && (
          <CreateSpaceModal
            onClose={() => setShowCreateSpace(false)}
            onCreate={handleCreateSpace}
            creating={creatingSpace()}
          />
        )}
      </div>

      {selectedSpace ? (
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <SpaceInfoCard
            selectedSpace={selectedSpace}
            spaceName={spaceName()}
            setSpaceName={setSpaceName}
            isPersonal={isPersonal()}
            saving={saving()}
            onSave={handleSaveSpace}
          />

          {!isPersonal() && (
            <MembersCard
              members={members()}
              loadingMembers={loadingMembers()}
              inviteEmail={inviteEmail()}
              setInviteEmail={setInviteEmail}
              inviteRole={inviteRole()}
              setInviteRole={setInviteRole}
              inviting={inviting()}
              onInvite={handleInviteMember}
              onRemove={handleRemoveMember}
              onChangeRole={handleChangeMemberRole}
            />
          )}

          {!isPersonal() && (
            <DangerZoneCard onDelete={handleDeleteSpace} />
          )}

          {isPersonal() && <PersonalSpaceNote />}
        </div>
      ) : (
        <div class="flex-1 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
          {t('selectSpaceHint') || 'Select a space to view settings'}
        </div>
      )}
    </div>
  );
}
