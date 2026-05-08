import { describe, it, expect } from 'vitest'
import {
  pricePerAcre,
  formatPricePerAcre,
  yearsHeld,
  parseSaleDate,
  holdingTier,
  acreageTier,
  acreageTierLabel,
  saleToAppraisalRatio,
  occupancy,
  firstNumberToken,
  outOfState,
  entityKind,
  centroid,
  haversineMeters,
  formatYearsHeld,
  formatRatioPercent,
  appleMapsUrl,
  googleMapsUrl,
  googleStreetViewUrl,
  passesFilters,
  type ParcelFilterFlags,
} from './insights'

// All tests use a fixed `now` so they don't drift over time. 2026-05-08
// matches the project's compatibility_date in wrangler.toml.
const NOW = new Date('2026-05-08T12:00:00Z')

describe('pricePerAcre', () => {
  it('divides appraisal by acres', () => {
    expect(pricePerAcre(257300, 0.395)).toBeCloseTo(651392.4, 1)
  })
  it('returns null for zero or missing inputs', () => {
    expect(pricePerAcre(0, 1)).toBeNull()
    expect(pricePerAcre(100, 0)).toBeNull()
    expect(pricePerAcre(null, 1)).toBeNull()
    expect(pricePerAcre(100, null)).toBeNull()
    expect(pricePerAcre(undefined, undefined)).toBeNull()
  })
  it('returns null for non-finite inputs', () => {
    expect(pricePerAcre(Number.NaN, 1)).toBeNull()
    expect(pricePerAcre(1, Number.POSITIVE_INFINITY)).toBeNull()
  })
  it('formats as whole-dollar /ac', () => {
    expect(formatPricePerAcre(651392.4)).toBe('$651,392/ac')
    expect(formatPricePerAcre(null)).toBeNull()
  })
})

describe('parseSaleDate', () => {
  it('parses ISO dates', () => {
    expect(parseSaleDate('1988-09-16')?.getUTCFullYear()).toBe(1988)
  })
  it('parses M/D/YYYY', () => {
    const d = parseSaleDate('9/16/1988')
    expect(d?.getFullYear()).toBe(1988)
    expect(d?.getMonth()).toBe(8) // 0-indexed
    expect(d?.getDate()).toBe(16)
  })
  it('parses millis-since-epoch', () => {
    const ms = Date.UTC(1988, 8, 16)
    expect(parseSaleDate(ms)?.getUTCFullYear()).toBe(1988)
  })
  it('returns null for nonsense', () => {
    expect(parseSaleDate('hello')).toBeNull()
    expect(parseSaleDate('')).toBeNull()
    expect(parseSaleDate(null)).toBeNull()
    expect(parseSaleDate(undefined)).toBeNull()
  })
})

describe('yearsHeld', () => {
  it('computes years from a sale date', () => {
    const y = yearsHeld('1988-09-16T00:00:00Z', NOW)
    expect(y).toBeGreaterThan(37)
    expect(y).toBeLessThan(38)
  })
  it('returns null for missing or future dates', () => {
    expect(yearsHeld(null, NOW)).toBeNull()
    expect(yearsHeld('2099-01-01T00:00:00Z', NOW)).toBeNull()
  })
  it('handles M/D/YYYY input', () => {
    const y = yearsHeld('1/1/2020', new Date('2026-01-01T00:00:00Z'))
    expect(y).toBeCloseTo(6, 1)
  })
})

describe('holdingTier', () => {
  it('buckets known thresholds', () => {
    expect(holdingTier(0.5)).toBe('recent')
    expect(holdingTier(1.99)).toBe('recent')
    expect(holdingTier(2)).toBe('established')
    expect(holdingTier(14.99)).toBe('established')
    expect(holdingTier(15)).toBe('long-held')
    expect(holdingTier(29.99)).toBe('long-held')
    expect(holdingTier(30)).toBe('generational')
    expect(holdingTier(100)).toBe('generational')
  })
  it('rejects null/negative/non-finite', () => {
    expect(holdingTier(null)).toBeNull()
    expect(holdingTier(-1)).toBeNull()
    expect(holdingTier(Number.NaN)).toBeNull()
  })
})

describe('acreageTier', () => {
  it('bucket boundaries', () => {
    expect(acreageTier(0.1)).toBe('lot')
    expect(acreageTier(0.249)).toBe('lot')
    expect(acreageTier(0.25)).toBe('residential')
    expect(acreageTier(0.999)).toBe('residential')
    expect(acreageTier(1)).toBe('country')
    expect(acreageTier(4.99)).toBe('country')
    expect(acreageTier(5)).toBe('small-acreage')
    expect(acreageTier(24.99)).toBe('small-acreage')
    expect(acreageTier(25)).toBe('medium-acreage')
    expect(acreageTier(99.99)).toBe('medium-acreage')
    expect(acreageTier(100)).toBe('large-acreage')
    expect(acreageTier(5000)).toBe('large-acreage')
  })
  it('null on bad inputs', () => {
    expect(acreageTier(0)).toBeNull()
    expect(acreageTier(-1)).toBeNull()
    expect(acreageTier(null)).toBeNull()
    expect(acreageTier(Number.NaN)).toBeNull()
  })
  it('formats labels', () => {
    expect(acreageTierLabel('lot')).toBe('Lot')
    expect(acreageTierLabel('large-acreage')).toBe('Large acreage')
  })
})

describe('saleToAppraisalRatio', () => {
  it('returns ratio', () => {
    expect(saleToAppraisalRatio(180_000, 200_000)).toBeCloseTo(0.9, 5)
    expect(saleToAppraisalRatio(250_000, 200_000)).toBeCloseTo(1.25, 5)
  })
  it('null for zero/missing', () => {
    expect(saleToAppraisalRatio(0, 100)).toBeNull()
    expect(saleToAppraisalRatio(100, 0)).toBeNull()
    expect(saleToAppraisalRatio(null, 100)).toBeNull()
  })
  it('formats percent', () => {
    expect(formatRatioPercent(0.92)).toBe('92%')
    expect(formatRatioPercent(1.25)).toBe('125%')
    expect(formatRatioPercent(null)).toBeNull()
  })
})

describe('firstNumberToken', () => {
  it('finds digits', () => {
    expect(firstNumberToken('112 FOXHALL CIR')).toBe('112')
    expect(firstNumberToken('FOXHALL CIR 112')).toBe('112')
    expect(firstNumberToken('PO BOX 4567')).toBe('4567')
  })
  it('null when no digits', () => {
    expect(firstNumberToken('no number here')).toBeNull()
    expect(firstNumberToken('')).toBeNull()
  })
})

describe('occupancy', () => {
  it('owner-occupied when number + city + TN', () => {
    expect(
      occupancy({
        ADDRESS: '112 FOXHALL CIR',
        MAILADDR: '112 FOXHALL CR',
        CITYNAME: 'BRISTOL',
        MAILCITY: 'BRISTOL',
        STATE: 'TN',
      }),
    ).toBe('owner-occupied')
  })
  it('absentee when mail city differs', () => {
    expect(
      occupancy({
        ADDRESS: '112 FOXHALL CIR',
        MAILADDR: '112 FOXHALL CR',
        CITYNAME: 'BRISTOL',
        MAILCITY: 'KNOXVILLE',
        STATE: 'TN',
      }),
    ).toBe('absentee')
  })
  it('absentee when number differs', () => {
    expect(
      occupancy({
        ADDRESS: '112 FOXHALL CIR',
        MAILADDR: '500 BROADWAY',
        CITYNAME: 'BRISTOL',
        MAILCITY: 'BRISTOL',
        STATE: 'TN',
      }),
    ).toBe('absentee')
  })
  it('absentee when out of state', () => {
    expect(
      occupancy({
        ADDRESS: '112 FOXHALL CIR',
        MAILADDR: '112 FOXHALL CR',
        CITYNAME: 'BRISTOL',
        MAILCITY: 'BRISTOL',
        STATE: 'GA',
      }),
    ).toBe('absentee')
  })
  it('null when address fields missing', () => {
    expect(
      occupancy({ ADDRESS: null, MAILADDR: '...', CITYNAME: null, MAILCITY: null, STATE: null }),
    ).toBeNull()
  })
})

describe('outOfState', () => {
  it('TN is in-state', () => {
    expect(outOfState('TN')).toBe(false)
    expect(outOfState('tn')).toBe(false)
    expect(outOfState(' TN ')).toBe(false)
  })
  it('any other state is out of state', () => {
    expect(outOfState('GA')).toBe(true)
    expect(outOfState('FL')).toBe(true)
  })
  it('empty / null reads as in-state (no signal)', () => {
    expect(outOfState(null)).toBe(false)
    expect(outOfState('')).toBe(false)
  })
})

describe('entityKind', () => {
  it('matches LLC / INC / TRUST / CORP / etc', () => {
    expect(entityKind('GOUGE LAND PARTNERSHIP LP')).toBe('lp')
    expect(entityKind('SUMMERS HARDWARE COMPANY INC')).toBe('inc')
    expect(entityKind('BRISTOL PRESERVATION LLC')).toBe('llc')
    expect(entityKind('FIRST PRESBYTERIAN CHURCH')).toBe('church')
    expect(entityKind('FAMILY TRUST')).toBe('trust')
    expect(entityKind('SMITH CORPORATION')).toBe('corp')
    expect(entityKind('JOHNSON FOUNDATION')).toBe('foundation')
    expect(entityKind('CITY OF BRISTOL')).toBe('government')
  })
  it('returns null for individuals', () => {
    expect(entityKind('SMITH JOHN A')).toBeNull()
    expect(entityKind('WOLFE CARLINA LYNN')).toBeNull()
  })
  it('handles falsy input', () => {
    expect(entityKind(null)).toBeNull()
    expect(entityKind('')).toBeNull()
  })
  it('case-insensitive', () => {
    expect(entityKind('smith llc')).toBe('llc')
    expect(entityKind('Smith Llc')).toBe('llc')
  })
})

describe('centroid (shoelace)', () => {
  it('square centered at origin', () => {
    const result = centroid({
      type: 'Polygon',
      coordinates: [
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
          [-1, -1],
        ],
      ],
    })
    expect(result).not.toBeNull()
    expect(result![0]).toBeCloseTo(0, 6)
    expect(result![1]).toBeCloseTo(0, 6)
  })
  it('rectangle', () => {
    const result = centroid({
      type: 'Polygon',
      coordinates: [
        [
          [-82, 36],
          [-82, 37],
          [-81, 37],
          [-81, 36],
          [-82, 36],
        ],
      ],
    })
    expect(result![0]).toBeCloseTo(-81.5, 6)
    expect(result![1]).toBeCloseTo(36.5, 6)
  })
  it('returns null on degenerate (collinear)', () => {
    const result = centroid({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [2, 0],
          [0, 0],
        ],
      ],
    })
    expect(result).toBeNull()
  })
  it('handles MultiPolygon (picks largest)', () => {
    const result = centroid({
      type: 'MultiPolygon',
      coordinates: [
        // tiny square at (0,0)
        [
          [
            [-0.1, -0.1],
            [0.1, -0.1],
            [0.1, 0.1],
            [-0.1, 0.1],
            [-0.1, -0.1],
          ],
        ],
        // big square at (10,10)
        [
          [
            [9, 9],
            [11, 9],
            [11, 11],
            [9, 11],
            [9, 9],
          ],
        ],
      ],
    })
    // Should pick the big one centered at (10, 10).
    expect(result![0]).toBeCloseTo(10, 6)
    expect(result![1]).toBeCloseTo(10, 6)
  })
})

describe('haversineMeters', () => {
  it('zero distance for identical points', () => {
    expect(haversineMeters([-82, 36], [-82, 36])).toBe(0)
  })
  it('one degree of latitude is roughly 111km', () => {
    const m = haversineMeters([-82, 36], [-82, 37])
    // 1deg lat = 111195 m (sphere). Allow 100m tolerance.
    expect(Math.abs(m - 111195)).toBeLessThan(100)
  })
  it('one degree of longitude at lat=36 is ~90km', () => {
    const m = haversineMeters([-82, 36], [-81, 36])
    // cos(36deg) * 111195 = 89978 m. Allow 100m tolerance.
    expect(Math.abs(m - 89978)).toBeLessThan(100)
  })
  it('symmetric', () => {
    const a: [number, number] = [-82.3534, 36.3134]
    const b: [number, number] = [-82.1, 36.5]
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })
})

describe('formatYearsHeld', () => {
  it('months for sub-year', () => {
    expect(formatYearsHeld(0.5)).toBe('6 mo')
    expect(formatYearsHeld(0.083)).toBe('1 mo')
  })
  it('years for >= 1', () => {
    expect(formatYearsHeld(1)).toBe('1 yr')
    expect(formatYearsHeld(37.4)).toBe('37 yrs')
  })
  it('null in null out', () => {
    expect(formatYearsHeld(null)).toBeNull()
    expect(formatYearsHeld(Number.NaN)).toBeNull()
  })
})

describe('passesFilters', () => {
  const NOW_FILTER = new Date('2026-05-08T00:00:00Z')
  const baseProps = {
    OWNER: 'SMITH JOHN A',
    STATE: 'TN',
    ADDRESS: '112 FOXHALL CIR',
    MAILADDR: '500 BROADWAY',
    CITYNAME: 'BRISTOL',
    MAILCITY: 'NASHVILLE',
    CALC_ACRE: 0.5,
    SALEDATE: '2020-06-01',
  }
  const allOff: ParcelFilterFlags = {
    entityOnly: false,
    outOfStateOnly: false,
    absenteeOnly: false,
    recentSaleOnly: false,
    longHeldOnly: false,
    minAcres: null,
  }

  it('passes when no filters set', () => {
    expect(passesFilters(baseProps, allOff, NOW_FILTER)).toBe(true)
  })
  it('entityOnly excludes individuals', () => {
    expect(passesFilters(baseProps, { ...allOff, entityOnly: true }, NOW_FILTER)).toBe(false)
    expect(passesFilters({ ...baseProps, OWNER: 'SMITH LLC' }, { ...allOff, entityOnly: true }, NOW_FILTER)).toBe(true)
  })
  it('outOfStateOnly requires state != TN', () => {
    expect(passesFilters(baseProps, { ...allOff, outOfStateOnly: true }, NOW_FILTER)).toBe(false)
    expect(passesFilters({ ...baseProps, STATE: 'GA' }, { ...allOff, outOfStateOnly: true }, NOW_FILTER)).toBe(true)
  })
  it('absenteeOnly excludes owner-occupied', () => {
    const oo = { ...baseProps, MAILADDR: '112 FOXHALL CR', MAILCITY: 'BRISTOL', STATE: 'TN' }
    expect(passesFilters(oo, { ...allOff, absenteeOnly: true }, NOW_FILTER)).toBe(false)
    expect(passesFilters(baseProps, { ...allOff, absenteeOnly: true }, NOW_FILTER)).toBe(true)
  })
  it('minAcres applies a floor', () => {
    expect(passesFilters(baseProps, { ...allOff, minAcres: 1 }, NOW_FILTER)).toBe(false)
    expect(passesFilters({ ...baseProps, CALC_ACRE: 5 }, { ...allOff, minAcres: 1 }, NOW_FILTER)).toBe(true)
  })
  it('recentSaleOnly excludes sales > 5 yrs', () => {
    expect(passesFilters({ ...baseProps, SALEDATE: '2010-01-01' }, { ...allOff, recentSaleOnly: true }, NOW_FILTER)).toBe(false)
    expect(passesFilters({ ...baseProps, SALEDATE: '2024-01-01' }, { ...allOff, recentSaleOnly: true }, NOW_FILTER)).toBe(true)
  })
  it('longHeldOnly excludes sales < 20 yrs', () => {
    expect(passesFilters({ ...baseProps, SALEDATE: '2020-01-01' }, { ...allOff, longHeldOnly: true }, NOW_FILTER)).toBe(false)
    expect(passesFilters({ ...baseProps, SALEDATE: '1990-01-01' }, { ...allOff, longHeldOnly: true }, NOW_FILTER)).toBe(true)
  })
  it('AND combines multiple filters', () => {
    const f: ParcelFilterFlags = { ...allOff, entityOnly: true, outOfStateOnly: true }
    expect(passesFilters({ ...baseProps, OWNER: 'SMITH LLC', STATE: 'TN' }, f, NOW_FILTER)).toBe(false)
    expect(passesFilters({ ...baseProps, OWNER: 'SMITH LLC', STATE: 'GA' }, f, NOW_FILTER)).toBe(true)
  })
})

describe('map deeplinks', () => {
  it('Apple Maps URL', () => {
    const u = appleMapsUrl(-82.35, 36.31, '112 FOXHALL CIR')
    expect(u).toContain('https://maps.apple.com/')
    expect(u).toContain('ll=36.31%2C-82.35')
    expect(u).toContain('q=112+FOXHALL+CIR')
  })
  it('Google Maps URL', () => {
    expect(googleMapsUrl(-82.35, 36.31)).toBe(
      'https://www.google.com/maps/search/?api=1&query=36.31,-82.35',
    )
  })
  it('Street View URL', () => {
    expect(googleStreetViewUrl(-82.35, 36.31)).toBe(
      'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=36.31,-82.35',
    )
  })
})
