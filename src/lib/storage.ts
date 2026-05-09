// localStorage layer for Holston Scout.
//
// Forward-compatibility contract:
//   When auth lands (Phase 1 of the retention plan), the user's first login
//   will POST this entire payload to `/api/auth/migrate` so their pre-auth
//   history transfers to D1. Don't change the field shapes without bumping
//   `schemaVersion` and writing a migrate() branch.
//
//   Field names mirror the eventual D1 schema 1:1:
//     saved_parcels(user_id, gislink, saved_at, note, tags[])
//     recent_views(user_id, gislink, viewed_at)
//
// Privacy: all data stays in the user's browser until they explicitly sign
// in. Don't add anything here that wouldn't be okay to leave in localStorage
// on a shared machine.

const STORAGE_KEY = 'holston-scout/v1'
const RECENTS_CAP = 15

export interface SavedParcel {
  gislink: string
  /** ISO timestamp. */
  savedAt: string
  /** Free-text user note. Tags + project_id come in Phase 1. */
  note: string | null
  tags: string[]
}

export interface RecentParcel {
  gislink: string
  /** ISO timestamp. */
  viewedAt: string
  /** Owner name. Optional so older v1 entries (without it) still parse. */
  owner?: string
  /** Street address. */
  address?: string
}

interface StorageV1 {
  schemaVersion: 1
  savedParcels: SavedParcel[]
  /** FIFO ordered, most-recent-first. Capped at RECENTS_CAP. */
  recentParcels: RecentParcel[]
}

function emptyStorage(): StorageV1 {
  return { schemaVersion: 1, savedParcels: [], recentParcels: [] }
}

// --- read / write -----------------------------------------------------------

function readRaw(): StorageV1 {
  if (typeof window === 'undefined') return emptyStorage()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStorage()
    const parsed = JSON.parse(raw) as Partial<StorageV1>
    if (parsed?.schemaVersion !== 1) return emptyStorage()
    return {
      schemaVersion: 1,
      savedParcels: Array.isArray(parsed.savedParcels) ? parsed.savedParcels : [],
      recentParcels: Array.isArray(parsed.recentParcels) ? parsed.recentParcels : [],
    }
  } catch {
    // Quota exceeded, JSON malformed, private mode, etc. Treat as empty.
    return emptyStorage()
  }
}

function writeRaw(s: StorageV1): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    // Dispatch a same-tab event so React subscribers re-read. The native
    // 'storage' event only fires across tabs, not within the writing tab.
    window.dispatchEvent(new CustomEvent('holston-scout:storage'))
  } catch {
    // Ignore — we're not authoritative storage; D1 is, eventually.
  }
}

// --- saved parcels ----------------------------------------------------------

export function getSaved(): SavedParcel[] {
  return readRaw().savedParcels
}

export function isSaved(gislink: string): boolean {
  return readRaw().savedParcels.some((p) => p.gislink === gislink)
}

/** Toggle saved state. Returns the NEW state (true = now saved). */
export function toggleSaved(gislink: string, note: string | null = null): boolean {
  const s = readRaw()
  const existing = s.savedParcels.findIndex((p) => p.gislink === gislink)
  if (existing >= 0) {
    s.savedParcels.splice(existing, 1)
    writeRaw(s)
    return false
  }
  s.savedParcels.unshift({
    gislink,
    savedAt: new Date().toISOString(),
    note,
    tags: [],
  })
  writeRaw(s)
  return true
}

// --- recent parcels ---------------------------------------------------------

export function getRecents(): RecentParcel[] {
  return readRaw().recentParcels
}

/** Push a parcel into recents. Dedupes by gislink (moves to front), caps. */
export function pushRecent(
  gislink: string,
  meta?: { owner?: string | null; address?: string | null },
): void {
  const s = readRaw()
  const filtered = s.recentParcels.filter((p) => p.gislink !== gislink)
  filtered.unshift({
    gislink,
    viewedAt: new Date().toISOString(),
    owner: meta?.owner ?? undefined,
    address: meta?.address ?? undefined,
  })
  s.recentParcels = filtered.slice(0, RECENTS_CAP)
  writeRaw(s)
}

export function clearRecents(): void {
  const s = readRaw()
  s.recentParcels = []
  writeRaw(s)
}

// --- subscription -----------------------------------------------------------

// Cached snapshot. Refreshed only on storage events so useSyncExternalStore
// gets a stable reference between writes (otherwise React tears down and
// re-renders on every getSnapshot call).
let cachedSnapshot: StorageV1 = readRaw()

function refreshSnapshot(): void {
  cachedSnapshot = readRaw()
}

/**
 * Subscribe to storage changes (writes from this tab OR other tabs).
 * Returns an unsubscribe function. Designed for useSyncExternalStore.
 */
export function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => {
    refreshSnapshot()
    cb()
  }
  // Cross-tab native event (fired only in OTHER tabs by spec).
  window.addEventListener('storage', handler)
  // Same-tab custom event (dispatched by writeRaw above).
  window.addEventListener('holston-scout:storage', handler)
  return () => {
    window.removeEventListener('storage', handler)
    window.removeEventListener('holston-scout:storage', handler)
  }
}

// --- React hooks ------------------------------------------------------------

import { useSyncExternalStore } from 'react'

const SSR_FALLBACK: StorageV1 = emptyStorage()

function getSnapshot(): StorageV1 {
  return cachedSnapshot
}

function getServerSnapshot(): StorageV1 {
  return SSR_FALLBACK
}

/** Subscribe a component to the live storage snapshot. Stable between writes. */
export function useStorageSnapshot(): StorageV1 {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useIsSaved(gislink: string | null | undefined): boolean {
  const snap = useStorageSnapshot()
  if (!gislink) return false
  return snap.savedParcels.some((p) => p.gislink === gislink)
}

export function useRecents(): RecentParcel[] {
  return useStorageSnapshot().recentParcels
}
