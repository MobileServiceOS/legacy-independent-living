/** Server-side input validation. Every server action parses FormData through these. */
import { z } from "zod";
import { parseDollarsToCents } from "../domain/money";
import { isDateOnly } from "../domain/dates";
import { HOUSING_SITUATIONS, CONTACT_PREFERENCES, APPLICATION_STATUSES } from "../domain/applications";
import { MANUAL_ROOM_STATUSES } from "../domain/rooms";

const trimmed = (max = 200) => z.string().trim().max(max);
const required = (label: string, max = 200) => trimmed(max).min(1, `${label} is required`);
const optional = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Enter a valid email address");

export const phone = z
  .string()
  .trim()
  .min(7, "Enter a valid phone number")
  .max(30)
  .regex(/^[0-9+().\-\s]+$/, "Enter a valid phone number");

export const dateOnly = (label = "Date") =>
  z.string().trim().refine(isDateOnly, `${label} must be a valid date`);

export const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isDateOnly(v), "Enter a valid date");

/** Positive dollar amount → integer cents. */
export const dollars = (label = "Amount") =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = parseDollarsToCents(v);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a dollar amount like 750 or 750.00` });
        return z.NEVER;
      }
      return cents;
    });

/** Dollar amount allowing zero (settings). */
export const dollarsOrZero = (label = "Amount") =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = v === "" ? 0 : parseDollarsToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a dollar amount` });
        return z.NEVER;
      }
      return cents;
    });

const intIn = (label: string, min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("1"), z.literal("")])
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

export const id = z.string().trim().min(1, "Please choose one").max(64);

/** Empty <select>/<input> values arrive as "" — treat them as "not provided". */
const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);

// ---------------------------------------------------------------- auth
export const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password").max(200) });
export const setPasswordSchema = z
  .object({ token: z.string().min(20).max(200), password: z.string().max(200), confirm: z.string().max(200) })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

// ---------------------------------------------------------------- applications
export const applicationSchema = z.object({
  firstName: required("First name", 80),
  lastName: required("Last name", 80),
  email,
  phone,
  preferredContact: blankToUndefined(z.enum(CONTACT_PREFERENCES).optional()),
  desiredMoveInDate: optionalDate,
  housingSituation: blankToUndefined(z.enum(HOUSING_SITUATIONS).optional()),
  isVeteran: blankToUndefined(
    z
      .enum(["yes", "no", "prefer_not"])
      .optional()
      .transform((v) => (v === "yes" ? true : v === "no" ? false : null)),
  ),
  referralSource: optional(120),
  message: optional(2000),
  emergencyContactName: optional(120),
  emergencyContactPhone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v ? v : null)),
  consent: z.literal("on", { errorMap: () => ({ message: "Please confirm the information is accurate" }) }),
  website: z.string().max(0, "Please leave this field empty").optional(), // honeypot
});

export const applicationStatusSchema = z.object({
  applicationId: id,
  status: z.enum(APPLICATION_STATUSES),
  reviewNotes: optional(4000),
});

// ---------------------------------------------------------------- properties & rooms
export const propertySchema = z.object({
  propertyId: blankToUndefined(id.optional()),
  name: required("Property name", 120),
  addressLine1: required("Street address", 200),
  addressLine2: optional(200),
  city: required("City", 80),
  state: required("State", 40),
  postalCode: required("ZIP code", 12),
  notes: optional(2000),
});

export const roomSchema = z.object({
  roomId: blankToUndefined(id.optional()),
  propertyId: id,
  name: required("Room name", 60),
  defaultRent: dollars("Monthly rent"),
  notes: optional(1000),
});

export const roomStatusSchema = z.object({
  roomId: id,
  status: z.enum(MANUAL_ROOM_STATUSES as unknown as [string, ...string[]]),
});

// ---------------------------------------------------------------- residents
const residentProfile = {
  firstName: required("First name", 80),
  lastName: required("Last name", 80),
  email,
  phone,
  emergencyContactName: optional(120),
  emergencyContactPhone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v ? v : null)),
  emergencyContactRelation: optional(60),
  notes: optional(4000),
};

export const residentEditSchema = z.object({ residentId: id, ...residentProfile });

/** Convert an approved applicant, or add a resident directly (no applicationId). */
export const placementSchema = z.object({
  applicationId: blankToUndefined(id.optional()),
  ...residentProfile,
  roomId: id,
  monthlyRent: dollars("Monthly rent"),
  moveInDate: dateOnly("Move-in date"),
  dueDay: intIn("Rent due day", 1, 28),
});

export const transferSchema = z.object({
  residentId: id,
  roomId: id,
  effectiveDate: dateOnly("Transfer date"),
  reason: optional(300),
});

export const rentChangeSchema = z.object({
  residentId: id,
  monthlyRent: dollars("Monthly rent"),
  dueDay: intIn("Rent due day", 1, 28),
  effectiveDate: dateOnly("Effective date"),
  reason: optional(300),
});

export const moveOutSchema = z.object({
  residentId: id,
  moveOutDate: dateOnly("Move-out date"),
  reason: optional(500),
});

export const ledgerEntrySchema = z.object({
  residentId: id,
  kind: z.enum(["OTHER_CHARGE", "LATE_FEE", "CREDIT", "ADJUSTMENT_UP", "ADJUSTMENT_DOWN"]),
  amount: dollars(),
  effectiveDate: dateOnly(),
  description: required("Description", 200),
});

// ---------------------------------------------------------------- payments
export const offlinePaymentSchema = z.object({
  residentId: id,
  amount: dollars(),
  paidOn: dateOnly("Payment date"),
  method: z.enum(["CASH", "MONEY_ORDER", "CHECK", "EXTERNAL"]),
  reference: required("Reference / note", 200),
  note: optional(500),
});

export const onlinePaymentSchema = z.object({
  amount: dollars(),
  method: z.enum(["ACH", "DEBIT_CARD", "CREDIT_CARD"]),
});

export const refundSchema = z.object({ paymentId: id, reason: required("Reason", 300) });

// ---------------------------------------------------------------- documents, settings, announcements
export const documentSchema = z.object({
  residentId: id,
  kind: z.enum(["HOUSING_AGREEMENT", "ID_REFERENCE", "OTHER"]),
  title: required("Title", 150),
  referenceNote: optional(300),
  visibleToResident: checkbox,
});

export const settingsSchema = z.object({
  businessName: required("Business name", 120),
  timezone: z.string().trim().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  chargeLeadDays: intIn("Charge lead days", 0, 28),
  graceDays: intIn("Grace days", 0, 28),
  lateFee: dollarsOrZero("Late fee"),
  allowPartialPayments: checkbox,
  minPartialPayment: dollarsOrZero("Minimum partial payment"),
  onlinePaymentsEnabled: checkbox,
  supportPhone: optional(30),
  supportEmail: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
});

export const announcementSchema = z.object({
  title: required("Title", 120),
  body: required("Message", 2000),
  propertyId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
});

// ---------------------------------------------------------------- helpers
export type FieldErrors = Record<string, string>;

export function formToObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
