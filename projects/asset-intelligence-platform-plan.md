# Asset Intelligence Platform Plan

AI-generated planning document. Created 2026-05-09 from a fresh audit of the local `getboring/tn-land-atlas` codebase and the prior architecture discussion.

## Executive Direction

Holston Scout should become the first vertical in a reusable asset intelligence platform, not remain only a one-off parcel viewer.

The reusable product pattern is:

```text
Search assets -> inspect details -> enrich with external data -> compute insights -> save/share/report -> act
```

For Holston Scout, the asset is a parcel. For future products, the asset could be a permit, auction lot, contractor, commercial site, zoning case, utility project, or other industry-specific record.

The right long-term direction is a platform core plus vertical packs:

| Layer | Responsibility |
|---|---|
| Platform core | Tenants, users, assets, locations, entities, events, saved items, reports, sources, observations, scores, jobs, provenance |
| Vertical pack | Parcel-specific fields, permit-specific fields, auction-specific fields, domain filters, domain scoring, map layers, report templates |

Do not build a single over-generic schema that tries to model every industry perfectly. Build reusable primitives for the workflow, then use strong vertical extension tables where each industry needs precision.

## Current Codebase Audit

### Current Stack

| Area | Current State |
|---|---|
| Frontend | Vite 8, React 19, TypeScript strict, Tailwind v4, shadcn-style primitives |
| Map | MapLibre GL JS 5, MapLibre contour, Terra Draw, WaterGIS export control |
| Hosting | Cloudflare Pages with Pages Functions |
| Live parcels | Johnson City ArcGIS REST, proxied through `/api/parcels`, `/api/search`, `/api/parcel` |
| Enriched data | Supabase REST, server-side only through `/api/property` |
| Tests | Vitest for pure utilities, Playwright E2E across viewports |
| Local persistence | `src/lib/storage.ts` localStorage layer for saved and recent parcels |

### Important Existing Strengths

| Strength | Evidence |
|---|---|
| Server-only Supabase access | `functions/api/property.ts` is the only runtime Supabase path |
| Validated edge inputs | `functions/api/_validate.ts` validates county, bbox, query, polygon |
| Shareable investigations | `src/lib/permalink.ts` round-trips map view and selected parcel |
| Computed insight hygiene | `src/lib/insights.ts` keeps indicators pure and testable |
| Map reliability guardrails | `ResizeObserver`, inline map container positioning, refs for long-lived handlers |
| Local retention primitive | `src/lib/storage.ts` supports saved and recent parcels with schema versioning |
| Mobile-friendly controls | 40px+ targets, iOS-safe input font sizes, bottom action bar |
| Branded visual system | `HolstonChrome`, `SurveyCornerMark`, `index.css` tokens |

### Current Product Surfaces

| Surface | Current State | Long-Term Role |
|---|---|---|
| Search | Single input over ArcGIS owner/address/GISLINK | Generic `AssetSearch` with vertical-specific fields and suggestions |
| Map | Parcel polygon viewer over Esri imagery | Generic `AssetMap` with vertical-specific layers |
| Detail panel | Parcel details, quick actions, insights, enrichment | Generic `AssetDetailPanel` with vertical sections |
| Quick actions | Maps, Street View, Apple Maps, Copy Address, More by owner | Generic `AssetActionRow` with vertical actions |
| Saved/recent | localStorage backed by GISLINK | Generic collections, auth-backed later |
| Filters | Client-side computed parcel filters | Vertical filter definitions over indexed fields and observations |
| Enrichment | Supabase valuation, buildings, sales, entities | Source adapters and vertical enrichment pipelines |
| Reports/exports | Map export control and share permalink | Report templates and generated artifacts |

### Current Gaps

| Gap | Impact |
|---|---|
| `ParcelMap.tsx` is a large all-in-one component | Harder to reuse across verticals and harder to test in pieces |
| Core data depends on live ArcGIS calls | Runtime performance and reliability are capped by an upstream service |
| Supabase is enrichment-only | The product does not yet own the core spatial source of truth |
| Saved/recent store only GISLINK | Good MVP, but not enough for cross-vertical asset summaries or offline recall |
| Owner search quick action uses async state incorrectly | `setSearchQuery(owner); doSearch()` can search the old query because React state updates are async |
| `src/lib/storage.ts` comments assume D1 migration | Revisit if the long-term data system becomes Neon/PostGIS rather than D1 |
| Detail panel remains parcel-specific | Needs extraction into generic sections plus parcel-specific section definitions |
| Basemap/layer expansion needs care | Repo guardrail currently says one basemap; new tile sources require CSP and zoom coverage checks |

## Target Long-Term State

### Strategic Position

Holston Scout becomes the reference implementation for an internal platform that can power multiple branded industry intelligence products.

The competitive advantage is not just the map. The advantage is reusable workflows plus proprietary vertical intelligence:

| Advantage | Why It Matters |
|---|---|
| Data ownership | Public ArcGIS calls are easy to copy; cleaned, normalized, historical, enriched data is harder to copy |
| Derived observations | Absentee ownership, entity ownership, holding duration, sale/appraisal gaps, buildability signals |
| Fast vertical launches | Shared asset search/detail/report workflow lowers time to market |
| Brand portability | Different industries can get distinct products without forking the platform |
| Reportability | Saved investigations, share links, printable handouts, and exports make data actionable |
| Field loop | Future Expo companion can bring saved work, notes, GPS, photos, and offline packs into the field |

### Recommended Target Stack

| Layer | Recommendation | Reason |
|---|---|---|
| Web runtime | Cloudflare Workers Static Assets | Best long-term Cloudflare path for SPA plus API routes, better observability and platform primitives |
| API | Cloudflare Workers | Validation, caching, tracing, placement, R2 integration, future service bindings |
| Web UI | Keep Vite/React first | Current app is working; extract primitives before changing framework |
| Primary data | Neon Postgres with PostGIS | Best fit for owned parcel intelligence, spatial queries, branching, AI-agent-safe schema work |
| Generated artifacts | Cloudflare R2 | Cheap storage for vector tiles, GeoJSON chunks, reports, exports, snapshots |
| Simple edge metadata | D1 optional | Good for edge-native app state, but not the primary geospatial system |
| Realtime collaboration | Convex optional | Good for notes/team presence later, not primary parcel database |
| Native | Expo optional companion | Best for field workflows, not a replacement for the web app |

### Important Constraint

The repo currently has explicit guardrails that this is a Cloudflare Pages plus Supabase project and should not be migrated without user approval. Treat Workers, Neon/PostGIS, D1, Convex, and Expo as planned future stages requiring explicit approval, not incidental refactors.

## Platform Core Model

Use a reusable core with strongly typed vertical extensions.

### Core Concepts

| Concept | Meaning | Holston Scout Example |
|---|---|---|
| Asset | The thing being inspected | Parcel |
| Location | Address, centroid, geometry, map position | Parcel polygon and centroid |
| Entity | Person, company, government, trust, organization | Owner, LLC, registered agent |
| Event | Something that happened to an asset | Sale, transfer, permit, inspection |
| Valuation | Money-related valuation data | Appraisal, assessment, sale price |
| Observation | Derived fact or signal | Absentee, entity-owned, long-held |
| Score | Versioned ranking output | Buildability score, opportunity score |
| Source | External or internal origin | ArcGIS, county feed, Supabase, Neon import |
| Collection | User-owned grouping | Saved parcels, project list |
| Report | Shareable or printable output | Parcel handout, due diligence summary |
| Layer | Geospatial overlay | Contours, parcel labels, flood, zoning |

### Core Tables

This is the long-term logical shape. Names can be adjusted during implementation.

```sql
assets (
  id text primary key,
  tenant_id text not null,
  vertical text not null,
  external_key text,
  title text not null,
  subtitle text,
  status text,
  source_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

asset_locations (
  id text primary key,
  asset_id text not null references assets(id),
  centroid geography(point, 4326),
  geometry geometry,
  address text,
  city text,
  state text,
  postal_code text,
  county text
);

entities (
  id text primary key,
  tenant_id text not null,
  name text not null,
  normalized_name text not null,
  kind text,
  mailing_address text,
  city text,
  state text,
  postal_code text,
  source_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

asset_entities (
  id text primary key,
  asset_id text not null references assets(id),
  entity_id text not null references entities(id),
  relationship text not null,
  source_id text,
  created_at timestamptz not null
);

asset_events (
  id text primary key,
  asset_id text not null references assets(id),
  event_type text not null,
  occurred_at timestamptz,
  amount_cents integer,
  source_id text,
  payload_json jsonb,
  created_at timestamptz not null
);

asset_observations (
  id text primary key,
  asset_id text not null references assets(id),
  observation_type text not null,
  label text not null,
  value_json jsonb,
  confidence integer,
  generated_by text,
  source_id text,
  created_at timestamptz not null
);

asset_scores (
  id text primary key,
  asset_id text not null references assets(id),
  score_type text not null,
  score integer not null,
  version text not null,
  rationale text,
  generated_by text,
  created_at timestamptz not null
);

collections (
  id text primary key,
  tenant_id text not null,
  owner_user_id text not null,
  vertical text not null,
  name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

collection_assets (
  id text primary key,
  collection_id text not null references collections(id),
  asset_id text not null references assets(id),
  saved_at timestamptz not null,
  note text,
  tags text[] not null default '{}'
);
```

### Parcel Vertical Extension

```sql
parcel_assets (
  asset_id text primary key references assets(id),
  parcel_id text not null,
  county text,
  acres numeric,
  zoning text,
  property_type text,
  appraisal_cents integer,
  last_sale_cents integer,
  last_sale_date date,
  source_id text,
  updated_at timestamptz not null
);

parcel_buildings (
  id text primary key,
  asset_id text not null references assets(id),
  building_number integer,
  sqft_living integer,
  year_built integer,
  quality text,
  condition text,
  foundation text,
  source_id text
);

parcel_assessments (
  id text primary key,
  asset_id text not null references assets(id),
  land_value_cents integer,
  improvement_value_cents integer,
  total_appraisal_cents integer,
  assessment_cents integer,
  tax_year integer,
  source_id text
);
```

### Schema Rules

| Rule | Standard |
|---|---|
| IDs | ULIDs via `ulidx` for new internal records |
| Money | Integer cents in owned data |
| ArcGIS money | ArcGIS returns whole dollars; convert once on ingest into `_cents` fields |
| Dates | Store as `date` or `timestamptz`; use `date-fns` in app code |
| Validation | Zod at API and ingestion boundaries |
| Provenance | Every imported/derived value should retain source and generated version |
| Geometry | PostGIS `geometry` for parcel shapes and `geography(point, 4326)` for centroids |
| Extensions | Avoid EAV as the primary model; use vertical extension tables plus JSON only for source payloads or explainability |

## Reusable App Primitives

Extract these from `ParcelMap.tsx` over time.

| Primitive | Purpose |
|---|---|
| `AssetSearch` | Query input, shortcuts, suggestions, loading state |
| `AssetResultList` | Capped results list with vertical-specific row renderer |
| `AssetMap` | Map shell, sources, layers, selection, viewport loading |
| `AssetDetailPanel` | Shared panel layout with vertical-defined sections |
| `AssetActionRow` | Maps, copy, save, share, print, vertical actions |
| `AssetInsightBadges` | Derived observations and metrics |
| `FilterSheet` | Generic filter definitions with vertical predicates |
| `SavedAssets` | Saved list, collection actions, future auth migration |
| `RecentAssets` | Local recall and future account-backed history |
| `LayerSwitcher` | Overlay controls first, basemap switching later |
| `ReportTemplate` | Printable/shareable report definitions |
| `VerticalChrome` | Brand shell, theme, labels, navigation slots |

## Vertical Configuration Shape

Each branded product should be mostly configuration plus vertical adapters.

```ts
type VerticalConfig = {
  id: string
  name: string
  tagline: string
  assetLabel: string
  assetPluralLabel: string
  searchPlaceholder: string
  theme: ThemeTokens
  defaultMapView?: { lng: number; lat: number; zoom: number }
  filters: FilterDefinition[]
  detailSections: DetailSectionDefinition[]
  actions: ActionDefinition[]
  layers: LayerDefinition[]
  reports: ReportTemplateDefinition[]
}
```

Example verticals:

| Vertical | Asset | Reused Workflow | Specific Data |
|---|---|---|---|
| Holston Scout | Parcel | Search, map, save, detail, report | Parcels, owners, sales, appraisals, zoning |
| Permit Scout | Permit | Search, detail, status, save, report | Permit type, contractor, inspection events |
| Auction Scout | Lot | Search, detail, estimate, watchlist, report | Lot category, comps, condition, hammer price |
| Contractor Scout | Company | Search, detail, notes, score, report | Licenses, permits, complaints, coverage area |

## Roadmap To Long-Term State

### Phase 0: Stabilize Current Holston Scout

Goal: Make the current product feel intelligent and retention-ready without changing infrastructure.

| Task | Notes |
|---|---|
| Fix owner search stale-state bug | Change `doSearch` to accept an optional query override and call `doSearch(owner)` |
| Promote owner search in detail panel | Make each owner value clickable, including `OWNER2` |
| Finish saved/recent UX | `src/lib/storage.ts` exists; add visible Recent panel and richer parcel summaries |
| Separate loading states | Distinguish viewport loading from search loading and enrichment loading |
| Group detail panel | Parcel, Owner, Value, Location, Enrichment sections |
| Use 2-decimal acreage in UI | Real estate readability over engineering precision |
| Add print stylesheet | Print only detail/report content, not full map chrome |
| Layers popover phase 1 | Rename Topo to Layers and expose overlays only; defer basemap swaps |

Exit criteria:

```text
npm test
npm run build
npm run lint
BASE_URL=https://tn-land-atlas.pages.dev npm run test:e2e
```

### Phase 1: Extract Platform Primitives

Goal: Make Holston Scout internally modular before adding new infrastructure.

| Task | Notes |
|---|---|
| Split `ParcelMap.tsx` | Extract search, result list, detail panel, action row, filter sheet, layer controls |
| Create `verticals/land` module | Move parcel labels, filters, fields, and insight wiring out of the shell |
| Keep pure insights pure | Continue writing functions in `insights.ts` with Vitest coverage |
| Formalize asset summary type | Shared shape for saved/recent/search results and future collections |
| Centralize action definitions | Maps, save, share, print, copy, owner search become configurable actions |

Exit criteria:

```text
ParcelMap becomes orchestration, not the whole application.
No new backend required.
No UX regression against existing E2E tests.
```

### Phase 2: Own The Parcel Data Path

Goal: Move from live ArcGIS dependency to owned spatial data.

| Task | Notes |
|---|---|
| Stand up Neon/PostGIS proof of concept | Requires explicit approval before implementation |
| Import sample parcel area | Start with one county or one known viewport |
| Convert ArcGIS dollars to integer cents | `APPRAISAL` and `PRICE` are whole dollars in ArcGIS |
| Add spatial indexes | GIST indexes on parcel geometry and centroid |
| Build bbox API | Match current `/api/parcels` response shape first |
| Benchmark against ArcGIS | Compare p50/p95 latency, payload size, error rate |
| Keep ArcGIS as sync source | Do not rely on ArcGIS for every user request long-term |

Exit criteria:

```text
Owned PostGIS bbox query is faster or more reliable than ArcGIS for sampled areas.
Current frontend can switch source behind the existing API contract.
```

### Phase 3: Move Runtime To Workers Static Assets

Goal: Align with the 2026 Cloudflare platform path while keeping app behavior stable.

| Task | Notes |
|---|---|
| Convert Pages Functions to Worker routes | Preserve `/api/parcels`, `/api/search`, `/api/parcel`, `/api/property` contracts |
| Serve Vite output through Workers Static Assets | Configure SPA fallback carefully |
| Add Workers tracing | Measure ArcGIS, Neon/Supabase, R2, and cache timing |
| Add route-level cache strategy | Cache public parcel/search responses intentionally |
| Update CSP and headers | Especially if new tile or API upstreams are introduced |

Exit criteria:

```text
Production behavior matches Pages deployment.
Traces expose upstream timing and cache behavior.
No security header regression.
```

### Phase 4: Generated Map Artifacts

Goal: Make map performance a product advantage.

| Task | Notes |
|---|---|
| Generate viewport chunks or vector tiles | Store in R2 with versioned paths |
| Add tile manifest table | Track artifact version, source date, region, bounds |
| Serve hot regions from R2 | Use Worker cache headers and immutable artifact names |
| Keep dynamic API fallback | Use PostGIS for uncached and investigative queries |
| Add source freshness display | Users should know when data was last synced |

Exit criteria:

```text
Common map views load from Cloudflare/R2 without hitting ArcGIS.
Large parcel payloads no longer dominate mobile performance.
```

### Phase 5: Accounts, Teams, Collections, Reports

Goal: Turn repeat usage into durable workflow.

| Task | Notes |
|---|---|
| Add auth | Choose Better Auth, managed auth, or provider after data path decision |
| Migrate local saved/recent | Convert current localStorage payload to account-backed collections |
| Add project collections | Users group assets by deal, client, territory, or campaign |
| Add notes and tags | Keep notes tied to collection membership when possible |
| Add report templates | Printable parcel report first, later branded PDFs |
| Add audit/provenance receipts | Important once reports are used in client meetings |

Exit criteria:

```text
Saved work survives across devices.
Users can create shareable reports from selected assets.
Local pre-auth history is not lost on signup.
```

### Phase 6: Second Vertical Proof

Goal: Prove this is a platform, not just a refactored parcel app.

| Candidate | Why |
|---|---|
| Permit Scout | Reuses search, asset detail, events, contractors, status, reports |
| Auction Scout | Reuses asset detail, estimates, saved lists, reports, comps |
| Contractor Scout | Reuses entities, events, scores, notes, reports |

Recommendation: choose Permit Scout first if the goal is adjacent builder demand. It shares geography, builders, owners, contractors, and development workflows with Holston Scout.

Exit criteria:

```text
A second vertical launches without forking the app shell.
Only vertical config, ingestion adapter, schema extension, and report template are new.
```

## Near-Term Implementation Order

This order keeps value high and risk low.

| Order | Work | Reason |
|---:|---|---|
| 1 | Fix owner search override | Highest intelligence-per-hour, current bug risk |
| 2 | Recent panel and richer local summaries | Builds retention loop using existing storage layer |
| 3 | Detail panel grouping | Makes current data feel like a report |
| 4 | Separate `ParcelActions`, `ParcelInsights`, `DetailSection` files | First extraction from `ParcelMap.tsx` |
| 5 | Layers popover with overlays only | Improves map depth without basemap risk |
| 6 | Worker/Neon proof documents | Prepare migration decisions before code migration |
| 7 | Neon/PostGIS sample import | Prove owned data path with benchmarks |

## Key Architecture Decisions To Make Later

| Decision | Default Recommendation |
|---|---|
| Keep Supabase or move to Neon | Move core parcel intelligence to Neon/PostGIS if the product becomes data-led |
| Use D1 for saved/recent | Use only if edge-native account state is prioritized; otherwise keep collections in primary Postgres |
| Add Convex | Only for realtime collaboration if needed, not primary parcel data |
| Add Expo | Build as field companion after web/data moat is strong |
| Add basemap switching | Defer until tile sources, CSP, style reload, and attribution are tested |
| SSR framework | Do not switch now; consider TanStack Start only if SEO/content pages or server-rendered app routes become important |

## Risk Register

| Risk | Mitigation |
|---|---|
| Over-generalized schema weakens vertical product | Keep strong vertical extension tables |
| Migration distracts from current UX | Finish Phase 0 polish first |
| New map sources break CSP or zoom coverage | Require CSP update, attribution, bounds, and probe tests before enabling |
| ArcGIS response shapes drift | Preserve validators, source adapters, and owned snapshots |
| localStorage schema drifts before auth | Keep `schemaVersion` and migration path in `src/lib/storage.ts` |
| Money units get mixed | Owned data uses cents; ArcGIS display remains whole-dollar until ingestion conversion |
| `ParcelMap.tsx` extraction causes regressions | Extract one primitive at a time with existing E2E tests green |

## Competitive Advantage Thesis

Competitors can copy a parcel map UI and live public ArcGIS calls. They cannot quickly copy normalized ownership, historical snapshots, derived observations, generated map artifacts, saved investigations, report workflows, and cross-vertical data products.

The long-term moat is the combination of:

| Moat | Example |
|---|---|
| Normalized data | Clean entity ownership across parcels and permits |
| Derived signals | Long-held, absentee, entity-owned, sale/appraisal gap, acreage tiers |
| Fast map delivery | Precomputed R2 artifacts and PostGIS-backed fallback |
| Workflow memory | Saved assets, recents, notes, collections, reports |
| Vertical packaging | Same platform rebranded for land, permits, auctions, contractors |
| Provenance | Source, freshness, and generated-by metadata for every insight |

## Final Recommendation

The best path is:

```text
Current Holston Scout polish
-> extracted reusable asset primitives
-> owned Neon/PostGIS parcel data path
-> Cloudflare Workers Static Assets and R2 artifacts
-> accounts, collections, and reports
-> second vertical proof
```

Do not jump straight into a full rewrite. The current app has strong product shape and good guardrails. Use it as the reference vertical, then extract the reusable platform only where real second-vertical reuse is visible.
