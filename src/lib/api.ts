import type { BuildingRecord, ValuationRecord, SaleRecord, EntityRecord } from './supabase-queries'
import { queryParcelsByBbox as directQueryParcelsByBbox, searchParcels as directSearchParcels } from './arcgis'
import { getBuildings, getValuation, getSales, getEntitiesForParcel } from './supabase-queries'

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'Network error')
    throw new Error(`API ${path} ${res.status}: ${text}`)
  }
  return res.json()
}

export async function queryParcelsByBbox(
  west: number,
  south: number,
  east: number,
  north: number,
  county: string,
  signal?: AbortSignal
): Promise<GeoJSON.FeatureCollection> {
  try {
    return await post('/api/parcels', { west, south, east, north, county })
  } catch {
    // Fallback to direct ArcGIS call (for local dev without Functions)
    return directQueryParcelsByBbox(west, south, east, north, county, signal)
  }
}

export async function searchParcels(query: string, county: string): Promise<GeoJSON.FeatureCollection> {
  try {
    return await post('/api/search', { query, county })
  } catch {
    return directSearchParcels(query, county)
  }
}

export async function getPropertyData(parcelKey: string): Promise<{
  buildings: BuildingRecord[]
  valuation: ValuationRecord | null
  sales: SaleRecord[]
  entities: EntityRecord[]
}> {
  try {
    return await post('/api/property', { parcelKey })
  } catch {
    // Fallback to direct Supabase calls
    const [buildings, valuation, sales, entities] = await Promise.all([
      getBuildings(parcelKey).catch(() => []),
      getValuation(parcelKey).catch(() => null),
      getSales(parcelKey).catch(() => []),
      getEntitiesForParcel(parcelKey).catch(() => []),
    ])
    return { buildings, valuation, sales, entities }
  }
}
