// Build-fit geometry math.
//
// Conventions:
//   User-facing units: feet, square feet.
//   Internal geometry: GeoJSON [lng, lat] in EPSG:4326.
//   Distances are geodesic via Turf's destination (great-circle on a
//     spherical earth model). The ~0.3% sphere-vs-ellipsoid error at
//     parcel scale is dwarfed by parcel-boundary survey uncertainty.
//   Area via Turf's area, which uses a geodesic algorithm on m^2. We
//     convert to sqft once on the boundary.
//
// Centroid is imported from src/lib/insights.ts rather than
// re-implemented. It already has unit-test coverage there; forking
// would risk drift.

import area from '@turf/area'
import destination from '@turf/destination'
import {
  polygon as turfPolygon,
  multiPolygon as turfMultiPolygon,
  point as turfPoint,
  lineString as turfLineString,
} from '@turf/helpers'
import booleanWithin from '@turf/boolean-within'
import buffer from '@turf/buffer'
import pointToLineDistance from '@turf/point-to-line-distance'
import { centroid as parcelCentroid } from '@/lib/insights'
import type { Polygon, PolygonOrMulti } from './schemas'

export const FEET_PER_METER = 3.28084
export const METERS_PER_FOOT = 0.3048
export const SQM_TO_SQFT = 10.7639104167

// ── Rectangle from typed dimensions ────────────────────────────────────────
// Generates a closed [width × length] rectangle centered on `center`,
// rotated `rotationDeg` clockwise from north (north = 0°, east = 90°).
//
// The rectangle has 5 coordinates (4 corners + first repeated to close).
// Sides are geodesic, at TN latitudes the difference vs a flat-earth
// approximation is sub-foot for buildings under ~500ft, but using the
// sphere keeps the model honest at any parcel scale.

export interface RectangleInput {
  center: [number, number] // [lng, lat]
  widthFt: number
  lengthFt: number
  /** Clockwise from north. 0 = length axis points north, 90 = points east. */
  rotationDeg: number
}

export function rectangleFromDimensions(input: RectangleInput): Polygon {
  const { center, widthFt, lengthFt, rotationDeg } = input
  if (widthFt <= 0 || lengthFt <= 0) {
    throw new Error('rectangleFromDimensions: width and length must be positive')
  }
  // half-distances in km (Turf destination expects km by default)
  const halfWidthKm = (widthFt * METERS_PER_FOOT) / 2 / 1000
  const halfLengthKm = (lengthFt * METERS_PER_FOOT) / 2 / 1000

  // Bearings: 0 = north, 90 = east. Clockwise.
  const lengthAxis = rotationDeg
  const widthAxis = rotationDeg + 90
  const c = turfPoint(center)

  // Walk to each corner. Order: NE, SE, SW, NW (then close).
  // "North" along length axis = +halfLength along lengthAxis.
  // "East"  along width  axis = +halfWidth  along widthAxis.
  const ne = walk(walk(c.geometry.coordinates as [number, number], lengthAxis, halfLengthKm), widthAxis, halfWidthKm)
  const se = walk(walk(c.geometry.coordinates as [number, number], lengthAxis, -halfLengthKm), widthAxis, halfWidthKm)
  const sw = walk(walk(c.geometry.coordinates as [number, number], lengthAxis, -halfLengthKm), widthAxis, -halfWidthKm)
  const nw = walk(walk(c.geometry.coordinates as [number, number], lengthAxis, halfLengthKm), widthAxis, -halfWidthKm)

  return {
    type: 'Polygon',
    coordinates: [[ne, se, sw, nw, ne]],
  }
}

function walk(from: [number, number], bearingDeg: number, distanceKm: number): [number, number] {
  const moved = destination(from, distanceKm, bearingDeg, { units: 'kilometers' })
  return moved.geometry.coordinates as [number, number]
}

// ── Area + coverage ────────────────────────────────────────────────────────

/** Polygon area in square feet. Uses Turf's geodesic algorithm. */
export function footprintAreaSqft(geom: Polygon): number {
  return area(turfPolygon(geom.coordinates)) * SQM_TO_SQFT
}

/** Parcel area in square feet, handles Polygon and MultiPolygon. */
export function parcelAreaSqft(geom: PolygonOrMulti): number {
  if (geom.type === 'Polygon') {
    return area(turfPolygon(geom.coordinates)) * SQM_TO_SQFT
  }
  // MultiPolygon: sum each part.
  let total = 0
  for (const partCoords of geom.coordinates) {
    total += area(turfPolygon(partCoords))
  }
  return total * SQM_TO_SQFT
}

/** Coverage as a percentage (0–100). null when parcel area is unknown/zero. */
export function coveragePct(footprintSqft: number, parcelSqft: number | null): number | null {
  if (parcelSqft == null || parcelSqft <= 0) return null
  return (footprintSqft / parcelSqft) * 100
}

// ── Fit checks ─────────────────────────────────────────────────────────────

/**
 * Does the footprint lie entirely within the parcel?
 *
 * For Polygon parcels: a single Turf booleanWithin call.
 * For MultiPolygon parcels: returns true if the footprint lies within ANY
 * one part (a building can sit on one of two land parts, just not span
 * both). This matches the planning intent, a footprint that crosses
 * between two disjoint parcel parts isn't actually buildable.
 */
export function fitsWithinParcel(footprint: Polygon, parcel: PolygonOrMulti): boolean {
  const fpFeature = turfPolygon(footprint.coordinates)
  if (parcel.type === 'Polygon') {
    return booleanWithin(fpFeature, turfPolygon(parcel.coordinates))
  }
  for (const partCoords of parcel.coordinates) {
    if (booleanWithin(fpFeature, turfPolygon(partCoords))) return true
  }
  return false
}

// ── Convenience: pick a default footprint center ───────────────────────────

/** Largest-polygon centroid, same heuristic the parcel detail panel uses. */
export function defaultFootprintCenter(parcel: PolygonOrMulti): [number, number] | null {
  return parcelCentroid(parcel)
}

// ── Closest distance from footprint to parcel boundary ───────────────────
// Point-to-edge clearance using Turf's geodesic point-to-line distance.
// For each footprint vertex we measure the perpendicular distance to every
// parcel ring (treated as a closed LineString); the minimum across all
// pairs is the true clearance to the nearest boundary, accurate even when
// parcel rings have sparse vertices and the closest point on the boundary
// lies between them.
//
// Returns null if the footprint has no exterior ring or the parcel has no
// rings.

export function closestBoundaryFt(footprint: Polygon, parcel: PolygonOrMulti): number | null {
  const fpVerts = footprint.coordinates[0]
  if (!fpVerts || fpVerts.length === 0) return null

  // Flatten parcel into a list of LineStrings (one per ring). MultiPolygon
  // contributes every ring of every part. Skip rings that are too short
  // for a LineString (Turf requires >= 2 positions).
  const parcelRings = parcel.type === 'Polygon' ? parcel.coordinates : parcel.coordinates.flat()
  const lines = parcelRings
    .filter((ring): ring is number[][] => Array.isArray(ring) && ring.length >= 2)
    .map((ring) => turfLineString(ring))

  if (lines.length === 0) return null

  let minKm = Infinity
  for (const fv of fpVerts) {
    const pt = turfPoint(fv as [number, number])
    for (const line of lines) {
      const d = pointToLineDistance(pt, line, { units: 'kilometers' })
      if (d < minKm) minKm = d
    }
  }
  if (!Number.isFinite(minKm)) return null
  // km -> m -> ft
  return minKm * 1000 * FEET_PER_METER
}

// ── Geometry normalization ─────────────────────────────────────────────────
// Build-fit accepts both Polygon and MultiPolygon parcels (ArcGIS may return
// either). For display + centroid defaults, the largest polygon wins. For
// fit checks, we test against the full geometry (see fitsWithinParcel).

export interface NormalizedParcel {
  /** Largest-polygon view, suitable for display and centroid math. */
  largest: Polygon
  /** Original geometry, used for fit checks against the whole parcel. */
  full: PolygonOrMulti
  /** Set when the original was a MultiPolygon and we picked the largest part. */
  warning: string | null
}

export function normalizeParcel(geom: PolygonOrMulti): NormalizedParcel {
  if (geom.type === 'Polygon') {
    return { largest: geom, full: geom, warning: null }
  }
  // Pick the polygon part with the largest area.
  let largest: Polygon | null = null
  let largestArea = -Infinity
  for (const partCoords of geom.coordinates) {
    const part: Polygon = { type: 'Polygon', coordinates: partCoords }
    const a = area(turfPolygon(partCoords))
    if (a > largestArea) {
      largestArea = a
      largest = part
    }
  }
  if (!largest) {
    throw new Error('normalizeParcel: MultiPolygon with no parts')
  }
  return {
    largest,
    full: geom,
    warning: 'Parcel has multiple geometry parts. Default placement used the largest part; the fit check still runs against the full parcel geometry.',
  }
}

// ── Footprint dimension labels ──────────────────────────────────────────
// Pure function: given a typed-rectangle footprint and its dimensions,
// produce three Point features for the fit-labels source, one near each
// of the two distinguishable side midpoints (width axis + length axis)
// plus an area label at the rectangle's center.
//
// Coordinate convention matches rectangleFromDimensions: ring order is
// [NE, SE, SW, NW, NE] (close). So:
//   ring[0] = NE   ring[1] = SE   ring[2] = SW   ring[3] = NW
// The four edge midpoints are:
//   N edge: midpoint(NE, NW)  -> length axis (the "north" face)
//   E edge: midpoint(NE, SE)  -> width axis  (the "east" face)
//   S edge: midpoint(SE, SW)  -> length axis (the "south" face)
//   W edge: midpoint(NW, SW)  -> width axis  (the "west" face)
// We label one width edge and one length edge (E and N) plus the centroid
// for area. Labelling both width edges would be redundant.
//
// `properties.label` is what the fit-labels symbol layer reads via
// ['get', 'label'], see src/lib/build-fit/map-layers.ts.

export interface FootprintLabelInput {
  footprint: Polygon
  widthFt: number
  lengthFt: number
}

export function footprintLabels(input: FootprintLabelInput): GeoJSON.Feature<GeoJSON.Point>[] {
  const ring = input.footprint.coordinates[0]
  if (!ring || ring.length < 5) return []
  const ne = ring[0]
  const se = ring[1]
  const sw = ring[2]
  const nw = ring[3]
  if (!ne || !se || !sw || !nw) return []

  const midNorth = midpoint(ne, nw)
  const midEast = midpoint(ne, se)
  const center = midpoint(midpoint(ne, sw), midpoint(nw, se))

  return [
    pointFeature(midEast, `${formatFt(input.widthFt)} ft`),
    pointFeature(midNorth, `${formatFt(input.lengthFt)} ft`),
    pointFeature(center, `${formatSqft(input.widthFt * input.lengthFt)} sqft`),
  ]
}

function midpoint(a: number[], b: number[]): [number, number] {
  return [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2]
}

function pointFeature(coords: [number, number], label: string): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: { label },
  }
}

function formatFt(n: number): string {
  // Whole feet for typed dimensions; one decimal if user typed a fraction.
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function formatSqft(n: number): string {
  return Math.round(n).toLocaleString()
}

// ── Setback envelope (uniform, planning-only) ──────────────────────────────
// Inward offset of a parcel by `setbackFt` feet using Turf's geodesic buffer
// (negative distance). This is a PLANNING ESTIMATE only: Turf buffer
// rounds inset corners and is uniform on every edge regardless of front
// / side / rear classification. True buildable envelopes need straight-
// line half-plane clipping + zoning edge analysis (Phase 6).
//
// Returns:
//   null         the setback is zero or negative, or the envelope
//                degenerated (e.g. setback > half the parcel's narrowest
//                dimension and the buffer collapses to nothing).
//   Polygon      the inset envelope.
//   MultiPolygon if a Polygon parcel split into multiple parts during
//                the inset (rare but possible for waisted/L-shaped lots).

export function setbackEnvelope(
  parcel: PolygonOrMulti,
  setbackFt: number,
): PolygonOrMulti | null {
  if (!Number.isFinite(setbackFt) || setbackFt <= 0) return null
  const setbackKm = (setbackFt * METERS_PER_FOOT) / 1000
  const input =
    parcel.type === 'Polygon'
      ? turfPolygon(parcel.coordinates)
      : turfMultiPolygon(parcel.coordinates)
  try {
    const result = buffer(input, -setbackKm, { units: 'kilometers' })
    if (!result || !result.geometry) return null
    const g = result.geometry
    if (g.type === 'Polygon') {
      // Reject degenerate rings (Turf can produce <4-coord rings on
      // near-collapse cases that downstream Turf calls then crash on).
      const ring = g.coordinates[0]
      if (!ring || ring.length < 4) return null
      return { type: 'Polygon', coordinates: g.coordinates as number[][][] }
    }
    if (g.type === 'MultiPolygon') {
      const parts = (g.coordinates as number[][][][]).filter(
        (part) => part[0] && part[0].length >= 4,
      )
      if (parts.length === 0) return null
      return { type: 'MultiPolygon', coordinates: parts }
    }
    return null
  } catch {
    // Turf throws on truly degenerate inputs (zero-area parcel, ring with
    // <3 distinct vertices). Treat as 'no envelope.'
    return null
  }
}

/** Envelope area in sqft, summing every part. */
export function envelopeAreaSqft(envelope: PolygonOrMulti): number {
  return parcelAreaSqft(envelope)
}

// Re-exports so consumers don't need separate imports.
export type { Polygon, MultiPolygon, PolygonOrMulti } from './schemas'
