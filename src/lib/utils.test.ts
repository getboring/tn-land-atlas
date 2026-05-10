import { describe, it, expect } from 'vitest'
import { cn, fmtMoney, fmtDate } from './utils'

describe('cn', () => {
  it('concatenates simple class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c')
  })
  it('drops falsy values (clsx semantics)', () => {
    expect(cn('a', false, null, undefined, 0, '', 'b')).toBe('a b')
  })
  it('resolves conflicting Tailwind utilities right-most-wins (twMerge)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', 'text-blue-600')).toBe('text-blue-600')
  })
  it('supports the conditional-object form', () => {
    expect(cn({ a: true, b: false, c: true })).toBe('a c')
  })
  it('returns an empty string when no truthy classes', () => {
    expect(cn()).toBe('')
    expect(cn(false, null, '')).toBe('')
  })
})

describe('fmtMoney', () => {
  it('formats positive integers with thousands separators', () => {
    expect(fmtMoney(250000)).toBe('$250,000')
    expect(fmtMoney(1)).toBe('$1')
  })
  it('preserves zero (NOT treated as missing)', () => {
    expect(fmtMoney(0)).toBe('$0')
  })
  it('formats negative values (refunds, write-downs)', () => {
    expect(fmtMoney(-1500)).toBe('$-1,500')
  })
  it('returns the em dash for null and undefined', () => {
    expect(fmtMoney(null)).toBe('—')
    expect(fmtMoney(undefined)).toBe('—')
  })
  it('returns the em dash for non-finite numbers', () => {
    expect(fmtMoney(NaN)).toBe('—')
    expect(fmtMoney(Infinity)).toBe('—')
    expect(fmtMoney(-Infinity)).toBe('—')
  })
})

describe('fmtDate', () => {
  it('formats an ISO date string', () => {
    const out = fmtDate('2026-05-09T12:00:00.000Z')
    // Locale-dependent; assert it produced *some* date-like string.
    expect(out).not.toBe('—')
    expect(out).toMatch(/\d/)
  })
  it('returns the em dash for null, undefined, empty string', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate(undefined)).toBe('—')
    expect(fmtDate('')).toBe('—')
  })
  it('returns the em dash for unparseable inputs', () => {
    expect(fmtDate('not a date')).toBe('—')
    expect(fmtDate('2026-13-99')).toBe('—')
  })
})
