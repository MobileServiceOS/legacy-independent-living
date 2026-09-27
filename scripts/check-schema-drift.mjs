#!/usr/bin/env node
/**
 * Verifies prisma/schema.prisma and the live database (after migrations) agree:
 * every model → table, every scalar field → column with matching nullability
 * and type, every enum → identical labels. Uses `psql` (no npm deps) so it can
 * run anywhere Postgres client tools exist.
 *
 *   DATABASE_URL=postgres://... node scripts/check-schema-drift.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const psql = (sql) =>
  execFileSync("psql", [url.replace(/\?.*$/, ""), "-tAF", "\t", "-c", sql], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"));

const enums = {};
for (const m of schema.matchAll(/^enum (\w+) \{\n([\s\S]*?)\n\}/gm)) {
  enums[m[1]] = m[2].split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("//"));
}

const SCALAR_TO_PG = { String: "text", Int: "int4", Boolean: "bool", DateTime: "timestamp", Json: "jsonb" };
const models = [];
for (const m of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)\n\}/gm)) {
  const body = m[2];
  const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? m[1];
  const fields = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
    if (!fm) continue;
    const [, name, type, list, optional, attrs] = fm;
    if (list || attrs.includes("@relation")) continue;
    const isEnum = type in enums;
    if (!isEnum && !(type in SCALAR_TO_PG)) continue; // relation field
    const column = /@map\("([^"]+)"\)/.exec(attrs)?.[1] ?? name;
    let pg = isEnum ? type : SCALAR_TO_PG[type];
    if (attrs.includes("@db.Date")) pg = "date";
    fields.push({ name, column, pg, nullable: Boolean(optional) });
  }
  models.push({ model: m[1], table, fields });
}

const errors = [];
const cols = psql(
  `select table_name, column_name, udt_name, is_nullable from information_schema.columns where table_schema='public'`,
);
const byTable = new Map();
for (const [t, c, udt, n] of cols) {
  if (!byTable.has(t)) byTable.set(t, new Map());
  byTable.get(t).set(c, { udt, nullable: n === "YES" });
}

for (const { model, table, fields } of models) {
  const dbCols = byTable.get(table);
  if (!dbCols) {
    errors.push(`model ${model}: table "${table}" missing`);
    continue;
  }
  const seen = new Set();
  for (const f of fields) {
    seen.add(f.column);
    const c = dbCols.get(f.column);
    if (!c) {
      errors.push(`${table}.${f.column} (${model}.${f.name}) missing in DB`);
      continue;
    }
    if (c.udt !== f.pg) errors.push(`${table}.${f.column}: schema ${f.pg} vs db ${c.udt}`);
    if (c.nullable !== f.nullable) errors.push(`${table}.${f.column}: nullability schema=${f.nullable} db=${c.nullable}`);
  }
  for (const col of dbCols.keys()) if (!seen.has(col)) errors.push(`${table}.${col} exists in DB but not in schema`);
}

const dbTables = new Set(byTable.keys());
for (const t of dbTables) if (t !== "_prisma_migrations" && !models.some((m) => m.table === t)) errors.push(`table ${t} not in schema`);

const dbEnums = psql(
  `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid group by t.typname`,
);
const dbEnumMap = new Map(dbEnums.map(([n, v]) => [n, v]));
for (const [name, values] of Object.entries(enums)) {
  if (dbEnumMap.get(name) !== values.join(",")) errors.push(`enum ${name}: schema [${values}] vs db [${dbEnumMap.get(name) ?? "missing"}]`);
}

if (errors.length) {
  console.error(`✖ Schema drift (${errors.length}):\n  ` + errors.join("\n  "));
  process.exit(1);
}
console.log(`✔ schema.prisma matches database: ${models.length} tables, ${Object.keys(enums).length} enums, ${models.reduce((s, m) => s + m.fields.length, 0)} columns`);
