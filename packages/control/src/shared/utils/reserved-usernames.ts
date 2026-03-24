export const RESERVED_USERNAMES = new Set([
  // System accounts
  'system',
  'admin',
  'administrator',
  'root',
  'superuser',
  'moderator',
  'mod',

  // Platform branding
  'yurucommu',
  'official',
  'verified',
  'staff',
  'team',
  'support',
  'help',

  // Common reserved
  'api',
  'app',
  'apps',
  'www',
  'web',
  'home',
  'about',
  'blog',
  'news',
  'docs',
  'documentation',
  'wiki',
  'faq',
  'contact',
  'feedback',
  'legal',
  'terms',
  'privacy',
  'policy',

  // Actions/routes that could conflict
  'login',
  'logout',
  'signin',
  'signout',
  'signup',
  'register',
  'auth',
  'oauth',
  'sso',
  'settings',
  'profile',
  'account',
  'dashboard',
  'console',
  'panel',

  // Reserved for future use
  'explore',
  'trending',
  'popular',
  'featured',
  'discover',
  'search',
  'notifications',
  'messages',
  'inbox',
  'following',
  'followers',
  'likes',
  'bookmarks',

  // Technical terms
  'null',
  'undefined',
  'none',
  'anonymous',
  'guest',
  'unknown',
  'deleted',
  'suspended',
  'banned',

  // Common test accounts
  'test',
  'testing',
  'demo',
  'example',
  'sample',
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}

export function validateUsername(username: string): string | null {
  if (!username || username.length === 0) {
    return 'Username is required';
  }

  if (username.length < 3) {
    return 'Username must be at least 3 characters';
  }

  if (username.length > 30) {
    return 'Username must be at most 30 characters';
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return 'Username can only contain letters, numbers, underscores, and hyphens';
  }

  if (!/^[a-zA-Z0-9]/.test(username)) {
    return 'Username must start with a letter or number';
  }

  if (/[_-]$/.test(username)) {
    return 'Username cannot end with underscore or hyphen';
  }

  if (/[_-]{2,}/.test(username)) {
    return 'Username cannot have consecutive underscores or hyphens';
  }

  if (isReservedUsername(username)) {
    return 'This username is reserved';
  }

  return null;
}
