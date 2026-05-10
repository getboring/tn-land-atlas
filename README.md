# Holston Scout

**Pre-construction parcel intelligence for builders.**
*Scout the ground. Know the build.*

A parcel-first map product. Currently wired to **Sullivan, Washington,
and Carter** counties via Johnson City ArcGIS; the product itself is
not state-locked. Switchable basemaps (Satellite / Streets /
Topographic / Hybrid), slate parcel boundaries, amber hover and
selection states with corner-node markers (the Survey Corner brand
mark in miniature), owner / address / parcel-ID search with type-ahead
from recent visits, elevation contour overlay, lasso + ruler tools,
computed insight badges, save / recent parcels (localStorage),
server-side enriched property data (buildings, valuations, sales
history, linked entities), URL permalinks, PDF/PNG export, and an
`@media print` parcel-handout layout.

Repo and Cloudflare Pages project keep the legacy `tn-land-atlas` name.
The user-facing brand is **Holston Scout**, a vertical of the Holston Intel
platform.

Live: <https://tn-land-atlas.pages.dev>

## Stack

- Vite 8 + React 19 + TypeScript strict (project refs for app / node / functions)
- MapLibre GL JS 5
- maplibre-contour, terra-draw, @watergis/maplibre-gl-export
- Tailwind CSS v4 with `@theme` tokens (HolstonBuilder family — Inter throughout, system monospace stack for data; palette: `bg #02040A`, `surface #0F1729`, `brand #F59E0B`, `text-primary #F8FAFC`)
- ArcGIS REST (Johnson City) for live parcel polygons
- Supabase REST for enriched data — server-side only via Pages Functions
- Cloudflare Pages + Pages Functions
- Playwright for E2E (~50+ tests x 3 viewports), Vitest for unit tests across
  `src/lib/{insights,permalink,lazyRetry}.ts` (60+ cases)

## Quick start

```bash
cd ~/tn-land-atlas
npm install
npm run dev                                   # Vite only, http://localhost:5173
# full-stack including /api/* routes:
npm run build && npx wrangler pages dev dist  # http://localhost:8788
```

Supabase secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) live on the Cloudflare
Pages dashboard (Production + Preview). They are read by
`functions/api/property.ts` only and never shipped to the browser. Without
them, the property panel still renders the ArcGIS attributes — it just
skips the enriched buildings / sales / entities sections.

## Features

### Search
Type an owner name, address, or parcel ID. The map frames every match and
a result panel lists each one (owner / address / county / acres / parcel
ID). Tap a row to fly to that parcel and open the detail sidebar. List
caps at 200 rows out of up to 2000 — refine the query to narrow.

### Bottom action bar
Universal across desktop / tablet / mobile. Five buttons, all >= 56px tall
(WCAG 2.5.5 AAA, iOS HIG, Material 3):

- **Layers** — opens a popover with the basemap chooser (Satellite /
  Streets / Topographic / Hybrid) and the **Contour lines** overlay
  toggle (50 ft minor / 200 ft major at z13, finer at z14+; public
  Mapzen Terrarium DEM). Adding a new source must clear AGENTS.md
  rule #7 (bounds, CSP, attribution, zoom probe).
- **Tools** — opens a popover with **Lasso** (draw a polygon, find
  every parcel inside) and **Ruler** (haversine distance in feet/miles).
  While a draw mode is active, the parent button echoes the active
  mode in its icon and label.
- **Filter** — opens a native `<dialog>` with the computed-insight
  filters. Active count appears in the button label.
- **Locate** — triggers the GeolocateControl (caps zoom at 17 so users
  land with a few blocks of context, not eyeballs-on-asphalt). Pulses
  in amber while acquiring; clears on either resolve or error.
- **Home** — fly back to overview at z11.

### Computed insights (Property detail panel)
Every indicator is a pure function over data we have. No hardcoded
answers. Pure functions live in `src/lib/insights.ts` with vitest
coverage in `src/lib/insights.test.ts`.

| Indicator | Math |
|---|---|
| `$/ac` | APPRAISAL / CALC_ACRE |
| Years held | (now - SALEDATE) / 365.25 |
| Holding tier | `< 2y` recent, `< 15y` established, `< 30y` long-held, else generational |
| Acreage tier | `< 0.25` lot, `< 1` residential, `< 5` country, `< 25` small, `< 100` medium, else large |
| Sale-to-appraisal % | PRICE / APPRAISAL |
| Owner-occupied vs absentee | parcel addr number ∈ mail addr AND city match AND state == TN |
| Out-of-state owner | mailing STATE != TN |
| Entity-owned | OWNER name regex (LLC, INC, LP, TRUST, CORP, FOUNDATION, CHURCH, GOV) |
| Centroid | shoelace polygon centroid (handles MultiPolygon) |
| Distance | haversine (R = 6371000 m) |

The detail panel renders only the badges that compute true. Quick-action
buttons open Apple Maps / Google Maps / Street View at the centroid, and
"More by `<owner-token>`" runs a search for that owner.

### Filter sheet
Native `<dialog>.showModal()` (built-in focus trap, Escape to dismiss,
backdrop click to close). Five toggle switches + minimum-acres input. All
filters AND together and run client-side via `passesFilters()` over the
last-loaded snapshot — no extra API roundtrips.

- Entity-owned (LLC / INC / TRUST / CORP / FOUNDATION / CHURCH / GOV)
- Out-of-state owner
- Absentee owner
- Recent sale (≤ 5 yrs)
- Long-held (≥ 20 yrs)
- Minimum acres

### URL permalinks
The map view (`?lng=&lat=&z=`) and selected parcel (`?parcel=<GISLINK>`)
round-trip through the URL via `replaceState`. Reload, bookmark, share —
same view. The Share button in the detail sidebar copies the live URL.

### Export
The MapLibre native bottom-right cluster includes a printer icon that
opens a panel for PDF / PNG / JPG / SVG export at 300 DPI of the current
view.

## API (Cloudflare Pages Functions)

| Endpoint | Method | Body / Query | Returns |
|---|---|---|---|
| `/api/parcels` | POST | `{ west, south, east, north, county }` OR `{ polygon: [[lng,lat],...], county }` | GeoJSON FeatureCollection |
| `/api/parcel`  | GET  | `?key=<GISLINK>` | Single GeoJSON Feature, or 404 |
| `/api/search`  | POST | `{ query, county }` | GeoJSON FeatureCollection (owner / address / GISLINK LIKE match) |
| `/api/property`| POST | `{ parcelKey }` | `{ buildings, valuation, sales, entities }` |

All endpoints validate inputs at the edge through `functions/api/_validate.ts`:

- `county` ∈ `{ ALL, Sullivan, Washington, Carter }`
- `query` matches `^[a-zA-Z0-9 .,'#&\-/]{2,80}$`; LIKE wildcards stripped
- `bbox` lies inside a TN superset (lon -90.5..-81.5, lat 34.5..37.0)
- `polygon` is 4..200 vertices, every point inside the TN superset
- `parcelKey` reuses the same charset rules as `query`

Anything else returns `400` with a tagged `{ error }`.

ArcGIS upstream errors are logged with the response body via
`console.error('[parcels:bbox] ArcGIS', status, body)` (Cloudflare Logs
Push picks these up); clients see a generic `502 Upstream error`.

## Security

`public/_headers` applies these to every response:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy` with explicit `default-src 'self'`,
  `connect-src` whitelist of every upstream the app talks to, and
  `frame-ancestors 'self'`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` locking unused features (mic, camera, USB, payment, ...)

Hashed assets (`/assets/*`) get `Cache-Control: public, max-age=31536000, immutable`. The `index.html` shell is `must-revalidate` so users always
load the latest hashed bundle.

## Testing

```bash
npm test                                                  # vitest, 80 cases (insights, permalink, lazyRetry, ownerSearchTerm)
npm run lint                                              # eslint
npm run build                                             # tsc -b + vite build
npm run test:e2e                                          # Playwright via 'wrangler pages dev' locally
BASE_URL=https://tn-land-atlas.pages.dev npm run test:e2e # against production
npx playwright test --repeat-each=3                       # flake check (3 runs = 189 tests)
```

External security probes that should hold after any API change:

```bash
curl -X POST https://tn-land-atlas.pages.dev/api/search \
  -H 'content-type: application/json' \
  -d '{"query":"x'"'"' OR 1=1--"}'                       # 400 Invalid query

curl -X POST https://tn-land-atlas.pages.dev/api/parcels \
  -H 'content-type: application/json' \
  -d '{"west":-82.4,"south":36.3,"east":-82.3,"north":36.4,"county":"DROP"}'   # 400 Invalid county

curl -X POST https://tn-land-atlas.pages.dev/api/property \
  -H 'content-type: application/json' \
  -d '{"parcelKey":"x'"'"' OR 1=1--"}'                  # 400 Invalid parcelKey
```

## File map

```
public/
  _headers              security headers, cache rules (Cloudflare Pages reads at deploy)
  _routes.json          bypass SPA fallback for static files (robots, sitemap, etc.)
  robots.txt
  sitemap.xml
  manifest.json         PWA manifest
  favicon.svg
  og-image.svg          1200x630 share preview

src/
  App.tsx               <HolstonChrome><ErrorBoundary><Suspense><ParcelMap />
  main.tsx              React root, imports index.css
  index.css             @theme tokens (HolstonBuilder family — Inter throughout,
                        system monospace stack), MapLibre overrides, instrument-grade
                        controls, backdrop-filter @supports fallback, @media print
                        parcel-handout layout, prefers-reduced-motion, data-value /
                        data-label utilities
  components/
    HolstonChrome.tsx   top chrome bar (48-52px) — wordmark + Survey Corner mark
    SurveyCornerMark.tsx geometric brand mark; three lockups
    ParcelMap.tsx       main map, search, detail sidebar, bottom action bar,
                        Tools popover, FilterSheet, ParcelInsights, drawing tools,
                        corner-node markers on selected parcels
    MapLoadingShell.tsx graduated 4-stage loading shell with Survey Corner pulse
    MapErrorFallback.tsx branded error UI (used by react-error-boundary)
    ui/{button,card}.tsx shadcn-style primitives
  lib/
    api.ts              typed fetch wrappers for /api/*
    arcgis.ts           ParcelProperties / ParcelFeature / ParcelCollection types
    draw.ts             Terra Draw lifecycle helpers + haversine ruler
    insights.ts         pure indicator functions (price/ac, holding-yrs, entity, ...)
    insights.test.ts    80 vitest cases (insights + permalink + lazyRetry + ownerSearchTerm)
    lazyRetry.ts        dynamic-import wrapper with one-shot reload (stale-chunk recovery)
    permalink.ts        URL <-> { view, parcelKey } (replaceState only)
    supabase-queries.ts enriched-data type definitions (no runtime client)
    utils.ts            cn(), fmtMoney() (handles 0), fmtDate() (handles NaN)
  types/global.d.ts     window.__map__ for E2E only

functions/api/
  _validate.ts          county / bbox / query / polygon whitelists
  parcels.ts            POST -> ArcGIS (bbox or polygon spatial filter)
  parcel.ts             GET  -> ArcGIS (single feature by GISLINK; permalink resolver)
  search.ts             POST -> ArcGIS LIKE on OWNER / ADDRESS / GISLINK
  property.ts           POST -> Supabase parallel reads, UUID-validated entity joins

e2e/map.spec.ts         ~50+ tests x 3 viewports (chromium-desktop/-tablet/-mobile)

CLAUDE.md / AGENTS.md   project conventions and rules for AI agents
```

## Deploying

```bash
npm run build
npx wrangler pages deploy dist --project-name tn-land-atlas --branch main
```

Auto-deploy from `main` push isn't wired — manual deploy after merge.
