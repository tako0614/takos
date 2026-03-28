/**
 * Official Packages
 *
 * First-party packages that always appear in the store catalog.
 * These are defined in code (not DB) so they're always available
 * regardless of database state.
 *
 * Similar pattern to official-skills.ts.
 */

export interface OfficialPackage {
  /** Unique identifier */
  id: string;
  /** Package name */
  name: string;
  /** Short description */
  description: string;
  /** Category for filtering */
  category: 'app' | 'service' | 'library' | 'template' | 'tool';
  /** Git clone URL */
  url: string;
  /** Owner display info */
  owner: {
    name: string;
    username: string;
  };
  /** Tags for search/filtering */
  tags: string[];
  /** Whether this is recommended for new users */
  recommended: boolean;
  /** Display priority (higher = shown first) */
  priority: number;
}

export const OFFICIAL_PACKAGES: OfficialPackage[] = [
  {
    id: 'official/takos-computer',
    name: 'Takos Computer',
    description: 'Browser automation and agent executor',
    category: 'tool',
    url: 'https://github.com/tako0614/takos-computer.git',
    owner: {
      name: 'Takos',
      username: 'takos',
    },
    tags: ['browser', 'executor', 'agent', 'playwright', 'automation'],
    recommended: true,
    priority: 100,
  },
];
