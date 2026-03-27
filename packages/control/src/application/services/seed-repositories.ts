/**
 * Seed Repositories
 *
 * A flat list of repository URLs shown to users during new account/workspace
 * creation. The frontend renders these in a selection popup so the user can
 * pick which ones to clone into their workspace.
 *
 * This has nothing to do with the store — the store is for discovery.
 * This is purely "here are some repos you probably want on day one".
 */

export interface SeedRepository {
  /** Clone URL (git HTTPS) */
  url: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Category tag for grouping in the UI */
  category: string;
  /** Whether this is pre-checked in the popup */
  checked: boolean;
}

/**
 * The list. Add / remove entries here.
 * Order matters — it's the display order in the popup.
 */
export const SEED_REPOSITORIES: SeedRepository[] = [
  {
    url: 'https://github.com/tako0614/takos-computer.git',
    name: 'Takos Computer',
    description: 'Browser automation and agent executor',
    category: 'tool',
    checked: true,
  },
];
