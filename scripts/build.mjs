#!/usr/bin/env node
/* =========================================================================
   Legacy Independent Living — static site generator (single source of truth)
   No serve-time build step: this emits plain static HTML committed to the repo.
   Run:  node scripts/build.mjs
   ========================================================================= */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ *
 * BUSINESS FACTS  — edit here; everything else derives from this block.
 * NAP string is byte-identical across schema, contact, and footer.
 * ------------------------------------------------------------------ */
const BIZ = {
  name: "Legacy Independent Living",
  tagline: "Live well. Live independently. Live legacy.",
  domain: "https://legacyindependentliving.net", // <-- swap if final domain differs
  phoneDisplay: "(832) 317-1933",
  phoneTel: "+18323171933",
  email: "service@legacyindependentliving.net", // <-- swap to the real inbox
  // --- NAP (Name/Address/Phone) — keep these exact ---
  street: "4334 Camden",
  city: "Fulshear",
  region: "TX",
  postal: "77441",
  country: "US",
  county: "Fort Bend County",
  geoLat: 29.7016, // <-- verify against the real Google Business Profile pin
  geoLng: -95.8949,
  priceRange: "$$",
  areasServed: ["Fulshear", "Katy", "Richmond", "Fort Bend County"],
};
// One canonical NAP address string used verbatim everywhere:
const NAP = `${BIZ.street}, ${BIZ.city}, ${BIZ.region} ${BIZ.postal}`;
const NAP_FULL = `${NAP} — ${BIZ.county}`;
const MAPS_QUERY = encodeURIComponent(`${BIZ.name}, ${NAP}`);
const MAPS_EMBED = `https://www.google.com/maps?q=${MAPS_QUERY}&output=embed`;
const MAPS_DIR = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(NAP)}`;
const OG_IMAGE = `${BIZ.domain}/assets/img/og-image.png`;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// depth: 0 = repo root page, 1 = page in a sub-directory.
const pfx = (depth) => (depth === 0 ? "" : "../");
const homeHref = (depth) => (depth === 0 ? "./" : "../");

/* ------------------------------------------------------------------ *
 * Shared SVG bits
 * ------------------------------------------------------------------ */
const branchDivider = `
<div class="branch-divider" aria-hidden="true">
  <svg viewBox="0 0 1200 60" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,40 C300,5 500,5 600,30 C700,55 900,55 1200,20" fill="none" stroke="currentColor" stroke-width="2"/>
    <g fill="currentColor" opacity="0.85">
      <path d="M590,28 q-10,-12 -22,-9 q6,12 22,9 Z"/>
      <path d="M610,32 q10,-12 22,-9 q-6,12 -22,9 Z"/>
    </g>
  </svg>
</div>`;

const icon = (p) =>
  `<svg class="card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

const ICONS = {
  home: icon('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 21v-6h6v6"/>'),
  shield: icon('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  leaf: icon('<path d="M5 21c0-9 7-16 16-16 0 9-7 16-16 16z"/><path d="M5 21C9 17 13 13 17 9"/>'),
  people: icon('<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M21 20a6 6 0 0 0-5-5.9"/>'),
  path: icon('<path d="M6 21c0-4 2-6 6-6s6-2 6-6"/><circle cx="6" cy="21" r="0.6"/><path d="M18 3l1.5 3L21 4.5"/>'),
  key: icon('<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9"/><path d="M17 5l3 3"/>'),
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
};

/* ------------------------------------------------------------------ *
 * JSON-LD graph  (built as objects -> JSON.stringify => always valid)
 * ------------------------------------------------------------------ */
const ID = {
  org: `${BIZ.domain}/#organization`,
  website: `${BIZ.domain}/#website`,
  biz: `${BIZ.domain}/#localbusiness`,
};

const postalAddress = {
  "@type": "PostalAddress",
  streetAddress: BIZ.street,
  addressLocality: BIZ.city,
  addressRegion: BIZ.region,
  postalCode: BIZ.postal,
  addressCountry: BIZ.country,
};

const localBusinessNode = {
  "@type": ["LocalBusiness", "LodgingBusiness"],
  "@id": ID.biz,
  name: BIZ.name,
  alternateName: "Legacy Independent Living Transitional Housing",
  url: BIZ.domain + "/",
  image: OG_IMAGE,
  logo: `${BIZ.domain}/assets/img/logo.png`,
  telephone: BIZ.phoneTel,
  email: BIZ.email,
  priceRange: BIZ.priceRange,
  description:
    "Structured, supportive transitional and reentry housing in Fulshear, Texas for adults rebuilding their lives and living independently with accountability.",
  address: postalAddress,
  geo: { "@type": "GeoCoordinates", latitude: BIZ.geoLat, longitude: BIZ.geoLng },
  hasMap: `https://www.google.com/maps?q=${MAPS_QUERY}`,
  areaServed: BIZ.areasServed.map((a) => ({ "@type": "Place", name: `${a}, TX` })),
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      opens: "00:00",
      closes: "23:59",
    },
  ],
  parentOrganization: { "@id": ID.org },
};

const orgNode = {
  "@type": "Organization",
  "@id": ID.org,
  name: BIZ.name,
  url: BIZ.domain + "/",
  logo: `${BIZ.domain}/assets/img/logo.png`,
  image: OG_IMAGE,
  email: BIZ.email,
  telephone: BIZ.phoneTel,
  address: postalAddress,
  slogan: BIZ.tagline,
};

const websiteNode = {
  "@type": "WebSite",
  "@id": ID.website,
  url: BIZ.domain + "/",
  name: BIZ.name,
  publisher: { "@id": ID.org },
  inLanguage: "en-US",
};

const faqPageNode = (faqs) => ({
  "@type": "FAQPage",
  "@id": `${BIZ.domain}/#faq`,
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
});

const breadcrumbNode = (crumbs) => ({
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.name,
    item: BIZ.domain + c.path,
  })),
});

function jsonLd(nodes) {
  const graph = { "@context": "https://schema.org", "@graph": nodes };
  return `<script type="application/ld+json">\n${JSON.stringify(graph, null, 2)}\n</script>`;
}

/* ------------------------------------------------------------------ *
 * FAQ content — visible accordion is mirrored 1:1 by FAQPage schema.
 * ------------------------------------------------------------------ */
const FAQS = [
  {
    q: "What is Legacy Independent Living?",
    a: `Legacy Independent Living is a structured, supportive transitional housing residence in ${BIZ.city}, Texas. We provide a stable, accountable, drug- and alcohol-free home for adults who are rebuilding their lives and ready to live independently — including people returning to the community after incarceration, completing a treatment program, or simply needing a steady place to get back on their feet.`,
  },
  {
    q: "Where is Legacy Independent Living located?",
    a: `We are located at ${NAP}, in ${BIZ.county}. We serve ${BIZ.city}, Katy, Richmond, and the surrounding Fort Bend County area.`,
  },
  {
    q: "Who is the home for?",
    a: "Our home is for adults (18+) who are committed to accountability, sobriety, and steady progress toward independence — people in reentry after incarceration, those leaving treatment or recovery programs, and anyone who needs a stable transitional place to live while they rebuild.",
  },
  {
    q: "How do I apply or schedule a visit?",
    a: `Call or text us at ${BIZ.phoneDisplay}, or fill out the inquiry form on our website. We will talk with you about your situation, answer your questions, and arrange a time to visit the home and review the house guidelines together.`,
  },
  {
    q: "What support do residents receive?",
    a: "Residents live in a structured environment with clear house guidelines, peer accountability, and a calm, respectful community. We help connect residents with employment, recovery support, identification and benefits, transportation, and other community resources that help them succeed.",
  },
  {
    q: "What areas do you serve?",
    a: `We welcome residents from ${BIZ.city}, Katy, Richmond, and throughout ${BIZ.county}, as well as the greater Houston area. Our home is conveniently located for work, recovery meetings, and family connections across Fort Bend County.`,
  },
  {
    q: "How much does it cost?",
    a: "We keep program fees affordable and transparent. Costs depend on your length of stay and needs. Please contact us for current rates and to discuss what works for your situation.",
  },
];

/* ------------------------------------------------------------------ *
 * Shared layout: head, header, footer
 * ------------------------------------------------------------------ */
function head(page) {
  const p = pfx(page.depth);
  const canonical = BIZ.domain + page.path;
  const ogType = page.ogType || "website";
  const robots = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${canonical}">

<!-- Geo targeting -->
<meta name="geo.region" content="US-TX">
<meta name="geo.placename" content="${esc(BIZ.city)}, Texas">
<meta name="geo.position" content="${BIZ.geoLat};${BIZ.geoLng}">
<meta name="ICBM" content="${BIZ.geoLat}, ${BIZ.geoLng}">

<!-- Open Graph -->
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(BIZ.name)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_US">
${
  ogType === "business.business"
    ? `<meta property="business:contact_data:street_address" content="${esc(BIZ.street)}">
<meta property="business:contact_data:locality" content="${esc(BIZ.city)}">
<meta property="business:contact_data:region" content="${esc(BIZ.region)}">
<meta property="business:contact_data:postal_code" content="${esc(BIZ.postal)}">
<meta property="business:contact_data:country_name" content="United States">
<meta property="business:contact_data:phone_number" content="${esc(BIZ.phoneDisplay)}">
<meta property="business:contact_data:email" content="${esc(BIZ.email)}">`
    : ""
}

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${OG_IMAGE}">

<link rel="icon" type="image/png" sizes="64x64" href="${p}assets/img/favicon.png">
<link rel="icon" type="image/png" sizes="256x256" href="${p}assets/img/logo-mark.png">
<link rel="apple-touch-icon" href="${p}assets/img/logo-mark.png">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Mulish:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${p}assets/css/styles.css">

${jsonLd(page.schema)}
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
${header(page)}
<main id="main">`;
}

function header(page) {
  const p = pfx(page.depth);
  const h = homeHref(page.depth);
  const nav = [
    { label: "Home", href: h },
    { label: "About", href: `${h}#welcome` },
    { label: "Our Home", href: `${p}our-home/` },
    { label: "How to Apply", href: `${p}how-to-apply/` },
    { label: "FAQ", href: `${p}faq/` },
    { label: "Contact", href: `${p}contact/` },
  ];
  return `<header class="site-header">
  <div class="container site-header__inner">
    <a class="brand" href="${h}" aria-label="${esc(BIZ.name)} — home">
      <img class="brand__mark" src="${p}assets/img/logo-mark.png" width="44" height="44" alt="" aria-hidden="true">
      <span class="brand__name">Legacy<small>Independent Living</small></span>
    </a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="primary-nav" aria-label="Toggle menu"><span></span></button>
    <nav class="nav" id="primary-nav" aria-label="Primary">
      <ul class="nav__list">
        ${nav.map((n) => `<li><a href="${n.href}">${n.label}</a></li>`).join("\n        ")}
        <li class="btn-cta-wrap"><a class="btn btn--primary" href="${p}contact/#inquire">Inquire</a></li>
      </ul>
    </nav>
  </div>
</header>`;
}

function footer(page) {
  const p = pfx(page.depth);
  const h = homeHref(page.depth);
  const year = 2026;
  return `</main>
<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <div class="footer-brand">
          <img src="${p}assets/img/logo-mark.png" width="48" height="48" alt="${esc(BIZ.name)} logo">
          <span style="font-family:var(--serif);font-size:1.35rem;color:#fff;">${esc(BIZ.name)}</span>
        </div>
        <p style="max-width:36ch;color:#c9ccb6;">${esc(BIZ.tagline)} Supportive transitional &amp; reentry housing in ${esc(BIZ.city)}, ${esc(BIZ.county)}.</p>
        <p><a href="${MAPS_DIR}" target="_blank" rel="noopener">Get directions &rarr;</a></p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul class="footer-nav">
          <li><a href="${h}">Home</a></li>
          <li><a href="${p}our-home/">Our Home</a></li>
          <li><a href="${p}how-to-apply/">How to Apply</a></li>
          <li><a href="${p}faq/">FAQ</a></li>
          <li><a href="${p}contact/">Contact</a></li>
        </ul>
      </div>
      <div>
        <h4>Areas We Serve</h4>
        <ul class="footer-nav">
          <li><a href="${p}independent-living-fulshear/">Independent Living in Fulshear</a></li>
          <li><a href="${p}independent-living-katy/">Independent Living in Katy</a></li>
          <li><a href="${p}independent-living-richmond/">Independent Living in Richmond</a></li>
        </ul>
        <h4 style="margin-top:1.2rem;">Contact</h4>
        <address style="font-style:normal;line-height:1.7;color:#d9dcc8;">
          ${esc(NAP)}<br>
          <a href="tel:${BIZ.phoneTel}">${esc(BIZ.phoneDisplay)}</a><br>
          <a href="mailto:${BIZ.email}">${esc(BIZ.email)}</a>
        </address>
      </div>
    </div>
    <div class="footer-bottom">
      <span>&copy; ${year} ${esc(BIZ.name)}. All rights reserved.</span>
      <span>${esc(NAP_FULL)}</span>
    </div>
  </div>
</footer>
<script src="${p}assets/js/main.js" defer></script>
</body>
</html>`;
}

/* FAQ accordion markup (shared by home + /faq/) */
function faqAccordion(faqs) {
  return `<div class="faq">
    ${faqs
      .map(
        (f, i) => `<div class="faq__item">
      <h3 style="margin:0;">
        <button class="faq__q" id="faq-q-${i}" aria-expanded="false" aria-controls="faq-a-${i}">${esc(f.q)}</button>
      </h3>
      <div class="faq__a" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}">
        <div><p>${esc(f.a)}</p></div>
      </div>
    </div>`
      )
      .join("\n    ")}
  </div>`;
}

/* Reusable "Our Home" map + address block */
function ourHomeBlock(depth) {
  const p = pfx(depth);
  return `<div class="home-grid">
    <div>
      <p class="eyebrow">Our Home</p>
      <h2>A calm, welcoming place in ${esc(BIZ.city)}</h2>
      <p class="lede">Our residence sits in a quiet ${esc(BIZ.city)} neighborhood in ${esc(BIZ.county)} — close to work, recovery meetings, transit, and the everyday rhythms of normal life. It is a real home: comfortable, clean, and built for steady, dignified living.</p>
      <p>We keep the home well cared for and the community respectful, so every resident has the stability they need to focus on what comes next.</p>
      <div class="linkrow">
        <a class="chip" href="${p}our-home/">Tour our home</a>
        <a class="chip" href="${MAPS_DIR}" target="_blank" rel="noopener">${ICONS.pin} Get directions</a>
      </div>
    </div>
    <div>
      <div class="addr-card">
        <h3>Visit Us</h3>
        <address>
          <div class="row">${ICONS.pin}<span>${esc(NAP)}<br><small style="color:var(--brown-soft)">${esc(BIZ.county)}, Texas</small></span></div>
          <div class="row">${ICONS.phone}<a href="tel:${BIZ.phoneTel}">${esc(BIZ.phoneDisplay)}</a></div>
          <div class="row">${ICONS.mail}<a href="mailto:${BIZ.email}">${esc(BIZ.email)}</a></div>
        </address>
      </div>
      <iframe class="map-frame" style="margin-top:1rem;" src="${MAPS_EMBED}" title="Map to ${esc(BIZ.name)} at ${esc(NAP)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
    </div>
  </div>`;
}

/* Inquiry form (shared by home + /contact/) */
function inquiryForm() {
  return `<form class="form" id="inquiry-form" data-email="${BIZ.email}" novalidate>
    <div class="field">
      <label for="f-name">Your name</label>
      <input id="f-name" name="name" type="text" autocomplete="name" required>
    </div>
    <div class="field">
      <label for="f-phone">Phone</label>
      <input id="f-phone" name="phone" type="tel" autocomplete="tel" required>
    </div>
    <div class="field">
      <label for="f-email">Email</label>
      <input id="f-email" name="email" type="email" autocomplete="email" required>
    </div>
    <div class="field">
      <label for="f-reason">Reason for inquiry</label>
      <select id="f-reason" name="reason">
        <option>Looking for housing for myself</option>
        <option>Inquiring for a family member or friend</option>
        <option>Referral from a program or case manager</option>
        <option>Schedule a visit / tour</option>
        <option>General question</option>
      </select>
    </div>
    <div class="field">
      <label for="f-message">How can we help?</label>
      <textarea id="f-message" name="message" placeholder="Tell us a little about your situation and what you're looking for."></textarea>
    </div>
    <button class="btn btn--primary" type="submit">Send inquiry</button>
    <p class="form__note">This opens your email app with the details filled in — no account needed. Prefer to talk? Call us at <a href="tel:${BIZ.phoneTel}">${esc(BIZ.phoneDisplay)}</a>.</p>
    <p id="form-status" role="status" aria-live="polite" class="form__note"></p>
  </form>`;
}

/* ------------------------------------------------------------------ *
 * PAGES
 * ------------------------------------------------------------------ */
const pages = [];

/* ---------- HOME ---------- */
const featureCards = [
  { i: ICONS.home, t: "A Stable Place to Live", d: "A comfortable, furnished home where you can settle in, rest, and build a steady daily routine without worrying about where you'll sleep tonight." },
  { i: ICONS.shield, t: "Structure &amp; Accountability", d: "Clear house guidelines and gentle structure that help you stay on track, keep commitments, and rebuild trust — with yourself and others." },
  { i: ICONS.leaf, t: "Substance-Free Environment", d: "A drug- and alcohol-free home that protects your progress and gives everyone the calm, safe footing they need to move forward." },
  { i: ICONS.people, t: "A Supportive Community", d: "Live alongside others who understand the journey. Peer encouragement and accountability make the hard days easier and the wins shared." },
  { i: ICONS.path, t: "Pathways Forward", d: "We help connect you to employment, recovery support, ID and benefits, transportation, and the local resources that turn a fresh start into lasting independence." },
  { i: ICONS.key, t: "Independence With Support", d: "Run your own life, manage your own goals, and grow at your own pace — with help close by whenever you need it." },
];

const values = [
  { t: "Dignity", d: "Everyone deserves to be treated with respect. We meet residents where they are, without judgment." },
  { t: "Accountability", d: "Real change grows from honest structure. We keep clear expectations that help people succeed." },
  { t: "Community", d: "No one rebuilds alone. We foster a home where neighbors support and lift one another up." },
  { t: "Stability", d: "A safe, steady home is the foundation for everything else — work, recovery, and family." },
];

const whoFor = [
  "Adults returning to the community after incarceration (reentry)",
  "People completing a treatment or recovery program",
  "Anyone needing a stable, sober transitional home",
  "Individuals working or actively seeking employment",
  "Those ready to follow house guidelines and live respectfully",
  "People rebuilding independence at their own pace",
  "Residents who value peer support and accountability",
  "Anyone in the Fulshear &amp; Fort Bend County area seeking a fresh start",
];

pages.push({
  file: "index.html",
  depth: 0,
  path: "/",
  ogType: "business.business",
  title: "Legacy Independent Living | Transitional & Reentry Housing in Fulshear, TX",
  description:
    "Structured, supportive transitional & reentry housing in Fulshear, TX (Fort Bend County). A stable, sober home for adults rebuilding their lives. Serving Fulshear, Katy & Richmond. Call (832) 317-1933.",
  schema: [orgNode, websiteNode, localBusinessNode, faqPageNode(FAQS)],
  body: `
  <section class="hero">
    <div class="container">
      <div class="hero--center">
        <img class="hero__logo" src="assets/img/logo.png" width="1100" height="1100" alt="Legacy Independent Living — a family walking home beneath a tree. Live well. Live independently. Live legacy.">
        <p class="visually-hidden">${esc(BIZ.tagline)}</p>
        <h1>Supportive Transitional Housing in ${esc(BIZ.city)}, Texas</h1>
        <p class="lede">Legacy Independent Living is a stable, sober, and dignified home for adults rebuilding their lives — in reentry, after treatment, or simply ready for a fresh start. You bring the determination; we provide the structure, support, and community to help it last.</p>
        <div class="hero__cta">
          <a class="btn btn--primary" href="#contact">Inquire about a room</a>
          <a class="btn btn--ghost" href="tel:${BIZ.phoneTel}">Call ${esc(BIZ.phoneDisplay)}</a>
        </div>
        <p class="hero__addr">${ICONS.pin}&nbsp;${esc(NAP)} &middot; ${esc(BIZ.county)}</p>
      </div>
    </div>
  </section>
  ${branchDivider}

  <section class="section" id="welcome">
    <div class="container center">
      <p class="eyebrow">Welcome</p>
      <h2>A fresh start, with a foundation under it</h2>
      <p class="lede measure">Leaving incarceration, finishing treatment, or starting over is hard enough without wondering where you'll live. Legacy Independent Living gives you a safe, accountable place to land in ${esc(BIZ.city)} — so you can focus on work, recovery, and family instead of survival. This is more than a place to stay. It's where you rebuild a legacy you're proud of.</p>
    </div>
  </section>

  <section class="section" id="living-here" style="background:var(--paper-2);">
    <div class="container">
      <div class="center"><p class="eyebrow">Living Here</p><h2>What life at Legacy looks like</h2></div>
      <div class="grid grid--3" style="margin-top:2rem;">
        ${featureCards.map((c) => `<article class="card">${c.i}<h3>${c.t}</h3><p>${c.d}</p></article>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="section band-dark" id="why-legacy">
    <div class="container">
      <div class="center"><p class="eyebrow">Why Legacy</p><h2>Values that guide our home</h2></div>
      <div class="values" style="margin-top:2.2rem;">
        ${values.map((v, i) => `<div class="value"><div class="value__num">0${i + 1}</div><h3>${v.t}</h3><p>${v.d}</p></div>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="section" id="our-home">
    <div class="container">${ourHomeBlock(0)}</div>
  </section>

  <section class="section" id="who-its-for" style="background:var(--paper-2);">
    <div class="container">
      <div class="center"><p class="eyebrow">Who It's For</p><h2>Is Legacy right for you?</h2>
        <p class="lede measure">Our home is for adults who are ready to live with accountability and move forward. You may be a good fit if you are:</p>
      </div>
      <ul class="checklist" style="margin-top:1.6rem;max-width:880px;margin-inline:auto;">
        ${whoFor.map((w) => `<li>${w}</li>`).join("\n        ")}
      </ul>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="container">
      <div class="center"><p class="eyebrow">Questions &amp; Answers</p><h2>Frequently asked questions</h2></div>
      <div style="margin-top:2rem;">${faqAccordion(FAQS)}</div>
      <p class="center" style="margin-top:1.5rem;"><a class="chip" href="faq/">See all questions &amp; answers &rarr;</a></p>
    </div>
  </section>

  <section class="section band-dark" id="contact">
    <div class="container">
      <div class="contact-grid">
        <div>
          <p class="eyebrow">Contact</p>
          <h2>Let's talk about your next step</h2>
          <p style="color:#dde0cf;">Call, email, or send a message. We'll listen, answer your questions, and help you understand whether Legacy is the right fit.</p>
          <ul class="contact-list" style="margin-top:1.4rem;color:#eef0e3;">
            <li>${ICONS.pin}<span>${esc(NAP)}<br><span style="color:#bcc0a8;">${esc(BIZ.county)}, Texas</span></span></li>
            <li>${ICONS.phone}<a href="tel:${BIZ.phoneTel}" style="color:#fff;">${esc(BIZ.phoneDisplay)}</a></li>
            <li>${ICONS.mail}<a href="mailto:${BIZ.email}" style="color:#fff;">${esc(BIZ.email)}</a></li>
          </ul>
        </div>
        <div id="inquire">${inquiryForm()}</div>
      </div>
    </div>
  </section>`,
});

/* ---------- GEO LANDING PAGES ---------- */
const geoPages = [
  {
    slug: "independent-living-fulshear",
    cityName: "Fulshear",
    primary: true,
    title: "Independent Living in Fulshear, TX | Legacy Transitional Housing",
    description:
      "Supportive independent & transitional living in Fulshear, TX. A stable, sober home for adults in reentry or recovery. Located at 4334 Camden, Fulshear. Call (832) 317-1933.",
    intro:
      "Legacy Independent Living is right here in Fulshear, Texas — a structured, supportive home for adults rebuilding their lives. Whether you're returning from incarceration, leaving a treatment program, or simply need a stable and sober place to start over, our Fulshear residence gives you the foundation to move forward with dignity.",
    local:
      "Set in a quiet Fulshear neighborhood in Fort Bend County, our home keeps you close to work opportunities, recovery meetings, transit, and family across the western Houston area. Fulshear's calm, community-minded setting is an ideal place to focus on your next chapter.",
  },
  {
    slug: "independent-living-katy",
    cityName: "Katy",
    title: "Independent Living near Katy, TX | Legacy Transitional Housing",
    description:
      "Supportive transitional & reentry housing serving Katy, TX. A stable, sober independent-living home minutes from Katy in Fulshear (Fort Bend County). Call (832) 317-1933.",
    intro:
      "Serving the Katy, Texas area, Legacy Independent Living offers a stable, supportive home for adults ready to rebuild. Our residence is just a short drive from Katy in neighboring Fulshear — close enough to keep your job, your meetings, and your family connections while you establish a steady, independent routine.",
    local:
      "Katy residents choose Legacy for its calm setting, clear structure, and genuine community. From our Fulshear home you stay connected to Katy's employers, recovery resources, and the wider Fort Bend and west-Houston area — without the noise and instability that can derail a fresh start.",
  },
  {
    slug: "independent-living-richmond",
    cityName: "Richmond",
    title: "Independent Living near Richmond, TX | Legacy Transitional Housing",
    description:
      "Supportive transitional & reentry housing serving Richmond, TX. A sober, structured independent-living home in nearby Fulshear (Fort Bend County). Call (832) 317-1933.",
    intro:
      "Legacy Independent Living proudly serves the Richmond, Texas community with structured, supportive transitional housing nearby in Fulshear. For adults in reentry or recovery around Richmond, our home offers the stability, accountability, and encouragement that make independence last.",
    local:
      "Just minutes from Richmond in Fort Bend County, our Fulshear residence keeps you connected to local jobs, courts and case managers, recovery meetings, and family. It's a quiet, dignified place to regain your footing and build the life you want.",
  },
];

for (const g of geoPages) {
  const others = geoPages.filter((x) => x.slug !== g.slug);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: `Independent Living in ${g.cityName}`, path: `/${g.slug}/` },
  ];
  const geoBiz = {
    ...localBusinessNode,
    "@id": `${BIZ.domain}/${g.slug}/#localbusiness`,
    areaServed: [{ "@type": "City", name: `${g.cityName}, TX` }, ...BIZ.areasServed.map((a) => ({ "@type": "Place", name: `${a}, TX` }))],
  };
  pages.push({
    file: `${g.slug}/index.html`,
    depth: 1,
    path: `/${g.slug}/`,
    title: g.title,
    description: g.description,
    schema: [orgNode, websiteNode, geoBiz, breadcrumbNode(crumbs)],
    body: `
  <nav class="container breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li><a href="../">Home</a></li>
      <li>Independent Living in ${esc(g.cityName)}</li>
    </ol>
  </nav>
  <section class="section section--tight">
    <div class="container">
      <p class="eyebrow">Serving ${esc(g.cityName)}, Texas</p>
      <h1>Independent &amp; Transitional Living in ${esc(g.cityName)}, TX</h1>
      <p class="lede">${g.intro}</p>
      <div class="hero__cta" style="margin:1.4rem 0;">
        <a class="btn btn--primary" href="../contact/#inquire">Inquire about a room</a>
        <a class="btn btn--ghost" href="tel:${BIZ.phoneTel}">Call ${esc(BIZ.phoneDisplay)}</a>
      </div>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">
      <h2>A supportive home near ${esc(g.cityName)}</h2>
      <p class="measure">${g.local}</p>
      <p class="measure">At Legacy you'll find a substance-free environment, clear house guidelines, peer accountability, and help connecting to employment, recovery, and community resources — everything you need to turn a fresh start into lasting independence. ${esc(BIZ.tagline)}</p>
    </div>
  </section>
  <section class="section" style="background:var(--paper-2);">
    <div class="container">
      <div class="center"><p class="eyebrow">What We Offer ${esc(g.cityName)} Residents</p><h2>Stability, structure, and support</h2></div>
      <div class="grid grid--3" style="margin-top:2rem;">
        ${featureCards.slice(0, 6).map((c) => `<article class="card">${c.i}<h3>${c.t}</h3><p>${c.d}</p></article>`).join("\n        ")}
      </div>
    </div>
  </section>
  <section class="section">
    <div class="container">${ourHomeBlock(1)}</div>
  </section>
  <section class="section band-dark">
    <div class="container center">
      <h2>Ready to take the next step?</h2>
      <p style="color:#dde0cf;max-width:60ch;margin-inline:auto;">Reach out today and we'll help you understand whether Legacy is the right fit for your move forward in the ${esc(g.cityName)} area.</p>
      <div class="hero__cta" style="justify-content:center;margin-top:1.4rem;">
        <a class="btn btn--light" href="../contact/#inquire">Send an inquiry</a>
        <a class="btn btn--on-dark" href="tel:${BIZ.phoneTel}">Call ${esc(BIZ.phoneDisplay)}</a>
      </div>
    </div>
  </section>
  <section class="section section--tight">
    <div class="container center">
      <p class="eyebrow">Nearby Areas We Serve</p>
      <div class="linkrow" style="justify-content:center;">
        <a class="chip" href="../">${ICONS.pin} Home base in Fulshear</a>
        ${others.map((o) => `<a class="chip" href="../${o.slug}/">Independent Living in ${esc(o.cityName)}</a>`).join("\n        ")}
        <a class="chip" href="../how-to-apply/">How to Apply</a>
      </div>
    </div>
  </section>`,
  });
}

/* ---------- OUR HOME ---------- */
pages.push({
  file: "our-home/index.html",
  depth: 1,
  path: "/our-home/",
  title: "Our Home | Legacy Independent Living in Fulshear, TX",
  description:
    "Tour Legacy Independent Living — a calm, clean, sober transitional home at 4334 Camden, Fulshear, TX. See the setting, the structure, and how to visit.",
  schema: [orgNode, websiteNode, localBusinessNode, breadcrumbNode([
    { name: "Home", path: "/" },
    { name: "Our Home", path: "/our-home/" },
  ])],
  body: `
  <nav class="container breadcrumb" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li>Our Home</li></ol></nav>
  <section class="section section--tight">
    <div class="container">
      <p class="eyebrow">Our Home</p>
      <h1>A real home, built for steady living</h1>
      <p class="lede">Legacy Independent Living is a comfortable residence in a quiet ${esc(BIZ.city)} neighborhood — clean, well cared for, and designed to feel like home from your first day.</p>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">
      <div class="grid grid--3">
        ${featureCards.map((c) => `<article class="card">${c.i}<h3>${c.t}</h3><p>${c.d}</p></article>`).join("\n        ")}
      </div>
    </div>
  </section>
  <section class="section" style="background:var(--paper-2);">
    <div class="container">${ourHomeBlock(1)}</div>
  </section>
  <section class="section band-dark">
    <div class="container center">
      <h2>Come see it for yourself</h2>
      <p style="color:#dde0cf;max-width:58ch;margin-inline:auto;">The best way to know if Legacy is right for you is to visit. Reach out and we'll arrange a time to walk through the home and answer every question.</p>
      <div class="hero__cta" style="justify-content:center;margin-top:1.4rem;">
        <a class="btn btn--light" href="../how-to-apply/">How to apply</a>
        <a class="btn btn--on-dark" href="../contact/#inquire">Schedule a visit</a>
      </div>
    </div>
  </section>`,
});

/* ---------- HOW TO APPLY ---------- */
const steps = [
  { t: "Reach out", d: `Call or text ${BIZ.phoneDisplay}, or send the inquiry form. Tell us a little about your situation — there's no judgment here.` },
  { t: "Talk it through", d: "We'll have a short, honest conversation about your needs, our house guidelines, and whether Legacy is a good fit for where you are right now." },
  { t: "Visit the home", d: "Come see the residence in person, meet us, and picture your fresh start. We'll review expectations and answer every question." },
  { t: "Move in & move forward", d: "Once you're approved, we help you settle in and connect to the work, recovery, and community resources that keep your progress going." },
];
pages.push({
  file: "how-to-apply/index.html",
  depth: 1,
  path: "/how-to-apply/",
  title: "How to Apply | Legacy Independent Living, Fulshear TX",
  description:
    "Applying to Legacy Independent Living in Fulshear, TX is simple: reach out, talk it through, visit the home, and move in. Reentry & recovery welcome. Call (832) 317-1933.",
  schema: [orgNode, websiteNode, localBusinessNode, breadcrumbNode([
    { name: "Home", path: "/" },
    { name: "How to Apply", path: "/how-to-apply/" },
  ])],
  body: `
  <nav class="container breadcrumb" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li>How to Apply</li></ol></nav>
  <section class="section section--tight">
    <div class="container">
      <p class="eyebrow">How to Apply</p>
      <h1>Getting started is simple</h1>
      <p class="lede">No long forms or red tape. Applying to Legacy is a conversation — we want to understand your situation and help you find the right next step.</p>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">
      <div class="grid grid--2">
        ${steps.map((s, i) => `<article class="card"><div class="value__num" style="color:var(--leaf);">Step 0${i + 1}</div><h3>${s.t}</h3><p>${s.d}</p></article>`).join("\n        ")}
      </div>
      <div class="center" style="margin-top:2.2rem;">
        <a class="btn btn--primary" href="../contact/#inquire">Start your inquiry</a>
        <a class="btn btn--ghost" href="tel:${BIZ.phoneTel}" style="margin-left:.6rem;">Call ${esc(BIZ.phoneDisplay)}</a>
      </div>
    </div>
  </section>
  <section class="section" style="background:var(--paper-2);">
    <div class="container">
      <h2 class="center">Who we welcome</h2>
      <ul class="checklist" style="margin-top:1.4rem;max-width:880px;margin-inline:auto;">
        ${whoFor.map((w) => `<li>${w}</li>`).join("\n        ")}
      </ul>
    </div>
  </section>`,
});

/* ---------- FAQ PAGE ---------- */
pages.push({
  file: "faq/index.html",
  depth: 1,
  path: "/faq/",
  title: "FAQ | Legacy Independent Living, Fulshear TX Transitional Housing",
  description:
    "Answers about Legacy Independent Living in Fulshear, TX — what it is, who it's for, where it is, how to apply, costs, and areas served across Fort Bend County.",
  schema: [orgNode, websiteNode, faqPageNode(FAQS), breadcrumbNode([
    { name: "Home", path: "/" },
    { name: "FAQ", path: "/faq/" },
  ])],
  body: `
  <nav class="container breadcrumb" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li>FAQ</li></ol></nav>
  <section class="section section--tight">
    <div class="container center">
      <p class="eyebrow">Questions &amp; Answers</p>
      <h1>Frequently asked questions</h1>
      <p class="lede measure">Everything you need to know about living at Legacy Independent Living in ${esc(BIZ.city)}, Texas.</p>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">${faqAccordion(FAQS)}</div>
  </section>
  <section class="section band-dark">
    <div class="container center">
      <h2>Still have questions?</h2>
      <p style="color:#dde0cf;max-width:54ch;margin-inline:auto;">We're happy to talk it through. Reach out any time.</p>
      <div class="hero__cta" style="justify-content:center;margin-top:1.4rem;">
        <a class="btn btn--light" href="../contact/#inquire">Contact us</a>
        <a class="btn btn--on-dark" href="tel:${BIZ.phoneTel}">Call ${esc(BIZ.phoneDisplay)}</a>
      </div>
    </div>
  </section>`,
});

/* ---------- CONTACT ---------- */
pages.push({
  file: "contact/index.html",
  depth: 1,
  path: "/contact/",
  ogType: "business.business",
  title: "Contact | Legacy Independent Living, Fulshear TX | (832) 317-1933",
  description:
    "Contact Legacy Independent Living at 4334 Camden, Fulshear, TX 77441. Call (832) 317-1933, email us, or send an inquiry about transitional & reentry housing.",
  schema: [orgNode, websiteNode, localBusinessNode, breadcrumbNode([
    { name: "Home", path: "/" },
    { name: "Contact", path: "/contact/" },
  ])],
  body: `
  <nav class="container breadcrumb" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li>Contact</li></ol></nav>
  <section class="section section--tight">
    <div class="container">
      <p class="eyebrow">Contact</p>
      <h1>Get in touch with Legacy</h1>
      <p class="lede">We'd love to hear from you. Call, email, or send a message and we'll respond as soon as we can.</p>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">
      <div class="contact-grid">
        <div>
          <h2>Reach us directly</h2>
          <ul class="contact-list" style="margin-top:1.2rem;">
            <li>${ICONS.pin}<span><strong>${esc(NAP)}</strong><br><span style="color:var(--brown-soft);">${esc(BIZ.county)}, Texas</span></span></li>
            <li>${ICONS.phone}<a href="tel:${BIZ.phoneTel}">${esc(BIZ.phoneDisplay)}</a></li>
            <li>${ICONS.mail}<a href="mailto:${BIZ.email}">${esc(BIZ.email)}</a></li>
          </ul>
          <p><a class="chip" href="${MAPS_DIR}" target="_blank" rel="noopener">${ICONS.pin} Get directions</a></p>
          <iframe class="map-frame" style="margin-top:1rem;" src="${MAPS_EMBED}" title="Map to ${esc(BIZ.name)} at ${esc(NAP)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
        </div>
        <div id="inquire">
          <h2>Send an inquiry</h2>
          <p style="color:#4a463c;">Fill this out and we'll get back to you. Reentry, recovery, and referral inquiries are all welcome.</p>
          ${inquiryForm()}
        </div>
      </div>
    </div>
  </section>`,
});

/* ------------------------------------------------------------------ *
 * Emit pages
 * ------------------------------------------------------------------ */
for (const page of pages) {
  const html = head(page) + page.body + footer(page);
  const out = join(ROOT, page.file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log("wrote", page.file);
}

/* ------------------------------------------------------------------ *
 * robots.txt + sitemap.xml + .nojekyll
 * ------------------------------------------------------------------ */
const robots = `User-agent: *
Allow: /

Sitemap: ${BIZ.domain}/sitemap.xml
`;
writeFileSync(join(ROOT, "robots.txt"), robots);
console.log("wrote robots.txt");

const lastmod = "2026-06-19";
const sitemapUrls = pages.map((p) => ({
  loc: BIZ.domain + p.path,
  priority: p.path === "/" ? "1.0" : p.path === "/independent-living-fulshear/" ? "0.9" : "0.8",
}));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;
writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
console.log("wrote sitemap.xml");

writeFileSync(join(ROOT, ".nojekyll"), "");
console.log("wrote .nojekyll");

console.log(`\nDone. ${pages.length} pages + robots + sitemap.`);
