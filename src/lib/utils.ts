import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtMoney(n: number | null | undefined): string {
  // `!n` would also catch 0, which is a real value (e.g. tax-exempt parcel
  // with appraisal $0). Test for missing-ness explicitly.
  if (n == null || !Number.isFinite(n)) return '—'
  return '$' + n.toLocaleString()
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString()
}
