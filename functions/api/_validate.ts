// Shared input validators for /api/* Pages Functions.
//
// Every Pages Function that accepts user input MUST run its inputs through
// these validators before composing any downstream URL (ArcGIS, Supabase).
// ArcGIS escapes single quotes correctly for us via doubling, but the goal
// here is to fail fast at the edge so a malformed or hostile request never
// reaches an upstream and so the upstream's narrower error budget is spent
// only on requests that are at least plausibly real.
//
// Public surface:
// - COUNTIES, County                   the whitelist + its TS union
// - validateCounty(input)              -> County or null
// - validateBbox(w, s, e, n)           -> normalized bbox or null
// - validateQuery(input)               -> sanitized search string or null
//
// Invariants:
// - Every validator returns null on any rejected input. Routes must treat
//   null as a 400 Bad Request; do not pass nullable validator output forward.
// - Numeric bounds use a generous TN bounding box. Requests outside that box
//   are rejected even if they look syntactically valid.

/** Counties the ArcGIS upstream supports. `'ALL'` is the cross-county default. */
export const COUNTIES = ['ALL', 'Sullivan', 'Washington', 'Carter'] as const

/** TS union derived from {@link COUNTIES}. */
export type County = (typeof COUNTIES)[number]

/**
 * Narrow an untrusted value to a known {@link County}.
 *
 * @returns the validated county, or `null` for any input not in
 *   {@link COUNTIES}. Callers should return `400 Invalid county` on null.
 */
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

/**
 * Narrow four untrusted coordinates to a normalized TN-bounded bbox.
 *
 * @returns the bbox as `{ west, south, east, north }`, or `null` when any
 *   coordinate is non-numeric, non-finite, falls outside the TN superset,
 *   or fails the `west < east` / `south < north` ordering checks.
 */
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

/**
 * Trim, charset-check, and de-wildcard a user-supplied search string.
 *
 * The search route wraps the result in `%...%` for a LIKE match, so any `%`
 * or `_` typed by the user is stripped here. The route is the only caller
 * that needs the de-wildcarded form; nothing else should reuse it for an
 * exact match.
 *
 * @returns the sanitized string (2 to 80 chars after trim, charset-bounded
 *   and wildcard-stripped), or `null` when the input fails any check.
 */
export function validateQuery(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!QUERY_RE.test(trimmed)) return null
  return trimmed.replace(/[%_]/g, '')
}

