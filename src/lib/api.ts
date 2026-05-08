import type { BuildingRecord, ValuationRecord, SaleRecord, EntityRecord } from './supabase-queries'

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
  _signal?: AbortSignal
): Promise<GeoJSON.FeatureCollection> {
  return post('/api/parcels', { west, south, east, north, county })
}

export async function searchParcels(query: string, county: string): Promise<GeoJSON.FeatureCollection> {
  return post('/api/search', { query, county })
}

export async function getPropertyData(parcelKey: string): Promise<{
  buildings: BuildingRecord[]
  valuation: ValuationRecord | null
  sales: SaleRecord[]
  entities: EntityRecord[]
}> {
  return post('/api/property', { parcelKey })
}
