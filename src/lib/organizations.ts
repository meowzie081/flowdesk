export type OrgMembershipRow = { organization_id: string; role: string };

/** Первая организация, где пользователь owner (иначе admin); null — своих организаций нет. */
export function pickOwnedOrgId(rows: OrgMembershipRow[]): string | null {
  const owner = rows.find((r) => r.role === 'owner');
  if (owner) return owner.organization_id;
  const admin = rows.find((r) => r.role === 'admin');
  return admin ? admin.organization_id : null;
}