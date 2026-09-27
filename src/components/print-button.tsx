"use client";
import { Icon } from "./icons";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary no-print">
      <Icon name="printer" /> Print / save PDF
    </button>
  );
}
