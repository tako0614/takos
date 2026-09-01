export const settings = {
  // Settings
  settingsTitle: "Account Settings",
  email: "Email",
  name: "Name",
  language: "Language",

  // Category Settings
  workspaceSlug: "Category ID",

  failedToUpdate: "Failed to update",

  // Category aliases (internal keys retain the Space/Workspace API vocabulary)
  spaceSettings: "Category settings",
  categorySettings: "Category settings",
  categoryManagement: "Category management",
  spaceInfo: "Category information",
  spaceSlug: "Category ID",
  spaceName: "Category name",
  spaceNamePlaceholder: "Work",
  selectSpace: "Select a category",
  selectSpaceHint: "Select a category to view its settings",
  selectSpaceFirst: "Select a category first",
  selectSpaceToChat: "Select a category to start chatting",
  noSpacesAvailable: "No categories available",
  spaceNotFound: "Category not found",
  spaceNotFoundDesc:
    "The category you are looking for does not exist or is unavailable.",
  personalSpaceNameHint: "The default place cannot be renamed",
  personalSpaceNote:
    "This is the default place for chats and memory. It cannot be deleted.",
  workspaceSecurity: "Category security",
  workspaceNetworkAccess: "External network access",
  workspaceSecurityStandard: "Standard",
  workspaceSecurityStandardHint:
    "The agent can use outbound HTTP tools configured for this category.",
  workspaceSecurityRestrictedEgress: "Restrict outbound HTTP",
  workspaceSecurityRestrictedEgressHint:
    "General outbound HTTP tools are hidden and denied. Storage and Git in this category remain available.",
  deleteSpace: "Delete category",
  deleteSpaceWarning:
    'Delete the empty category "{name}"? This cannot be undone. Takos will refuse deletion while chats, Storage files, Git data, apps, Capsules, or managed resources remain.',
  typeWorkspaceNameToConfirm:
    "Type the category name exactly to confirm deletion",
  typeToConfirm: "Type the requested text to confirm",
  deleteSpaceHint: "Permanently delete this category after it is empty",
  spaceDeleted: "Category deleted",
  createCategory: "Create category",
  createCategoryHint:
    "Make a private place for each area you want to keep separate, such as work, home, or hobbies.",
  categoryName: "Category name",
  categoryNamePlaceholder: "For example: Work, Home, Hobbies",
  categoryDescriptionPlaceholder: "What belongs in this category (optional)",
  installFeaturedAppsOnCreate: "Install featured apps",
  installFeaturedAppsOnCreateHint:
    "Add operator-selected apps from the connected app catalog.",
  categoryCreated: "Category created",
  workspaceSavedRefreshFailed:
    "The category was saved, but the category list could not be refreshed. Reload to see the latest state.",
  workspaceCreatedRefreshFailed:
    "The category was created, but the category list could not be refreshed. Reload to see it.",
  workspaceDeletedRefreshFailed:
    "The category was deleted, but the category list could not be refreshed. Reload to update the list.",
  targetSpace: "Target category",
} as const;
