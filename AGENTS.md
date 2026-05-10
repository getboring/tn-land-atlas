# Agent Rules — Holston Scout

Guardrails for AI coding agents working in this repo. Modeled on the Convex
AI rules pattern but specific to this stack: Vite + React 19 + MapLibre on
Cloudflare Pages with Pages Functions and Supabase REST.

**Product:** Holston Scout — pre-construction parcel intelligence for East
Tennessee builders.
**Tagline:** Scout the ground. Know the build.
**Parent brand:** Holston Intel.
**Repo / deploy target:** `getboring/tn-land-atlas` on
`tn-land-atlas.pages.dev` (Cloudflare Pages project name kept; the URL will
move to `scout.holstonintel.com` in a later phase).

If you (the agent) violate one of these rules, you are introducing a known
class of bug that has already been hunted down once. Don't.

## Stack (do not change without explicit user approval)

- **Frontend:** Vite 8, React 19, TypeScript strict, Tailwind v4, shadcn/ui primitives
- **Map:** MapLibre GL JS 5
- **API:** Cloudflare Pages Functions (`PagesFunction` handlers in `functions/api/`)
- **Live parcels:** Johnson City ArcGIS REST (`gis.johnsoncitytn.org`)
- **Enriched data:** Supabase REST, **server-side only**
- **Lint/format:** Biome is **not** used here — ESLint + typescript-eslint are
- **Tests:** Playwright (~30 tests x 3 viewports for E2E, with a couple mobile-only) + Vitest (170+ unit tests across `src/lib/insights.ts`, `permalink.ts`, `lazyRetry.ts`, and the `src/lib/build-fit/` suite)

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
updates. The refs are kept current by an effect in `ParcelMap.tsx`. Same
pattern applies to `filtersRef` and `rawParcelsRef` for the filter sheet.

### 6. tsconfig must include the functions project ref
`tsconfig.json` MUST reference `tsconfig.functions.json`. Without it,
`npm run build` runs `tsc -b` only over `src/` and `vite.config.ts`, and
TypeScript errors in `functions/` go undetected. The Cloudflare Pages
deploy bundles `functions/` to JS without type-checking — if the local
build doesn't check it, nothing does.

### 7. Basemap switching is allowed; every source must clear four checks

The Layers popover (bottom action bar) lets the user pick between four
basemaps — Satellite (Esri World Imagery, default), Streets
(OpenStreetMap), Topographic (USGS), Hybrid (Esri imagery + reference
labels overlay). Contour lines are an overlay sub-toggle inside the
same popover.

Adding a new basemap or overlay raster source is allowed, but every
new source MUST satisfy all four:

1. **Bounds** — set `bounds: TN_BOUNDS` (defined where `style.sources`
   is built) so MapLibre never requests tiles outside the data area.
   Without this, panning over the ocean or out of TN would burn the
   upstream's quota for nothing.
2. **CSP `connect-src`** — the tile host must already be in
   `public/_headers` `connect-src`, or you add it in the same PR.
   See rule #21.
3. **Attribution** — set `attribution` on the source so the
   `AttributionControl` displays the upstream's required credit. Public
   upstreams (USGS, OSM) require this by their license.
4. **Zoom coverage probe** — verify the upstream actually serves tiles
   at the zooms you list (`minzoom`/`maxzoom`). USGS Topo, for example,
   caps at z16 — listing maxzoom 19 there would silently 404 above 16.
   `curl -I` a few `{z}/{x}/{y}.png` URLs across the range before
   committing.

Visibility is toggled via `setLayoutProperty('id', 'visibility', …)`,
NOT via `setStyle()`. setStyle wipes the parcel/contour/selection
layers and forces a full restyle; a visibility toggle is one frame and
keeps every data layer alive. The `BASEMAP_LAYERS` map (one entry per
`Basemap`) is the single source of truth for which raster ids are
visible per mode — Hybrid renders two layers (imagery + labels) which
is why the data shape is `Record<Basemap, string[]>`.

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

### 16. Insights are pure functions, no hardcoded answers
Everything in `src/lib/insights.ts` is a deterministic, side-effect-free
computation over data we already have (ArcGIS attributes ± Supabase
enrichment). Examples: `pricePerAcre`, `yearsHeld`, `entityKind`,
`occupancy`, `acreageTier`, `centroid`. Tests live in
`src/lib/insights.test.ts` (vitest). When you add an indicator: write the
pure function first, write the test, then wire it into the UI. Never
hand-roll insight logic inline in `ParcelMap.tsx`.

### 17. Filters are client-side via passesFilters
The filter sheet runs `passesFilters()` from `insights.ts` against the
last-loaded `rawParcelsRef.current` snapshot. No extra API hits. Add new
filter dimensions by extending `ParcelFilterFlags` and adding an AND
clause in `passesFilters` (with vitest coverage), then add a switch in
the FilterSheet UI.

### 18. Permalinks round-trip view + selected parcel
`src/lib/permalink.ts` parses and writes `?lng=&lat=&z=&parcel=`.
- Map view sync uses `replaceState` (no history pollution per pan/zoom).
- Selecting / deselecting a parcel updates the URL.
- Loading with `?parcel=<gislink>` resolves via `GET /api/parcel?key=...`
  and selects/flies-to in the resolution effect. Don't break this — it's
  what makes investigations sharable.

### 19. Tests must stay green before claiming done
- `npm test` (vitest), 170+ unit tests across `src/lib/{insights,permalink,lazyRetry,build-fit}.ts` plus `ownerSearchTerm`
- `npm run build` — `tsc -b` over app + node + functions project refs
- `npx eslint .` — zero issues
- `BASE_URL=<prod> npx playwright test` — 63 E2E tests across 3 viewports (189 runs)

### 20. The whole app sits inside an ErrorBoundary
`App.tsx` wraps `<Suspense>` in `<ErrorBoundary>` from the
`react-error-boundary` package, with `FallbackComponent={MapErrorFallback}`
(`src/components/MapErrorFallback.tsx`). A render error in `ParcelMap`
or any descendant shows a recovery UI with a Retry button instead of a
blank page. Don't remove the wrapper. If you add a top-level layout
component, keep the ErrorBoundary as the outermost shell.

### 21. Security headers live in public/_headers
Cloudflare Pages reads `public/_headers` at deploy and applies the rules
to matching paths. We set HSTS (2y preload), CSP with an explicit
`connect-src` whitelist, X-Frame-Options SAMEORIGIN, Permissions-Policy,
Referrer-Policy, X-Content-Type-Options, plus `/assets/*` immutable
caching. **If you add a new external upstream the client talks to**
(new tile source, new API), you MUST add it to the CSP `connect-src`
whitelist or the browser will block the request silently.

### 22. MapLibre native control sizing override
`.maplibregl-ctrl-group button` is overridden to 40x40 in `index.css`.
The library defaults to 29x29 which is below WCAG 2.5.5 AA. Don't remove
the override. Same file pushes `.maplibregl-ctrl-bottom-right` to
`bottom: 5.5rem` so the native cluster sits above the bottom action bar
(a flagged overlap from the visual audit).

### 23. Inputs are 16px on mobile to dodge iOS auto-zoom
iOS Safari triggers auto-zoom on focus for any text input under 16px.
The search input and the FilterSheet min-acres input use
`text-base sm:text-sm` — 16px on mobile (no zoom), 14px on tablet+
(density). Don't remove the responsive class.

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
| MapLibre 404s in console | A basemap source's listed maxzoom exceeds upstream coverage (USGS Topo caps at z16). Re-probe per AGENTS.md rule #7 covenant or a typo in the tile URL template. |

## Convex / D1 / better-auth

This repo doesn't use any of them. If guidance from the global
`~/.claude/CLAUDE.md` says "use Convex" or "default to D1", that's for
new projects. **Holston Scout is grandfathered into the
Cloudflare-Pages-plus-Supabase shape it shipped with.** Don't migrate
without an explicit user request.

## Brand system (Holston Scout, HolstonBuilder family)

Scout was rebranded into the HolstonBuilder design family. Both products
now share a single token system so they read as one product line:

- **Background layers** — `bg #02040A` (void), `surface #0F1729`,
  `surface-elevated #1A2332`, `surface-pressed #1E293B`.
- **Borders** — `border-subtle #1E293B`, `border-default #334155`,
  `border-strong #475569`.
- **Text** — `text-primary #F8FAFC`, `text-secondary #CBD5E1`,
  `text-tertiary #94A3B8`, `text-muted #64748B`,
  `text-inverse #020617`.
- **Brand (amber)** — `brand #F59E0B` is the action color (CTAs,
  selected parcel, focus ring); `brand-strong #FCD34D` for hover/highlight
  states; soft tints via `brand/20`/`brand/40` opacity utilities.
- **Stamp / functional** — `stamp #DC2626` for irreversible/escalation,
  plus `success #22C55E`, `warning #FBBF24`, `danger #F87171`,
  `info #60A5FA`.
- **Map roles** — `map-parcel-default #94A3B8` (calm slate-blue),
  `map-parcel-hover #FCD34D`, `map-parcel-selected #F59E0B`,
  `map-label-halo #F8FAFC`, `map-label-primary #02040A`.

Tokens are mirrored byte-for-byte from `~/Projects/holstonbuilder`'s
`tailwind.config.js` and `apps/app/global.css`. When HolstonBuilder
updates a token, mirror it here.

The brand identity ships in three files plus those tokens:

- `src/components/HolstonChrome.tsx` — top chrome bar (48-52px). Holds
  the wordmark + Survey Corner mark on the left, slots for future
  search and auth on the center/right. Map fills the remaining
  viewport via `flex-1`. Banner role + aria-label.
- `src/components/SurveyCornerMark.tsx` — the geometric brand mark.
  Single SVG master at three lockups: inline (chrome), app-icon (with
  bg ring), one-color fallback. Mirrored in `public/favicon.svg` and
  `public/og-image.svg`. Outline is `border-default #334155`, accent
  is `brand #F59E0B`.
- `src/index.css` — `@theme` block holding the palette above, plus
  spacing, motion, shadows, z-index, focus-ring rules, MapLibre
  overrides, and a `@media print` block for parcel-handout printing.
  Single Inter family across body + display
  (`--font-sans`, `--font-display`); system monospace stack for data
  (`--font-mono`).

Map style is the single most distinctive surface. Default parcel
outline is slate (`text-tertiary`) at 0.6 opacity (calm USGS-quad
posture). Hover gets a `brand-strong` outline + `brand` fill at 0.14
alpha via feature-state. Selected parcel gets a `brand` outline +
`brand` fill at 0.24 alpha + corner-node markers (`text-primary` fill,
`bg` stroke at every polygon vertex — the Survey Corner brand mark in
miniature).

Numeric data (parcel ID, acres, dollar amounts, dates, coordinates)
renders in the system monospace stack with
`font-variant-numeric: tabular-nums` via the `data-value` utility.
Caps labels use `data-label` (uppercase, tracked, `text-tertiary`).

### Tailwind v4 var() syntax (load-bearing)

`h-[--spacing-chrome]` does NOT auto-wrap CSS variables. It compiles to
`height: --spacing-chrome` (invalid, ignored). Use one of:
- `h-(--spacing-chrome)` — Tailwind v4 parens-syntax, auto-wraps with `var()`
- `h-[var(--spacing-chrome)]` — explicit
- `h-12` / `h-[52px]` — direct utilities (preferred for fixed values)

We use direct utilities for spacing/z-index/shadow values; the `@theme`
tokens are the documentation, the utilities are the implementation.
