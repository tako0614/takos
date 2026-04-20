import { bytesToHex } from "./encoding-utils.ts";

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

const VERIFICATION_TOKEN_LENGTH = 32;

/** Byte length of a generated domain ID (produces a 32-char hex string). */
const DOMAIN_ID_BYTE_LENGTH = 16;

/** Maximum total length of a valid domain name (RFC 1035). */
const MAX_DOMAIN_LENGTH = 253;

/** Maximum length of a single DNS label (RFC 1035). */
const MAX_DNS_LABEL_LENGTH = 63;

/** Minimum number of labels required for a valid domain (e.g. "example.com"). */
const MIN_DOMAIN_LABELS = 2;

export function generateVerificationToken(): string {
  const buffer = new Uint8Array(VERIFICATION_TOKEN_LENGTH);
  crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

export function generateDomainId(): string {
  const buffer = new Uint8Array(DOMAIN_ID_BYTE_LENGTH);
  crypto.getRandomValues(buffer);
  return "dom_" + bytesToHex(buffer);
}

export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) return false;
  const normalized = domain.endsWith(".") ? domain.slice(0, -1) : domain;
  const labels = normalized.split(".");
  if (labels.length < MIN_DOMAIN_LABELS) return false;

  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_DNS_LABEL_LENGTH) return false;
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) return false;
  }

  return true;
}

export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/\.+$/, "");
}

// ---------------------------------------------------------------------------
// Reserved subdomains
// ---------------------------------------------------------------------------

export const RESERVED_SUBDOMAINS = new Set([
  // Administrative
  "admin",
  "administrator",
  "root",
  "superuser",

  // API and services
  "api",
  "api-v1",
  "api-v2",
  "graphql",
  "rest",
  "rpc",
  "ws",
  "websocket",

  // Web
  "www",
  "www1",
  "www2",
  "www3",

  // Email/Communication
  "mail",
  "email",
  "smtp",
  "pop",
  "pop3",
  "imap",
  "webmail",
  "postmaster",
  "mailer",

  // DNS/Networking
  "ns",
  "ns1",
  "ns2",
  "ns3",
  "ns4",
  "dns",
  "dns1",
  "dns2",
  "mx",
  "mx1",
  "mx2",
  "ftp",
  "sftp",
  "ssh",
  "vpn",
  "proxy",
  "gateway",

  // CDN/Static content
  "cdn",
  "static",
  "assets",
  "media",
  "images",
  "img",
  "files",
  "uploads",
  "download",
  "downloads",

  // Authentication
  "auth",
  "oauth",
  "sso",
  "login",
  "logout",
  "signin",
  "signout",
  "signup",
  "register",
  "account",
  "accounts",
  "password",
  "reset",
  "verify",
  "confirm",

  // User-facing apps
  "app",
  "apps",
  "dashboard",
  "console",
  "panel",
  "portal",
  "my",
  "user",
  "users",
  "profile",
  "settings",
  "preferences",

  // Support/Information
  "status",
  "health",
  "healthcheck",
  "ping",
  "help",
  "support",
  "contact",
  "feedback",
  "docs",
  "documentation",
  "wiki",
  "faq",
  "about",
  "info",
  "legal",
  "terms",
  "privacy",
  "policy",

  // Content
  "blog",
  "news",
  "forum",
  "community",
  "chat",
  "discuss",

  // Development/Testing
  "dev",
  "development",
  "staging",
  "stage",
  "test",
  "testing",
  "qa",
  "uat",
  "demo",
  "sandbox",
  "preview",
  "beta",
  "alpha",
  "canary",
  "edge",
  "nightly",
  "local",
  "localhost",

  // Infrastructure
  "internal",
  "intranet",
  "private",
  "secure",
  "ssl",
  "tls",
  "cert",
  "certs",
  "backup",
  "backups",
  "archive",
  "logs",
  "log",
  "metrics",
  "monitor",
  "monitoring",
  "analytics",
  "tracking",

  // Commerce/Billing
  "shop",
  "store",
  "checkout",
  "cart",
  "billing",
  "payment",
  "payments",
  "invoice",
  "invoices",
  "subscribe",
  "subscription",

  // Mobile
  "mobile",
  "m",
  "android",
  "ios",

  // Miscellaneous reserved
  "ww",
  "ww1",
  "ww2",
  "origin",
  "server",
  "web",
  "home",
  "main",
  "default",
  "null",
  "undefined",
  "none",
  "example",
  "sample",
  "temp",
  "tmp",
  "cache",

  // Brand protection
  "takos",
  "yurucommu",
]);

export function isReservedSubdomain(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.has(subdomain.toLowerCase());
}

export function hasReservedSubdomain(domain: string): boolean {
  const firstLabel = domain.toLowerCase().split(".")[0];
  return RESERVED_SUBDOMAINS.has(firstLabel);
}

export function isDomainReserved(
  domain: string,
  tenantBaseDomain: string,
): boolean {
  const normalized = normalizeDomain(domain);
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

// ---------------------------------------------------------------------------
// Reserved usernames
// ---------------------------------------------------------------------------

export const RESERVED_USERNAMES = new Set([
  // System accounts
  "system",
  "admin",
  "administrator",
  "root",
  "superuser",
  "moderator",
  "mod",

  // Platform branding
  "yurucommu",
  "verified",
  "staff",
  "team",
  "support",
  "help",

  // Common reserved
  "api",
  "app",
  "apps",
  "www",
  "web",
  "home",
  "about",
  "blog",
  "news",
  "docs",
  "documentation",
  "wiki",
  "faq",
  "contact",
  "feedback",
  "legal",
  "terms",
  "privacy",
  "policy",

  // Actions/routes that could conflict
  "login",
  "logout",
  "signin",
  "signout",
  "signup",
  "register",
  "auth",
  "oauth",
  "sso",
  "settings",
  "profile",
  "account",
  "dashboard",
  "console",
  "panel",

  // Reserved for future use
  "explore",
  "trending",
  "popular",
  "featured",
  "discover",
  "search",
  "notifications",
  "messages",
  "inbox",
  "following",
  "followers",
  "likes",
  "bookmarks",

  // Technical terms
  "null",
  "undefined",
  "none",
  "anonymous",
  "guest",
  "unknown",
  "deleted",
  "suspended",
  "banned",

  // Common test accounts
  "test",
  "testing",
  "demo",
  "example",
  "sample",
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}

/** Minimum allowed username length. */
const MIN_USERNAME_LENGTH = 3;

/** Maximum allowed username length. */
const MAX_USERNAME_LENGTH = 30;

export function validateUsername(username: string): string | null {
  if (!username || username.length === 0) {
    return "Username is required";
  }

  if (username.length < MIN_USERNAME_LENGTH) {
    return `Username must be at least ${MIN_USERNAME_LENGTH} characters`;
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return `Username must be at most ${MAX_USERNAME_LENGTH} characters`;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return "Username can only contain letters, numbers, underscores, and hyphens";
  }

  if (!/^[a-zA-Z0-9]/.test(username)) {
    return "Username must start with a letter or number";
  }

  if (/[_-]$/.test(username)) {
    return "Username cannot end with underscore or hyphen";
  }

  if (/[_-]{2,}/.test(username)) {
    return "Username cannot have consecutive underscores or hyphens";
  }

  if (isReservedUsername(username)) {
    return "This username is reserved";
  }

  return null;
}
