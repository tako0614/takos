export const settings = {
  // Settings
  settingsTitle: "Account Settings",
  email: "Email",
  name: "Name",
  language: "Language",

  // Workspace Settings
  workspaceSlug: "Space Slug",

  // Members
  members: "Members",
  noMembers: "No members yet",
  inviteMember: "Invite Member",
  memberInvited: "Member invited",
  failedToInvite: "Failed to invite member",
  removeMember: "Remove Member",
  removeMemberWarning:
    "Are you sure you want to remove this member from the space?",
  memberRemoved: "Member removed",
  failedToRemove: "Failed to remove member",
  memberUpdated: "Member role updated",
  failedToUpdate: "Failed to update",
  invite: "Invite",
  emailPlaceholder: "email@example.com",
  roleOwner: "Owner",
  roleAdmin: "Admin",
  roleMember: "Member",

  // Space aliases (code uses "space" prefix, while established keys use "workspace")
  spaceSettings: "Space Settings",
  spaceInfo: "Space Information",
  spaceSlug: "Space Slug",
  spaceName: "Space Name",
  spaceNamePlaceholder: "My Space",
  selectSpace: "Select Space",
  selectSpaceHint: "Select a space to view settings",
  selectSpaceFirst: "Select a space first",
  selectSpaceToChat: "Select a space to start chatting",
  noSpacesAvailable: "No spaces available",
  spaceNotFound: "Space not found",
  spaceNotFoundDesc:
    "The space you are looking for does not exist or you do not have access.",
  personalSpaceNameHint: "Personal space name cannot be changed",
  personalSpaceNote:
    "This is your personal space. It cannot be deleted or shared with others.",
  deleteSpace: "Delete Space",
  deleteSpaceWarning:
    "Are you sure you want to delete this space? This action cannot be undone and all data will be permanently deleted.",
  deleteSpaceHint: "Permanently delete this space and all its data",
  spaceDeleted: "Space deleted",
  createSpace: "Create Space",
  createSpaceHint: "Create a team space to collaborate with others",
  installFeaturedAppsOnCreate: "Install featured apps",
  installFeaturedAppsOnCreateHint:
    "Add operator-selected apps from the connected app catalog.",
  spaceCreated: "Space created",
  targetSpace: "Target Space",

  // Settings Privacy
  privacyTitle: "Privacy",
  privateAccount: "Private account",
  requireApprovalForFollowers: "Require approval for new followers.",
  activityVisibility: "Activity visibility",
  visibilityPublic: "Public",
  visibilityFollowers: "Followers",
  visibilityPrivate: "Private",
} as const;
