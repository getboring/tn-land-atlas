// ArcGIS REST helpers — used as the type contract for what /api/parcels and
// /api/search return. Runtime queries go through the server proxy in
// functions/api/parcels.ts and functions/api/search.ts.

export interface ParcelProperties {
  OBJECTID: number
  GISLINK: string | null
  CALC_ACRE: number | null
  COUNTYNAME: string | null
  CITYNAME: string | null
  OWNER: string | null
  OWNER2: string | null
  ADDRESS: string | null
  ST_NUM: string | null
  STREET: string | null
  PROPTYPE: string | null
  ZONING: string | null
  APPRAISAL: number | null
  PRICE: number | null
  SALEDATE: string | null
  SALELABEL: string | null
  MAILADDR: string | null
  MAILCITY: string | null
  STATE: string | null
  ZIP: string | null
  LATITUDE: number | null
  LONGITUDE: number | null
}

// ArcGIS sometimes returns MultiPolygon parcels (split lots, parcels
// straddling water, parts of a single recorded property). Carry the union
// in the type so consumers narrow at use sites instead of trusting Polygon
// and crashing on the field. Build-fit already validates at its workspace
// boundary; the rest of the app (centroid, map filters, corner-node walk)
// is being aligned to match.
export type ParcelGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

export interface ParcelFeature {
  type: 'Feature'
  geometry: ParcelGeometry
  properties: ParcelProperties
}

export interface ParcelCollection {
  type: 'FeatureCollection'
  features: ParcelFeature[]
}
