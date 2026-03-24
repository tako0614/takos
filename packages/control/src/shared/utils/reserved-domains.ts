export const RESERVED_SUBDOMAINS = new Set([
  // Administrative
  'admin',
  'administrator',
  'root',
  'superuser',

  // API and services
  'api',
  'api-v1',
  'api-v2',
  'graphql',
  'rest',
  'rpc',
  'ws',
  'websocket',

  // Web
  'www',
  'www1',
  'www2',
  'www3',

  // Email/Communication
  'mail',
  'email',
  'smtp',
  'pop',
  'pop3',
  'imap',
  'webmail',
  'postmaster',
  'mailer',

  // DNS/Networking
  'ns',
  'ns1',
  'ns2',
  'ns3',
  'ns4',
  'dns',
  'dns1',
  'dns2',
  'mx',
  'mx1',
  'mx2',
  'ftp',
  'sftp',
  'ssh',
  'vpn',
  'proxy',
  'gateway',

  // CDN/Static content
  'cdn',
  'static',
  'assets',
  'media',
  'images',
  'img',
  'files',
  'uploads',
  'download',
  'downloads',

  // Authentication
  'auth',
  'oauth',
  'sso',
  'login',
  'logout',
  'signin',
  'signout',
  'signup',
  'register',
  'account',
  'accounts',
  'password',
  'reset',
  'verify',
  'confirm',

  // User-facing apps
  'app',
  'apps',
  'dashboard',
  'console',
  'panel',
  'portal',
  'my',
  'user',
  'users',
  'profile',
  'settings',
  'preferences',

  // Support/Information
  'status',
  'health',
  'healthcheck',
  'ping',
  'help',
  'support',
  'contact',
  'feedback',
  'docs',
  'documentation',
  'wiki',
  'faq',
  'about',
  'info',
  'legal',
  'terms',
  'privacy',
  'policy',

  // Content
  'blog',
  'news',
  'forum',
  'community',
  'chat',
  'discuss',

  // Development/Testing
  'dev',
  'development',
  'staging',
  'stage',
  'test',
  'testing',
  'qa',
  'uat',
  'demo',
  'sandbox',
  'preview',
  'beta',
  'alpha',
  'canary',
  'edge',
  'nightly',
  'local',
  'localhost',

  // Infrastructure
  'internal',
  'intranet',
  'private',
  'secure',
  'ssl',
  'tls',
  'cert',
  'certs',
  'backup',
  'backups',
  'archive',
  'logs',
  'log',
  'metrics',
  'monitor',
  'monitoring',
  'analytics',
  'tracking',

  // Commerce/Billing
  'shop',
  'store',
  'checkout',
  'cart',
  'billing',
  'payment',
  'payments',
  'invoice',
  'invoices',
  'subscribe',
  'subscription',

  // Mobile
  'mobile',
  'm',
  'android',
  'ios',

  // Miscellaneous reserved
  'ww',
  'ww1',
  'ww2',
  'origin',
  'server',
  'web',
  'home',
  'main',
  'default',
  'null',
  'undefined',
  'none',
  'example',
  'sample',
  'temp',
  'tmp',
  'cache',

  // Brand protection
  'takos',
  'yurucommu',
]);

export function isReservedSubdomain(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.has(subdomain.toLowerCase());
}

export function hasReservedSubdomain(domain: string): boolean {
  const firstLabel = domain.toLowerCase().split('.')[0];
  return RESERVED_SUBDOMAINS.has(firstLabel);
}

export function isDomainReserved(domain: string, tenantBaseDomain: string): boolean {
  const normalized = domain.toLowerCase().trim().replace(/\.+$/, '');
  const baseDomain = tenantBaseDomain.toLowerCase();

  // Cannot use the platform domain itself
  if (normalized === baseDomain) {
    return true;
  }

  // Cannot use subdomains of the platform domain
  if (normalized.endsWith(`.${baseDomain}`)) {
    return true;
  }

  // Cannot use reserved subdomains
  return hasReservedSubdomain(normalized);
}
