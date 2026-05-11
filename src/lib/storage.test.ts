import { describe, it, expect, beforeEach } from 'vitest'
import {
  getSaved,
  isSaved,
  toggleSaved,
  getRecents,
  pushRecent,
  clearRecents,
  STORAGE_KEY,
} from './storage'

// The storage layer is independent of the build-fit storage (different
// key, different event name, different schema). Tests live alongside
// the module and exercise the same edge cases the build-fit tests cover
// for the build-fit store.

beforeEach(() => {
  window.localStorage.clear()
})

describe('storage: empty start', () => {
  it('returns empty arrays when nothing has been saved', () => {
    expect(getSaved()).toEqual([])
    expect(getRecents()).toEqual([])
  })

  it('falls back to empty when localStorage holds malformed JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-valid-json')
    expect(getSaved()).toEqual([])
    expect(getRecents()).toEqual([])
  })

  it('falls back to empty when schemaVersion mismatches', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 999, savedParcels: [], recentParcels: [] }),
    )
    expect(getSaved()).toEqual([])
    expect(getRecents()).toEqual([])
  })

  it('repairs malformed savedParcels / recentParcels fields', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        savedParcels: 'not an array',
        recentParcels: 42,
      }),
    )
    expect(getSaved()).toEqual([])
    expect(getRecents()).toEqual([])
  })
})

describe('storage: saved parcels', () => {
  it('toggleSaved adds a parcel and reports true', () => {
    const result = toggleSaved('090046M H 01300')
    expect(result).toBe(true)
    expect(isSaved('090046M H 01300')).toBe(true)
    expect(getSaved()).toHaveLength(1)
    expect(getSaved()[0]?.gislink).toBe('090046M H 01300')
  })

  it('toggleSaved removes an already-saved parcel and reports false', () => {
    toggleSaved('A')
    const result = toggleSaved('A')
    expect(result).toBe(false)
    expect(isSaved('A')).toBe(false)
    expect(getSaved()).toEqual([])
  })

  it('captures an optional note on save', () => {
    toggleSaved('A', 'flood zone candidate')
    expect(getSaved()[0]?.note).toBe('flood zone candidate')
  })

  it('isSaved returns false for unknown parcels', () => {
    expect(isSaved('never-saved')).toBe(false)
  })

  it('preserves savedAt ISO timestamp', () => {
    toggleSaved('A')
    const ts = getSaved()[0]?.savedAt
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Number.isNaN(new Date(ts!).getTime())).toBe(false)
  })
})

describe('storage: recent parcels', () => {
  it('pushRecent adds a parcel to the front', () => {
    pushRecent('A')
    pushRecent('B')
    expect(getRecents().map((r) => r.gislink)).toEqual(['B', 'A'])
  })

  it('pushRecent dedupes by gislink and moves to front', () => {
    pushRecent('A')
    pushRecent('B')
    pushRecent('A')
    expect(getRecents().map((r) => r.gislink)).toEqual(['A', 'B'])
  })

  it('caps at 15 entries (RECENTS_CAP)', () => {
    for (let i = 0; i < 20; i++) pushRecent(`P${i}`)
    expect(getRecents()).toHaveLength(15)
    expect(getRecents()[0]?.gislink).toBe('P19')
    expect(getRecents()[14]?.gislink).toBe('P5')
  })

  it('captures optional owner + address metadata', () => {
    pushRecent('A', { owner: 'SMITH JOHN', address: '112 FOXHALL CIR' })
    expect(getRecents()[0]?.owner).toBe('SMITH JOHN')
    expect(getRecents()[0]?.address).toBe('112 FOXHALL CIR')
  })

  it('null metadata stores undefined (not null) for forward-compat', () => {
    pushRecent('A', { owner: null, address: null })
    expect(getRecents()[0]?.owner).toBeUndefined()
    expect(getRecents()[0]?.address).toBeUndefined()
  })

  it('clearRecents wipes the recent list but preserves saved parcels', () => {
    toggleSaved('saved-A')
    pushRecent('recent-A')
    pushRecent('recent-B')
    clearRecents()
    expect(getRecents()).toEqual([])
    expect(isSaved('saved-A')).toBe(true)
  })
})
