const ARCGIS_URL = 'https://gis.johnsoncitytn.org/arcgis/rest/services/ParcelPublishing/TaxParcels/MapServer/0'

function buildCountyWhere(county: string): string {
  if (county === 'ALL') {
    return `COUNTYNAME IN ('Sullivan County', 'Washington County', 'Carter County')`
  }
  return `COUNTYNAME = '${county} County'`
}

function escLike(s: string): string {
  return s.replace(/'/g, "''")
}

export interface Env {}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { query, county = 'ALL' } = await context.request.json()
    if (!query || query.trim().length < 2) {
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const q = escLike(query.trim())
    const where = `(${buildCountyWhere(county)}) AND (OWNER LIKE '%${q}%' OR ADDRESS LIKE '%${q}%' OR GISLINK LIKE '%${q}%')`
    const outFields = 'OBJECTID,GISLINK,CALC_ACRE,COUNTYNAME,CITYNAME,OWNER,OWNER2,ADDRESS,ST_NUM,STREET,PROPTYPE,ZONING,APPRAISAL,PRICE,SALEDATE,SALELABEL,MAILADDR,MAILCITY,STATE,ZIP,LATITUDE,LONGITUDE'
    const url = `${ARCGIS_URL}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}&outSR=4326&f=geojson&resultRecordCount=2000`

    const res = await fetch(url)
    if (!res.ok) return new Response(JSON.stringify({ error: 'ArcGIS error', status: res.status }), { status: 502 })
    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
}
