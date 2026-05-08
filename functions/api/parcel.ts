// GET /api/parcel?key=<GISLINK>  -> single GeoJSON Feature (or 404)
//
// Permalink consumer: when the page loads with ?parcel=<key>, the client
// fetches this endpoint to populate the detail sidebar without first
// having to pan/zoom the map.

import { validateQuery } from './_validate'

const ARCGIS_URL = 'https://gis.johnsoncitytn.org/arcgis/rest/services/ParcelPublishing/TaxParcels/MapServer/0'

const OUT_FIELDS = 'OBJECTID,GISLINK,CALC_ACRE,COUNTYNAME,CITYNAME,OWNER,OWNER2,ADDRESS,ST_NUM,STREET,PROPTYPE,ZONING,APPRAISAL,PRICE,SALEDATE,SALELABEL,MAILADDR,MAILCITY,STATE,ZIP,LATITUDE,LONGITUDE'

function escSql(s: string): string {
  return s.replace(/'/g, "''")
}

export const onRequestGet: PagesFunction = async (context) => {
  const url = new URL(context.request.url)
  const rawKey = url.searchParams.get('key')
  // GISLINK looks like "090046M H 01300" — alphanumeric + spaces. Reuse the
  // shared query validator (same charset rules apply).
  const key = validateQuery(rawKey)
  if (!key) return Response.json({ error: 'Invalid key' }, { status: 400 })

  const where = `GISLINK = '${escSql(key)}'`
  const arcUrl = `${ARCGIS_URL}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(OUT_FIELDS)}&outSR=4326&f=geojson&resultRecordCount=1`

  const res = await fetch(arcUrl, { cf: { cacheTtl: 300 } })
  if (!res.ok) return Response.json({ error: 'ArcGIS error', status: res.status }, { status: 502 })
  const data = (await res.json()) as { features?: unknown[] }
  if (!data.features || data.features.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return new Response(JSON.stringify(data.features[0]), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  })
}
