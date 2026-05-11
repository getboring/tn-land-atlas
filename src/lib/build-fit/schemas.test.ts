import { describe, it, expect } from 'vitest'
import {
  BuildFitStoreSchema,
  BuildFitStoreSchemaV1,
  FitWarningSchema,
  FootprintProjectSchema,
  SetbackConfigSchema,
  PolygonSchema,
  PolygonOrMultiSchema,
  EdgeLabelSchema,
  migrateV1ToV2,
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
  it('rejects negative uniform setback', () => {
    expect(
      SetbackConfigSchema.safeParse({ mode: 'uniform', setbackFt: -5 }).success,
    ).toBe(false)
  })
  it('accepts zero uniform setback (clears the envelope)', () => {
    expect(
      SetbackConfigSchema.safeParse({ mode: 'uniform', setbackFt: 0 }).success,
    ).toBe(true)
  })
  it('rejects negative manual setbacks', () => {
    expect(
      SetbackConfigSchema.safeParse({
        mode: 'manual',
        frontFt: -1,
        sideFt: null,
        rearFt: null,
        notes: null,
      }).success,
    ).toBe(false)
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

  // ── Phase 4 hardening: positive caps + sane upper bounds ────────────
  it('rejects negative widthFt', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, widthFt: -10 }).success,
    ).toBe(false)
  })
  it('rejects zero widthFt', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, widthFt: 0 }).success,
    ).toBe(false)
  })
  it('rejects negative lengthFt', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, lengthFt: -1 }).success,
    ).toBe(false)
  })
  it('rejects negative footprintSqft', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, footprintSqft: -1 }).success,
    ).toBe(false)
  })
  it('rejects unreasonably large widthFt (cap at 100k)', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, widthFt: 100_001 }).success,
    ).toBe(false)
  })
  it('rejects fractional stories (must be integer)', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, stories: 1.5 }).success,
    ).toBe(false)
  })
  it('rejects negative stories', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, stories: -1 }).success,
    ).toBe(false)
  })
  it('rejects oversized name (over 200 chars)', () => {
    expect(
      FootprintProjectSchema.safeParse({ ...validRectangleFootprint, name: 'A'.repeat(201) }).success,
    ).toBe(false)
  })
})

describe('BuildFitStoreSchema', () => {
  const empty: BuildFitStore = {
    schemaVersion: 2,
    footprints: [],
    sessions: [],
    updatedAt: ISO,
  }

  it('parses an empty v2 store', () => {
    expect(BuildFitStoreSchema.safeParse(empty).success).toBe(true)
  })

  it('rejects schemaVersion !== 2', () => {
    expect(BuildFitStoreSchema.safeParse({ ...empty, schemaVersion: 3 }).success).toBe(false)
    expect(BuildFitStoreSchema.safeParse({ ...empty, schemaVersion: 1 }).success).toBe(false)
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

// ── Phase 6 schemas ─────────────────────────────────────────────────────────

describe('FitWarningSchema', () => {
  it('accepts a complete structured warning', () => {
    expect(
      FitWarningSchema.safeParse({
        severity: 'warning',
        source: 'setback',
        code: 'uniform-approximation',
        message: 'Uniform setback approximation. Verify with local code.',
      }).success,
    ).toBe(true)
  })
  it('rejects unknown severity', () => {
    expect(
      FitWarningSchema.safeParse({
        severity: 'critical',
        source: 'flood',
        code: 'x',
        message: 'y',
      }).success,
    ).toBe(false)
  })
  it('rejects unknown source', () => {
    expect(
      FitWarningSchema.safeParse({
        severity: 'warning',
        source: 'martians',
        code: 'x',
        message: 'y',
      }).success,
    ).toBe(false)
  })
  it('rejects empty code or message', () => {
    expect(
      FitWarningSchema.safeParse({ severity: 'info', source: 'flood', code: '', message: 'x' }).success,
    ).toBe(false)
    expect(
      FitWarningSchema.safeParse({ severity: 'info', source: 'flood', code: 'x', message: '' }).success,
    ).toBe(false)
  })
})

describe('EdgeLabelSchema', () => {
  it('accepts a labeled edge', () => {
    expect(EdgeLabelSchema.safeParse({ edgeIndex: 0, label: 'front' }).success).toBe(true)
    expect(EdgeLabelSchema.safeParse({ edgeIndex: 3, label: 'rear' }).success).toBe(true)
  })
  it('rejects unknown label', () => {
    expect(
      EdgeLabelSchema.safeParse({ edgeIndex: 0, label: 'driveway' }).success,
    ).toBe(false)
  })
  it('rejects negative or fractional edgeIndex', () => {
    expect(EdgeLabelSchema.safeParse({ edgeIndex: -1, label: 'front' }).success).toBe(false)
    expect(EdgeLabelSchema.safeParse({ edgeIndex: 1.5, label: 'front' }).success).toBe(false)
  })
})

describe('BuildFitStoreSchemaV1 + migrateV1ToV2', () => {
  it('parses a v1 envelope literal', () => {
    expect(
      BuildFitStoreSchemaV1.safeParse({
        schemaVersion: 1,
        footprints: [],
        sessions: [],
        updatedAt: ISO,
      }).success,
    ).toBe(true)
  })

  it('rejects a v2 envelope (forces v2 callers off the v1 path)', () => {
    expect(
      BuildFitStoreSchemaV1.safeParse({
        schemaVersion: 2,
        footprints: [],
        sessions: [],
        updatedAt: ISO,
      }).success,
    ).toBe(false)
  })

  it('migrates v1 -> v2 with legacy string warnings becoming imported FitWarnings', () => {
    const v1Session = {
      id: 'sess-1',
      parcelKey: '090046M H 01300',
      parcelSnapshot: {
        parcelKey: '090046M H 01300',
        ownerName: 'SMITH JOHN',
        address: null,
        county: null,
        acres: null,
        zoning: null,
        appraisalDollars: null,
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
        capturedAt: ISO,
      },
      footprintProjectId: 'fp-1',
      placement: {
        center: { lng: -82.345, lat: 36.315 },
        rotationDeg: 0,
        widthFt: 40,
        lengthFt: 60,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-82.346, 36.314],
              [-82.345, 36.314],
              [-82.345, 36.315],
              [-82.346, 36.315],
              [-82.346, 36.314],
            ],
          ],
        },
      },
      setbackConfig: { mode: 'none' as const },
      envelope: {
        mode: 'none' as const,
        geometry: null,
        warnings: ['Legacy envelope warning'],
      },
      result: {
        status: 'fits' as const,
        fitsParcel: true,
        fitsEnvelope: null,
        footprintSqft: 2400,
        parcelSqft: 65340,
        coveragePct: 3.7,
        closestBoundaryFt: 18,
        measurementMethod: 'geodesic' as const,
        conflicts: [],
        warnings: ['Legacy result warning', 'Another legacy warning'],
        computedAt: ISO,
      },
      createdAt: ISO,
      updatedAt: ISO,
    }
    const v1Store = {
      schemaVersion: 1 as const,
      footprints: [validRectangleFootprint],
      sessions: [v1Session],
      updatedAt: ISO,
    }
    const v1Parsed = BuildFitStoreSchemaV1.parse(v1Store)
    const v2 = migrateV1ToV2(v1Parsed)
    expect(v2.schemaVersion).toBe(2)
    expect(v2.footprints).toHaveLength(1)
    expect(v2.sessions).toHaveLength(1)
    const session0 = v2.sessions[0]
    expect(session0).toBeDefined()
    if (!session0) return
    expect(session0.envelope.warnings).toEqual([
      { severity: 'warning', source: 'imported', code: 'legacy-string', message: 'Legacy envelope warning' },
    ])
    expect(session0.result.warnings).toHaveLength(2)
    expect(session0.result.warnings[0]).toEqual({
      severity: 'warning',
      source: 'imported',
      code: 'legacy-string',
      message: 'Legacy result warning',
    })
  })

  it('v2 output passes BuildFitStoreSchema (v2)', () => {
    const v1Parsed = BuildFitStoreSchemaV1.parse({
      schemaVersion: 1,
      footprints: [],
      sessions: [],
      updatedAt: ISO,
    })
    const v2 = migrateV1ToV2(v1Parsed)
    expect(BuildFitStoreSchema.safeParse(v2).success).toBe(true)
  })
})
