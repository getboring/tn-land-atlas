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
  BuildFitStoreSchemaV1,
  FootprintProjectSchema,
  FitSessionSchema,
  migrateV1ToV2,
  type BuildFitStore,
} from './schemas'
import { getFootprints, getSessions, replaceStore } from './storage'

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

/**
 * The export envelope. `schemaVersion` here is the FILE envelope, not the
 * store inside it. v1 stayed at literal 1; v2 (Phase 6) keeps it at 1
 * because the envelope itself didn't change — only the inner `data`
 * BuildFitStore did, and `importProjectFile` accepts either v1 or v2
 * inner data via the migrate path.
 *
 * Bump this literal only when the envelope fields themselves change.
 */
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

/** Lenient envelope used at import time so we can carry a v1 inner store
 *  through validation, then migrate before persisting. The narrowed
 *  ProjectFileSchema is the strict shape; this is the input shape. */
const ProjectFileEnvelopeForImportSchema = z.object({
  schemaVersion: z.literal(1),
  app: z.object({
    name: z.string(),
    version: z.string(),
    url: z.string(),
  }),
  generatedAt: z.string(),
  disclaimer: z.string(),
  data: z.union([BuildFitStoreSchema, BuildFitStoreSchemaV1]),
})

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
    schemaVersion: 2,
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
    schemaVersion: 2,
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

  // Accept either v1 or v2 inner store. v1 files (written by Phases 1..5)
  // are migrated to v2 in-memory before any further validation. This
  // preserves Phase-5-era .hscout.json files; otherwise users who exported
  // before Phase 6 would see import failures.
  const lenient = ProjectFileEnvelopeForImportSchema.safeParse(parsed)
  if (!lenient.success) {
    const first = lenient.error.issues[0]
    const path = first?.path?.join('.') ?? '<root>'
    return {
      ok: false,
      error: `Not a valid Holston Scout project file. ${first?.message ?? 'Schema mismatch'} at ${path}.`,
    }
  }

  // Migrate v1 inner store to v2 if needed, then wrap as the strict envelope
  // shape for the rest of this function to work with.
  const innerData: BuildFitStore =
    lenient.data.data.schemaVersion === 1
      ? migrateV1ToV2(lenient.data.data)
      : lenient.data.data
  const file: ProjectFile = {
    schemaVersion: lenient.data.schemaVersion,
    app: lenient.data.app,
    generatedAt: lenient.data.generatedAt,
    disclaimer: lenient.data.disclaimer,
    data: innerData,
  }

  // Defense in depth: re-validate every footprint and session individually
  // before persistence. The store's upsert helpers already do this, but
  // running it here lets us batch the writes with a clean rollback story
  // (we count what we'll insert; if any sub-validation fails we abort
  // BEFORE any writes hit localStorage).
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

  const mergedStore: BuildFitStore = {
    schemaVersion: 2,
    footprints: [...getFootprints()],
    sessions: [...getSessions()],
    updatedAt: new Date().toISOString(),
  }

  for (const fp of file.data.footprints) {
    const existing = mergedStore.footprints.findIndex((existingFp) => existingFp.id === fp.id)
    if (existing >= 0) {
      mergedStore.footprints[existing] = fp
    } else {
      mergedStore.footprints.unshift(fp)
    }
  }
  for (const sess of file.data.sessions) {
    const existing = mergedStore.sessions.findIndex((existingSession) => existingSession.id === sess.id)
    if (existing >= 0) {
      mergedStore.sessions[existing] = sess
    } else {
      mergedStore.sessions.unshift(sess)
    }
  }

  const write = replaceStore(mergedStore)
  if (!write.ok) {
    return {
      ok: false,
      error:
        write.reason === 'validation'
          ? 'Import would exceed the saved library limits. Nothing was written.'
          : 'Browser storage rejected the import. Free up site storage and try again. Nothing was written.',
    }
  }

  return {
    ok: true,
    summary: {
      footprints: file.data.footprints.length,
      sessions: file.data.sessions.length,
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
