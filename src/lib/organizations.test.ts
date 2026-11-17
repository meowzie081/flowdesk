import { describe, expect, it } from 'vitest';
import { pickOwnedOrgId } from './organizations';

describe('pickOwnedOrgId', () => {
  it('нет членства — нет своей организации', () => {
    expect(pickOwnedOrgId([])).toBeNull();
    expect(pickOwnedOrgId([{ organization_id: 'o1', role: 'member' }])).toBeNull();
  });

  it('owner важнее admin и member', () => {
    expect(
      pickOwnedOrgId([
        { organization_id: 'o1', role: 'admin' },
        { organization_id: 'o2', role: 'owner' },
        { organization_id: 'o3', role: 'member' },
      ]),
    ).toBe('o2');
  });

  it('admin подходит, если owner нет', () => {
    expect(
      pickOwnedOrgId([
        { organization_id: 'o1', role: 'member' },
        { organization_id: 'o2', role: 'admin' },
      ]),
    ).toBe('o2');
  });
});