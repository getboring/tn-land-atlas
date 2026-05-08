# TN Land Atlas

Parcel mapping for **Sullivan, Washington, and Carter** counties in East Tennessee.
Live satellite imagery, parcel polygons, owner / address search, and (when
configured) enriched data — buildings, valuations, sales history, linked
entities — pulled from a Supabase warehouse.

Live: https://tn-land-atlas.pages.dev

## Stack

- Vite 8 + React 19 + TypeScript (strict, project references for app / functions / node)
- MapLibre GL JS 5
- Tailwind CSS v4 + shadcn/ui (`Button`, `Card`)
- ArcGIS REST (Johnson City) for live parcel polygons
- Supabase (`asfyqdscagjlkpjjrdxw`) for enriched property data — accessed only through the server
- Cloudflare Pages + Pages Functions
- Playwright for E2E (33 tests across desktop / iPad / iPhone)

## Quick Start

```bash
cd ~/tn-land-atlas
npm install
npm run dev          # Vite only, http://localhost:5173
# or, full stack with Functions:
npm run build && npx wrangler pages dev dist --port 5180
```

The Supabase secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) live on the
Cloudflare Pages project (Settings -> Environment variables, Production +
Preview). They are read by `functions/api/property.ts` only and never shipped
to the browser. With them unset, the property panel still renders — it just
shows the ArcGIS attributes without the enriched buildings / sales / entities
tabs.

## API (Cloudflare Pages Functions)

| Endpoint        | Method | Body                                              | Returns |
|-----------------|--------|---------------------------------------------------|---------|
| `/api/parcels`  | POST   | `{ west, south, east, north, county }`            | GeoJSON FeatureCollection from ArcGIS |
| `/api/search`   | POST   | `{ query, county }`                               | GeoJSON FeatureCollection (owner / address / parcel-key fuzzy match) |
| `/api/property` | POST   | `{ parcelKey }`                                   | `{ buildings, valuation, sales, entities }` |

All three validate inputs at the edge:

- `county` must be one of `ALL`, `Sullivan`, `Washington`, `Carter`
- `query` must match `^[a-zA-Z0-9 .,'#&\-/]{2,80}$`; LIKE wildcards stripped
- `bbox` must lie inside a TN superset (lon -90.5..-81.5, lat 34.5..37.0)

Anything else returns `400`.

## Testing

```bash
npm run test:e2e                                          # against the local dev server
BASE_URL=https://tn-land-atlas.pages.dev npm run test:e2e # against production
npx playwright test --repeat-each=3                       # flake check
```

## File map

```
src/
  App.tsx                       trivial wrapper around <ParcelMap />
  main.tsx                      React root, imports index.css
  index.css                     Tailwind theme tokens, MapLibre overrides
  components/
    ParcelMap.tsx               main map, top bar, detail sidebar, controls
    ui/{button,card}.tsx        shadcn primitives
  lib/
    api.ts                      typed fetch wrappers for /api/*
    arcgis.ts                   ParcelProperties, ParcelFeature, ParcelCollection types
    supabase-queries.ts         enriched-data type definitions (no runtime client)
    utils.ts                    cn(), fmtMoney(), fmtDate()
  types/global.d.ts             window.__map__ augmentation for E2E
functions/api/
  _validate.ts                  shared county / bbox / query whitelists
  parcels.ts                    POST -> ArcGIS bbox query, edge-cached 5m
  search.ts                     POST -> ArcGIS owner / address / GISLINK LIKE
  property.ts                   POST -> Supabase parallel reads, 30s cache
e2e/map.spec.ts                 33 tests x 3 viewports (chromium-desktop/-tablet/-mobile)
public/{favicon.svg,manifest.json}
```

## Deploying

Auto-deploys from `main` push aren't wired. Push and then:

```bash
npm run build
npx wrangler pages deploy dist --project-name tn-land-atlas --branch main
```
