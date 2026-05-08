# TN Land Atlas

A real-estate-focused parcel mapping app for **Sullivan, Washington, and Carter counties** in Tennessee. Built by combining the best parts of your existing projects into something more powerful than onX.

## What Makes It Powerful

| Feature | onX Hunt | TN Land Atlas |
|---------|----------|---------------|
| Aerial base map | ✅ | ✅ Esri + USGS NAIP |
| Parcel boundaries | ✅ | ✅ Live ArcGIS polygons |
| Owner search | ✅ | ✅ + Supabase fuzzy match |
| Property details | Basic | **Deep: buildings, valuations, sales, entities** |
| Sales history | ❌ | ✅ 445K deed transfers |
| Building details | ❌ | ✅ sqft, year built, quality, condition, HVAC |
| Linked entities | ❌ | ✅ LLCs, corps, registered agents |
| Entity network | ❌ | ✅ Family/business connections |
| Web + mobile | App only | **PWA-ready, works in browser** |
| Cost | $30-100/yr | **Free, your own data** |

## Architecture — Built From Your Existing Projects

| Source Project | What Was Reused |
|----------------|-----------------|
| **`tn-parcel-map`** (built earlier) | MapLibre GL JS + ArcGIS REST integration, aerial tile layers, viewport-based GeoJSON loading |
| **`street-dossier`** (Jim Street) | Supabase client pattern, `gen-data.ts` query patterns, Leaflet→MapLibre upgrade path, property detail panel layout |
| **`sullivan-county-tn`** | shadcn/ui Button/Card components, brand color tokens, rate-limiting patterns, server function patterns |
| **PeopleResearch Supabase** | `parcels` (123K), `buildings` (123K), `valuations` (123K), `sales` (445K), `entities`, `person_parcels`, `connections` |

## Data Sources

1. **Parcel boundaries** — Johnson City ArcGIS REST API (live polygons for all 3 counties)
2. **Property attributes** — Tennessee Comptroller TPAD (via ArcGIS)
3. **Enriched data** — PeopleResearch Supabase (`asfyqdscagjlkpjjrdxw`):
   - Building specs, valuations, sales history, entity ownership, family connections

## Quick Start

```bash
cd ~/tn-land-atlas

# Optional: add Supabase credentials for enriched data
cp .env.example .env
# edit .env with your Supabase URL + anon key

npm install
npm run dev          # http://localhost:5173 (Vite alone)
# or
npx wrangler pages dev dist --port 5180   # full stack (Functions + static)
```

## Live

- Production: https://tn-land-atlas.pages.dev
- Cloudflare Pages project: `tn-land-atlas`

## API (Cloudflare Pages Functions)

| Endpoint | Method | Body | Returns |
|---|---|---|---|
| `/api/parcels` | POST | `{ west, south, east, north, county }` | GeoJSON FeatureCollection from ArcGIS |
| `/api/search` | POST | `{ query, county }` | GeoJSON FeatureCollection (owner / address fuzzy match) |
| `/api/property` | POST | `{ parcelKey }` | `{ buildings, valuation, sales, entities }` from Supabase |

The frontend calls these endpoints first and falls back to direct ArcGIS / Supabase calls if a Function is unavailable (e.g. `npm run dev` without wrangler).

## Testing

```bash
pnpm test:e2e                                       # run against local dev server
BASE_URL=https://tn-land-atlas.pages.dev pnpm test:e2e   # run against production
npx playwright test --repeat-each=3                       # flake check
```

33 tests across desktop / iPad / iPhone viewports — covers map render, controls, county filters, search, layer toggle, parcel selection, sidebar, recenter, and a guard that the map container actually fills the viewport (catches the MapLibre `position: relative` regression).

## Stack

- **Vite + React 19 + TypeScript** (from `street-dossier` scaffold)
- **MapLibre GL JS** (free, no API keys — upgraded from Leaflet)
- **Tailwind CSS v4** (brand tokens from `sullivan-county-tn`)
- **shadcn/ui primitives** (Button, Card — copied from `sullivan-county-tn`)
- **Supabase client** (`@supabase/supabase-js` from `street-dossier`)
- **ArcGIS REST API** (live parcel queries from `tn-parcel-map`)

## File Map

```
tn-land-atlas/
  src/
    components/
      ParcelMap.tsx          # Main map + search + detail panel
      ui/
        button.tsx           # Copied from sullivan-county-tn
        card.tsx             # Copied from sullivan-county-tn
    lib/
      arcgis.ts              # ArcGIS REST query helpers (from tn-parcel-map)
      supabase.ts            # Supabase client (from street-dossier)
      supabase-queries.ts    # Enriched data queries (new, inspired by gen-data.ts)
      utils.ts               # cn(), fmtMoney(), fmtDate()
  index.html
  vite.config.ts
```

## How to Deploy

```bash
npm run build
# Deploy dist/ to Cloudflare Pages, Vercel, or any static host
```

For a full-stack version with auth + rate limiting, port this into your `sullivan-county-tn` TanStack Start project using the existing Wrangler pipeline.
