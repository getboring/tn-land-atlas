# Agent Rules — TN Land Atlas

Guardrails for AI coding agents working in this repo. Modeled on the Convex
AI rules pattern but specific to this stack: Vite + React 19 + MapLibre on
Cloudflare Pages with Pages Functions and Supabase REST.

If you (the agent) violate one of these rules, you are introducing a known
class of bug that has already been hunted down once. Don't.

## Stack (do not change without explicit user approval)

- **Frontend:** Vite 8, React 19, TypeScript strict, Tailwind v4, shadcn/ui primitives
- **Map:** MapLibre GL JS 5
- **API:** Cloudflare Pages Functions (`PagesFunction` handlers in `functions/api/`)
- **Live parcels:** Johnson City ArcGIS REST (`gis.johnsoncitytn.org`)
- **Enriched data:** Supabase REST, **server-side only**
- **Lint/format:** Biome is **not** used here — ESLint + typescript-eslint are
- **Tests:** Playwright (33 tests x 3 viewports)

This is a Cloudflare-Pages project, not a Workers/D1/Hono/better-auth project.
Don't suggest migrating to a different shell.

## Hard rules

### 1. All writes / queries to user input go through validators
Every Pages Function that accepts user input MUST call validators from
`functions/api/_validate.ts` before building any ArcGIS / Supabase URL:

- `validateCounty(input)` returns one of `'ALL' | 'Sullivan' | 'Washington' | 'Carter'` or `null`
- `validateBbox(west, south, east, north)` returns the four numbers if inside the TN superset, else `null`
- `validateQuery(input)` returns the trimmed string if it matches `^[a-zA-Z0-9 .,'#&\-/]{2,80}$` (LIKE wildcards stripped), else `null`

Any `null` return MUST produce a `400` response. Do not pass unvalidated input
to ArcGIS or Supabase. Single-quote escaping (`replace(/'/g, "''")`) is the
last line of defense, not the first — keep both layers.

### 2. Supabase access is server-only
- The `@supabase/supabase-js` runtime client is **not** a dependency. Don't add it back.
- Anything in `src/lib/supabase-queries.ts` is **types-only**. Do not put runtime fetch logic in there.
- All Supabase access goes through `functions/api/property.ts`.
- Secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) live on the Cloudflare Pages
  dashboard. Do not put them in `wrangler.toml`'s `[env.*.vars]` — empty
  strings there silently shadow dashboard values at deploy time.
- Do not add `VITE_SUPABASE_*` env vars. Vite inlines those into the browser
  bundle, defeating the point of the proxy.

### 3. The map container uses inline positioning
The map container `<div ref={mapContainer}>` MUST use inline
`style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}`,
not `className="absolute inset-0"`.

**Why:** MapLibre injects `.maplibregl-map { position: relative }` after
mount. At equal CSS specificity, the later-loaded rule wins. With Tailwind's
`.absolute` class, MapLibre can win and collapse the container to
`height: 0`. Inline styles always beat class rules. There's an E2E test
("map container fills the viewport") that asserts container height > 60% of
viewport — don't disable it.

### 4. The map container needs a ResizeObserver
`trackResize: true` only watches the window. When the container itself
changes size (responsive breakpoint, sidebar opening), MapLibre doesn't
notice. Keep the `ResizeObserver` -> `m.resize()` wiring in `ParcelMap.tsx`.

### 5. Long-lived map handlers read from refs, not closures
The `m.on('load' | 'moveend' | 'click', ...)` handlers are registered once
and live for the map's lifetime. They MUST invoke `loadRef.current(...)` /
`selectRef.current(...)`, not `loadParcelsForViewport` / `selectParcel`
directly. Direct calls capture the first render's closure and miss state
updates (e.g. `activeCounty` changes). The refs are kept current by an
effect in `ParcelMap.tsx`.

### 6. tsconfig must include the functions project ref
`tsconfig.json` MUST reference `tsconfig.functions.json`. Without it,
`npm run build` runs `tsc -b` only over `src/` and `vite.config.ts`, and
TypeScript errors in `functions/` go undetected. The Cloudflare Pages
deploy bundles `functions/` to JS without type-checking — if the local
build doesn't check it, nothing does.

### 7. NAIP source is capped at zoom 16
USGS `USGSImageryOnly` advertises LODs through z23 but has no East-TN
tiles above z16. The source MUST set `maxzoom: 16` so MapLibre over-zooms
instead of issuing failing tile requests. Don't bump it. If you switch to
a different imagery provider, verify zoom coverage with curl probes first.

### 8. Parcels load only at zoom >= 13
At lower zooms the bbox covers thousands of parcels and the response is too
large to be useful. The `loadParcelsForViewport` callback returns early
under z13 and clears the GeoJSON source. Don't lower this without a UX
reason — bandwidth on rural mobile is a constraint.

### 9. AbortError is silent, real errors log
Viewport changes abort the in-flight parcel request on every move. The
catch block MUST distinguish abort from real failures via `isAbortError(e)`
in `ParcelMap.tsx`. Log real errors with a tag (`'[parcels]'`,
`'[search]'`, `'[property]'`) — never `console.log` without context, never
swallow silently.

### 10. Tap targets are at least 40px on the primary controls
Top-bar buttons, search input, search button, recenter, X close — all
`h-10` (40px) or `w-10 h-10` for icon buttons. County pills are `h-9`.
Search-result rows are `min-h-[64px]`. WCAG 2.5.5 AA. Don't shrink them
to fit more chrome on screen.

### 11. ArcGIS geometry can be MultiPolygon
Even though `ParcelFeature.geometry` is typed as `Polygon`, ArcGIS
occasionally returns MultiPolygon for parcels split across waterways or
roads. Use `featureBounds` / `unionBounds` from `ParcelMap.tsx` for any
bounds calculation — they walk both shapes and filter NaN. Never
hand-roll `coords.map(c => c[0])` on `geometry.coordinates[0]`; it crashes
on MultiPolygon.

### 12. Map exposure for E2E only
`window.__map__` exists for Playwright tests via the typed augmentation in
`src/types/global.d.ts`. App code MUST NOT read it. If you need the map
elsewhere, use the existing `map.current` ref.

### 13. Tests use real DOM clicks for parcel selection
`m.fire('click', ...)` does not reliably fire layer-scoped click handlers
across viewports. E2E tests center the map on a parcel centroid, then call
`page.mouse.click(canvasCenter)`. Don't switch to programmatic firing.

### 14. Money is integer cents — but ArcGIS gives whole dollars
Parcel `APPRAISAL` and `PRICE` come from ArcGIS as **whole dollars**, not
cents. `fmtMoney` in `src/lib/utils.ts` formats whole dollars. Don't divide
by 100. If you add a write path that stores money, store it in cents and
add a separate formatter — don't reuse `fmtMoney`.

### 15. The search results panel caps at 200 rendered rows
`searchParcels` can return up to 2000 features. The list renders the first
200 and shows a "Showing 200 of N — refine your query" footer. Do not
remove the cap; rendering 2000 list items kills mobile.

## Soft rules (style, conventions)

- TypeScript: zero `any` in `src/` or `functions/`. The grep
  `grep -rn '\bany\b' src/ functions/` should return nothing.
- One change at a time when debugging. If stuck > 30 min, stop and ask.
- Targeted Edit calls, not whole-file rewrites, on existing code.
- No em dashes in code comments or new docs.
- Don't add features the user didn't ask for. If the user says "fix the
  bug" don't refactor the surrounding module.
- Before claiming done: `npm run build` clean, `npx eslint .` clean, all
  E2E green.

## Verification before "done"

```bash
npm run build                                                       # tsc -b + vite build
npx eslint .                                                        # zero issues
grep -rn '\bany\b' src/ functions/                                  # empty
BASE_URL=https://tn-land-atlas.pages.dev npx playwright test --repeat-each=3
```

External probes that should hold after any API change:

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"query":"x'\'' OR 1=1--"}' \
  https://tn-land-atlas.pages.dev/api/search           # 400 Invalid query

curl -s -X POST -H 'content-type: application/json' \
  -d '{"west":-82.4,"south":36.3,"east":-82.3,"north":36.4,"county":"DROP"}' \
  https://tn-land-atlas.pages.dev/api/parcels         # 400 Invalid county

curl -s -X POST -H 'content-type: application/json' \
  -d '{"west":0,"south":0,"east":1,"north":1,"county":"ALL"}' \
  https://tn-land-atlas.pages.dev/api/parcels         # 400 Invalid bbox
```

## Where to look first when something breaks

| Symptom | First place to look |
|---|---|
| Map is black, controls visible | Container height. See rule #3. |
| Map appears but parcels don't load on zoom | Browser console for `[parcels]` errors; the bbox might be outside the TN superset. |
| `/api/property` returns empty | `wrangler.toml` may have empty `SUPABASE_*` vars shadowing dashboard. Rule #2. |
| Search is slow / unresponsive | Result count is > 200; refine query. Rule #15. |
| Build green, prod broken | `tsconfig.json` lost the functions project ref. Rule #6. |
| MapLibre 404s in console | NAIP zoom > 16 (rule #7) or a typo in the tile URL template. |

## Convex / D1 / better-auth

This repo doesn't use any of them. If guidance from the global
`~/.claude/CLAUDE.md` says "use Convex" or "default to D1", that's for
new projects. **TN Land Atlas is grandfathered into the
Cloudflare-Pages-plus-Supabase shape it shipped with.** Don't migrate
without an explicit user request.
