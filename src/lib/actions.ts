/** Uniform server-action handling: validate → run → map errors → optional redirect. */
import { redirect } from "next/navigation";
import type { z } from "zod";
import { UserError } from "../server/errors";
import { fieldErrorsOf, formToObject, type FieldErrors } from "./validation";

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
  /** Echo of submitted values so the form can keep what the user typed. */
  values?: Record<string, string>;
  /** Arbitrary safe data for the client (e.g. an invite link to copy). */
  data?: Record<string, string>;
  /** Increments on each response so inputs remount with echoed values. */
  version?: number;
}

export const initialActionState: ActionState = { version: 0 };

type Outcome = void | { message?: string; redirectTo?: string; data?: Record<string, string> };

const SECRET_FIELDS = new Set(["password", "confirm", "token"]);

function echo(fd: FormData): Record<string, string> {
  const v = formToObject(fd);
  for (const k of Object.keys(v)) if (SECRET_FIELDS.has(k)) delete v[k];
  return v;
}

export async function runAction<S extends z.ZodTypeAny>(
  prev: ActionState,
  formData: FormData,
  schema: S,
  fn: (input: z.output<S>) => Promise<Outcome>,
): Promise<ActionState> {
  const version = (prev?.version ?? 0) + 1;
  const parsed = schema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error), values: echo(formData), version };
  }
  let outcome: Outcome;
  try {
    outcome = await fn(parsed.data);
  } catch (err) {
    if (err instanceof UserError) {
      return {
        ok: false,
        error: err.message,
        fieldErrors: err.field ? { [err.field]: err.message } : undefined,
        values: echo(formData),
        version,
      };
    }
    console.error("[action] unexpected error", err);
    return { ok: false, error: "Something went wrong. Please try again.", values: echo(formData), version };
  }
  if (outcome?.redirectTo) redirect(outcome.redirectTo); // outside try: redirect() throws by design
  return { ok: true, message: outcome?.message, data: outcome?.data, version };
}
