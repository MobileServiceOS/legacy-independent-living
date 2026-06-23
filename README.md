# Legacy Independent Living — website

Marketing website for **Legacy Independent Living** — affordable **independent
living homes across the Houston, TX metro** for **veterans and people experiencing
homelessness**. Residents rent a room and live on their own; there are no on-site
staff, programs, or curfews. Run as a **service-area business** (no public street
address shown).

> _Live well. Live independently. Live legacy._

Static, mobile-first, **no build step required to serve**. Pure HTML/CSS/JS that
runs on GitHub Pages with no server. A small Node generator keeps the markup
DRY and the SEO data consistent — but it only runs locally when you edit content;
the committed `.html` files are what ship.

---

## Structure

```
/                              index.html            Home / hub (single-page anchor nav)
/independent-living-houston/          index.html     Primary "money" page (Houston)
/veterans-housing-houston/            index.html     Audience page (veterans)
/housing-for-the-homeless-houston/    index.html     Audience page (homelessness)
/our-home/                     index.html            The residence
/how-to-apply/                 index.html            Application steps
/faq/                          index.html            Full FAQ (+ FAQPage schema)
/contact/                      index.html            NAP, map, inquiry form
robots.txt                     Allow all + Sitemap line
sitemap.xml                    All 8 URLs, lastmod, priority
.nojekyll                      Tell Pages to serve files as-is
CNAME                          (add when DNS is ready — see Deploy)

assets/
  css/styles.css   One source of truth for all styling + brand tokens
  js/main.js       Mobile nav, FAQ accordion, mailto inquiry form (progressive enhancement)
  img/
    logo.svg        Hero emblem (vector)
    logo-mark.svg   Round header/footer/favicon mark (vector)
    logo.png        760px raster (used as schema/Organization logo)
    favicon.png     64px favicon
    og-image.png    1200×630 social share card
    og-image.svg    source for og-image.png

scripts/
  build.mjs     Regenerates every page + sitemap + robots from one config block
  validate.mjs  108 checks: JSON-LD parses, NAP byte-identical, one H1, links/anchors
                resolve, sitemap coverage, FAQ mirrored 1:1, required files present
```

## Editing content

All business facts and copy live in **`scripts/build.mjs`** — the `BIZ` config
block at the top is the single source of truth (name, phone, email, domain,
address, geo, areas served, price range). Page copy, feature cards, values, FAQs,
and per-page metadata are defined further down.

After any edit:

```bash
node scripts/build.mjs      # regenerate the static HTML + sitemap + robots
node scripts/validate.mjs   # must print "✅ PASS" before you commit
```

Then commit the regenerated `.html` files.

> Don't hand-edit the generated `.html` files directly — your changes will be
> overwritten on the next `build.mjs` run. Edit `build.mjs` instead.

## Placeholders to swap (before / soon after launch)

| What | Where | Current value |
|------|-------|---------------|
| **Email** | `BIZ.email` in `scripts/build.mjs` | `service@legacyindependentliving.net` |
| **Domain** | `BIZ.domain` in `scripts/build.mjs` | `https://legacyindependentliving.net` |
| **Geo pin** | `BIZ.geoLat` / `BIZ.geoLng` | `29.7604, -95.3698` (central Houston reference) — adjust toward where most homes are concentrated |
| **Areas served** | `BIZ.areasServed` | Houston, Katy, Sugar Land, Pasadena, Pearland, Spring |
| **Phone** | `BIZ.phoneDisplay` / `BIZ.phoneTel` | `(832) 317-1933` / `+18323171933` |

After changing any of these, re-run `build.mjs` + `validate.mjs`.

### Logo assets

The site uses the supplied illustrated artwork. The master is
`assets/img/source-logo.png` (2200×700 banner). Everything else is derived from it:

| File | What it is | How it's made |
|------|------------|---------------|
| `source-logo.png` | Master banner (keep this) | supplied artwork |
| `logo.png` | Hero + schema logo (banner, 1200w) | `sips --resampleWidth 1200 source-logo.png --out logo.png` |
| `logo-mark.png` | Round header/footer mark (256², just the emblem) | square crop of the circular scene |
| `favicon.png` | 64² favicon | `sips -z 64 64 logo-mark.png` (from the emblem crop) |
| `og-image.png` | 1200×630 social card | banner centered on a branded background |

To replace the logo later, drop a new `source-logo.png` and regenerate `logo.png`
+ `favicon.png` with the `sips` commands above. The emblem crop (`logo-mark.png`)
was cut from the banner's circular scene (top-center) — re-crop if the new art
has a different layout.

## Performance (Lighthouse)

Built to score ~100 across Performance / Accessibility / Best-Practices / SEO.
Key techniques:

- **Self-hosted fonts** (`assets/fonts/*.woff2`, latin subset) — no third-party
  Google Fonts request, `font-display: swap`, critical fonts preloaded.
- **Inlined CSS** — the one stylesheet is injected into each page at build time
  (no render-blocking request); `@font-face` paths are written per-page so they
  resolve at every depth.
- **Click-to-load map facade** — the Google Maps iframe (heavy third-party JS +
  cookies) is replaced by a lightweight placeholder and only loaded on click.
  No-JS users still get the map via `<noscript>`.
- **Optimized imagery** — all photos are self-hosted **WebP**, served responsively
  (`srcset`/`sizes`) with explicit `width`/`height` (zero layout shift) and
  `loading="lazy"`; the hero logo is preloaded with `fetchpriority="high"`.

Run it yourself:

```bash
npm install                 # installs lighthouse (devDependency)
node scripts/build.mjs
python3 -m http.server 8080 &     # or any static server
npx lighthouse http://localhost:8080/ --view
```

> A local `http.server` doesn't gzip, so Lighthouse will show a "text compression"
> item locally — GitHub Pages serves gzip/brotli, so that resolves in production.
> Test the live URL for production-accurate numbers.

## Photography

Photos in `assets/img/photos/` are royalty-free stock from **Unsplash**
([Unsplash License](https://unsplash.com/license) — free for commercial use, no
attribution required). They were downloaded as WebP at two widths each and are
self-hosted. To swap one, drop a replacement at the same path/size (keep the
aspect ratio so `width`/`height` stay correct) or re-run the download with a new
Unsplash photo id.

## SEO notes

- One JSON-LD `@graph` per page: `Organization`, `WebSite`,
  `LocalBusiness`+`LodgingBusiness` (full NAP, geo, `areaServed`, hours, `hasMap`,
  `priceRange`), plus `FAQPage` (home + /faq/) and `BreadcrumbList` (sub-pages).
- Service-area business: no public street address. Locality `Houston, TX` is byte-identical across schema,
  contact section, and footer (enforced by `validate.mjs`).
- Geo meta tags, canonical, Open Graph (`business.business` on home/contact),
  Twitter `summary_large_image`, `robots: index, follow, max-image-preview:large`.
- Topical silo: home hub ↔ Houston / veterans / homelessness pages ↔ supporting pages,
  interlinked with descriptive anchors (no orphan pages).

## Deploy (GitHub Pages)

This is deployed as a **project site** so the live URL works immediately:

`https://mobileserviceos.github.io/legacy-independent-living/`

All internal links/assets use **relative paths**, so the site works both at that
project URL and at the apex domain once DNS is pointed.

### Attach the custom domain (when DNS is ready)

1. Point DNS for `legacyindependentliving.net`:
   - `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - or a `CNAME` for `www` → `mobileserviceos.github.io`
2. Add the domain file and push:
   ```bash
   echo "legacyindependentliving.net" > CNAME
   git add CNAME && git commit -m "Add custom domain" && git push
   ```
3. In **Settings → Pages**, set the custom domain and enable **Enforce HTTPS**.

The `canonical`, `sitemap.xml`, schema, and Open Graph URLs already point at
`https://legacyindependentliving.net`, so no content changes are needed when DNS
goes live (just confirm `BIZ.domain` matches your final domain).

## Accessibility

Skip link, semantic landmarks, visible keyboard focus, labeled form fields,
`prefers-reduced-motion` respected, AA color contrast, descriptive `alt` text.
The site is fully usable with JavaScript disabled (the form falls back to a
direct `mailto:` and the FAQ answers remain in the DOM).
