// POST /api/flood: FEMA NFHL flood-hazard polygons intersecting a bbox.
//
// Proxies the FEMA National Flood Hazard Layer's ArcGIS REST endpoint
// (free, public, no API key). The upstream layer is the National Flood
// Hazard Layer / Flood Hazard Zones (S_FLD_HAZ_AR), which carries the
// `FLD_ZONE` attribute that codes each zone:
//   X      Minimal hazard (outside SFHA). Not flagged.
//   X500   0.2% annual chance (500-year). Flagged as info.
//   A      1% annual chance, no base flood elevation. Flagged as warning.
//   AE     1% annual chance WITH base flood elevation. Flagged as warning.
//   AO     1% annual chance sheet flow. Flagged as warning.
//   AH     1% annual chance ponding. Flagged as warning.
//   V / VE 1% annual chance + wave hazard (coastal). Flagged as error.
//   D      Undetermined. Flagged as info.
//
// We don't classify here — that's the client's job. This route is a thin
// validated proxy.
//
// Caching: FEMA updates the NFHL at most monthly. Cache 1 hour at the edge.

import { validateBbox } from './_validate'

const NFHL_BASE =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer'

// Layer 28 = "Flood Hazard Zones" (S_FLD_HAZ_AR).
// Verified by browsing https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer
// Layer index is stable; if FEMA renumbers it, this breaks and we surface
// a 502.
const FLOOD_HAZARD_LAYER_ID = 28

const OUT_FIELDS = 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE'

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

  // ArcGIS envelope filter, output as GeoJSON.
  const geometry = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
  const url = `${NFHL_BASE}/${FLOOD_HAZARD_LAYER_ID}/query?where=1%3D1&geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent(OUT_FIELDS)}&outSR=4326&f=geojson&resultRecordCount=500`

  const res = await fetch(url, { cf: { cacheTtl: 3600 } })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[flood] FEMA NFHL', res.status, detail.slice(0, 500))
    return Response.json({ error: 'Upstream error' }, { status: 502 })
  }
  const data = await res.json()
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
