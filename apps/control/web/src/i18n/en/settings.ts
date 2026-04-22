export const settings = {
  // Settings
  settingsTitle: "Account Settings",
  account: "Account",
  email: "Email",
  name: "Name",
  language: "Language",

  // Billing
  billingTitle: "Billing",
  billingCurrentPlan: "Current plan",
  billingPlans: "Plans",
  billingPlansHint:
    "Manage your subscription and prepaid credits from one place.",
  billingCredits: "Credits",
  billingCreditsHint:
    "Pro credits stay on your account balance. If you are on Plus, that balance is kept dormant until you switch back to Pro.",
  billingInvoices: "Invoices",
  billingInvoicesHint: "Stripe invoices and receipts linked to your account.",
  billingStatus: "Status",
  billingBalance: "Balance",
  billingPeriodEnd: "Current period ends",
  billingRuntimeLimit: "7-day runtime limit",
  billingRuntimeLimitValue: "{hours} hours",
  billingModeFree: "Free",
  billingModePlus: "Plus",
  billingModePro: "Pro",
  billingPlanFreeTitle: "Free",
  billingPlanFreeDesc:
    "Included access with weekly runtime limits and no prepaid balance.",
  billingPlanPlusTitle: "Plus",
  billingPlanPlusDesc:
    "Flat subscription for a higher default allowance and managed billing through Stripe.",
  billingPlanProTitle: "Pro",
  billingPlanProDesc:
    "Prepaid credits for pay-as-you-go usage. Pick a pack when you need more balance.",
  billingCurrentBadge: "Current plan",
  billingIncludedBadge: "Included",
  billingUnavailable: "Unavailable right now",
  billingSubscribePlus: "Subscribe to Plus",
  billingManageSubscription: "Manage subscription",
  billingTopupPack: "Buy pack",
  billingTopupBlocked:
    "Cancel your Plus subscription before switching to Pro credits.",
  billingDormantBalanceNote:
    "Your existing Pro balance is preserved, but it is not spent while Plus is active.",
  billingNoCustomer: "No Stripe customer is linked to this account yet.",
  billingNoInvoices: "No invoices yet.",
  billingDownloadInvoice: "Download PDF",
  billingSendInvoice: "Email invoice",
  billingInvoiceSent: "Invoice email sent",
  billingInvoiceSendFailed: "Failed to send invoice email",
  billingInvoicesLoadFailed: "Failed to load invoices",
  billingLoadFailed: "Failed to load billing information",
  billingSubscribeFailed: "Failed to start Plus checkout",
  billingPortalFailed: "Failed to open subscription portal",
  billingTopupFailed: "Failed to start Pro top-up checkout",

  // Workspace Settings
  workspaceSettings: "Space Settings",
  workspaceInfo: "Space Information",
  workspaceSlug: "Space Slug",
  selectWorkspace: "Select Space",
  selectWorkspaceHint: "Select a space to view settings",
  personalWorkspaceNameHint: "Personal space name cannot be changed",
  personalWorkspaceNote:
    "This is your personal space. It cannot be deleted or shared with others. Use team spaces to collaborate with others.",
  deleteWorkspace: "Delete Space",
  deleteWorkspaceWarning:
    "Are you sure you want to delete this space? This action cannot be undone and all data will be permanently deleted.",
  deleteWorkspaceHint: "Permanently delete this space and all its data",
  workspaceDeleted: "Space deleted",
  createWorkspaceHint: "Create a team space to collaborate with others",
  workspaceCreated: "Space created",

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
  remove: "Remove",
  emailPlaceholder: "email@example.com",
  roleOwner: "Owner",
  roleAdmin: "Admin",
  roleMember: "Member",

  // Space aliases (code uses "space" prefix, but legacy keys use "workspace")
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
  installDefaultAppsOnCreate: "Install default apps",
  installDefaultAppsOnCreateHint:
    "Preinstall Docs, Excel, Slide, Computer, and Yurucommu. You can skip this and install apps later from Store.",
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
