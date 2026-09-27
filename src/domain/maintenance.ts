/**
 * Maintenance requests: resident-reported repairs, tracked to completion.
 *
 *   SUBMITTED → ACKNOWLEDGED → SCHEDULED → IN_PROGRESS → COMPLETED
 *        │            │             │            │
 *        └────────────┴─────────────┴────────────┴──▶ CANCELED
 *   COMPLETED can be REOPENED (→ ACKNOWLEDGED) if the fix didn't hold.
 */

export const MAINTENANCE_STATUSES = ["SUBMITTED", "ACKNOWLEDGED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELED"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  SUBMITTED: "Submitted",
  ACKNOWLEDGED: "Received",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
};

/** Plain-language explanation shown to residents under the status. */
export const MAINTENANCE_STATUS_HELP: Record<MaintenanceStatus, string> = {
  SUBMITTED: "We got your request and will look at it soon.",
  ACKNOWLEDGED: "The office has seen your request and is arranging the repair.",
  SCHEDULED: "A repair visit is scheduled.",
  IN_PROGRESS: "Work on this repair has started.",
  COMPLETED: "This repair is done. Let us know if the problem comes back.",
  CANCELED: "This request was canceled.",
};

const TRANSITIONS: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  SUBMITTED: ["ACKNOWLEDGED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELED"],
  ACKNOWLEDGED: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELED"],
  SCHEDULED: ["ACKNOWLEDGED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELED"],
  IN_PROGRESS: ["SCHEDULED", "COMPLETED", "CANCELED"],
  COMPLETED: ["ACKNOWLEDGED"],
  CANCELED: [],
};

export function canMoveMaintenance(from: MaintenanceStatus, to: MaintenanceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextMaintenanceStatuses(from: MaintenanceStatus): readonly MaintenanceStatus[] {
  return TRANSITIONS[from];
}

export function isOpen(status: MaintenanceStatus): boolean {
  return status !== "COMPLETED" && status !== "CANCELED";
}

/** Residents may cancel only before anyone has started on it. */
export function residentCanCancel(status: MaintenanceStatus): boolean {
  return status === "SUBMITTED" || status === "ACKNOWLEDGED";
}

/** Residents may reopen a completed request within this many days. */
export const REOPEN_WINDOW_DAYS = 14;

export const MAINTENANCE_CATEGORIES = [
  "PLUMBING",
  "ELECTRICAL",
  "HEATING_COOLING",
  "APPLIANCE",
  "DOORS_LOCKS",
  "PESTS",
  "SAFETY",
  "GENERAL",
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const MAINTENANCE_CATEGORY_LABELS: Record<MaintenanceCategory, string> = {
  PLUMBING: "Plumbing (leaks, toilet, sink, shower)",
  ELECTRICAL: "Electrical (outlets, lights, power)",
  HEATING_COOLING: "Heating or air conditioning",
  APPLIANCE: "Appliance (fridge, stove, washer)",
  DOORS_LOCKS: "Doors, windows or locks",
  PESTS: "Pests",
  SAFETY: "Smoke alarm or safety",
  GENERAL: "Something else",
};

export const MAINTENANCE_CATEGORY_SHORT: Record<MaintenanceCategory, string> = {
  PLUMBING: "Plumbing",
  ELECTRICAL: "Electrical",
  HEATING_COOLING: "Heating / AC",
  APPLIANCE: "Appliance",
  DOORS_LOCKS: "Doors & locks",
  PESTS: "Pests",
  SAFETY: "Safety",
  GENERAL: "General",
};

export const MAINTENANCE_PRIORITIES = ["LOW", "NORMAL", "URGENT"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  LOW: "Low — whenever you can",
  NORMAL: "Normal — in the next few days",
  URGENT: "Urgent — needs attention today",
};

export const MAINTENANCE_PRIORITY_SHORT: Record<MaintenancePriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  URGENT: "Urgent",
};

/** Sort order for the owner's queue: urgent + oldest open first, closed last. */
export function queueRank(r: { status: MaintenanceStatus; priority: MaintenancePriority; createdAt: Date }): [number, number, number] {
  const open = isOpen(r.status) ? 0 : 1;
  const pri = r.priority === "URGENT" ? 0 : r.priority === "NORMAL" ? 1 : 2;
  return [open, pri, r.createdAt.getTime()];
}

export function compareQueue(
  a: { status: MaintenanceStatus; priority: MaintenancePriority; createdAt: Date },
  b: { status: MaintenanceStatus; priority: MaintenancePriority; createdAt: Date },
): number {
  const ra = queueRank(a);
  const rb = queueRank(b);
  for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
  return 0;
}

export const MAX_MAINTENANCE_PHOTOS = 3;

/** Human-friendly reference: MR-1042 */
export function maintenanceRef(number: number): string {
  return `MR-${number}`;
}
