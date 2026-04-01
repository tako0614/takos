import { createSignal } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import { useI18n } from '../../store/i18n.ts';
import { useToast } from '../../store/toast.ts';
import { getSpaceIdentifier } from '../../lib/spaces.ts';
import type { Space } from '../../types/index.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Input } from '../../components/ui/Input.tsx';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../components/ui/Card.tsx';

export interface SpaceMember {
  username: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

function getRoleLabel(role: string, t: (key: any) => string) {
  switch (role) {
    case 'owner': return t('roleOwner') || 'Owner';
    case 'admin': return t('roleAdmin') || 'Admin';
    case 'member': return t('roleMember') || 'Member';
    default: return role;
  }
}

export function SpaceInfoCard({
  selectedSpace,
  spaceName,
  setSpaceName,
  isPersonal,
  saving,
  onSave,
}: {
  selectedSpace: Space;
  spaceName: string;
  setSpaceName: (name: string) => void;
  isPersonal: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const { t, tOr } = useI18n();
  const { showToast } = useToast();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('spaceInfo') || 'Space Information'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('spaceName')}
            </label>
            <Input
              value={spaceName}
              onInput={(e) => setSpaceName(e.target.value)}
              placeholder={t('spaceNamePlaceholder')}
              disabled={isPersonal}
            />
            {isPersonal && (
              <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {t('personalSpaceNameHint') || 'Personal space name cannot be changed'}
              </p>
            )}
          </div>
          <div>
            <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {tOr('spaceSlug', 'Space Slug')}
            </label>
            <div class="flex items-center gap-2">
              <code class="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 font-mono truncate">
                {getSpaceIdentifier(selectedSpace)}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(getSpaceIdentifier(selectedSpace));
                  showToast('success', t('copied'));
                }}
              >
                <Icons.Copy class="w-4 h-4" />
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
            onClick={onSave}
            isLoading={saving}
            disabled={!spaceName.trim() || spaceName === selectedSpace.name}
          >
            {t('save')}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export function MembersCard({
  members,
  loadingMembers,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviting,
  onInvite,
  onRemove,
  onChangeRole,
}: {
  members: SpaceMember[];
  loadingMembers: boolean;
  inviteEmail: string;
  setInviteEmail: (email: string) => void;
  inviteRole: 'admin' | 'member';
  setInviteRole: (role: 'admin' | 'member') => void;
  inviting: boolean;
  onInvite: () => void;
  onRemove: (member: SpaceMember) => void;
  onChangeRole: (member: SpaceMember, role: 'admin' | 'member') => void;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('members') || 'Members'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="mb-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
          <h4 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
            {t('inviteMember') || 'Invite Member'}
          </h4>
          <div class="flex gap-2">
            <Input
              type="email"
              placeholder={t('emailPlaceholder') || 'email@example.com'}
              value={inviteEmail}
              onInput={(e) => setInviteEmail(e.target.value)}
              class="flex-1"
            />
            <select
              class="px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
            >
              <option value="member">{getRoleLabel('member', t)}</option>
              <option value="admin">{getRoleLabel('admin', t)}</option>
            </select>
            <Button
              variant="primary"
              size="sm"
              onClick={onInvite}
              isLoading={inviting}
              disabled={!inviteEmail.trim()}
            >
              {t('invite') || 'Invite'}
            </Button>
          </div>
        </div>

        {loadingMembers ? (
          <div class="flex items-center justify-center py-8">
            <div class="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div class="text-center py-8 text-zinc-500 dark:text-zinc-400">
            {t('noMembers') || 'No members yet'}
          </div>
        ) : (
          <div class="space-y-2">
            {members.map((member) => (
              <div
                class="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl"
              >
                {member.picture ? (
                  <img
                    src={member.picture}
                    alt=""
                    class="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div class="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                    <Icons.User class="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                  </div>
                )}
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {member.name || member.email || member.username}
                  </div>
                  <div class="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                    @{member.username}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  {member.role === 'owner' ? (
                    <span class="px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-200 dark:bg-zinc-700 rounded-lg">
                      {getRoleLabel('owner', t)}
                    </span>
                  ) : (
                    <>
                      <select
                        class="px-2 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                        value={member.role}
                        onChange={(e) => onChangeRole(member, e.target.value as 'admin' | 'member')}
                      >
                        <option value="member">{getRoleLabel('member', t)}</option>
                        <option value="admin">{getRoleLabel('admin', t)}</option>
                      </select>
                      <button type="button"
                        class="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        onClick={() => onRemove(member)}
                        title={t('remove') || 'Remove'}
                      >
                        <Icons.Trash class="w-4 h-4" />
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
  );
}

export function DangerZoneCard({
  onDelete,
}: {
  onDelete: () => void;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle class="text-red-600 dark:text-red-400">{t('dangerZone')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <div>
            <h4 class="font-medium text-zinc-900 dark:text-zinc-100">
              {t('deleteSpace') || 'Delete Space'}
            </h4>
            <p class="text-sm text-zinc-500 dark:text-zinc-400">
              {t('deleteSpaceHint') || 'Permanently delete this space and all its data'}
            </p>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={onDelete}
          >
            {t('delete')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PersonalSpaceNote() {
  const { t } = useI18n();

  return (
    <Card>
      <CardContent>
        <div class="flex items-start gap-3 text-zinc-500 dark:text-zinc-400">
          <Icons.Info class="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p class="text-sm">
            {t('personalSpaceNote') || 'This is your personal space. It cannot be deleted or shared with others. Use team spaces to collaborate with others.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function CreateSpaceModal({
  onClose,
  onCreate,
  creating,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
  creating: boolean;
}) {
  const { t } = useI18n();
  const [newSpaceName, setNewSpaceName] = createSignal('');

  const handleClose = () => {
    setNewSpaceName('');
    onClose();
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <h3 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {t('createSpace') || 'Create Space'}
          </h3>
          <button type="button"
            class="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            onClick={handleClose}
          >
            <Icons.X class="w-5 h-5" />
          </button>
        </div>
        <div class="p-6">
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('spaceName')}
          </label>
          <Input
            value={newSpaceName()}
            onInput={(e) => setNewSpaceName(e.target.value)}
            placeholder={t('spaceNamePlaceholder')}
            autofocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSpaceName().trim()) {
                onCreate(newSpaceName().trim());
              }
            }}
          />
          <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t('createSpaceHint') || 'Create a team space to collaborate with others'}
          </p>
        </div>
        <div class="flex justify-end gap-3 px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onCreate(newSpaceName().trim())}
            isLoading={creating}
            disabled={!newSpaceName().trim()}
          >
            {t('create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
