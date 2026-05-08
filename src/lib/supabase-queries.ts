import { supabase } from './supabase'

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

export interface PersonProperty {
  canonical_name: string
  relationship: string
  parcel_count: number
  total_assessed_value: number
}

export async function getBuildings(parcelKey: string): Promise<BuildingRecord[]> {
  const { data, error } = await supabase
    .from('buildings')
    .select('*')
    .eq('parcel_key', parcelKey)
  if (error) throw error
  return data || []
}

export async function getValuation(parcelKey: string): Promise<ValuationRecord | null> {
  const { data, error } = await supabase
    .from('valuations')
    .select('*')
    .eq('parcel_key', parcelKey)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getSales(parcelKey: string): Promise<SaleRecord[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('parcel_key', parcelKey)
    .gt('price', 0)
    .order('sale_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getEntitiesForParcel(parcelKey: string): Promise<EntityRecord[]> {
  const { data: links, error: linkErr } = await supabase
    .from('property_entities')
    .select('entity_id')
    .eq('parcel_key', parcelKey)
  if (linkErr) throw linkErr
  if (!links?.length) return []

  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .in('id', links.map((l) => l.entity_id))
  if (error) throw error
  return data || []
}

export async function getPersonsForParcel(parcelKey: string): Promise<PersonProperty[]> {
  const { data, error } = await supabase
    .from('person_parcels')
    .select('person_id, ownership_type, persons(canonical_name, relationship_to_subject)')
    .eq('parcel_key', parcelKey)
  if (error) throw error
  if (!data) return []

  return data.map((row: any) => ({
    canonical_name: row.persons?.canonical_name || 'Unknown',
    relationship: row.persons?.relationship_to_subject || '',
    parcel_count: 0,
    total_assessed_value: 0,
  }))
}
