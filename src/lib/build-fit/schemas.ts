// Build-fit schemas. Zod is the source of truth, TS types are inferred.
//
// Why Zod here: project-import (Phase 4) will accept user-supplied JSON
// files, which means we need real runtime validation, not just TS types.
// Phase 1 doesn't ship import yet, but using Zod from the start means the
// localStorage read path is already defensive against corruption / tampered
// payloads / version drift, and Phase 4 just plugs in.
//
// Conventions:
// - Money is whole dollars (matches ArcGIS APPRAISAL/PRICE upstream). Cents
//   conversion comes if/when we accept user-entered cost fields server-side.
// - Distances/areas user-facing in feet/sqft; internal geometry in
//   GeoJSON lng/lat (EPSG:4326).
// - All schemas are versioned via `BuildFitStoreSchema.schemaVersion`.
//   Breaking changes bump the literal and add a migrate() branch.

import { z } from 'zod'

// ── GeoJSON primitives ─────────────────────────────────────────────────────
// Minimum-viable GeoJSON validation: enough to keep us safe on read, not
// strict enough to be a full geometry validator. We're not the IETF.

// User-supplied data (Phase 4 import) flows through these schemas, so they
// must reject pathological inputs cleanly. The numeric caps here are
// generous enough to fit any real project but small enough to keep a
// malicious or accidentally-huge file from freezing the renderer.
const Position = z.array(z.number().finite()).min(2).max(3)
const LinearRing = z.array(Position).min(4).max(10_000)

/**
 * GeoJSON Polygon. Coordinates is an array of linear rings — the first
 * is the exterior ring, any remaining are interior rings (holes). At
 * least the exterior is required; we cap at 1000 rings to refuse
 * hostile "polygon with 100k holes" payloads from imported files.
 */
export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(LinearRing).min(1).max(1000),
})

/**
 * GeoJSON MultiPolygon. One or more polygons; each polygon is itself
 * an array of rings. ArcGIS occasionally returns this for parcels split
 * by water or for non-contiguous deeded properties.
 */
export const MultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(LinearRing).min(1).max(1000)).min(1).max(1000),
})

/**
 * The discriminated union used everywhere a parcel polygon flows through
 * the build-fit module. Consumers should narrow on `geometry.type` rather
 * than assume Polygon.
 */
export const PolygonOrMultiSchema = z.discriminatedUnion('type', [
  PolygonSchema,
  MultiPolygonSchema,
])

/** GeoJSON LineString. Used in fit-conflict geometry only. */
export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(Position).min(2),
})

// ── Footprint project (reusable building shape) ────────────────────────────
//
// Numeric caps for user-supplied dimensions are deliberately generous —
// the schema's job is to refuse pathological data from imports, not to
// reproduce zoning code. 100,000 ft (~19 miles per side) is well past any
// sane building footprint or parcel; numbers beyond that are almost
// certainly bad data or hostile input.

/** Hard cap on any dimension in feet (width, length, setback, etc.). */
export const MAX_DIM_FT = 100_000
/** Hard cap on any area in square feet. */
export const MAX_AREA_SQFT = 10_000_000_000
/** Max length of a footprint template name in characters. */
export const MAX_FOOTPRINT_NAME_CHARS = 200
/** Max value for the `stories` field. */
export const MAX_STORIES = 1000
/** Max length of any user-supplied notes field. */
export const MAX_NOTES_CHARS = 5000

/**
 * A reusable building footprint template (a "40 × 60 shop", a "28 × 48
 * ranch", etc.). Lives in the FootprintLibrary; can be reused across
 * different parcels (FitSession).
 *
 * Invariants:
 * - `geometry` is null until the user has placed/drawn the footprint
 *   once. The form-time path stores the typed dimensions only; geometry
 *   is computed at placement time.
 * - `footprintSqft` is the COMPUTED area, not necessarily widthFt *
 *   lengthFt (a drawn polygon will diverge from rectangle).
 */
export const FootprintProjectSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(MAX_FOOTPRINT_NAME_CHARS),
  kind: z.enum(['rectangle', 'polygon']),
  widthFt: z.number().positive().max(MAX_DIM_FT).nullable(),
  lengthFt: z.number().positive().max(MAX_DIM_FT).nullable(),
  /** Clockwise from north. Default 0 keeps v1 payloads written before
   *  this field existed parseable without bumping schemaVersion. */
  rotationDeg: z.number().finite().default(0),
  stories: z.number().int().min(0).max(MAX_STORIES).nullable(),
  /** Computed footprint area in square feet. Must be positive (geometry
   *  collapsed to zero area is a bug, not a valid template). */
  footprintSqft: z.number().positive().max(MAX_AREA_SQFT),
  /** Geometry is null until the user has placed it / drawn it once. */
  geometry: PolygonSchema.nullable(),
  createdFrom: z.enum(['typed-dimensions', 'drawn-polygon', 'imported']),
  notes: z.string().max(MAX_NOTES_CHARS).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// ── Setback config ─────────────────────────────────────────────────────────
// Discriminated on `mode` so consumers narrow on the union tag instead of
// peeking at fields. Zero is allowed on uniform (lets the user clear the
// envelope without switching mode); negative is never valid.

const SetbackNoneSchema = z.object({ mode: z.literal('none') })
const SetbackUniformSchema = z.object({
  mode: z.literal('uniform'),
  setbackFt: z.number().nonnegative().max(MAX_DIM_FT),
})
const SetbackManualSchema = z.object({
  mode: z.literal('manual'),
  frontFt: z.number().nonnegative().max(MAX_DIM_FT).nullable(),
  sideFt: z.number().nonnegative().max(MAX_DIM_FT).nullable(),
  rearFt: z.number().nonnegative().max(MAX_DIM_FT).nullable(),
  notes: z.string().max(MAX_NOTES_CHARS).nullable(),
})

/**
 * The setback configuration for a fit session. One of three shapes:
 * - `{ mode: 'none' }`: no envelope drawn.
 * - `{ mode: 'uniform', setbackFt }`: single setback distance applied to
 *   every parcel edge via Turf buffer.
 * - `{ mode: 'manual', frontFt, sideFt, rearFt, notes }`: per-edge values
 *   are captured but the envelope is NOT drawn until Phase 6 ships edge
 *   classification.
 */
export const SetbackConfigSchema = z.discriminatedUnion('mode', [
  SetbackNoneSchema,
  SetbackUniformSchema,
  SetbackManualSchema,
])

// ── Structured warnings (Phase 6) ──────────────────────────────────────────
// Pre-Phase-6 the fit result carried a flat `string[]` of warnings. That
// works for one-or-two-source notices; it breaks down once flood, slope,
// road-edge, and zoning sources are layered on. The structured shape lets
// the UI color-code by source and group by severity, and lets the report
// list "what needs verification" in priority order.
//
// `code` is a stable machine-readable identifier (e.g. `'multipolygon-largest'`,
// `'envelope-collapsed'`, `'flood-zone-AE'`). UI displays `message`; tests
// assert on `code` so display copy can change without breaking tests.
// Future i18n would key off `code`.

/** `error` blocks Save Placement (none ship today); `warning` surfaces
 *  in the panel; `info` is contextual-only. */
export const WarningSeveritySchema = z.enum(['info', 'warning', 'error'])

/** Where the warning comes from. Lets the UI render an icon/color per
 *  source and lets the report group them. */
export const WarningSourceSchema = z.enum([
  'geometry',         // parcel normalization, MultiPolygon largest-part pick
  'setback',          // setback approximation, envelope collapse, manual mode
  'parcel-snapshot',  // missing field on the snapshot
  'flood',            // FEMA flood zone touches the parcel or envelope
  'slope',            // DEM-derived slope above threshold
  'edges',            // edge labeling missing / road-auto-classify low confidence
  'imported',         // migrated from a v1 store (legacy free-text warning)
])

/** A single structured warning. */
export const FitWarningSchema = z.object({
  severity: WarningSeveritySchema,
  source: WarningSourceSchema,
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
})

// ── Edge labels (Phase 6b) ─────────────────────────────────────────────────
// `edgeIndex` references the edge as the i-th segment of the parcel's
// largest-part exterior ring: edge i runs from vertex i to vertex i+1.
// For a closed ring with N vertices (last == first), there are N-1 edges
// indexed 0..N-2.

export const EdgeLabelKindSchema = z.enum(['front', 'side', 'rear', 'other'])

/** One labeled parcel edge. */
export const EdgeLabelSchema = z.object({
  edgeIndex: z.number().int().nonnegative().max(10_000),
  label: EdgeLabelKindSchema,
})

/**
 * The result of applying a {@link SetbackConfigSchema} to a parcel.
 * `geometry` is null when mode is 'none' or 'manual' (manual records
 * values but doesn't synthesize geometry yet). `warnings` carries
 * planning-estimate notices as structured {@link FitWarningSchema}
 * objects.
 */
export const BuildableEnvelopeSchema = z.object({
  mode: z.enum(['none', 'uniform', 'manual', 'computed']),
  geometry: PolygonOrMultiSchema.nullable(),
  warnings: z.array(FitWarningSchema).max(100),
})

// ── Fit conflict ───────────────────────────────────────────────────────────

const FitConflictGeomSchema = z.union([LineStringSchema, PolygonSchema])

/**
 * One specific conflict between the proposed footprint and either the
 * parcel boundary or the buildable envelope. Mostly forward-looking —
 * Phase 1..5 emit a coarse "fitsParcel/fitsEnvelope" boolean rather
 * than itemizing conflicts. Phase 6 will populate this list.
 */
export const FitConflictSchema = z.object({
  type: z.enum(['parcel-boundary', 'setback-envelope', 'invalid-geometry']),
  label: z.string(),
  severity: z.enum(['warning', 'error']),
  geometry: FitConflictGeomSchema.nullable(),
})

// ── Fit result ─────────────────────────────────────────────────────────────

/**
 * Computed fit outcome for a placed footprint. `fitsEnvelope` is null
 * when no envelope was configured. `measurementMethod` is currently a
 * literal `'geodesic'`; future methods (e.g. survey-grade) would expand
 * the union and bump `schemaVersion`.
 */
export const FitResultSchema = z.object({
  status: z.enum(['fits', 'conflict', 'unknown']),
  fitsParcel: z.boolean(),
  /** null when no envelope was configured. */
  fitsEnvelope: z.boolean().nullable(),
  footprintSqft: z.number().nonnegative().max(MAX_AREA_SQFT),
  parcelSqft: z.number().nonnegative().max(MAX_AREA_SQFT).nullable(),
  coveragePct: z.number().nonnegative().nullable(),
  closestBoundaryFt: z.number().nonnegative().nullable(),
  measurementMethod: z.literal('geodesic'),
  conflicts: z.array(FitConflictSchema).max(10_000),
  warnings: z.array(FitWarningSchema).max(100),
  computedAt: z.string(),
})

// ── Footprint placement on a specific parcel ───────────────────────────────

/**
 * Where a {@link FootprintProjectSchema} is positioned on a specific
 * parcel: the user-chosen (or default centroid) center, the rotation,
 * and the computed footprint polygon at that position.
 */
export const FootprintPlacementSchema = z.object({
  center: z.object({
    lng: z.number().finite().gte(-180).lte(180),
    lat: z.number().finite().gte(-90).lte(90),
  }),
  rotationDeg: z.number().finite(),
  widthFt: z.number().positive().max(MAX_DIM_FT).nullable(),
  lengthFt: z.number().positive().max(MAX_DIM_FT).nullable(),
  geometry: PolygonSchema,
})

// ── Parcel snapshot ────────────────────────────────────────────────────────
//
// Snapshot rather than live-link so a saved fit session keeps making
// sense even if the upstream parcel record changes (owner sells, county
// refreshes the dataset, the parcel is renumbered, etc). Phase 6 will
// add floodZone, meanSlopePct, edgeLabels here.

/**
 * The parcel state captured at fit-session creation time. Frozen at
 * save time; we never re-fetch the parcel to "refresh" a session.
 */
export const ParcelFitSnapshotSchema = z.object({
  parcelKey: z.string().min(1).max(200),
  ownerName: z.string().max(500).nullable(),
  address: z.string().max(500).nullable(),
  county: z.string().max(200).nullable(),
  acres: z.number().nonnegative().max(10_000_000).nullable(),
  zoning: z.string().max(200).nullable(),
  appraisalDollars: z.number().nonnegative().max(1_000_000_000_000).nullable(),
  geometry: PolygonOrMultiSchema,
  capturedAt: z.string(),

  // ── Phase 6 fields, all optional + nullable ───────────────────────────
  // Captured if/when the relevant data source ran. `null` distinguishes
  // "checked and found nothing applicable" from "never checked" (undefined).

  /** FEMA NFHL flood zone code that touches the parcel ("X", "AE", "VE",
   *  etc.). Null when no FEMA zone touches the parcel. Undefined when the
   *  FEMA lookup was never run for this session. */
  floodZone: z.string().max(50).nullable().optional(),

  /** Mean slope of the parcel, in percent (rise/run × 100). Null when the
   *  DEM source returned no data for the parcel bounds. Undefined when
   *  slope analysis was never run for this session. */
  meanSlopePct: z.number().nonnegative().max(1000).nullable().optional(),

  /** Manually-applied or road-auto-classified edge labels for the parcel's
   *  largest-part exterior ring. Empty array = labels checked but none
   *  applied. Undefined = labeling was never offered. */
  edgeLabels: z.array(EdgeLabelSchema).max(10_000).optional(),
})

// ── Fit session ────────────────────────────────────────────────────────────

/**
 * A single saved "this footprint, placed on this parcel, fits like this"
 * record. References the footprint by id (a library item can be reused
 * across many sessions) but snapshots the parcel state inline (parcel
 * records can change upstream).
 *
 * Cascade: removing a footprint cascades to delete every session that
 * referenced it (see `removeFootprint` in storage.ts).
 */
export const FitSessionSchema = z.object({
  id: z.string().min(1),
  parcelKey: z.string().min(1),
  parcelSnapshot: ParcelFitSnapshotSchema,
  footprintProjectId: z.string().min(1),
  placement: FootprintPlacementSchema,
  setbackConfig: SetbackConfigSchema,
  envelope: BuildableEnvelopeSchema,
  result: FitResultSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

// ── Top-level localStorage payload ─────────────────────────────────────────

/**
 * Top-level array cap. Stops a hostile import from ballooning the store
 * into multi-GB territory and freezing the browser. 10k of each is
 * well past any real user's lifetime project count.
 */
const MAX_LIBRARY_ITEMS = 10_000

/**
 * The full persisted shape under `holston-scout/build-fit/v1` in
 * localStorage. `schemaVersion` is `2` as of Phase 6's structured-warnings
 * model. Older v1 payloads are migrated up at read time by
 * {@link migrateV1ToV2} in storage.ts; we never write v1 once a
 * Phase-6-aware build has touched the store.
 */
export const BuildFitStoreSchema = z.object({
  schemaVersion: z.literal(2),
  footprints: z.array(FootprintProjectSchema).max(MAX_LIBRARY_ITEMS),
  sessions: z.array(FitSessionSchema).max(MAX_LIBRARY_ITEMS),
  updatedAt: z.string(),
})

// ── v1 -> v2 migration ────────────────────────────────────────────────────
// v1 (Phases 1..5) carried `warnings: string[]` on both BuildableEnvelope
// and FitResult, and had no Phase-6 ParcelFitSnapshot fields. v2 lifts
// warnings to FitWarning[] and adds three optional snapshot fields. The
// migration is mechanical: each legacy string becomes one synthetic
// FitWarning with severity:'warning', source:'imported', a stable
// 'legacy-string' code, and the original text as message. The optional
// snapshot fields stay absent (undefined) until a Phase-6 sub-phase
// populates them on a fresh write.

const LegacyStringWarningsArray = z.array(z.string().max(2000)).max(100)

const BuildableEnvelopeSchemaV1 = z.object({
  mode: z.enum(['none', 'uniform', 'manual', 'computed']),
  geometry: PolygonOrMultiSchema.nullable(),
  warnings: LegacyStringWarningsArray,
})

const FitResultSchemaV1 = z.object({
  status: z.enum(['fits', 'conflict', 'unknown']),
  fitsParcel: z.boolean(),
  fitsEnvelope: z.boolean().nullable(),
  footprintSqft: z.number().nonnegative().max(MAX_AREA_SQFT),
  parcelSqft: z.number().nonnegative().max(MAX_AREA_SQFT).nullable(),
  coveragePct: z.number().nonnegative().nullable(),
  closestBoundaryFt: z.number().nonnegative().nullable(),
  measurementMethod: z.literal('geodesic'),
  conflicts: z.array(FitConflictSchema).max(10_000),
  warnings: LegacyStringWarningsArray,
  computedAt: z.string(),
})

const FitSessionSchemaV1 = z.object({
  id: z.string().min(1),
  parcelKey: z.string().min(1),
  parcelSnapshot: ParcelFitSnapshotSchema,
  footprintProjectId: z.string().min(1),
  placement: FootprintPlacementSchema,
  setbackConfig: SetbackConfigSchema,
  envelope: BuildableEnvelopeSchemaV1,
  result: FitResultSchemaV1,
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Top-level v1 store shape. Used only on read-time migrate. */
export const BuildFitStoreSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  footprints: z.array(FootprintProjectSchema).max(MAX_LIBRARY_ITEMS),
  sessions: z.array(FitSessionSchemaV1).max(MAX_LIBRARY_ITEMS),
  updatedAt: z.string(),
})

function stringToWarning(s: string): FitWarning {
  return {
    severity: 'warning',
    source: 'imported',
    code: 'legacy-string',
    message: s,
  }
}

/**
 * Upgrade a parsed v1 store to v2.
 *
 * - Each legacy `warnings: string[]` (on `envelope` and `result`) becomes
 *   `FitWarning[]` with `severity: 'warning', source: 'imported', code:
 *   'legacy-string'`.
 * - Optional snapshot fields (floodZone, meanSlopePct, edgeLabels) stay
 *   absent.
 * - `schemaVersion` is rewritten to `2`.
 *
 * This is a pure function so tests can pin the shape.
 */
export function migrateV1ToV2(v1: z.infer<typeof BuildFitStoreSchemaV1>): BuildFitStore {
  return {
    schemaVersion: 2,
    footprints: v1.footprints,
    sessions: v1.sessions.map((sess) => ({
      ...sess,
      envelope: {
        ...sess.envelope,
        warnings: sess.envelope.warnings.map(stringToWarning),
      },
      result: {
        ...sess.result,
        warnings: sess.result.warnings.map(stringToWarning),
      },
    })),
    updatedAt: v1.updatedAt,
  }
}

// ── Inferred TS types, single source of truth, no hand-written copies ────

export type Polygon = z.infer<typeof PolygonSchema>
export type MultiPolygon = z.infer<typeof MultiPolygonSchema>
export type PolygonOrMulti = z.infer<typeof PolygonOrMultiSchema>
export type LineString = z.infer<typeof LineStringSchema>

export type FootprintProject = z.infer<typeof FootprintProjectSchema>
export type SetbackConfig = z.infer<typeof SetbackConfigSchema>
export type BuildableEnvelope = z.infer<typeof BuildableEnvelopeSchema>
export type FitConflict = z.infer<typeof FitConflictSchema>
export type FitResult = z.infer<typeof FitResultSchema>
export type FootprintPlacement = z.infer<typeof FootprintPlacementSchema>
export type ParcelFitSnapshot = z.infer<typeof ParcelFitSnapshotSchema>
export type FitSession = z.infer<typeof FitSessionSchema>
export type BuildFitStore = z.infer<typeof BuildFitStoreSchema>

// Phase 6 types.
export type WarningSeverity = z.infer<typeof WarningSeveritySchema>
export type WarningSource = z.infer<typeof WarningSourceSchema>
export type FitWarning = z.infer<typeof FitWarningSchema>
export type EdgeLabelKind = z.infer<typeof EdgeLabelKindSchema>
export type EdgeLabel = z.infer<typeof EdgeLabelSchema>
