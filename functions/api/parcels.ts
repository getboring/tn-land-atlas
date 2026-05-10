// POST /api/parcels: spatial query against the Johnson City ArcGIS upstream.
//
// Accepts either a `polygon` ring (lasso path) or a bbox via
// `{ west, south, east, north }` (default viewport path). County defaults
// to `'ALL'` (cross-county). Everything user-supplied flows through
// `_validate.ts` first. Returns GeoJSON capped at 2000 records.
//
// Cache: lasso responses are 30s, bbox responses are 60s; ArcGIS itself
// gets a `cf.cacheTtl` hint of 60s (polygon) or 300s (bbox) to ease load
// on the upstream during high-traffic windows.
//
// On upstream failure we log the body for our own observability but return
// only a generic `502 Upstream error` so we never leak internal URLs.

import { validateBbox, validateCounty, validatePolygonRing } from './_validate'

const ARCGIS_URL = 'https://gis.johnsoncitytn.org/arcgis/rest/services/ParcelPublishing/TaxParcels/MapServer/0'

function buildCountyWhere(county: string): string {
  if (county === 'ALL') {
    return `COUNTYNAME IN ('Sullivan County', 'Washington County', 'Carter County')`
  }
  return `COUNTYNAME = '${county} County'`
}

const OUT_FIELDS = 'OBJECTID,GISLINK,CALC_ACRE,COUNTYNAME,CITYNAME,OWNER,OWNER2,ADDRESS,ST_NUM,STREET,PROPTYPE,ZONING,APPRAISAL,PRICE,SALEDATE,SALELABEL,MAILADDR,MAILCITY,STATE,ZIP,LATITUDE,LONGITUDE'

export const onRequestPost: PagesFunction = async (context) => {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { west, south, east, north, county, polygon } = (body ?? {}) as Record<string, unknown>

  const validCounty = validateCounty(county ?? 'ALL')
  if (!validCounty) return Response.json({ error: 'Invalid county' }, { status: 400 })

  const where = buildCountyWhere(validCounty)

  // Polygon path: spatial filter against an arbitrary ring (lasso tool).
  if (polygon !== undefined) {
    const ring = validatePolygonRing(polygon)
    if (!ring) return Response.json({ error: 'Invalid polygon' }, { status: 400 })
    const geom = JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } })
    const url = `${ARCGIS_URL}/query?where=${encodeURIComponent(where)}&geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPolygon&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent(OUT_FIELDS)}&outSR=4326&f=geojson&resultRecordCount=2000`
    const res = await fetch(url, { cf: { cacheTtl: 60 } })
    if (!res.ok) {
      // Log the upstream body for ourselves so a CF Logs Push viewer can see
      // what ArcGIS actually said. Don't echo the body to the client — could
      // include internal endpoint details.
      const detail = await res.text().catch(() => '')
      console.error('[parcels:polygon] ArcGIS', res.status, detail.slice(0, 500))
      return Response.json({ error: 'Upstream error' }, { status: 502 })
    }
    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
    })
  }

  // Bbox path (default).
  const bbox = validateBbox(west, south, east, north)
  if (!bbox) return Response.json({ error: 'Invalid bbox' }, { status: 400 })

  const url = `${ARCGIS_URL}/query?where=${encodeURIComponent(where)}&geometry=${encodeURIComponent(`${bbox.west},${bbox.south},${bbox.east},${bbox.north}`)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent(OUT_FIELDS)}&outSR=4326&f=geojson&resultRecordCount=2000`

  const res = await fetch(url, { cf: { cacheTtl: 300 } })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[parcels:bbox] ArcGIS', res.status, detail.slice(0, 500))
    return Response.json({ error: 'Upstream error' }, { status: 502 })
  }
  const data = await res.json()
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}
