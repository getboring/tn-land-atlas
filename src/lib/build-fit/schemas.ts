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

export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  // At least the exterior ring is required. Interior rings (holes) are
  // optional but go in this same array per the GeoJSON RFC.
  // Upper cap on ring count prevents pathological "polygon with 100k
  // holes" payloads from a hostile import.
  coordinates: z.array(LinearRing).min(1).max(1000),
})

export const MultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  // At least one part is required. Each part has its own exterior ring + holes.
  coordinates: z.array(z.array(LinearRing).min(1).max(1000)).min(1).max(1000),
})

export const PolygonOrMultiSchema = z.discriminatedUnion('type', [
  PolygonSchema,
  MultiPolygonSchema,
])

export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(Position).min(2),
})

// ── Footprint project (reusable building shape) ────────────────────────────

// Numeric caps for user-supplied dimensions. 100,000 ft (~19 miles per
// side) is well past any sane building footprint or parcel; numbers
// beyond that are almost certainly bad import data.
export const MAX_DIM_FT = 100_000
export const MAX_AREA_SQFT = 10_000_000_000
export const MAX_FOOTPRINT_NAME_CHARS = 200
export const MAX_STORIES = 1000
export const MAX_NOTES_CHARS = 5000

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

// ── Setback config (discriminated union on `mode`) ─────────────────────────

const SetbackNoneSchema = z.object({ mode: z.literal('none') })
const SetbackUniformSchema = z.object({
  mode: z.literal('uniform'),
  // Non-negative: 0 is allowed (lets the user clear without switching mode),
  // negative makes no physical sense.
  setbackFt: z.number().nonnegative().max(MAX_DIM_FT),
})
const SetbackManualSchema = z.object({
  mode: z.literal('manual'),
  frontFt: z.number().nonnegative().max(MAX_DIM_FT).nullable(),
  sideFt: z.number().nonnegative().max(MAX_DIM_FT).nullable(),
  rearFt: z.number().nonnegative().max(MAX_DIM_FT).nullable(),
  notes: z.string().max(MAX_NOTES_CHARS).nullable(),
})

export const SetbackConfigSchema = z.discriminatedUnion('mode', [
  SetbackNoneSchema,
  SetbackUniformSchema,
  SetbackManualSchema,
])

// ── Buildable envelope ─────────────────────────────────────────────────────

export const BuildableEnvelopeSchema = z.object({
  mode: z.enum(['none', 'uniform', 'manual', 'computed']),
  geometry: PolygonOrMultiSchema.nullable(),
  warnings: z.array(z.string()),
})

// ── Fit conflict ───────────────────────────────────────────────────────────

const FitConflictGeomSchema = z.union([LineStringSchema, PolygonSchema])

export const FitConflictSchema = z.object({
  type: z.enum(['parcel-boundary', 'setback-envelope', 'invalid-geometry']),
  label: z.string(),
  severity: z.enum(['warning', 'error']),
  geometry: FitConflictGeomSchema.nullable(),
})

// ── Fit result ─────────────────────────────────────────────────────────────

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
  warnings: z.array(z.string().max(2000)).max(100),
  computedAt: z.string(),
})

// ── Footprint placement on a specific parcel ───────────────────────────────

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

// ── Parcel snapshot captured at fit-session creation time ──────────────────
// Snapshot rather than live-link so a saved fit-session keeps making sense
// even if the upstream parcel record changes (owner sells, county refreshes
// the dataset, etc).

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
})

// ── Fit session (a footprint placed on a parcel with a fit result) ─────────

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

// Top-level array caps stop a hostile import from ballooning the store
// into multi-GB territory and freezing the browser. 10k of each is
// well past any real user's lifetime project count.
const MAX_LIBRARY_ITEMS = 10_000

export const BuildFitStoreSchema = z.object({
  schemaVersion: z.literal(1),
  footprints: z.array(FootprintProjectSchema).max(MAX_LIBRARY_ITEMS),
  sessions: z.array(FitSessionSchema).max(MAX_LIBRARY_ITEMS),
  updatedAt: z.string(),
})

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
