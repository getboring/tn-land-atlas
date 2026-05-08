// Type-only definitions for the enriched property data returned by /api/property.
// The runtime Supabase client used to live alongside these — it has been removed in
// favor of the server-side proxy in functions/api/property.ts.

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

export interface ValuationRecord {
  parcel_key: string
  land_value: number
  improvement_value: number
  total_appraisal: number
  assessment: number
}

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

export interface PropertyData {
  buildings: BuildingRecord[]
  valuation: ValuationRecord | null
  sales: SaleRecord[]
  entities: EntityRecord[]
}
