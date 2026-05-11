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
  setbackEnvelope,
  envelopeAreaSqft,
  insetPolygonRing,
  parcelEdgeLineFeatures,
  parcelEdgeLabelFeatures,
  floodSeverityFor,
  worseSeverity,
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

describe('setbackEnvelope', () => {
  it('returns null for zero or negative setback', () => {
    const parcel = smallParcel()
    expect(setbackEnvelope(parcel, 0)).toBeNull()
    expect(setbackEnvelope(parcel, -5)).toBeNull()
    expect(setbackEnvelope(parcel, Number.NaN)).toBeNull()
  })

  it('returns a smaller polygon than the parcel for positive setback', () => {
    const parcel = smallParcel()
    const env = setbackEnvelope(parcel, 25)
    expect(env).not.toBeNull()
    expect(envelopeAreaSqft(env!)).toBeLessThan(parcelAreaSqft(parcel))
    expect(envelopeAreaSqft(env!)).toBeGreaterThan(0)
  })

  it('returns null when setback collapses the parcel', () => {
    // smallParcel() is ~0.002 deg square at TN_CENTER. At lat 36 that's
    // ~220m E-W and ~222m N-S. A 500ft = ~152m setback halves the parcel;
    // a 2000ft = ~610m setback eats it entirely.
    const env = setbackEnvelope(smallParcel(), 2000)
    expect(env).toBeNull()
  })

  it('envelope fits within the parcel', () => {
    const parcel = smallParcel()
    const env = setbackEnvelope(parcel, 20)
    expect(env).not.toBeNull()
    // A footprint that fits in the envelope must also fit in the parcel.
    // Build a small rectangle at the envelope's largest-part center.
    const norm = normalizeParcel(env!)
    const center = defaultFootprintCenter(norm.full)!
    const inside = rectangleFromDimensions({ center, widthFt: 5, lengthFt: 5, rotationDeg: 0 })
    expect(fitsWithinParcel(inside, env!)).toBe(true)
    expect(fitsWithinParcel(inside, parcel)).toBe(true)
  })

  it('handles MultiPolygon parcels', () => {
    const part1 = smallParcel().coordinates
    const part2 = part1.map((ring) => ring.map(([lng, lat]) => [lng + 0.05, lat])) as typeof part1
    const multi = { type: 'MultiPolygon' as const, coordinates: [part1, part2] }
    const env = setbackEnvelope(multi, 20)
    expect(env).not.toBeNull()
    expect(envelopeAreaSqft(env!)).toBeGreaterThan(0)
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

// ── Phase 6a: straight-line inset (insetPolygonRing) ───────────────────────
//
// Each test pins a numeric property of the inset polygon (vertex count,
// area, distance from boundary) so a refactor of the math has hard
// regression signal.

describe('insetPolygonRing', () => {
  // A clean ~10m x 10m square in lng/lat near TN_CENTER. At lat ~36°,
  // 1 meter ≈ 1.108e-5° lng and 8.983e-6° lat.
  function metersToLngLatSquare(sideMeters: number): number[][] {
    const lng = TN_CENTER[0]
    const lat = TN_CENTER[1]
    const half = sideMeters / 2
    const dLat = half / 111_320
    const dLng = half / (111_320 * Math.cos((lat * Math.PI) / 180))
    return [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ]
  }

  it('returns null on a < 4-vertex ring (no closing duplicate)', () => {
    expect(
      insetPolygonRing(
        [
          [-82.35, 36.31],
          [-82.34, 36.31],
          [-82.34, 36.32],
        ],
        5,
      ),
    ).toBeNull()
  })

  it('returns null on zero or negative uniform distance (no-op)', () => {
    const square = metersToLngLatSquare(40)
    // 0 -> all distances are zero -> null (no real inset).
    expect(insetPolygonRing(square, 0)).toBeNull()
    expect(insetPolygonRing(square, -5)).toBeNull()
    expect(insetPolygonRing(square, Number.NaN)).toBeNull()
  })

  it('inset of a 10 m square by 1 ft (~0.305 m) leaves a smaller square', () => {
    // Square is 10 m on a side. 1 ft inset removes a 0.305 m strip from
    // each side: side becomes 10 - 2*0.305 = 9.39 m, area becomes ~88.2 m².
    const ring = metersToLngLatSquare(10)
    const inset = insetPolygonRing(ring, 1)
    expect(inset).not.toBeNull()
    if (!inset) return
    // Closed ring => 5 vertices (4 corners + closing copy).
    expect(inset).toHaveLength(5)
    // The inset rectangle should still be a rectangle: top-left x ≈
    // bottom-left x; top-right x ≈ bottom-right x. Just sanity-check that
    // each axis shrank toward the centroid.
    const lngs = inset.slice(0, 4).map((p) => p[0] ?? 0).sort((a, b) => a - b)
    const lats = inset.slice(0, 4).map((p) => p[1] ?? 0).sort((a, b) => a - b)
    const original = ring.slice(0, 4)
    const origLngs = original.map((p) => p[0] ?? 0).sort((a, b) => a - b)
    const origLats = original.map((p) => p[1] ?? 0).sort((a, b) => a - b)
    // Min/max should have moved INWARD by some positive amount.
    expect(lngs[0]!).toBeGreaterThan(origLngs[0]!)
    expect(lngs[3]!).toBeLessThan(origLngs[3]!)
    expect(lats[0]!).toBeGreaterThan(origLats[0]!)
    expect(lats[3]!).toBeLessThan(origLats[3]!)
  })

  it('inset area matches the expected analytic shrink for a square', () => {
    // 30 m square inset by 1 m -> 28 m square, area 784 m² = 8438 sqft.
    // 1 m ≈ 3.2808 ft, so the inset distance argument is 1 / FEET_PER_METER
    // in ft. The math: original 30² = 900 m² → 784 m². Convert to sqft.
    const ring = metersToLngLatSquare(30)
    const oneMeterInFt = 1 / 0.3048 // ≈ 3.2808
    const inset = insetPolygonRing(ring, oneMeterInFt)
    expect(inset).not.toBeNull()
    if (!inset) return
    const insetArea =
      // Use Turf via parcelAreaSqft for consistency with the rest of the suite.
      parcelAreaSqft({ type: 'Polygon', coordinates: [inset] })
    // Expected area: 784 m² × SQM_TO_SQFT ≈ 8438 sqft. Tolerance 5% for the
    // equirectangular approximation at TN latitudes.
    const expected = 784 * SQM_TO_SQFT
    expect(insetArea).toBeGreaterThan(expected * 0.95)
    expect(insetArea).toBeLessThan(expected * 1.05)
  })

  it('inset collapses to null when distance exceeds half the parcel width', () => {
    const ring = metersToLngLatSquare(10)
    // 50 ft ≈ 15.2 m. Half the parcel is 5 m. The polygon should collapse.
    expect(insetPolygonRing(ring, 50)).toBeNull()
  })

  it('handles CW (negative-area) rings by reversing internally', () => {
    // Same square but in CW order. The inset should still produce a valid
    // inward result (the routine detects orientation via signed area).
    const ccw = metersToLngLatSquare(10)
    const cw = ccw.slice(0, 4).reverse().concat([ccw[0]!])
    const insetCCW = insetPolygonRing(ccw, 1)
    const insetCW = insetPolygonRing(cw, 1)
    expect(insetCCW).not.toBeNull()
    expect(insetCW).not.toBeNull()
    if (!insetCCW || !insetCW) return
    // Area should be the same regardless of input orientation.
    const aCCW = parcelAreaSqft({ type: 'Polygon', coordinates: [insetCCW] })
    const aCW = parcelAreaSqft({ type: 'Polygon', coordinates: [insetCW] })
    expect(aCW).toBeCloseTo(aCCW, 2)
  })

  it('accepts a per-edge distance array (Phase 6c will use this)', () => {
    // 20 m square, four distances. With all 4 set to the same value we
    // get the same result as the uniform-number path.
    const ring = metersToLngLatSquare(20)
    const insetUniform = insetPolygonRing(ring, 1.5)
    const insetArray = insetPolygonRing(ring, [1.5, 1.5, 1.5, 1.5])
    expect(insetUniform).not.toBeNull()
    expect(insetArray).not.toBeNull()
    if (!insetUniform || !insetArray) return
    const aU = parcelAreaSqft({ type: 'Polygon', coordinates: [insetUniform] })
    const aA = parcelAreaSqft({ type: 'Polygon', coordinates: [insetArray] })
    expect(aA).toBeCloseTo(aU, 1)
  })

  it('rejects a per-edge array with the wrong length', () => {
    const ring = metersToLngLatSquare(10)
    // 4 edges, 3 distances -> null.
    expect(insetPolygonRing(ring, [1, 1, 1])).toBeNull()
  })

  it('rejects per-edge negative or non-finite distances', () => {
    const ring = metersToLngLatSquare(10)
    expect(insetPolygonRing(ring, [1, -1, 1, 1])).toBeNull()
    expect(insetPolygonRing(ring, [1, Number.NaN, 1, 1])).toBeNull()
  })

  it('produces sharp corners (no Turf-buffer rounding)', () => {
    // Sharp-corner property: a 4-vertex input produces a 4-vertex output
    // (closing duplicate excluded). Turf buffer rounding would yield
    // many vertices along each corner arc.
    const ring = metersToLngLatSquare(20)
    const inset = insetPolygonRing(ring, 2)
    expect(inset).not.toBeNull()
    if (!inset) return
    // 4 corners + 1 closing duplicate.
    expect(inset).toHaveLength(5)
  })
})

describe('setbackEnvelope (Phase 6a path)', () => {
  it('returns a Polygon for a simple parcel', () => {
    const parcel = smallParcel()
    const env = setbackEnvelope(parcel, 10)
    expect(env).not.toBeNull()
    expect(env?.type).toBe('Polygon')
  })

  it('drops parts that collapse during MultiPolygon inset', () => {
    // Two parts, one big, one tiny. Tiny part should collapse and the
    // result should be Polygon (single part) not MultiPolygon.
    const big = smallParcel().coordinates
    // 5 m x 5 m square is too small to survive a 25 ft (~7.6 m) inset.
    const lng = TN_CENTER[0] + 0.05
    const lat = TN_CENTER[1]
    const halfM = 2.5
    const dLat = halfM / 111_320
    const dLng = halfM / (111_320 * Math.cos((lat * Math.PI) / 180))
    const tiny: number[][][] = [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ]
    const multi = { type: 'MultiPolygon' as const, coordinates: [big, tiny] }
    const env = setbackEnvelope(multi, 25)
    expect(env).not.toBeNull()
    expect(env?.type).toBe('Polygon') // tiny part dropped
  })
})

// ── Phase 6b: parcel edge feature builders ─────────────────────────────────

describe('parcelEdgeLineFeatures', () => {
  it('emits one LineString per exterior edge of a Polygon parcel', () => {
    const parcel = smallParcel() // 4 corners + closing duplicate = 4 edges
    const features = parcelEdgeLineFeatures(parcel, [])
    expect(features).toHaveLength(4)
    expect(features[0]?.geometry.type).toBe('LineString')
    expect(features[0]?.properties?.edgeIndex).toBe(0)
    expect(features[0]?.properties?.label).toBe('none')
    expect(features[3]?.properties?.edgeIndex).toBe(3)
  })

  it("tags edges with their applied label (front / side / rear / other)", () => {
    const parcel = smallParcel()
    const features = parcelEdgeLineFeatures(parcel, [
      { edgeIndex: 0, label: 'front' },
      { edgeIndex: 2, label: 'rear' },
    ])
    expect(features[0]?.properties?.label).toBe('front')
    expect(features[1]?.properties?.label).toBe('none')
    expect(features[2]?.properties?.label).toBe('rear')
    expect(features[3]?.properties?.label).toBe('none')
  })

  it('targets the largest part of a MultiPolygon parcel', () => {
    // Two non-overlapping parts; the larger one should source the edges.
    const big = smallParcel().coordinates
    const lng = TN_CENTER[0] + 0.05
    const lat = TN_CENTER[1]
    const halfM = 5
    const dLat = halfM / 111_320
    const dLng = halfM / (111_320 * Math.cos((lat * Math.PI) / 180))
    const tiny: number[][][] = [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ]
    const multi = { type: 'MultiPolygon' as const, coordinates: [tiny, big] }
    const features = parcelEdgeLineFeatures(multi, [])
    // Big has 4 edges. If we'd accidentally sourced from tiny, edges
    // would also be 4 but coordinates would differ. Check the first edge
    // origin is near TN_CENTER (big), not near +0.05 lng (tiny).
    const firstEdge = features[0]?.geometry.coordinates[0]
    expect(firstEdge?.[0]).toBeLessThan(-82.2) // big sits near -82.35
  })

  it('returns [] for malformed input', () => {
    expect(parcelEdgeLineFeatures({ type: 'Polygon', coordinates: [[]] }, [])).toEqual([])
  })
})

describe('parcelEdgeLabelFeatures', () => {
  it('emits Point features only for LABELED edges', () => {
    const parcel = smallParcel()
    const features = parcelEdgeLabelFeatures(parcel, [
      { edgeIndex: 0, label: 'front' },
      { edgeIndex: 2, label: 'rear' },
    ])
    expect(features).toHaveLength(2)
    expect(features[0]?.properties?.letter).toBe('F')
    expect(features[1]?.properties?.letter).toBe('R')
  })

  it('skips invalid edge indices', () => {
    const parcel = smallParcel() // 4 edges, valid indices 0..3
    const features = parcelEdgeLabelFeatures(parcel, [
      { edgeIndex: 0, label: 'front' },
      { edgeIndex: 99, label: 'rear' }, // out of range; ignored
      { edgeIndex: -1, label: 'side' }, // out of range; ignored
    ])
    expect(features).toHaveLength(1)
  })

  it('places the Point at the edge midpoint', () => {
    const parcel = smallParcel()
    const features = parcelEdgeLabelFeatures(parcel, [{ edgeIndex: 0, label: 'front' }])
    const ring = parcel.coordinates[0] as number[][]
    const a = ring[0]!
    const b = ring[1]!
    const expectedMid = [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2]
    expect(features[0]?.geometry.coordinates[0]).toBeCloseTo(expectedMid[0]!, 6)
    expect(features[0]?.geometry.coordinates[1]).toBeCloseTo(expectedMid[1]!, 6)
  })
})

// ── Phase 6e: flood-zone severity helpers ──────────────────────────────────

describe('floodSeverityFor', () => {
  it('classifies coastal zones (V, VE) as error', () => {
    expect(floodSeverityFor('V')).toBe('error')
    expect(floodSeverityFor('VE')).toBe('error')
  })
  it('classifies 1% chance SFHA zones (A, AE, AO, AH) as warning', () => {
    for (const z of ['A', 'AE', 'AO', 'AH']) {
      expect(floodSeverityFor(z)).toBe('warning')
    }
  })
  it('classifies 0.2% chance and undetermined as info', () => {
    expect(floodSeverityFor('X500')).toBe('info')
    expect(floodSeverityFor('D')).toBe('info')
  })
  it('classifies plain X (outside SFHA) as none', () => {
    expect(floodSeverityFor('X')).toBe('none')
  })
  it('case-insensitive and trims whitespace', () => {
    expect(floodSeverityFor(' ve ')).toBe('error')
    expect(floodSeverityFor('ae')).toBe('warning')
  })
  it('returns none for null / undefined / empty input', () => {
    expect(floodSeverityFor(null)).toBe('none')
    expect(floodSeverityFor(undefined)).toBe('none')
    expect(floodSeverityFor('')).toBe('none')
  })
  it('unknown codes default to info (surface without alarm)', () => {
    expect(floodSeverityFor('B')).toBe('info') // legacy pre-1986 code
    expect(floodSeverityFor('FLOODWAY')).toBe('info')
  })
})

describe('worseSeverity', () => {
  it('returns the higher-severity tier', () => {
    expect(worseSeverity('none', 'info')).toBe('info')
    expect(worseSeverity('info', 'warning')).toBe('warning')
    expect(worseSeverity('warning', 'error')).toBe('error')
    expect(worseSeverity('error', 'info')).toBe('error')
    expect(worseSeverity('none', 'none')).toBe('none')
  })
})
