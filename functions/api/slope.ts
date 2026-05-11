// POST /api/slope: mean + max parcel slope from USGS 3DEP samples.
//
// Samples elevation at 5 points (4 corners + center of the bbox) from
// USGS 3DEP via the public ImageServer Identify endpoint. Computes slope
// between the center and each corner using geodesic distance and the
// elevation delta. Returns mean and max slope as percent (rise/run × 100).
//
// Why 5 points: balances upstream rate limits against signal. A 9-point
// grid would be more accurate but at 9 requests per click we'd push
// USGS load up for marginal gain on parcel-scale terrain.
//
// Caching: 1 hour at the edge. Slope doesn't change quickly and the
// upstream is the rate-limited resource.

import { validateBbox } from './_validate'

const USGS_IDENTIFY =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/identify'

interface IdentifyResp {
  // ArcGIS returns the elevation as `value` (string) on the Identify result.
  value?: string
}

async function sampleElevationMeters(lng: number, lat: number): Promise<number | null> {
  const geometry = JSON.stringify({
    x: lng,
    y: lat,
    spatialReference: { wkid: 4326 },
  })
  const url = `${USGS_IDENTIFY}?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`
  try {
    const res = await fetch(url, { cf: { cacheTtl: 3600 } })
    if (!res.ok) return null
    const data = (await res.json()) as IdentifyResp
    const v = data.value
    if (v == null) return null
    // USGS sometimes returns "NoData" or empty when outside coverage.
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    return n
  } catch {
    return null
  }
}

// Great-circle distance between two [lng, lat] points, in meters.
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

export const onRequestPost: PagesFunction = async (context) => {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { west, south, east, north } = (body ?? {}) as Record<string, unknown>
  const bbox = validateBbox(west, south, east, north)
  if (!bbox) return Response.json({ error: 'Invalid bbox' }, { status: 400 })

  const cx = (bbox.west + bbox.east) / 2
  const cy = (bbox.south + bbox.north) / 2

  // 4 corners + center, in lng/lat.
  const samples: Array<[number, number]> = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [cx, cy],
  ]

  // Sequential to stay under per-IP rate limits; 5 requests is fine.
  const elevations: Array<number | null> = []
  for (const [lng, lat] of samples) {
    const e = await sampleElevationMeters(lng, lat)
    elevations.push(e)
  }

  // Need at least the center + one corner for any slope.
  const centerElev = elevations[4]
  if (centerElev == null) {
    return Response.json(
      { meanSlopePct: null, maxSlopePct: null, samplesUsed: 0 },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      },
    )
  }

  const center: [number, number] = [cx, cy]
  let total = 0
  let count = 0
  let maxSlope = 0
  for (let i = 0; i < 4; i++) {
    const corner = samples[i]
    const cornerElev = elevations[i]
    if (!corner || cornerElev == null) continue
    const dm = haversineMeters(center, corner)
    if (dm <= 0) continue
    const slope = Math.abs(cornerElev - centerElev) / dm * 100
    total += slope
    count += 1
    if (slope > maxSlope) maxSlope = slope
  }

  if (count === 0) {
    return Response.json(
      { meanSlopePct: null, maxSlopePct: null, samplesUsed: 0 },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      },
    )
  }

  return new Response(
    JSON.stringify({
      meanSlopePct: total / count,
      maxSlopePct: maxSlope,
      samplesUsed: count + 1, // corners + center
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
