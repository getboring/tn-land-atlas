// Build-fit schemas. Zod is the source of truth — TS types are inferred.
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

const Position = z.array(z.number()).min(2).max(3)
const LinearRing = z.array(Position).min(4)

export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  // At least the exterior ring is required. Interior rings (holes) are
  // optional but go in this same array per the GeoJSON RFC.
  coordinates: z.array(LinearRing).min(1),
})

export const MultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  // At least one part is required. Each part has its own exterior ring + holes.
  coordinates: z.array(z.array(LinearRing).min(1)).min(1),
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

export const FootprintProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['rectangle', 'polygon']),
  widthFt: z.number().nullable(),
  lengthFt: z.number().nullable(),
  stories: z.number().nullable(),
  /** Computed footprint area in square feet, capped to 7 decimals on write. */
  footprintSqft: z.number(),
  /** Geometry is null until the user has placed it / drawn it once. */
  geometry: PolygonSchema.nullable(),
  createdFrom: z.enum(['typed-dimensions', 'drawn-polygon', 'imported']),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// ── Setback config (discriminated union on `mode`) ─────────────────────────

const SetbackNoneSchema = z.object({ mode: z.literal('none') })
const SetbackUniformSchema = z.object({
  mode: z.literal('uniform'),
  setbackFt: z.number(),
})
const SetbackManualSchema = z.object({
  mode: z.literal('manual'),
  frontFt: z.number().nullable(),
  sideFt: z.number().nullable(),
  rearFt: z.number().nullable(),
  notes: z.string().nullable(),
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
  footprintSqft: z.number(),
  parcelSqft: z.number().nullable(),
  coveragePct: z.number().nullable(),
  closestBoundaryFt: z.number().nullable(),
  measurementMethod: z.literal('geodesic'),
  conflicts: z.array(FitConflictSchema),
  warnings: z.array(z.string()),
  computedAt: z.string(),
})

// ── Footprint placement on a specific parcel ───────────────────────────────

export const FootprintPlacementSchema = z.object({
  center: z.object({ lng: z.number(), lat: z.number() }),
  rotationDeg: z.number(),
  widthFt: z.number().nullable(),
  lengthFt: z.number().nullable(),
  geometry: PolygonSchema,
})

// ── Parcel snapshot captured at fit-session creation time ──────────────────
// Snapshot rather than live-link so a saved fit-session keeps making sense
// even if the upstream parcel record changes (owner sells, county refreshes
// the dataset, etc).

export const ParcelFitSnapshotSchema = z.object({
  parcelKey: z.string().min(1),
  ownerName: z.string().nullable(),
  address: z.string().nullable(),
  county: z.string().nullable(),
  acres: z.number().nullable(),
  zoning: z.string().nullable(),
  appraisalDollars: z.number().nullable(),
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

export const BuildFitStoreSchema = z.object({
  schemaVersion: z.literal(1),
  footprints: z.array(FootprintProjectSchema),
  sessions: z.array(FitSessionSchema),
  updatedAt: z.string(),
})

// ── Inferred TS types — single source of truth, no hand-written copies ────

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
