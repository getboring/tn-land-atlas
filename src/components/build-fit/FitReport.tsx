// FitReport, the printable Building Fit handout (Phase 5).
//
// Render contract:
//   Always mounted while a footprint exists in fit mode, but hidden on
//   screen (`hidden print:block`). The @media print rule in index.css
//   promotes any [data-print-target] to the printed page; the parcel
//   detail panel and this report use the same attribute so a single
//   set of rules covers both.
//
// Layout:
//   Title + generated date
//   Parcel block: owner, address, county, acres, parcel ID, zoning, value
//   Footprint block: name, dimensions, stories, area
//   Setback block: mode-specific
//   Fit result: status, coverage, closest boundary
//   SVG diagram (parcel outline + envelope + footprint, no basemap)
//   Warnings (if any)
//   Disclaimer
//
// The SVG is a deterministic geometry-only render. No tiles, no projection
// math beyond equirectangular at parcel scale (per buildplan2 Phase 5
// option 2). Map-in-report via captured tiles is deferred.

import { useMemo } from 'react'
import type { ParcelFeature } from '@/lib/arcgis'
import type {
  Polygon,
  PolygonOrMulti,
  SetbackConfig,
} from '@/lib/build-fit/schemas'
import type { FitResultDisplay } from './FitResultPanel'
import {
  parcelDiagramData,
  formatLatLon,
  describeStatus,
  describeEnvelope,
  formatFt,
  formatReportDate,
} from '@/lib/build-fit/report'

interface FitReportProps {
  parcel: ParcelFeature
  parcelGeom: PolygonOrMulti
  footprint: {
    name: string
    widthFt: number
    lengthFt: number
    rotationDeg: number
    stories: number | null
    notes: string | null
  }
  footprintGeom: Polygon | null
  center: [number, number] | null
  result: FitResultDisplay
  setback: SetbackConfig
  envelopeGeom: PolygonOrMulti | null
  envelopeSqft: number | null
  /** ISO timestamp the report was generated at. */
  generatedAt: string
}

export function FitReport({
  parcel,
  parcelGeom,
  footprint,
  footprintGeom,
  center,
  result,
  setback,
  envelopeGeom,
  envelopeSqft,
  generatedAt,
}: FitReportProps) {
  const p = parcel.properties
  // Memo the SVG diagram so a parent re-render that changes only the
  // generatedAt timestamp (the cheap part) doesn't re-run the geodesic
  // projection (the not-cheap part). Refreshes only when one of the four
  // geometric inputs changes.
  const diagram = useMemo(
    () =>
      parcelDiagramData({
        parcel: parcelGeom,
        envelope: envelopeGeom,
        footprint: footprintGeom,
        center,
      }),
    [parcelGeom, envelopeGeom, footprintGeom, center],
  )

  return (
    <section
      data-print-target="fit-report"
      aria-label="Building fit report"
      // Hidden on screen, promoted by the @media print rule. Black ink on
      // white paper to match the parcel detail handout.
      className="hidden print:block text-black"
    >
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Holston Scout — Building Fit Report</h1>
        <div className="text-xs text-neutral-600">Generated {formatReportDate(generatedAt)}</div>
      </header>

      <ReportSection title="Parcel">
        <Row label="Owner" value={p.OWNER ?? '—'} />
        <Row label="Address" value={p.ADDRESS ?? '—'} />
        <Row label="County" value={p.COUNTYNAME ?? '—'} />
        <Row
          label="Acres"
          value={p.CALC_ACRE != null ? p.CALC_ACRE.toFixed(2) : '—'}
        />
        <Row label="Parcel ID" value={p.GISLINK ?? '—'} mono />
        <Row label="Zoning" value={p.ZONING ?? '—'} />
        <Row
          label="Appraised value"
          value={p.APPRAISAL != null ? `$${Math.round(p.APPRAISAL).toLocaleString()}` : '—'}
        />
      </ReportSection>

      <ReportSection title="Footprint">
        <Row label="Name" value={footprint.name || '(unnamed)'} />
        <Row
          label="Dimensions"
          value={`${footprint.widthFt} × ${footprint.lengthFt} ft (rotation ${footprint.rotationDeg}°)`}
        />
        <Row label="Stories" value={footprint.stories != null ? String(footprint.stories) : '—'} />
        <Row
          label="Area"
          value={
            result.footprintSqft != null
              ? `${Math.round(result.footprintSqft).toLocaleString()} sqft`
              : '—'
          }
        />
        {footprint.notes && <Row label="Notes" value={footprint.notes} />}
      </ReportSection>

      {center && (
        <ReportSection title="Placement">
          <Row label="Center" value={formatLatLon(center[1], center[0])} />
        </ReportSection>
      )}

      <ReportSection title="Setback">
        {setback.mode === 'none' && <Row label="Mode" value="None" />}
        {setback.mode === 'uniform' && (
          <>
            <Row label="Mode" value={`Uniform ${setback.setbackFt} ft`} />
            <Row label="Envelope status" value={describeEnvelope(result.fitsEnvelope)} />
            {envelopeSqft != null && (
              <Row label="Envelope area" value={`${Math.round(envelopeSqft).toLocaleString()} sqft`} />
            )}
            {result.parcelSqft != null && envelopeSqft != null && (
              <Row
                label="Lost to setback"
                value={`${Math.round(result.parcelSqft - envelopeSqft).toLocaleString()} sqft`}
              />
            )}
          </>
        )}
        {setback.mode === 'manual' && (
          <>
            <Row label="Mode" value="Manual" />
            <Row label="Front" value={formatFt(setback.frontFt)} />
            <Row label="Side" value={formatFt(setback.sideFt)} />
            <Row label="Rear" value={formatFt(setback.rearFt)} />
            {setback.notes && <Row label="Notes" value={setback.notes} />}
          </>
        )}
      </ReportSection>

      <ReportSection title="Fit result">
        <Row label="Status" value={describeStatus(result)} />
        {result.coveragePct != null && result.parcelSqft != null && (
          <Row
            label="Parcel coverage"
            value={`${result.coveragePct.toFixed(1)}% of ${Math.round(result.parcelSqft).toLocaleString()} sqft`}
          />
        )}
        {result.closestBoundaryFt != null && (
          <Row
            label="Closest boundary"
            value={`${Math.round(result.closestBoundaryFt).toLocaleString()} ft`}
          />
        )}
      </ReportSection>

      {diagram && (
        <ReportSection title="Diagram">
          <svg
            viewBox={diagram.viewBox}
            xmlns="http://www.w3.org/2000/svg"
            // Cap rendered width so the diagram fits a US-letter page with
            // 0.75in margins. Print CSS strips the inline color via
            // [data-print-target] *, so set colors via stroke/fill
            // attributes here.
            style={{ width: '100%', maxWidth: '6.5in', height: 'auto', border: '1px solid #94a3b8' }}
            role="img"
            aria-label="Parcel, buildable envelope, and footprint diagram"
          >
            <path d={diagram.parcelPath} fill="none" stroke="#0f172a" strokeWidth={2} />
            {diagram.envelopePath && (
              <path
                d={diagram.envelopePath}
                fill="#0f172a"
                fillOpacity={0.06}
                stroke="#0f172a"
                strokeWidth={1}
                strokeDasharray="6 4"
              />
            )}
            {diagram.footprintPath && (
              <path
                d={diagram.footprintPath}
                fill="#475569"
                fillOpacity={0.45}
                stroke="#0f172a"
                strokeWidth={1.5}
              />
            )}
            {diagram.centerXY && (
              <circle
                cx={diagram.centerXY[0]}
                cy={diagram.centerXY[1]}
                r={4}
                fill="#0f172a"
              />
            )}
          </svg>
          <div className="text-[10px] text-neutral-600 mt-1">
            Geometry only. No basemap. Parcel outline solid, buildable
            envelope dashed, footprint shaded.
          </div>
        </ReportSection>
      )}

      {result.warnings.length > 0 && (
        <ReportSection title="Warnings">
          <ul className="list-disc pl-5 text-xs">
            {result.warnings.map((w, i) => (
              // Source/severity prefix makes the printed report scannable
              // ("flood · ..." vs "setback · ..."). Key by index because two
              // warnings can legitimately share the same (source, code).
              <li key={`${w.source}-${w.code}-${i}`}>
                <span className="font-mono text-[10px] uppercase tracking-wider mr-1">
                  {w.severity} · {w.source}
                </span>
                {w.message}
              </li>
            ))}
          </ul>
        </ReportSection>
      )}

      <footer className="mt-4 pt-2 border-t text-[10px] leading-snug">
        Planning estimate only. Parcel boundaries, setbacks, zoning, slopes,
        easements, utilities, septic rules, floodplain status, and survey
        conditions must be verified with the local authority, surveyor, and
        design professional before purchase, permitting, or construction.
      </footer>
    </section>
  )
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h2 className="text-xs uppercase tracking-wider font-semibold border-b pb-0.5 mb-1">
        {title}
      </h2>
      <div className="text-sm space-y-0.5">{children}</div>
    </section>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <div className="w-36 text-xs text-neutral-600">{label}</div>
      <div className={mono ? 'font-mono text-xs' : 'text-xs'}>{value}</div>
    </div>
  )
}

// Helper functions (describeStatus, describeEnvelope, formatFt,
// formatReportDate) live in src/lib/build-fit/report.ts so the JSX-side
// renderer and the plain-text formatFitSummary stay in sync. Do not
// reimplement them here.
