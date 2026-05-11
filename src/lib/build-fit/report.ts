// Build-fit print/report helpers (Phase 5).
//
// Per projects/buildplan2.md Phase 5:
//   Print fit report with parcel detail, footprint dimensions, fit results,
//   warnings, disclaimer. Add a Copy summary action. Accept a non-map
//   geometry diagram rendered as SVG from GeoJSON for the printed page,
//   defer live-map embed.
//
// Two pure functions:
//   formatFitSummary  → plain-text block for the Copy summary clipboard
//                       action. Stable across renders so tests can pin
//                       exact lines.
//   parcelDiagramData → bounding-box + SVG path strings for parcel,
//                       envelope, footprint. No DOM, no React. Caller
//                       renders the actual SVG.
//
// Why a pure helper layer at all: the print target lives in a React
// component, but the math needs unit-test coverage independent of JSDOM.
// Keeping summary + diagram math here makes both testable as pure
// functions and the JSX a thin wrapper.

import type {
  Polygon,
  PolygonOrMulti,
  SetbackConfig,
} from './schemas'
import type { FitResultDisplay } from '@/components/build-fit/FitResultPanel'

// ── formatFitSummary ──────────────────────────────────────────────────────

export interface FitSummaryInput {
  parcel: {
    parcelKey: string | null
    owner: string | null
    address: string | null
    county: string | null
    acres: number | null
    zoning: string | null
    appraisalDollars: number | null
  }
  footprint: {
    name: string
    widthFt: number
    lengthFt: number
    rotationDeg: number
    stories: number | null
    notes: string | null
  }
  /** [lng, lat] of placed footprint center. */
  center: [number, number] | null
  setback: SetbackConfig
  envelopeSqft: number | null
  result: FitResultDisplay
  /** ISO timestamp the report was generated at. Injected so callers can
   *  pin it in tests. */
  generatedAt: string
}

const DISCLAIMER =
  'Planning estimate only. Parcel boundaries, setbacks, zoning, slopes, ' +
  'easements, utilities, septic rules, floodplain status, and survey ' +
  'conditions must be verified with the local authority, surveyor, and ' +
  'design professional before purchase, permitting, or construction.'

export function formatFitSummary(input: FitSummaryInput): string {
  const lines: string[] = []
  lines.push('Holston Scout — Building Fit Report')
  lines.push(`Generated ${formatDate(input.generatedAt)}`)
  lines.push('')

  lines.push('Parcel')
  lines.push(`  Owner: ${input.parcel.owner ?? '—'}`)
  lines.push(`  Address: ${input.parcel.address ?? '—'}`)
  lines.push(`  County: ${input.parcel.county ?? '—'}`)
  lines.push(
    `  Acres: ${input.parcel.acres != null ? input.parcel.acres.toFixed(2) : '—'}`,
  )
  lines.push(`  Parcel ID: ${input.parcel.parcelKey ?? '—'}`)
  lines.push(`  Zoning: ${input.parcel.zoning ?? '—'}`)
  lines.push(
    `  Appraised value: ${
      input.parcel.appraisalDollars != null
        ? formatMoney(input.parcel.appraisalDollars)
        : '—'
    }`,
  )
  lines.push('')

  lines.push('Footprint')
  lines.push(`  Name: ${input.footprint.name || '(unnamed)'}`)
  lines.push(
    `  Dimensions: ${input.footprint.widthFt} × ${input.footprint.lengthFt} ft (rotation ${input.footprint.rotationDeg}°)`,
  )
  lines.push(`  Stories: ${input.footprint.stories ?? '—'}`)
  lines.push(
    `  Area: ${
      input.result.footprintSqft != null
        ? `${Math.round(input.result.footprintSqft).toLocaleString()} sqft`
        : '—'
    }`,
  )
  if (input.footprint.notes) lines.push(`  Notes: ${input.footprint.notes}`)
  lines.push('')

  if (input.center) {
    lines.push('Placement')
    lines.push(`  Center: ${formatLatLon(input.center[1], input.center[0])}`)
    lines.push('')
  }

  lines.push('Setback')
  if (input.setback.mode === 'none') {
    lines.push('  Mode: None')
  } else if (input.setback.mode === 'uniform') {
    lines.push(`  Mode: Uniform ${input.setback.setbackFt} ft`)
    lines.push(
      `  Envelope status: ${describeEnvelope(input.result.fitsEnvelope)}`,
    )
    if (input.envelopeSqft != null) {
      lines.push(
        `  Envelope area: ${Math.round(input.envelopeSqft).toLocaleString()} sqft`,
      )
    }
    if (
      input.result.parcelSqft != null &&
      input.envelopeSqft != null
    ) {
      lines.push(
        `  Lost to setback: ${Math.round(input.result.parcelSqft - input.envelopeSqft).toLocaleString()} sqft`,
      )
    }
  } else {
    // manual
    lines.push('  Mode: Manual')
    lines.push(`  Front: ${formatFt(input.setback.frontFt)}`)
    lines.push(`  Side: ${formatFt(input.setback.sideFt)}`)
    lines.push(`  Rear: ${formatFt(input.setback.rearFt)}`)
    if (input.setback.notes) lines.push(`  Notes: ${input.setback.notes}`)
  }
  lines.push('')

  lines.push('Fit result')
  lines.push(`  Status: ${describeStatus(input.result)}`)
  if (
    input.result.coveragePct != null &&
    input.result.parcelSqft != null
  ) {
    lines.push(
      `  Parcel coverage: ${input.result.coveragePct.toFixed(1)}% of ${Math.round(input.result.parcelSqft).toLocaleString()} sqft`,
    )
  }
  if (input.result.closestBoundaryFt != null) {
    lines.push(
      `  Closest boundary: ${Math.round(input.result.closestBoundaryFt).toLocaleString()} ft`,
    )
  }
  lines.push('')

  if (input.result.warnings.length > 0) {
    lines.push('Warnings')
    for (const w of input.result.warnings) {
      // Prefix with severity so the report reads at a glance which lines
      // matter. Tests pin on `code`; the message is the human-readable part.
      const tag =
        w.severity === 'error' ? '!' : w.severity === 'warning' ? '·' : 'i'
      lines.push(`  ${tag} ${w.message}`)
    }
    lines.push('')
  }

  lines.push(DISCLAIMER)
  return lines.join('\n')
}

/**
 * Render the parcel/envelope fit status as a single human-readable phrase.
 * Exported so `FitReport.tsx` and other display surfaces don't reimplement
 * the precedence (parcel-crossing dominates, envelope is secondary).
 */
export function describeStatus(r: FitResultDisplay): string {
  if (r.fitsParcel === false) return 'Crosses parcel boundary'
  if (r.fitsEnvelope === false) return 'Inside parcel, crosses setback envelope'
  if (r.fitsParcel === true) {
    return r.fitsEnvelope === true
      ? 'Fits parcel and setback envelope'
      : 'Fits parcel'
  }
  return 'No footprint placed yet'
}

/** Render envelope fit state as `'Fits' | 'Crosses' | '—'`. */
export function describeEnvelope(fits: boolean | null): string {
  if (fits === true) return 'Fits'
  if (fits === false) return 'Crosses'
  return '—'
}

/** Render a nullable foot-distance as `'N ft'` or `'—'`. */
export function formatFt(v: number | null): string {
  if (v == null) return '—'
  return `${v} ft`
}

function formatMoney(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString()}`
}

// Render a [lat, lon] pair with explicit N/S and E/W hemisphere suffixes
// (always positive magnitudes). The naive "-82.0°E" form is geographically
// wrong; this matches how survey reports and USGS quads label coordinates.
export function formatLatLon(lat: number, lon: number, decimals = 5): string {
  const latHem = lat >= 0 ? 'N' : 'S'
  const lonHem = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(decimals)}°${latHem}, ${Math.abs(lon).toFixed(decimals)}°${lonHem}`
}

/**
 * Trim an ISO timestamp to `YYYY-MM-DD`, or echo the input verbatim when
 * unparseable. Locale-independent so test fixtures match byte-for-byte.
 */
export function formatReportDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 10)
}

/** @internal Kept for the formatFitSummary date line. */
function formatDate(iso: string): string {
  return formatReportDate(iso)
}

// ── parcelDiagramData ─────────────────────────────────────────────────────
// Builds an SVG viewBox + path-d strings for the parcel, the optional
// buildable envelope, and the placed footprint. Equirectangular projection
// (raw lng/lat scaled into the box) — fine at parcel scale, no need for a
// proper Mercator transform.
//
// Returns null when there's nothing to draw (no parcel geometry).

export interface ParcelDiagramData {
  /** SVG viewBox attribute string, "minX minY width height". */
  viewBox: string
  /** SVG path d string for the parcel exterior (and any holes). */
  parcelPath: string
  /** Envelope path d string, null when no envelope is configured. */
  envelopePath: string | null
  /** Footprint path d string, null when no footprint is placed. */
  footprintPath: string | null
  /** Center marker [x, y] in SVG coords, null when no footprint. */
  centerXY: [number, number] | null
}

const DIAGRAM_PAD_FRAC = 0.05 // pad bbox by 5% of its span on each side

export function parcelDiagramData(input: {
  parcel: PolygonOrMulti
  envelope: PolygonOrMulti | null
  footprint: Polygon | null
  center: [number, number] | null
  /** Target SVG canvas pixel size. Defaults to 1000×750 (4:3) — actual
   *  print size is set via CSS; viewBox just defines coordinate space. */
  canvas?: { width: number; height: number }
}): ParcelDiagramData | null {
  const bbox = bboxOfGeometry(input.parcel)
  if (!bbox) return null

  const canvas = input.canvas ?? { width: 1000, height: 750 }
  // Refuse degenerate inputs: a zero-width or zero-height parcel bbox makes
  // padX/padY zero and scaleX/scaleY infinite, which renders a silent
  // garbage SVG. Real parcels never collapse this way, but a hostile or
  // misencoded import could.
  const rawSpanX = bbox.maxX - bbox.minX
  const rawSpanY = bbox.maxY - bbox.minY
  if (rawSpanX <= 0 || rawSpanY <= 0) return null

  const padX = rawSpanX * DIAGRAM_PAD_FRAC
  const padY = rawSpanY * DIAGRAM_PAD_FRAC
  const west = bbox.minX - padX
  const east = bbox.maxX + padX
  const south = bbox.minY - padY
  const north = bbox.maxY + padY

  // Lock aspect so circles read as circles. Use the wider of the two axes.
  const spanX = east - west
  const spanY = north - south
  const scaleX = canvas.width / spanX
  const scaleY = canvas.height / spanY
  const scale = Math.min(scaleX, scaleY)
  if (!Number.isFinite(scale) || scale <= 0) return null
  const drawW = spanX * scale
  const drawH = spanY * scale
  // Center the drawing inside the canvas.
  const offsetX = (canvas.width - drawW) / 2
  const offsetY = (canvas.height - drawH) / 2

  const project = (lng: number, lat: number): [number, number] => [
    offsetX + (lng - west) * scale,
    // Flip y so north is up (lat increases northward, SVG y increases downward).
    offsetY + (north - lat) * scale,
  ]

  return {
    viewBox: `0 0 ${canvas.width} ${canvas.height}`,
    parcelPath: polygonOrMultiToPath(input.parcel, project),
    envelopePath: input.envelope
      ? polygonOrMultiToPath(input.envelope, project)
      : null,
    footprintPath: input.footprint
      ? polygonOrMultiToPath(input.footprint, project)
      : null,
    centerXY: input.center ? project(input.center[0], input.center[1]) : null,
  }
}

function polygonOrMultiToPath(
  g: PolygonOrMulti,
  project: (lng: number, lat: number) => [number, number],
): string {
  const rings: number[][][] = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
  const parts: string[] = []
  for (const ring of rings) {
    if (ring.length < 4) continue
    // Skip any vertex with a missing or non-finite axis. A single NaN
    // coordinate would otherwise render `M NaN NaN L ...` which produces a
    // silently-invalid SVG path. The Position schema rejects this at the
    // boundary, but the helper is independently exported and may be called
    // with hand-rolled geometry in the future.
    const projected: [number, number][] = []
    for (const pos of ring) {
      const lng = pos[0]
      const lat = pos[1]
      if (typeof lng !== 'number' || typeof lat !== 'number') continue
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      projected.push(project(lng, lat))
    }
    if (projected.length < 4) continue
    const head = projected[0]
    if (!head || !Number.isFinite(head[0]) || !Number.isFinite(head[1])) continue
    let s = `M ${head[0].toFixed(2)} ${head[1].toFixed(2)}`
    for (let i = 1; i < projected.length; i += 1) {
      const p = projected[i]
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
      s += ` L ${p[0].toFixed(2)} ${p[1].toFixed(2)}`
    }
    s += ' Z'
    parts.push(s)
  }
  return parts.join(' ')
}

interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function bboxOfGeometry(g: PolygonOrMulti): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const rings: number[][][] = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
  for (const ring of rings) {
    for (const pos of ring) {
      const lng = pos[0]
      const lat = pos[1]
      if (lng == null || lat == null) continue
      if (lng < minX) minX = lng
      if (lng > maxX) maxX = lng
      if (lat < minY) minY = lat
      if (lat > maxY) maxY = lat
    }
  }
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null
  }
  return { minX, minY, maxX, maxY }
}
