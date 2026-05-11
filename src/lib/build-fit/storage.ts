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
// this payload is the migrate input, POST the whole BuildFitStore to the
// server on first authenticated write. Don't change field shapes without
// bumping schemaVersion and adding a migrate() branch.

import { useSyncExternalStore } from 'react'
import {
  BuildFitStoreSchema,
  BuildFitStoreSchemaV1,
  FootprintProjectSchema,
  FitSessionSchema,
  migrateV1ToV2,
  type BuildFitStore,
  type FootprintProject,
  type FitSession,
} from './schemas'

const STORAGE_KEY = 'holston-scout/build-fit/v1'
const EVENT_NAME = 'holston-scout:build-fit-storage'

/**
 * Result type for every storage write API in this module.
 *
 * - `{ ok: true, store }` carries the new store snapshot the write
 *   produced. Callers that need to operate on the post-write state
 *   (e.g. select-newly-created-item) read it here.
 * - `{ ok: false, reason: 'validation' }` means the payload failed
 *   `safeParse`. The caller passed something that won't load back from
 *   localStorage. UI should surface this as a programming error.
 * - `{ ok: false, reason: 'storage' }` means localStorage rejected the
 *   write (quota / private-mode / serialization). UI should surface
 *   this with a "free up site storage" notice and not pretend the
 *   write succeeded.
 */
export type StorageWriteResult =
  | { ok: true; store: BuildFitStore }
  | { ok: false; reason: 'validation' | 'storage' }

function emptyStore(): BuildFitStore {
  return {
    schemaVersion: 2,
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
    // Try v2 first (the current shape).
    const v2 = BuildFitStoreSchema.safeParse(parsed)
    if (v2.success) return v2.data
    // Fall back to v1 -> v2 migrate. A successful v1 parse + migrate is the
    // path for users whose stores were last written by a Phase 5 build.
    // After this read, the next write rewrites v2 to disk; v1 is no longer
    // persisted.
    const v1 = BuildFitStoreSchemaV1.safeParse(parsed)
    if (v1.success) return migrateV1ToV2(v1.data)
    // Anything else (corrupt JSON parse, neither version matches) is the
    // empty store. This is the same behavior as pre-Phase-6 and protects
    // the UI from one bad write taking down the whole workspace.
    return emptyStore()
  } catch {
    // Quota exceeded, JSON malformed, private mode, etc. Treat as empty.
    return emptyStore()
  }
}

/** Returns false when the write was rejected (quota / private-mode /
 *  serialization failure). Callers should treat false as a hard failure
 *  and surface it to the user instead of silently dropping. */
function writeRaw(store: BuildFitStore): boolean {
  if (typeof window === 'undefined') return false
  try {
    const next: BuildFitStore = { ...store, updatedAt: new Date().toISOString() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    // Same-tab notification, the native 'storage' event only fires on
    // OTHER tabs by spec, so subscribers in the writing tab need this.
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
    return true
  } catch {
    // Quota exceeded, private-mode block, serialization edge case, etc.
    return false
  }
}

// ── footprints ─────────────────────────────────────────────────────────────

export function getFootprints(): FootprintProject[] {
  return readRaw().footprints
}

/**
 * Insert or update a footprint project. Match by `id`. Returns a structured
 * failure instead of throwing so callers can surface validation/storage
 * failures without taking down the workspace.
 */
export function upsertFootprint(footprint: FootprintProject): StorageWriteResult {
  const parsed = FootprintProjectSchema.safeParse(footprint)
  if (!parsed.success) return { ok: false, reason: 'validation' }
  const store = readRaw()
  const existing = store.footprints.findIndex((f) => f.id === parsed.data.id)
  if (existing >= 0) {
    store.footprints[existing] = parsed.data
  } else {
    store.footprints.unshift(parsed.data)
  }
  if (!writeRaw(store)) return { ok: false, reason: 'storage' }
  return { ok: true, store }
}

export function removeFootprint(id: string): StorageWriteResult {
  const store = readRaw()
  store.footprints = store.footprints.filter((f) => f.id !== id)
  // Cascade, sessions referencing this footprint are now orphans.
  store.sessions = store.sessions.filter((s) => s.footprintProjectId !== id)
  if (!writeRaw(store)) return { ok: false, reason: 'storage' }
  return { ok: true, store }
}

// ── fit sessions ───────────────────────────────────────────────────────────

export function getSessions(): FitSession[] {
  return readRaw().sessions
}

export function upsertSession(session: FitSession): StorageWriteResult {
  const parsed = FitSessionSchema.safeParse(session)
  if (!parsed.success) return { ok: false, reason: 'validation' }
  const store = readRaw()
  const existing = store.sessions.findIndex((s) => s.id === parsed.data.id)
  if (existing >= 0) {
    store.sessions[existing] = parsed.data
  } else {
    store.sessions.unshift(parsed.data)
  }
  if (!writeRaw(store)) return { ok: false, reason: 'storage' }
  return { ok: true, store }
}

export function removeSession(id: string): StorageWriteResult {
  const store = readRaw()
  store.sessions = store.sessions.filter((s) => s.id !== id)
  if (!writeRaw(store)) return { ok: false, reason: 'storage' }
  return { ok: true, store }
}

export function clearAll(): StorageWriteResult {
  const store = emptyStore()
  if (!writeRaw(store)) return { ok: false, reason: 'storage' }
  return { ok: true, store }
}

export function replaceStore(store: BuildFitStore): StorageWriteResult {
  const parsed = BuildFitStoreSchema.safeParse(store)
  if (!parsed.success) return { ok: false, reason: 'validation' }
  if (!writeRaw(parsed.data)) return { ok: false, reason: 'storage' }
  return { ok: true, store: parsed.data }
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
