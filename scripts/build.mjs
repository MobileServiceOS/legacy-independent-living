#!/usr/bin/env node
/* =========================================================================
   Legacy Independent Living — static site generator (single source of truth)
   No serve-time build step: this emits plain static HTML committed to the repo.
   Run:  node scripts/build.mjs
   ========================================================================= */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Read the one CSS source of truth so it can be inlined (no render-blocking request).
const CSS = readFileSync(join(ROOT, "assets/css/styles.css"), "utf8").trim();

// @font-face with page-relative paths (so inlined CSS resolves fonts on every page).
const FONTS = [
  ["Cormorant Garamond", "normal", 500, "cormorantgaramond-500"],
  ["Cormorant Garamond", "normal", 600, "cormorantgaramond-600"],
  ["Cormorant Garamond", "normal", 700, "cormorantgaramond-700"],
  ["Cormorant Garamond", "italic", 500, "cormorantgaramond-500-italic"],
  ["Cormorant Garamond", "italic", 600, "cormorantgaramond-600-italic"],
  ["Mulish", "normal", 400, "mulish-400"],
  ["Mulish", "normal", 600, "mulish-600"],
  ["Mulish", "normal", 700, "mulish-700"],
  ["Mulish", "normal", 800, "mulish-800"],
];
const fontFace = (p) =>
  FONTS.map(
    ([fam, style, wt, file]) =>
      `@font-face{font-family:"${fam}";font-style:${style};font-weight:${wt};font-display:swap;src:url("${p}assets/fonts/${file}.woff2") format("woff2")}`
  ).join("");

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
  // Service-area business — homes across the Houston metro, no public street address shown.
  city: "Houston",
  region: "TX",
  county: "Harris County",
  country: "US",
  geoLat: 29.7604, // central Houston (service-area reference point)
  geoLng: -95.3698,
  priceRange: "$",
  areasServed: ["Houston", "Katy", "Sugar Land", "Pasadena", "Pearland", "Spring"],
};
// Service-area locality string used consistently across schema, contact, and footer.
const NAP = `${BIZ.city}, ${BIZ.region}`; // "Houston, TX"
const NAP_FULL = `Serving the Greater ${BIZ.city} Area, ${BIZ.region}`;
const MAPS_QUERY = encodeURIComponent(`${BIZ.city}, ${BIZ.region}`);
const MAPS_EMBED = `https://www.google.com/maps?q=${MAPS_QUERY}&output=embed`;
const MAPS_PLACE = `https://www.google.com/maps/place/${MAPS_QUERY}`;
const OG_IMAGE = `${BIZ.domain}/assets/img/og-image.png`;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// depth: 0 = repo root page, 1 = page in a sub-directory.
const pfx = (depth) => (depth === 0 ? "" : "../");
const homeHref = (depth) => (depth === 0 ? "./" : "../");

/* Responsive, self-hosted WebP photo with width/height (no layout shift),
   srcset for "properly sized images", lazy by default. */
function photo(name, alt, depth, opts = {}) {
  const { wide = false, eager = false, sizes, className = "photo" } = opts;
  const p = pfx(depth);
  const ratioW = 16, ratioH = wide ? 7 : 10;
  const w1 = wide ? 1280 : 800;
  const w2 = wide ? 1920 : 1280;
  const iw = w2, ih = Math.round((w2 * ratioH) / ratioW);
  const s = sizes || "(max-width: 900px) 100vw, 560px";
  const dir = `${p}assets/img/photos/${name}`;
  return `<img class="${className}" src="${dir}-${w1}.webp" srcset="${dir}-${w1}.webp ${w1}w, ${dir}-${w2}.webp ${w2}w" sizes="${s}" width="${iw}" height="${ih}" alt="${esc(alt)}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
}

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
  addressLocality: BIZ.city,
  addressRegion: BIZ.region,
  addressCountry: BIZ.country,
};

const localBusinessNode = {
  "@type": ["LocalBusiness", "LodgingBusiness"],
  "@id": ID.biz,
  name: BIZ.name,
  alternateName: "Legacy Independent Living Houston",
  url: BIZ.domain + "/",
  image: OG_IMAGE,
  logo: `${BIZ.domain}/assets/img/logo.png`,
  telephone: BIZ.phoneTel,
  email: BIZ.email,
  priceRange: BIZ.priceRange,
  description:
    "Independent living homes across the Houston, Texas area for veterans and people experiencing homelessness — affordable, stable, private housing with no programs, curfews, or on-site staff. Just a place of your own.",
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
    a: `Legacy Independent Living offers independent living homes across the ${BIZ.city}, Texas area for veterans and people experiencing homelessness. You rent a room in a clean, comfortable house and live on your own — it is a real home of your own, not a program.`,
  },
  {
    q: "Is this supportive or transitional housing with staff on site?",
    a: "No. This is independent living. There are no on-site staff, case managers, curfews, classes, or required programs. You come and go as you please and run your own life. We simply provide a stable, affordable place to live.",
  },
  {
    q: "Where are the homes located?",
    a: `Our homes are located across the greater ${BIZ.city} area, including communities such as Katy, Sugar Land, Pasadena, Pearland, and Spring. Reach out and we'll let you know what's currently available near you.`,
  },
  {
    q: "Who is it for?",
    a: "Our homes are for veterans and for people who are experiencing or leaving homelessness — and for anyone 18 or older who needs a stable, affordable, independent place to live. Everyone deserves a dignified place to call home.",
  },
  {
    q: "How do I apply or move in?",
    a: `It's simple: call or text us at ${BIZ.phoneDisplay} or send the inquiry form. We'll tell you what's available, what it costs, and how soon you can move in. No long applications or red tape.`,
  },
  {
    q: "Do you help veterans with VA benefits or services?",
    a: "We're an independent housing provider, not a VA or social-service program, so we don't administer benefits. That said, veterans are very welcome here, and we're glad to point you toward Houston-area VA offices and community resources you can contact directly.",
  },
  {
    q: "What areas do you serve?",
    a: `We serve ${BIZ.city} and the surrounding metro — Katy, Sugar Land, Pasadena, Pearland, Spring, and nearby communities. Our homes keep you close to work, transit, VA services, and the city.`,
  },
  {
    q: "How much does it cost?",
    a: "We keep rent affordable and transparent, with no surprise fees. Exact cost depends on the home and room. Contact us for current availability and rates.",
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
    ? `<meta property="business:contact_data:locality" content="${esc(BIZ.city)}">
<meta property="business:contact_data:region" content="${esc(BIZ.region)}">
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
<link rel="apple-touch-icon" href="${p}assets/img/favicon.png">

<link rel="preload" as="font" type="font/woff2" href="${p}assets/fonts/mulish-400.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="${p}assets/fonts/cormorantgaramond-600.woff2" crossorigin>
${page.preload || ""}<style>${fontFace(p)}${CSS}</style>

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
    <a class="brand" href="${h}">
      <img class="brand__mark" src="${p}assets/img/logo-mark.webp" width="44" height="44" alt="" aria-hidden="true">
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
          <img src="${p}assets/img/logo-mark.webp" width="48" height="48" alt="${esc(BIZ.name)} logo" loading="lazy">
          <span style="font-family:var(--serif);font-size:1.35rem;color:#fff;">${esc(BIZ.name)}</span>
        </div>
        <p style="max-width:38ch;color:#c9ccb6;">${esc(BIZ.tagline)} Independent living homes for veterans and people experiencing homelessness across the greater ${esc(BIZ.city)} area.</p>
        <p><a href="${MAPS_PLACE}" target="_blank" rel="noopener">Serving the greater ${esc(BIZ.city)} area &rarr;</a></p>
      </div>
      <div>
        <h2>Explore</h2>
        <ul class="footer-nav">
          <li><a href="${h}">Home</a></li>
          <li><a href="${p}our-home/">Our Homes</a></li>
          <li><a href="${p}how-to-apply/">How to Apply</a></li>
          <li><a href="${p}faq/">FAQ</a></li>
          <li><a href="${p}contact/">Contact</a></li>
        </ul>
      </div>
      <div>
        <h2>Who We Serve</h2>
        <ul class="footer-nav">
          <li><a href="${p}independent-living-houston/">Independent Living in Houston</a></li>
          <li><a href="${p}veterans-housing-houston/">Housing for Veterans</a></li>
          <li><a href="${p}housing-for-the-homeless-houston/">Housing After Homelessness</a></li>
        </ul>
        <h2 style="margin-top:1.2rem;">Contact</h2>
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
function faqAccordion(faqs, hl = 3) {
  return `<div class="faq">
    ${faqs
      .map(
        (f, i) => `<div class="faq__item">
      <h${hl} style="margin:0;">
        <button class="faq__q" id="faq-q-${i}" aria-expanded="false" aria-controls="faq-a-${i}">${esc(f.q)}</button>
      </h${hl}>
      <div class="faq__a" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}">
        <div><p>${esc(f.a)}</p></div>
      </div>
    </div>`
      )
      .join("\n    ")}
  </div>`;
}

/* Click-to-load map facade — keeps Google Maps (third-party JS + cookies) out of
   the initial load for speed + privacy; the real iframe is injected on click.
   No-JS users still get the map via <noscript>. */
function mapFacade(extraStyle = "") {
  const title = `Map to ${BIZ.name} at ${NAP}`;
  return `<div class="map-facade" data-map-src="${MAPS_EMBED}" data-map-title="${esc(title)}"${extraStyle ? ` style="${extraStyle}"` : ""}>
    <button type="button" class="map-facade__btn">
      ${ICONS.pin}
      <span>View interactive map</span>
      <small>Map by Google &middot; loads on click</small>
    </button>
    <noscript><iframe class="map-frame" src="${MAPS_EMBED}" title="${esc(title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></noscript>
  </div>`;
}

/* Reusable "Our Home" map + address block */
function ourHomeBlock(depth) {
  const p = pfx(depth);
  return `<div class="home-grid">
    <div>
      ${photo("home-exterior", `A Legacy Independent Living home in the ${BIZ.city}, Texas area`, depth, { className: "photo", sizes: "(max-width: 900px) 100vw, 560px" })}
      <p class="eyebrow" style="margin-top:1.4rem;">Our Homes</p>
      <h2>Real homes across ${esc(BIZ.city)}</h2>
      <p class="lede">Our homes sit in everyday ${esc(BIZ.city)}-area neighborhoods — close to transit, work, and VA services. Each is a clean, comfortable house where you rent a room and live independently.</p>
      <p>No programs, no curfews, no staff looking over your shoulder. Just a stable, affordable address that's yours, with respectful neighbors who value a calm place to live.</p>
      <div class="linkrow">
        <a class="chip" href="${p}our-home/">See our homes</a>
        <a class="chip" href="${p}contact/#inquire">${ICONS.pin} Check availability</a>
      </div>
    </div>
    <div>
      <div class="addr-card">
        <h3>Get in touch</h3>
        <address>
          <div class="row">${ICONS.pin}<span>${esc(NAP)}<br><small style="color:var(--brown-soft)">${esc(NAP_FULL)}</small></span></div>
          <div class="row">${ICONS.phone}<a href="tel:${BIZ.phoneTel}">${esc(BIZ.phoneDisplay)}</a></div>
          <div class="row">${ICONS.mail}<a href="mailto:${BIZ.email}">${esc(BIZ.email)}</a></div>
        </address>
      </div>
      ${mapFacade("margin-top:1rem;")}
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
  { i: ICONS.key, t: "A Place of Your Own", d: "Rent your own room in a clean, comfortable house. Come and go on your schedule, keep your own space, and live like the adult you are." },
  { i: ICONS.home, t: "Stable &amp; Affordable", d: "Honest, predictable rent with no surprise fees — so you can plan ahead and put down roots instead of worrying about next month." },
  { i: ICONS.shield, t: "No Programs, No Curfews", d: "This is independent living, not a shelter or a program. No required classes, no sign-in sheets, no staff watching over you." },
  { i: ICONS.people, t: "Respectful Neighbors", d: "Share the home with others who value a calm, quiet, respectful place to live. Your independence, alongside good company." },
  { i: ICONS.path, t: "Close to What Matters", d: "Homes across the Houston metro keep you near transit, jobs, VA services, and the everyday rhythms of the city." },
  { i: ICONS.leaf, t: "A Fresh Foundation", d: "A steady address to rebuild from, at your own pace — whether you're a veteran or starting over after homelessness." },
];

const values = [
  { t: "Dignity", d: "Everyone deserves a safe, private place to call home. We treat every resident with respect, no questions asked." },
  { t: "Independence", d: "You run your own life. We provide the home; the rest is yours — your schedule, your choices, your space." },
  { t: "Stability", d: "A steady, affordable address is the foundation for everything else — work, health, and peace of mind." },
  { t: "Community", d: "Live among neighbors who value a calm, respectful home. Independence doesn't have to mean isolation." },
];

const whoFor = [
  "Veterans looking for stable, independent housing",
  "People experiencing or leaving homelessness",
  "Anyone needing an affordable, independent place to call home",
  "Adults who want privacy and to live on their own terms",
  "People ready for a steady address to rebuild from",
  "Those who value a calm, respectful home environment",
  "Residents who want independence without programs or curfews",
  "Anyone in the greater Houston area seeking a fresh start",
];

pages.push({
  file: "index.html",
  depth: 0,
  path: "/",
  ogType: "business.business",
  preload: `<link rel="preload" as="image" href="assets/img/logo-560.webp" imagesrcset="assets/img/logo-560.webp 560w, assets/img/logo.webp 900w" imagesizes="(max-width: 900px) 72vw, 440px" fetchpriority="high">\n`,
  title: "Legacy Independent Living | Independent Housing in Houston for Veterans & Those Rebuilding",
  description:
    "Affordable independent living homes across Houston, TX for veterans and people experiencing homelessness. Rent a room and live on your own — no programs, curfews, or on-site staff. Call (832) 317-1933.",
  schema: [orgNode, websiteNode, localBusinessNode, faqPageNode(FAQS)],
  body: `
  <section class="hero">
    <div class="container">
      <div class="hero--center">
        <img class="hero__logo" src="assets/img/logo.webp" srcset="assets/img/logo-560.webp 560w, assets/img/logo.webp 900w" sizes="(max-width: 900px) 72vw, 440px" width="900" height="900" fetchpriority="high" decoding="async" alt="Legacy Independent Living — a family walking home beneath a tree. Live well. Live independently. Live legacy.">
        <p class="visually-hidden">${esc(BIZ.tagline)}</p>
        <h1>Independent Living Homes in ${esc(BIZ.city)}, Texas</h1>
        <p class="lede">Affordable, independent housing for veterans and people experiencing homelessness across the ${esc(BIZ.city)} area. Rent a room in a real home and live on your own terms — no programs, no curfews, no staff. Just a stable place that's yours.</p>
        <div class="hero__cta">
          <a class="btn btn--primary" href="#contact">Check availability</a>
          <a class="btn btn--ghost" href="tel:${BIZ.phoneTel}">Call ${esc(BIZ.phoneDisplay)}</a>
        </div>
        <p class="hero__addr">${ICONS.pin}&nbsp;Serving the greater ${esc(BIZ.city)} area</p>
      </div>
    </div>
  </section>
  ${branchDivider}

  <section class="section" id="welcome">
    <div class="container">
      <div class="split">
        <div>
          <p class="eyebrow">Welcome</p>
          <h2>A home of your own, on your own terms</h2>
          <p class="lede">Whether you've served your country or you're climbing out of homelessness, everyone deserves a stable, dignified place to live.</p>
          <p>Legacy Independent Living gives you exactly that in ${esc(BIZ.city)}: an affordable room in a real home where you live independently. No programs to enroll in, no curfews, no one looking over your shoulder — just a steady address you can build a life from.</p>
        </div>
        <div>${photo("cozy-interior", "A calm, sunlit living space with a comfortable chair by the window", 0, { sizes: "(max-width: 900px) 100vw, 520px" })}</div>
      </div>
    </div>
  </section>

  <section class="section" id="living-here" style="background:var(--paper-2);">
    <div class="container">
      <div class="center"><p class="eyebrow">What You Get</p><h2>Independent living, done right</h2></div>
      <div class="grid grid--3" style="margin-top:2rem;">
        ${featureCards.map((c) => `<article class="card">${c.i}<h3>${c.t}</h3><p>${c.d}</p></article>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="section band-dark band-photo" id="why-legacy" style="background-image: linear-gradient(rgba(58,67,31,.88), rgba(58,67,31,.92)), url('assets/img/photos/growth-seedlings-1280.webp');">
    <div class="container">
      <div class="center"><p class="eyebrow">Why Legacy</p><h2>What we stand for</h2></div>
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
        <p class="lede measure">Our homes are for adults who want a stable, independent place to live in the ${esc(BIZ.city)} area. You may be a good fit if you are:</p>
      </div>
      <div class="split" style="margin-top:2rem;align-items:start;">
        <div>${photo("home-keys", "A set of house keys being handed over — the start of an independent home of your own", 0, { sizes: "(max-width: 900px) 100vw, 480px" })}</div>
        <ul class="checklist" style="grid-template-columns:1fr;">
          ${whoFor.map((w) => `<li>${w}</li>`).join("\n          ")}
        </ul>
      </div>
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
          <h2>Let's find you a place to live</h2>
          <p style="color:#dde0cf;">Call, email, or send a message. We'll tell you what's available across ${esc(BIZ.city)}, what it costs, and how soon you can move in.</p>
          <ul class="contact-list" style="margin-top:1.4rem;color:#eef0e3;">
            <li>${ICONS.pin}<span>${esc(NAP)}<br><span style="color:#bcc0a8;">${esc(NAP_FULL)}</span></span></li>
            <li>${ICONS.phone}<a href="tel:${BIZ.phoneTel}" style="color:#fff;">${esc(BIZ.phoneDisplay)}</a></li>
            <li>${ICONS.mail}<a href="mailto:${BIZ.email}" style="color:#fff;">${esc(BIZ.email)}</a></li>
          </ul>
        </div>
        <div id="inquire">${inquiryForm()}</div>
      </div>
    </div>
  </section>`,
});

/* ---------- HOUSTON LANDING PAGES (silo) ---------- */
const geoPages = [
  {
    slug: "independent-living-houston",
    primary: true,
    nav: "Independent Living in Houston",
    eyebrow: "Serving Houston, Texas",
    h1: "Independent Living in Houston, TX",
    title: "Independent Living in Houston, TX | Affordable Rooms to Rent | Legacy",
    description:
      "Affordable independent living homes across Houston, TX. Rent a room and live on your own — no programs, curfews, or staff. For veterans and people rebuilding. Call (832) 317-1933.",
    intro:
      "Legacy Independent Living offers affordable, independent housing across the Houston, Texas area. Rent a room in a clean, comfortable home and live entirely on your own terms — this is independent living, not a shelter or a program. It's open to veterans, to people coming out of homelessness, and to anyone who needs a stable, dignified place of their own.",
    localH2: "Homes across the Houston metro",
    local:
      "Our homes sit in everyday neighborhoods around Houston and the surrounding metro — Katy, Sugar Land, Pasadena, Pearland, and Spring. That keeps you close to jobs, transit, VA services, and the rhythms of the city, in a quiet house with respectful neighbors.",
    offerEyebrow: "What You Get",
    offerH2: "Independent living, done right",
  },
  {
    slug: "veterans-housing-houston",
    nav: "Housing for Veterans",
    eyebrow: "For Veterans in Houston",
    h1: "Housing for Veterans in Houston, TX",
    title: "Housing for Veterans in Houston, TX | Independent Living | Legacy",
    description:
      "Affordable independent housing for veterans across Houston, TX. Rent a room and live on your own — no programs or curfews. Near Houston-area VA services. Call (832) 317-1933.",
    intro:
      "You served your country — you deserve a stable place of your own to come home to. Legacy Independent Living offers veterans affordable rooms in real homes across the Houston area, where you live independently on your own schedule. No programs to join, no curfews, no one looking over your shoulder.",
    localH2: "Close to Houston-area VA services",
    local:
      "Our homes around Houston keep you within reach of VA medical facilities, transit, and work. We're an independent housing provider rather than a VA program, so we don't administer benefits — but veterans are always welcome, and we're glad to point you toward local VA and community resources you can contact directly.",
    offerEyebrow: "What You Get",
    offerH2: "A stable home, on your terms",
  },
  {
    slug: "housing-for-the-homeless-houston",
    nav: "Housing After Homelessness",
    eyebrow: "A Place to Call Home",
    h1: "Housing for People Experiencing Homelessness in Houston, TX",
    title: "Housing After Homelessness in Houston, TX | Independent Living | Legacy",
    description:
      "Affordable independent housing in Houston, TX for people experiencing or leaving homelessness. Rent a room and live independently — a stable address to rebuild from. Call (832) 317-1933.",
    intro:
      "Getting off the street or out of a shelter starts with a stable address. Legacy Independent Living offers affordable rooms in real homes across Houston where you can live independently and rebuild at your own pace — with dignity, privacy, and no programs or curfews to navigate.",
    localH2: "A steady address to rebuild from",
    local:
      "Our Houston-area homes are clean, calm, and close to transit and work, so you can focus on getting back on your feet. Rent is honest and affordable, and the home is yours to live in like anyone else's — because everyone deserves a real place to call home.",
    offerEyebrow: "What You Get",
    offerH2: "Stability you can build on",
  },
];

for (const g of geoPages) {
  const others = geoPages.filter((x) => x.slug !== g.slug);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: g.nav, path: `/${g.slug}/` },
  ];
  const geoBiz = {
    ...localBusinessNode,
    "@id": `${BIZ.domain}/${g.slug}/#localbusiness`,
    areaServed: BIZ.areasServed.map((a) => ({ "@type": "Place", name: `${a}, TX` })),
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
      <li>${esc(g.nav)}</li>
    </ol>
  </nav>
  <section class="section section--tight">
    <div class="container">
      <p class="eyebrow">${esc(g.eyebrow)}</p>
      <h1>${esc(g.h1)}</h1>
      <p class="lede">${g.intro}</p>
      <div class="hero__cta" style="margin:1.4rem 0;">
        <a class="btn btn--primary" href="../contact/#inquire">Check availability</a>
        <a class="btn btn--ghost" href="tel:${BIZ.phoneTel}">Call ${esc(BIZ.phoneDisplay)}</a>
      </div>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">
      <h2>${esc(g.localH2)}</h2>
      <p class="measure">${g.local}</p>
      <p class="measure">Every Legacy home is a place of your own where you live independently — no programs, no curfews, no on-site staff. Just an affordable, stable address with respectful neighbors. ${esc(BIZ.tagline)}</p>
    </div>
  </section>
  <section class="section" style="background:var(--paper-2);">
    <div class="container">
      <div class="center"><p class="eyebrow">${esc(g.offerEyebrow)}</p><h2>${esc(g.offerH2)}</h2></div>
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
      <h2>Ready for a place of your own?</h2>
      <p style="color:#dde0cf;max-width:60ch;margin-inline:auto;">Reach out and we'll tell you what's available across the ${esc(BIZ.city)} area, what it costs, and how soon you can move in.</p>
      <div class="hero__cta" style="justify-content:center;margin-top:1.4rem;">
        <a class="btn btn--light" href="../contact/#inquire">Check availability</a>
        <a class="btn btn--on-dark" href="tel:${BIZ.phoneTel}">Call ${esc(BIZ.phoneDisplay)}</a>
      </div>
    </div>
  </section>
  <section class="section section--tight">
    <div class="container center">
      <p class="eyebrow">Explore More</p>
      <div class="linkrow" style="justify-content:center;">
        <a class="chip" href="../">${ICONS.pin} Independent living across Houston</a>
        ${others.map((o) => `<a class="chip" href="../${o.slug}/">${esc(o.nav)}</a>`).join("\n        ")}
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
  title: "Our Homes | Independent Living Houses Across Houston, TX | Legacy",
  description:
    "See the kind of homes Legacy Independent Living offers across the Houston, TX area — clean, comfortable houses where you rent a room and live independently. For veterans and those rebuilding.",
  schema: [orgNode, websiteNode, localBusinessNode, breadcrumbNode([
    { name: "Home", path: "/" },
    { name: "Our Homes", path: "/our-home/" },
  ])],
  body: `
  <nav class="container breadcrumb" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li>Our Homes</li></ol></nav>
  <section class="section section--tight">
    <div class="container">
      <p class="eyebrow">Our Homes</p>
      <h1>Real homes you can live in</h1>
      <p class="lede">Legacy Independent Living offers clean, comfortable houses across the ${esc(BIZ.city)} area where you rent a room and live independently — no programs, no curfews, just a stable place of your own.</p>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">
      <div class="center"><p class="eyebrow">What You Get</p><h2>Independent living, done right</h2></div>
      <div class="grid grid--3" style="margin-top:2rem;">
        ${featureCards.map((c) => `<article class="card">${c.i}<h3>${c.t}</h3><p>${c.d}</p></article>`).join("\n        ")}
      </div>
    </div>
  </section>
  <section class="section section--tight">
    <div class="container">
      <div class="center"><p class="eyebrow">A Look Inside</p><h2>Comfortable, clean, and cared for</h2></div>
      <div class="gallery" style="margin-top:2rem;">
        ${photo("living-room", "A bright, comfortable living room with natural light", 1, { className: "photo gallery__img", sizes: "(max-width: 700px) 100vw, 33vw" })}
        ${photo("kitchen", "A clean, well-equipped kitchen", 1, { className: "photo gallery__img", sizes: "(max-width: 700px) 100vw, 33vw" })}
        ${photo("bedroom", "A simple, restful bedroom of your own", 1, { className: "photo gallery__img", sizes: "(max-width: 700px) 100vw, 33vw" })}
        ${photo("cozy-interior", "A calm corner with a chair and warm natural light", 1, { className: "photo gallery__img", sizes: "(max-width: 700px) 100vw, 33vw" })}
      </div>
    </div>
  </section>
  <section class="section" style="background:var(--paper-2);">
    <div class="container">${ourHomeBlock(1)}</div>
  </section>
  <section class="section band-dark">
    <div class="container center">
      <h2>Find a home near you</h2>
      <p style="color:#dde0cf;max-width:58ch;margin-inline:auto;">Reach out and we'll tell you which homes have rooms available across the ${esc(BIZ.city)} area, what they cost, and how soon you can move in.</p>
      <div class="hero__cta" style="justify-content:center;margin-top:1.4rem;">
        <a class="btn btn--light" href="../how-to-apply/">How to apply</a>
        <a class="btn btn--on-dark" href="../contact/#inquire">Check availability</a>
      </div>
    </div>
  </section>`,
});

/* ---------- HOW TO APPLY ---------- */
const steps = [
  { t: "Reach out", d: `Call or text ${BIZ.phoneDisplay}, or send the inquiry form. Tell us roughly where in the ${BIZ.city} area you want to live — there's no judgment here.` },
  { t: "See what's open", d: "We'll tell you which homes have rooms available near you, what the rent is, and what to expect. Quick, honest answers — no long applications." },
  { t: "Tour a room", d: "Take a look at an available room and home so you can picture yourself there. Ask anything you want." },
  { t: "Move in", d: "When you're ready, you move in and the room is yours. From there you live independently — your schedule, your space, your life." },
];
pages.push({
  file: "how-to-apply/index.html",
  depth: 1,
  path: "/how-to-apply/",
  title: "How to Apply | Legacy Independent Living, Houston TX",
  description:
    "Moving into a Legacy independent living home in Houston, TX is simple: reach out, see what's open, tour a room, and move in. Veterans and those rebuilding welcome. Call (832) 317-1933.",
  schema: [orgNode, websiteNode, localBusinessNode, breadcrumbNode([
    { name: "Home", path: "/" },
    { name: "How to Apply", path: "/how-to-apply/" },
  ])],
  body: `
  <nav class="container breadcrumb" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li>How to Apply</li></ol></nav>
  <section class="section section--tight">
    <div class="container">
      <p class="eyebrow">How to Apply</p>
      <h1>Moving in is simple</h1>
      <p class="lede">No long forms or red tape. Finding a room with Legacy is a quick conversation — we'll tell you what's available across ${esc(BIZ.city)} and help you move in.</p>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">
      <div class="center"><p class="eyebrow">The Process</p><h2>Four simple steps</h2></div>
      <div class="grid grid--2" style="margin-top:2rem;">
        ${steps.map((s, i) => `<article class="card"><div class="value__num" style="color:#5f6234;">Step 0${i + 1}</div><h3>${s.t}</h3><p>${s.d}</p></article>`).join("\n        ")}
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
  title: "FAQ | Legacy Independent Living, Houston TX",
  description:
    "Answers about Legacy Independent Living in Houston, TX — what independent living means, who it's for, where the homes are, how to move in, costs, and veterans.",
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
      <p class="lede measure">What independent living with Legacy means, who it's for, and how to find a room across the ${esc(BIZ.city)} area.</p>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">${faqAccordion(FAQS, 2)}</div>
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
  title: "Contact | Legacy Independent Living, Houston TX | (832) 317-1933",
  description:
    "Contact Legacy Independent Living for independent housing across Houston, TX. Call (832) 317-1933, email us, or send an inquiry about available rooms for veterans and those rebuilding.",
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
      <p class="lede">We'd love to hear from you. Call, email, or send a message and we'll tell you what's available across the ${esc(BIZ.city)} area.</p>
    </div>
  </section>
  ${branchDivider}
  <section class="section">
    <div class="container">
      <div class="contact-grid">
        <div>
          <h2>Reach us directly</h2>
          <ul class="contact-list" style="margin-top:1.2rem;">
            <li>${ICONS.pin}<span><strong>${esc(NAP)}</strong><br><span style="color:var(--brown-soft);">${esc(NAP_FULL)}</span></span></li>
            <li>${ICONS.phone}<a href="tel:${BIZ.phoneTel}">${esc(BIZ.phoneDisplay)}</a></li>
            <li>${ICONS.mail}<a href="mailto:${BIZ.email}">${esc(BIZ.email)}</a></li>
          </ul>
          <p><a class="chip" href="${MAPS_PLACE}" target="_blank" rel="noopener">${ICONS.pin} Serving the greater ${esc(BIZ.city)} area</a></p>
          ${mapFacade("margin-top:1rem;")}
        </div>
        <div id="inquire">
          <h2>Send an inquiry</h2>
          <p style="color:#4a463c;">Fill this out and we'll get back to you. Veterans, people experiencing homelessness, and referrals are all welcome.</p>
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
  priority: p.path === "/" ? "1.0" : p.path === "/independent-living-houston/" ? "0.9" : "0.8",
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
