// Shared input validators for /api/* Pages Functions.
// ArcGIS already escapes our input correctly via doubled single quotes, but we
// also constrain inputs to a known charset and the TN bounding box so a
// malformed request fails fast at the edge instead of round-tripping to ArcGIS.

export const COUNTIES = ['ALL', 'Sullivan', 'Washington', 'Carter'] as const
export type County = (typeof COUNTIES)[number]

export function validateCounty(input: unknown): County | null {
  return typeof input === 'string' && (COUNTIES as readonly string[]).includes(input)
    ? (input as County)
    : null
}

// Tennessee bounding box (a generous superset — actual state lon ~-90.31..-81.65,
// lat ~34.98..36.68; we accept slightly outside to allow rounding).
const TN_MIN_LON = -90.5
const TN_MAX_LON = -81.5
const TN_MIN_LAT = 34.5
const TN_MAX_LAT = 37.0

export function validateBbox(
  west: unknown, south: unknown, east: unknown, north: unknown,
): { west: number; south: number; east: number; north: number } | null {
  const nums = [west, south, east, north]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [w, s, e, n] = nums as [number, number, number, number]
  if (w < TN_MIN_LON || e > TN_MAX_LON || w >= e) return null
  if (s < TN_MIN_LAT || n > TN_MAX_LAT || s >= n) return null
  return { west: w, south: s, east: e, north: n }
}

// Allow letters, digits, spaces, and a small set of punctuation that legitimately
// appears in owner names and street addresses (apostrophes, ampersand, hyphen, etc.).
const QUERY_RE = /^[a-zA-Z0-9 .,'#&\-/]{2,80}$/

export function validateQuery(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!QUERY_RE.test(trimmed)) return null
  // Strip SQL LIKE wildcards from user input — the search wraps the query in
  // %...% itself, so a user who types `%` shouldn't get to widen the pattern.
  return trimmed.replace(/[%_]/g, '')
}
