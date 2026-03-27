// --- Naming utilities ---

/** Maximum length of a generated slug. */
const MAX_SLUG_LENGTH = 32;

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH) || 'space';
}

export function sanitizeRepoName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}
