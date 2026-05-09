// Computed insights for parcel data. Every function here is pure (same input
// -> same output) and deterministic (no Date.now() except where the caller
// explicitly passes it in). That keeps them unit-testable without freezing
// time in test setup.
//
// Conventions ("rules of thumb"):
// - Money is whole dollars (ArcGIS gives whole-dollar APPRAISAL / PRICE).
// - Distances in meters internally, formatted as feet/miles for display
//   (US real-estate uses imperial).
// - Year length: 365.25 days (averages leap years).
// - Earth radius: 6371000 m (haversine convention).
// - Acreage tiers from rural-land-brokerage convention.
// - Holding-duration tiers from how long-tenured ownership is bucketed by
//   the appraisal community: < 2y recent, 2-15 established, 15-30 long-held,
//   30+ generational.
//
// Coordinate ordering: GeoJSON is always [longitude, latitude]. We follow
// that throughout.

import type { ParcelProperties, ParcelFeature } from './arcgis'

// ----------------------------------------------------------------------------
// $/acre — appraised value normalized by parcel size.
// ----------------------------------------------------------------------------
export function pricePerAcre(appraisal: number | null | undefined, acres: number | null | undefined): number | null {
  if (!appraisal || !acres || appraisal <= 0 || acres <= 0) return null
  if (!Number.isFinite(appraisal) || !Number.isFinite(acres)) return null
  return appraisal / acres
}

export function formatPricePerAcre(usdPerAcre: number | null): string | null {
  if (usdPerAcre == null) return null
  // Whole dollars, comma-formatted, with a /ac suffix.
  return `$${Math.round(usdPerAcre).toLocaleString()}/ac`
}

// ----------------------------------------------------------------------------
// Years held — time since the last recorded sale.
// `now` is injected so tests are reproducible without freezing time.
// ----------------------------------------------------------------------------
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

export function yearsHeld(saleDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!saleDate) return null
  const d = parseSaleDate(saleDate)
  if (!d) return null
  const ms = now.getTime() - d.getTime()
  if (ms < 0) return null
  return ms / MS_PER_YEAR
}

// ArcGIS sometimes returns ISO strings, sometimes M/D/YYYY, sometimes a
// number-of-millis-since-epoch. Cover the three common shapes.
export function parseSaleDate(raw: string | number | null | undefined): Date | null {
  if (raw == null) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(raw)
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  // ISO-style "1988-09-16" or "1988-09-16T00:00:00Z"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // M/D/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const [, mo, day, yr] = m
    const d = new Date(Number(yr), Number(mo) - 1, Number(day))
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

// ----------------------------------------------------------------------------
// Holding-duration tier.
// ----------------------------------------------------------------------------
export type HoldingTier = 'recent' | 'established' | 'long-held' | 'generational'

export function holdingTier(years: number | null): HoldingTier | null {
  if (years == null || !Number.isFinite(years) || years < 0) return null
  if (years < 2) return 'recent'
  if (years < 15) return 'established'
  if (years < 30) return 'long-held'
  return 'generational'
}

// ----------------------------------------------------------------------------
// Acreage tier — TN Rural Land Brokers convention.
// ----------------------------------------------------------------------------
export type AcreageTier = 'lot' | 'residential' | 'country' | 'small-acreage' | 'medium-acreage' | 'large-acreage'

export function acreageTier(acres: number | null | undefined): AcreageTier | null {
  if (acres == null || !Number.isFinite(acres) || acres <= 0) return null
  if (acres < 0.25) return 'lot'
  if (acres < 1) return 'residential'
  if (acres < 5) return 'country'
  if (acres < 25) return 'small-acreage'
  if (acres < 100) return 'medium-acreage'
  return 'large-acreage'
}

export function acreageTierLabel(t: AcreageTier): string {
  return {
    lot: 'Lot',
    residential: 'Residential',
    country: 'Country',
    'small-acreage': 'Small acreage',
    'medium-acreage': 'Medium acreage',
    'large-acreage': 'Large acreage',
  }[t]
}

// ----------------------------------------------------------------------------
// Sale-to-appraisal ratio (last sale vs current appraisal).
// ----------------------------------------------------------------------------
export function saleToAppraisalRatio(price: number | null | undefined, appraisal: number | null | undefined): number | null {
  if (!price || !appraisal || price <= 0 || appraisal <= 0) return null
  if (!Number.isFinite(price) || !Number.isFinite(appraisal)) return null
  return price / appraisal
}

// ----------------------------------------------------------------------------
// Owner-occupied vs absentee.
// We compare the parcel address number against the mail address number,
// require the mail city to match the parcel city, and the mail state to be TN.
// Strict definition: both number AND city must match.
// ----------------------------------------------------------------------------
export type Occupancy = 'owner-occupied' | 'absentee'

export function occupancy(p: Pick<ParcelProperties, 'ADDRESS' | 'MAILADDR' | 'CITYNAME' | 'MAILCITY' | 'STATE'>): Occupancy | null {
  const addr = (p.ADDRESS ?? '').trim()
  const mail = (p.MAILADDR ?? '').trim()
  const city = (p.CITYNAME ?? '').trim().toUpperCase()
  const mailCity = (p.MAILCITY ?? '').trim().toUpperCase()
  const state = (p.STATE ?? '').trim().toUpperCase()
  if (!addr || !mail) return null
  const addrNum = firstNumberToken(addr)
  const mailNum = firstNumberToken(mail)
  if (addrNum == null || mailNum == null) return null
  if (addrNum === mailNum && city && mailCity && city === mailCity && state === 'TN') {
    return 'owner-occupied'
  }
  return 'absentee'
}

// First contiguous run of digits in a string. ArcGIS addresses come as either
// "112 FOXHALL CIR" or "FOXHALL CIR 112" — we don't care about position.
export function firstNumberToken(s: string): string | null {
  const m = s.match(/\d+/)
  return m ? m[0] : null
}

// ----------------------------------------------------------------------------
// Out-of-state owner mailing.
// ----------------------------------------------------------------------------
export function outOfState(state: string | null | undefined): boolean {
  if (!state) return false
  return state.trim().toUpperCase() !== 'TN'
}

// ----------------------------------------------------------------------------
// Entity ownership — name-based regex against common business / org suffixes.
// Returns null when the owner reads as an individual.
// ----------------------------------------------------------------------------
export type EntityKind = 'llc' | 'inc' | 'lp' | 'trust' | 'corp' | 'foundation' | 'church' | 'government'

const ENTITY_PATTERNS: Array<[RegExp, EntityKind]> = [
  [/\bLLC\b|\bL\.L\.C\.?\b/i, 'llc'],
  [/\bINC\b|\bINCORPORATED\b/i, 'inc'],
  [/\bLP\b|\bL\.P\.?\b|\bLIMITED PARTNERSHIP\b/i, 'lp'],
  [/\bTRUST\b|\bTRUSTEE\b/i, 'trust'],
  [/\bCORP\b|\bCORPORATION\b/i, 'corp'],
  [/\bFOUNDATION\b/i, 'foundation'],
  [/\bCHURCH\b|\bMINISTR(?:Y|IES)\b|\bDIOCESE\b/i, 'church'],
  [/\bCITY OF\b|\bCOUNTY OF\b|\bSTATE OF\b|\bUSA\b|\bUNITED STATES\b/i, 'government'],
]

export function entityKind(owner: string | null | undefined): EntityKind | null {
  if (!owner) return null
  for (const [re, kind] of ENTITY_PATTERNS) {
    if (re.test(owner)) return kind
  }
  return null
}

// ----------------------------------------------------------------------------
// Polygon centroid using the shoelace formula. For arbitrary closed rings;
// degenerates gracefully (returns null) when area is zero or the input is
// malformed.
//
// Accepts Polygon or MultiPolygon (ArcGIS occasionally returns the latter).
// ----------------------------------------------------------------------------
export function centroid(geometry: ParcelFeature['geometry'] | { type: 'MultiPolygon'; coordinates: number[][][][] }): [number, number] | null {
  const rings = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : (geometry as { type: 'MultiPolygon'; coordinates: number[][][][] }).coordinates
  // For MultiPolygon, take the largest polygon by absolute signed area.
  let bestCx = 0
  let bestCy = 0
  let bestAbsA = 0
  for (const polygon of rings) {
    const ring = polygon[0]
    if (!Array.isArray(ring) || ring.length < 3) continue
    let cx = 0
    let cy = 0
    let a2 = 0 // 2*area
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const cross = x0 * y1 - x1 * y0
      a2 += cross
      cx += (x0 + x1) * cross
      cy += (y0 + y1) * cross
    }
    if (a2 === 0) continue
    const cxNorm = cx / (3 * a2)
    const cyNorm = cy / (3 * a2)
    const absA = Math.abs(a2 / 2)
    if (absA > bestAbsA) {
      bestAbsA = absA
      bestCx = cxNorm
      bestCy = cyNorm
    }
  }
  if (bestAbsA === 0) return null
  return [bestCx, bestCy]
}

// ----------------------------------------------------------------------------
// Haversine distance between two [lng, lat] points, meters.
// Earth radius 6371000 m (sphere approximation; ~0.5% error globally,
// negligible for parcel-scale measurements).
// ----------------------------------------------------------------------------
const EARTH_R = 6371000

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_R * Math.asin(Math.sqrt(x))
}

// ----------------------------------------------------------------------------
// Display formatters.
// ----------------------------------------------------------------------------
export function formatYearsHeld(years: number | null): string | null {
  if (years == null || !Number.isFinite(years)) return null
  if (years < 1) {
    const months = Math.max(1, Math.round(years * 12))
    return `${months} mo`
  }
  return `${Math.floor(years)} yr${Math.floor(years) === 1 ? '' : 's'}`
}

export function formatRatioPercent(ratio: number | null): string | null {
  if (ratio == null || !Number.isFinite(ratio)) return null
  return `${Math.round(ratio * 100)}%`
}

// ----------------------------------------------------------------------------
// passesFilters — does a parcel feature match a set of computed filter flags?
// All flags are AND'd together; an unset flag is a pass.
// `now` is injected so the recent/long-held checks are testable.
// ----------------------------------------------------------------------------

export interface ParcelFilterFlags {
  entityOnly: boolean
  outOfStateOnly: boolean
  absenteeOnly: boolean
  recentSaleOnly: boolean
  longHeldOnly: boolean
  minAcres: number | null
}

const RECENT_SALE_YRS = 5
const LONG_HELD_YRS = 20

export function passesFilters(
  p: Pick<ParcelProperties, 'OWNER' | 'STATE' | 'ADDRESS' | 'MAILADDR' | 'CITYNAME' | 'MAILCITY' | 'CALC_ACRE' | 'SALEDATE'>,
  f: ParcelFilterFlags,
  now: Date = new Date(),
): boolean {
  if (f.entityOnly && entityKind(p.OWNER) == null) return false
  if (f.outOfStateOnly && !outOfState(p.STATE)) return false
  if (f.absenteeOnly && occupancy(p) !== 'absentee') return false
  if (f.minAcres != null && f.minAcres > 0) {
    if (!p.CALC_ACRE || p.CALC_ACRE < f.minAcres) return false
  }
  if (f.recentSaleOnly || f.longHeldOnly) {
    const yrs = yearsHeld(p.SALEDATE, now)
    if (yrs == null) return false
    if (f.recentSaleOnly && yrs > RECENT_SALE_YRS) return false
    if (f.longHeldOnly && yrs < LONG_HELD_YRS) return false
  }
  return true
}

// ----------------------------------------------------------------------------
// External map deeplinks — meet the user's "open in Maps / Street View" need.
// ----------------------------------------------------------------------------
export function appleMapsUrl(lng: number, lat: number, label?: string): string {
  const params = new URLSearchParams({ ll: `${lat},${lng}` })
  if (label) params.set('q', label)
  return `https://maps.apple.com/?${params.toString()}`
}

export function googleMapsUrl(lng: number, lat: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

export function googleStreetViewUrl(lng: number, lat: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
}
