export const common = {
  // Common
  loading: "Loading...",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  create: "Create",
  edit: "Edit",
  copy: "Copy",
  close: "Close",
  dialog: "Dialog",
  confirm: "Confirm",
  refresh: "Refresh",
  search: "Search",
  settings: "Settings",
  logout: "Sign out",
  notFound: "Not found",
  passwordRequired: "Password required",
  enterPasswordToView: "Enter the password to view this shared thread.",
  unlock: "Unlock",
  shareNotAvailable: "This share is not available.",
  noMessages: "No messages.",
  revoke: "Revoke",
  revoked: "Revoked",
  noShareLinks: "No share links yet.",
  move: "Move",
  moved: "Moved",

  // App
  appName: "Takos",

  // Navigation
  primaryNavigation: "Primary navigation",
  storage: "Storage",
  deployNav: "Deploy",
  groups: "Groups",
  groupsDescription: "Review groups managed by deploy.",

  // Workspaces
  createWorkspace: "Create Space",
  createGroup: "Create Group",
  groupName: "Group Name",
  groupNamePlaceholder: "my-app-production",
  groupCreated: "Group created",
  failedToCreateGroup: "Failed to create group",
  failedToLoadGroups: "Failed to load groups",
  searchGroups: "Search groups",
  noGroups: "No groups yet",
  noGroupsDescription: "Apps deployed from manifests appear here as groups.",
  noGroupSelected: "Select a group",
  desiredState: "Desired State",
  noDesiredState: "No desired state yet",
  inventory: "Inventory",
  workloads: "Workloads",
  routes: "Routes",
  environment: "Environment",
  lastApplied: "Last Applied",
  updated: "Updated",
  source: "Source",
  noItems: "No items",
  workspaceName: "Space Name",
  workspaceNamePlaceholder: "My Project",
  description: "Description",
  descriptionPlaceholder: "Enter space description...",
  noDescription: "No description",
  creating: "Creating...",
  nameRequired: "Name is required",

  // Apps
  apps: "Apps",

  // Discord-style UI
  personal: "Personal",

  // Errors
  unknownError: "Unknown error",
  networkError: "Network error",
  failedToCreate: "Failed to create",
  failedToLoad: "Failed to load",
  failedToSave: "Failed to save",
  failedToDelete: "Failed to delete",
  workspaceNotFound: "Space not found",
  workspaceNotFoundDesc: "The space does not exist or you do not have access.",

  // Confirmation Dialog
  confirmDelete: "Confirm Delete",
  confirmDeleteThread: "Delete this chat?",
  confirmDeleteMemory: "Delete this memory?",
  confirmDeleteReminder: "Delete this reminder?",
  confirmDeleteSkill: "Delete this skill?",
  confirmDeleteDomain: "Delete this domain?",
  deleteDomain: "Delete Domain",
  deleteWarning: "This action cannot be undone",

  // Toast Notifications
  success: "Success",
  error: "Error",
  operationFailed: "Operation failed",

  // Profile Menu
  profileMenu: "Profile menu",
  accountSettings: "Account Settings",
  openInNewTab: "Open in new tab",

  // Fork
  forking: "Forking...",

  // Deployments
  noDeployments: "No deployments",

  // Tools
  version: "Version",

  // Markdown
  copyCode: "Copy code",
  copyFailed: "Copy failed",

  // Navigation
  store: "Store",

  // Sidebar
  deleteThread: "Delete thread",
  archiveThread: "Archive",
  unarchiveThread: "Unarchive",
  collapseThreads: "Collapse threads",
  expandThreads: "Expand threads",
  projects: "Projects",
  noProjects: "No projects",
  noThreadsYet: "No threads",
  repos: "Repos",

  // Profile
  noActivityYet: "No activity yet",
  noPublicReposYet: "No public repositories yet",
  noFollowRequests: "No follow requests",
  noStarredReposYet: "No starred repositories yet",
  reject: "Reject",
  accept: "Accept",
  new: "New",
} as const;
