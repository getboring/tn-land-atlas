// Computed insights for parcel data.
//
// Every function here is pure (same input -> same output) and deterministic
// (no `Date.now()` except where the caller explicitly passes it in via
// `now: Date`). That keeps them unit-testable without freezing time in
// test setup, and lets the UI render with a deterministic timestamp when
// printing a handout.
//
// Conventions:
// - Money is whole dollars (the ArcGIS upstream returns whole-dollar
//   APPRAISAL / PRICE; converting to cents would lose precision for no
//   gain). The build-fit module separately uses integer cents for any
//   user-entered money.
// - Distances are in meters internally, formatted as feet/miles for
//   display (US real-estate convention is imperial).
// - Year length: 365.25 days (averages leap years).
// - Earth radius: 6371000 m (haversine sphere convention, ~0.5%
//   ellipsoid error globally, negligible at parcel scale).
// - Acreage tiers come from the TN rural-land-brokerage convention.
// - Holding-duration tiers match how the appraisal community buckets
//   tenure: < 2y recent, 2-15 established, 15-30 long-held,
//   30+ generational.
//
// Coordinate ordering: GeoJSON is always `[longitude, latitude]`. We
// follow that throughout. The detail panel surfaces lat/lng in display
// order; the conversion happens at the UI seam, not here.

import type { ParcelProperties, ParcelFeature } from './arcgis'

// ── $/acre ─────────────────────────────────────────────────────────────────

/**
 * Appraised value normalized by parcel size.
 *
 * @returns `appraisal / acres` (whole dollars per acre), or `null` when
 *   either input is missing, non-positive, or non-finite.
 *
 * @example
 * pricePerAcre(250000, 2.5) // -> 100000
 * pricePerAcre(250000, 0)   // -> null
 * pricePerAcre(null, 2.5)   // -> null
 */
export function pricePerAcre(appraisal: number | null | undefined, acres: number | null | undefined): number | null {
  if (!appraisal || !acres || appraisal <= 0 || acres <= 0) return null
  if (!Number.isFinite(appraisal) || !Number.isFinite(acres)) return null
  return appraisal / acres
}

/**
 * Render a `$/ac` value for the parcel detail panel.
 *
 * @returns Whole-dollar, comma-formatted string with a `/ac` suffix,
 *   or `null` when the input is null.
 */
export function formatPricePerAcre(usdPerAcre: number | null): string | null {
  if (usdPerAcre == null) return null
  return `$${Math.round(usdPerAcre).toLocaleString()}/ac`
}

// ── Years held ─────────────────────────────────────────────────────────────

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

/**
 * Fractional years between the parcel's last sale and `now`.
 *
 * @param saleDate Raw sale date as ArcGIS returned it (any of the three
 *   formats {@link parseSaleDate} accepts).
 * @param now Reference time. Defaults to `new Date()` but accept the
 *   override so tests are time-independent.
 * @returns Fractional years held, or `null` when the sale date is
 *   missing, unparseable, or in the future.
 */
export function yearsHeld(saleDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!saleDate) return null
  const d = parseSaleDate(saleDate)
  if (!d) return null
  const ms = now.getTime() - d.getTime()
  if (ms < 0) return null
  return ms / MS_PER_YEAR
}

/**
 * Parse a sale date from the three shapes the ArcGIS upstream returns:
 * an ISO timestamp ("1988-09-16" or "1988-09-16T00:00:00Z"), a US-format
 * "M/D/YYYY", or a number-of-milliseconds-since-epoch.
 *
 * @returns A valid Date, or `null` when the input doesn't match any
 *   recognized shape.
 */
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

// ── Holding-duration tier ──────────────────────────────────────────────────

/** Buckets for "how long has the current owner held this parcel". */
export type HoldingTier = 'recent' | 'established' | 'long-held' | 'generational'

/**
 * Bucket a years-held value into one of {@link HoldingTier}'s labels.
 * Returns `null` for missing, non-finite, or negative inputs.
 */
export function holdingTier(years: number | null): HoldingTier | null {
  if (years == null || !Number.isFinite(years) || years < 0) return null
  if (years < 2) return 'recent'
  if (years < 15) return 'established'
  if (years < 30) return 'long-held'
  return 'generational'
}

// ── Acreage tier (TN Rural Land Brokers convention) ────────────────────────

/** Parcel-size buckets used in the detail panel and filter sheet. */
export type AcreageTier = 'lot' | 'residential' | 'country' | 'small-acreage' | 'medium-acreage' | 'large-acreage'

/**
 * Bucket a parcel by acres into a brokerage-convention tier.
 * Returns `null` for missing, non-finite, or non-positive inputs.
 */
export function acreageTier(acres: number | null | undefined): AcreageTier | null {
  if (acres == null || !Number.isFinite(acres) || acres <= 0) return null
  if (acres < 0.25) return 'lot'
  if (acres < 1) return 'residential'
  if (acres < 5) return 'country'
  if (acres < 25) return 'small-acreage'
  if (acres < 100) return 'medium-acreage'
  return 'large-acreage'
}

/** Map an {@link AcreageTier} to its human-readable label. */
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

// ── Sale-to-appraisal ratio ────────────────────────────────────────────────

/**
 * Last recorded sale price relative to the current appraisal.
 *
 * Ratios near 1.0 are expected on recent arms-length transactions; very
 * low ratios may flag a non-arms-length transfer (gift, intra-family),
 * very high ratios may flag an over-appraisal worth investigating.
 *
 * @returns `price / appraisal`, or `null` when either input is missing,
 *   non-positive, or non-finite.
 */
export function saleToAppraisalRatio(price: number | null | undefined, appraisal: number | null | undefined): number | null {
  if (!price || !appraisal || price <= 0 || appraisal <= 0) return null
  if (!Number.isFinite(price) || !Number.isFinite(appraisal)) return null
  return price / appraisal
}

// ── Owner-occupied vs absentee ─────────────────────────────────────────────

/** Whether the owner's mailing address matches the parcel address. */
export type Occupancy = 'owner-occupied' | 'absentee'

/**
 * Classify a parcel as owner-occupied or absentee.
 *
 * Strict definition: the parcel address number AND the mailing address
 * number must match, the cities must match, and the mailing state must
 * be TN. Any other state (or any unparseable address) returns
 * `'absentee'` when both addresses are present, `null` when either is
 * missing.
 */
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

/**
 * First contiguous run of digits in a string.
 *
 * Used to extract the street number from an ArcGIS address, which can be
 * formatted as either `"112 FOXHALL CIR"` or `"FOXHALL CIR 112"` — we
 * don't care about position, only that we can recover a comparable number.
 *
 * @returns The digit run as a string, or `null` if no digits are present.
 */
export function firstNumberToken(s: string): string | null {
  const m = s.match(/\d+/)
  return m ? m[0] : null
}

// ── Out-of-state owner mailing ─────────────────────────────────────────────

/**
 * True when the mailing state is set AND is not TN (case-insensitive,
 * trimmed). A null/empty state is treated as in-state because the
 * mailing-address state column is occasionally blank for TN owners.
 */
export function outOfState(state: string | null | undefined): boolean {
  if (!state) return false
  return state.trim().toUpperCase() !== 'TN'
}

// ── Entity ownership ───────────────────────────────────────────────────────

/** Categories of non-individual owners detectable from the OWNER string. */
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

/**
 * Detect whether an OWNER string names an LLC / corporation / trust /
 * church / government entity, and which kind.
 *
 * Pattern-matched against the trailing legal-suffix conventions used in
 * TN business filings. First match wins (the patterns are ordered by
 * specificity).
 *
 * @returns The matched {@link EntityKind}, or `null` when the owner
 *   reads as an individual.
 */
export function entityKind(owner: string | null | undefined): EntityKind | null {
  if (!owner) return null
  for (const [re, kind] of ENTITY_PATTERNS) {
    if (re.test(owner)) return kind
  }
  return null
}

// ── Owner search ───────────────────────────────────────────────────────────

const TRAILING_SUFFIX_RE =
  /[\s,]*\b(LLC|L\.L\.C\.?|INC(?:ORPORATED)?|LP|L\.P\.?|LIMITED PARTNERSHIP|CORP(?:ORATION)?|TRUST(?:EE)?|FOUNDATION|FOUND\.?)\.?\s*$/i

/**
 * Compute the query string that will find OTHER parcels owned by the
 * same person or entity.
 *
 * Strategy:
 * - Entity owners: keep the distinctive name, drop the trailing legal
 *   suffix. `"JOHNSON CITY MEDICAL CENTER LLC"` -> `"JOHNSON CITY MEDICAL CENTER"`.
 * - Individual owners: surname only — the first token before `&` (joint
 *   ownership) or `,` (formal name form). ArcGIS stores names as
 *   `"LASTNAME FIRSTNAME"` or `"LASTNAME, FIRSTNAME"` so the first token
 *   is the surname.
 * - Joint owners `"SMITH JOHN & MARY"`: drop everything after `&` before
 *   surname extraction.
 *
 * The naive alternative (split on whitespace, take first token) reduces
 * `"JOHNSON CITY MEDICAL CENTER LLC"` to `"JOHNSON"`, which matches every
 * Johnson on the tax roll — useless as a "find more of this owner" query.
 *
 * @returns The search term, or `''` (not null) for empty / whitespace
 *   inputs so callers can use truthy checks.
 */
export function ownerSearchTerm(owner: string | null | undefined): string {
  if (!owner) return ''
  const trimmed = owner.trim()
  if (!trimmed) return ''

  // Entity: strip the trailing legal suffix and keep the distinctive name.
  if (entityKind(trimmed)) {
    const stripped = trimmed.replace(TRAILING_SUFFIX_RE, '').trim()
    // If stripping ate the whole string (owner was just "LLC"), fall back
    // to the original.
    return stripped.length > 0 ? stripped : trimmed
  }

  // Individual: surname only. Cut at first "&" (joint) or "," (legal-form).
  const cut = trimmed.replace(/[,&].*$/, '').trim()
  return cut.split(/\s+/)[0] ?? ''
}

// ── Polygon centroid ───────────────────────────────────────────────────────

/**
 * Compute the centroid of a parcel polygon via the shoelace formula.
 *
 * Works on arbitrary closed rings. Degenerates gracefully — returns
 * `null` when total signed area is zero (collinear ring) or the input
 * is malformed.
 *
 * Accepts both `Polygon` and `MultiPolygon`; for a MultiPolygon, the
 * centroid is the centroid of the largest part by absolute area. This
 * matches the build-fit module's "normalize to largest part" convention.
 *
 * @returns `[lng, lat]`, or `null` for degenerate / malformed inputs.
 */
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

// ── Haversine distance ─────────────────────────────────────────────────────

const EARTH_R = 6371000

/**
 * Great-circle distance between two `[lng, lat]` points, in meters.
 *
 * Uses the sphere approximation with Earth radius 6371000 m. The
 * ellipsoid error is ~0.5% globally and negligible at parcel scale;
 * if higher precision is needed, the build-fit module's Turf-backed
 * `destination` / `pointToLineDistance` is the geodesic alternative.
 */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_R * Math.asin(Math.sqrt(x))
}

// ── Display formatters ─────────────────────────────────────────────────────

/**
 * Render a years-held value as `"X mo"` (under one year) or
 * `"N yr"` / `"N yrs"` (one or more years). The month branch caps the
 * minimum at 1 so a very recent sale doesn't read as "0 mo".
 */
export function formatYearsHeld(years: number | null): string | null {
  if (years == null || !Number.isFinite(years)) return null
  if (years < 1) {
    const months = Math.max(1, Math.round(years * 12))
    return `${months} mo`
  }
  return `${Math.floor(years)} yr${Math.floor(years) === 1 ? '' : 's'}`
}

/** Render a 0..1 ratio as a whole-number percent. */
export function formatRatioPercent(ratio: number | null): string | null {
  if (ratio == null || !Number.isFinite(ratio)) return null
  return `${Math.round(ratio * 100)}%`
}

// ── Filter sheet predicate ─────────────────────────────────────────────────

/**
 * Active filter toggles for the Filter sheet UI. Each boolean is set
 * true when the user has activated that specific filter; `minAcres` is
 * non-null when the user has typed a number > 0.
 */
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

/**
 * Does a parcel match a set of filter flags?
 *
 * All flags AND together; an unset / false flag is always a pass. The
 * recent-sale and long-held branches share a single `yearsHeld` call to
 * avoid recomputing.
 *
 * @param now Reference time. Injectable so recent/long-held branches
 *   are deterministic in tests.
 */
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

// ── External map deeplinks ─────────────────────────────────────────────────

/**
 * Apple Maps deeplink for a `[lng, lat]` point.
 * @param label Optional search-result label to display when opened.
 */
export function appleMapsUrl(lng: number, lat: number, label?: string): string {
  const params = new URLSearchParams({ ll: `${lat},${lng}` })
  if (label) params.set('q', label)
  return `https://maps.apple.com/?${params.toString()}`
}

/** Google Maps search deeplink for a `[lng, lat]` point. */
export function googleMapsUrl(lng: number, lat: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

/** Google Street View deeplink for a `[lng, lat]` viewpoint. */
export function googleStreetViewUrl(lng: number, lat: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
}
