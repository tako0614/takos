import { useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { useToast } from '../../store/toast';
import { getSpaceIdentifier } from '../../lib/spaces';
import type { Space } from '../../types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../components/ui/Card';

export interface SpaceMember {
  username: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

function getRoleLabel(role: string, t: (key: string) => string) {
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
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('spaceName')}
            </label>
            <Input
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
              placeholder={t('spaceNamePlaceholder')}
              disabled={isPersonal}
            />
            {isPersonal && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {t('personalSpaceNameHint') || 'Personal space name cannot be changed'}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {tOr('spaceSlug', 'Space Slug')}
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 font-mono truncate">
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
                      {getRoleLabel('owner', t)}
                    </span>
                  ) : (
                    <>
                      <select
                        className="px-2 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                        value={member.role}
                        onChange={(e) => onChangeRole(member, e.target.value as 'admin' | 'member')}
                      >
                        <option value="member">{getRoleLabel('member', t)}</option>
                        <option value="admin">{getRoleLabel('admin', t)}</option>
                      </select>
                      <button
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        onClick={() => onRemove(member)}
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
        <CardTitle className="text-red-600 dark:text-red-400">{t('dangerZone')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <div>
            <h4 className="font-medium text-zinc-900 dark:text-zinc-100">
              {t('deleteSpace') || 'Delete Space'}
            </h4>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
        <div className="flex items-start gap-3 text-zinc-500 dark:text-zinc-400">
          <Icons.Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm">
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
  const [newSpaceName, setNewSpaceName] = useState('');

  const handleClose = () => {
    setNewSpaceName('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {t('createSpace') || 'Create Space'}
          </h3>
          <button
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            onClick={handleClose}
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('spaceName')}
          </label>
          <Input
            value={newSpaceName}
            onChange={(e) => setNewSpaceName(e.target.value)}
            placeholder={t('spaceNamePlaceholder')}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSpaceName.trim()) {
                onCreate(newSpaceName.trim());
              }
            }}
          />
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t('createSpaceHint') || 'Create a team space to collaborate with others'}
          </p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800">
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
            onClick={() => onCreate(newSpaceName.trim())}
            isLoading={creating}
            disabled={!newSpaceName.trim()}
          >
            {t('create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
