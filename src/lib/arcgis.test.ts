import { describe, it, expect } from 'vitest'
import { toParcelFeature } from './arcgis'

// Minimal ParcelFeature-shaped fixture with the load-bearing fields the
// helper checks: type='Feature', a valid Polygon geometry, an object
// properties bag, and a numeric OBJECTID.
const validFixture = {
  type: 'Feature' as const,
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-82.35, 36.31],
        [-82.34, 36.31],
        [-82.34, 36.32],
        [-82.35, 36.32],
        [-82.35, 36.31],
      ],
    ],
  },
  properties: {
    OBJECTID: 12345,
    GISLINK: '090046M H 01300',
    OWNER: 'SMITH JOHN',
    ADDRESS: '112 FOXHALL CIR',
  },
}

describe('toParcelFeature', () => {
  it('accepts a well-formed parcel feature', () => {
    const out = toParcelFeature(validFixture)
    expect(out).not.toBeNull()
    expect(out?.properties.GISLINK).toBe('090046M H 01300')
    expect(out?.geometry.type).toBe('Polygon')
  })

  it('accepts a MultiPolygon parcel feature', () => {
    const multi = {
      ...validFixture,
      geometry: {
        type: 'MultiPolygon' as const,
        coordinates: [validFixture.geometry.coordinates],
      },
    }
    expect(toParcelFeature(multi)).not.toBeNull()
  })

  it('returns null for null / undefined / non-object inputs', () => {
    expect(toParcelFeature(null)).toBeNull()
    expect(toParcelFeature(undefined)).toBeNull()
    expect(toParcelFeature(42)).toBeNull()
    expect(toParcelFeature('a string')).toBeNull()
  })

  it("returns null when type is not 'Feature'", () => {
    const wrongType = { ...validFixture, type: 'FeatureCollection' }
    expect(toParcelFeature(wrongType)).toBeNull()
  })

  it('returns null when geometry is missing', () => {
    const noGeom = { ...validFixture, geometry: undefined }
    expect(toParcelFeature(noGeom)).toBeNull()
  })

  it('returns null when geometry type is not Polygon or MultiPolygon', () => {
    const point = {
      ...validFixture,
      geometry: { type: 'Point' as const, coordinates: [0, 0] as unknown },
    }
    expect(toParcelFeature(point)).toBeNull()
  })

  it('returns null when properties is missing or non-object', () => {
    expect(toParcelFeature({ ...validFixture, properties: undefined })).toBeNull()
    expect(toParcelFeature({ ...validFixture, properties: null })).toBeNull()
    expect(toParcelFeature({ ...validFixture, properties: 'oops' })).toBeNull()
  })

  it('returns null when OBJECTID is missing or non-numeric', () => {
    expect(
      toParcelFeature({ ...validFixture, properties: { ...validFixture.properties, OBJECTID: undefined } }),
    ).toBeNull()
    expect(
      toParcelFeature({ ...validFixture, properties: { ...validFixture.properties, OBJECTID: 'oops' } }),
    ).toBeNull()
  })
})
