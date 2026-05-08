const ARCGIS_URL = 'https://gis.johnsoncitytn.org/arcgis/rest/services/ParcelPublishing/TaxParcels/MapServer/0'

export interface ParcelFeature {
  type: 'Feature'
  geometry: {
    type: 'Polygon'
    coordinates: number[][][]
  }
  properties: Record<string, unknown>
}

export interface ParcelCollection {
  type: 'FeatureCollection'
  features: ParcelFeature[]
}

export function buildCountyWhere(county: string): string {
  if (county === 'ALL') {
    return `COUNTYNAME IN ('Sullivan County', 'Washington County', 'Carter County')`
  }
  return `COUNTYNAME = '${county} County'`
}

export async function queryParcelsByBbox(
  west: number,
  south: number,
  east: number,
  north: number,
  county: string = 'ALL',
  signal?: AbortSignal
): Promise<ParcelCollection> {
  const where = buildCountyWhere(county)
  const outFields = 'OBJECTID,GISLINK,CALC_ACRE,COUNTYNAME,CITYNAME,OWNER,OWNER2,ADDRESS,ST_NUM,STREET,PROPTYPE,ZONING,APPRAISAL,PRICE,SALEDATE,SALELABEL,MAILADDR,MAILCITY,STATE,ZIP,LATITUDE,LONGITUDE'
  const url = `${ARCGIS_URL}/query?where=${encodeURIComponent(where)}&geometry=${encodeURIComponent(`${west},${south},${east},${north}`)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent(outFields)}&outSR=4326&f=geojson&resultRecordCount=2000`

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`ArcGIS error: ${res.status}`)
  return res.json()
}

export async function searchParcels(
  query: string,
  county: string = 'ALL'
): Promise<ParcelCollection> {
  const where = `(${buildCountyWhere(county)}) AND (OWNER LIKE '%${query.replace(/'/g, "''")}%' OR ADDRESS LIKE '%${query.replace(/'/g, "''")}%' OR GISLINK LIKE '%${query.replace(/'/g, "''")}%')`
  const outFields = 'OBJECTID,GISLINK,CALC_ACRE,COUNTYNAME,CITYNAME,OWNER,OWNER2,ADDRESS,ST_NUM,STREET,PROPTYPE,ZONING,APPRAISAL,PRICE,SALEDATE,SALELABEL,MAILADDR,MAILCITY,STATE,ZIP,LATITUDE,LONGITUDE'
  const url = `${ARCGIS_URL}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}&outSR=4326&f=geojson&resultRecordCount=2000`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`ArcGIS error: ${res.status}`)
  return res.json()
}
