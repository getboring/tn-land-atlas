// Small UI helpers used across components.
//
// Public surface:
// - cn(...inputs)         tailwind-merge wrapper around clsx for conflict-safe class composition
// - fmtMoney(n)           whole-dollar formatter, returns '—' for null/undefined/non-finite
// - fmtDate(d)            locale date formatter, returns '—' for null/undefined/invalid input
//
// Why both formatters return '—' instead of an empty string: the parcel
// detail panel renders these values into a "definition list" where an
// empty value looks like a layout bug. The em dash is the universal
// "no data" marker we use everywhere in the UI.

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Compose Tailwind class strings without conflict.
 *
 * Wraps `clsx` (truthy filtering, conditional class objects) with
 * `tailwind-merge` (right-most utility wins for conflicting properties,
 * e.g. `cn('p-2', 'p-4')` -> `'p-4'`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Format a dollar value as `$12,345`.
 *
 * Returns `'—'` for `null`, `undefined`, or non-finite numbers.
 *
 * Important: `!n` would also catch `0`, which is a real value (e.g. a
 * tax-exempt parcel with appraisal $0). The explicit `n == null` check
 * preserves zero.
 *
 * @example
 * fmtMoney(250000) // -> '$250,000'
 * fmtMoney(0)      // -> '$0'
 * fmtMoney(null)   // -> '—'
 * fmtMoney(NaN)    // -> '—'
 */
export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return '$' + n.toLocaleString()
}

/**
 * Format a date string with the user's locale.
 *
 * Returns `'—'` for null, undefined, empty string, or any input that
 * does not parse to a real Date (NaN time).
 *
 * @example
 * fmtDate('2026-05-09')   // -> '5/9/2026' (en-US)
 * fmtDate('not a date')   // -> '—'
 * fmtDate(null)           // -> '—'
 */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString()
}
