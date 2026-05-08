import type { PropertyData } from './supabase-queries'
import type { ParcelCollection } from './arcgis'

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${path} ${res.status}${text ? `: ${text}` : ''}`)
  }
  return res.json() as Promise<T>
}

export async function queryParcelsByBbox(
  west: number,
  south: number,
  east: number,
  north: number,
  county: string,
  signal?: AbortSignal,
): Promise<ParcelCollection> {
  const res = await fetch('/api/parcels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ west, south, east, north, county }),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API /api/parcels ${res.status}${text ? `: ${text}` : ''}`)
  }
  return res.json() as Promise<ParcelCollection>
}

export async function searchParcels(query: string, county: string): Promise<ParcelCollection> {
  return postJson<ParcelCollection>('/api/search', { query, county })
}

export async function queryParcelsInPolygon(
  polygon: [number, number][],
  county: string,
): Promise<ParcelCollection> {
  return postJson<ParcelCollection>('/api/parcels', { polygon, county })
}

export async function getParcelByKey(key: string): Promise<import('./arcgis').ParcelFeature> {
  const res = await fetch(`/api/parcel?key=${encodeURIComponent(key)}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API /api/parcel ${res.status}${text ? `: ${text}` : ''}`)
  }
  return res.json() as Promise<import('./arcgis').ParcelFeature>
}

export async function getPropertyData(parcelKey: string): Promise<PropertyData> {
  return postJson<PropertyData>('/api/property', { parcelKey })
}
