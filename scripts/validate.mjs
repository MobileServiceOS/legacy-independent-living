#!/usr/bin/env node
/* Validate the built static site. Exits non-zero on any failure.
   Run: node scripts/validate.mjs */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAP = "4334 Camden, Fulshear, TX 77441";
const DOMAIN = "https://legacyindependentliving.net";

let errors = 0;
let checks = 0;
const ok = (m) => { checks++; console.log("  ✓", m); };
const fail = (m) => { errors++; checks++; console.log("  ✗", m); };

function htmlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === "scripts") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (e.endsWith(".html")) out.push(p);
  }
  return out;
}

const pages = htmlFiles(ROOT).sort();
console.log(`\nValidating ${pages.length} HTML pages\n`);

for (const file of pages) {
  const rel = file.replace(ROOT + "/", "");
  const html = readFileSync(file, "utf8");
  console.log(`• ${rel}`);

  // 1) JSON-LD parses, no trailing commas
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) fail("has JSON-LD");
  else {
    let allOk = true;
    for (const b of blocks) {
      try { JSON.parse(b[1]); } catch (e) { allOk = false; fail("JSON-LD parse: " + e.message); }
    }
    if (allOk) ok(`${blocks.length} JSON-LD block(s) parse`);
  }

  // 2) exactly one H1
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  h1 === 1 ? ok("exactly one <h1>") : fail(`expected 1 <h1>, found ${h1}`);

  // 3) NAP present + byte-identical (no stray variants)
  html.includes(NAP) ? ok("NAP present and exact") : fail("NAP string missing/mismatch");

  // 4) canonical + robots + title + description
  html.includes(`<link rel="canonical" href="${DOMAIN}`) ? ok("canonical -> domain") : fail("canonical missing");
  /<meta name="robots" content="index, follow/.test(html) ? ok("robots index,follow") : fail("robots meta missing");
  !/noindex/i.test(html) ? ok("no noindex") : fail("noindex found!");
  /<meta name="description" content=".{40,}?">/.test(html) ? ok("meta description present") : fail("meta description weak/missing");
  /property="og:image" content="https?:\/\//.test(html) ? ok("absolute og:image") : fail("og:image not absolute");

  // 5) internal links resolve (skip external/anchor/tel/mailto)
  const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  let broken = [];
  for (const h of hrefs) {
    if (/^(https?:|tel:|mailto:|#|data:)/.test(h)) continue;
    const clean = h.split("#")[0].split("?")[0];
    if (!clean) continue;
    let target = resolve(dirname(file), clean);
    if (clean.endsWith("/")) target = join(target, "index.html");
    if (!existsSync(target)) broken.push(h);
  }
  broken.length === 0 ? ok(`${hrefs.length} links/assets resolve`) : fail("broken: " + broken.join(", "));

  // 6) in-page anchor targets exist (for #id links that point to this page)
  const localAnchors = hrefs.filter((h) => h.startsWith("#") && h.length > 1).map((h) => h.slice(1));
  let missingAnchor = localAnchors.filter((id) => !new RegExp(`id="${id}"`).test(html));
  missingAnchor.length === 0 ? ok("in-page anchors valid") : fail("missing anchors: " + missingAnchor.join(", "));

  // 7) balanced critical tags
  const open = (re) => (html.match(re) || []).length;
  open(/<main[\s>]/g) === open(/<\/main>/g) ? ok("<main> balanced") : fail("<main> unbalanced");
  open(/<section[\s>]/g) === open(/<\/section>/g) ? ok("<section> balanced") : fail("<section> unbalanced");
}

// 8) sitemap covers every page; robots references it
console.log("• sitemap.xml / robots.txt");
const sitemap = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
const robots = readFileSync(join(ROOT, "robots.txt"), "utf8");
const expectedUrls = pages.map((f) => {
  let p = "/" + f.replace(ROOT + "/", "").replace(/index\.html$/, "");
  return DOMAIN + p;
});
let missingSitemap = expectedUrls.filter((u) => !sitemap.includes(`<loc>${u}</loc>`));
missingSitemap.length === 0 ? ok(`sitemap lists all ${expectedUrls.length} pages`) : fail("sitemap missing: " + missingSitemap.join(", "));
robots.includes(`Sitemap: ${DOMAIN}/sitemap.xml`) ? ok("robots references sitemap") : fail("robots missing Sitemap line");
robots.includes("Allow: /") ? ok("robots allows crawl") : fail("robots missing Allow");

// 9) required files
for (const f of [".nojekyll", "assets/css/styles.css", "assets/js/main.js", "assets/img/logo.png", "assets/img/favicon.png", "assets/img/og-image.png", "assets/img/logo.svg", "assets/img/logo-mark.svg"]) {
  existsSync(join(ROOT, f)) ? ok(`exists: ${f}`) : fail(`MISSING: ${f}`);
}

// 10) FAQ visible Q count == FAQPage schema Question count (home)
const home = readFileSync(join(ROOT, "index.html"), "utf8");
const visibleQ = (home.match(/class="faq__q"/g) || []).length;
const schemaQ = (home.match(/"@type": "Question"/g) || []).length;
visibleQ === schemaQ && visibleQ > 0 ? ok(`FAQ mirrored 1:1 (${visibleQ})`) : fail(`FAQ mismatch: visible ${visibleQ} vs schema ${schemaQ}`);

console.log(`\n${errors === 0 ? "✅ PASS" : "❌ FAIL"} — ${checks - errors}/${checks} checks passed, ${errors} error(s).\n`);
process.exit(errors ? 1 : 0);
