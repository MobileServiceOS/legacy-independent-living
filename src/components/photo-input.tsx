"use client";
import { useId, useState } from "react";
import { Icon } from "./icons";

/** Camera-friendly multi-photo picker with previews. Files are validated again on the server. */
export function PhotoInput({ max = 3, label = "Photos (optional)", hint }: { max?: number; label?: string; hint?: string }) {
  const id = useId();
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <label
        htmlFor={id}
        className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-paper px-4 py-3 font-bold text-forest hover:bg-paper-2"
      >
        <Icon name="camera" className="size-6" />
        {previews.length ? `${previews.length} photo${previews.length > 1 ? "s" : ""} added — change` : "Take or add photos"}
      </label>
      <input
        id={id}
        name="photos"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="sr-only"
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          previews.forEach((u) => URL.revokeObjectURL(u));
          if (files.length > max) {
            setError(`Please choose up to ${max} photos.`);
            e.currentTarget.value = "";
            setPreviews([]);
            return;
          }
          const tooBig = files.find((f) => f.size > 10 * 1024 * 1024);
          if (tooBig) {
            setError("Each photo must be 10 MB or smaller.");
            e.currentTarget.value = "";
            setPreviews([]);
            return;
          }
          setError(null);
          setPreviews(files.map((f) => URL.createObjectURL(f)));
        }}
      />
      <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
        {hint ?? `Up to ${max} photos. A picture helps us bring the right parts.`}
      </p>
      {error ? <p className="mt-1 text-sm font-semibold text-bad">{error}</p> : null}
      {previews.length ? (
        <ul className="mt-2 flex gap-2">
          {previews.map((src) => (
            <li key={src}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="size-20 rounded-lg border border-line object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
