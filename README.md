# Legacy Independent Living — website

Marketing website for **Legacy Independent Living**, a supportive transitional &
reentry housing residence in **Fulshear, TX** (Fort Bend County).

> _Live well. Live independently. Live legacy._

Static, mobile-first, **no build step required to serve**. Pure HTML/CSS/JS that
runs on GitHub Pages with no server. A small Node generator keeps the markup
DRY and the SEO data consistent — but it only runs locally when you edit content;
the committed `.html` files are what ship.

---

## Structure

```
/                              index.html            Home / hub (single-page anchor nav)
/independent-living-fulshear/  index.html            Primary "money" geo page
/independent-living-katy/      index.html            Geo landing page (Katy)
/independent-living-richmond/  index.html            Geo landing page (Richmond)
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
| **Geo pin** | `BIZ.geoLat` / `BIZ.geoLng` | `29.7016, -95.8949` — **verify against the real Google Business Profile pin** for accurate map ranking |
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

## SEO notes

- One JSON-LD `@graph` per page: `Organization`, `WebSite`,
  `LocalBusiness`+`LodgingBusiness` (full NAP, geo, `areaServed`, hours, `hasMap`,
  `priceRange`), plus `FAQPage` (home + /faq/) and `BreadcrumbList` (sub-pages).
- NAP string `4334 Camden, Fulshear, TX 77441` is byte-identical across schema,
  contact section, and footer (enforced by `validate.mjs`).
- Geo meta tags, canonical, Open Graph (`business.business` on home/contact),
  Twitter `summary_large_image`, `robots: index, follow, max-image-preview:large`.
- Topical/geo silo: home hub ↔ Fulshear/Katy/Richmond geo pages ↔ supporting pages,
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
