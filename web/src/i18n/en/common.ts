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
  tabSectionsLabel: "Sections",
  dialog: "Dialog",
  confirm: "Confirm",
  refresh: "Refresh",
  search: "Search",
  settings: "Settings",
  logout: "Sign out",
  loggingOut: "Signing out...",
  all: "All",
  notFound: "Not found",
  passwordRequired: "Password required",
  enterPasswordToView: "Enter the password to view this shared thread.",
  unlock: "Unlock",
  invalidSharePassword: "The share password is incorrect.",
  sharePasswordRateLimited:
    "Too many password attempts. Try again in {seconds} seconds.",
  sharePasswordRequirements:
    "Use a password with at least 8 non-whitespace characters and no more than 256 characters.",
  shareExpiryDaysInvalid: "Expiry must be a whole number from 1 to 365 days.",
  shareNotAvailable: "This share is not available.",
  sharedMessageDataTruncated:
    "Some oversized or unavailable message data is shown as a bounded preview.",
  noMessages: "No messages.",
  revoke: "Revoke",
  revoked: "Revoked",
  noShareLinks: "No share links yet.",
  move: "Move",
  moved: "Moved",
  loadingContent: "Loading content",
  unexpectedErrorTitle: "Something went wrong",
  unexpectedErrorDescription: "An unexpected error occurred. Please try again.",
  tryAgain: "Try again",
  breadcrumbLabel: "Breadcrumb",
  breadcrumbMoreItems: "Show more items",
  goBack: "Go Back",
  noSpaceAvailable: "No space available",
  sortLabel: "Sort:",
  newest: "Newest",
  loadMore: "Load more",
  remove: "Remove",
  install: "Install",
  connect: "Connect",
  disconnect: "Disconnect",
  active: "Active",
  subscribed: "Subscribed",
  queryResult: "Query result",
  categoryNavigation: "Category navigation",
  mainNavigation: "Main navigation",
  resourceStatusLabel: "Status: {status}",
  avatar: "Avatar",
  avatarAlt: "{name}'s avatar",
  unknownAuthor: "Unknown",
  selectOption: "Select an option",

  // App
  appName: "Takos",

  // Navigation
  primaryNavigation: "Primary navigation",
  storage: "Storage",
  deployNav: "Deploy",

  // Inventory
  inventory: "Inventory",

  // Space create
  description: "Description",
  descriptionPlaceholder: "Enter space description...",
  creating: "Creating...",
  nameRequired: "Name is required",

  // Apps
  apps: "Apps",
  appTypePlatform: "Platform",
  appTypeCustom: "Custom",
  appStatusUnknown: "Unknown",
  appStatusDeployed: "Deployed",
  appStatusActive: "Active",
  appStatusReady: "Ready",
  appStatusFailed: "Failed",
  appStatusError: "Error",
  appStatusDegraded: "Degraded",
  appStatusPending: "Pending",
  appStatusQueued: "Queued",
  appStatusInProgress: "In Progress",
  appStatusPaused: "Paused",
  failedToLoadApps: "Failed to load apps",

  // Discord-style UI
  personal: "Personal",

  // Errors
  unknownError: "Unknown error",
  networkError: "Network error",
  failedToCreate: "Failed to create",
  failedToLoad: "Failed to load",
  failedToSave: "Failed to save",
  failedToDelete: "Failed to delete",
  failedToLogout: "Failed to sign out",
  requestTimedOut: "Request timed out",
  authenticationRequired: "Authentication required",
  requestFailed: "Request failed",
  billingQuotaExceeded: "Billing quota exceeded",

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
  legalInfo: "Legal & Privacy",
  notFoundMessage: "We couldn't find that page.",
  backToHome: "Back to home",
  openInNewTab: "Open in new tab",

  // Fork
  forking: "Forking...",

  // Tools
  version: "Version",

  // Markdown
  copyCode: "Copy code",
  copyFailed: "Copy failed",

  // Navigation
  store: "Source",

  // Sidebar
  deleteThread: "Delete thread",
  archiveThread: "Archive",
  unarchiveThread: "Unarchive",
  unarchivingThread: "Unarchiving...",
  archivedThreadNotice:
    "This Thread is archived. Unarchive it to continue.",
  collapseThreads: "Collapse threads",
  expandThreads: "Expand threads",
  categories: "Categories",
  noCategories: "No categories yet",
  noThreadsYet: "No threads",
  repos: "Repos",

  updatedDate: "Updated {date}",
  userNotFound: "User not found",
  failedToLoadRepositories: "Failed to load repositories",
  infrastructure: "Infrastructure",
  shareResource: "Share",
  add: "Add",
  open: "Open",
  dangerZone: "Danger Zone",
  saved: "Saved",
  created: "Created",
  retry: "Retry",
  repositories: "Repositories",
  size: "Size",
  reject: "Reject",
  accept: "Accept",
  new: "New",
} as const;
