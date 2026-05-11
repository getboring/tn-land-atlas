// Typed fetch wrappers for the /api/* Pages Functions.
//
// The client side ONLY talks to /api/*; there is no runtime Supabase client
// in the browser bundle. Each function corresponds one-to-one with a route
// in `functions/api/`:
//
//   queryParcelsByBbox      -> POST /api/parcels   (bbox path)
//   queryParcelsInPolygon   -> POST /api/parcels   (polygon path, lasso)
//   searchParcels           -> POST /api/search
//   getParcelByKey          -> GET  /api/parcel?key=...
//   getPropertyData         -> POST /api/property
//
// All POSTs accept an optional AbortSignal so the caller can cancel
// in-flight requests when the user navigates or re-types. Failures throw
// `Error('API <path> <status>[: <body>]')`; callers should distinguish
// `AbortError` (silent cancel) from real errors before surfacing.

import type { PropertyData } from './supabase-queries'
import type { ParcelCollection, ParcelFeature } from './arcgis'

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${path} ${res.status}${text ? `: ${text}` : ''}`)
  }
  return res.json() as Promise<T>
}

/**
 * Fetch parcels intersecting a viewport bbox.
 *
 * Caller is responsible for keeping the bbox inside the TN superset; the
 * server validates and returns 400 if not. Cancelling via `signal` is the
 * standard idiom for replacing an in-flight load on pan/zoom.
 */
export async function queryParcelsByBbox(
  west: number,
  south: number,
  east: number,
  north: number,
  county: string,
  signal?: AbortSignal,
): Promise<ParcelCollection> {
  return postJson<ParcelCollection>(
    '/api/parcels',
    { west, south, east, north, county },
    signal,
  )
}

/**
 * OWNER / ADDRESS / GISLINK LIKE search. Server caps results at 2000;
 * UI further caps the rendered list at 200 rows.
 */
export async function searchParcels(
  query: string,
  county: string,
  signal?: AbortSignal,
): Promise<ParcelCollection> {
  return postJson<ParcelCollection>('/api/search', { query, county }, signal)
}

/**
 * Fetch parcels whose geometry intersects a user-drawn lasso polygon.
 * Polygon must be a closed `[lng, lat][]` ring with at least 4 vertices;
 * the server validates and returns 400 on shape or out-of-region failures.
 */
export async function queryParcelsInPolygon(
  polygon: [number, number][],
  county: string,
): Promise<ParcelCollection> {
  return postJson<ParcelCollection>('/api/parcels', { polygon, county })
}

/**
 * Look up a single parcel by GISLINK (the human-readable parcel key
 * used in permalinks and the recent-parcels list).
 *
 * @throws Error('API /api/parcel 404') when the key resolves to no record.
 */
export async function getParcelByKey(key: string): Promise<ParcelFeature> {
  const res = await fetch(`/api/parcel?key=${encodeURIComponent(key)}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API /api/parcel ${res.status}${text ? `: ${text}` : ''}`)
  }
  return res.json() as Promise<ParcelFeature>
}

/**
 * Pull enriched Supabase-backed data (buildings / valuation / sales /
 * entities) for a parcel. Per-table failures degrade gracefully on the
 * server side; the response always has the expected shape.
 */
export async function getPropertyData(parcelKey: string): Promise<PropertyData> {
  return postJson<PropertyData>('/api/property', { parcelKey })
}

// ── Phase 6e: flood zones ──────────────────────────────────────────────────

/**
 * GeoJSON FeatureCollection of FEMA NFHL flood-hazard polygons returned
 * by `/api/flood`. Each feature's properties carry the upstream
 * `FLD_ZONE` code (X, AE, VE, etc.) and a few related fields.
 */
export interface FloodZoneFeature {
  type: 'Feature'
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
  properties: {
    FLD_ZONE?: string | null
    ZONE_SUBTY?: string | null
    SFHA_TF?: string | null
    STATIC_BFE?: number | null
  }
}

export interface FloodZoneCollection {
  type: 'FeatureCollection'
  features: FloodZoneFeature[]
}

/**
 * Fetch FEMA NFHL flood-hazard polygons intersecting a bounding box. Used
 * by the build-fit workspace to check whether a parcel sits in a flood
 * zone. Cached an hour at the edge.
 */
export async function queryFloodZones(
  west: number,
  south: number,
  east: number,
  north: number,
  signal?: AbortSignal,
): Promise<FloodZoneCollection> {
  return postJson<FloodZoneCollection>('/api/flood', { west, south, east, north }, signal)
}

// ── Phase 6d: roads ──────────────────────────────────────────────────────

/** GeoJSON FeatureCollection of OSM road centerlines as returned by /api/roads. */
export interface RoadCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'LineString'; coordinates: number[][] }
    properties: {
      osmId?: number
      highway?: string | null
      name?: string | null
    }
  }>
}

/**
 * Fetch OSM road centerlines (way[highway]) intersecting a bounding box.
 * Used by Phase 6d's road-auto-classify path. Cached an hour at the edge;
 * upstream Overpass has tight rate limits so the cache is load-bearing.
 */
export async function queryRoads(
  west: number,
  south: number,
  east: number,
  north: number,
  signal?: AbortSignal,
): Promise<RoadCollection> {
  return postJson<RoadCollection>('/api/roads', { west, south, east, north }, signal)
}
