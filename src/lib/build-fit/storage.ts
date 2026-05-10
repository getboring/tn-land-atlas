// Build-fit localStorage layer.
//
// Mirrors the pattern in src/lib/storage.ts (saved + recent parcels) but
// keyed and event-named separately so subscribers can react to fit-state
// changes without redrawing the saved/recent UI:
//
//   STORAGE_KEY    'holston-scout/build-fit/v1'
//   EVENT_NAME     'holston-scout:build-fit-storage'
//
// Read path validates the entire payload against BuildFitStoreSchema. A
// malformed/corrupt/version-drifted payload returns the empty store, which
// matches the parcel-storage behavior and prevents one bad write from
// taking the app down.
//
// Forward-compatibility contract: when account-backed persistence lands,
// this payload is the migrate input — POST the whole BuildFitStore to the
// server on first authenticated write. Don't change field shapes without
// bumping schemaVersion and adding a migrate() branch.

import { useSyncExternalStore } from 'react'
import {
  BuildFitStoreSchema,
  type BuildFitStore,
  type FootprintProject,
  type FitSession,
} from './schemas'

const STORAGE_KEY = 'holston-scout/build-fit/v1'
const EVENT_NAME = 'holston-scout:build-fit-storage'

function emptyStore(): BuildFitStore {
  return {
    schemaVersion: 1,
    footprints: [],
    sessions: [],
    updatedAt: new Date(0).toISOString(),
  }
}

// ── read / write ───────────────────────────────────────────────────────────

function readRaw(): BuildFitStore {
  if (typeof window === 'undefined') return emptyStore()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed: unknown = JSON.parse(raw)
    const result = BuildFitStoreSchema.safeParse(parsed)
    if (!result.success) return emptyStore()
    return result.data
  } catch {
    // Quota exceeded, JSON malformed, private mode, etc. Treat as empty.
    return emptyStore()
  }
}

function writeRaw(store: BuildFitStore): void {
  if (typeof window === 'undefined') return
  try {
    const next: BuildFitStore = { ...store, updatedAt: new Date().toISOString() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    // Same-tab notification — the native 'storage' event only fires on
    // OTHER tabs by spec, so subscribers in the writing tab need this.
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
  } catch {
    // Not authoritative storage — D1 or equivalent will be eventually.
  }
}

// ── footprints ─────────────────────────────────────────────────────────────

export function getFootprints(): FootprintProject[] {
  return readRaw().footprints
}

/**
 * Insert or update a footprint project. Match by `id`. Returns the new
 * full store snapshot for callers that need it (most don't — subscribe
 * via useFootprints instead).
 */
export function upsertFootprint(footprint: FootprintProject): BuildFitStore {
  const store = readRaw()
  const existing = store.footprints.findIndex((f) => f.id === footprint.id)
  if (existing >= 0) {
    store.footprints[existing] = footprint
  } else {
    store.footprints.unshift(footprint)
  }
  writeRaw(store)
  return store
}

export function removeFootprint(id: string): void {
  const store = readRaw()
  store.footprints = store.footprints.filter((f) => f.id !== id)
  // Cascade — sessions referencing this footprint are now orphans.
  store.sessions = store.sessions.filter((s) => s.footprintProjectId !== id)
  writeRaw(store)
}

// ── fit sessions ───────────────────────────────────────────────────────────

export function getSessions(): FitSession[] {
  return readRaw().sessions
}

export function upsertSession(session: FitSession): BuildFitStore {
  const store = readRaw()
  const existing = store.sessions.findIndex((s) => s.id === session.id)
  if (existing >= 0) {
    store.sessions[existing] = session
  } else {
    store.sessions.unshift(session)
  }
  writeRaw(store)
  return store
}

export function removeSession(id: string): void {
  const store = readRaw()
  store.sessions = store.sessions.filter((s) => s.id !== id)
  writeRaw(store)
}

export function clearAll(): void {
  writeRaw(emptyStore())
}

// ── subscription + React hooks ─────────────────────────────────────────────
// Cached snapshot. Refreshed only on storage events so useSyncExternalStore
// sees stable references between writes (mirrors src/lib/storage.ts).

let cachedSnapshot: BuildFitStore = readRaw()

function refreshSnapshot(): void {
  cachedSnapshot = readRaw()
}

export function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => {
    refreshSnapshot()
    cb()
  }
  window.addEventListener('storage', handler)
  window.addEventListener(EVENT_NAME, handler)
  return () => {
    window.removeEventListener('storage', handler)
    window.removeEventListener(EVENT_NAME, handler)
  }
}

const SSR_FALLBACK: BuildFitStore = emptyStore()

function getSnapshot(): BuildFitStore {
  return cachedSnapshot
}

function getServerSnapshot(): BuildFitStore {
  return SSR_FALLBACK
}

export function useBuildFitStore(): BuildFitStore {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useFootprints(): FootprintProject[] {
  return useBuildFitStore().footprints
}

export function useSessions(): FitSession[] {
  return useBuildFitStore().sessions
}

// ── test seam ──────────────────────────────────────────────────────────────
// Tests need a way to nuke the cache between cases without exporting the
// internal mutable. This is the only path that touches `cachedSnapshot`
// outside the live event system.
export const __testing = {
  resetCache(): void {
    cachedSnapshot = readRaw()
  },
}

export { STORAGE_KEY as BUILD_FIT_STORAGE_KEY, EVENT_NAME as BUILD_FIT_EVENT_NAME }
