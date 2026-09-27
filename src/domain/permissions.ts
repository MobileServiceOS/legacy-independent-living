/**
 * Role-based access control. Every server action / route handler calls
 * `can(role, permission)` (via requirePermission) — UI hiding is cosmetic only.
 *
 * Adding a role later (e.g. PROPERTY_MANAGER, STAFF):
 *   1. add it to the `Role` enum in prisma/schema.prisma + a migration
 *   2. add it to ROLES and ROLE_PERMISSIONS below
 *   3. (optional) scope by property via a user↔property join table
 */

export const ROLES = ["ADMIN", "RESIDENT"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "admin:access",
  "properties:read",
  "properties:write",
  "residents:read",
  "residents:write",
  "applications:read",
  "applications:write",
  "payments:read",
  "payments:record",
  "payments:refund",
  "ledger:write",
  "documents:write",
  "reports:read",
  "notifications:broadcast",
  "settings:write",
  "audit:read",
  "self:read",
  "self:pay",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((p) => !p.startsWith("self:"));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  RESIDENT: ["self:read", "self:pay"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Where each role lands after sign-in. */
export function homePathFor(role: Role): string {
  return role === "RESIDENT" ? "/home" : "/admin";
}

/**
 * Record-level check for resident-owned data (payments, receipts, documents,
 * ledger). Admin-type roles pass via permission; residents only see their own.
 */
export function canAccessResidentRecord(
  viewer: { role: Role; residentId: string | null },
  ownerResidentId: string,
  adminPermission: Permission = "residents:read",
): boolean {
  if (can(viewer.role, adminPermission)) return true;
  return viewer.role === "RESIDENT" && viewer.residentId !== null && viewer.residentId === ownerResidentId;
}
