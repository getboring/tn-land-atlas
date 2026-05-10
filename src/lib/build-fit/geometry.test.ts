import { describe, it, expect } from 'vitest'
import {
  rectangleFromDimensions,
  footprintAreaSqft,
  parcelAreaSqft,
  coveragePct,
  fitsWithinParcel,
  closestBoundaryFt,
  normalizeParcel,
  defaultFootprintCenter,
  footprintLabels,
  FEET_PER_METER,
  SQM_TO_SQFT,
} from './geometry'
import type { Polygon, PolygonOrMulti } from './schemas'

const TN_CENTER: [number, number] = [-82.35, 36.31]

// A roughly-quarter-acre rectangle around TN_CENTER. ~150ft x 75ft.
function smallParcel(): Polygon {
  // ~0.001° lng ≈ 91m at 36° lat; ~0.001° lat ≈ 111m. Use deltas that
  // produce a clearly-larger-than-our-rectangles parcel.
  const lng = TN_CENTER[0]
  const lat = TN_CENTER[1]
  const dLng = 0.002
  const dLat = 0.002
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  }
}

describe('rectangleFromDimensions', () => {
  it('returns a closed polygon with 5 coordinates', () => {
    const r = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt: 40,
      lengthFt: 60,
      rotationDeg: 0,
    })
    expect(r.type).toBe('Polygon')
    expect(r.coordinates).toHaveLength(1)
    expect(r.coordinates[0]).toHaveLength(5)
    expect(r.coordinates[0]?.[0]).toEqual(r.coordinates[0]?.[4])
  })

  it('rejects non-positive dimensions', () => {
    expect(() =>
      rectangleFromDimensions({ center: TN_CENTER, widthFt: 0, lengthFt: 60, rotationDeg: 0 }),
    ).toThrow()
    expect(() =>
      rectangleFromDimensions({ center: TN_CENTER, widthFt: 40, lengthFt: -1, rotationDeg: 0 }),
    ).toThrow()
  })

  it('produces an area within 0.5% of the typed dimensions', () => {
    const widthFt = 40
    const lengthFt = 60
    const expectedSqft = widthFt * lengthFt
    const r = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt,
      lengthFt,
      rotationDeg: 0,
    })
    const actual = footprintAreaSqft(r)
    const errPct = Math.abs(actual - expectedSqft) / expectedSqft
    expect(errPct).toBeLessThan(0.005)
  })

  it('rotation moves the corner coordinates', () => {
    const a = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt: 40,
      lengthFt: 60,
      rotationDeg: 0,
    })
    const b = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt: 40,
      lengthFt: 60,
      rotationDeg: 45,
    })
    // First corner should move when we rotate. (Center + dimensions identical.)
    expect(a.coordinates[0]?.[0]).not.toEqual(b.coordinates[0]?.[0])
  })

  it('rotation preserves area within 0.5%', () => {
    const widthFt = 40
    const lengthFt = 60
    const r = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt,
      lengthFt,
      rotationDeg: 37,
    })
    const expectedSqft = widthFt * lengthFt
    const errPct = Math.abs(footprintAreaSqft(r) - expectedSqft) / expectedSqft
    expect(errPct).toBeLessThan(0.005)
  })
})

describe('area conversions', () => {
  it('SQM_TO_SQFT round-trips with FEET_PER_METER^2', () => {
    expect(SQM_TO_SQFT).toBeCloseTo(FEET_PER_METER ** 2, 5)
  })

  it('parcelAreaSqft handles a Polygon', () => {
    const p = smallParcel()
    expect(parcelAreaSqft(p)).toBeGreaterThan(0)
  })

  it('parcelAreaSqft sums MultiPolygon parts', () => {
    const p1 = smallParcel().coordinates
    // Disjoint second part shifted east
    const p2: Polygon['coordinates'] = p1.map((ring) =>
      ring.map(([lng, lat]) => [lng + 0.01, lat]),
    )
    const single = parcelAreaSqft({ type: 'Polygon', coordinates: p1 })
    const multi: PolygonOrMulti = {
      type: 'MultiPolygon',
      coordinates: [p1, p2],
    }
    expect(parcelAreaSqft(multi)).toBeCloseTo(single * 2, -1)
  })
})

describe('coveragePct', () => {
  it('computes percentage', () => {
    expect(coveragePct(2400, 65340)).toBeCloseTo(3.673, 2)
  })
  it('returns null when parcel is missing', () => {
    expect(coveragePct(2400, null)).toBeNull()
  })
  it('returns null when parcel area is zero', () => {
    expect(coveragePct(2400, 0)).toBeNull()
  })
})

describe('fitsWithinParcel', () => {
  it('returns true for a small rectangle inside a larger parcel', () => {
    const parcel = smallParcel()
    const r = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt: 40,
      lengthFt: 60,
      rotationDeg: 0,
    })
    expect(fitsWithinParcel(r, parcel)).toBe(true)
  })

  it('returns false for a rectangle larger than the parcel', () => {
    const parcel = smallParcel()
    const r = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt: 5000, // way bigger than the ~441ft parcel
      lengthFt: 5000,
      rotationDeg: 0,
    })
    expect(fitsWithinParcel(r, parcel)).toBe(false)
  })

  it('returns false for a rectangle centered outside the parcel', () => {
    const parcel = smallParcel()
    const r = rectangleFromDimensions({
      center: [TN_CENTER[0] + 0.05, TN_CENTER[1]],
      widthFt: 40,
      lengthFt: 60,
      rotationDeg: 0,
    })
    expect(fitsWithinParcel(r, parcel)).toBe(false)
  })

  it('returns true when footprint fits inside one part of a MultiPolygon', () => {
    const part1 = smallParcel().coordinates
    const part2: Polygon['coordinates'] = part1.map((ring) =>
      ring.map(([lng, lat]) => [lng + 0.05, lat]),
    )
    const multi: PolygonOrMulti = { type: 'MultiPolygon', coordinates: [part1, part2] }
    const r = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt: 40,
      lengthFt: 60,
      rotationDeg: 0,
    })
    expect(fitsWithinParcel(r, multi)).toBe(true)
  })
})

describe('closestBoundaryFt', () => {
  it('returns a positive distance', () => {
    const parcel = smallParcel()
    const r = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt: 40,
      lengthFt: 60,
      rotationDeg: 0,
    })
    const d = closestBoundaryFt(r, parcel)
    expect(d).not.toBeNull()
    expect(d!).toBeGreaterThan(0)
  })

  it('returns a smaller distance when footprint is near an edge', () => {
    const parcel = smallParcel()
    const centered = closestBoundaryFt(
      rectangleFromDimensions({
        center: TN_CENTER,
        widthFt: 40,
        lengthFt: 60,
        rotationDeg: 0,
      }),
      parcel,
    )
    const nearEdge = closestBoundaryFt(
      rectangleFromDimensions({
        center: [TN_CENTER[0] + 0.0015, TN_CENTER[1]],
        widthFt: 40,
        lengthFt: 60,
        rotationDeg: 0,
      }),
      parcel,
    )
    expect(nearEdge!).toBeLessThan(centered!)
  })

  it('measures point-to-edge, not vertex-to-vertex', () => {
    // Parcel with very sparse vertices: a long thin rectangle stretching
    // east-west. A footprint placed at the geometric center has its
    // closest vertex very far from any parcel vertex (corners are ~440 ft
    // away each), but the closest EDGE is much nearer. A vertex-to-vertex
    // implementation would overstate the clearance; point-to-line gives
    // the true perpendicular distance.
    const lng = TN_CENTER[0]
    const lat = TN_CENTER[1]
    const longParcel: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [lng - 0.01, lat - 0.0002],
          [lng + 0.01, lat - 0.0002],
          [lng + 0.01, lat + 0.0002],
          [lng - 0.01, lat + 0.0002],
          [lng - 0.01, lat - 0.0002],
        ],
      ],
    }
    const r = rectangleFromDimensions({
      center: TN_CENTER,
      widthFt: 20,
      lengthFt: 20,
      rotationDeg: 0,
    })
    const d = closestBoundaryFt(r, longParcel)
    expect(d).not.toBeNull()
    // Parcel half-width N-S is ~0.0002 deg lat = ~22 m = ~73 ft.
    // Footprint half-length is 10 ft. True clearance is ~63 ft. A
    // vertex-to-vertex implementation would return >440 ft (corner-to-corner
    // distance). Assert we're well under that bound.
    expect(d!).toBeLessThan(150)
    expect(d!).toBeGreaterThan(40)
  })
})

describe('normalizeParcel', () => {
  it('passes Polygon through unchanged', () => {
    const p = smallParcel()
    const out = normalizeParcel(p)
    expect(out.warning).toBeNull()
    expect(out.full).toBe(p)
    expect(out.largest).toBe(p)
  })

  it('picks the largest part of a MultiPolygon and warns', () => {
    const big = smallParcel().coordinates
    const small: Polygon['coordinates'] = [
      [
        [-82.35, 36.31],
        [-82.3499, 36.31],
        [-82.3499, 36.3101],
        [-82.35, 36.3101],
        [-82.35, 36.31],
      ],
    ]
    const multi: PolygonOrMulti = { type: 'MultiPolygon', coordinates: [small, big] }
    const out = normalizeParcel(multi)
    expect(out.warning).not.toBeNull()
    expect(out.largest.coordinates).toEqual(big)
  })
})

describe('footprintLabels', () => {
  const baseRect = rectangleFromDimensions({
    center: TN_CENTER,
    widthFt: 40,
    lengthFt: 60,
    rotationDeg: 0,
  })

  it('returns exactly 3 features (width, length, area)', () => {
    const labels = footprintLabels({ footprint: baseRect, widthFt: 40, lengthFt: 60 })
    expect(labels).toHaveLength(3)
    for (const f of labels) expect(f.geometry.type).toBe('Point')
  })

  it('label strings are deterministic for the same input', () => {
    const a = footprintLabels({ footprint: baseRect, widthFt: 40, lengthFt: 60 })
    const b = footprintLabels({ footprint: baseRect, widthFt: 40, lengthFt: 60 })
    expect(a.map((f) => f.properties?.label)).toEqual(b.map((f) => f.properties?.label))
  })

  it('label texts include the typed dimensions and area', () => {
    const labels = footprintLabels({ footprint: baseRect, widthFt: 40, lengthFt: 60 })
    const texts = labels.map((f) => f.properties?.label as string)
    expect(texts).toContain('40 ft')
    expect(texts).toContain('60 ft')
    expect(texts).toContain('2,400 sqft')
  })

  it('formats fractional dimensions to one decimal', () => {
    const labels = footprintLabels({ footprint: baseRect, widthFt: 40.5, lengthFt: 60 })
    const texts = labels.map((f) => f.properties?.label as string)
    expect(texts.some((t) => t === '40.5 ft')).toBe(true)
  })

  it('points sit roughly at expected places (within ~0.0005 deg)', () => {
    const labels = footprintLabels({ footprint: baseRect, widthFt: 40, lengthFt: 60 })
    // Width-edge midpoint: same lng as center, lat shift toward north OR south
    // depending on which edge the helper chose. Length-edge midpoint:
    // shifted in lng. Center label: at the rectangle centroid.
    const center = labels.find((f) => (f.properties?.label as string).includes('sqft'))
    expect(center).toBeDefined()
    expect(Math.abs(center!.geometry.coordinates[0]! - TN_CENTER[0])).toBeLessThan(0.0005)
    expect(Math.abs(center!.geometry.coordinates[1]! - TN_CENTER[1])).toBeLessThan(0.0005)
  })

  it('returns an empty array on a malformed footprint', () => {
    const empty: typeof baseRect = { type: 'Polygon', coordinates: [[]] }
    expect(footprintLabels({ footprint: empty, widthFt: 40, lengthFt: 60 })).toEqual([])
  })
})

describe('defaultFootprintCenter', () => {
  it('returns a centroid for a Polygon', () => {
    const c = defaultFootprintCenter(smallParcel())
    expect(c).not.toBeNull()
    expect(c![0]).toBeCloseTo(TN_CENTER[0], 4)
    expect(c![1]).toBeCloseTo(TN_CENTER[1], 4)
  })
})
