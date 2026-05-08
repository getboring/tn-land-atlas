# TN Land Atlas

Parcel mapping for Sullivan, Washington, and Carter counties.

## Stack
- Vite 8 + React 19 + TypeScript strict (project refs for app / node / functions)
- MapLibre GL JS 5
- maplibre-contour (elevation), terra-draw (lasso/ruler), @watergis/maplibre-gl-export (PDF/PNG)
- Tailwind CSS v4 + shadcn-style primitives (Button, Card)
- ArcGIS REST (Johnson City) for live parcel polygons
- Supabase REST for enriched data — server-side only via Pages Functions
- Cloudflare Pages + Pages Functions
- Playwright (~48 tests x 3 viewports) for E2E
- Vitest (55 cases) for `src/lib/insights.ts` math

## Live
- Prod: https://tn-land-atlas.pages.dev
- Repo: https://github.com/getboring/tn-land-atlas
- CF Pages project: tn-land-atlas

## Commands
```
npm run dev                                                   Vite only, port 5173
npm run build                                                 tsc -b (3 refs) && vite build
npm run preview                                               serve dist/
npm run lint                                                  eslint .
npm test                                                      vitest (insights math)
npm run test:watch                                            vitest watch
npm run test:e2e                                              Playwright (uses local webServer)
BASE_URL=https://tn-land-atlas.pages.dev npm run test:e2e     E2E against prod
```

`tsc -b` checks three project refs:
- `tsconfig.app.json` -> src
- `tsconfig.node.json` -> vite.config.ts
- `tsconfig.functions.json` -> functions (uses @cloudflare/workers-types)

## File map
```
public/
  _headers                   security headers + cache rules
  _routes.json               bypass SPA fallback for static files
  robots.txt, sitemap.xml, manifest.json, favicon.svg, og-image.svg

src/
  App.tsx                    <ErrorBoundary><Suspense><ParcelMap /></...
  main.tsx, index.css
  components/
    ParcelMap.tsx            main map, search, detail panel, bottom action
                             bar, Tools popover, FilterSheet, ParcelInsights
    ErrorBoundary.tsx        recovery UI on render error
    ui/{button,card}.tsx
  lib/
    api.ts                   typed fetch for /api/*
    arcgis.ts                ParcelProperties / ParcelFeature / ParcelCollection
    draw.ts                  Terra Draw lifecycle helpers, haversine ruler
    insights.ts              pure indicator functions ($/ac, holding, entity, ...)
    insights.test.ts         55 vitest cases
    permalink.ts             URL <-> { view, parcelKey } via replaceState
    supabase-queries.ts      enriched-data types (no runtime client)
    utils.ts                 cn(), fmtMoney() (handles 0), fmtDate() (handles NaN)
  types/global.d.ts          window.__map__ for E2E
functions/api/
  _validate.ts               county / bbox / query / polygon whitelists
  parcels.ts                 POST -> ArcGIS (bbox or polygon spatial filter)
  parcel.ts                  GET  -> single feature by GISLINK (permalink resolver)
  search.ts                  POST -> ArcGIS LIKE on OWNER / ADDRESS / GISLINK
  property.ts                POST -> Supabase parallel reads (UUID-validated joins)
e2e/map.spec.ts              48 tests x 3 viewports
```

## Architecture notes

### Bottom action bar (the menu system)
Universal across desktop / tablet / mobile. Five buttons (Topo / Tools /
Filter / Locate / Reset), each 64x56 (exceeds iOS HIG 44pt and Material 3
48dp). Backdrop-blur frosted look. `safe-area-inset-bottom` clears the
iOS home indicator.

### Tools popover
Tapping Tools opens an inline popover above the bar with Lasso (polygon),
Ruler (line), and a Cancel button (only when there's something to cancel).

### Filter sheet
Native HTMLDialogElement (`showModal()`) gives focus trap, Escape-to-
close, and backdrop dismissal for free. Toggles for Entity / Out-of-state
/ Absentee / Recent sale (≤5y) / Long-held (≥20y) plus a min-acres input.
All filters AND together and run client-side via `passesFilters()` over
the last-loaded snapshot — no extra API roundtrips.

### Insights are pure functions
Every computed indicator (price/ac, years held, owner-occupied, entity
detection, centroid, distance, ...) lives in `src/lib/insights.ts` as a
pure function with vitest coverage. The detail panel renders only the
badges that compute true. Add new indicators by writing the function +
test, then wiring into ParcelInsights.

### Permalinks
`src/lib/permalink.ts` parses and writes `?lng=&lat=&z=&parcel=`.
- Map view sync uses `replaceState` (no history pollution per pan/zoom).
- Selecting / deselecting a parcel updates the URL.
- Loading with `?parcel=<gislink>` resolves via `GET /api/parcel?key=...`
  and selects/flies-to in the resolution effect.

### API hygiene
- `lib/api.ts` calls `/api/*` only — no client-side Supabase fallback.
- All API inputs validated at the edge in `functions/api/_validate.ts`:
  county whitelist, charset/length query, bbox + polygon bounded to TN
  superset, ArcGIS query escaped via doubled single quotes.
- ArcGIS upstream errors get logged with response body via console.error;
  client gets a generic `502 Upstream error`.
- `property.ts` validates each `entity_id` from Supabase as a UUID before
  joining into a URL — defense in depth.
- Map exposes itself as `window.__map__` for E2E tests only. Don't read
  in app code.
- Parcels render only at `zoom >= 13`; `moveend` debounced 250ms.
- The map's persistent event handlers (load / moveend / click) read
  `loadRef.current` / `selectRef.current` so they always see the latest
  callback closure.

### Security headers
Set in `public/_headers` (Cloudflare Pages reads at deploy):
- HSTS 2y preload
- CSP with explicit connect-src whitelist of every upstream
- X-Frame-Options SAMEORIGIN, frame-ancestors 'self'
- Permissions-Policy locking unused features (mic, camera, USB, ...)
- Referrer-Policy strict-origin-when-cross-origin
- /assets/* immutable cache, / and /index.html no-cache

## Gotchas (load-bearing)

### MapLibre overrides Tailwind `position: absolute`
The `.maplibregl-map` class sets `position: relative` at the same
specificity as Tailwind's `.absolute`. The map container uses inline
`style={{ position: 'absolute', inset: 0 }}` so inline-wins-over-class.
Don't switch back to className. Guarded by the E2E "map container fills
the viewport" test.

### Programmatic `m.fire('click', ...)` is unreliable
Layer-scoped click handlers fire from real DOM clicks, not synthetic
events. E2E tests center the map on a parcel centroid then call
`page.mouse.click()` at canvas center.

### ResizeObserver is required
`trackResize: true` only watches the window. When the map container
itself changes size (responsive layout shift, panel opening), MapLibre
doesn't notice. We attach a `ResizeObserver` and call `m.resize()`.

### `wrangler.toml` env shadowing
Declaring `SUPABASE_URL = ""` under `[env.production.vars]` shadows the
dashboard-set value at deploy time and silently disables enriched data.
Don't put secrets in wrangler.toml.

### MapLibre native control sizes
Library defaults are 29x29 (below WCAG 2.5.5 AA). `index.css` overrides
to 40x40 via `.maplibregl-ctrl-group button { width: 40px; height: 40px }`.

### Bottom action bar vs MapLibre native cluster
Both want the bottom-right of the map. `index.css` pushes
`.maplibregl-ctrl-bottom-right` to `bottom: 5.5rem` and
`.maplibregl-ctrl-bottom-left` to `bottom: 0.25rem` so they stack above
the action bar instead of overlapping.

### iOS Safari auto-zoom on focus
Inputs with `font-size < 16px` trigger auto-zoom on focus. Search and
min-acres inputs use `text-base sm:text-sm` — 16px on mobile, 14px on
tablet+ for density.

## Roadmap (open ideas)
- Service worker / offline mode for rural-TN field workers
- Sentry / Cloudflare Web Analytics integration
- Refactor ParcelMap.tsx into smaller files (currently ~1100 lines, OK but big)
- More insights from Supabase: building density, sales velocity, deed-book chain
- Saved searches / favorites (requires auth)
