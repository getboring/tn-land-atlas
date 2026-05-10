// ArcGIS REST type contract.
//
// These types describe what `/api/parcels`, `/api/parcel`, and `/api/search`
// return to the browser. Runtime fetches go through the Pages Functions
// (see `functions/api/`); this file is types-only — no fetch logic lives here.
//
// All ParcelProperties fields are nullable because the upstream ArcGIS
// layer reports null for any missing column on any given record. Consumers
// must handle null explicitly; never trust a field to be present.

/**
 * One parcel's tabular attributes, as returned by the Johnson City ArcGIS
 * upstream. Field names match the upstream column names exactly so the
 * out-fields whitelist in the Pages Functions stays one-to-one with the
 * type. Every field is nullable.
 */
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

/**
 * The discriminated GeoJSON geometry for a parcel.
 *
 * ArcGIS sometimes returns MultiPolygon parcels (split lots, parcels
 * straddling water, parts of a single recorded property). Carry the union
 * in the type so consumers narrow at use sites instead of trusting Polygon
 * and crashing on a MultiPolygon record. The build-fit module validates
 * this with `PolygonOrMultiSchema` at its workspace boundary; everything
 * else (centroid math, map filters, corner-node walk) must handle both.
 */
export type ParcelGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

/** A single parcel as a GeoJSON Feature with strongly-typed properties. */
export interface ParcelFeature {
  type: 'Feature'
  geometry: ParcelGeometry
  properties: ParcelProperties
}

/** A GeoJSON FeatureCollection of parcels (what /api/parcels returns). */
export interface ParcelCollection {
  type: 'FeatureCollection'
  features: ParcelFeature[]
}
