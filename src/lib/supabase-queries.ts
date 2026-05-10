// Type-only definitions for the enriched property data returned by
// `/api/property`.
//
// A runtime Supabase client used to live in this file; it's been removed
// in favor of the server-side proxy in `functions/api/property.ts`. Adding
// `@supabase/supabase-js` back as a browser dep would break the
// security model (anon key in the bundle, RLS bypass risk) so don't.
//
// Field names mirror the Supabase column names exactly so a schema change
// upstream surfaces as a TS error here.

/** One building improvement on a parcel (a parcel can have several). */
export interface BuildingRecord {
  parcel_key: string
  building_number: number
  improvement_type: string | null
  sqft_living: number | null
  year_built: number | null
  quality: string | null
  condition: string | null
  stories: number | null
  exterior_wall: string | null
  heat_ac: string | null
  foundation: string | null
  zoning: string | null
  deed_acres: number | null
}

/** Latest county valuation for a parcel. Values are whole dollars. */
export interface ValuationRecord {
  parcel_key: string
  land_value: number
  improvement_value: number
  total_appraisal: number
  assessment: number
}

/**
 * One recorded sale of a parcel. The `/api/property` route filters out
 * non-arms-length transfers (price > 0) and orders by sale_date desc.
 */
export interface SaleRecord {
  parcel_key: string
  sale_date: string
  price: number
  deed_book: string
  deed_page: string
  instrument_type: string
  qualification: string
  vacant_improved: string
}

/**
 * One LLC / corporation / partnership linked to a parcel through the
 * `property_entities` join table. Entity ownership of land is the entry
 * point for entity-network analysis (multiple parcels owned by the same
 * LLC, principals across LLCs, etc.).
 */
export interface EntityRecord {
  id: string
  name: string
  entity_type: string
  state: string | null
  filing_number: string | null
  status: string | null
  registered_agent: string | null
  notes: string | null
  aliases: string[]
}

/**
 * Composite response shape from `/api/property`. Per-table failures on the
 * server degrade to empty arrays / null; the shape itself is always present.
 */
export interface PropertyData {
  buildings: BuildingRecord[]
  valuation: ValuationRecord | null
  sales: SaleRecord[]
  entities: EntityRecord[]
}
