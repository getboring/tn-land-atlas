import { describe, it, expect } from 'vitest'
import { formatFitSummary, parcelDiagramData, formatLatLon } from './report'
import type { Polygon, PolygonOrMulti, SetbackConfig } from './schemas'
import type { FitResultDisplay } from '@/components/build-fit/FitResultPanel'

const ISO = '2026-05-09T12:00:00.000Z'

const baseParcel = {
  parcelKey: '090046M H 01300',
  owner: 'SMITH JOHN',
  address: '112 FOXHALL CIR',
  county: 'Sullivan',
  acres: 1.5,
  zoning: 'R1',
  appraisalDollars: 250000,
}

const baseFootprint = {
  name: '40x60 shop',
  widthFt: 40,
  lengthFt: 60,
  rotationDeg: 0,
  stories: 1,
  notes: null as string | null,
}

const baseResult: FitResultDisplay = {
  fitsParcel: true,
  fitsEnvelope: null,
  footprintSqft: 2400,
  parcelSqft: 65340,
  envelopeSqft: null,
  coveragePct: 3.7,
  closestBoundaryFt: 18,
  warnings: [],
}

describe('formatFitSummary', () => {
  it('produces a header with title and generated date', () => {
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).toMatch(/^Holston Scout — Building Fit Report/)
    expect(out).toContain('Generated 2026-05-09')
  })

  it('includes parcel fields with thousands separators on appraisal', () => {
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).toContain('Owner: SMITH JOHN')
    expect(out).toContain('Address: 112 FOXHALL CIR')
    expect(out).toContain('Acres: 1.50')
    expect(out).toContain('Parcel ID: 090046M H 01300')
    expect(out).toContain('Zoning: R1')
    expect(out).toContain('Appraised value: $250,000')
  })

  it('renders em dashes for null parcel fields', () => {
    const out = formatFitSummary({
      parcel: {
        parcelKey: null,
        owner: null,
        address: null,
        county: null,
        acres: null,
        zoning: null,
        appraisalDollars: null,
      },
      footprint: baseFootprint,
      center: null,
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).toContain('Owner: —')
    expect(out).toContain('Acres: —')
    expect(out).toContain('Appraised value: —')
  })

  it('includes footprint dimensions and area', () => {
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).toContain('Dimensions: 40 × 60 ft (rotation 0°)')
    expect(out).toContain('Area: 2,400 sqft')
  })

  it('includes uniform setback envelope and lost-area math', () => {
    const setback: SetbackConfig = { mode: 'uniform', setbackFt: 15 }
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback,
      envelopeSqft: 60000,
      result: { ...baseResult, fitsEnvelope: true },
      generatedAt: ISO,
    })
    expect(out).toContain('Mode: Uniform 15 ft')
    expect(out).toContain('Envelope status: Fits')
    expect(out).toContain('Envelope area: 60,000 sqft')
    expect(out).toContain('Lost to setback: 5,340 sqft')
  })

  it('renders manual setback fields with em dashes for null values', () => {
    const setback: SetbackConfig = {
      mode: 'manual',
      frontFt: 25,
      sideFt: null,
      rearFt: 20,
      notes: 'front per zoning',
    }
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback,
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).toContain('Mode: Manual')
    expect(out).toContain('Front: 25 ft')
    expect(out).toContain('Side: —')
    expect(out).toContain('Rear: 20 ft')
    expect(out).toContain('Notes: front per zoning')
  })

  it('describes status correctly across fit/conflict/envelope states', () => {
    const fits = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'uniform', setbackFt: 15 },
      envelopeSqft: 60000,
      result: { ...baseResult, fitsEnvelope: true },
      generatedAt: ISO,
    })
    expect(fits).toContain('Status: Fits parcel and setback envelope')

    const crossesParcel = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: { ...baseResult, fitsParcel: false },
      generatedAt: ISO,
    })
    expect(crossesParcel).toContain('Status: Crosses parcel boundary')

    const crossesEnvelope = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'uniform', setbackFt: 15 },
      envelopeSqft: 60000,
      result: { ...baseResult, fitsParcel: true, fitsEnvelope: false },
      generatedAt: ISO,
    })
    expect(crossesEnvelope).toContain('Status: Inside parcel, crosses setback envelope')
  })

  it('lists warnings when present', () => {
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: {
        ...baseResult,
        warnings: [
          { severity: 'info', source: 'geometry', code: 'multipolygon-largest', message: 'Parcel is a MultiPolygon' },
          { severity: 'warning', source: 'setback', code: 'uniform-approximation', message: 'Setback approximation' },
        ],
      },
      generatedAt: ISO,
    })
    expect(out).toContain('Warnings')
    expect(out).toContain('Parcel is a MultiPolygon')
    expect(out).toContain('Setback approximation')
  })

  it('omits the Warnings section when no warnings present', () => {
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).not.toContain('Warnings\n')
  })

  it('always closes with the planning-estimate disclaimer', () => {
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).toMatch(/Planning estimate only/)
    expect(out).toMatch(/design professional before purchase, permitting, or construction\.$/)
  })

  it('renders the placement center with hemisphere suffixes (not signed °E)', () => {
    // Critical: a Sullivan-County parcel sits at negative longitude; the
    // report must read 82.34500°W, not -82.34500°E (geographically wrong).
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).toContain('Center: 36.31500°N, 82.34500°W')
    expect(out).not.toMatch(/-82.*°E/)
  })

  it('falls back to a placeholder name when footprint name is empty', () => {
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: { ...baseFootprint, name: '' },
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: ISO,
    })
    expect(out).toContain('Name: (unnamed)')
  })

  it('echoes a non-ISO generated string when parse fails (defensive)', () => {
    const out = formatFitSummary({
      parcel: baseParcel,
      footprint: baseFootprint,
      center: [-82.345, 36.315],
      setback: { mode: 'none' },
      envelopeSqft: null,
      result: baseResult,
      generatedAt: 'not a real date',
    })
    expect(out).toContain('Generated not a real date')
  })
})

// ── formatLatLon ───────────────────────────────────────────────────────────

describe('formatLatLon', () => {
  it('writes positive latitude as °N and negative longitude as °W (TN parcels)', () => {
    expect(formatLatLon(36.315, -82.345)).toBe('36.31500°N, 82.34500°W')
  })
  it('writes negative latitude as °S and positive longitude as °E', () => {
    expect(formatLatLon(-33.86, 151.21)).toBe('33.86000°S, 151.21000°E')
  })
  it('handles equator + prime meridian with zero magnitudes', () => {
    expect(formatLatLon(0, 0)).toBe('0.00000°N, 0.00000°E')
  })
  it('respects a custom decimals count', () => {
    expect(formatLatLon(36.5, -82.7, 1)).toBe('36.5°N, 82.7°W')
  })
})

// ── parcelDiagramData ──────────────────────────────────────────────────────

describe('parcelDiagramData', () => {
  const parcel: PolygonOrMulti = {
    type: 'Polygon',
    coordinates: [
      [
        [-82.35, 36.31],
        [-82.34, 36.31],
        [-82.34, 36.32],
        [-82.35, 36.32],
        [-82.35, 36.31],
      ],
    ],
  }
  const footprint: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-82.346, 36.314],
        [-82.345, 36.314],
        [-82.345, 36.315],
        [-82.346, 36.315],
        [-82.346, 36.314],
      ],
    ],
  }

  it('returns a viewBox + path strings for parcel + footprint', () => {
    const d = parcelDiagramData({
      parcel,
      envelope: null,
      footprint,
      center: [-82.3455, 36.3145],
    })
    expect(d).not.toBeNull()
    if (!d) return
    expect(d.viewBox).toBe('0 0 1000 750')
    expect(d.parcelPath).toMatch(/^M /)
    expect(d.parcelPath).toMatch(/ Z$/)
    expect(d.footprintPath).toMatch(/^M /)
    expect(d.centerXY).not.toBeNull()
  })

  it('returns null envelope path when envelope is null', () => {
    const d = parcelDiagramData({
      parcel,
      envelope: null,
      footprint: null,
      center: null,
    })
    expect(d?.envelopePath).toBeNull()
    expect(d?.footprintPath).toBeNull()
    expect(d?.centerXY).toBeNull()
  })

  it('handles a MultiPolygon parcel by drawing both parts', () => {
    const multi: PolygonOrMulti = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-82.35, 36.31],
            [-82.34, 36.31],
            [-82.34, 36.32],
            [-82.35, 36.32],
            [-82.35, 36.31],
          ],
        ],
        [
          [
            [-82.30, 36.31],
            [-82.29, 36.31],
            [-82.29, 36.32],
            [-82.30, 36.32],
            [-82.30, 36.31],
          ],
        ],
      ],
    }
    const d = parcelDiagramData({
      parcel: multi,
      envelope: null,
      footprint: null,
      center: null,
    })
    expect(d).not.toBeNull()
    if (!d) return
    // Two parts -> two `M ... Z` subpaths, joined by ' '.
    const closures = d.parcelPath.match(/ Z/g)?.length ?? 0
    expect(closures).toBe(2)
  })

  it('honors a custom canvas size', () => {
    const d = parcelDiagramData({
      parcel,
      envelope: null,
      footprint: null,
      center: null,
      canvas: { width: 500, height: 500 },
    })
    expect(d?.viewBox).toBe('0 0 500 500')
  })

  it('returns null when the parcel has no usable coordinates', () => {
    const bad: PolygonOrMulti = {
      type: 'Polygon',
      // Schema would normally reject this; we test the helper's own guard.
      coordinates: [[]] as never,
    }
    const d = parcelDiagramData({
      parcel: bad,
      envelope: null,
      footprint: null,
      center: null,
    })
    expect(d).toBeNull()
  })

  it('projects center coordinates inside the canvas', () => {
    const d = parcelDiagramData({
      parcel,
      envelope: null,
      footprint,
      center: [-82.345, 36.315],
    })
    expect(d).not.toBeNull()
    if (!d || !d.centerXY) return
    const [x, y] = d.centerXY
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThanOrEqual(1000)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(750)
  })

  it('returns null for a zero-width bbox (degenerate parcel)', () => {
    // All vertices share the same longitude. Without the guard this would
    // produce scaleX = Infinity and emit a silently-broken SVG.
    const zeroWidth: PolygonOrMulti = {
      type: 'Polygon',
      coordinates: [
        [
          [-82.35, 36.31],
          [-82.35, 36.32],
          [-82.35, 36.33],
          [-82.35, 36.34],
          [-82.35, 36.31],
        ],
      ],
    }
    expect(
      parcelDiagramData({ parcel: zeroWidth, envelope: null, footprint: null, center: null }),
    ).toBeNull()
  })

  it('returns null for a zero-height bbox (degenerate parcel)', () => {
    const zeroHeight: PolygonOrMulti = {
      type: 'Polygon',
      coordinates: [
        [
          [-82.35, 36.31],
          [-82.34, 36.31],
          [-82.33, 36.31],
          [-82.32, 36.31],
          [-82.35, 36.31],
        ],
      ],
    }
    expect(
      parcelDiagramData({ parcel: zeroHeight, envelope: null, footprint: null, center: null }),
    ).toBeNull()
  })

  it('skips vertices with non-finite axes in the parcel path', () => {
    // A real ring with one NaN vertex. The schema rejects this at the
    // boundary, but parcelDiagramData should still degrade cleanly when
    // called with hand-built geometry.
    const withNaN: PolygonOrMulti = {
      type: 'Polygon',
      coordinates: [
        [
          [-82.35, 36.31],
          [Number.NaN, 36.31],
          [-82.34, 36.32],
          [-82.35, 36.32],
          [-82.35, 36.31],
        ],
      ],
    }
    const d = parcelDiagramData({ parcel: withNaN, envelope: null, footprint: null, center: null })
    // bboxOfGeometry already filters NaN; verify the path output never
    // contains the literal "NaN".
    expect(d).not.toBeNull()
    expect(d?.parcelPath).not.toContain('NaN')
  })
})
