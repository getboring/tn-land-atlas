// Build-fit project file: portable export/import for the BuildFitStore.
//
// Goal (per projects/buildplan2.md Phase 4): make work portable BEFORE auth
// lands, so a builder can email a colleague a JSON file with their saved
// footprints and fit sessions and the colleague can drop it into their
// own browser session.
//
// File shape (envelope):
//   {
//     schemaVersion: 1
//     app: { name, version, url }      // for traceability / future migrate
//     generatedAt: ISO timestamp
//     disclaimer: full planning-only text
//     data: BuildFitStore               // the actual saved state
//   }
//
// File extension: .hscout.json (Universal JSON, plus a recognizable
// double-extension that's still openable in any editor).
//
// Forward-compatibility: schemaVersion is a literal 1. Future breaking
// changes bump the literal and add a migrate() branch in importProjectFile.

import { z } from 'zod'
import {
  BuildFitStoreSchema,
  FootprintProjectSchema,
  FitSessionSchema,
  type BuildFitStore,
  type FitSession,
} from './schemas'
import { upsertFootprint, upsertSession, getFootprints, getSessions } from './storage'

// Bumped when the export shape changes. Independent of BuildFitStore's own
// schemaVersion (an envelope around it). v1.0.0 = the shape below.
export const PROJECT_FILE_APP_VERSION = '1.0.0'
export const PROJECT_FILE_APP_NAME = 'Holston Scout'
export const PROJECT_FILE_APP_URL = 'https://tn-land-atlas.pages.dev'

export const PROJECT_FILE_DISCLAIMER =
  'Planning estimate only. Parcel boundaries, setbacks, zoning, slopes, ' +
  'easements, utilities, septic rules, floodplain status, and survey ' +
  'conditions must be verified with the local authority, surveyor, and ' +
  'design professional before purchase, permitting, or construction.'

export const ProjectFileSchema = z.object({
  schemaVersion: z.literal(1),
  app: z.object({
    name: z.string(),
    version: z.string(),
    url: z.string(),
  }),
  generatedAt: z.string(),
  disclaimer: z.string(),
  data: BuildFitStoreSchema,
})
export type ProjectFile = z.infer<typeof ProjectFileSchema>

// ── Build envelope from current state ───────────────────────────────────

function envelope(data: BuildFitStore): ProjectFile {
  return {
    schemaVersion: 1,
    app: {
      name: PROJECT_FILE_APP_NAME,
      version: PROJECT_FILE_APP_VERSION,
      url: PROJECT_FILE_APP_URL,
    },
    generatedAt: new Date().toISOString(),
    disclaimer: PROJECT_FILE_DISCLAIMER,
    data,
  }
}

/** Build a ProjectFile holding the full current store. */
export function exportStore(): ProjectFile {
  return envelope({
    schemaVersion: 1,
    footprints: getFootprints(),
    sessions: getSessions(),
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Build a ProjectFile holding ONE session and its referenced footprint.
 * Returns null if the session id isn't found OR if the session points at
 * a footprintProjectId that no longer exists in the store (orphan; the
 * caller should fall back to whole-store export).
 */
export function exportSession(sessionId: string): ProjectFile | null {
  const sessions = getSessions()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return null
  const footprints = getFootprints()
  const footprint = footprints.find((f) => f.id === session.footprintProjectId)
  if (!footprint) return null
  return envelope({
    schemaVersion: 1,
    footprints: [footprint],
    sessions: [session],
    updatedAt: new Date().toISOString(),
  })
}

/** Pretty-printed JSON of a ProjectFile, ready to save. */
export function serializeProjectFile(file: ProjectFile): string {
  return JSON.stringify(file, null, 2)
}

/** Filename builder: holston-scout-fit-<kind/parcel>-<YYYY-MM-DD>.hscout.json */
export function exportFilename(opts: {
  kind: 'store' | 'session'
  parcelKey?: string | null
}): string {
  const date = new Date().toISOString().slice(0, 10)
  if (opts.kind === 'session' && opts.parcelKey) {
    return `holston-scout-fit-${sanitizeForFilename(opts.parcelKey)}-${date}.hscout.json`
  }
  return `holston-scout-fit-store-${date}.hscout.json`
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'parcel'
}

// ── Import ─────────────────────────────────────────────────────────────

export interface ImportSummary {
  footprints: number
  sessions: number
}
export type ImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string }

/**
 * Parse a project-file text payload, validate against the envelope schema,
 * and upsert every footprint + session into the current store. Matches by
 * id, so importing a file twice is idempotent.
 *
 * Bad JSON, schema mismatch, or version drift produce a structured error;
 * the existing store is never modified on the failure path.
 */
export function importProjectFile(text: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'File is not valid JSON.' }
  }

  const result = ProjectFileSchema.safeParse(parsed)
  if (!result.success) {
    // Drill into the first issue for a useful message.
    const first = result.error.issues[0]
    const path = first?.path?.join('.') ?? '<root>'
    return {
      ok: false,
      error: `Not a valid Holston Scout project file. ${first?.message ?? 'Schema mismatch'} at ${path}.`,
    }
  }

  // Defense in depth: re-validate every footprint and session individually
  // before persistence. The store's upsert helpers already do this, but
  // running it here lets us batch the writes with a clean rollback story
  // (we count what we'll insert; if any sub-validation fails we abort
  // BEFORE any writes hit localStorage).
  const file = result.data
  for (const fp of file.data.footprints) {
    const r = FootprintProjectSchema.safeParse(fp)
    if (!r.success) {
      return { ok: false, error: `Footprint "${fp.name ?? fp.id}" failed validation: ${r.error.issues[0]?.message}` }
    }
  }
  for (const sess of file.data.sessions) {
    const r = FitSessionSchema.safeParse(sess)
    if (!r.success) {
      return { ok: false, error: `Session ${sess.id} failed validation: ${r.error.issues[0]?.message}` }
    }
  }

  // Referential integrity check before any write. A session that points
  // at a footprintProjectId not in the imported footprints AND not in
  // the existing store is an orphan; reject the whole file so we don't
  // end up with broken session references that future export/handoff
  // code can't reason about.
  const existingFootprintIds = new Set(getFootprints().map((f) => f.id))
  const importedFootprintIds = new Set(file.data.footprints.map((f) => f.id))
  for (const sess of file.data.sessions) {
    const known =
      importedFootprintIds.has(sess.footprintProjectId) ||
      existingFootprintIds.has(sess.footprintProjectId)
    if (!known) {
      return {
        ok: false,
        error: `Session ${sess.id} references missing footprint ${sess.footprintProjectId}. Aborted before writing.`,
      }
    }
  }

  // All good, write. Each upsert can independently fail at the
  // localStorage layer (quota, private mode, serialization). On any
  // failure we surface a partial-write error so the caller can warn
  // the user instead of falsely reporting success.
  let writtenFootprints = 0
  let writtenSessions = 0
  for (const fp of file.data.footprints) {
    const r = upsertFootprint(fp)
    if (!r.ok) {
      return {
        ok: false,
        error: `Browser storage rejected the write after ${writtenFootprints} of ${file.data.footprints.length} footprints. Free up site storage and try again.`,
      }
    }
    writtenFootprints++
  }
  for (const sess of file.data.sessions) {
    const r = upsertSession(sess as FitSession)
    if (!r.ok) {
      return {
        ok: false,
        error: `Browser storage rejected the write after ${writtenSessions} of ${file.data.sessions.length} sessions. Free up site storage and try again.`,
      }
    }
    writtenSessions++
  }

  return {
    ok: true,
    summary: {
      footprints: writtenFootprints,
      sessions: writtenSessions,
    },
  }
}

// ── DOM bridge: trigger a download from the browser ────────────────────
// Pulled out so the geometry/storage layers stay browser-agnostic and
// testable in jsdom. The workspace component calls this once.

export function triggerDownload(filename: string, text: string): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoking immediately works in every modern browser; we don't await
  // the click handler because the click is synchronous.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Read a File (from <input type="file">) as text. Wraps FileReader in
 * a Promise so the workspace's import handler can await it cleanly.
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsText(file)
  })
}
