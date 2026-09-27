"use client";
/**
 * Form kit built on React 19 server actions (useActionState).
 * - Keeps what the user typed after a validation error (echoed values + remount).
 * - Shows field-level errors next to the right input, announced to screen readers.
 */
import { createContext, useActionState, useContext, useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const FormCtx = createContext<ActionState>({});

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  copyResult,
  linkResult,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** After success, show state.data[key] in a copyable field (e.g. an invite link). */
  copyResult?: { key: string; label: string };
  /** After success, show a link to state.data[key]. */
  linkResult?: { key: string; label: string };
}) {
  const [state, formAction] = useActionState(action, { version: 0 });
  // Successful submits clear values unless resetOnSuccess is false (then keep them).
  const ctx: ActionState = state.ok && !resetOnSuccess ? { ...state, values: undefined } : state;
  return (
    <FormCtx.Provider value={ctx}>
      <form action={formAction} className={className} noValidate>
        {state.error ? (
          <div role="alert" className="mb-4 rounded-xl border border-bad/25 bg-bad-bg px-4 py-3 font-semibold text-bad">
            {state.error}
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div role="status" className="mb-4 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 font-semibold text-ok">
            {state.message}
          </div>
        ) : null}
        <div key={state.ok && resetOnSuccess ? `ok-${state.version}` : "stable"} className="contents">
          {children}
        </div>
        {state.ok && copyResult && state.data?.[copyResult.key] ? (
          <CopyField value={state.data[copyResult.key]!} label={copyResult.label} />
        ) : null}
        {state.ok && linkResult && state.data?.[linkResult.key] ? (
          <a href={state.data[linkResult.key]} className="btn-primary mt-3">
            {linkResult.label}
          </a>
        ) : null}
      </form>
    </FormCtx.Provider>
  );
}

function useField(name: string, defaultValue?: string | number | null) {
  const ctx = useContext(FormCtx);
  const id = useId();
  const echoed = ctx.values?.[name];
  return {
    id,
    error: ctx.fieldErrors?.[name],
    value: echoed ?? (defaultValue === null || defaultValue === undefined ? undefined : String(defaultValue)),
    // remount inputs when the server echoes values back, so defaultValue applies
    key: `${name}-${echoed !== undefined ? ctx.version : "d"}`,
  };
}

function FieldShell({ id, label, hint, error, children, required }: { id: string; label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <div>
      {label ? (
        <label htmlFor={id} className="label">
          {label}
          {required ? <span className="text-bad"> *</span> : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-sm font-semibold text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = {
  name: string;
  label?: ReactNode;
  hint?: ReactNode;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "decimal" | "numeric" | "tel" | "email";
  min?: string | number;
  max?: string | number;
  className?: string;
  prefix?: string;
};

export function Input({ name, label, hint, defaultValue, required, type = "text", className, prefix, ...rest }: InputProps) {
  const f = useField(name, defaultValue);
  const describedBy = f.error ? `${f.id}-err` : hint ? `${f.id}-hint` : undefined;
  const input = (
    <input
      key={f.key}
      id={f.id}
      name={name}
      type={type}
      defaultValue={type === "password" ? undefined : f.value}
      aria-invalid={f.error ? true : undefined}
      aria-describedby={describedBy}
      aria-required={required || undefined}
      className={`input ${prefix ? "pl-8" : ""} ${className ?? ""}`}
      {...rest}
    />
  );
  return (
    <FieldShell id={f.id} label={label} hint={hint} error={f.error} required={required}>
      {prefix ? (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center font-bold text-muted">{prefix}</span>
          {input}
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}

export function MoneyInput(props: Omit<InputProps, "type" | "inputMode" | "prefix">) {
  return <Input {...props} inputMode="decimal" prefix="$" placeholder={props.placeholder ?? "0.00"} autoComplete="off" />;
}

export function Textarea({ name, label, hint, defaultValue, required, rows = 3 }: { name: string; label?: ReactNode; hint?: ReactNode; defaultValue?: string | null; required?: boolean; rows?: number }) {
  const f = useField(name, defaultValue);
  return (
    <FieldShell id={f.id} label={label} hint={hint} error={f.error} required={required}>
      <textarea
        key={f.key}
        id={f.id}
        name={name}
        rows={rows}
        defaultValue={f.value}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.error ? `${f.id}-err` : undefined}
        className="input py-3"
      />
    </FieldShell>
  );
}

export function Select({
  name,
  label,
  hint,
  defaultValue,
  required,
  options,
  placeholder,
}: {
  name: string;
  label?: ReactNode;
  hint?: ReactNode;
  defaultValue?: string | null;
  required?: boolean;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}) {
  const f = useField(name, defaultValue);
  return (
    <FieldShell id={f.id} label={label} hint={hint} error={f.error} required={required}>
      <select
        key={f.key}
        id={f.id}
        name={name}
        defaultValue={f.value ?? ""}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.error ? `${f.id}-err` : undefined}
        className="input appearance-none bg-[right_1rem_center] bg-no-repeat pr-10"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%235b5547' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
        }}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Checkbox({ name, label, defaultChecked, hint }: { name: string; label: ReactNode; defaultChecked?: boolean; hint?: ReactNode }) {
  const ctx = useContext(FormCtx);
  const id = useId();
  const echoed = ctx.values ? ctx.values[name] === "on" : undefined;
  const error = ctx.fieldErrors?.[name];
  return (
    <div>
      <label htmlFor={id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl py-2">
        <input
          key={`${name}-${ctx.version ?? 0}`}
          id={id}
          type="checkbox"
          name={name}
          defaultChecked={echoed ?? defaultChecked}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-6 shrink-0 accent-forest"
        />
        <span>
          <span className="font-semibold">{label}</span>
          {hint ? <span className="block text-sm text-muted">{hint}</span> : null}
        </span>
      </label>
      {error ? <p className="text-sm font-semibold text-bad">{error}</p> : null}
    </div>
  );
}

export function RadioCards({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: ReactNode;
  options: ReadonlyArray<{ value: string; label: string; description?: string }>;
  defaultValue?: string;
}) {
  const ctx = useContext(FormCtx);
  const error = ctx.fieldErrors?.[name];
  const current = ctx.values?.[name] ?? defaultValue;
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="grid gap-2">
        {options.map((o) => (
          <label
            key={`${o.value}-${ctx.version ?? 0}`}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 has-[:checked]:border-forest has-[:checked]:bg-ok-bg/50 has-[:checked]:ring-2 has-[:checked]:ring-sage-light/50"
          >
            <input type="radio" name={name} value={o.value} defaultChecked={current === o.value} className="size-5 accent-forest" />
            <span>
              <span className="block font-bold">{o.label}</span>
              {o.description ? <span className="block text-sm text-muted">{o.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {error ? <p className="mt-1 text-sm font-semibold text-bad">{error}</p> : null}
    </fieldset>
  );
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

export function SubmitButton({ children, variant = "primary", className, pendingText, small }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string; pendingText?: string; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`btn-${variant} ${small ? "btn-sm" : ""} ${className ?? ""}`}>
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {pendingText ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-ok/25 bg-ok-bg p-3">
      <p className="mb-1 text-sm font-bold text-ok">{label}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input readOnly value={value} className="input font-mono text-sm" onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button
          type="button"
          className="btn-secondary btn-sm shrink-0"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* clipboard blocked — the field is selectable */
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

/** Collapsible panel for secondary admin actions (keeps profile pages calm). */
export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-xl border border-line bg-white open:shadow-sm" open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 font-bold [&::-webkit-details-marker]:hidden">
        {summary}
        <span aria-hidden className="text-muted transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}
