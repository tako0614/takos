import { describe, expect, it } from 'vitest';

import { normalizeUsernameInput, syncRouteWithUsernameChange } from '../../../views/app/settings-username';

describe('settings username helpers', () => {
  it('normalizes user input to canonical username characters', () => {
    expect(normalizeUsernameInput('@My-User.Name')).toBe('my-username');
    expect(normalizeUsernameInput('___Alpha')).toBe('___alpha');
  });

  it('updates self profile routes after username change', () => {
    const route = syncRouteWithUsernameChange(
      { view: 'profile', username: 'old-handle' },
      'old-handle',
      'new-handle',
    );

    expect(route).toEqual({ view: 'profile', username: 'new-handle' });
  });

  it('updates self repo routes after username change', () => {
    const route = syncRouteWithUsernameChange(
      { view: 'repo', username: 'old-handle', repoName: 'demo' },
      'old-handle',
      'new-handle',
    );

    expect(route).toEqual({ view: 'repo', username: 'new-handle', repoName: 'demo' });
  });

  it('leaves unrelated routes unchanged', () => {
    const route = { view: 'chat', spaceId: 'ws-1' } as const;

    expect(syncRouteWithUsernameChange(route, 'old-handle', 'new-handle')).toBe(route);
    expect(
      syncRouteWithUsernameChange(
        { view: 'profile', username: 'someone-else' },
        'old-handle',
        'new-handle',
      ),
    ).toEqual({ view: 'profile', username: 'someone-else' });
  });
});
