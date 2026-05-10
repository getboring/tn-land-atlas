import { describe, it, expect } from 'vitest'
import {
  BuildFitStoreSchema,
  FootprintProjectSchema,
  SetbackConfigSchema,
  PolygonSchema,
  PolygonOrMultiSchema,
  type BuildFitStore,
  type FootprintProject,
} from './schemas'

const ISO = '2026-05-10T12:00:00.000Z'

const validRectangleFootprint: FootprintProject = {
  id: 'fp-001',
  name: '40x60 shop',
  kind: 'rectangle',
  widthFt: 40,
  lengthFt: 60,
  rotationDeg: 0,
  stories: 1,
  footprintSqft: 2400,
  geometry: null,
  createdFrom: 'typed-dimensions',
  notes: null,
  createdAt: ISO,
  updatedAt: ISO,
}

describe('PolygonSchema', () => {
  it('accepts a valid closed-ring polygon', () => {
    expect(
      PolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [[-82.35, 36.31], [-82.34, 36.31], [-82.34, 36.32], [-82.35, 36.32], [-82.35, 36.31]],
        ],
      }).success,
    ).toBe(true)
  })

  it('rejects rings with fewer than 4 positions', () => {
    expect(
      PolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [[[-82, 36], [-82, 37], [-83, 36]]],
      }).success,
    ).toBe(false)
  })

  it('rejects positions with fewer than 2 numbers', () => {
    expect(
      PolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [[[1], [2], [3], [4]]],
      }).success,
    ).toBe(false)
  })

  it('rejects wrong type literal', () => {
    expect(
      PolygonSchema.safeParse({
        type: 'LineString',
        coordinates: [[-82, 36], [-82, 37], [-83, 36], [-82, 36]],
      }).success,
    ).toBe(false)
  })

  it('rejects an empty rings array (no exterior ring)', () => {
    expect(PolygonSchema.safeParse({ type: 'Polygon', coordinates: [] }).success).toBe(false)
  })
})

describe('PolygonOrMultiSchema (discriminated union)', () => {
  it('parses a Polygon', () => {
    expect(
      PolygonOrMultiSchema.safeParse({
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      }).success,
    ).toBe(true)
  })

  it('parses a MultiPolygon', () => {
    expect(
      PolygonOrMultiSchema.safeParse({
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
        ],
      }).success,
    ).toBe(true)
  })

  it('rejects a MultiPolygon with no parts', () => {
    expect(
      PolygonOrMultiSchema.safeParse({ type: 'MultiPolygon', coordinates: [] }).success,
    ).toBe(false)
  })

  it('rejects a MultiPolygon part with no rings', () => {
    expect(
      PolygonOrMultiSchema.safeParse({ type: 'MultiPolygon', coordinates: [[]] }).success,
    ).toBe(false)
  })
})

describe('SetbackConfigSchema (discriminated on mode)', () => {
  it('parses none', () => {
    expect(SetbackConfigSchema.safeParse({ mode: 'none' }).success).toBe(true)
  })
  it('parses uniform', () => {
    expect(SetbackConfigSchema.safeParse({ mode: 'uniform', setbackFt: 15 }).success).toBe(true)
  })
  it('parses manual with nullable fields', () => {
    expect(
      SetbackConfigSchema.safeParse({
        mode: 'manual',
        frontFt: 25,
        sideFt: null,
        rearFt: 20,
        notes: 'front per zoning',
      }).success,
    ).toBe(true)
  })
  it('rejects uniform missing setbackFt', () => {
    expect(SetbackConfigSchema.safeParse({ mode: 'uniform' }).success).toBe(false)
  })
  it('rejects unknown mode', () => {
    expect(SetbackConfigSchema.safeParse({ mode: 'square' }).success).toBe(false)
  })
})

describe('FootprintProjectSchema', () => {
  it('parses a valid rectangle template', () => {
    expect(FootprintProjectSchema.safeParse(validRectangleFootprint).success).toBe(true)
  })
  it('rejects empty id', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, id: '' }).success,
    ).toBe(false)
  })
  it('rejects unknown kind', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, kind: 'circle' }).success,
    ).toBe(false)
  })
  it('accepts null geometry (template not yet placed)', () => {
    const out = FootprintProjectSchema.parse(validRectangleFootprint)
    expect(out.geometry).toBeNull()
  })

  it('rotationDeg defaults to 0 when omitted (backward-compat read)', () => {
    const legacy: Record<string, unknown> = { ...validRectangleFootprint }
    delete legacy.rotationDeg
    const result = FootprintProjectSchema.safeParse(legacy)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.rotationDeg).toBe(0)
  })

  it('preserves rotationDeg through parse', () => {
    const out = FootprintProjectSchema.parse({ ...validRectangleFootprint, rotationDeg: 45 })
    expect(out.rotationDeg).toBe(45)
  })
})

describe('BuildFitStoreSchema', () => {
  const empty: BuildFitStore = {
    schemaVersion: 1,
    footprints: [],
    sessions: [],
    updatedAt: ISO,
  }

  it('parses an empty v1 store', () => {
    expect(BuildFitStoreSchema.safeParse(empty).success).toBe(true)
  })

  it('rejects schemaVersion !== 1', () => {
    expect(BuildFitStoreSchema.safeParse({ ...empty, schemaVersion: 2 }).success).toBe(false)
  })

  it('rejects missing schemaVersion', () => {
    const rest: Omit<BuildFitStore, 'schemaVersion'> = {
      footprints: empty.footprints,
      sessions: empty.sessions,
      updatedAt: empty.updatedAt,
    }
    expect(BuildFitStoreSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects malformed footprints array', () => {
    expect(
      BuildFitStoreSchema.safeParse({ ...empty, footprints: [{ id: 'no-name-here' }] }).success,
    ).toBe(false)
  })

  it('parses a store with one footprint', () => {
    expect(
      BuildFitStoreSchema.safeParse({
        ...empty,
        footprints: [validRectangleFootprint],
      }).success,
    ).toBe(true)
  })
})
