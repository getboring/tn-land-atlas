import { validateCounty, validateQuery } from './_validate'

const ARCGIS_URL = 'https://gis.johnsoncitytn.org/arcgis/rest/services/ParcelPublishing/TaxParcels/MapServer/0'

function buildCountyWhere(county: string): string {
  if (county === 'ALL') {
    return `COUNTYNAME IN ('Sullivan County', 'Washington County', 'Carter County')`
  }
  return `COUNTYNAME = '${county} County'`
}

// ArcGIS WHERE strings are single-quoted SQL literals. Doubling single quotes is
// the standard escape; the additional charset whitelist in validateQuery() is
// defense in depth.
function escSql(s: string): string {
  return s.replace(/'/g, "''")
}

const OUT_FIELDS = 'OBJECTID,GISLINK,CALC_ACRE,COUNTYNAME,CITYNAME,OWNER,OWNER2,ADDRESS,ST_NUM,STREET,PROPTYPE,ZONING,APPRAISAL,PRICE,SALEDATE,SALELABEL,MAILADDR,MAILCITY,STATE,ZIP,LATITUDE,LONGITUDE'

export interface Env {}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { query, county } = (body ?? {}) as Record<string, unknown>

  const cleanQuery = validateQuery(query)
  if (!cleanQuery) return Response.json({ error: 'Invalid query' }, { status: 400 })

  const validCounty = validateCounty(county ?? 'ALL')
  if (!validCounty) return Response.json({ error: 'Invalid county' }, { status: 400 })

  const q = escSql(cleanQuery)
  const where = `(${buildCountyWhere(validCounty)}) AND (OWNER LIKE '%${q}%' OR ADDRESS LIKE '%${q}%' OR GISLINK LIKE '%${q}%')`
  const url = `${ARCGIS_URL}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(OUT_FIELDS)}&outSR=4326&f=geojson&resultRecordCount=2000`

  const res = await fetch(url)
  if (!res.ok) return Response.json({ error: 'ArcGIS error', status: res.status }, { status: 502 })
  const data = await res.json()
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}
