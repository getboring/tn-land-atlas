import { validateBbox, validateCounty } from './_validate'

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
  const { west, south, east, north, county } = (body ?? {}) as Record<string, unknown>

  const bbox = validateBbox(west, south, east, north)
  if (!bbox) return Response.json({ error: 'Invalid bbox' }, { status: 400 })

  const validCounty = validateCounty(county ?? 'ALL')
  if (!validCounty) return Response.json({ error: 'Invalid county' }, { status: 400 })

  const where = buildCountyWhere(validCounty)
  const url = `${ARCGIS_URL}/query?where=${encodeURIComponent(where)}&geometry=${encodeURIComponent(`${bbox.west},${bbox.south},${bbox.east},${bbox.north}`)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent(OUT_FIELDS)}&outSR=4326&f=geojson&resultRecordCount=2000`

  const res = await fetch(url, { cf: { cacheTtl: 300 } })
  if (!res.ok) {
    return Response.json({ error: 'ArcGIS error', status: res.status }, { status: 502 })
  }
  const data = await res.json()
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}
