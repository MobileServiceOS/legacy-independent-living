import { Icon } from "./icons";

/** Shown wherever residents report problems: emergencies go to 911 / the office, not a form. */
export function EmergencyNote({ phone }: { phone: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-bad/25 bg-bad-bg px-4 py-3 text-[0.95rem] text-bad" role="note">
      <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
      <p>
        <strong>Emergency?</strong> For fire, gas smell, or anyone in danger, call <a href="tel:911" className="font-bold text-bad">911</a> first.
        {phone ? (
          <>
            {" "}
            For flooding or no heat/power, also call the office at{" "}
            <a href={`tel:${phone}`} className="font-bold text-bad">
              {phone}
            </a>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}
