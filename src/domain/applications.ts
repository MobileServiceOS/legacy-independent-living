/** Applicant pipeline: NEW → UNDER_REVIEW → APPROVED / DECLINED / WAITLISTED → CONVERTED (resident). */

export const APPLICATION_STATUSES = ["NEW", "UNDER_REVIEW", "APPROVED", "DECLINED", "WAITLISTED", "CONVERTED"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  NEW: "New",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  DECLINED: "Declined",
  WAITLISTED: "Waitlisted",
  CONVERTED: "Resident",
};

const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  NEW: ["UNDER_REVIEW", "APPROVED", "DECLINED", "WAITLISTED"],
  UNDER_REVIEW: ["APPROVED", "DECLINED", "WAITLISTED"],
  WAITLISTED: ["UNDER_REVIEW", "APPROVED", "DECLINED"],
  DECLINED: ["UNDER_REVIEW"],
  APPROVED: ["CONVERTED", "UNDER_REVIEW", "DECLINED", "WAITLISTED"],
  CONVERTED: [],
};

export function canMoveApplication(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextApplicationStatuses(from: ApplicationStatus): readonly ApplicationStatus[] {
  return TRANSITIONS[from];
}

/** Housing situations offered on the public form (operational, non-sensitive). */
export const HOUSING_SITUATIONS = [
  "Currently without housing",
  "Staying with family or friends",
  "In a shelter or transitional program",
  "Renting elsewhere / looking to move",
  "Other",
] as const;

export const CONTACT_PREFERENCES = ["Phone call", "Text message", "Email"] as const;
