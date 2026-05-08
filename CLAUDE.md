# TN Land Atlas

Parcel mapping for Sullivan, Washington, and Carter counties.

## Stack
- Vite 8 + React 19 + TypeScript (strict, project references for app / functions / node)
- MapLibre GL JS 5
- Tailwind CSS v4 + shadcn/ui (Button, Card)
- ArcGIS REST (Johnson City) for live parcel polygons
- Supabase for enriched property data (server-side only)
- Cloudflare Pages + Pages Functions
- Playwright for E2E (33 tests across 3 viewports)

## Live
- Prod: https://tn-land-atlas.pages.dev
- Repo: https://github.com/getboring/tn-land-atlas
- CF Pages project: tn-land-atlas

## Commands
```
npm run dev                                     Vite only, port 5173
npm run build                                   tsc -b (app + node + functions) && vite build
npm run preview                                 preview built bundle
npm run lint                                    eslint .
npm run test:e2e                                Playwright (uses webServer in playwright.config)
BASE_URL=https://tn-land-atlas.pages.dev npm run test:e2e   against prod
```

`tsc -b` checks three project refs:
- `tsconfig.app.json` -> src
- `tsconfig.node.json` -> vite.config.ts
- `tsconfig.functions.json` -> functions (uses @cloudflare/workers-types)

## File map
```
src/
  App.tsx, main.tsx, index.css
  components/ParcelMap.tsx       main map + sidebar + top bar
  components/ui/{button,card}.tsx
  lib/
    api.ts                       typed fetch wrappers for /api/*
    arcgis.ts                    ParcelProperties / ParcelFeature / ParcelCollection types
    supabase-queries.ts          enriched-data types (no runtime client)
    utils.ts                     cn(), fmtMoney(), fmtDate()
  types/global.d.ts              window.__map__ augmentation for E2E
functions/api/
  _validate.ts                   county whitelist, bbox bounds, query charset
  parcels.ts                     POST -> ArcGIS bbox, 5m edge cache
  search.ts                      POST -> ArcGIS owner/address/GISLINK LIKE
  property.ts                    POST -> Supabase parallel reads, 30s cache
e2e/map.spec.ts                  33 tests x 3 viewports
```

## Architecture notes
- `lib/api.ts` calls `/api/*` only -- no client-side Supabase fallback.
  When the Pages project doesn't have `SUPABASE_URL` / `SUPABASE_ANON_KEY` set,
  `/api/property` returns empty arrays. Map data still renders from ArcGIS.
- All API inputs validated at the edge in `functions/api/_validate.ts`:
  county whitelist, charset/length-bounded query (LIKE wildcards stripped),
  bbox restricted to a TN superset.
- Map exposes itself as `window.__map__` for E2E tests only. Typed in
  `src/types/global.d.ts`. Do not consume in app code.
- Parcels render only at `zoom >= 13` to keep payloads sane.
- `moveend` is debounced 250ms before fetching parcels.
- The map's persistent event handlers (load / moveend / click) read
  `loadRef.current` / `selectRef.current` so they always see the latest
  callback closure, not the one from first render.

## Gotchas (load-bearing)

### MapLibre overrides Tailwind `position: absolute`
The `.maplibregl-map` class sets `position: relative` at the same specificity
as Tailwind's `.absolute`. Whichever stylesheet loads later wins, and in this
build maplibre wins -- collapsing the container to `height: 0`. The map
appears to "load" (sources, layers, click handlers all work) but the canvas
only renders ~300px tall.

**Fix:** the map container uses inline `style={{ position: 'absolute', inset: 0 }}`
(inline always wins over a class rule).

**Guarded by:** the E2E test "map container fills the viewport" -- asserts
`containerH > viewport * 0.6`.

### USGS NAIP tiles 404 above zoom 16
`basemap.nationalmap.gov/.../USGSImageryOnly/MapServer` advertises LODs
through z23 in its tile metadata, but actual coverage for East TN stops at
z16. The source is pinned `maxzoom: 16` so MapLibre over-zooms instead of
issuing failing requests.

### Programmatic `m.fire('click', ...)` is unreliable
Layer-scoped click handlers (`map.on('click', 'parcels-fill', ...)`) only
fire reliably from real DOM clicks that go through hit-testing. Programmatic
`m.fire('click')` works on desktop sometimes and fails on tablet/mobile. E2E
tests center the map on a parcel centroid then `page.mouse.click()` the
canvas center.

### ResizeObserver is required
`trackResize: true` only watches the window. When the map container itself
changes size (responsive layout shift, sidebar opening), MapLibre doesn't
notice. We attach a `ResizeObserver` to the container and call `m.resize()`
on changes.

### `wrangler.toml` env shadowing
Declaring `SUPABASE_URL = ""` under `[env.production.vars]` in wrangler.toml
shadows the dashboard-set value at deploy time and silently disables enriched
data. Don't add empty placeholders there. Secrets are dashboard-only.

## Roadmap
- Code-split MapLibre (currently 1.27MB bundle, gzipped 348KB)
- Drawing tools (lasso, ruler) for field comping
- Replace NAIP fallback with a different imagery source above z16
- Add a GET `/api/property/:gislink` for cacheable enrichment
