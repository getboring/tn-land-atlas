# Holston Scout

Pre-construction parcel intelligence for Sullivan, Washington, and Carter
counties in East Tennessee. Tagline: "Scout the ground. Know the build."
Parent brand: Holston Intel.

(Repo and Cloudflare Pages project keep the legacy `tn-land-atlas` name;
the user-facing brand is **Holston Scout**.)

## Stack
- Vite 8 + React 19 + TypeScript strict (project refs for app / node / functions)
- MapLibre GL JS 5
- maplibre-contour (elevation), terra-draw (lasso/ruler), @watergis/maplibre-gl-export (PDF/PNG)
- Tailwind CSS v4 + shadcn-style primitives (Button, Card)
- ArcGIS REST (Johnson City) for live parcel polygons
- Supabase REST for enriched data — server-side only via Pages Functions
- Cloudflare Pages + Pages Functions
- Playwright (63 tests x 3 viewports = 189 runs) for E2E
- Vitest (170+ cases) across `src/lib/{insights,permalink,lazyRetry,build-fit}.ts` and `ownerSearchTerm`

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
  App.tsx                    <HolstonChrome><ErrorBoundary><Suspense><ParcelMap />
  main.tsx, index.css
  components/
    HolstonChrome.tsx        top chrome — wordmark + Survey Corner mark + slots
    SurveyCornerMark.tsx     geometric brand mark, three lockups
    ParcelMap.tsx            main map, search, detail panel, bottom action bar,
                             Tools popover, FilterSheet, ParcelInsights
    MapLoadingShell.tsx      graduated 4-stage loading shell
    MapErrorFallback.tsx     branded error UI (used by react-error-boundary)
    ui/{button,card}.tsx     shadcn-style primitives
  lib/
    api.ts                   typed fetch for /api/*
    arcgis.ts                ParcelProperties / ParcelFeature / ParcelCollection
    draw.ts                  Terra Draw lifecycle helpers, haversine ruler
    insights.ts              pure indicator functions ($/ac, holding, entity, ...)
    insights.test.ts         insights cases (170+ total across all vitest suites including build-fit)
    lazyRetry.ts             dynamic-import wrapper with one-shot reload
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
e2e/map.spec.ts              63 tests across 3 viewports (189 runs)
```

## Brand system (Holston Scout — converted to HolstonBuilder family)

Scout was rebranded from a navy/parchment/copper "luxurious" palette to
the HolstonBuilder design family — same product line, same parent.
When HolstonBuilder updates a token, mirror it here.

Identity is centralized in three surfaces:

- **`HolstonChrome`** — top bar (48px mobile, 52px desktop). Holds the
  wordmark + Survey Corner mark. Center/right slots are reserved for
  future search and auth integration. The map fills the remaining
  viewport via `flex-1`.
- **`SurveyCornerMark`** — single SVG master used at every size from
  16px favicon through 1200px share image. Three lockups: inline
  (chrome wordmark), app-icon (with bg ring), one-color fallback.
  Outline = `#334155` border-default, accent = `#F59E0B` brand.
- **`@theme` tokens** in `index.css` — HolstonBuilder palette
  (`bg #02040A`, `surface #0F1729`, `surface-elevated #1A2332`,
  `text-primary #F8FAFC`, `text-secondary #CBD5E1`,
  `text-tertiary #94A3B8`, `brand #F59E0B`, `brand-strong #FCD34D`,
  `stamp #DC2626`, `danger #F87171`) + Inter as the single type
  family (sans + display) + system mono. Map-role tokens:
  `map-parcel-default` = `text-tertiary` (#94A3B8 calm slate),
  `map-parcel-hover` = `brand-strong` (#FCD34D),
  `map-parcel-selected` = `brand` (#F59E0B).

Map state is the brand's most distinctive surface:
- Default outline: slate at 0.6 opacity (calm USGS-quad posture)
- Hover: brand-strong outline + brand fill at 0.14 alpha (feature-state)
- Selected: brand outline + brand fill at 0.24 alpha + corner-node
  markers (text-primary fill, bg stroke at every polygon vertex —
  the Survey Corner mark in miniature)

Numerics use the `data-value` utility (system monospace + tabular-nums).
Caps labels use `data-label`.

## Architecture notes

### Bottom action bar (the menu system)
Universal across desktop / tablet / mobile. Five buttons (Layers / Tools
/ Filter / Locate / Home), each 64x56 (exceeds iOS HIG 44pt and Material
3 48dp). Backdrop-blur frosted look. `safe-area-inset-bottom` clears the
iOS home indicator.

### Layers popover
Tapping Layers opens a popover above the bar. Top half is the basemap
chooser (4 radio-style pills: Satellite / Streets / Topographic /
Hybrid). Bottom half is overlays — currently Contour lines as a switch
(role=switch, aria-checked). Mutually exclusive with the Tools popover
so they don't fight over the same vertical slot. Visibility is toggled
via `setLayoutProperty('id', 'visibility', …)`, never `setStyle()` —
see AGENTS.md rule #7 for the four-check covenant for adding a new
basemap or overlay source.

### Tools popover
Tapping Tools opens an inline popover above the bar with Lasso (polygon),
Ruler (line), and a Cancel button (only when there's something to cancel).
While a draw mode is active, the parent Tools button echoes the active
mode in its icon + label (Lasso / Ruler) and stays in pressed state.

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
