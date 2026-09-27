#!/usr/bin/env node
/**
 * CI helper: surface the tail of each failing step's log as a GitHub annotation,
 * so failures are readable from the Checks API without downloading raw logs.
 *   node scripts/ci-annotate.mjs ci-logs/*.log
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");

for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) continue;
  const lines = stripAnsi(readFileSync(file, "utf8")).split("\n");
  // The Checks API keeps ~4 KB per annotation, so send the tail (where test
  // reporters print their failure summary) in 3.9 KB chunks, last chunk first.
  // Playwright: first annotation = every failure header + its first error lines.
  const summary = [];
  lines.forEach((l, i) => {
    if (/^\s+\d+\) \[/.test(l)) summary.push(...lines.slice(i, i + 8).filter((x) => x.trim() && !/^\s+(at |attachment|─)/.test(x)), "");
  });
  if (summary.length) console.log(`::error title=${basename(file)} [failures]::${escape(summary.join("\n").slice(0, 3900))}`);
  const text = lines.join("\n");
  const chunks = [];
  for (let end = text.length; end > 0 && chunks.length < 2; end -= 3900) chunks.push(text.slice(Math.max(0, end - 3900), end));
  chunks.forEach((c, i) => console.log(`::error title=${basename(file)} [${i + 1}/${chunks.length} from end]::${escape(c)}`));
  continue;
}
