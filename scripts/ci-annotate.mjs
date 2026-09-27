#!/usr/bin/env node
/**
 * CI helper: surface the tail of each failing step's log as a GitHub annotation,
 * so failures are readable from the Checks API without downloading raw logs.
 *   node scripts/ci-annotate.mjs ci-logs/*.log
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");

for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) continue;
  const lines = stripAnsi(readFileSync(file, "utf8")).split("\n");
  const tail = lines.slice(-220).join("\n").slice(-60000);
  console.log(`::error title=${basename(file)}::${escape(tail)}`);
}
