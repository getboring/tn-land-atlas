# TN Land Atlas

Real-estate parcel mapping for Sullivan, Washington, and Carter counties.

## Stack
- Vite + React 19 + TypeScript (strict)
- MapLibre GL JS 5
- Tailwind CSS v4
- shadcn/ui primitives (Button, Card)
- ArcGIS REST (Johnson City) — live parcel polygons
- Supabase (`asfyqdscagjlkpjjrdxw`) — buildings, valuations, sales, entities
- Cloudflare Pages + Pages Functions
- Playwright (E2E)

## Live
- Prod: https://tn-land-atlas.pages.dev
- Repo: https://github.com/getboring/tn-land-atlas
- CF Pages project: `tn-land-atlas`

## Commands
```
npm run dev                  # Vite only, port 5173
npm run build                # tsc -b && vite build
npm run preview              # preview built bundle
npm run deploy               # wrangler pages deploy dist
npm run test:e2e             # Playwright (uses webServer in playwright.config)
BASE_URL=https://tn-land-atlas.pages.dev npm run test:e2e   # against prod
```

## File map
```
src/
  components/ParcelMap.tsx    main map + sidebar + controls
  components/ui/              Button, Card
  lib/api.ts                  POSTs to /api/* with fallback to direct calls
  lib/arcgis.ts               direct ArcGIS query helpers (fallback path)
  lib/supabase.ts             lazy-init typed client
  lib/supabase-queries.ts     buildings/valuation/sales/entities
  lib/utils.ts                cn(), fmtMoney(), fmtDate()
functions/api/
  parcels.ts                  POST -> ArcGIS bbox query, edge-cached
  search.ts                   POST -> ArcGIS owner/address LIKE
  property.ts                 POST -> Supabase parallel reads
e2e/map.spec.ts               33 tests across 3 viewports
```

## Architecture notes
- `lib/api.ts` always tries `/api/*` first, falls back to direct call so `npm run dev` (Vite-only, no Functions) still works.
- Supabase client is lazy-initialised — missing env vars do not crash the app, calls just return empty.
- Map exposes itself as `window.__map__` for E2E tests. Don't rely on this in app code.
- Parcels render only at `zoom >= 13` to keep payloads sane.
- `moveend` is debounced 250ms before fetching parcels.

## Gotchas (load-bearing)

### MapLibre overrides Tailwind `position: absolute`
The `.maplibregl-map` class sets `position: relative` at the same specificity as Tailwind's `.absolute`. Whichever stylesheet loads later wins, and in this build maplibre wins — collapsing the container to `height: 0`. The map appears to "load" (sources, layers, click handlers all work) but the canvas only renders ~300px tall.

**Fix:** the map container uses inline `style={{ position: 'absolute', inset: 0 }}` (inline always wins over a class rule). Do not change to `className="absolute inset-0"`.

**Guarded by:** the E2E test `map container fills the viewport` — asserts `containerH > viewport * 0.6`.

### USGS NAIP tiles 404 above zoom 16
`basemap.nationalmap.gov/.../USGSImageryOnly/MapServer` advertises LODs through z23 in its tile metadata, but actual coverage for East TN stops at z16. We pin the source's `maxzoom: 16` so MapLibre over-zooms instead of issuing failing requests.

### Programmatic `m.fire('click', ...)` is unreliable
Layer-scoped click handlers (`map.on('click', 'parcels-fill', ...)`) only fire reliably from real DOM clicks that go through hit-testing. Programmatic `m.fire('click')` works on desktop sometimes and fails on tablet/mobile. E2E tests center the map on a parcel centroid then `page.mouse.click(canvasCenter)`.

### ResizeObserver is required
`trackResize: true` only watches the window. When the map container itself changes size (e.g. responsive layout shift, sidebar opening), MapLibre doesn't notice. We attach a `ResizeObserver` to the container and call `m.resize()` on changes.

## Roadmap
- Add `/api/property/:gislink` GET (cacheable) instead of POST
- Code-split MapLibre (currently 1.27MB bundle, gzipped 348KB)
- Support drawing tools (lasso, ruler) for field comping
- Wire NAIP fallback to a different imagery source above z16
