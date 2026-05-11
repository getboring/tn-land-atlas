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
  point as turfPoint,
  lineString as turfLineString,
} from '@turf/helpers'
import booleanWithin from '@turf/boolean-within'
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
  // Narrow each corner to [number, number]. ring is number[][] in the GeoJSON
  // type; PolygonSchema's Position validator (min 2, max 3) guarantees the
  // length at the boundary, but TypeScript doesn't carry that constraint.
  // The narrow* helper performs an explicit shape check so the rest of this
  // function can compose midpoints without nullable-array juggling.
  const ne = narrowCoord(ring[0])
  const se = narrowCoord(ring[1])
  const sw = narrowCoord(ring[2])
  const nw = narrowCoord(ring[3])
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

/**
 * Midpoint of two GeoJSON coordinate pairs.
 *
 * Typed against `[number, number]` so callers can't hand in a malformed
 * coordinate. Returns the same shape so it composes with itself
 * (`midpoint(midpoint(a, b), midpoint(c, d))` is the rectangle center).
 */
function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/**
 * Narrow a `number[]` to `[number, number]`, or return null when the
 * input is missing the first two finite numbers. Used to bridge the
 * GeoJSON `number[][]` shape into the build-fit module's stricter
 * `[number, number]` boundary without `!` assertions.
 */
function narrowCoord(pos: number[] | undefined): [number, number] | null {
  if (!pos) return null
  const x = pos[0]
  const y = pos[1]
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
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

// ── Setback envelope: true straight-line inset (Phase 6a) ─────────────────
// Inward offset of a parcel by setback distance(s) using half-plane
// clipping. Sharp corners survive (no Turf-buffer rounding); uniform and
// per-edge distances both supported.
//
// Algorithm:
//   1. Project the parcel ring to local meters via an equirectangular
//      tangent plane at the parcel centroid. Sub-foot error at TN
//      latitudes for typical parcel scale, geodesic-quality for buildable
//      envelopes is overkill and adds bundle cost we don't need.
//   2. Detect ring orientation via signed area. Normalize to CCW for the
//      rest of the math.
//   3. For each edge, compute the inward unit normal and translate the
//      edge inward by its setback distance. The result is one offset line
//      per edge.
//   4. Successively clip the original polygon against each offset line
//      using Sutherland-Hodgman half-plane clipping. Each clip retains
//      vertices on the inward side of that line and inserts the
//      line-segment intersection where the polygon edge crosses the
//      offset line.
//   5. Project the clipped polygon back to lng/lat.
//
// Returns null when the resulting polygon has fewer than 3 distinct
// vertices (envelope collapsed) or when the input is degenerate.
//
// `distancesFt` accepts either a single number (uniform setback, used by
// the 'uniform' SetbackConfig mode) or an array of length equal to the
// number of edges (used by Phase 6c's per-edge mode).

/**
 * Inset a single Polygon ring by either a uniform distance or per-edge
 * distances. Returns null when the envelope collapses to < 3 vertices.
 *
 * @param ring Closed exterior ring as `[lng, lat][]` with first === last.
 * @param distancesFt Either a single foot distance applied to every edge
 *   or an array of foot distances, one per edge (in ring vertex order,
 *   edge i runs from vertex i to vertex i+1).
 */
export function insetPolygonRing(
  ring: number[][],
  distancesFt: number | number[],
): number[][] | null {
  if (ring.length < 4) return null
  // Drop the closing duplicate vertex for processing.
  const open = ring.slice(0, ring.length - 1)
  const n = open.length
  if (n < 3) return null

  // Per-edge distance array. Edge i runs from open[i] to open[(i+1)%n].
  const distancesM: number[] = []
  if (typeof distancesFt === 'number') {
    for (let i = 0; i < n; i++) distancesM.push(distancesFt * METERS_PER_FOOT)
  } else {
    if (distancesFt.length !== n) return null
    for (const d of distancesFt) distancesM.push(d * METERS_PER_FOOT)
  }
  if (distancesM.some((d) => !Number.isFinite(d) || d < 0)) return null
  // All-zero distances would no-op; the caller's contract is "give me an
  // inset polygon," so refuse to dress that up as success.
  if (distancesM.every((d) => d === 0)) return null

  // 1. Local equirectangular projection at the ring's centroid.
  const refLat = open.reduce((s, p) => s + (p[1] ?? 0), 0) / n
  const refLng = open.reduce((s, p) => s + (p[0] ?? 0), 0) / n
  const cosLat = Math.cos((refLat * Math.PI) / 180)
  const M_PER_DEG = 111_320 // average meters per degree on a sphere
  const toM = (lng: number, lat: number): [number, number] => [
    (lng - refLng) * M_PER_DEG * cosLat,
    (lat - refLat) * M_PER_DEG,
  ]
  const toLngLat = (x: number, y: number): [number, number] => [
    refLng + x / (M_PER_DEG * cosLat),
    refLat + y / M_PER_DEG,
  ]
  const ringM: [number, number][] = open.map((p) => {
    const lng = p[0] ?? 0
    const lat = p[1] ?? 0
    return toM(lng, lat)
  })

  // 2. Orientation. Signed area > 0 means CCW (in standard math coords
  // where y goes up). Our local projection has y = north = up, so the
  // standard shoelace formula applies. If CW, reverse so the rest of the
  // math can assume CCW (inward normal = rotate edge direction +90 deg).
  let signedArea = 0
  for (let i = 0; i < n; i++) {
    const a = ringM[i]
    const b = ringM[(i + 1) % n]
    if (!a || !b) continue
    signedArea += a[0] * b[1] - b[0] * a[1]
  }
  signedArea *= 0.5
  if (signedArea === 0) return null
  let workingRing: [number, number][]
  let workingDistances: number[]
  if (signedArea < 0) {
    // Reverse to CCW. Also reverse the per-edge distances so edge i in
    // the original ring still maps to its intended distance.
    workingRing = ringM.slice().reverse()
    workingDistances = distancesM.slice().reverse()
    // After reversing the vertex list, edge i runs from
    // reversed[i] -> reversed[i+1]. In the original (CW) ring, this is
    // the reverse of the original edge (n-1-i). So distance for new edge
    // i should be the original distance for edge (n-1-i)... which is what
    // distancesM.reverse() produces. Confirmed.
  } else {
    workingRing = ringM
    workingDistances = distancesM
  }

  // 3 + 4. Build the clipping lines (one per edge) and successively clip
  // the polygon against each. Sutherland-Hodgman half-plane clipping is
  // robust here because each clip line is an oriented line; "inside" is
  // the half-plane on the inward (left of edge direction) side.
  let polygon: [number, number][] = workingRing.slice()
  for (let i = 0; i < n; i++) {
    const a = workingRing[i]
    const b = workingRing[(i + 1) % n]
    const d = workingDistances[i] ?? 0
    if (!a || !b) continue
    // Edge direction (unit vector).
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const len = Math.hypot(ex, ey)
    if (len === 0) continue
    const ux = ex / len
    const uy = ey / len
    // Inward normal (perpendicular to edge, rotated +90 in CCW polygon).
    const nx = -uy
    const ny = ux
    // Offset line: passes through (a + n*d), oriented along edge direction.
    const ox = a[0] + nx * d
    const oy = a[1] + ny * d
    // Half-plane test: a point p is "inside" (kept) when dot(p - o, n) >= 0.
    polygon = sutherlandHodgmanClipHalfPlane(polygon, [ox, oy], [nx, ny])
    if (polygon.length < 3) return null
  }

  // 5. Project back to lng/lat and close the ring.
  const lngLatRing: number[][] = polygon.map((p) => toLngLat(p[0], p[1]))
  if (lngLatRing.length < 3) return null
  // Close the ring.
  const first = lngLatRing[0]
  if (first) lngLatRing.push([first[0] ?? 0, first[1] ?? 0])
  return lngLatRing
}

/**
 * Clip a polygon (open vertex list, in CCW order in local meters) against
 * a half-plane defined by a point on the boundary line and an inward
 * normal. Returns the clipped polygon as a new open vertex list.
 *
 * Sutherland-Hodgman per-edge clip. Inside test: dot(p - origin, normal) >= 0.
 */
function sutherlandHodgmanClipHalfPlane(
  polygon: [number, number][],
  origin: [number, number],
  normal: [number, number],
): [number, number][] {
  if (polygon.length === 0) return []
  const out: [number, number][] = []
  const isInside = (p: [number, number]): boolean =>
    (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] >= 0

  // Intersection of segment p1-p2 with the clip line (p - origin) . normal = 0.
  // Parameter t along p1 + t*(p2 - p1). Solve:
  //   ((p1 + t*(p2-p1)) - origin) . normal = 0
  //   t = ((origin - p1) . normal) / ((p2 - p1) . normal)
  const intersect = (
    p1: [number, number],
    p2: [number, number],
  ): [number, number] => {
    const dx = p2[0] - p1[0]
    const dy = p2[1] - p1[1]
    const denom = dx * normal[0] + dy * normal[1]
    if (denom === 0) return p1 // parallel; should not happen if we got here
    const t = ((origin[0] - p1[0]) * normal[0] + (origin[1] - p1[1]) * normal[1]) / denom
    return [p1[0] + t * dx, p1[1] + t * dy]
  }

  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]
    const prev = polygon[(i - 1 + polygon.length) % polygon.length]
    if (!current || !prev) continue
    const currentIn = isInside(current)
    const prevIn = isInside(prev)
    if (currentIn) {
      if (!prevIn) out.push(intersect(prev, current))
      out.push(current)
    } else if (prevIn) {
      out.push(intersect(prev, current))
    }
  }
  return out
}

/**
 * Compute the buildable envelope for a parcel under a given setback.
 *
 * Pre-Phase-6 used Turf's geodesic buffer (negative distance) which
 * rounded inset corners. Phase 6a uses straight-line half-plane clipping
 * (`insetPolygonRing`) which preserves sharp corners. For MultiPolygon
 * parcels we inset each part independently.
 *
 * @param parcel The parcel polygon to inset.
 * @param setbackFt Uniform setback in feet. Phase 6c will add a per-edge
 *   variant via {@link insetPolygonRing} directly.
 * @returns Polygon (one inset part) or MultiPolygon (multiple inset parts)
 *   or null when the inset collapses to nothing.
 */
export function setbackEnvelope(
  parcel: PolygonOrMulti,
  setbackFt: number,
): PolygonOrMulti | null {
  if (!Number.isFinite(setbackFt) || setbackFt <= 0) return null
  const parts = parcel.type === 'Polygon' ? [parcel.coordinates] : parcel.coordinates
  const resultParts: number[][][][] = []
  for (const partRings of parts) {
    const exterior = partRings[0]
    if (!exterior || exterior.length < 4) continue
    const inset = insetPolygonRing(exterior, setbackFt)
    if (!inset || inset.length < 4) continue
    resultParts.push([inset])
  }
  if (resultParts.length === 0) return null
  if (resultParts.length === 1) {
    const single = resultParts[0]
    if (!single) return null
    return { type: 'Polygon', coordinates: single }
  }
  return { type: 'MultiPolygon', coordinates: resultParts }
}

/** Envelope area in sqft, summing every part. */
export function envelopeAreaSqft(envelope: PolygonOrMulti): number {
  return parcelAreaSqft(envelope)
}

// ── Phase 6b: parcel-edge feature builders ─────────────────────────────────
// Each exterior-ring edge becomes one LineString feature with an
// `edgeIndex` so click handlers can map clicks back to the corresponding
// EdgeLabel entry. A separate midpoint Point feature carries the F/S/R/O
// letter for the labels layer.

import type { EdgeLabel, EdgeLabelKind } from './schemas'

/**
 * Build LineString features (one per exterior-ring edge) tagged with the
 * edge's index in vertex order and the active label kind ('none' when
 * unlabeled). MultiPolygon parcels label only the largest part — Phase 6
 * works against the same `normalizeParcel().largest` ring everywhere.
 */
export function parcelEdgeLineFeatures(
  parcel: PolygonOrMulti,
  labels: EdgeLabel[],
): GeoJSON.Feature<GeoJSON.LineString>[] {
  const largest = parcel.type === 'Polygon' ? parcel : pickLargestPart(parcel)
  if (!largest) return []
  const ring = largest.coordinates[0]
  if (!ring || ring.length < 4) return []
  const labelByIndex = new Map<number, EdgeLabelKind>()
  for (const e of labels) labelByIndex.set(e.edgeIndex, e.label)
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]
    const b = ring[i + 1]
    if (!a || !b) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [a, b] },
      properties: {
        edgeIndex: i,
        label: labelByIndex.get(i) ?? 'none',
      },
    })
  }
  return features
}

/**
 * Build midpoint Point features carrying the one-letter label (F/S/R/O)
 * for each LABELED edge. Unlabeled edges produce no feature so the map
 * stays clean.
 */
export function parcelEdgeLabelFeatures(
  parcel: PolygonOrMulti,
  labels: EdgeLabel[],
): GeoJSON.Feature<GeoJSON.Point>[] {
  const largest = parcel.type === 'Polygon' ? parcel : pickLargestPart(parcel)
  if (!largest) return []
  const ring = largest.coordinates[0]
  if (!ring || ring.length < 4) return []
  const features: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const e of labels) {
    if (e.edgeIndex < 0 || e.edgeIndex >= ring.length - 1) continue
    const a = ring[e.edgeIndex]
    const b = ring[e.edgeIndex + 1]
    if (!a || !b) continue
    const ax = a[0] ?? 0
    const ay = a[1] ?? 0
    const bx = b[0] ?? 0
    const by = b[1] ?? 0
    const mid: [number, number] = [(ax + bx) / 2, (ay + by) / 2]
    const letter = e.label === 'front'
      ? 'F'
      : e.label === 'side'
        ? 'S'
        : e.label === 'rear'
          ? 'R'
          : 'O'
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: mid },
      properties: { letter, label: e.label, edgeIndex: e.edgeIndex },
    })
  }
  return features
}

/** Internal: pick the largest-by-area part of a MultiPolygon. */
function pickLargestPart(geom: PolygonOrMulti): Polygon | null {
  if (geom.type === 'Polygon') return geom
  let best: Polygon | null = null
  let bestArea = -Infinity
  for (const partCoords of geom.coordinates) {
    const a = area(turfPolygon(partCoords))
    if (a > bestArea) {
      bestArea = a
      best = { type: 'Polygon', coordinates: partCoords }
    }
  }
  return best
}

// Re-exports so consumers don't need separate imports.
export type { Polygon, MultiPolygon, PolygonOrMulti } from './schemas'
