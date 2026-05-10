import { describe, it, expect, beforeEach } from 'vitest'
import {
  exportStore,
  exportSession,
  serializeProjectFile,
  exportFilename,
  importProjectFile,
  PROJECT_FILE_DISCLAIMER,
  PROJECT_FILE_APP_VERSION,
  ProjectFileSchema,
} from './project-file'
import {
  BUILD_FIT_STORAGE_KEY,
  upsertFootprint,
  upsertSession,
  getFootprints,
  getSessions,
  clearAll,
  __testing,
} from './storage'
import type { FootprintProject, FitSession } from './schemas'

const ISO = '2026-05-10T12:00:00.000Z'

const fp = (overrides: Partial<FootprintProject> = {}): FootprintProject => ({
  id: 'fp-test-001',
  name: '40x60 export shop',
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
  ...overrides,
})

const session = (overrides: Partial<FitSession> = {}): FitSession => ({
  id: 'sess-test-001',
  parcelKey: '090046M H 01300',
  parcelSnapshot: {
    parcelKey: '090046M H 01300',
    ownerName: 'SMITH JOHN',
    address: '112 FOXHALL CIR',
    county: 'Sullivan',
    acres: 1.5,
    zoning: 'R1',
    appraisalDollars: 250000,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[-82.35, 36.31], [-82.34, 36.31], [-82.34, 36.32], [-82.35, 36.32], [-82.35, 36.31]],
      ],
    },
    capturedAt: ISO,
  },
  footprintProjectId: 'fp-test-001',
  placement: {
    center: { lng: -82.345, lat: 36.315 },
    rotationDeg: 0,
    widthFt: 40,
    lengthFt: 60,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[-82.345, 36.315], [-82.346, 36.315], [-82.346, 36.316], [-82.345, 36.316], [-82.345, 36.315]],
      ],
    },
  },
  setbackConfig: { mode: 'none' },
  envelope: { mode: 'none', geometry: null, warnings: [] },
  result: {
    status: 'fits',
    fitsParcel: true,
    fitsEnvelope: null,
    footprintSqft: 2400,
    parcelSqft: 65340,
    coveragePct: 3.7,
    closestBoundaryFt: 18,
    measurementMethod: 'geodesic',
    conflicts: [],
    warnings: [],
    computedAt: ISO,
  },
  createdAt: ISO,
  updatedAt: ISO,
  ...overrides,
})

beforeEach(() => {
  window.localStorage.clear()
  __testing.resetCache()
})

// ── exportStore ────────────────────────────────────────────────────────

describe('exportStore', () => {
  it('returns the envelope shape with app metadata, disclaimer, and current data', () => {
    upsertFootprint(fp())
    const file = exportStore()
    expect(file.schemaVersion).toBe(1)
    expect(file.app.name).toBe('Holston Scout')
    expect(file.app.version).toBe(PROJECT_FILE_APP_VERSION)
    expect(file.disclaimer).toBe(PROJECT_FILE_DISCLAIMER)
    expect(typeof file.generatedAt).toBe('string')
    expect(file.data.footprints).toHaveLength(1)
    expect(file.data.footprints[0]?.id).toBe('fp-test-001')
  })

  it('exports an empty store cleanly', () => {
    const file = exportStore()
    expect(file.data.footprints).toEqual([])
    expect(file.data.sessions).toEqual([])
    expect(ProjectFileSchema.safeParse(file).success).toBe(true)
  })

  it('validates against the project-file schema', () => {
    upsertFootprint(fp())
    upsertSession(session())
    const file = exportStore()
    expect(ProjectFileSchema.safeParse(file).success).toBe(true)
  })
})

// ── exportSession ──────────────────────────────────────────────────────

describe('exportSession', () => {
  it('returns the session + its referenced footprint', () => {
    upsertFootprint(fp({ id: 'fp-A' }))
    upsertFootprint(fp({ id: 'fp-B' }))
    upsertSession(session({ id: 'sess-1', footprintProjectId: 'fp-A' }))
    upsertSession(session({ id: 'sess-2', footprintProjectId: 'fp-B' }))

    const file = exportSession('sess-1')
    expect(file).not.toBeNull()
    expect(file!.data.sessions).toHaveLength(1)
    expect(file!.data.sessions[0]?.id).toBe('sess-1')
    expect(file!.data.footprints).toHaveLength(1)
    expect(file!.data.footprints[0]?.id).toBe('fp-A')
  })

  it('returns null when the session id is missing', () => {
    expect(exportSession('does-not-exist')).toBeNull()
  })

  it('returns null when the session is an orphan (footprint gone)', () => {
    upsertSession(session({ id: 'sess-orphan', footprintProjectId: 'missing-fp' }))
    expect(exportSession('sess-orphan')).toBeNull()
  })
})

// ── serializeProjectFile + exportFilename ──────────────────────────────

describe('serializeProjectFile', () => {
  it('produces parseable JSON', () => {
    const file = exportStore()
    const text = serializeProjectFile(file)
    expect(typeof text).toBe('string')
    expect(() => JSON.parse(text)).not.toThrow()
  })

  it('is indented for human readability', () => {
    const text = serializeProjectFile(exportStore())
    expect(text).toContain('\n  ')
  })
})

describe('exportFilename', () => {
  it('uses .hscout.json extension', () => {
    expect(exportFilename({ kind: 'store' })).toMatch(/\.hscout\.json$/)
  })

  it('uses a current date', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(exportFilename({ kind: 'store' })).toContain(today)
  })

  it('embeds a sanitized parcel key for sessions', () => {
    const fn = exportFilename({ kind: 'session', parcelKey: '090046M H 01300' })
    // spaces and other unsafe chars become hyphens.
    expect(fn).not.toContain(' ')
    expect(fn).toContain('090046M-H-01300')
  })

  it('falls back to store-shape filename when parcel key is missing', () => {
    expect(exportFilename({ kind: 'session' })).toContain('store')
  })
})

// ── importProjectFile ──────────────────────────────────────────────────

describe('importProjectFile', () => {
  it('round-trips an exported store through import', () => {
    upsertFootprint(fp({ id: 'fp-round-A', name: 'Round-trip A' }))
    upsertSession(session({ id: 'sess-round-1', footprintProjectId: 'fp-round-A' }))
    const text = serializeProjectFile(exportStore())

    clearAll()
    __testing.resetCache()
    expect(getFootprints()).toEqual([])

    const result = importProjectFile(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.footprints).toBe(1)
      expect(result.summary.sessions).toBe(1)
    }
    expect(getFootprints().map((f) => f.id)).toEqual(['fp-round-A'])
    expect(getSessions().map((s) => s.id)).toEqual(['sess-round-1'])
  })

  it('is idempotent — importing twice does not duplicate', () => {
    upsertFootprint(fp({ id: 'fp-idem' }))
    const text = serializeProjectFile(exportStore())
    clearAll()
    __testing.resetCache()
    importProjectFile(text)
    importProjectFile(text)
    expect(getFootprints()).toHaveLength(1)
  })

  it('upserts by id, replacing existing items', () => {
    upsertFootprint(fp({ id: 'fp-replace', name: 'Original' }))
    const original = serializeProjectFile(exportStore())
    // Mutate locally to a different name, then re-import the original.
    upsertFootprint(fp({ id: 'fp-replace', name: 'Mutated' }))
    expect(getFootprints()[0]?.name).toBe('Mutated')

    const result = importProjectFile(original)
    expect(result.ok).toBe(true)
    expect(getFootprints()[0]?.name).toBe('Original')
  })

  it('rejects malformed JSON without touching the store', () => {
    upsertFootprint(fp({ id: 'fp-keep' }))
    const before = getFootprints()
    const result = importProjectFile('{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/i)
    expect(getFootprints()).toEqual(before)
  })

  it('rejects wrong schemaVersion', () => {
    const text = JSON.stringify({
      schemaVersion: 2,
      app: { name: 'Holston Scout', version: '1.0.0', url: 'https://example.com' },
      generatedAt: ISO,
      disclaimer: 'x',
      data: { schemaVersion: 1, footprints: [], sessions: [], updatedAt: ISO },
    })
    const result = importProjectFile(text)
    expect(result.ok).toBe(false)
  })

  it('rejects payload missing the envelope', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      footprints: [],
      sessions: [],
      updatedAt: ISO,
    })
    const result = importProjectFile(text)
    expect(result.ok).toBe(false)
  })

  it('rejects an orphan session (footprintProjectId not in payload or store)', () => {
    const orphan = serializeProjectFile({
      schemaVersion: 1,
      app: { name: 'Holston Scout', version: '1.0.0', url: 'https://example.com' },
      generatedAt: ISO,
      disclaimer: 'x',
      data: {
        schemaVersion: 1,
        footprints: [], // empty
        sessions: [session({ footprintProjectId: 'missing-fp' })],
        updatedAt: ISO,
      },
    } as never)
    const result = importProjectFile(orphan)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/references missing footprint/i)
    expect(getSessions()).toEqual([])
  })

  it('accepts a session whose footprint already lives in the receiving store', () => {
    // Receiving store has fp-existing; imported file ships only a session
    // pointing at it. Should succeed.
    upsertFootprint(fp({ id: 'fp-existing' }))
    const text = serializeProjectFile({
      schemaVersion: 1,
      app: { name: 'Holston Scout', version: '1.0.0', url: 'https://example.com' },
      generatedAt: ISO,
      disclaimer: 'x',
      data: {
        schemaVersion: 1,
        footprints: [],
        sessions: [session({ id: 'sess-cross-ref', footprintProjectId: 'fp-existing' })],
        updatedAt: ISO,
      },
    } as never)
    const result = importProjectFile(text)
    expect(result.ok).toBe(true)
    expect(getSessions().map((s) => s.id)).toEqual(['sess-cross-ref'])
  })

  it('rejects a payload with an invalid footprint without writing anything', () => {
    const bad = serializeProjectFile({
      schemaVersion: 1,
      app: { name: 'Holston Scout', version: '1.0.0', url: 'https://example.com' },
      generatedAt: ISO,
      disclaimer: 'x',
      data: {
        schemaVersion: 1,
        // empty-name footprint, FootprintProjectSchema requires min(1).
        footprints: [{ ...fp(), name: '' }],
        sessions: [],
        updatedAt: ISO,
      } as never,
    } as never)
    upsertFootprint(fp({ id: 'fp-preserved', name: 'Keep me' }))
    const before = getFootprints().length
    const result = importProjectFile(bad)
    expect(result.ok).toBe(false)
    expect(getFootprints()).toHaveLength(before)
  })
})

// ── Storage key untouched on read ──────────────────────────────────────

describe('storage isolation', () => {
  it('only writes through the canonical storage key', () => {
    const text = serializeProjectFile(exportStore())
    importProjectFile(text)
    const keys = Object.keys(window.localStorage).sort()
    // Empty store import doesn't necessarily write, but no foreign keys
    // should appear.
    for (const k of keys) {
      expect(k.startsWith('holston-scout/')).toBe(true)
    }
    // BUILD_FIT_STORAGE_KEY is the only fit-specific key.
    expect(BUILD_FIT_STORAGE_KEY).toBe('holston-scout/build-fit/v1')
  })
})
