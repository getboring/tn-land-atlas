import { describe, it, expect, beforeEach } from 'vitest'
import {
  BUILD_FIT_STORAGE_KEY,
  BUILD_FIT_EVENT_NAME,
  getFootprints,
  getSessions,
  upsertFootprint,
  removeFootprint,
  upsertSession,
  removeSession,
  clearAll,
  __testing,
} from './storage'
import type { FootprintProject, FitSession } from './schemas'

const ISO = '2026-05-10T12:00:00.000Z'

const fp = (overrides: Partial<FootprintProject> = {}): FootprintProject => ({
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
  ...overrides,
})

const minimalSession = (overrides: Partial<FitSession> = {}): FitSession => ({
  id: 'sess-001',
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
  footprintProjectId: 'fp-001',
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

function withStorageWriteBlocked(run: () => void): void {
  // Force Storage.prototype.setItem to throw (mimics quota / private-mode).
  // Patching window.localStorage.setItem directly doesn't take in jsdom
  // because the localStorage instance lookup may bypass the per-instance
  // method; the prototype is the reliable seam.
  const proto = Object.getPrototypeOf(window.localStorage) as Storage
  const original = proto.setItem
  proto.setItem = () => {
    throw new Error('QuotaExceededError')
  }
  try {
    run()
  } finally {
    proto.setItem = original
    __testing.resetCache()
  }
}

describe('storage: empty start', () => {
  it('returns empty arrays when nothing has been saved', () => {
    expect(getFootprints()).toEqual([])
    expect(getSessions()).toEqual([])
  })

  it('falls back to empty when localStorage holds malformed JSON', () => {
    window.localStorage.setItem(BUILD_FIT_STORAGE_KEY, '{not-valid-json')
    expect(getFootprints()).toEqual([])
  })

  it('falls back to empty when schemaVersion mismatches', () => {
    window.localStorage.setItem(
      BUILD_FIT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 999, footprints: [], sessions: [], updatedAt: ISO }),
    )
    expect(getFootprints()).toEqual([])
    expect(getSessions()).toEqual([])
  })

  it('falls back to empty when payload fails schema (e.g. corrupt footprint)', () => {
    window.localStorage.setItem(
      BUILD_FIT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        footprints: [{ id: 'no-name', kind: 'rectangle' /* missing required fields */ }],
        sessions: [],
        updatedAt: ISO,
      }),
    )
    expect(getFootprints()).toEqual([])
  })
})

describe('storage: footprints round-trip', () => {
  it('upserts and reads back a footprint', () => {
    upsertFootprint(fp())
    expect(getFootprints()).toHaveLength(1)
    expect(getFootprints()[0]?.name).toBe('40x60 shop')
  })

  it('returns ok:true with the new store on a successful write', () => {
    const r = upsertFootprint(fp())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.store.footprints).toHaveLength(1)
  })

  it('returns ok:false reason:storage when the localStorage write fails', () => {
    withStorageWriteBlocked(() => {
      const r = upsertFootprint(fp({ id: 'fp-quota-blocked' }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('storage')
    })
  })

  it('updates by id without duplicating', () => {
    upsertFootprint(fp({ id: 'fp-A', name: 'Original' }))
    upsertFootprint(fp({ id: 'fp-A', name: 'Renamed' }))
    const all = getFootprints()
    expect(all).toHaveLength(1)
    expect(all[0]?.name).toBe('Renamed')
  })

  it('inserts new footprints to the front (most-recent-first)', () => {
    upsertFootprint(fp({ id: 'fp-A', name: 'A' }))
    upsertFootprint(fp({ id: 'fp-B', name: 'B' }))
    expect(getFootprints().map((f) => f.id)).toEqual(['fp-B', 'fp-A'])
  })

  it('removes a footprint by id', () => {
    upsertFootprint(fp({ id: 'fp-A' }))
    upsertFootprint(fp({ id: 'fp-B' }))
    removeFootprint('fp-A')
    expect(getFootprints().map((f) => f.id)).toEqual(['fp-B'])
  })

  it('cascades removal to sessions referencing the deleted footprint', () => {
    upsertFootprint(fp({ id: 'fp-A' }))
    upsertSession(minimalSession({ id: 's1', footprintProjectId: 'fp-A' }))
    upsertSession(minimalSession({ id: 's2', footprintProjectId: 'fp-other' }))
    removeFootprint('fp-A')
    expect(getSessions().map((s) => s.id)).toEqual(['s2'])
  })

  it('returns ok:false and preserves data when footprint delete write fails', () => {
    upsertFootprint(fp({ id: 'fp-A' }))
    upsertFootprint(fp({ id: 'fp-B' }))
    withStorageWriteBlocked(() => {
      const r = removeFootprint('fp-A')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('storage')
    })
    expect(getFootprints().map((f) => f.id)).toEqual(['fp-B', 'fp-A'])
  })
})

describe('storage: sessions round-trip', () => {
  it('upserts and reads back a session', () => {
    upsertSession(minimalSession())
    expect(getSessions()).toHaveLength(1)
  })

  it('updates by id without duplicating', () => {
    upsertSession(minimalSession({ id: 's-A' }))
    upsertSession(minimalSession({ id: 's-A', parcelKey: 'OTHER' }))
    const all = getSessions()
    expect(all).toHaveLength(1)
    expect(all[0]?.parcelKey).toBe('OTHER')
  })

  it('removes a session by id', () => {
    upsertSession(minimalSession({ id: 's-A' }))
    upsertSession(minimalSession({ id: 's-B' }))
    removeSession('s-A')
    expect(getSessions().map((s) => s.id)).toEqual(['s-B'])
  })

  it('returns ok:false and preserves data when session delete write fails', () => {
    upsertSession(minimalSession({ id: 's-A' }))
    upsertSession(minimalSession({ id: 's-B' }))
    withStorageWriteBlocked(() => {
      const r = removeSession('s-A')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('storage')
    })
    expect(getSessions().map((s) => s.id)).toEqual(['s-B', 's-A'])
  })
})

describe('storage: MultiPolygon round-trip', () => {
  it('survives writing and reading a session whose parcel is a MultiPolygon', () => {
    const multiSnapshot = minimalSession({
      id: 'sess-multi',
      parcelSnapshot: {
        ...minimalSession().parcelSnapshot,
        geometry: {
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
        },
      },
    })
    upsertSession(multiSnapshot)
    const round = getSessions()[0]
    expect(round?.parcelSnapshot.geometry.type).toBe('MultiPolygon')
    if (round?.parcelSnapshot.geometry.type === 'MultiPolygon') {
      expect(round.parcelSnapshot.geometry.coordinates).toHaveLength(2)
    }
  })
})

describe('storage: events', () => {
  it('dispatches a same-tab custom event on write', () => {
    let count = 0
    const handler = () => {
      count += 1
    }
    window.addEventListener(BUILD_FIT_EVENT_NAME, handler)
    upsertFootprint(fp())
    upsertFootprint(fp({ id: 'fp-2' }))
    removeFootprint('fp-2')
    window.removeEventListener(BUILD_FIT_EVENT_NAME, handler)
    expect(count).toBe(3)
  })
})

describe('storage: write validation', () => {
  it('rejects an upsertFootprint payload that fails the schema', () => {
    // Empty name violates FootprintProjectSchema's z.string().min(1).
    const r = upsertFootprint(fp({ name: '' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('validation')
    expect(getFootprints()).toEqual([])
  })

  it('rejects an upsertSession payload missing required fields', () => {
    const bad = minimalSession({ parcelKey: '' })
    const r = upsertSession(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('validation')
    expect(getSessions()).toEqual([])
  })

  it('persists and round-trips rotationDeg', () => {
    upsertFootprint(fp({ id: 'rot-1', rotationDeg: 37 }))
    const round = getFootprints()[0]
    expect(round?.rotationDeg).toBe(37)
  })

  it('defaults rotationDeg to 0 for v1 payloads written before rotationDeg existed', () => {
    // Simulate an older payload that pre-dates the rotationDeg field.
    const legacy = {
      schemaVersion: 1,
      footprints: [
        {
          id: 'legacy-1',
          name: 'pre-rotation footprint',
          kind: 'rectangle',
          widthFt: 40,
          lengthFt: 60,
          stories: 1,
          footprintSqft: 2400,
          geometry: null,
          createdFrom: 'typed-dimensions',
          notes: null,
          createdAt: ISO,
          updatedAt: ISO,
          // rotationDeg deliberately absent
        },
      ],
      sessions: [],
      updatedAt: ISO,
    }
    window.localStorage.setItem(BUILD_FIT_STORAGE_KEY, JSON.stringify(legacy))
    __testing.resetCache()
    const round = getFootprints()[0]
    expect(round?.rotationDeg).toBe(0)
  })
})

describe('storage: clearAll', () => {
  it('wipes everything', () => {
    upsertFootprint(fp())
    upsertSession(minimalSession())
    clearAll()
    expect(getFootprints()).toEqual([])
    expect(getSessions()).toEqual([])
  })

  it('returns ok:false and preserves data when clear write fails', () => {
    upsertFootprint(fp())
    upsertSession(minimalSession())
    withStorageWriteBlocked(() => {
      const r = clearAll()
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('storage')
    })
    expect(getFootprints()).toHaveLength(1)
    expect(getSessions()).toHaveLength(1)
  })
})

// ── Phase 6: v1 -> v2 read-time migration ──────────────────────────────────

describe('storage: v1 -> v2 read-time migrate', () => {
  it('reads a v1 store written before Phase 6 and surfaces it as v2', () => {
    // A Phase 5 user has a v1 payload sitting in localStorage. Phase 6
    // code opens the browser; readRaw should detect v1, migrate up, and
    // hand callers a v2 store with imported FitWarnings.
    const v1Session = {
      id: 'sess-legacy',
      parcelKey: '090046M H 01300',
      parcelSnapshot: {
        parcelKey: '090046M H 01300',
        ownerName: 'SMITH JOHN',
        address: '112 FOXHALL CIR',
        county: 'Sullivan',
        acres: 1.5,
        zoning: null,
        appraisalDollars: 250000,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[-82.35, 36.31], [-82.34, 36.31], [-82.34, 36.32], [-82.35, 36.32], [-82.35, 36.31]],
          ],
        },
        capturedAt: ISO,
      },
      footprintProjectId: 'fp-legacy',
      placement: {
        center: { lng: -82.345, lat: 36.315 },
        rotationDeg: 0,
        widthFt: 40,
        lengthFt: 60,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[-82.346, 36.314], [-82.345, 36.314], [-82.345, 36.315], [-82.346, 36.315], [-82.346, 36.314]],
          ],
        },
      },
      setbackConfig: { mode: 'none' },
      envelope: {
        mode: 'none',
        geometry: null,
        warnings: ['Legacy envelope warning'],
      },
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
        warnings: ['Legacy result warning'],
        computedAt: ISO,
      },
      createdAt: ISO,
      updatedAt: ISO,
    }
    window.localStorage.setItem(
      BUILD_FIT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        footprints: [fp({ id: 'fp-legacy' })],
        sessions: [v1Session],
        updatedAt: ISO,
      }),
    )
    __testing.resetCache()

    const sessions = getSessions()
    expect(sessions).toHaveLength(1)
    const s = sessions[0]
    expect(s).toBeDefined()
    if (!s) return
    expect(s.envelope.warnings[0]).toEqual({
      severity: 'warning',
      source: 'imported',
      code: 'legacy-string',
      message: 'Legacy envelope warning',
    })
    expect(s.result.warnings[0]?.code).toBe('legacy-string')
  })
})
